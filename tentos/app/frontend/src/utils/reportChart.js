import { graphic } from 'echarts'

export const RANGES = ['1h', '6h', '12h', '24h', '3d', '7d', '30d']
export const STATE_COLORS = { on: '#4ade80', off: '#334155', unknown: '#a78bfa' }
// One color per tent, reused on every metric report so a tent keeps its color.
export const TENT_COLORS = ['#4ade80', '#60a5fa', '#fb923c', '#c084fc', '#f472b6', '#22d3ee', '#facc15']

export const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
export const clock = value => new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
export const duration = seconds => seconds < 60 ? `${Math.round(seconds)}s` : seconds < 3600 ? `${Math.round(seconds / 60)}m` : `${(seconds / 3600).toFixed(1)}h`

// Stacked single-column grids sharing one time axis. Every report is built from
// these, so a numeric lane and a switch lane always line up on the same instant.
export function stackedCanvas(from, to) {
  const grids = [], axes = [], yAxes = [], series = [], titles = []
  const addGrid = (top, height, title, subtitle, numeric) => {
    const index = grids.length
    grids.push({ left: 58, right: 18, top, height })
    titles.push({ text: title, subtext: subtitle, left: 8, top: top - 42, textStyle: { fontSize: 13, color: '#e2e8f0' }, subtextStyle: { fontSize: 10, color: '#94a3b8' }, itemGap: 3 })
    axes.push({ type: 'time', gridIndex: index, min: from, max: to, axisLabel: { show: numeric, color: '#94a3b8', fontSize: 10, hideOverlap: true }, splitNumber: 4, axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false } })
    yAxes.push({ type: 'value', gridIndex: index, show: numeric, scale: true, min: numeric ? null : 0, max: numeric ? null : 1, splitNumber: 3, axisLabel: { color: '#94a3b8', fontSize: 10 }, splitLine: { lineStyle: { color: '#26344d' } } })
    return index
  }
  const finish = zoom => {
    if (axes.length) axes[axes.length - 1].axisLabel.show = true
    return {
      animation: false, backgroundColor: 'transparent', title: titles, grid: grids, xAxis: axes, yAxis: yAxes, series,
      tooltip: { trigger: 'axis', confine: true, backgroundColor: '#16213e', borderColor: '#334155', textStyle: { color: '#f1f5f9' } },
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      dataZoom: [{ ...zoom, type: 'slider', xAxisIndex: axes.map((_, i) => i), filterMode: 'none', bottom: 4, height: 22, borderColor: '#334155', textStyle: { color: '#94a3b8' } }],
    }
  }
  return { grids, axes, yAxes, series, titles, addGrid, finish }
}

// A switch lane draws recorded state as colored spans, never an interpolated line.
export function switchLane(row, axis, label) {
  return {
    name: label, type: 'custom', xAxisIndex: axis, yAxisIndex: axis,
    renderItem: (params, api) => {
      const left = api.coord([api.value(0), 0]), right = api.coord([api.value(1), 1])
      const shape = graphic.clipRectByRect({ x: left[0], y: right[1], width: Math.max(1, right[0] - left[0]), height: left[1] - right[1] }, params.coordSys)
      return shape && { type: 'rect', shape, style: { fill: STATE_COLORS[api.value(2)] } }
    },
    encode: { x: [0, 1], y: -1 },
    data: row.intervals.map(p => [Date.parse(p.start), Date.parse(p.end), p.state]),
    tooltip: { trigger: 'item', formatter: p => `<b>${escapeHtml(label)}: ${escapeHtml(p.value[2])}</b><br/>${clock(p.value[0])} – ${clock(p.value[1])}<br/>${duration((p.value[1] - p.value[0]) / 1000)}` },
  }
}

export const isFan = row => row.kind === 'fan' || row.kind.endsWith('_fan')
export const slotLabel = row => row.slot?.match(/_\d+$/) ? `${row.label} ${row.slot.match(/_(\d+)$/)[1]}` : row.label
// A lane whose whole window is unknown has no recorded history at all.
export const noHistory = (row, from, to) => row.unknown_seconds >= (Date.parse(to) - Date.parse(from)) / 1000
export const switchedLabel = (row, from, to) => noHistory(row, from, to) ? 'Unknown' : row.changes
