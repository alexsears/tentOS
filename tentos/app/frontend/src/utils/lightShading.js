/**
 * Lights-on shading for every history chart.
 *
 * One preference, shared by the Reports, Climate and tent detail charts and kept in
 * localStorage so it sticks between visits. Default on: the photoperiod is the single
 * most useful context for reading a temperature or humidity trace in a grow tent.
 */
import { useSyncExternalStore } from 'react'

const STORAGE_KEY = 'tentos.charts.shadeLights'

// Warm and faint: the lines stay the subject, the band only says "lights were on".
export const LIGHT_BAND_FILL = '#facc15'
export const LIGHT_BAND_OPACITY = 0.12
export const LIGHT_BAND_COLOR = 'rgba(250, 204, 21, 0.12)'

function readStored() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw === null ? true : raw === '1'
  } catch {
    return true
  }
}

let current = typeof window !== 'undefined' ? readStored() : true
const listeners = new Set()

function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return current
}

export function setShadeLights(on) {
  current = Boolean(on)
  try {
    window.localStorage.setItem(STORAGE_KEY, current ? '1' : '0')
  } catch {
    // Private mode or blocked storage: the choice still applies for this page view
  }
  listeners.forEach(listener => listener())
}

/** [shadeLights, setShadeLights], synchronised across every chart on the page. */
export function useShadeLights() {
  const on = useSyncExternalStore(subscribe, getSnapshot, () => true)
  return [on, setShadeLights]
}

/** ECharts markArea data for a list of {start, end} ISO periods. */
export function lightMarkAreas(periods, color = LIGHT_BAND_COLOR) {
  return (periods || []).map(period => ([
    { xAxis: new Date(period.start).getTime(), itemStyle: { color } },
    { xAxis: new Date(period.end).getTime() }
  ]))
}

/** Total hours the lights were on across the periods. */
export function lightOnHours(periods) {
  return (periods || []).reduce((sum, period) => {
    const ms = new Date(period.end).getTime() - new Date(period.start).getTime()
    return sum + (Number.isFinite(ms) && ms > 0 ? ms / 3600000 : 0)
  }, 0)
}

/** "Lights on 12h" style summary, or null when there is nothing to say. */
export function lightSummary(periods) {
  if (!periods?.length) return null
  const hours = lightOnHours(periods)
  const rounded = hours >= 10 ? Math.round(hours) : Math.round(hours * 10) / 10
  return `Lights on ${rounded}h`
}
