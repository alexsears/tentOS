import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { apiFetch } from '../utils/api'

// The deck outlives a page swap. Without this the arrows vanish for a moment on
// every flip, and the next click lands on nothing.
let cachedDeck = []

// One ordered deck of every report: each tent, then each metric across all tents.
// Both report pages read it, so the arrows keep going in one direction.
export function useReportDeck() {
  const [deck, setDeck] = useState(cachedDeck)
  useEffect(() => {
    let cancelled = false
    Promise.all([
      apiFetch('api/tents').then(r => r.json()),
      apiFetch('api/reports/metrics').then(r => r.json()),
    ]).then(([tentData, metricData]) => {
      if (cancelled) return
      const tents = (tentData.tents || []).map(t => ({ type: 'tent', key: t.id, label: t.name, group: 'Tents' }))
      const metrics = (metricData.metrics || []).map(m => ({
        type: 'metric', key: m.key, label: `${m.label}, all tents`, group: 'Metrics', count: m.tents.length,
      }))
      cachedDeck = [...tents, ...metrics]
      setDeck(cachedDeck)
    }).catch(() => { if (!cancelled) setDeck(cachedDeck) })
    return () => { cancelled = true }
  }, [])
  return deck
}

export default function ReportFlipper({ deck, current }) {
  const [params, setParams] = useSearchParams()
  const index = deck.findIndex(item => item.type === current.type && item.key === current.key)
  const go = item => {
    const next = new URLSearchParams(params)
    next.delete('entity'); next.delete('sensors')
    if (item.type === 'tent') { next.delete('view'); next.delete('metric'); next.set('tent', item.key) }
    else { next.set('view', 'metric'); next.set('metric', item.key) }
    setParams(next)
  }
  const step = delta => { if (deck.length) go(deck[(index + delta + deck.length) % deck.length]) }

  useEffect(() => {
    const onKey = event => {
      if (event.target?.closest?.('input, select, textarea')) return  // let a focused control keep its arrows
      if (event.altKey || event.metaKey || event.ctrlKey) return  // Alt/Cmd+Arrow is browser Back
      if (event.key === 'ArrowLeft') step(-1)
      if (event.key === 'ArrowRight') step(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // params belongs here: without it the handler keeps the URL from the render it
    // was bound on, and a flip would silently drop a range the reader had chosen.
  }, [deck, index, params])

  const groups = useMemo(() => {
    const out = []
    for (const item of deck) {
      if (!out.length || out[out.length - 1].label !== item.group) out.push({ label: item.group, items: [] })
      out[out.length - 1].items.push(item)
    }
    return out
  }, [deck])
  if (!deck.length) return null

  const button = 'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[#334155] text-gray-300 disabled:opacity-40'
  return (
    <div className="card flex items-center gap-2">
      <button className={button} aria-label="Previous report" disabled={index < 0} onClick={() => step(-1)}>
        <ChevronLeft size={18} />
      </button>
      <select className="input min-w-0 flex-1" aria-label="Report"
        value={`${current.type}:${current.key}`} onChange={e => {
          const [type, key] = e.target.value.split(/:(.*)/)
          go(deck.find(item => item.type === type && item.key === key))
        }}>
        {groups.map(group => (
          <optgroup key={group.label} label={group.label}>
            {group.items.map(item => (
              <option key={`${item.type}:${item.key}`} value={`${item.type}:${item.key}`}>
                {item.label}{item.count ? ` (${item.count})` : ''}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <span className="hidden shrink-0 text-xs text-gray-400 sm:block tabular-nums">
        {index < 0 ? '--' : index + 1} of {deck.length}
      </span>
      <button className={button} aria-label="Next report" disabled={index < 0} onClick={() => step(1)}>
        <ChevronRight size={18} />
      </button>
    </div>
  )
}
