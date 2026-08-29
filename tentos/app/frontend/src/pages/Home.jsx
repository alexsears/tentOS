import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useTents } from '../hooks/useTents'
import { TentCard } from '../components/TentCard'

const FRESH_READING_MS = 15 * 60 * 1000

function formatDataAge(timestamp) {
  if (!timestamp) return 'No recent readings'
  const ageMs = Math.max(0, Date.now() - timestamp)
  const minutes = Math.floor(ageMs / 60000)
  if (minutes < 1) return 'Updated just now'
  if (minutes < 60) return `Data ${minutes}m old`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `Data ${hours}h old`
  return `Data ${Math.floor(hours / 24)}d old`
}

function AttentionSummary({ tents }) {
  const affectedTents = tents
    .map(tent => ({ tent, alerts: Array.isArray(tent.alerts) ? tent.alerts : [] }))
    .filter(item => item.alerts.length > 0)
    .sort((a, b) => {
      const aCritical = a.alerts.some(alert => alert.severity === 'critical')
      const bCritical = b.alerts.some(alert => alert.severity === 'critical')
      return Number(bCritical) - Number(aCritical)
    })

  if (affectedTents.length === 0) return null

  const primary = affectedTents[0]
  const primaryAlert = primary.alerts.find(alert => alert.severity === 'critical') || primary.alerts[0]
  const alertCount = affectedTents.reduce((total, item) => total + item.alerts.length, 0)
  const hasCritical = affectedTents.some(item => item.alerts.some(alert => alert.severity === 'critical'))
  const remainingCount = alertCount - 1

  return (
    <Link
      to={`/tent/${primary.tent.id}`}
      className={`mb-3 flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors sm:px-4 ${
        hasCritical
          ? 'border-red-500/40 bg-red-950/30 hover:bg-red-950/45'
          : 'border-yellow-500/40 bg-yellow-950/25 hover:bg-yellow-950/40'
      }`}
      aria-label={`Review ${alertCount} active ${alertCount === 1 ? 'alert' : 'alerts'}`}
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg ${
          hasCritical ? 'bg-red-500/15 text-red-300' : 'bg-yellow-500/15 text-yellow-300'
        }`}
        aria-hidden="true"
      >
        ⚠
      </span>
      <div className="min-w-0 flex-1">
        <div className={`text-sm font-semibold ${hasCritical ? 'text-red-200' : 'text-yellow-200'}`}>
          {affectedTents.length} tent{affectedTents.length === 1 ? ' needs' : 's need'} attention
        </div>
        <div className="truncate text-xs text-gray-300 sm:text-sm">
          <span className="font-medium">{primary.tent.name}:</span> {primaryAlert.message}
          {remainingCount > 0 && ` (+${remainingCount} more)`}
        </div>
      </div>
      <span className="shrink-0 text-xs font-medium text-gray-300 sm:text-sm">
        Review <span aria-hidden="true">→</span>
      </span>
    </Link>
  )
}

export default function Home() {
  const { tents, loading, error, connected, haConnected, performAction, toggleActuator, isPending, updateControlSettings, refetch } = useTents()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const updateClock = () => {
      if (document.visibilityState === 'visible') setNow(Date.now())
    }
    const interval = setInterval(updateClock, 30000)
    document.addEventListener('visibilitychange', updateClock)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', updateClock)
    }
  }, [])

  const newestReadingAt = Math.max(
    0,
    ...tents.map(tent => Date.parse(tent.last_updated)).filter(Number.isFinite)
  )
  const dataIsFresh = newestReadingAt > 0 && now - newestReadingAt <= FRESH_READING_MS
  const isLive = connected && haConnected === true && dataIsFresh
  const connectionLabel = isLive
    ? 'Live'
    : haConnected === false
      ? 'HA disconnected'
      : !dataIsFresh
        ? formatDataAge(newestReadingAt)
        : connected
          ? 'Checking HA'
          : 'Reconnecting'

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Loading tents...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="card border-red-500/50">
        <div className="text-red-400">Error: {error}</div>
      </div>
    )
  }

  if (tents.length === 0) {
    return (
      <div className="card text-center py-12">
        <div className="text-4xl mb-4">🌱</div>
        <h2 className="text-xl font-semibold mb-2">No Tents Configured</h2>
        <p className="text-gray-400 mb-4">
          Configure your tents in the Settings tab.
        </p>
        <Link to="/settings" className="btn btn-primary">
          Go to Settings
        </Link>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 sm:gap-3">
          <h2 className="text-lg sm:text-xl font-bold">Dashboard</h2>
          <span className="text-xs sm:text-sm text-gray-400">
            {tents.length} tent{tents.length !== 1 && 's'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${isLive ? 'bg-green-500' : haConnected === null ? 'bg-yellow-500' : 'bg-red-500'}`} />
          <span className={`text-sm ${isLive ? 'text-gray-400' : 'text-red-300'}`}>
            {connectionLabel}
          </span>
        </div>
      </div>

      <AttentionSummary tents={tents} />

      <div className="grid gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 xl:gap-3">
        {tents.map(tent => (
          <TentCard
            key={tent.id}
            tent={tent}
            isLive={connected && haConnected === true && (
              Number.isFinite(Date.parse(tent.last_updated))
              && now - Date.parse(tent.last_updated) <= FRESH_READING_MS
            )}
            onAction={performAction}
            onToggle={toggleActuator}
            isPending={isPending}
            onUpdateControlSettings={updateControlSettings}
            onRefresh={refetch}
          />
        ))}
      </div>
    </div>
  )
}
