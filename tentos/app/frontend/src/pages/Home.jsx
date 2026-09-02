import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { ChevronRight, Sprout, TriangleAlert } from 'lucide-react'
import { useTents } from '../hooks/useTents'
import { TentCard } from '../components/TentCard'
import { finiteNumberOrNull } from '../utils/numbers'

const FRESH_READING_MS = 15 * 60 * 1000

function isUsableSensorValue(value) {
  return finiteNumberOrNull(value) !== null
}

function tentHasUsableData(tent) {
  if ([tent.avg_temperature, tent.avg_humidity, tent.vpd].some(isUsableSensorValue)) {
    return true
  }
  return Object.values(tent.sensors || {}).some(sensor => isUsableSensorValue(sensor?.value))
}

function tentReadingIsFresh(tent, now) {
  const readingAt = Date.parse(tent.last_updated)
  return tentHasUsableData(tent)
    && Number.isFinite(readingAt)
    && now - readingAt <= FRESH_READING_MS
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
        <TriangleAlert size={18} />
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
      <span className="flex shrink-0 items-center gap-0.5 text-xs font-medium text-gray-300 sm:text-sm">
        Review <ChevronRight size={16} aria-hidden="true" />
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

  const unavailableTentCount = tents.filter(tent => !tentHasUsableData(tent)).length
  const staleTentCount = tents.filter(
    tent => tentHasUsableData(tent) && !tentReadingIsFresh(tent, now)
  ).length
  const allTentsFresh = tents.length > 0 && unavailableTentCount === 0 && staleTentCount === 0
  const isLive = connected && haConnected === true && allTentsFresh
  const connectionLabel = isLive
    ? 'Live'
    : haConnected === false
      ? 'HA disconnected'
      : unavailableTentCount > 0
        ? `${unavailableTentCount} tent${unavailableTentCount === 1 ? '' : 's'} unavailable`
        : staleTentCount > 0
        ? `${staleTentCount} tent${staleTentCount === 1 ? '' : 's'} stale`
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
        <div className="mb-4 flex justify-center text-gray-500" aria-hidden="true">
          <Sprout size={40} />
        </div>
        <h2 className="text-xl font-semibold mb-2">No tents configured</h2>
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
            hasUsableData={tentHasUsableData(tent)}
            isLive={connected && haConnected === true && tentReadingIsFresh(tent, now)}
            now={now}
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
