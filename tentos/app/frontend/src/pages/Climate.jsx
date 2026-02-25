import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import ReactECharts from 'echarts-for-react'
import { format } from 'date-fns'
import { useTents } from '../hooks/useTents'
import { useTemperatureUnit } from '../hooks/useTemperatureUnit'
import { apiFetch } from '../utils/api'

// VPD targets mirrored from backend state_manager.py:125-142
const VPD_TARGETS = {
  veg: { min: 0.8, max: 1.0, label: 'Vegetative' },
  flower: {
    1:  { min: 0.8, max: 1.0, phase: 'Transition', color: '#22c55e' },
    2:  { min: 0.8, max: 1.0, phase: 'Transition', color: '#22c55e' },
    3:  { min: 1.0, max: 1.2, phase: 'Stretch', color: '#eab308' },
    4:  { min: 1.0, max: 1.2, phase: 'Stretch', color: '#eab308' },
    5:  { min: 1.0, max: 1.2, phase: 'Stretch', color: '#eab308' },
    6:  { min: 1.0, max: 1.2, phase: 'Stretch', color: '#eab308' },
    7:  { min: 1.2, max: 1.5, phase: 'Bulk/Ripen', color: '#f97316' },
    8:  { min: 1.2, max: 1.5, phase: 'Bulk/Ripen', color: '#f97316' },
    9:  { min: 1.2, max: 1.5, phase: 'Bulk/Ripen', color: '#f97316' },
    10: { min: 1.2, max: 1.5, phase: 'Bulk/Ripen', color: '#f97316' },
    11: { min: 1.0, max: 1.2, phase: 'Flush', color: '#3b82f6' },
    12: { min: 1.0, max: 1.2, phase: 'Flush', color: '#3b82f6' },
  },
}

const TIME_RANGES = [
  { value: '6h', label: '6H' },
  { value: '12h', label: '12H' },
  { value: '24h', label: '24H' },
  { value: '3d', label: '3D' },
  { value: '7d', label: '7D' },
]

function getVpdTarget(stage, flowerWeek) {
  if (stage === 'flower' && flowerWeek) {
    return VPD_TARGETS.flower[Math.min(12, Math.max(1, flowerWeek))] || VPD_TARGETS.veg
  }
  return VPD_TARGETS.veg
}

function getVpdStatus(vpd, target) {
  if (vpd == null || !target) return { label: 'No Data', color: 'text-gray-500' }
  if (vpd < target.min) return { label: 'Below Target', color: 'text-blue-400' }
  if (vpd > target.max) return { label: 'Above Target', color: 'text-red-400' }
  return { label: 'In Range', color: 'text-green-400' }
}

// --- Sub-components ---

function TentSelector({ tents, selectedId, onSelect }) {
  if (tents.length <= 1) return null
  return (
    <div className="flex gap-1">
      {tents.map(t => (
        <button
          key={t.id}
          onClick={() => onSelect(t.id)}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            selectedId === t.id
              ? 'bg-green-600 text-white'
              : 'bg-[#1a1a2e] text-gray-400 hover:bg-[#2d3a5c]'
          }`}
        >
          {t.name}
        </button>
      ))}
    </div>
  )
}

function CurrentVpdReading({ vpd, temp, humidity, target, formatTemp }) {
  const status = getVpdStatus(vpd, target)
  const inRange = vpd != null && vpd >= target.min && vpd <= target.max

  return (
    <div className="card">
      <div className="flex items-center gap-6 flex-wrap">
        {/* Big VPD number */}
        <div className="text-center">
          <div className={`text-5xl font-bold tabular-nums ${inRange ? 'text-green-400' : vpd != null ? 'text-red-400' : 'text-gray-500'}`}>
            {vpd != null ? Number(vpd).toFixed(2) : '--'}
          </div>
          <div className="text-xs text-gray-500 mt-1">VPD (kPa)</div>
        </div>

        {/* Status + target range */}
        <div className="flex-1 min-w-0">
          <div className={`text-lg font-semibold ${status.color}`}>{status.label}</div>
          <div className="text-sm text-gray-400">
            Target: {target.min} - {target.max} kPa
            {target.phase && <span className="ml-2 text-gray-500">({target.phase})</span>}
          </div>
        </div>

        {/* Temp + Humidity */}
        <div className="flex gap-4">
          <div className="text-center">
            <div className="text-2xl font-bold">{temp != null ? formatTemp(temp) : '--'}</div>
            <div className="text-xs text-gray-500">Temp</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold">{humidity != null ? Number(humidity).toFixed(0) + '%' : '--'}</div>
            <div className="text-xs text-gray-500">Humidity</div>
          </div>
        </div>
      </div>
    </div>
  )
}

function FlowerWeekTimeline({ stage, flowerWeek }) {
  if (stage !== 'flower') {
    // Veg: simple bar
    return (
      <div className="card py-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-green-400">Vegetative</span>
          <div className="flex-1 h-3 rounded-full bg-green-600/30 overflow-hidden">
            <div className="h-full bg-green-500 rounded-full" style={{ width: '100%' }} />
          </div>
          <span className="text-xs text-gray-500">VPD 0.8-1.0</span>
        </div>
      </div>
    )
  }

  const weeks = Array.from({ length: 12 }, (_, i) => i + 1)
  const currentWeek = flowerWeek || 1

  const getWeekColor = (wk) => {
    if (wk <= 2) return 'bg-green-600'
    if (wk <= 6) return 'bg-yellow-600'
    if (wk <= 10) return 'bg-orange-600'
    return 'bg-blue-600'
  }

  const getPhaseLabel = (wk) => {
    if (wk <= 2) return 'Transition'
    if (wk <= 6) return 'Stretch'
    if (wk <= 10) return 'Bulk/Ripen'
    return 'Flush'
  }

  return (
    <div className="card py-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm font-medium text-pink-400">Flower Week {currentWeek}</span>
        <span className="text-xs text-gray-500">{getPhaseLabel(currentWeek)}</span>
      </div>
      <div className="flex gap-0.5">
        {weeks.map(wk => {
          const isCurrent = wk === currentWeek
          return (
            <div
              key={wk}
              className={`flex-1 relative ${isCurrent ? 'z-10' : ''}`}
              title={`Week ${wk} - ${getPhaseLabel(wk)}`}
            >
              <div
                className={`h-4 rounded-sm ${getWeekColor(wk)} ${
                  wk <= currentWeek ? 'opacity-100' : 'opacity-30'
                } ${isCurrent ? 'ring-2 ring-white ring-offset-1 ring-offset-[#0d1117] scale-y-125' : ''}`}
              />
              <div className={`text-center text-[9px] mt-0.5 ${isCurrent ? 'text-white font-bold' : 'text-gray-600'}`}>
                {wk}
              </div>
            </div>
          )
        })}
      </div>
      {/* Phase legend */}
      <div className="flex gap-3 mt-2 text-[10px] text-gray-500">
        <span><span className="inline-block w-2 h-2 rounded-sm bg-green-600 mr-1" />Transition 1-2</span>
        <span><span className="inline-block w-2 h-2 rounded-sm bg-yellow-600 mr-1" />Stretch 3-6</span>
        <span><span className="inline-block w-2 h-2 rounded-sm bg-orange-600 mr-1" />Bulk 7-10</span>
        <span><span className="inline-block w-2 h-2 rounded-sm bg-blue-600 mr-1" />Flush 11-12</span>
      </div>
    </div>
  )
}

function VpdChart({ historyData, target, lightPeriods }) {
  const chartOptions = useMemo(() => {
    if (!historyData?.length) return null

    const data = historyData.map(d => [new Date(d.timestamp).getTime(), d.value])

    // Light period overlays
    const lightMarkAreas = (lightPeriods || []).map(period => ([
      {
        xAxis: new Date(period.start).getTime(),
        itemStyle: { color: 'rgba(250, 204, 21, 0.08)' }
      },
      { xAxis: new Date(period.end).getTime() }
    ]))

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
          const val = params[0].value[1]
          const inRange = val >= target.min && val <= target.max
          const color = inRange ? '#22c55e' : '#ef4444'
          return `<div style="font-weight:600;margin-bottom:4px">${time}</div>
            <div style="display:flex;justify-content:space-between;gap:16px">
              <span style="color:${color}">VPD</span>
              <span style="font-weight:600;color:${color}">${val.toFixed(2)} kPa</span>
            </div>
            <div style="font-size:11px;color:#9ca3af;margin-top:2px">Target: ${target.min}-${target.max}</div>`
        }
      },
      grid: {
        left: 50,
        right: 20,
        top: 20,
        bottom: 70
      },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: '#2d3a5c' } },
        axisLabel: { color: '#9ca3af' },
        splitLine: { show: false }
      },
      yAxis: {
        type: 'value',
        name: 'VPD (kPa)',
        nameTextStyle: { color: '#9ca3af', fontSize: 11 },
        axisLine: { lineStyle: { color: '#2d3a5c' } },
        axisLabel: { color: '#9ca3af' },
        splitLine: { lineStyle: { color: '#2d3a5c', opacity: 0.3 } },
        min: 0,
        max: (value) => Math.max(2.0, Math.ceil(value.max * 10) / 10 + 0.2)
      },
      dataZoom: [
        { type: 'inside', start: 0, end: 100 },
        {
          type: 'slider',
          start: 0,
          end: 100,
          height: 25,
          bottom: 8,
          borderColor: '#2d3a5c',
          backgroundColor: '#1a1a2e',
          fillerColor: 'rgba(34, 197, 94, 0.2)',
          handleStyle: { color: '#22c55e' },
          textStyle: { color: '#9ca3af' }
        }
      ],
      visualMap: {
        show: false,
        pieces: [
          { lt: target.min, color: '#ef4444' },
          { gte: target.min, lte: target.max, color: '#22c55e' },
          { gt: target.max, color: '#ef4444' },
        ],
        seriesIndex: 0,
      },
      series: [
        {
          name: 'VPD',
          type: 'line',
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2 },
          data,
          markArea: {
            silent: true,
            data: [
              // Target zone band
              [
                {
                  yAxis: target.min,
                  itemStyle: { color: 'rgba(34, 197, 94, 0.1)' }
                },
                { yAxis: target.max }
              ],
              // Light periods
              ...lightMarkAreas,
            ]
          },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { type: 'dashed', width: 1 },
            data: [
              {
                yAxis: target.min,
                lineStyle: { color: 'rgba(34, 197, 94, 0.5)' },
                label: { show: true, formatter: target.min.toFixed(1), color: '#22c55e', fontSize: 10, position: 'insideEndTop' }
              },
              {
                yAxis: target.max,
                lineStyle: { color: 'rgba(34, 197, 94, 0.5)' },
                label: { show: true, formatter: target.max.toFixed(1), color: '#22c55e', fontSize: 10, position: 'insideEndTop' }
              },
            ]
          }
        }
      ]
    }
  }, [historyData, target])

  if (!chartOptions) {
    return (
      <div className="card h-[400px] flex items-center justify-center text-gray-500">
        No VPD history data available
      </div>
    )
  }

  return (
    <div className="card p-2">
      <ReactECharts
        option={chartOptions}
        style={{ height: '400px' }}
        theme="dark"
        opts={{ renderer: 'canvas' }}
      />
    </div>
  )
}

function StatsFooter({ stats }) {
  if (!stats) return null
  return (
    <div className="grid grid-cols-4 gap-3">
      {[
        { label: 'Min', value: stats.min, color: 'text-blue-400' },
        { label: 'Max', value: stats.max, color: 'text-red-400' },
        { label: 'Avg', value: stats.avg, color: 'text-gray-300' },
        { label: 'Current', value: stats.current, color: 'text-green-400' },
      ].map(s => (
        <div key={s.label} className="bg-[#1a1a2e] rounded-lg p-3 text-center">
          <div className={`text-lg font-bold tabular-nums ${s.color}`}>
            {s.value != null ? Number(s.value).toFixed(2) : '--'}
          </div>
          <div className="text-xs text-gray-500">{s.label}</div>
        </div>
      ))}
    </div>
  )
}

// --- Main Component ---

export default function Climate() {
  const { tents, loading: tentsLoading, connected } = useTents()
  const { formatTemp } = useTemperatureUnit()
  const [selectedTentId, setSelectedTentId] = useState(null)
  const [timeRange, setTimeRange] = useState('24h')
  const [historyData, setHistoryData] = useState(null)
  const [loading, setLoading] = useState(false)
  const refreshTimer = useRef(null)

  // Auto-select first tent
  useEffect(() => {
    if (tents.length > 0 && !selectedTentId) {
      setSelectedTentId(tents[0].id)
    }
  }, [tents, selectedTentId])

  const selectedTent = tents.find(t => t.id === selectedTentId)
  const stage = selectedTent?.growth_stage || {}
  const vpdTarget = getVpdTarget(stage.stage, stage.flower_week)

  // Fetch VPD history
  const fetchHistory = useCallback(async () => {
    if (!selectedTentId) return
    setLoading(true)
    try {
      const res = await apiFetch(`api/reports/history/${selectedTentId}?sensors=vpd&range=${timeRange}`)
      const data = await res.json()
      setHistoryData(data)
    } catch (err) {
      console.error('Failed to load VPD history:', err)
    } finally {
      setLoading(false)
    }
  }, [selectedTentId, timeRange])

  useEffect(() => {
    fetchHistory()
  }, [fetchHistory])

  // Re-fetch every 5 minutes
  useEffect(() => {
    refreshTimer.current = setInterval(fetchHistory, 5 * 60 * 1000)
    return () => clearInterval(refreshTimer.current)
  }, [fetchHistory])

  // Append live WS VPD points to history data
  useEffect(() => {
    if (!selectedTent?.vpd || !historyData?.data?.vpd) return
    const now = Date.now()
    const lastPoint = historyData.data.vpd[historyData.data.vpd.length - 1]
    const lastTime = lastPoint ? new Date(lastPoint.timestamp).getTime() : 0
    // Only append if at least 30s since last point
    if (now - lastTime < 30000) return
    setHistoryData(prev => {
      if (!prev?.data?.vpd) return prev
      return {
        ...prev,
        data: {
          ...prev.data,
          vpd: [...prev.data.vpd, { timestamp: new Date().toISOString(), value: selectedTent.vpd }]
        },
        stats: prev.stats ? {
          ...prev.stats,
          vpd: prev.stats.vpd ? { ...prev.stats.vpd, current: selectedTent.vpd } : undefined
        } : undefined
      }
    })
  }, [selectedTent?.vpd])

  if (tentsLoading) {
    return <div className="flex items-center justify-center h-64 text-gray-400">Loading...</div>
  }

  if (tents.length === 0) {
    return (
      <div className="card text-center py-12">
        <div className="text-4xl mb-4">{'\u{1F331}'}</div>
        <h3 className="text-xl font-semibold mb-2">No Tents Configured</h3>
        <p className="text-gray-400 mb-4">Set up a tent in Settings first.</p>
        <a href="#/settings" className="btn btn-primary">Go to Settings</a>
      </div>
    )
  }

  const vpdHistory = historyData?.data?.vpd || []
  const vpdStats = historyData?.stats?.vpd || null
  const lightPeriods = historyData?.light_periods || []

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold">Climate</h2>
          {!connected && <span className="text-xs text-red-400">Disconnected</span>}
        </div>
        <TentSelector tents={tents} selectedId={selectedTentId} onSelect={setSelectedTentId} />
      </div>

      {/* Current VPD Reading */}
      <CurrentVpdReading
        vpd={selectedTent?.vpd}
        temp={selectedTent?.avg_temperature}
        humidity={selectedTent?.avg_humidity}
        target={vpdTarget}
        formatTemp={formatTemp}
      />

      {/* Flower Week Timeline */}
      <FlowerWeekTimeline stage={stage.stage || 'veg'} flowerWeek={stage.flower_week} />

      {/* Time range selector */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-500">Range:</span>
        <div className="flex gap-1">
          {TIME_RANGES.map(r => (
            <button
              key={r.value}
              onClick={() => setTimeRange(r.value)}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                timeRange === r.value
                  ? 'bg-green-600 text-white'
                  : 'bg-[#1a1a2e] text-gray-400 hover:bg-[#2d3a5c]'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        {loading && <span className="text-xs text-gray-500 ml-2">Loading...</span>}
      </div>

      {/* VPD Chart */}
      <VpdChart historyData={vpdHistory} target={vpdTarget} lightPeriods={lightPeriods} />

      {/* Stats Footer */}
      <StatsFooter stats={vpdStats} />
    </div>
  )
}
