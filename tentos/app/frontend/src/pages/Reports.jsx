import { useState, useEffect, useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import { apiFetch } from '../utils/api'
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
  temperature: { label: 'Temperature', unit: '°C', color: '#ef4444', yAxisIndex: 0 },
  humidity: { label: 'Humidity', unit: '%', color: '#3b82f6', yAxisIndex: 1 },
  vpd: { label: 'VPD', unit: 'kPa', color: '#22c55e', yAxisIndex: 2 },
  co2: { label: 'CO2', unit: 'ppm', color: '#a855f7', yAxisIndex: 0 }
}

function StatsCard({ label, stats, unit }) {
  if (!stats) return null
  return (
    <div className="bg-[#1a1a2e] rounded-lg p-3">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="grid grid-cols-4 gap-2 text-sm">
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
  const [tents, setTents] = useState([])
  const [selectedTent, setSelectedTent] = useState(null)
  const [timeRange, setTimeRange] = useState('24h')
  const [sensors, setSensors] = useState(['temperature', 'humidity', 'vpd'])
  const [historyData, setHistoryData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [customRange, setCustomRange] = useState({ from: '', to: '' })
  const [showCustom, setShowCustom] = useState(false)

  // Load tents
  useEffect(() => {
    apiFetch('api/tents')
      .then(r => r.json())
      .then(data => {
        setTents(data.tents || [])
        if (data.tents?.length > 0) {
          setSelectedTent(data.tents[0].id)
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  // Load history when tent or range changes
  useEffect(() => {
    if (!selectedTent) return

    setLoading(true)
    const sensorParam = sensors.join(',')
    let url = `/api/reports/history/${selectedTent}?sensors=${sensorParam}&range=${timeRange}`

    if (showCustom && customRange.from && customRange.to) {
      url = `/api/reports/history/${selectedTent}?sensors=${sensorParam}&from_time=${customRange.from}&to_time=${customRange.to}`
    }

    fetch(url)
      .then(r => r.json())
      .then(setHistoryData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [selectedTent, timeRange, sensors, showCustom, customRange])

  // Toggle sensor visibility
  const toggleSensor = (sensor) => {
    setSensors(prev =>
      prev.includes(sensor)
        ? prev.filter(s => s !== sensor)
        : [...prev, sensor]
    )
  }

  // Build ECharts options
  const chartOptions = useMemo(() => {
    if (!historyData?.data) return null

    const series = []
    const legend = []

    Object.entries(historyData.data).forEach(([sensor, data]) => {
      if (!data || data.length === 0) return
      const config = SENSOR_CONFIG[sensor] || { label: sensor, color: '#888', yAxisIndex: 0 }

      legend.push(config.label)

      // Main line
      series.push({
        name: config.label,
        type: 'line',
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 2, color: config.color },
        itemStyle: { color: config.color },
        data: data.map(d => [new Date(d.timestamp).getTime(), d.value]),
        yAxisIndex: sensor === 'humidity' ? 1 : 0
      })

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
              <span style="font-weight:600">${p.value[1].toFixed(1)}${config?.unit || ''}</span>
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
        right: 60,
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
          name: 'Temp / VPD',
          nameTextStyle: { color: '#9ca3af' },
          axisLine: { lineStyle: { color: '#2d3a5c' } },
          axisLabel: { color: '#9ca3af' },
          splitLine: { lineStyle: { color: '#2d3a5c', opacity: 0.3 } }
        },
        {
          type: 'value',
          name: 'Humidity %',
          nameTextStyle: { color: '#9ca3af' },
          axisLine: { lineStyle: { color: '#2d3a5c' } },
          axisLabel: { color: '#9ca3af' },
          splitLine: { show: false },
          min: 0,
          max: 100
        }
      ],
      dataZoom: [
        {
          type: 'inside',
          start: 0,
          end: 100
        },
        {
          type: 'slider',
          start: 0,
          end: 100,
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
  }, [historyData])

  // Export data
  const handleExport = async (format) => {
    if (!selectedTent) return
    const sensorParam = sensors.join(',')
    const url = `/api/reports/export/${selectedTent}?format=${format}&sensors=${sensorParam}&range=${timeRange}`

    if (format === 'csv') {
      window.open(url, '_blank')
    } else {
      const res = await fetch(url)
      const data = await res.json()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${selectedTent}_${timeRange}.json`
      a.click()
    }
  }

  if (loading && !historyData) {
    return <div className="text-center text-gray-400 py-12">Loading...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Reports & History</h2>
          <p className="text-gray-400">Analyze historical sensor data with interactive charts</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => handleExport('csv')} className="btn btn-sm">
            Export CSV
          </button>
          <button onClick={() => handleExport('json')} className="btn btn-sm">
            Export JSON
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="card">
        <div className="flex flex-wrap gap-4 items-end">
          {/* Tent selector */}
          <div>
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
          <div>
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

      {/* Statistics */}
      {historyData?.stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Object.entries(historyData.stats).map(([sensor, stats]) => {
            const config = SENSOR_CONFIG[sensor]
            return (
              <StatsCard
                key={sensor}
                label={config?.label || sensor}
                stats={stats}
                unit={config?.unit || ''}
              />
            )
          })}
        </div>
      )}

      {/* Main Chart */}
      <div className="card">
        {loading ? (
          <div className="h-96 flex items-center justify-center text-gray-400">
            Loading chart data...
          </div>
        ) : chartOptions ? (
          <ReactECharts
            option={chartOptions}
            style={{ height: '500px' }}
            theme="dark"
            opts={{ renderer: 'canvas' }}
          />
        ) : (
          <div className="h-96 flex items-center justify-center text-gray-400">
            No data available for the selected time range
          </div>
        )}
      </div>

      {/* Data info */}
      {historyData && (
        <div className="text-sm text-gray-500 text-center">
          Showing data from {format(new Date(historyData.from), 'MMM d, yyyy HH:mm')} to{' '}
          {format(new Date(historyData.to), 'MMM d, yyyy HH:mm')}
          {' '}&bull;{' '}
          {Object.values(historyData.data).reduce((sum, d) => sum + d.length, 0)} data points
        </div>
      )}
    </div>
  )
}
