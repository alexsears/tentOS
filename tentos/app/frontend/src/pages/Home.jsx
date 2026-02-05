import { useTents } from '../hooks/useTents'
import { TentCard } from '../components/TentCard'

export default function Home() {
  const { tents, loading, error, connected, performAction, toggleActuator, isPending } = useTents()

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
        <a href="#/settings" className="btn btn-primary">
          Go to Settings
        </a>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">Dashboard</h2>
          <p className="text-gray-400">
            {tents.length} tent{tents.length !== 1 && 's'} configured
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="text-sm text-gray-400">
            {connected ? 'Live' : 'Disconnected'}
          </span>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {tents.map(tent => (
          <TentCard
            key={tent.id}
            tent={tent}
            onAction={performAction}
            onToggle={toggleActuator}
            isPending={isPending}
          />
        ))}
      </div>
    </div>
  )
}
