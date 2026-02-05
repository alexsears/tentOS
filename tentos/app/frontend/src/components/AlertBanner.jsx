import { useState, useEffect } from 'react'

export function AlertBanner() {
  const [alerts, setAlerts] = useState([])
  const [dismissed, setDismissed] = useState(new Set())

  useEffect(() => {
    fetch('api/alerts?active_only=true')
      .then(r => r.json())
      .then(data => setAlerts(data.alerts?.filter(a => a.severity === 'critical') || []))
      .catch(console.error)
  }, [])

  const visibleAlerts = alerts.filter(a => !dismissed.has(a.id || a.message))

  if (visibleAlerts.length === 0) return null

  return (
    <div className="bg-red-900/50 border-b border-red-700 px-4 py-2">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-red-400">⚠️</span>
          <span className="text-red-200">
            {visibleAlerts[0].message}
            {visibleAlerts.length > 1 && ` (+${visibleAlerts.length - 1} more)`}
          </span>
        </div>
        <button
          onClick={() => setDismissed(prev => new Set([...prev, visibleAlerts[0].id || visibleAlerts[0].message]))}
          className="text-red-400 hover:text-red-300"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
