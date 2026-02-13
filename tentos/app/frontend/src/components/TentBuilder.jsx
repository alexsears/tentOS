import { useState } from 'react'
import { useDroppable } from '@dnd-kit/core'

function Slot({ slotType, slotDef, entityIds, getEntity, onRemove, category, tentId, onSelect, isSelected, compact, customNames, onRename }) {
  const [editingEntity, setEditingEntity] = useState(null)
  const [editName, setEditName] = useState('')

  const { setNodeRef, isOver } = useDroppable({
    id: `${tentId}.${category}.${slotType}`,
    data: { slotType, slotDef, category, tentId, multiple: slotDef.multiple }
  })

  // Normalize to array
  const ids = Array.isArray(entityIds) ? entityIds : (entityIds ? [entityIds] : [])
  const isEmpty = ids.length === 0

  const handleClick = (e) => {
    if (onSelect) {
      e.stopPropagation()
      onSelect({ category, slotType, slotDef, tentId })
    }
  }

  const startRename = (e, entityId, entity) => {
    e.stopPropagation()
    setEditingEntity(entityId)
    setEditName(customNames?.[entityId] || entity?.friendly_name || '')
  }

  const saveRename = () => {
    if (editingEntity && onRename) {
      onRename(editingEntity, editName)
    }
    setEditingEntity(null)
  }

  // Compact mode for empty/unused slots
  if (compact && isEmpty) {
    return (
      <div
        ref={setNodeRef}
        onClick={handleClick}
        className={`px-2.5 py-1.5 rounded border border-dashed transition-all cursor-pointer flex items-center gap-1.5
          ${isOver
            ? 'border-green-500 bg-green-500/10'
            : isSelected
              ? 'border-green-500 bg-green-500/20'
              : 'border-[#2d3a5c] hover:border-[#3d4a6c]'
          }
          ${slotDef.required ? 'border-yellow-500/50' : ''}
        `}
      >
        <span className="text-sm">{slotDef.icon}</span>
        <span className="text-xs text-gray-500">{slotDef.label}</span>
      </div>
    )
  }

  return (
    <div
      ref={setNodeRef}
      onClick={handleClick}
      className={`p-3 rounded-lg border-2 border-dashed transition-all cursor-pointer
        ${isOver
          ? 'border-green-500 bg-green-500/10'
          : isSelected
            ? 'border-green-500 bg-green-500/20 ring-2 ring-green-500/50'
            : isEmpty
              ? 'border-[#2d3a5c] hover:border-[#3d4a6c]'
              : 'border-[#2d3a5c] bg-[#1a1a2e]'
        }
        ${slotDef.required && isEmpty && !isSelected ? 'border-yellow-500/50' : ''}
      `}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg">{slotDef.icon}</span>
        <span className="font-medium text-sm">{slotDef.label}</span>
        {slotDef.required && isEmpty && (
          <span className="text-xs text-yellow-500">Required</span>
        )}
        {ids.length > 0 && (
          <span className="text-xs text-gray-500">({ids.length})</span>
        )}
      </div>

      {isEmpty ? (
        <div className="text-xs text-gray-500 italic">
          Click or drop to add
        </div>
      ) : (
        <div className="mt-2">
          <div className="flex flex-wrap gap-1.5">
            {ids.map((entityId, idx) => {
              const entity = getEntity(entityId)
              const st = (entity?.state || '').toLowerCase()
              const isOn = st === 'on' || st === 'playing' || st === 'open'
              const isNumeric = entity?.state != null && !isNaN(parseFloat(entity?.state))
              const isSensor = entity?.domain === 'sensor' || entity?.domain === 'binary_sensor'

              let tileBg = 'bg-[#0d1117]'
              if (isOn) tileBg = 'bg-green-900/30 border border-green-600/50'

              let iconColor = 'text-gray-500'
              if (isOn) iconColor = 'text-green-400'
              else if (isNumeric) iconColor = 'text-cyan-300'

              let dotColor = 'bg-gray-600'
              if (isOn) dotColor = 'bg-green-400'
              else if (isNumeric) dotColor = 'bg-cyan-400'

              const name = customNames?.[entityId] || entity?.friendly_name || entityId.split('.').pop().replace(/_/g, ' ')

              return (
                <div key={entityId} className={'relative flex flex-col items-center justify-center p-2 rounded-lg transition-all min-w-[60px] ' + tileBg} title={entityId}>
                  {/* Status dot */}
                  <span className={'absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full ' + dotColor} />

                  {/* Icon */}
                  <span className={'text-lg ' + iconColor}>
                    {entity?.icon || slotDef.icon || '📍'}
                  </span>

                  {/* Value or state */}
                  {isSensor && isNumeric ? (
                    <span className="text-xs font-bold text-cyan-300">
                      {Number(entity.state).toFixed(1)}
                      {entity.unit && <span className="text-gray-500 ml-0.5" style={{ fontSize: 9 }}>{entity.unit}</span>}
                    </span>
                  ) : (
                    <span className={'text-xs ' + (isOn ? 'text-green-400 font-medium' : 'text-gray-500')}>
                      {isOn ? 'ON' : st === 'off' ? 'OFF' : st || '--'}
                    </span>
                  )}

                  {/* Name + entity ID */}
                  <span className={'text-xs truncate w-full text-center mt-0.5 ' + (customNames?.[entityId] ? 'text-blue-400' : 'text-gray-500')} style={{ fontSize: 9 }}>
                    {name}
                  </span>
                  <span className="text-gray-600 truncate w-full text-center" style={{ fontSize: 8 }}>
                    {entityId.split('.').pop()}
                  </span>

                  {/* Action buttons */}
                  <div className="flex gap-1 mt-1">
                    <button
                      onClick={(e) => startRename(e, entityId, entity)}
                      className="px-1.5 py-0.5 rounded text-gray-500 hover:text-blue-300 hover:bg-blue-500/20"
                      style={{ fontSize: 10 }}
                    >
                      ✏ Rename
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onRemove(category, slotType, idx) }}
                      className="px-1.5 py-0.5 rounded text-red-400/60 hover:text-red-300 hover:bg-red-500/20"
                      style={{ fontSize: 10 }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
          {slotDef.multiple && (
            <div className="text-xs text-gray-500 italic pt-1">+ Drop more</div>
          )}
        </div>
      )}

      {/* Rename modal */}
      {editingEntity && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => setEditingEntity(null)}>
          <div className="bg-[#16213e] rounded-lg p-4 w-80" onClick={e => e.stopPropagation()}>
            <h4 className="font-semibold mb-1">Rename Entity</h4>
            <p className="text-xs text-gray-500 mb-3">{editingEntity}</p>
            <input
              type="text"
              value={editName}
              onChange={e => setEditName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') setEditingEntity(null) }}
              className="input w-full mb-3"
              placeholder="Custom display name"
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setEditingEntity(null)} className="btn">Cancel</button>
              {customNames?.[editingEntity] && (
                <button onClick={() => { onRename(editingEntity, ''); setEditingEntity(null) }} className="btn text-red-400">Reset</button>
              )}
              <button onClick={saveRename} className="btn btn-primary">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ControlCustomizer({ tent, onUpdate }) {
  const [expanded, setExpanded] = useState(false)
  const [editingSlot, setEditingSlot] = useState(null)
  const [tempLabel, setTempLabel] = useState('')
  const [tempIcon, setTempIcon] = useState('')

  // Get current actuator slots that have entities assigned
  const configuredActuators = Object.keys(tent.actuators || {}).filter(
    slot => tent.actuators[slot]
  )

  // Get ordered list (custom order or default)
  const getOrderedList = () => {
    const order = tent.control_settings?.order
    if (order && Array.isArray(order)) {
      const ordered = order.filter(s => configuredActuators.includes(s))
      const remaining = configuredActuators.filter(s => !ordered.includes(s))
      return [...ordered, ...remaining]
    }
    return configuredActuators
  }

  const orderedActuators = getOrderedList()

  const moveUp = (slot) => {
    const idx = orderedActuators.indexOf(slot)
    if (idx <= 0) return
    const newOrder = [...orderedActuators]
    ;[newOrder[idx - 1], newOrder[idx]] = [newOrder[idx], newOrder[idx - 1]]
    onUpdate({
      ...tent,
      control_settings: { ...tent.control_settings, order: newOrder }
    })
  }

  const moveDown = (slot) => {
    const idx = orderedActuators.indexOf(slot)
    if (idx >= orderedActuators.length - 1) return
    const newOrder = [...orderedActuators]
    ;[newOrder[idx], newOrder[idx + 1]] = [newOrder[idx + 1], newOrder[idx]]
    onUpdate({
      ...tent,
      control_settings: { ...tent.control_settings, order: newOrder }
    })
  }

  const startEdit = (slot) => {
    setEditingSlot(slot)
    setTempLabel(tent.control_settings?.labels?.[slot] || '')
    setTempIcon(tent.control_settings?.icons?.[slot] || '')
  }

  const saveEdit = () => {
    const labels = { ...(tent.control_settings?.labels || {}) }
    const icons = { ...(tent.control_settings?.icons || {}) }

    if (tempLabel.trim()) {
      labels[editingSlot] = tempLabel.trim()
    } else {
      delete labels[editingSlot]
    }

    if (tempIcon.trim()) {
      icons[editingSlot] = tempIcon.trim()
    } else {
      delete icons[editingSlot]
    }

    onUpdate({
      ...tent,
      control_settings: { ...tent.control_settings, labels, icons }
    })
    setEditingSlot(null)
  }

  const defaultLabels = {
    light: 'Light', exhaust_fan: 'Exhaust', circulation_fan: 'Circ Fan',
    humidifier: 'Humid', dehumidifier: 'Dehumid', heater: 'Heater',
    ac: 'A/C', water_pump: 'Water', drain_pump: 'Drain'
  }

  const defaultIcons = {
    light: '💡', exhaust_fan: '🌀', circulation_fan: '🔄',
    humidifier: '💨', dehumidifier: '🏜️', heater: '🔥',
    ac: '❄️', water_pump: '🚿', drain_pump: '🔽'
  }

  if (configuredActuators.length === 0) return null

  return (
    <div className="mt-4 pt-4 border-t border-[#2d3a5c]">
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-sm font-medium text-gray-400 hover:text-white flex items-center gap-2 px-2 py-1 rounded hover:bg-[#2d3a5c]"
      >
        <span>{expanded ? '▼' : '▶'}</span>
        Customize Controls
      </button>
      {expanded && <div className="space-y-1 mt-2">
        {orderedActuators.map((slot, idx) => {
          const label = tent.control_settings?.labels?.[slot] || defaultLabels[slot] || slot
          const icon = tent.control_settings?.icons?.[slot] || defaultIcons[slot] || '⚡'

          return (
            <div key={slot} className="flex items-center gap-2 bg-[#1a1a2e] rounded p-2">
              {/* Reorder buttons */}
              <div className="flex flex-col gap-0.5">
                <button
                  onClick={() => moveUp(slot)}
                  disabled={idx === 0}
                  className="px-2 py-1 text-sm text-gray-400 hover:text-white hover:bg-[#2d3a5c] rounded disabled:opacity-30"
                >▲</button>
                <button
                  onClick={() => moveDown(slot)}
                  disabled={idx === orderedActuators.length - 1}
                  className="px-2 py-1 text-sm text-gray-400 hover:text-white hover:bg-[#2d3a5c] rounded disabled:opacity-30"
                >▼</button>
              </div>

              {/* Icon and label */}
              <span className="text-lg">{icon}</span>
              <span className="flex-1 text-sm">{label}</span>
              <span className="text-xs text-gray-500">{slot}</span>

              {/* Edit button */}
              <button
                onClick={() => startEdit(slot)}
                className="px-2 py-1 hover:bg-[#2d3a5c] rounded text-gray-400 hover:text-white text-sm"
              >✏️ Edit</button>
            </div>
          )
        })}
      </div>}

      {/* Edit modal */}
      {editingSlot && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => setEditingSlot(null)}>
          <div className="bg-[#16213e] rounded-lg p-4 w-80" onClick={e => e.stopPropagation()}>
            <h4 className="font-semibold mb-3">Edit "{editingSlot}"</h4>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Custom Label</label>
                <input
                  type="text"
                  value={tempLabel}
                  onChange={e => setTempLabel(e.target.value)}
                  placeholder={defaultLabels[editingSlot] || editingSlot}
                  className="input w-full"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Custom Icon (emoji)</label>
                <input
                  type="text"
                  value={tempIcon}
                  onChange={e => setTempIcon(e.target.value)}
                  placeholder={defaultIcons[editingSlot] || '⚡'}
                  className="input w-full"
                  maxLength={4}
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setEditingSlot(null)} className="btn">Cancel</button>
                <button onClick={saveEdit} className="btn btn-primary">Save</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function TentCard({ tent, slots, entities, onUpdate, onDelete, onSlotSelect, selectedSlot, customNames, onRename }) {
  const [expanded, setExpanded] = useState(true)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(tent.name)
  const [description, setDescription] = useState(tent.description || '')

  // Get entity details by ID
  const getEntity = (entityId) => entities.find(e => e.entity_id === entityId)

  // Remove an entity from a slot (by index for arrays)
  const removeFromSlot = (category, slotType, index) => {
    const updated = { ...tent }
    if (updated[category]) {
      updated[category] = { ...updated[category] }
      const current = updated[category][slotType]
      if (Array.isArray(current)) {
        updated[category][slotType] = current.filter((_, i) => i !== index)
        if (updated[category][slotType].length === 0) {
          delete updated[category][slotType]
        }
      } else {
        delete updated[category][slotType]
      }
    }
    onUpdate(updated)
  }

  // Save name/description
  const saveInfo = () => {
    onUpdate({ ...tent, name, description })
    setEditing(false)
  }

  // Count filled slots
  const sensorCount = Object.values(tent.sensors || {}).filter(Boolean).length
  const actuatorCount = Object.values(tent.actuators || {}).filter(Boolean).length

  return (
    <div className="card">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-lg"
        >
          {expanded ? '▼' : '▶'}
        </button>

        {editing ? (
          <div className="flex-1 flex gap-2">
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="input flex-1"
              placeholder="Tent name"
            />
            <button onClick={saveInfo} className="btn btn-primary">Save</button>
            <button onClick={() => setEditing(false)} className="btn">Cancel</button>
          </div>
        ) : (
          <>
            <div className="flex-1">
              <h3 className="font-semibold text-lg">{tent.name}</h3>
              {tent.description && (
                <p className="text-sm text-gray-400">{tent.description}</p>
              )}
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <span>{sensorCount} sensors</span>
              <span>•</span>
              <span>{actuatorCount} actuators</span>
            </div>
            <button
              onClick={() => setEditing(true)}
              className="px-2 py-1 hover:bg-[#2d3a5c] rounded text-sm"
            >
              ✏️ Edit
            </button>
            <button
              onClick={() => onDelete(tent.id)}
              className="px-2 py-1 hover:bg-red-500/20 rounded text-red-400 text-sm"
            >
              🗑️ Delete
            </button>
          </>
        )}
      </div>

      {/* Slots */}
      {expanded && (() => {
        // Split slots into used (have entities) and unused (empty)
        const sensorEntries = Object.entries(slots?.sensors || {})
        const actuatorEntries = Object.entries(slots?.actuators || {})

        const usedSensors = sensorEntries.filter(([st]) => tent.sensors?.[st])
        const unusedSensors = sensorEntries.filter(([st]) => !tent.sensors?.[st])
        const usedActuators = actuatorEntries.filter(([st]) => tent.actuators?.[st])
        const unusedActuators = actuatorEntries.filter(([st]) => !tent.actuators?.[st])

        const hasUsed = usedSensors.length > 0 || usedActuators.length > 0
        const hasUnused = unusedSensors.length > 0 || unusedActuators.length > 0

        return (
          <div className="space-y-4">
            {/* Used/configured slots */}
            {usedSensors.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-gray-400 mb-2">Sensors</h4>
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
                  {usedSensors.map(([slotType, slotDef]) => (
                    <Slot
                      key={slotType}
                      slotType={slotType}
                      slotDef={slotDef}
                      entityIds={tent.sensors?.[slotType]}
                      getEntity={getEntity}
                      onRemove={removeFromSlot}
                      category="sensors"
                      tentId={tent.id}
                      onSelect={onSlotSelect}
                      isSelected={selectedSlot?.tentId === tent.id && selectedSlot?.category === 'sensors' && selectedSlot?.slotType === slotType}
                      customNames={customNames}
                      onRename={onRename}
                    />
                  ))}
                </div>
              </div>
            )}

            {usedActuators.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-gray-400 mb-2">Actuators</h4>
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
                  {usedActuators.map(([slotType, slotDef]) => (
                    <Slot
                      key={slotType}
                      slotType={slotType}
                      slotDef={slotDef}
                      entityIds={tent.actuators?.[slotType]}
                      getEntity={getEntity}
                      onRemove={removeFromSlot}
                      category="actuators"
                      tentId={tent.id}
                      onSelect={onSlotSelect}
                      isSelected={selectedSlot?.tentId === tent.id && selectedSlot?.category === 'actuators' && selectedSlot?.slotType === slotType}
                      customNames={customNames}
                      onRename={onRename}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Unused/available slots - compact */}
            {hasUnused && (
              <div className="pt-2 border-t border-[#2d3a5c]">
                <h4 className="text-xs font-medium text-gray-500 mb-2">Available Slots</h4>
                <div className="flex flex-wrap gap-1.5">
                  {unusedSensors.map(([slotType, slotDef]) => (
                    <Slot
                      key={slotType}
                      slotType={slotType}
                      slotDef={slotDef}
                      entityIds={tent.sensors?.[slotType]}
                      getEntity={getEntity}
                      onRemove={removeFromSlot}
                      category="sensors"
                      tentId={tent.id}
                      onSelect={onSlotSelect}
                      isSelected={selectedSlot?.tentId === tent.id && selectedSlot?.category === 'sensors' && selectedSlot?.slotType === slotType}
                      compact
                    />
                  ))}
                  {unusedActuators.map(([slotType, slotDef]) => (
                    <Slot
                      key={slotType}
                      slotType={slotType}
                      slotDef={slotDef}
                      entityIds={tent.actuators?.[slotType]}
                      getEntity={getEntity}
                      onRemove={removeFromSlot}
                      category="actuators"
                      tentId={tent.id}
                      onSelect={onSlotSelect}
                      isSelected={selectedSlot?.tentId === tent.id && selectedSlot?.category === 'actuators' && selectedSlot?.slotType === slotType}
                      compact
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Control Customization */}
            <ControlCustomizer tent={tent} onUpdate={onUpdate} />
          </div>
        )
      })()}
    </div>
  )
}

export default function TentBuilder({ config, slots, entities, onConfigChange, onSlotSelect, selectedSlot }) {
  // Generate unique tent ID
  const generateId = () => `tent_${Date.now()}`

  // Add new tent
  const addTent = () => {
    const newTent = {
      id: generateId(),
      name: `Tent ${(config.tents?.length || 0) + 1}`,
      description: '',
      sensors: {},
      actuators: {}
    }

    onConfigChange({
      ...config,
      tents: [...(config.tents || []), newTent]
    })
  }

  // Update a tent
  const updateTent = (tentId, updatedTent) => {
    onConfigChange({
      ...config,
      tents: config.tents.map(t => t.id === tentId ? updatedTent : t)
    })
  }

  // Delete a tent
  const deleteTent = (tentId) => {
    if (confirm('Delete this tent? This cannot be undone.')) {
      onConfigChange({
        ...config,
        tents: config.tents.filter(t => t.id !== tentId)
      })
    }
  }

  // Rename an entity (custom display name)
  const handleRename = (entityId, newName) => {
    const customNames = { ...(config.customNames || {}) }
    if (newName.trim()) {
      customNames[entityId] = newName.trim()
    } else {
      delete customNames[entityId]
    }
    onConfigChange({ ...config, customNames })
  }

  // Get all assigned entities across all tents
  const assignedEntities = {}
  for (const tent of config.tents || []) {
    for (const [key, val] of Object.entries(tent.sensors || {})) {
      if (val) assignedEntities[`${tent.id}.sensors.${key}`] = val
    }
    for (const [key, val] of Object.entries(tent.actuators || {})) {
      if (val) assignedEntities[`${tent.id}.actuators.${key}`] = val
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Your Tents</h3>
        <button onClick={addTent} className="btn btn-primary">
          + Add Tent
        </button>
      </div>

      {(!config.tents || config.tents.length === 0) ? (
        <div className="card text-center py-8">
          <p className="text-gray-400 mb-4">No tents configured yet</p>
          <button onClick={addTent} className="btn btn-primary">
            Create Your First Tent
          </button>
        </div>
      ) : (
        config.tents.map(tent => (
          <TentCard
            key={tent.id}
            tent={tent}
            slots={slots}
            entities={entities}
            onUpdate={(updated) => updateTent(tent.id, updated)}
            onDelete={deleteTent}
            onSlotSelect={onSlotSelect}
            selectedSlot={selectedSlot}
            customNames={config.customNames}
            onRename={handleRename}
          />
        ))
      )}
    </div>
  )
}
