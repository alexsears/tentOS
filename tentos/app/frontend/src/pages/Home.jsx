import { useTents } from '../hooks/useTents'
import { TentCard } from '../components/TentCard'

export default function Home() {
  const { tents, loading, error, performAction } = useTents()

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
          Add your first tent in the add-on configuration.
        </p>
        <a
          href="/hassio/addon/tent_garden_manager/config"
          className="btn btn-primary"
        >
          Open Add-on Config
        </a>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">Dashboard</h2>
          <p className="text-gray-400">{tents.length} tent{tents.length !== 1 && 's'} configured</p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {tents.map(tent => (
          <TentCard
            key={tent.id}
            tent={tent}
            onAction={performAction}
          />
        ))}
      </div>
    </div>
  )
}
