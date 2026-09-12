import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import ReactECharts from 'echarts-for-react'
import { graphic } from 'echarts'
import { apiFetch } from '../utils/api'
import { useTemperatureUnit } from '../hooks/useTemperatureUnit'

const METRICS = [
  { key: 'temperature', label: 'Temperature', color: '#fb923c' },
  { key: 'humidity', label: 'Humidity', color: '#60a5fa' },
  { key: 'co2', label: 'CO₂', color: '#c084fc' },
]
const RANGES = ['1h', '6h', '12h', '24h', '3d', '7d', '30d']
const COLORS = { on: '#4ade80', off: '#334155', unknown: '#a78bfa' }
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const clock = value => new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
const duration = seconds => seconds < 60 ? `${Math.round(seconds)}s` : seconds < 3600 ? `${Math.round(seconds / 60)}m` : `${(seconds / 3600).toFixed(1)}h`

export default function StandardTentReport() {
  const [params, setParams] = useSearchParams()
  const { unit, getTempUnit } = useTemperatureUnit()
  const [tents, setTents] = useState([])
  const [tentsLoaded, setTentsLoaded] = useState(false)
  const zoom = useRef({ start: 0, end: 100 })
  const [report, setReport] = useState(null)
  const [error, setError] = useState('')
  const [updated, setUpdated] = useState(null)
  const [retry, setRetry] = useState(0)
  const tent = params.get('tent') || tents[0]?.id || ''
  const range = RANGES.includes(params.get('range')) ? params.get('range') : '24h'
  const change = (key, value) => { const next = new URLSearchParams(params); next.set(key, value); setParams(next) }
  useEffect(() => {
    let cancelled = false
    apiFetch('api/tents').then(r => { if (!r.ok) throw Error(); return r.json() })
      .then(data => { if (!cancelled) { setTents(data.tents || []); setTentsLoaded(true) } })
      .catch(() => { if (!cancelled) setError('Could not load tents. Try again.') })
    return () => { cancelled = true }
  }, [retry])
  useEffect(() => {
    if (!tent) return
    let cancelled = false
    let busy = false
    setReport(null); setUpdated(null); setError(''); zoom.current = { start: 0, end: 100 }
    const load = async () => {
      if (busy) return
      busy = true
      try {
        const response = await apiFetch(`api/reports/standard/${encodeURIComponent(tent)}?range=${range}`)
        if (!response.ok) throw Error()
        const data = await response.json()
        if (!cancelled) { setReport(data); setError(''); setUpdated(new Date()) }
      } catch {
        if (!cancelled) setError('History could not refresh. Any chart shown is from the last successful update.')
      } finally { busy = false }
    }
    load()
    const timer = setInterval(() => { if (document.visibilityState === 'visible') load() }, 30000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [tent, range, retry])

  const rows = useMemo(() => {
    if (!report) return []
    const result = [...report.switches]
    for (const [kind, label] of [['light', 'Light'], ['exhaust_fan', 'Exhaust'], ['humidifier', 'Humidifier']]) {
      if (!result.some(r => r.kind === kind)) result.push({ kind, label, missing: true, intervals: [] })
    }
    return result.sort((a, b) => ['light', 'exhaust_fan', 'humidifier'].indexOf(a.kind) - ['light', 'exhaust_fan', 'humidifier'].indexOf(b.kind))
  }, [report])
  const height = 570 + rows.length * 66
  const option = useMemo(() => {
    if (!report) return null
    const from = Date.parse(report.from), to = Date.parse(report.to)
    const grids = [], axes = [], yAxes = [], series = [], titles = []
    const addGrid = (top, height, title, subtitle, numeric) => {
      const index = grids.length
      grids.push({ left: 58, right: 18, top, height })
      titles.push({ text: title, subtext: subtitle, left: 8, top: top - 42, textStyle: { fontSize: 13, color: '#e2e8f0' }, subtextStyle: { fontSize: 10, color: '#94a3b8' }, itemGap: 3 })
      axes.push({ type: 'time', gridIndex: index, min: from, max: to, axisLabel: { show: numeric, color: '#94a3b8', fontSize: 10, hideOverlap: true }, splitNumber: 4, axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false } })
      yAxes.push({ type: 'value', gridIndex: index, show: numeric, scale: true, min: numeric ? null : 0, max: numeric ? null : 1, splitNumber: 3, axisLabel: { color: '#94a3b8', fontSize: 10 }, splitLine: { lineStyle: { color: '#26344d' } } })
      return index
    }
    METRICS.forEach((metric, i) => {
      const items = report.series.filter(r => r.metric === metric.key)
      const metricUnit = metric.key === 'temperature' ? getTempUnit() : metric.key === 'humidity' ? '%' : 'ppm'
      const hasData = items.some(r => r.data.some(p => p.value != null))
      const axis = addGrid(50 + i * 160, 95, `${metric.label} · ${metricUnit}`, !items.length ? 'Not configured for this tent' : !hasData ? 'No recorded history in this range' : items.length > 1 ? `${items.length} sensors · hover to compare` : items[0].label, true)
      items.forEach((item, n) => series.push({
        name: item.label, type: 'line', xAxisIndex: axis, yAxisIndex: axis, symbol: 'none', connectNulls: false, sampling: 'lttb',
        lineStyle: { width: 2, type: n % 2 ? 'dashed' : 'solid' }, itemStyle: { color: metric.color },
        data: item.data.map(p => [Date.parse(p.timestamp), p.value == null ? null : metric.key === 'temperature' && unit === 'F' ? p.value * 1.8 + 32 : p.value]),
        tooltip: { valueFormatter: v => v == null ? 'Unknown' : `${Number(v).toFixed(1)} ${metricUnit}` },
      }))
    })
    rows.forEach((row, i) => {
      const subtitle = row.missing ? 'Not configured for this tent' : `${duration(row.on_seconds)} on${row.unknown_seconds ? ` · ${duration(row.unknown_seconds)} unknown` : ''} · ${row.name}`
      const axis = addGrid(534 + i * 66, 20, row.slot?.match(/_\d+$/) ? `${row.label} ${row.slot.match(/_(\d+)$/)[1]}` : row.label, subtitle, false)
      series.push({ name: row.label, type: 'custom', xAxisIndex: axis, yAxisIndex: axis,
        renderItem: (params, api) => {
          const left = api.coord([api.value(0), 0]), right = api.coord([api.value(1), 1])
          const shape = graphic.clipRectByRect({ x: left[0], y: right[1], width: Math.max(1, right[0] - left[0]), height: left[1] - right[1] }, params.coordSys)
          return shape && { type: 'rect', shape, style: { fill: COLORS[api.value(2)] } }
        },
        encode: { x: [0, 1], y: -1 },
        data: row.intervals.map(p => [Date.parse(p.start), Date.parse(p.end), p.state]),
        tooltip: { trigger: 'item', formatter: p => `<b>${escape(row.name)}: ${escape(p.value[2])}</b><br/>${clock(p.value[0])} – ${clock(p.value[1])}<br/>${duration((p.value[1]-p.value[0])/1000)}` },
      })
    })
    axes[axes.length - 1].axisLabel.show = true
    return { animation: false, backgroundColor: 'transparent', title: titles, grid: grids, xAxis: axes, yAxis: yAxes, series,
      tooltip: { trigger: 'axis', confine: true, backgroundColor: '#16213e', borderColor: '#334155', textStyle: { color: '#f1f5f9' } },
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      dataZoom: [{ ...zoom.current, type: 'slider', xAxisIndex: axes.map((_, i) => i), filterMode: 'none', bottom: 4, height: 22, borderColor: '#334155', textStyle: { color: '#94a3b8' } }],
    }
  }, [report, rows, unit])

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h2 className="text-xl font-bold">Tent report</h2><p className="text-sm text-gray-400">Climate and equipment on the same timeline.</p></div>
      <button className="btn btn-sm btn-secondary" onClick={() => change('view', 'custom')}>Custom report</button>
    </div>
    <div className="card space-y-3">
      <label className="flex items-center gap-3 text-sm">Tent
        <select className="input min-w-0 flex-1 sm:max-w-xs" aria-label="Tent" value={tent} onChange={e => change('tent', e.target.value)}>
          {tents.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      <div className="app-scroll-strip flex gap-2">{RANGES.map(r => <button key={r} aria-pressed={range === r} onClick={() => change('range', r)} className={`h-11 shrink-0 rounded-lg border px-4 text-sm ${range === r ? 'border-green-500 bg-green-600 text-white' : 'border-[#334155] text-gray-300'}`}>{r}</button>)}</div>
    </div>
    {error && <div role="alert" className="card text-sm text-amber-300">{error} <button className="underline" onClick={() => setRetry(v => v + 1)}>Retry</button></div>}
    {tentsLoaded && !tents.length && !error && <div className="card text-gray-400">No tents configured yet.</div>}
    {(!tentsLoaded || tents.length > 0) && !report && !error && <div role="status" className="card text-gray-400">Loading climate and switch history…</div>}
    {report && <div className="card !px-2 sm:!px-4">
      <div className="flex flex-wrap items-center justify-between gap-2 px-2 pb-3 text-xs text-gray-400">
        <span>{report.tent_name} · {clock(report.from)} to {clock(report.to)}</span>
        <span>{error ? 'Refresh paused' : 'Refreshes every 30s'} · Updated {updated?.toLocaleTimeString()}</span>
      </div>
      <div className="flex flex-wrap gap-4 px-2 pb-3 text-xs">{Object.entries(COLORS).map(([state, color]) => <span key={state} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />{state[0].toUpperCase() + state.slice(1)}</span>)}</div>
      <div role="img" aria-label="Temperature, humidity and CO2 charts followed by light, exhaust and humidifier state timelines. All charts share the same time range.">
        <ReactECharts key={`${tent}:${range}:${unit}`} option={option} notMerge onEvents={{ dataZoom: e => { const z = e.batch?.[0] || e; if (typeof z.start === 'number' && typeof z.end === 'number') zoom.current = { start: z.start, end: z.end } } }} theme="dark" style={{ height, touchAction: 'pan-y' }} opts={{ renderer: 'canvas' }} />
      </div>
      <p className="px-2 pt-2 text-xs text-gray-400">Drag the bottom handles to zoom all rows together. Switch colors show recorded states. Unknown includes missing history and unavailable devices.</p>
    </div>}
  </div>
}
