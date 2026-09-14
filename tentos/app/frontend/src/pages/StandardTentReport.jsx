import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import ReactECharts from 'echarts-for-react'
import { apiFetch } from '../utils/api'
import { useTemperatureUnit } from '../hooks/useTemperatureUnit'
import ReportFlipper, { useReportDeck } from '../components/ReportFlipper'
import {
  RANGES, STATE_COLORS, clock, isFan, noHistory, slotLabel, stackedCanvas, switchLane, switchedLabel,
} from '../utils/reportChart'

const METRICS = [
  { key: 'temperature', label: 'Temperature', color: '#fb923c', unit: '°C' },
  { key: 'humidity', label: 'Humidity', color: '#60a5fa', unit: '%' },
  { key: 'vpd', label: 'Leaf VPD', color: '#4ade80', unit: 'kPa' },
  { key: 'co2', label: 'CO₂', color: '#c084fc', unit: 'ppm' },
]
const EQUIPMENT_ORDER = ['light', 'exhaust_fan', 'circulation_fan', 'intake_fan', 'fan', 'humidifier', 'water_pump']
const CLIMATE_HEIGHT = 50 + METRICS.length * 160

export default function StandardTentReport() {
  const [params, setParams] = useSearchParams()
  const { unit, getTempUnit } = useTemperatureUnit()
  const deck = useReportDeck()
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
    return result.sort((a, b) => EQUIPMENT_ORDER.indexOf(a.kind) - EQUIPMENT_ORDER.indexOf(b.kind))
  }, [report])
  const height = CLIMATE_HEIGHT + 20 + rows.length * 66
  const option = useMemo(() => {
    if (!report) return null
    const from = Date.parse(report.from), to = Date.parse(report.to)
    const canvas = stackedCanvas(from, to)
    METRICS.forEach((metric, i) => {
      const items = report.series.filter(r => r.metric === metric.key)
      const metricUnit = metric.key === 'temperature' ? getTempUnit() : metric.unit
      const hasData = items.some(r => r.data.some(p => p.value != null))
      const subtitle = !items.length ? 'Not configured for this tent'
        : !hasData ? 'No recorded history in this range'
        : metric.key === 'vpd' ? 'Calculated from the temperature and humidity above'
        : items.length > 1 ? `${items.map(i => i.label).join(' · ')}` : items[0].label
      const axis = canvas.addGrid(50 + i * 160, 95, `${metric.label} · ${metricUnit}`, subtitle, true)
      items.forEach((item, n) => canvas.series.push({
        name: item.label, type: 'line', xAxisIndex: axis, yAxisIndex: axis, symbol: 'none', connectNulls: false, sampling: 'lttb',
        lineStyle: { width: 2, type: n % 2 ? 'dashed' : 'solid' }, itemStyle: { color: metric.color },
        data: item.data.map(p => [Date.parse(p.timestamp), p.value == null ? null : metric.key === 'temperature' && unit === 'F' ? p.value * 1.8 + 32 : p.value]),
        tooltip: { valueFormatter: v => v == null ? 'Unknown' : `${Number(v).toFixed(metric.key === 'vpd' ? 2 : 1)} ${metricUnit}` },
      }))
    })
    rows.forEach((row, i) => {
      const activity = noHistory(row, report.from, report.to) ? 'Unknown history'
        : `${row.changes} times switched${row.unknown_seconds ? ' · Partial history' : ''}`
      // Name the device, not just the role. Two lanes both called Light are only
      // telling you which is which once they say Lab1a and Lab Diablo.
      const subtitle = row.missing ? 'Not configured for this tent' : `${row.name} · ${activity}`
      const axis = canvas.addGrid(CLIMATE_HEIGHT + 4 + i * 66, 20, slotLabel(row), subtitle, false)
      canvas.series.push(switchLane(row, axis, slotLabel(row)))
    })
    return canvas.finish(zoom.current)
  }, [report, rows, unit])

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h2 className="text-xl font-bold">Tent report</h2><p className="text-sm text-gray-400">Climate and equipment on the same timeline.</p></div>
      <button className="btn btn-sm btn-secondary" onClick={() => change('view', 'custom')}>Custom report</button>
    </div>
    <ReportFlipper deck={deck} current={{ type: 'tent', key: tent }} />
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
    {report && rows.some(row => isFan(row) && !row.missing) && <div className="card">
      <h3 className="mb-2 font-semibold">Fan activity</h3>
      <table className="w-full text-sm tabular-nums">
        <thead className="text-xs text-gray-400"><tr><th scope="col" className="py-2 text-left">Fan</th><th scope="col" className="text-right">Times switched</th></tr></thead>
        <tbody>{rows.filter(row => isFan(row) && !row.missing).map(row => <tr key={row.slot} className="border-t border-[#334155]">
          <th scope="row" className="py-2 pr-3 text-left font-normal">{slotLabel(row)}
            <span className="block text-xs text-gray-400" title={row.entity_id}>{row.name}</span>
            {row.unknown_seconds > 0 && <span className="block text-xs text-purple-300">Partial history</span>}</th>
          <td className="text-right">{switchedLabel(row, report.from, report.to)}</td>
        </tr>)}</tbody>
      </table>
      <p className="mt-2 text-xs text-gray-400">Each on or off transition counts once within the selected time range. The initial state and transitions across unknown history are excluded.</p>
    </div>}
    {report && <div className="card !px-2 sm:!px-4">
      <div className="flex flex-wrap items-center justify-between gap-2 px-2 pb-3 text-xs text-gray-400">
        <span>{report.tent_name} · {clock(report.from)} to {clock(report.to)}</span>
        <span>{error ? 'Refresh paused' : 'Refreshes every 30s'} · Updated {updated?.toLocaleTimeString()}</span>
      </div>
      <div className="flex flex-wrap gap-4 px-2 pb-3 text-xs">{Object.entries(STATE_COLORS).map(([state, color]) => <span key={state} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />{state[0].toUpperCase() + state.slice(1)}</span>)}</div>
      <div role="img" aria-label="Temperature, humidity, leaf VPD and CO2 charts followed by light, fan, humidifier and water pump state timelines. All charts share the same time range.">
        <ReactECharts key={`${tent}:${range}:${unit}`} option={option} notMerge onEvents={{ dataZoom: e => { const z = e.batch?.[0] || e; if (typeof z.start === 'number' && typeof z.end === 'number') zoom.current = { start: z.start, end: z.end } } }} theme="dark" style={{ height, touchAction: 'pan-y' }} opts={{ renderer: 'canvas' }} />
      </div>
      <p className="px-2 pt-2 text-xs text-gray-400">Drag the bottom handles to zoom all rows together. Switch colors show recorded states. Unknown includes missing history and unavailable devices.</p>
    </div>}
  </div>
}
