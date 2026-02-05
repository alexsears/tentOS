import { useState, useEffect, useCallback } from 'react'
import { DndContext, DragOverlay, pointerWithin } from '@dnd-kit/core'
import EntityInventory from '../components/EntityInventory'
import TentBuilder from '../components/TentBuilder'
import { apiFetch } from '../utils/api'

export default function Settings() {
  const [status, setStatus] = useState(null)
  const [entities, setEntities] = useState([])
  const [slots, setSlots] = useState(null)
  const [config, setConfig] = useState({ version: '1.0', tents: [] })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [activeDragEntity, setActiveDragEntity] = useState(null)
  const [activeTab, setActiveTab] = useState('builder')
  const [slotFilter, setSlotFilter] = useState(null) // { category, slotType, slotDef }
  const [updateInfo, setUpdateInfo] = useState(null)
  const [updateLoading, setUpdateLoading] = useState(false)
  const [rebuilding, setRebuilding] = useState(false)

  // Load all data
  useEffect(() => {
    Promise.all([
      apiFetch('api/system/status').then(r => r.json()),
      apiFetch('api/system/entities').then(r => r.json()),
      apiFetch('api/config/slots').then(r => r.json()),
      apiFetch('api/config').then(r => r.json())
    ])
      .then(([statusData, entitiesData, slotsData, configData]) => {
        setStatus(statusData)
        setEntities(entitiesData.entities || [])
        setSlots(slotsData)
        setConfig(configData)
      })
      .catch(err => {
        console.error('Failed to load data:', err)
        setError('Failed to load configuration')
      })
      .finally(() => setLoading(false))
  }, [])

  // Save config
  const saveConfig = async () => {
    setSaving(true)
    setError(null)
    setSuccess(null)

    try {
      const res = await apiFetch('api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.detail || 'Failed to save')
      }

      setSuccess('Configuration saved successfully!')
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  // Validate config
  const validateConfig = async () => {
    try {
      const res = await apiFetch('api/config/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      })
      const data = await res.json()

      if (data.errors?.length > 0) {
        setError(`Validation errors: ${data.errors.join(', ')}`)
      } else if (data.warnings?.length > 0) {
        setSuccess(`Valid with warnings: ${data.warnings.join(', ')}`)
      } else {
        setSuccess('Configuration is valid!')
      }
      setTimeout(() => { setError(null); setSuccess(null) }, 5000)
    } catch (err) {
      setError('Validation failed')
    }
  }

  // Handle drag start
  const handleDragStart = (event) => {
    const { active } = event
    if (active.data.current?.entity) {
      setActiveDragEntity(active.data.current.entity)
    }
  }

  // Handle drag end - assign entity to slot
  const handleDragEnd = (event) => {
    const { active, over } = event
    setActiveDragEntity(null)

    if (!over || !active.data.current?.entity) return

    const entityId = active.id
    // Format: tentId.category.slotType
    const parts = over.id.split('.')
    if (parts.length !== 3) return

    const [tentId, category, slotType] = parts

    // Find the target tent
    const tentIndex = config.tents?.findIndex(t => t.id === tentId)
    if (tentIndex === -1) return

    const updatedTents = [...config.tents]
    const targetTent = { ...updatedTents[tentIndex] }

    if (!targetTent[category]) targetTent[category] = {}
    targetTent[category] = { ...targetTent[category], [slotType]: entityId }

    updatedTents[tentIndex] = targetTent
    setConfig({ ...config, tents: updatedTents })
  }

  // Get all assigned entity IDs
  const getAssignedEntities = () => {
    const assigned = {}
    for (const tent of config.tents || []) {
      for (const [key, val] of Object.entries(tent.sensors || {})) {
        if (val) assigned[val] = true
      }
      for (const [key, val] of Object.entries(tent.actuators || {})) {
        if (val) assigned[val] = true
      }
    }
    return assigned
  }

  // Check for updates
  const checkForUpdates = async () => {
    setUpdateLoading(true)
    try {
      // Get both GitHub info and Supervisor info
      const [checkRes, infoRes] = await Promise.all([
        apiFetch('api/updates/check'),
        apiFetch('api/updates/info')
      ])
      const checkData = await checkRes.json()
      const infoData = await infoRes.json()

      setUpdateInfo({
        ...checkData,
        supervisor_update_available: infoData.update_available,
        version_latest: infoData.version_latest,
        slug: infoData.slug
      })
    } catch (err) {
      setError('Failed to check for updates')
    } finally {
      setUpdateLoading(false)
    }
  }

  // Update add-on (refresh store + update)
  const handleUpdate = async () => {
    if (!confirm('This will check for updates and install the latest version. The app will restart. Continue?')) return
    setRebuilding(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await apiFetch('api/updates/update', { method: 'POST' })
      const data = await res.json()
      if (res.ok && data.success) {
        setSuccess('Update started! The add-on will restart with the new version.')
      } else if (res.status === 403) {
        setError('Permission denied. Please reinstall the add-on from HA Settings → Add-ons to enable update permissions.')
      } else {
        setError(data.detail || 'Update failed')
      }
    } catch (err) {
      setError('Failed to trigger update: ' + err.message)
    } finally {
      setRebuilding(false)
    }
  }

  // Rebuild add-on
  const handleRebuild = async () => {
    if (!confirm('This will rebuild the add-on. The app will restart. Continue?')) return
    setRebuilding(true)
    setError(null)
    try {
      const res = await apiFetch('api/updates/rebuild', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        setSuccess('Rebuild started! The add-on will restart automatically.')
      } else {
        setError(data.detail || 'Rebuild failed')
      }
    } catch (err) {
      setError('Failed to trigger rebuild: ' + err.message)
    } finally {
      setRebuilding(false)
    }
  }

  // Restart add-on (quick)
  const handleRestart = async () => {
    if (!confirm('This will restart the add-on. Continue?')) return
    try {
      const res = await apiFetch('api/updates/restart', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        setSuccess('Restart initiated! Reconnecting...')
      } else {
        setError(data.detail || 'Restart failed')
      }
    } catch (err) {
      setError('Failed to restart: ' + err.message)
    }
  }

  // Export config as JSON file
  const handleExport = () => {
    const dataStr = JSON.stringify(config, null, 2)
    const blob = new Blob([dataStr], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tentos-config-${new Date().toISOString().split('T')[0]}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    setSuccess('Config exported!')
    setTimeout(() => setSuccess(null), 3000)
  }

  // Import config from JSON file
  const handleImport = (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const imported = JSON.parse(e.target.result)
        if (!imported.tents) {
          setError('Invalid config file: missing tents array')
          return
        }
        setConfig(imported)
        setSuccess('Config imported! Click "Save Configuration" to apply.')
        setTimeout(() => setSuccess(null), 5000)
      } catch (err) {
        setError('Failed to parse config file: ' + err.message)
      }
    }
    reader.readAsText(file)
    event.target.value = '' // Reset input
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Loading configuration...</div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Settings</h2>
        <div className="flex gap-2">
          <button
            onClick={validateConfig}
            className="btn"
            disabled={saving}
          >
            Validate
          </button>
          <button
            onClick={saveConfig}
            className="btn btn-primary"
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save Configuration'}
          </button>
        </div>
      </div>

      {/* Status Messages */}
      {error && (
        <div className="p-3 bg-red-500/20 border border-red-500/50 rounded text-red-300">
          {error}
        </div>
      )}
      {success && (
        <div className="p-3 bg-green-500/20 border border-green-500/50 rounded text-green-300">
          {success}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b border-[#2d3a5c]">
        <button
          onClick={() => setActiveTab('builder')}
          className={`px-4 py-2 -mb-px border-b-2 transition-colors ${
            activeTab === 'builder'
              ? 'border-green-500 text-green-400'
              : 'border-transparent text-gray-400 hover:text-white'
          }`}
        >
          Tent Builder
        </button>
        <button
          onClick={() => setActiveTab('status')}
          className={`px-4 py-2 -mb-px border-b-2 transition-colors ${
            activeTab === 'status'
              ? 'border-green-500 text-green-400'
              : 'border-transparent text-gray-400 hover:text-white'
          }`}
        >
          System Status
        </button>
        <button
          onClick={() => setActiveTab('reference')}
          className={`px-4 py-2 -mb-px border-b-2 transition-colors ${
            activeTab === 'reference'
              ? 'border-green-500 text-green-400'
              : 'border-transparent text-gray-400 hover:text-white'
          }`}
        >
          VPD Reference
        </button>
        <button
          onClick={() => { setActiveTab('updates'); checkForUpdates() }}
          className={`px-4 py-2 -mb-px border-b-2 transition-colors ${
            activeTab === 'updates'
              ? 'border-green-500 text-green-400'
              : 'border-transparent text-gray-400 hover:text-white'
          }`}
        >
          Updates
        </button>
      </div>

      {/* Tent Builder Tab */}
      {activeTab === 'builder' && (
        <DndContext
          collisionDetection={pointerWithin}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4" style={{ minHeight: '600px' }}>
            {/* Entity Inventory (Left Panel) */}
            <div className="lg:col-span-1 card p-0 overflow-hidden">
              <EntityInventory
                entities={entities}
                slots={slots}
                assignedEntities={getAssignedEntities()}
                slotFilter={slotFilter}
                onClearFilter={() => setSlotFilter(null)}
              />
            </div>

            {/* Tent Builder (Right Panel) */}
            <div className="lg:col-span-2 overflow-auto">
              <TentBuilder
                config={config}
                slots={slots}
                entities={entities}
                onConfigChange={setConfig}
                onSlotSelect={setSlotFilter}
                selectedSlot={slotFilter}
              />
            </div>
          </div>

          {/* Drag Overlay */}
          <DragOverlay>
            {activeDragEntity ? (
              <div className="p-2 bg-[#1a1a2e] rounded border-2 border-green-500 shadow-lg">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{activeDragEntity.icon || '📍'}</span>
                  <span className="font-medium text-sm">
                    {activeDragEntity.friendly_name || activeDragEntity.entity_id}
                  </span>
                </div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {/* System Status Tab */}
      {activeTab === 'status' && (
        <div className="card">
          <h3 className="font-semibold mb-4">System Status</h3>
          {status ? (
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
              <div>
                <span className="text-gray-400">Available entities:</span> {entities.length}
              </div>
            </div>
          ) : (
            <div className="text-red-400">Failed to load status</div>
          )}
        </div>
      )}

      {/* VPD Reference Tab */}
      {activeTab === 'reference' && (
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
      )}

      {/* Updates Tab */}
      {activeTab === 'updates' && (
        <div className="space-y-4">
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">Version Information</h3>
              <button
                onClick={checkForUpdates}
                disabled={updateLoading}
                className="btn btn-sm"
              >
                {updateLoading ? 'Checking...' : 'Check for Updates'}
              </button>
            </div>

            {updateInfo ? (
              <div className="space-y-4">
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="p-3 bg-[#1a1a2e] rounded">
                    <div className="text-sm text-gray-400">Current Version</div>
                    <div className="text-xl font-bold">{updateInfo.current_version}</div>
                  </div>
                  <div className="p-3 bg-[#1a1a2e] rounded">
                    <div className="text-sm text-gray-400">Latest Version</div>
                    <div className="text-xl font-bold">
                      {updateInfo.latest_version || updateInfo.latest_commit || 'Unknown'}
                    </div>
                    {updateInfo.published_at && (
                      <div className="text-xs text-gray-500">
                        Released: {new Date(updateInfo.published_at).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                </div>

                {updateInfo.update_available && (
                  <div className="p-3 bg-green-500/20 border border-green-500/50 rounded">
                    <div className="flex items-center gap-2 text-green-400">
                      <span>Update available!</span>
                    </div>
                    {updateInfo.release_notes && (
                      <div className="mt-2 text-sm text-gray-300 whitespace-pre-wrap max-h-40 overflow-auto">
                        {updateInfo.release_notes}
                      </div>
                    )}
                    {updateInfo.latest_commit_message && (
                      <div className="mt-2 text-sm text-gray-300">
                        Latest: {updateInfo.latest_commit_message}
                      </div>
                    )}
                  </div>
                )}

                {!updateInfo.update_available && !updateInfo.error && (
                  <div className="p-3 bg-blue-500/20 border border-blue-500/50 rounded text-blue-300">
                    You're running the latest version!
                  </div>
                )}

                {updateInfo.error && (
                  <div className="p-3 bg-yellow-500/20 border border-yellow-500/50 rounded text-yellow-300">
                    Could not check for updates: {updateInfo.error}
                  </div>
                )}

                {updateInfo.repo_url && (
                  <a
                    href={updateInfo.repo_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-400 hover:underline"
                  >
                    View on GitHub
                  </a>
                )}
              </div>
            ) : (
              <div className="text-gray-400">
                Click "Check for Updates" to see version information
              </div>
            )}
          </div>

          <div className="card">
            <h3 className="font-semibold mb-4">Backup & Restore</h3>
            <p className="text-sm text-gray-400 mb-4">
              Export your tent configuration to a file for backup. Import to restore after reinstall.
            </p>
            <div className="flex gap-3 flex-wrap mb-4">
              <button onClick={handleExport} className="btn">
                📥 Export Config
              </button>
              <label className="btn cursor-pointer">
                📤 Import Config
                <input
                  type="file"
                  accept=".json"
                  onChange={handleImport}
                  className="hidden"
                />
              </label>
            </div>
            <div className="text-xs text-gray-500">
              {config.tents?.length || 0} tent(s) configured
            </div>
          </div>

          <div className="card">
            <h3 className="font-semibold mb-4">Add-on Management</h3>
            <div className="flex gap-3 flex-wrap mb-4">
              <button
                onClick={handleUpdate}
                disabled={rebuilding}
                className="btn bg-green-600 hover:bg-green-700 text-white"
              >
                {rebuilding ? 'Updating...' : '🔄 Refresh & Update'}
              </button>
              <button
                onClick={handleRebuild}
                disabled={rebuilding}
                className="btn"
              >
                {rebuilding ? 'Rebuilding...' : 'Rebuild'}
              </button>
              <button
                onClick={handleRestart}
                className="btn"
              >
                Restart
              </button>
            </div>
            <div className="text-xs text-gray-500 space-y-1">
              <p><strong>Refresh & Update:</strong> Checks for new versions and installs (~1-2 min)</p>
              <p><strong>Rebuild:</strong> Rebuilds current version (~1-2 min)</p>
              <p><strong>Restart:</strong> Quick restart without rebuild (~10 sec)</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
