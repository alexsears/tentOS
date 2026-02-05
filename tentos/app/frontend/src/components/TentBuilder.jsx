import { useState } from 'react'
import { useDroppable } from '@dnd-kit/core'

function Slot({ slotType, slotDef, entityIds, getEntity, onRemove, category, tentId, onSelect, isSelected }) {
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
        <div className="space-y-1 mt-2">
          {ids.map((entityId, idx) => {
            const entity = getEntity(entityId)
            return (
              <div key={entityId} className="flex items-center gap-2 bg-[#0d1117] rounded px-2 py-1">
                <div className="flex-1 min-w-0">
                  <div className="text-xs truncate">
                    {entity?.friendly_name || entityId}
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); onRemove(category, slotType, idx) }}
                  className="p-0.5 hover:bg-red-500/20 rounded text-red-400 hover:text-red-300 text-xs"
                  title="Remove"
                >
                  ✕
                </button>
              </div>
            )
          })}
          <div className="text-xs text-gray-500 italic pt-1">+ Drop more</div>
        </div>
      )}
    </div>
  )
}

function TentCard({ tent, slots, entities, onUpdate, onDelete, onSlotSelect, selectedSlot }) {
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
              className="p-2 hover:bg-[#2d3a5c] rounded"
              title="Edit"
            >
              ✏️
            </button>
            <button
              onClick={() => onDelete(tent.id)}
              className="p-2 hover:bg-red-500/20 rounded text-red-400"
              title="Delete tent"
            >
              🗑️
            </button>
          </>
        )}
      </div>

      {/* Slots */}
      {expanded && (
        <div className="space-y-4">
          {/* Sensors */}
          <div>
            <h4 className="text-sm font-medium text-gray-400 mb-2">Sensors</h4>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
              {Object.entries(slots?.sensors || {}).map(([slotType, slotDef]) => (
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
                />
              ))}
            </div>
          </div>

          {/* Actuators */}
          <div>
            <h4 className="text-sm font-medium text-gray-400 mb-2">Actuators</h4>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
              {Object.entries(slots?.actuators || {}).map(([slotType, slotDef]) => (
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
                />
              ))}
            </div>
          </div>
        </div>
      )}
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
          />
        ))
      )}
    </div>
  )
}
