import { useState, useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import ReactECharts from 'echarts-for-react'
import { apiFetch } from '../utils/api'
import { useTemperatureUnit } from '../hooks/useTemperatureUnit'
import { similarSensorOptions } from '../utils/sensorComparison'
import { format, subHours, subDays } from 'date-fns'

const TIME_RANGES = [
  { value: '1h', label: '1 Hour' },
  { value: '6h', label: '6 Hours' },
  { value: '12h', label: '12 Hours' },
  { value: '24h', label: '24 Hours' },
  { value: '3d', label: '3 Days' },
  { value: '7d', label: '7 Days' },
  { value: '14d', label: '14 Days' },
  { value: '30d', label: '30 Days' },
]

const SENSOR_CONFIG = {
  temperature: { label: 'Temperature', unit: null, color: '#ef4444', yAxisIndex: 0 },
  humidity: { label: 'Humidity', unit: '%', color: '#3b82f6', yAxisIndex: 1 },
  vpd: { label: 'VPD', unit: 'kPa', color: '#22c55e', yAxisIndex: 2 },
  co2: { label: 'CO2', unit: 'ppm', color: '#a855f7', yAxisIndex: 0 }
}

const FOCUS_COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#a855f7', '#14b8a6']

function StateStatsCard({ label, stats }) {
  if (!stats) return null
  return (
    <div className="bg-[#1a1a2e] rounded-lg p-3">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="grid grid-cols-3 gap-2 text-sm">
        <div>
          <span className="text-gray-400">On:</span>
          <span className="ml-1 font-medium">{stats.on_percent != null ? `${stats.on_percent}%` : '--'}</span>
        </div>
        <div>
          <span className="text-gray-400">Hours:</span>
          <span className="ml-1 font-medium">{stats.on_hours != null ? stats.on_hours : '--'}</span>
        </div>
        <div>
          <span className="text-gray-400">Now:</span>
          <span className="ml-1 font-medium text-green-400">{stats.current ?? '--'}</span>
        </div>
      </div>
    </div>
  )
}

const isTempSeries = (key) => key === 'temperature' || /^temperature_\d+$/.test(key)
const toFahrenheit = (v) => (v == null ? v : Math.round(((v * 9) / 5 + 32) * 100) / 100)

// SENSOR_CONFIG used to hardcode the degree symbol, so Fahrenheit readings were
// labelled Celsius. Convert once here and let the label follow the same choice.
function toDisplayUnits(data, unit) {
  if (!data?.data || unit !== 'F') return data
  const converted = { ...data, data: { ...data.data }, stats: { ...(data.stats || {}) } }
  Object.keys(converted.data).forEach(key => {
    if (!isTempSeries(key)) return
    converted.data[key] = converted.data[key].map(p => ({
      ...p,
      value: toFahrenheit(p.value),
      ...(p.min !== undefined ? { min: toFahrenheit(p.min), max: toFahrenheit(p.max) } : {})
    }))
    const s = converted.stats[key]
    if (s) {
      converted.stats[key] = {
        ...s,
        min: toFahrenheit(s.min),
        max: toFahrenheit(s.max),
        avg: toFahrenheit(s.avg),
        current: toFahrenheit(s.current)
      }
    }
  })
  return converted
}

function StatsCard({ label, stats, unit }) {
  if (!stats) return null
  return (
    <div className="bg-[#1a1a2e] rounded-lg p-3">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-sm whitespace-nowrap">
        <div>
          <span className="text-gray-400">Min:</span>
          <span className="ml-1 font-medium">{stats.min}{unit}</span>
        </div>
        <div>
          <span className="text-gray-400">Max:</span>
          <span className="ml-1 font-medium">{stats.max}{unit}</span>
        </div>
        <div>
          <span className="text-gray-400">Avg:</span>
          <span className="ml-1 font-medium">{stats.avg}{unit}</span>
        </div>
        <div>
          <span className="text-gray-400">Now:</span>
          <span className="ml-1 font-medium text-green-400">{stats.current}{unit}</span>
        </div>
      </div>
    </div>
  )
}

export default function Reports() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { unit: tempUnit, getTempUnit } = useTemperatureUnit()
  const [tents, setTents] = useState([])
  const [selectedTent, setSelectedTent] = useState(null)
  const timeRange = searchParams.get('range') || '24h'
  const [sensors, setSensors] = useState(
    searchParams.get('sensors')?.split(',').filter(Boolean) || ['temperature', 'humidity', 'vpd']
  )
  const [historyData, setHistoryData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [customRange, setCustomRange] = useState({ from: '', to: '' })
  const [showCustom, setShowCustom] = useState(false)
  // Entity focus: arrives as ?entity=sensor.a,sensor.b when something is clicked elsewhere
  const [focusData, setFocusData] = useState([])
  const [focusLoading, setFocusLoading] = useState(false)

  const focusEntities = useMemo(
    () => (searchParams.get('entity') || '').split(',').map(e => e.trim()).filter(Boolean),
    [searchParams]
  )
  const focusKey = focusEntities.join(',')
  const primaryFocusEntity = focusEntities[0]
  const comparisonOptions = similarSensorOptions(tents, focusEntities)

  // How often a live range re-queries history. The underlying HA recorder updates these
  // sensors about once a minute, so polling faster than this just burns requests for
  // points that do not exist yet.
  const LIVE_REFRESH_MS = 30000

  const [refreshTick, setRefreshTick] = useState(0)
  const [lastUpdated, setLastUpdated] = useState(null)

  // A custom from/to window is a fixed slice of the past. It cannot gain new points, so
  // polling it would be pure waste - only relative ranges ("last 24h") actually move.
  const isLiveRange = !(showCustom && customRange.from && customRange.to)

  // What the user is looking at, as opposed to the data underneath it. A change here means
  // a genuinely different chart and earns a spinner; a refresh tick must not flash one.
  const focusSelection = `${focusKey}|${timeRange}|${showCustom}|${customRange.from}|${customRange.to}`
  const tentSelection = `${selectedTent}|${sensors.join(',')}|${timeRange}|${showCustom}|${customRange.from}|${customRange.to}`
  const lastFocusSelection = useRef(null)
  const lastTentSelection = useRef(null)

  // Touch devices cannot have both a pannable chart and a scrollable page: ECharts' inside
  // dataZoom swallows the one-finger drag, so the page stops scrolling wherever the chart
  // happens to be. On coarse pointers the inside zoom is dropped and the slider below the
  // chart becomes the way to zoom - a deliberate grab rather than an accidental one.
  const coarsePointer = useMemo(
    () => (typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(pointer: coarse)').matches
      : false),
    []
  )

  // The user's zoom, preserved across live refreshes. Without this a 30-second refresh
  // would yank the view back to the full range every time, which makes the chart unusable
  // exactly when someone is trying to look at something closely.
  const zoomRef = useRef({ start: 0, end: 100 })
  const onChartEvents = useMemo(() => ({
    dataZoom: (event) => {
      const range = (event.batch && event.batch[0]) || event
      if (typeof range.start === 'number' && typeof range.end === 'number') {
        zoomRef.current = { start: range.start, end: range.end }
      }
    }
  }), [])

  useEffect(() => {
    if (!isLiveRange) return undefined
    const bump = () => {
      if (document.visibilityState === 'visible') setRefreshTick(t => t + 1)
    }
    const interval = setInterval(bump, LIVE_REFRESH_MS)
    // Coming back to the tab should show current data immediately rather than whatever was
    // on screen when it was hidden, so catch up now instead of waiting out the interval.
    document.addEventListener('visibilitychange', bump)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', bump)
    }
  }, [isLiveRange])

  const clearFocus = () => {
    const next = new URLSearchParams(searchParams)
    next.delete('entity')
    setSearchParams(next, { replace: true })
  }

  const toggleFocusEntity = (entityId) => {
    if (!entityId || entityId === primaryFocusEntity) return
    const nextEntities = focusEntities.includes(entityId)
      ? focusEntities.filter(id => id !== entityId)
      : [...focusEntities, entityId]
    const next = new URLSearchParams(searchParams)
    next.set('entity', nextEntities.join(','))
    setSearchParams(next, { replace: true })
  }

  const setTimeRange = (value) => {
    const next = new URLSearchParams(searchParams)
    next.set('range', value)
    setSearchParams(next, { replace: true })
  }

  // Load tents
  useEffect(() => {
    apiFetch('api/tents')
      .then(r => r.json())
      .then(data => {
        setTents(data.tents || [])
        const wanted = searchParams.get('tent')
        const match = data.tents?.find(t => t.id === wanted)
        if (match) {
          setSelectedTent(match.id)
        } else if (data.tents?.length > 0) {
          setSelectedTent(data.tents[0].id)
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  // Arriving from a click elsewhere while Reports is already open: adopt the
  // tent and series named in the URL instead of keeping the previous view.
  const urlTent = searchParams.get('tent')
  const urlSensors = searchParams.get('sensors')

  useEffect(() => {
    if (urlTent && urlTent !== selectedTent && tents.some(t => t.id === urlTent)) {
      setSelectedTent(urlTent)
    }
  }, [urlTent, tents])

  useEffect(() => {
    if (!urlSensors) return
    const wanted = urlSensors.split(',').filter(Boolean)
    if (wanted.length && wanted.join(',') !== sensors.join(',')) {
      setSensors(wanted)
    }
  }, [urlSensors])

  // Load history for focused entities (any entity, not just tent slots)
  useEffect(() => {
    if (!focusKey) {
      setFocusData([])
      return
    }
    let cancelled = false
    // Only a real change of subject gets a spinner. A live refresh replacing the data
    // underneath an identical chart should be invisible.
    const isNewSelection = lastFocusSelection.current !== focusSelection
    lastFocusSelection.current = focusSelection
    if (isNewSelection) {
      zoomRef.current = { start: 0, end: 100 }
      setFocusLoading(true)
    }
    const rangeQuery = showCustom && customRange.from && customRange.to
      ? `from_time=${customRange.from}&to_time=${customRange.to}`
      : `range=${timeRange}`

    Promise.all(
      focusEntities.map(id =>
        apiFetch(`api/reports/entity-history?entity_id=${encodeURIComponent(id)}&${rangeQuery}`)
          .then(r => (r.ok ? r.json() : null))
          .catch(() => null)
      )
    )
      .then(results => {
        if (!cancelled) {
          setFocusData(results.filter(Boolean))
          setLastUpdated(new Date())
        }
      })
      .finally(() => {
        if (!cancelled) setFocusLoading(false)
      })

    return () => { cancelled = true }
  }, [focusKey, timeRange, showCustom, customRange, refreshTick])

  // Load history when tent or range changes
  useEffect(() => {
    if (!selectedTent || focusKey) return

    const isNewSelection = lastTentSelection.current !== tentSelection
    lastTentSelection.current = tentSelection
    if (isNewSelection) {
      zoomRef.current = { start: 0, end: 100 }
      setLoading(true)
    }
    const sensorParam = sensors.join(',')
    let url = `api/reports/history/${selectedTent}?sensors=${sensorParam}&range=${timeRange}`

    if (showCustom && customRange.from && customRange.to) {
      url = `api/reports/history/${selectedTent}?sensors=${sensorParam}&from_time=${customRange.from}&to_time=${customRange.to}`
    }

    apiFetch(url)
      .then(r => r.json())
      .then(data => {
        setHistoryData(toDisplayUnits(data, tempUnit))
        setLastUpdated(new Date())
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [selectedTent, timeRange, sensors, showCustom, customRange, focusKey, refreshTick, tempUnit])

  // Toggle sensor visibility
  const toggleSensor = (sensor) => {
    setSensors(prev =>
      prev.includes(sensor)
        ? prev.filter(s => s !== sensor)
        : [...prev, sensor]
    )
  }

  // Build ECharts options
  const tempUnitLabel = getTempUnit()

  const chartOptions = useMemo(() => {
    if (!historyData?.data) return null

    const series = []
    const legend = []

    // Build light period markArea data for overlay
    const lightMarkAreas = (historyData.light_periods || []).map(period => ([
      {
        xAxis: new Date(period.start).getTime(),
        itemStyle: { color: 'rgba(250, 204, 21, 0.15)' }
      },
      {
        xAxis: new Date(period.end).getTime()
      }
    ]))

    Object.entries(historyData.data).forEach(([sensor, data], index) => {
      if (!data || data.length === 0) return
      const config = SENSOR_CONFIG[sensor] || { label: sensor, color: '#888', yAxisIndex: 0 }

      legend.push(config.label)

      // Determine which Y-axis to use
      let yAxisIndex = 0 // Default: temperature (left)
      if (sensor === 'humidity') yAxisIndex = 1 // Right axis
      if (sensor === 'vpd') yAxisIndex = 2 // Far right axis

      // Main line - add light overlay markArea to first series only
      const seriesConfig = {
        name: config.label,
        type: 'line',
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 2, color: config.color },
        itemStyle: { color: config.color },
        data: data.map(d => [new Date(d.timestamp).getTime(), d.value]),
        yAxisIndex
      }

      // Add light overlay to the first series
      if (index === 0 && lightMarkAreas.length > 0) {
        seriesConfig.markArea = {
          silent: true,
          data: lightMarkAreas
        }
      }

      series.push(seriesConfig)

      // Min/max area if available
      if (data[0]?.min !== undefined) {
        series.push({
          name: `${config.label} Range`,
          type: 'line',
          smooth: true,
          symbol: 'none',
          lineStyle: { opacity: 0 },
          areaStyle: { color: config.color, opacity: 0.1 },
          stack: `${sensor}-range`,
          data: data.map(d => [new Date(d.timestamp).getTime(), d.min])
        })
        series.push({
          name: `${config.label} Range Upper`,
          type: 'line',
          smooth: true,
          symbol: 'none',
          lineStyle: { opacity: 0 },
          areaStyle: { color: config.color, opacity: 0.1 },
          stack: `${sensor}-range`,
          data: data.map(d => [new Date(d.timestamp).getTime(), d.max - d.min])
        })
      }
    })

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#1a1a2e',
        borderColor: '#2d3a5c',
        textStyle: { color: '#fff' },
        formatter: (params) => {
          if (!params.length) return ''
          const time = format(new Date(params[0].value[0]), 'MMM d, HH:mm')
          let html = `<div style="font-weight:600;margin-bottom:4px">${time}</div>`
          params.forEach(p => {
            if (p.seriesName.includes('Range')) return
            const config = Object.values(SENSOR_CONFIG).find(c => c.label === p.seriesName)
            html += `<div style="display:flex;justify-content:space-between;gap:16px">
              <span style="color:${p.color}">${p.seriesName}</span>
              <span style="font-weight:600">${p.value[1].toFixed(1)}${config?.unit ?? tempUnitLabel}</span>
            </div>`
          })
          return html
        }
      },
      legend: {
        data: legend,
        textStyle: { color: '#9ca3af' },
        top: 10
      },
      grid: {
        left: 60,
        right: 100,
        top: 50,
        bottom: 80
      },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: '#2d3a5c' } },
        axisLabel: { color: '#9ca3af' },
        splitLine: { show: false }
      },
      yAxis: [
        {
          type: 'value',
          name: `Temp (${tempUnitLabel})`,
          nameTextStyle: { color: '#ef4444' },
          axisLine: { lineStyle: { color: '#ef4444' } },
          axisLabel: { color: '#9ca3af' },
          splitLine: { lineStyle: { color: '#2d3a5c', opacity: 0.3 } }
        },
        {
          type: 'value',
          name: 'Humidity %',
          nameGap: 26,
          nameTextStyle: { color: '#3b82f6' },
          axisLine: { lineStyle: { color: '#3b82f6' } },
          axisLabel: { color: '#9ca3af' },
          splitLine: { show: false },
          min: 0,
          max: 100
        },
        {
          type: 'value',
          name: 'VPD (kPa)',
          nameGap: 8,
          nameTextStyle: { color: '#22c55e' },
          position: 'right',
          offset: 50,
          axisLine: { lineStyle: { color: '#22c55e' } },
          axisLabel: { color: '#9ca3af' },
          splitLine: { show: false },
          min: 0,
          max: 3
        }
      ],
      dataZoom: [
        // Dropped entirely on touch: this is what eats the one-finger drag and stops the
        // page scrolling. The slider below stays, so zooming is still available.
        ...(coarsePointer ? [] : [{
          type: 'inside',
          start: zoomRef.current.start,
          end: zoomRef.current.end
        }]),
        {
          type: 'slider',
          start: zoomRef.current.start,
          end: zoomRef.current.end,
          height: 30,
          bottom: 10,
          borderColor: '#2d3a5c',
          backgroundColor: '#1a1a2e',
          fillerColor: 'rgba(34, 197, 94, 0.2)',
          handleStyle: { color: '#22c55e' },
          textStyle: { color: '#9ca3af' }
        }
      ],
      series
    }
  }, [historyData, coarsePointer, tempUnitLabel])

  // Chart for the focused entities. Numeric readings draw as lines; switches and
  // binary sensors draw as a 0/1 step so on/off runs are readable at a glance.
  const focusChartOptions = useMemo(() => {
    if (!focusData.length) return null

    const series = []
    const legend = []
    const hasNumeric = focusData.some(d => d.kind === 'numeric')
    const hasState = focusData.some(d => d.kind === 'state')

    focusData.forEach((entity, index) => {
      const color = FOCUS_COLORS[index % FOCUS_COLORS.length]
      const name = entity.friendly_name || entity.entity_id
      legend.push(name)

      if (entity.kind === 'numeric') {
        series.push({
          name,
          type: 'line',
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2, color },
          itemStyle: { color },
          yAxisIndex: 0,
          data: (entity.data || []).map(d => [new Date(d.timestamp).getTime(), d.value])
        })
      } else if (entity.kind === 'state') {
        const points = (entity.states || [])
          .filter(s => s.on !== null && s.on !== undefined)
          .map(s => [new Date(s.timestamp).getTime(), s.on ? 1 : 0])
        // Carry the last known state to the end of the window
        if (points.length) {
          points.push([new Date(entity.to).getTime(), points[points.length - 1][1]])
        }
        series.push({
          name,
          type: 'line',
          step: 'end',
          symbol: 'none',
          lineStyle: { width: 2, color },
          itemStyle: { color },
          areaStyle: { color, opacity: 0.15 },
          yAxisIndex: hasNumeric ? 1 : 0,
          data: points
        })
      }
    })

    const stateAxis = {
      type: 'value',
      name: 'On/Off',
      min: 0,
      max: 1,
      interval: 1,
      position: 'right',
      nameTextStyle: { color: '#9ca3af' },
      axisLine: { lineStyle: { color: '#2d3a5c' } },
      axisLabel: { color: '#9ca3af', formatter: v => (v === 1 ? 'On' : 'Off') },
      splitLine: { show: false }
    }
    const valueAxis = {
      type: 'value',
      name: focusData.find(d => d.kind === 'numeric')?.unit || '',
      nameTextStyle: { color: '#9ca3af' },
      axisLine: { lineStyle: { color: '#2d3a5c' } },
      axisLabel: { color: '#9ca3af' },
      splitLine: { lineStyle: { color: '#2d3a5c', opacity: 0.3 } },
      scale: true
    }

    const yAxis = hasNumeric ? (hasState ? [valueAxis, stateAxis] : [valueAxis]) : [stateAxis]

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#1a1a2e',
        borderColor: '#2d3a5c',
        textStyle: { color: '#fff' },
        formatter: (params) => {
          if (!params.length) return ''
          const time = format(new Date(params[0].value[0]), 'MMM d, HH:mm')
          let html = `<div style="font-weight:600;margin-bottom:4px">${time}</div>`
          params.forEach(pt => {
            const entity = focusData[pt.seriesIndex]
            const value = entity?.kind === 'state'
              ? (pt.value[1] === 1 ? 'On' : 'Off')
              : `${pt.value[1]}${entity?.unit ? ' ' + entity.unit : ''}`
            html += `<div style="display:flex;justify-content:space-between;gap:16px">
              <span style="color:${pt.color}">${pt.seriesName}</span>
              <span style="font-weight:600">${value}</span>
            </div>`
          })
          return html
        }
      },
      legend: { data: legend, textStyle: { color: '#9ca3af' }, top: 10, type: 'scroll' },
      grid: { left: 60, right: 70, top: 50, bottom: 80 },
      xAxis: {
        type: 'time',
        min: new Date(focusData[0].from).getTime(),
        max: new Date(focusData[0].to).getTime(),
        axisLine: { lineStyle: { color: '#2d3a5c' } },
        axisLabel: { color: '#9ca3af' },
        splitLine: { show: false }
      },
      yAxis,
      dataZoom: [
        ...(coarsePointer
          ? []
          : [{ type: 'inside', start: zoomRef.current.start, end: zoomRef.current.end }]),
        {
          type: 'slider',
          start: zoomRef.current.start,
          end: zoomRef.current.end,
          height: 30,
          bottom: 10,
          borderColor: '#2d3a5c',
          backgroundColor: '#1a1a2e',
          fillerColor: 'rgba(34, 197, 94, 0.2)',
          handleStyle: { color: '#22c55e' },
          textStyle: { color: '#9ca3af' }
        }
      ],
      series
    }
  }, [focusData, coarsePointer])

  // Export data
  const handleExport = async (format) => {
    if (!selectedTent) return
    const sensorParam = sensors.join(',')
    const url = `api/reports/export/${selectedTent}?format=${format}&sensors=${sensorParam}&range=${timeRange}`

    try {
      const res = await apiFetch(url)
      if (format === 'csv') {
        const text = await res.text()
        const blob = new Blob([text], { type: 'text/csv' })
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `${selectedTent}_${timeRange}.csv`
        a.click()
        URL.revokeObjectURL(a.href)
      } else {
        const data = await res.json()
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `${selectedTent}_${timeRange}.json`
        a.click()
        URL.revokeObjectURL(a.href)
      }
    } catch (err) {
      console.error('Export failed:', err)
    }
  }

  if (loading && !historyData) {
    return <div className="text-center text-gray-400 py-12">Loading...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold truncate">
            {focusKey
              ? (focusData[0]?.friendly_name || focusEntities[0])
              : 'Reports & History'}
          </h2>
          <p className="text-gray-400 truncate">
            {focusKey
              ? focusEntities.join(', ')
              : 'Analyze historical sensor data with interactive charts'}
          </p>
          {/* Says outright whether the chart is still moving. A graph that silently stopped
              updating looks exactly like a graph where nothing is happening. */}
          <p className="text-xs text-gray-500 mt-1 flex items-center gap-1.5">
            {isLiveRange ? (
              <>
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                <span>
                  HA history - refreshes every 30s
                  {lastUpdated
                    ? ` - updated ${lastUpdated.toLocaleTimeString()}`
                    : ' - waiting for first reading'}
                </span>
              </>
            ) : (
              <span>Fixed window - not updating</span>
            )}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          {focusKey ? (
            <button onClick={clearFocus} className="btn btn-sm">
              &larr; All tent sensors
            </button>
          ) : (
            <>
              <button onClick={() => handleExport('csv')} className="btn btn-sm">
                Export CSV
              </button>
              <button onClick={() => handleExport('json')} className="btn btn-sm">
                Export JSON
              </button>
            </>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="card">
        <div className="flex flex-wrap gap-4 items-end">
          {/* Tent selector */}
          <div className={focusKey ? 'hidden' : ''}>
            <label className="text-sm text-gray-400 block mb-1">Tent</label>
            <select
              value={selectedTent || ''}
              onChange={e => setSelectedTent(e.target.value)}
              className="input"
            >
              {tents.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          {/* Time range */}
          <div>
            <label className="text-sm text-gray-400 block mb-1">Time Range</label>
            <div className="flex gap-1">
              {TIME_RANGES.map(r => (
                <button
                  key={r.value}
                  onClick={() => { setTimeRange(r.value); setShowCustom(false) }}
                  className={`px-3 py-2 rounded text-sm ${
                    timeRange === r.value && !showCustom
                      ? 'bg-green-600 text-white'
                      : 'bg-[#1a1a2e] hover:bg-[#2d3a5c]'
                  }`}
                >
                  {r.label}
                </button>
              ))}
              <button
                onClick={() => setShowCustom(!showCustom)}
                className={`px-3 py-2 rounded text-sm ${
                  showCustom ? 'bg-green-600 text-white' : 'bg-[#1a1a2e] hover:bg-[#2d3a5c]'
                }`}
              >
                Custom
              </button>
            </div>
          </div>

          {/* Sensor toggles */}
          <div className={focusKey ? 'hidden' : ''}>
            <label className="text-sm text-gray-400 block mb-1">Sensors</label>
            <div className="flex gap-1">
              {Object.entries(SENSOR_CONFIG).map(([key, config]) => (
                <button
                  key={key}
                  onClick={() => toggleSensor(key)}
                  className={`px-3 py-2 rounded text-sm ${
                    sensors.includes(key)
                      ? 'text-white'
                      : 'bg-[#1a1a2e] text-gray-500'
                  }`}
                  style={{
                    backgroundColor: sensors.includes(key) ? config.color : undefined
                  }}
                >
                  {config.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {focusKey && comparisonOptions.length > 1 && (
          <div className="mt-4 pt-4 border-t border-[#2d3a5c]">
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <div>
                <div className="text-sm font-medium text-gray-200">Compare similar sensors</div>
                <div className="text-xs text-gray-500">Add comparable readings to the same graph.</div>
              </div>
              <div className="text-xs text-gray-500 shrink-0">
                {focusEntities.length} selected
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {comparisonOptions.map(option => {
                const selected = focusEntities.includes(option.entityId)
                const primary = option.entityId === primaryFocusEntity
                return (
                  <label
                    key={option.entityId}
                    className={`flex min-h-12 items-center gap-3 rounded-lg border px-3 py-2 transition-colors ${
                      selected
                        ? 'border-green-500/60 bg-green-500/10 text-white'
                        : 'border-[#2d3a5c] bg-[#1a1a2e] text-gray-300 hover:border-gray-500'
                    } ${primary ? 'cursor-default' : 'cursor-pointer'}`}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={primary}
                      onChange={() => toggleFocusEntity(option.entityId)}
                      className="h-4 w-4 accent-green-500"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{option.label}</span>
                      <span className="block truncate text-xs text-gray-500">{option.tentName}</span>
                    </span>
                    {primary && (
                      <span className="rounded bg-green-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-green-300">
                        Primary
                      </span>
                    )}
                  </label>
                )
              })}
            </div>
          </div>
        )}

        {/* Custom range inputs */}
        {showCustom && (
          <div className="flex gap-4 mt-4 pt-4 border-t border-[#2d3a5c]">
            <div>
              <label className="text-sm text-gray-400 block mb-1">From</label>
              <input
                type="datetime-local"
                value={customRange.from}
                onChange={e => setCustomRange(prev => ({ ...prev, from: e.target.value }))}
                className="input"
              />
            </div>
            <div>
              <label className="text-sm text-gray-400 block mb-1">To</label>
              <input
                type="datetime-local"
                value={customRange.to}
                onChange={e => setCustomRange(prev => ({ ...prev, to: e.target.value }))}
                className="input"
              />
            </div>
          </div>
        )}
      </div>

      {/* Focused entity statistics */}
      {focusKey && focusData.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {focusData.map(entity => (
            entity.kind === 'state' ? (
              <StateStatsCard
                key={entity.entity_id}
                label={entity.friendly_name || entity.entity_id}
                stats={entity.stats}
              />
            ) : (
              <StatsCard
                key={entity.entity_id}
                label={entity.friendly_name || entity.entity_id}
                stats={entity.stats}
                unit={entity.unit ? ` ${entity.unit}` : ''}
              />
            )
          ))}
        </div>
      )}

      {/* Statistics */}
      {!focusKey && historyData?.stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Object.entries(historyData.stats).map(([sensor, stats]) => {
            const config = SENSOR_CONFIG[sensor]
            return (
              <StatsCard
                key={sensor}
                label={config?.label || sensor}
                stats={stats}
                unit={config?.unit ?? getTempUnit()}
              />
            )
          })}
        </div>
      )}

      {/* Main Chart */}
      <div className="card">
        {focusKey ? (
          focusLoading ? (
            <div className="h-96 flex items-center justify-center text-gray-400">
              Loading chart data...
            </div>
          ) : focusChartOptions ? (
            <ReactECharts
              // Keyed on the selection, not the data. Changing what is charted remounts
              // for a clean slate; a live refresh keeps the same instance so the view does
              // not jump underneath whoever is reading it.
              key={`focus:${focusSelection}`}
              option={focusChartOptions}
              style={{ height: '500px', touchAction: 'pan-y' }}
              theme="dark"
              opts={{ renderer: 'canvas' }}
              onEvents={onChartEvents}
            />
          ) : (
            <div className="h-96 flex items-center justify-center text-gray-400 text-center px-4">
              Home Assistant has no recorded history for {focusEntities.join(', ')} in this range.
            </div>
          )
        ) : loading ? (
          <div className="h-96 flex items-center justify-center text-gray-400">
            Loading chart data...
          </div>
        ) : chartOptions ? (
          <ReactECharts
            key={`tent:${tentSelection}`}
            option={chartOptions}
            style={{ height: '500px', touchAction: 'pan-y' }}
            theme="dark"
            opts={{ renderer: 'canvas' }}
            onEvents={onChartEvents}
          />
        ) : (
          <div className="h-96 flex items-center justify-center text-gray-400">
            No data available for the selected time range
          </div>
        )}
      </div>

      {/* Data info */}
      {focusKey && focusData.length > 0 && (
        <div className="text-sm text-gray-500 text-center">
          Showing data from {format(new Date(focusData[0].from), 'MMM d, yyyy HH:mm')} to{' '}
          {format(new Date(focusData[0].to), 'MMM d, yyyy HH:mm')}
          {' '}&bull;{' '}
          {focusData.reduce((sum, e) => sum + (e.stats?.points || 0), 0)} data points
        </div>
      )}
      {!focusKey && historyData && (
        <div className="text-sm text-gray-500 text-center space-y-1">
          <div>
            Showing data from {format(new Date(historyData.from), 'MMM d, yyyy HH:mm')} to{' '}
            {format(new Date(historyData.to), 'MMM d, yyyy HH:mm')}
            {' '}&bull;{' '}
            {Object.values(historyData.data).reduce((sum, d) => sum + d.length, 0)} data points
          </div>
          {historyData.light_periods?.length > 0 && (
            <div className="flex items-center justify-center gap-2">
              <span className="inline-block w-4 h-3 bg-yellow-400/30 border border-yellow-400/50 rounded"></span>
              <span>Light On Periods ({historyData.light_periods.length})</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
