import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../utils/api'

/**
 * The alert count in the header used to be plain text: you could see that
 * something was wrong and had no way to find out what, and live alerts carry no
 * database id so nothing could dismiss them either. It is now a button that
 * lists the open alerts, links each one to its tent, and can mute one for a
 * while. A mute lapses on its own, and clears early if the condition resolves.
 */
export function AlertsMenu({ summary, onChanged }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(false)
  const [busyKey, setBusyKey] = useState(null)
  const ref = useRef(null)

  const load = () => {
    setLoading(true)
    apiFetch('api/alerts?active_only=true')
      .then(r => r.json())
      .then(data => setAlerts(data.alerts || []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (open) load()
  }, [open, summary?.total])

  useEffect(() => {
    if (!open) return undefined
    const onClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    const onEscape = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onEscape)
    }
  }, [open])

  const mute = async (alert) => {
    if (!alert.key) return
    setBusyKey(alert.key)
    try {
      await apiFetch('api/alerts/mute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: alert.key, hours: 8 }),
      })
      setAlerts(prev => prev.filter(a => a.key !== alert.key))
      if (onChanged) onChanged()
    } catch (e) {
      console.error(e)
    } finally {
      setBusyKey(null)
    }
  }

  const openTent = (alert) => {
    setOpen(false)
    if (alert.tent_id) navigate(`/tent/${alert.tent_id}`)
  }

  if (!summary?.total) return null

  const mostSevereLabel = summary.critical > 0 ? 'Critical' : 'Warning'

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 min-h-9"
        title={`Show ${summary.total} active ${summary.total === 1 ? 'alert' : 'alerts'}`}
        aria-label={`Show ${summary.total} active ${summary.total === 1 ? 'alert' : 'alerts'}`}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <span className="sm:hidden">
          <span className={`badge ${summary.critical > 0 ? 'badge-danger' : 'badge-warning'}`}>
            <span aria-hidden="true">⚠</span>
            {summary.total}
            <span className="sr-only">{mostSevereLabel}</span>
          </span>
        </span>
        <span className="hidden sm:flex items-center gap-2">
          {summary.critical > 0 && (
            <span className="badge badge-danger">{summary.critical} Critical</span>
          )}
          {summary.warning > 0 && (
            <span className="badge badge-warning">{summary.warning} Warning</span>
          )}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-1.5rem)] max-h-96 overflow-y-auto bg-[#16213e] border border-[#2d3a5c] rounded-lg shadow-xl z-50">
          <div className="px-4 py-2 border-b border-[#2d3a5c] text-sm font-semibold">
            Active alerts
          </div>

          {loading && <div className="px-4 py-3 text-sm text-gray-400">Loading...</div>}

          {!loading && alerts.length === 0 && (
            <div className="px-4 py-3 text-sm text-gray-400">Nothing active right now.</div>
          )}

          {alerts.map((alert, i) => (
            <div key={alert.key || alert.id || i} className="px-4 py-3 border-b border-[#2d3a5c] last:border-b-0">
              <div className="flex items-start justify-between gap-2">
                <button onClick={() => openTent(alert)} className="text-left flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{alert.tent_name || alert.tent_id}</div>
                  <div className="text-xs text-gray-400">{alert.message}</div>
                </button>
                <span className={`badge shrink-0 ${alert.severity === 'critical' ? 'badge-danger' : 'badge-warning'}`}>
                  {alert.severity}
                </span>
              </div>
              {alert.key && (
                <button
                  onClick={() => mute(alert)}
                  disabled={busyKey === alert.key}
                  className="mt-2 text-xs text-gray-400 hover:text-white"
                >
                  {busyKey === alert.key ? 'Muting...' : 'Mute for 8 hours'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
