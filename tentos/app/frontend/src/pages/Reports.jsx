import { useState, useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import ReactECharts from 'echarts-for-react'
import { apiFetch } from '../utils/api'
import { useTemperatureUnit } from '../hooks/useTemperatureUnit'
import { similarSensorOptions } from '../utils/sensorComparison'
import { format } from 'date-fns'
import { ArrowLeft, Download } from 'lucide-react'
import { LightShadeToggle } from '../components/LightShadeToggle'
import { useShadeLights, lightMarkAreas } from '../utils/lightShading'

const TIME_RANGES = [
  { value: '1h', label: '1h' },
  { value: '6h', label: '6h' },
  { value: '12h', label: '12h' },
  { value: '24h', label: '24h' },
  { value: '3d', label: '3d' },
  { value: '7d', label: '7d' },
  { value: '14d', label: '14d' },
  { value: '30d', label: '30d' },
]

// Chips share one shape so the range row and the sensor row read as one control set.
// 44px tall keeps them a real touch target on a phone.
const CHIP_BASE = 'h-11 shrink-0 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors'
const CHIP_IDLE = 'bg-[#1a1a2e] border border-[#2d3a5c] text-gray-300 hover:border-gray-500'
const CHIP_ON = 'bg-green-600 border border-green-600 text-white'

const SENSOR_CONFIG = {
  temperature: { label: 'Temperature', unit: null, color: '#ef4444', yAxisIndex: 0 },
  humidity: { label: 'Humidity', unit: '%', color: '#3b82f6', yAxisIndex: 1 },
  vpd: { label: 'VPD', unit: 'kPa', color: '#22c55e', yAxisIndex: 2 },
  co2: { label: 'CO2', unit: 'ppm', color: '#a855f7', yAxisIndex: 0 }
}

const FOCUS_COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#a855f7', '#14b8a6']

// One line per entity: name, then the few numbers that matter. The row scrolls
// sideways rather than wrapping so a phone never gets a ragged stack of values.
function Stat({ label, value, accent }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="text-xs text-gray-500">{label}</span>
      <span className={`font-medium ${accent ? 'text-green-400' : 'text-gray-100'}`}>{value}</span>
    </span>
  )
}

function StatsRowShell({ label, color, children }) {
  return (
    <div className="app-scroll-strip flex min-h-11 items-center gap-3 py-1 text-sm tabular-nums">
      <span className="flex min-w-[5.5rem] shrink-0 items-center gap-2 font-medium text-gray-200">
        {color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />}
        <span className="truncate">{label}</span>
      </span>
      <span className="flex shrink-0 items-center gap-3 whitespace-nowrap">{children}</span>
    </div>
  )
}

function StateStatsRow({ label, stats, color }) {
  if (!stats) return null
  return (
    <StatsRowShell label={label} color={color}>
      <Stat label="On" value={stats.on_percent != null ? `${stats.on_percent}%` : '--'} />
      <Stat label="Hours" value={stats.on_hours != null ? stats.on_hours : '--'} />
      <Stat label="Now" value={stats.current ?? '--'} accent />
    </StatsRowShell>
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

function StatsRow({ label, stats, unit, color }) {
  if (!stats) return null
  return (
    <StatsRowShell label={label} color={color}>
      <Stat label="Min" value={`${stats.min}${unit}`} />
      <Stat label="Max" value={`${stats.max}${unit}`} />
      <Stat label="Avg" value={`${stats.avg}${unit}`} />
      <Stat label="Now" value={`${stats.current}${unit}`} accent />
    </StatsRowShell>
  )
}

export default function Reports() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { unit: tempUnit, getTempUnit } = useTemperatureUnit()
  // Shade the plot while the tent light was on. Shared with every other chart and
  // remembered between visits.
  const [shadeLights] = useShadeLights()
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
  // Phone-only export menu. On wider screens both formats sit inline instead.
  const [exportOpen, setExportOpen] = useState(false)
  const exportMenuRef = useRef(null)

  useEffect(() => {
    if (!exportOpen) return undefined
    const onClickOutside = (e) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target)) setExportOpen(false)
    }
    const onEscape = (e) => { if (e.key === 'Escape') setExportOpen(false) }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onEscape)
    }
  }, [exportOpen])

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

  // Below the sm breakpoint the three axis titles and the legend fight for one strip and
  // 160px of side margins leave almost no plot. Drop the titles there: the axis colours
  // still say which scale is which and the legend carries the names.
  const narrowChart = useMemo(
    () => (typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(max-width: 639px)').matches
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

    // Lights-on bands behind the lines. Always present on the first series, empty when
    // the option is off, so a merged setOption clears the old bands instead of keeping them.
    const lightBands = shadeLights ? lightMarkAreas(historyData.light_periods) : []

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

      if (index === 0) {
        seriesConfig.markArea = { silent: true, data: lightBands }
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
      grid: narrowChart
        ? { left: 40, right: 72, top: 40, bottom: 80 }
        : { left: 60, right: 100, top: 50, bottom: 80 },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: '#2d3a5c' } },
        axisLabel: { color: '#9ca3af' },
        splitLine: { show: false }
      },
      yAxis: [
        {
          type: 'value',
          name: narrowChart ? '' : `Temp (${tempUnitLabel})`,
          nameTextStyle: { color: '#ef4444' },
          axisLine: { lineStyle: { color: '#ef4444' } },
          axisLabel: { color: '#9ca3af' },
          splitLine: { lineStyle: { color: '#2d3a5c', opacity: 0.3 } }
        },
        {
          type: 'value',
          name: narrowChart ? '' : 'Humidity %',
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
          name: narrowChart ? '' : 'VPD (kPa)',
          nameGap: 8,
          nameTextStyle: { color: '#22c55e' },
          position: 'right',
          offset: narrowChart ? 36 : 50,
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
  }, [historyData, coarsePointer, narrowChart, tempUnitLabel, shadeLights])

  // Chart for the focused entities. Numeric readings draw as lines; switches and
  // binary sensors draw as a 0/1 step so on/off runs are readable at a glance.
  const focusChartOptions = useMemo(() => {
    if (!focusData.length) return null

    const series = []
    const legend = []
    const hasNumeric = focusData.some(d => d.kind === 'numeric')
    const hasState = focusData.some(d => d.kind === 'state')
    // The lights of whichever tent the first entity belongs to
    const lightBands = shadeLights ? lightMarkAreas(focusData[0].light_periods) : []

    focusData.forEach((entity, index) => {
      const color = FOCUS_COLORS[index % FOCUS_COLORS.length]
      const name = entity.friendly_name || entity.entity_id
      legend.push(name)
      const markArea = index === 0 ? { silent: true, data: lightBands } : undefined

      if (entity.kind === 'numeric') {
        series.push({
          name,
          type: 'line',
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2, color },
          itemStyle: { color },
          yAxisIndex: 0,
          markArea,
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
          markArea,
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
      grid: narrowChart
        ? { left: 44, right: 56, top: 40, bottom: 80 }
        : { left: 60, right: 70, top: 50, bottom: 80 },
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
  }, [focusData, coarsePointer, narrowChart, shadeLights])

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

  const exportAs = (fmt) => {
    setExportOpen(false)
    handleExport(fmt)
  }

  const rangeChips = (
    <>
      {TIME_RANGES.map(r => (
        <button
          key={r.value}
          type="button"
          onClick={() => { setTimeRange(r.value); setShowCustom(false) }}
          className={`${CHIP_BASE} ${timeRange === r.value && !showCustom ? CHIP_ON : CHIP_IDLE}`}
        >
          {r.label}
        </button>
      ))}
      <button
        type="button"
        onClick={() => setShowCustom(!showCustom)}
        className={`${CHIP_BASE} ${showCustom ? CHIP_ON : CHIP_IDLE}`}
      >
        Custom
      </button>
    </>
  )

  const showTentStats = !focusKey && historyData?.stats && Object.keys(historyData.stats).length > 0
  const showFocusStats = focusKey && focusEntities.length === 1 && focusData.some(e => e.stats)
  const pointCount = focusKey
    ? focusData.reduce((sum, e) => sum + (e.stats?.points || 0), 0)
    : historyData ? Object.values(historyData.data || {}).reduce((sum, d) => sum + d.length, 0) : 0
  const dataWindow = focusKey ? focusData[0] : historyData
  // The option only earns a place beside the chart when the subject has a light to shade by
  const hasLight = (dataWindow?.light_entities?.length || 0) > 0

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Header: one line, actions on the right */}
      <div className="flex items-center justify-between gap-3">
        <h2 className="min-w-0 truncate text-lg font-bold sm:text-xl">
          {focusKey ? (focusData[0]?.friendly_name || focusEntities[0]) : 'Reports'}
        </h2>
        <div className="flex shrink-0 items-center gap-2">
          {focusKey ? (
            <button
              type="button"
              onClick={clearFocus}
              className="flex h-11 items-center gap-1.5 rounded-lg border border-[#2d3a5c] bg-[#16213e] px-3 text-sm text-gray-200 hover:border-gray-500 sm:h-9"
            >
              <ArrowLeft size={16} />
              <span>All sensors</span>
            </button>
          ) : (
            <>
              {/* Phone: one icon button with a small menu */}
              <div className="relative sm:hidden" ref={exportMenuRef}>
                <button
                  type="button"
                  onClick={() => setExportOpen(o => !o)}
                  aria-label="Export"
                  aria-haspopup="menu"
                  aria-expanded={exportOpen}
                  className="flex h-11 w-11 items-center justify-center rounded-lg border border-[#2d3a5c] bg-[#16213e] text-gray-200 hover:border-gray-500"
                >
                  <Download size={18} />
                </button>
                {exportOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 z-20 mt-1 w-40 overflow-hidden rounded-lg border border-[#2d3a5c] bg-[#16213e] shadow-lg"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => exportAs('csv')}
                      className="flex h-11 w-full items-center px-3 text-sm text-gray-200 hover:bg-[#2d3a5c]"
                    >
                      Export CSV
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => exportAs('json')}
                      className="flex h-11 w-full items-center px-3 text-sm text-gray-200 hover:bg-[#2d3a5c]"
                    >
                      Export JSON
                    </button>
                  </div>
                )}
              </div>
              {/* sm and up: inline small buttons */}
              <div className="hidden items-center gap-2 sm:flex">
                <button type="button" onClick={() => handleExport('csv')} className="btn btn-sm btn-secondary flex items-center gap-1.5">
                  <Download size={14} />
                  <span>CSV</span>
                </button>
                <button type="button" onClick={() => handleExport('json')} className="btn btn-sm btn-secondary flex items-center gap-1.5">
                  <Download size={14} />
                  <span>JSON</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="card space-y-2">
        <div className="app-scroll-strip flex items-center gap-2">
          {!focusKey && (
            <select
              value={selectedTent || ''}
              onChange={e => setSelectedTent(e.target.value)}
              aria-label="Tent"
              className="input h-11 max-w-[11rem] shrink-0 py-0 text-sm"
            >
              {tents.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          )}
          {rangeChips}
        </div>

        {!focusKey && (
          <div className="app-scroll-strip flex items-center gap-2">
            {Object.entries(SENSOR_CONFIG).map(([key, config]) => {
              const on = sensors.includes(key)
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleSensor(key)}
                  aria-pressed={on}
                  className={`${CHIP_BASE} ${on ? 'border text-white' : CHIP_IDLE}`}
                  style={on ? { backgroundColor: config.color, borderColor: config.color } : undefined}
                >
                  {config.label}
                </button>
              )
            })}
          </div>
        )}

        {showCustom && (
          <div className="flex flex-wrap items-center gap-2 border-t border-[#2d3a5c] pt-2">
            <label className="flex min-w-0 flex-1 items-center gap-2 text-xs text-gray-400">
              <span className="shrink-0">From</span>
              <input
                type="datetime-local"
                value={customRange.from}
                onChange={e => setCustomRange(prev => ({ ...prev, from: e.target.value }))}
                className="input h-11 min-w-0 flex-1 py-0 text-sm"
              />
            </label>
            <label className="flex min-w-0 flex-1 items-center gap-2 text-xs text-gray-400">
              <span className="shrink-0">To</span>
              <input
                type="datetime-local"
                value={customRange.to}
                onChange={e => setCustomRange(prev => ({ ...prev, to: e.target.value }))}
                className="input h-11 min-w-0 flex-1 py-0 text-sm"
              />
            </label>
          </div>
        )}

        {focusKey && comparisonOptions.length > 1 && (
          <div className="app-scroll-strip flex items-center gap-2">
            <span className="shrink-0 text-xs text-gray-500">Compare</span>
            {comparisonOptions.map(option => {
              const selected = focusEntities.includes(option.entityId)
              const primary = option.entityId === primaryFocusEntity
              return (
                <button
                  key={option.entityId}
                  type="button"
                  disabled={primary}
                  aria-pressed={selected}
                  onClick={() => toggleFocusEntity(option.entityId)}
                  className={`${CHIP_BASE} flex items-center gap-1.5 ${selected ? CHIP_ON : CHIP_IDLE} ${primary ? 'cursor-default' : ''}`}
                >
                  <span>{option.label}</span>
                  <span className={`text-[11px] font-normal ${selected ? 'text-green-100/80' : 'text-gray-500'}`}>{option.tentName}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Chart, first thing below the controls */}
      <div className="card">
        {hasLight && (
          <div className="mb-1 flex items-center justify-end">
            <LightShadeToggle periods={dataWindow?.light_periods} />
          </div>
        )}
        <div className="h-[360px] sm:h-[500px]">
          {focusKey ? (
            focusLoading ? (
              <div className="flex h-full items-center justify-center text-gray-400">
                Loading chart data...
              </div>
            ) : focusChartOptions ? (
              <ReactECharts
                // Keyed on the selection, not the data. Changing what is charted remounts
                // for a clean slate; a live refresh keeps the same instance so the view does
                // not jump underneath whoever is reading it.
                key={`focus:${focusSelection}`}
                option={focusChartOptions}
                style={{ height: '100%', touchAction: 'pan-y' }}
                theme="dark"
                opts={{ renderer: 'canvas' }}
                onEvents={onChartEvents}
              />
            ) : (
              <div className="flex h-full items-center justify-center px-4 text-center text-gray-400">
                Home Assistant has no recorded history for {focusEntities.join(', ')} in this range.
              </div>
            )
          ) : loading ? (
            <div className="flex h-full items-center justify-center text-gray-400">
              Loading chart data...
            </div>
          ) : chartOptions ? (
            <ReactECharts
              key={`tent:${tentSelection}`}
              option={chartOptions}
              style={{ height: '100%', touchAction: 'pan-y' }}
              theme="dark"
              opts={{ renderer: 'canvas' }}
              onEvents={onChartEvents}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-gray-400">
              No data available for the selected time range
            </div>
          )}
        </div>

        {/* Says outright whether the chart is still moving. A graph that silently stopped
            updating looks exactly like a graph where nothing is happening. */}
        <div className="mt-2 space-y-0.5 text-xs text-gray-500">
          <p className="flex flex-wrap items-center gap-x-1.5">
            {isLiveRange ? (
              <>
                <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-green-500" />
                <span>
                  Home Assistant history, 30s refresh.
                  {lastUpdated ? ` Updated ${format(lastUpdated, 'h:mm a')}` : ' Waiting for first reading'}
                </span>
              </>
            ) : (
              <span>Fixed window, not updating.</span>
            )}
          </p>
          {dataWindow?.from && dataWindow?.to && (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span>
                {format(new Date(dataWindow.from), 'MMM d, HH:mm')} to {format(new Date(dataWindow.to), 'MMM d, HH:mm')},
                {' '}{pointCount.toLocaleString()} points
              </span>
            </p>
          )}
        </div>
      </div>

      {/* Statistics: one compact row per sensor */}
      {/* Keep the detail text useful for a single reading, but let the chart and
          legend carry comparisons instead of adding another stats block per sensor. */}
      {showFocusStats && (
        <div className="card divide-y divide-[#2d3a5c] py-1">
          {focusData.map((entity, index) => (
            entity.kind === 'state' ? (
              <StateStatsRow
                key={entity.entity_id}
                label={entity.friendly_name || entity.entity_id}
                stats={entity.stats}
                color={FOCUS_COLORS[index % FOCUS_COLORS.length]}
              />
            ) : (
              <StatsRow
                key={entity.entity_id}
                label={entity.friendly_name || entity.entity_id}
                stats={entity.stats}
                unit={entity.unit ? ` ${entity.unit}` : ''}
                color={FOCUS_COLORS[index % FOCUS_COLORS.length]}
              />
            )
          ))}
        </div>
      )}

      {showTentStats && (
        <div className="card divide-y divide-[#2d3a5c] py-1">
          {Object.entries(historyData.stats).map(([sensor, stats]) => {
            const config = SENSOR_CONFIG[sensor]
            return (
              <StatsRow
                key={sensor}
                label={config?.label || sensor}
                stats={stats}
                unit={config?.unit ?? getTempUnit()}
                color={config?.color}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
