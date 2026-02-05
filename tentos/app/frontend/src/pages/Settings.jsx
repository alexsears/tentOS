import { useState, useEffect } from 'react'

export default function Settings() {
  const [status, setStatus] = useState(null)
  const [entities, setEntities] = useState([])
  const [loading, setLoading] = useState(true)
  const [entityFilter, setEntityFilter] = useState('')

  useEffect(() => {
    Promise.all([
      fetch('/api/system/status').then(r => r.json()),
      fetch('/api/system/entities').then(r => r.json())
    ])
      .then(([statusData, entitiesData]) => {
        setStatus(statusData)
        setEntities(entitiesData.entities || [])
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const filteredEntities = entities.filter(e =>
    e.entity_id.toLowerCase().includes(entityFilter.toLowerCase()) ||
    e.friendly_name?.toLowerCase().includes(entityFilter.toLowerCase())
  )

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Settings</h2>

      {/* System Status */}
      <div className="card">
        <h3 className="font-semibold mb-4">System Status</h3>
        {loading ? (
          <div className="text-gray-400">Loading...</div>
        ) : status ? (
          <div className="grid md:grid-cols-2 gap-4">
            <div className="flex items-center gap-3">
              <span className={`w-3 h-3 rounded-full ${status.ha_connected ? 'bg-green-500' : 'bg-red-500'}`} />
              <span>Home Assistant: {status.ha_connected ? 'Connected' : 'Disconnected'}</span>
            </div>
            <div>
              <span className="text-gray-400">Tents loaded:</span> {status.tents_loaded}
            </div>
            <div>
              <span className="text-gray-400">Entities mapped:</span> {status.entities_mapped}
            </div>
            <div>
              <span className="text-gray-400">WebSocket clients:</span> {status.ws_clients}
            </div>
          </div>
        ) : (
          <div className="text-red-400">Failed to load status</div>
        )}
      </div>

      {/* VPD Reference */}
      <div className="card">
        <h3 className="font-semibold mb-4">VPD Reference</h3>
        <p className="text-sm text-gray-400 mb-4">
          Vapor Pressure Deficit (VPD) is calculated from temperature and humidity.
          It indicates how much moisture the air can still absorb.
        </p>
        <div className="flex gap-2 flex-wrap mb-4">
          <span className="badge" style={{ backgroundColor: 'rgba(52, 152, 219, 0.3)', color: '#3498db' }}>
            0.0-0.4 Low
          </span>
          <span className="badge" style={{ backgroundColor: 'rgba(46, 204, 113, 0.3)', color: '#2ecc71' }}>
            0.4-0.8 Early
          </span>
          <span className="badge" style={{ backgroundColor: 'rgba(39, 174, 96, 0.3)', color: '#27ae60' }}>
            0.8-1.2 Optimal
          </span>
          <span className="badge" style={{ backgroundColor: 'rgba(241, 196, 15, 0.3)', color: '#f1c40f' }}>
            1.2-1.6 Late
          </span>
          <span className="badge" style={{ backgroundColor: 'rgba(231, 76, 60, 0.3)', color: '#e74c3c' }}>
            1.6+ High
          </span>
        </div>
        <div className="text-xs text-gray-500 font-mono">
          VPD = SVP × (1 - RH/100), where SVP = 0.6108 × exp(17.27 × T / (T + 237.3))
        </div>
      </div>

      {/* Entity Browser */}
      <div className="card">
        <h3 className="font-semibold mb-4">Entity Browser</h3>
        <p className="text-sm text-gray-400 mb-4">
          Browse available Home Assistant entities for mapping to your tents.
          Copy entity IDs to use in your add-on configuration.
        </p>

        <input
          type="text"
          placeholder="Filter entities..."
          value={entityFilter}
          onChange={e => setEntityFilter(e.target.value)}
          className="input w-full mb-4"
        />

        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-gray-400 sticky top-0 bg-[#16213e]">
              <tr>
                <th className="p-2">Entity ID</th>
                <th className="p-2">Name</th>
                <th className="p-2">State</th>
              </tr>
            </thead>
            <tbody>
              {filteredEntities.slice(0, 100).map(entity => (
                <tr key={entity.entity_id} className="border-t border-[#2d3a5c] hover:bg-[#1a1a2e]">
                  <td className="p-2 font-mono text-xs">
                    <button
                      onClick={() => navigator.clipboard.writeText(entity.entity_id)}
                      className="hover:text-green-400"
                      title="Click to copy"
                    >
                      {entity.entity_id}
                    </button>
                  </td>
                  <td className="p-2">{entity.friendly_name}</td>
                  <td className="p-2 text-gray-400">
                    {entity.state}
                    {entity.unit && ` ${entity.unit}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredEntities.length > 100 && (
            <div className="text-center text-gray-400 py-2">
              Showing 100 of {filteredEntities.length} entities
            </div>
          )}
        </div>
      </div>

      {/* Configuration Help */}
      <div className="card">
        <h3 className="font-semibold mb-4">Configuration</h3>
        <p className="text-sm text-gray-400 mb-4">
          Tents are configured in the add-on options. Use the entity browser above
          to find the correct entity IDs for your sensors and actuators.
        </p>
        <a
          href="/hassio/addon/tent_garden_manager/config"
          className="btn btn-primary"
        >
          Open Add-on Configuration
        </a>
      </div>
    </div>
  )
}
