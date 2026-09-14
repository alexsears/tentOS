import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import ReactECharts from 'echarts-for-react'
import { apiFetch } from '../utils/api'
import { useTemperatureUnit } from '../hooks/useTemperatureUnit'
import ReportFlipper, { useReportDeck } from '../components/ReportFlipper'
import {
  RANGES, STATE_COLORS, TENT_COLORS, clock, duration, noHistory, slotLabel, stackedCanvas, switchLane, switchedLabel,
} from '../utils/reportChart'

const LANE_TOP = 50
const LANE_STEP = 66

// One metric, every tent that has it. Numeric metrics share a single chart so the
// tents can be read against each other; switches get a lane each, same time axis.
export default function MetricReport() {
  const [params, setParams] = useSearchParams()
  const { unit, getTempUnit } = useTemperatureUnit()
  const deck = useReportDeck()
  const zoom = useRef({ start: 0, end: 100 })
  const [report, setReport] = useState(null)
  const [error, setError] = useState('')
  const [updated, setUpdated] = useState(null)
  const [retry, setRetry] = useState(0)
  const metric = params.get('metric') || 'temperature'
  const range = RANGES.includes(params.get('range')) ? params.get('range') : '24h'
  const change = (key, value) => { const next = new URLSearchParams(params); next.set(key, value); setParams(next) }
  const isTemp = metric === 'temperature'

  useEffect(() => {
    let cancelled = false
    let busy = false
    setReport(null); setUpdated(null); setError(''); zoom.current = { start: 0, end: 100 }
    const load = async () => {
      if (busy) return
      busy = true
      try {
        const response = await apiFetch(`api/reports/metric/${encodeURIComponent(metric)}?range=${range}`)
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
  }, [metric, range, retry])

  const reportUnit = report ? (isTemp ? getTempUnit() : report.unit) : ''
  const toDisplay = value => value == null ? null : isTemp && unit === 'F' ? value * 1.8 + 32 : value
  const decimals = metric === 'vpd' ? 2 : metric === 'co2' ? 0 : 1
  const show = value => value == null ? '--' : Number(toDisplay(value)).toFixed(decimals)

  // Numeric readings: tent name plus the sensor, so two probes in one tent stay apart.
  const lines = useMemo(() => {
    if (!report || report.kind !== 'numeric') return []
    return report.tents.flatMap((entry, tentIndex) => entry.series.map((item, n) => ({
      // A tent with one probe is just the tent; a second probe has to name itself.
      ...item, tentIndex, tentName: entry.tent_name,
      sensor: entry.series.length > 1 ? item.label : null,
      name: entry.series.length > 1 ? `${entry.tent_name} · ${item.label}` : entry.tent_name,
      dashed: n % 2 === 1,
    })))
  }, [report])
  const lanes = useMemo(() => {
    if (!report || report.kind !== 'switch') return []
    return report.tents.flatMap((entry, tentIndex) => entry.switches.map(item => ({
      // Always name the switch, not just the tent, so every row of the table reads the same.
      ...item, tentIndex, tentName: entry.tent_name, name: `${entry.tent_name} · ${slotLabel(item)}`,
    })))
  }, [report])

  const height = report?.kind === 'switch' ? LANE_TOP + 20 + Math.max(1, lanes.length) * LANE_STEP : 400
  const option = useMemo(() => {
    if (!report) return null
    const from = Date.parse(report.from), to = Date.parse(report.to)
    const canvas = stackedCanvas(from, to)
    if (report.kind === 'numeric') {
      const hasData = lines.some(line => line.data.some(p => p.value != null))
      const axis = canvas.addGrid(LANE_TOP, 280, `${report.label} · ${reportUnit}`,
        hasData ? `${report.tents.length} tents · hover to compare` : 'No recorded history in this range', true)
      lines.forEach(line => canvas.series.push({
        name: line.name, type: 'line', xAxisIndex: axis, yAxisIndex: axis, symbol: 'none', connectNulls: false, sampling: 'lttb',
        lineStyle: { width: 2, type: line.dashed ? 'dashed' : 'solid' },
        itemStyle: { color: TENT_COLORS[line.tentIndex % TENT_COLORS.length] },
        data: line.data.map(p => [Date.parse(p.timestamp), toDisplay(p.value)]),
        tooltip: { valueFormatter: v => v == null ? 'Unknown' : `${Number(v).toFixed(decimals)} ${reportUnit}` },
      }))
    } else {
      lanes.forEach((lane, i) => {
        const subtitle = noHistory(lane, report.from, report.to) ? 'Unknown history'
          : `${lane.changes} times switched · ${duration(lane.on_seconds)} on${lane.unknown_seconds ? ' · Partial history' : ''}`
        const axis = canvas.addGrid(LANE_TOP + i * LANE_STEP, 20, lane.name, subtitle, false)
        canvas.series.push(switchLane(lane, axis, lane.name))
      })
    }
    return canvas.finish(zoom.current)
  }, [report, lines, lanes, unit])

  const legend = report?.kind === 'numeric'
    ? report.tents.map((entry, i) => ({ label: entry.tent_name, color: TENT_COLORS[i % TENT_COLORS.length] }))
    : Object.entries(STATE_COLORS).map(([state, color]) => ({ label: state[0].toUpperCase() + state.slice(1), color }))

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 className="text-xl font-bold">{report?.label || 'Metric'} across tents</h2>
        <p className="text-sm text-gray-400">One measurement, every tent that has it.</p>
      </div>
      <button className="btn btn-sm btn-secondary" onClick={() => change('view', 'custom')}>Custom report</button>
    </div>
    <ReportFlipper deck={deck} current={{ type: 'metric', key: metric }} />
    <div className="card">
      <div className="app-scroll-strip flex gap-2">{RANGES.map(r => <button key={r} aria-pressed={range === r} onClick={() => change('range', r)} className={`h-11 shrink-0 rounded-lg border px-4 text-sm ${range === r ? 'border-green-500 bg-green-600 text-white' : 'border-[#334155] text-gray-300'}`}>{r}</button>)}</div>
    </div>
    {error && <div role="alert" className="card text-sm text-amber-300">{error} <button className="underline" onClick={() => setRetry(v => v + 1)}>Retry</button></div>}
    {!report && !error && <div role="status" className="card text-gray-400">Loading history for every tent…</div>}
    {report && !report.tents.length && <div className="card text-gray-400">No tent is configured for {report.label.toLowerCase()}.</div>}

    {report?.kind === 'numeric' && !!lines.length && <div className="card">
      <h3 className="mb-2 font-semibold">{report.label} by tent</h3>
      <div className="app-scroll-strip">
        <table className="w-full min-w-[19rem] text-sm tabular-nums">
          <thead className="text-xs text-gray-400"><tr>
            <th scope="col" className="py-2 text-left">Tent</th>
            <th scope="col" className="text-right">Min</th><th scope="col" className="text-right">Max</th>
            <th scope="col" className="text-right">Avg</th><th scope="col" className="text-right">Now</th>
          </tr></thead>
          <tbody>{lines.map(line => <tr key={`${line.tentIndex}:${line.entity_id}`} className="border-t border-[#334155]">
            <th scope="row" className="py-2 pr-3 text-left font-normal">
              <span className="mr-2 inline-block h-2 w-2 rounded-full align-middle" style={{ background: TENT_COLORS[line.tentIndex % TENT_COLORS.length] }} />
              {line.tentName}
              {line.sensor && <span className="block max-w-[9rem] truncate pl-4 text-xs text-gray-400 sm:max-w-none">{line.sensor}</span>}
            </th>
            <td className="text-right">{show(line.stats?.min)}</td>
            <td className="text-right">{show(line.stats?.max)}</td>
            <td className="text-right">{show(line.stats?.avg)}</td>
            <td className="text-right text-green-400">{show(line.stats?.last)}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-400">Values in {reportUnit} over the selected time range. Now is the last recorded reading.</p>
    </div>}

    {report?.kind === 'switch' && !!lanes.length && <div className="card">
      <h3 className="mb-2 font-semibold">{report.label} by tent</h3>
      <div className="app-scroll-strip">
        <table className="w-full min-w-[19rem] text-sm tabular-nums">
          <thead className="text-xs text-gray-400"><tr>
            <th scope="col" className="py-2 text-left">Switch</th>
            <th scope="col" className="text-right">Times switched</th>
            <th scope="col" className="text-right">Starts</th>
            <th scope="col" className="text-right">Time on</th>
          </tr></thead>
          <tbody>{lanes.map(lane => <tr key={`${lane.tentIndex}:${lane.entity_id}`} className="border-t border-[#334155]">
            <th scope="row" className="py-2 pr-3 text-left font-normal">{lane.tentName}
              <span className="block text-xs text-gray-400">{slotLabel(lane)}</span>
              {lane.unknown_seconds > 0 && <span className="block text-xs text-purple-300">Partial history</span>}</th>
            <td className="text-right">{switchedLabel(lane, report.from, report.to)}</td>
            <td className="text-right">{noHistory(lane, report.from, report.to) ? 'Unknown' : lane.starts}</td>
            <td className="text-right">{noHistory(lane, report.from, report.to) ? 'Unknown' : duration(lane.on_seconds)}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-400">Each recorded on or off transition counts once. Starts count only confirmed off-to-on changes. The initial state and transitions across unknown history are excluded.</p>
    </div>}

    {report && !!report.tents.length && <div className="card !px-2 sm:!px-4">
      <div className="flex flex-wrap items-center justify-between gap-2 px-2 pb-3 text-xs text-gray-400">
        <span>{clock(report.from)} to {clock(report.to)}</span>
        <span>{error ? 'Refresh paused' : 'Refreshes every 30s'} · Updated {updated?.toLocaleTimeString()}</span>
      </div>
      <div className="flex flex-wrap gap-4 px-2 pb-3 text-xs">{legend.map(item => <span key={item.label} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: item.color }} />{item.label}</span>)}</div>
      <div role="img" aria-label={`${report.label} for every configured tent on one shared time range.`}>
        <ReactECharts key={`${metric}:${range}:${unit}`} option={option} notMerge onEvents={{ dataZoom: e => { const z = e.batch?.[0] || e; if (typeof z.start === 'number' && typeof z.end === 'number') zoom.current = { start: z.start, end: z.end } } }} theme="dark" style={{ height, touchAction: 'pan-y' }} opts={{ renderer: 'canvas' }} />
      </div>
      <p className="px-2 pt-2 text-xs text-gray-400">Drag the bottom handles to zoom every tent together. Left and right arrow keys flip to the next report.</p>
    </div>}
  </div>
}
