import { useState, useEffect, useCallback, useRef } from 'react'
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
  const [slotFilter, setSlotFilter] = useState(null) // { category, slotType, slotDef, tentId }
  const [updateInfo, setUpdateInfo] = useState(null)
  const [updateLoading, setUpdateLoading] = useState(false)
  const [rebuilding, setRebuilding] = useState(false)
  const [selectedEntities, setSelectedEntities] = useState([]) // Multi-select for bulk add
  const [autoSaveStatus, setAutoSaveStatus] = useState(null) // 'saving' | 'saved' | 'error'
  const [quickAddModal, setQuickAddModal] = useState(null) // { entity, guessedTentId, compatibleSlots, selectedTentId, selectedSlot }
  const isInitialLoad = useRef(true)
  const autoSaveTimer = useRef(null)

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
      .finally(() => {
        setLoading(false)
        // Mark initial load complete after a short delay
        setTimeout(() => { isInitialLoad.current = false }, 500)
      })
  }, [])

  // Auto-save config when it changes (debounced)
  useEffect(() => {
    // Skip initial load
    if (isInitialLoad.current || loading) return

    // Clear existing timer
    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current)
    }

    // Set new timer for auto-save (1.5 second delay)
    autoSaveTimer.current = setTimeout(async () => {
      setAutoSaveStatus('saving')
      try {
        const res = await apiFetch('api/config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config)
        })

        if (!res.ok) {
          throw new Error('Failed to save')
        }

        setAutoSaveStatus('saved')
        // Clear "saved" status after 2 seconds
        setTimeout(() => setAutoSaveStatus(null), 2000)
      } catch (err) {
        setAutoSaveStatus('error')
        setError('Auto-save failed: ' + err.message)
      }
    }, 1500)

    return () => {
      if (autoSaveTimer.current) {
        clearTimeout(autoSaveTimer.current)
      }
    }
  }, [config, loading])

  // Save config (manual)
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

  // Handle drag start - if dragging a selected entity, drag all selected
  const handleDragStart = (event) => {
    const { active } = event
    if (active.data.current?.entity) {
      const draggedId = active.id
      // If the dragged entity is selected, we'll drag all selected
      if (selectedEntities.includes(draggedId)) {
        setActiveDragEntity({
          ...active.data.current.entity,
          _multiDrag: true,
          _selectedIds: selectedEntities
        })
      } else {
        setActiveDragEntity(active.data.current.entity)
      }
    }
  }

  // Handle drag end - assign entity to slot (supports multi-drag)
  const handleDragEnd = (event) => {
    const { active, over } = event
    const draggedEntity = activeDragEntity
    setActiveDragEntity(null)

    if (!over || !active.data.current?.entity) return

    // Format: tentId.category.slotType
    const parts = over.id.split('.')
    if (parts.length !== 3) return

    const [tentId, category, slotType] = parts
    const isMultiple = over.data.current?.multiple

    // Get entities to add - either all selected (multi-drag) or just the one
    const entitiesToAdd = draggedEntity?._multiDrag
      ? draggedEntity._selectedIds
      : [active.id]

    // Find the target tent
    const tentIndex = config.tents?.findIndex(t => t.id === tentId)
    if (tentIndex === -1) return

    const updatedTents = [...config.tents]
    const targetTent = { ...updatedTents[tentIndex] }

    if (!targetTent[category]) targetTent[category] = {}
    targetTent[category] = { ...targetTent[category] }

    if (isMultiple) {
      // Append all entities to array for multi-entity slots
      const current = targetTent[category][slotType]
      const arr = Array.isArray(current) ? [...current] : (current ? [current] : [])
      for (const entityId of entitiesToAdd) {
        if (!arr.includes(entityId)) {
          arr.push(entityId)
        }
      }
      targetTent[category][slotType] = arr
    } else {
      // Single entity slot - just use the first
      targetTent[category][slotType] = entitiesToAdd[0]
    }

    updatedTents[tentIndex] = targetTent
    setConfig({ ...config, tents: updatedTents })

    // Clear selection after drag
    if (draggedEntity?._multiDrag) {
      setSelectedEntities([])
    }
  }

  // Get all assigned entity IDs
  const getAssignedEntities = () => {
    const assigned = {}
    for (const tent of config.tents || []) {
      for (const [key, val] of Object.entries(tent.sensors || {})) {
        if (Array.isArray(val)) {
          val.forEach(v => { if (v) assigned[v] = true })
        } else if (val) {
          assigned[val] = true
        }
      }
      for (const [key, val] of Object.entries(tent.actuators || {})) {
        if (Array.isArray(val)) {
          val.forEach(v => { if (v) assigned[v] = true })
        } else if (val) {
          assigned[val] = true
        }
      }
    }
    return assigned
  }

  // Toggle entity selection
  const handleToggleSelect = (entityId) => {
    setSelectedEntities(prev =>
      prev.includes(entityId)
        ? prev.filter(id => id !== entityId)
        : [...prev, entityId]
    )
  }

  // Select all visible entities
  const handleSelectAll = (visibleIds) => {
    setSelectedEntities(prev => {
      const newSelected = new Set(prev)
      visibleIds.forEach(id => newSelected.add(id))
      return Array.from(newSelected)
    })
  }

  // Deselect all
  const handleDeselectAll = () => {
    setSelectedEntities([])
  }

  // Add all selected entities to slot
  const handleAddSelected = (slotInfo) => {
    if (!slotInfo || selectedEntities.length === 0) return

    const { category, slotType, tentId } = slotInfo
    const isMultiple = slotInfo.slotDef?.multiple

    // Find the target tent
    const tentIndex = config.tents?.findIndex(t => t.id === tentId)
    if (tentIndex === -1) return

    const updatedTents = [...config.tents]
    const targetTent = { ...updatedTents[tentIndex] }

    if (!targetTent[category]) targetTent[category] = {}
    targetTent[category] = { ...targetTent[category] }

    if (isMultiple) {
      // Append all selected to array
      const current = targetTent[category][slotType]
      const arr = Array.isArray(current) ? [...current] : (current ? [current] : [])
      for (const entityId of selectedEntities) {
        if (!arr.includes(entityId)) {
          arr.push(entityId)
        }
      }
      targetTent[category][slotType] = arr
    } else {
      // Single entity slot - just use the first selected
      targetTent[category][slotType] = selectedEntities[0]
    }

    updatedTents[tentIndex] = targetTent
    setConfig({ ...config, tents: updatedTents })
    setSelectedEntities([]) // Clear selection after adding
  }

  // Quick-add: guess tent by name, find compatible slots per entity, show modal
  const handleQuickAdd = (entitiesToAdd) => {
    const tents = config.tents || []
    if (tents.length === 0 || entitiesToAdd.length === 0) return

    // Guess tent using the first entity's name
    const first = entitiesToAdd[0]
    const entityName = (first.friendly_name || first.entity_id).toLowerCase()
    const entityIdName = first.entity_id.split('.').pop().toLowerCase()

    let guessedTentId = tents[0].id
    let bestScore = 0

    for (const tent of tents) {
      const tentWords = tent.name.toLowerCase().split(/[\s_-]+/).filter(w => w.length > 2)
      let score = 0
      for (const word of tentWords) {
        if (entityName.includes(word)) score += 2
        if (entityIdName.includes(word)) score += 1
      }
      if (score > bestScore) {
        bestScore = score
        guessedTentId = tent.id
      }
    }

    // For each entity, find compatible slots
    const entitySlotMap = entitiesToAdd.map(entity => {
      const compatible = []
      if (slots) {
        for (const [category, categorySlots] of Object.entries(slots)) {
          for (const [slotType, slotDef] of Object.entries(categorySlots)) {
            if (!slotDef.domains || !slotDef.domains.includes(entity.domain)) continue
            if (slotDef.device_classes && slotDef.device_classes.length > 0) {
              const hasNull = slotDef.device_classes.includes(null)
              const matchesClass = slotDef.device_classes.includes(entity.device_class)
              if (!hasNull && !matchesClass) continue
            }
            compatible.push({ category, slotType, slotDef })
          }
        }
      }
      return { entity, compatibleSlots: compatible, selectedSlot: compatible[0] || null }
    })

    // Filter out entities with no compatible slots
    const valid = entitySlotMap.filter(e => e.selectedSlot)
    if (valid.length === 0) {
      setError('No compatible slots found for selected entities')
      setTimeout(() => setError(null), 3000)
      return
    }

    setQuickAddModal({
      entities: valid,
      guessedTentId,
      selectedTentId: guessedTentId
    })
  }

  // Confirm quick-add: assign all entities to the selected tent
  const confirmQuickAdd = () => {
    if (!quickAddModal) return

    const { entities: entityEntries, selectedTentId } = quickAddModal

    const tentIndex = config.tents?.findIndex(t => t.id === selectedTentId)
    if (tentIndex === -1) return

    const updatedTents = [...config.tents]
    const targetTent = { ...updatedTents[tentIndex] }

    for (const { entity, selectedSlot } of entityEntries) {
      const { category, slotType, slotDef } = selectedSlot

      if (!targetTent[category]) targetTent[category] = {}
      targetTent[category] = { ...targetTent[category] }

      if (slotDef.multiple) {
        const current = targetTent[category][slotType]
        const arr = Array.isArray(current) ? [...current] : (current ? [current] : [])
        if (!arr.includes(entity.entity_id)) {
          arr.push(entity.entity_id)
        }
        targetTent[category][slotType] = arr
      } else {
        targetTent[category][slotType] = entity.entity_id
      }
    }

    updatedTents[tentIndex] = targetTent
    setConfig({ ...config, tents: updatedTents })
    setQuickAddModal(null)
    setSelectedEntities([])
  }

  // Handle slot selection (pass tentId along)
  const handleSlotSelect = (slotInfo) => {
    setSlotFilter(slotInfo)
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

  // Auto-update (refresh + check + update if available)
  const handleAutoUpdate = async () => {
    setRebuilding(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await apiFetch('api/updates/auto-update', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        if (data.action === 'none') {
          setSuccess(`Already on latest version (${data.current_version})`)
        } else {
          setSuccess(data.message || 'Update started! The add-on will restart.')
        }
        checkForUpdates() // Refresh version info
      } else {
        setError(data.error || data.detail || 'Auto-update failed')
      }
    } catch (err) {
      setError('Auto-update failed: ' + err.message)
    } finally {
      setRebuilding(false)
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

  // Import config from JSON file and auto-save
  const handleImport = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        const imported = JSON.parse(e.target.result)
        if (!imported.tents) {
          setError('Invalid config file: missing tents array')
          return
        }

        // Auto-save the imported config
        setSaving(true)
        const res = await apiFetch('api/config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(imported)
        })

        if (res.ok) {
          setConfig(imported)
          setSuccess(`Config imported and saved! ${imported.tents?.length || 0} tent(s) restored.`)
        } else {
          const data = await res.json()
          setError('Import failed: ' + (data.detail || 'Unknown error'))
        }
      } catch (err) {
        setError('Failed to import config: ' + err.message)
      } finally {
        setSaving(false)
        setTimeout(() => setSuccess(null), 5000)
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
        <div className="flex items-center gap-3">
          {/* Auto-save status indicator */}
          <div className="flex items-center gap-2 text-sm">
            {autoSaveStatus === 'saving' && (
              <span className="text-yellow-400 animate-pulse">Saving...</span>
            )}
            {autoSaveStatus === 'saved' && (
              <span className="text-green-400">✓ Saved</span>
            )}
            {autoSaveStatus === 'error' && (
              <span className="text-red-400">Save failed</span>
            )}
            {!autoSaveStatus && !loading && (
              <span className="text-gray-500">Auto-save on</span>
            )}
          </div>
          <button
            onClick={validateConfig}
            className="btn"
            disabled={saving}
          >
            Validate
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
                onClearFilter={() => { setSlotFilter(null); setSelectedEntities([]) }}
                selectedEntities={selectedEntities}
                onToggleSelect={handleToggleSelect}
                onSelectAll={handleSelectAll}
                onDeselectAll={handleDeselectAll}
                onAddSelected={handleAddSelected}
                onQuickAdd={handleQuickAdd}
              />
            </div>

            {/* Tent Builder (Right Panel) */}
            <div className="lg:col-span-2 overflow-auto">
              <TentBuilder
                config={config}
                slots={slots}
                entities={entities}
                onConfigChange={setConfig}
                onSlotSelect={handleSlotSelect}
                selectedSlot={slotFilter}
              />
            </div>
          </div>

          {/* Drag Overlay - tile style like dashboard */}
          <DragOverlay>
            {activeDragEntity ? (
              activeDragEntity._multiDrag ? (
                <div className="relative flex flex-col items-center justify-center p-3 rounded-lg bg-green-900/30 border-2 border-green-500 shadow-lg shadow-green-500/20 min-w-[80px]">
                  <span className="text-2xl">📦</span>
                  <span className="text-sm font-bold text-green-400 mt-1">{activeDragEntity._selectedIds.length}</span>
                  <span className="text-xs text-white">entities</span>
                </div>
              ) : (() => {
                const e = activeDragEntity
                const st = (e.state || '').toLowerCase()
                const isOn = st === 'on' || st === 'playing' || st === 'open'
                const isNumeric = e.state != null && !isNaN(parseFloat(e.state))
                const isSensor = e.domain === 'sensor' || e.domain === 'binary_sensor'
                const tileBg = isOn ? 'bg-green-900/30 border-green-500' : 'bg-[#1a1a2e] border-green-500'
                const iconColor = isOn ? 'text-green-400' : isNumeric ? 'text-cyan-300' : 'text-gray-400'
                const name = e.friendly_name || e.entity_id.split('.').pop().replace(/_/g, ' ')
                return (
                  <div className={'relative flex flex-col items-center justify-center p-3 rounded-lg border-2 shadow-lg shadow-green-500/20 min-w-[80px] ' + tileBg}>
                    <span className={'absolute top-1 right-1 w-2 h-2 rounded-full ' + (isOn ? 'bg-green-400' : isNumeric ? 'bg-cyan-400' : 'bg-gray-600')} />
                    <span className={'text-2xl ' + iconColor}>{e.icon || '📍'}</span>
                    {isSensor && isNumeric ? (
                      <span className="text-lg font-bold text-cyan-300 mt-1">
                        {Number(e.state).toFixed(1)}
                        {e.unit && <span className="text-xs text-gray-500 ml-0.5">{e.unit}</span>}
                      </span>
                    ) : (
                      <span className={'text-xs mt-1 font-medium ' + (isOn ? 'text-green-400' : 'text-gray-500')}>
                        {isOn ? 'ON' : st === 'off' ? 'OFF' : st || '--'}
                      </span>
                    )}
                    <span className="text-xs text-gray-400 truncate max-w-[100px] text-center mt-0.5">{name}</span>
                  </div>
                )
              })()
            ) : null}
          </DragOverlay>
          {/* Quick Add Modal */}
          {quickAddModal && (
            <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => setQuickAddModal(null)}>
              <div className="bg-[#16213e] rounded-lg p-5 w-96 max-w-[90vw] max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <h3 className="font-semibold text-lg mb-4">
                  Add {quickAddModal.entities.length} {quickAddModal.entities.length === 1 ? 'Entity' : 'Entities'} to Tent
                </h3>

                {/* Tent selector */}
                <div className="mb-3">
                  <label className="text-xs text-gray-400 block mb-1">Tent</label>
                  <select
                    value={quickAddModal.selectedTentId}
                    onChange={e => setQuickAddModal(prev => ({ ...prev, selectedTentId: e.target.value }))}
                    className="input w-full"
                  >
                    {(config.tents || []).map(t => (
                      <option key={t.id} value={t.id}>
                        {t.name}{t.id === quickAddModal.guessedTentId ? ' (suggested)' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Entity list with slot assignments */}
                <div className="mb-4 overflow-y-auto flex-1 space-y-2">
                  <label className="text-xs text-gray-400 block mb-1">Entities & Slots</label>
                  {quickAddModal.entities.map(({ entity, compatibleSlots, selectedSlot }, idx) => (
                    <div key={entity.entity_id} className="flex items-center gap-2 p-2 bg-[#1a1a2e] rounded">
                      <span className="text-lg flex-shrink-0">{entity.icon || '📍'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">
                          {entity.friendly_name || entity.entity_id}
                        </div>
                        {compatibleSlots.length === 1 ? (
                          <div className="text-xs text-gray-500">
                            {selectedSlot.slotDef.icon} {selectedSlot.slotDef.label}
                          </div>
                        ) : (
                          <select
                            value={compatibleSlots.indexOf(selectedSlot)}
                            onChange={e => setQuickAddModal(prev => {
                              const updated = [...prev.entities]
                              updated[idx] = { ...updated[idx], selectedSlot: compatibleSlots[parseInt(e.target.value)] }
                              return { ...prev, entities: updated }
                            })}
                            className="input text-xs mt-0.5 w-full py-0.5"
                          >
                            {compatibleSlots.map((s, i) => (
                              <option key={i} value={i}>
                                {s.slotDef.icon} {s.slotDef.label} ({s.category})
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Actions */}
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setQuickAddModal(null)} className="btn">
                    Cancel
                  </button>
                  <button onClick={confirmQuickAdd} className="btn btn-primary">
                    Add to Tent
                  </button>
                </div>
              </div>
            </div>
          )}
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
                onClick={handleAutoUpdate}
                disabled={rebuilding}
                className="btn bg-green-600 hover:bg-green-700 text-white"
              >
                {rebuilding ? 'Updating...' : '🚀 Auto-Update'}
              </button>
              <button
                onClick={handleUpdate}
                disabled={rebuilding}
                className="btn"
              >
                {rebuilding ? 'Updating...' : 'Refresh & Update'}
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
              <p><strong>Auto-Update:</strong> Checks GitHub for updates and installs automatically</p>
              <p><strong>Refresh & Update:</strong> Refreshes store cache then updates (~1-2 min)</p>
              <p><strong>Rebuild:</strong> Rebuilds current version (~1-2 min)</p>
              <p><strong>Restart:</strong> Quick restart without rebuild (~10 sec)</p>
            </div>
          </div>

          <div className="card">
            <h3 className="font-semibold mb-4">Automate Updates with Home Assistant</h3>
            <p className="text-sm text-gray-400 mb-4">
              Create an HA automation to automatically update TentOS. Add this to your <code className="text-green-400">configuration.yaml</code>:
            </p>
            <div className="bg-[#1a1a2e] p-4 rounded font-mono text-xs overflow-x-auto">
              <pre className="text-gray-300">{`# configuration.yaml
rest_command:
  tentos_auto_update:
    url: "http://localhost:8099/api/updates/auto-update"
    method: POST

# In automations.yaml or via UI
automation:
  - alias: "TentOS Auto Update (Daily)"
    trigger:
      - platform: time
        at: "04:00:00"  # 4 AM daily
    action:
      - service: rest_command.tentos_auto_update`}</pre>
            </div>
            <p className="text-xs text-gray-500 mt-3">
              The API will check for updates and only install if a newer version is available.
            </p>
          </div>
        </div>
      )}

    </div>
  )
}
