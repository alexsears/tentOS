import { useState } from 'react'
import { useDroppable } from '@dnd-kit/core'

function Slot({ slotType, slotDef, entityId, entity, onClear, category, tentId, onSelect, isSelected }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `${tentId}.${category}.${slotType}`,
    data: { slotType, slotDef, category, tentId }
  })

  const isEmpty = !entityId

  const handleClick = (e) => {
    if (isEmpty && onSelect) {
      e.stopPropagation()
      onSelect({ category, slotType, slotDef })
    }
  }

  return (
    <div
      ref={setNodeRef}
      onClick={handleClick}
      className={`p-3 rounded-lg border-2 border-dashed transition-all
        ${isEmpty
          ? isOver
            ? 'border-green-500 bg-green-500/10'
            : isSelected
              ? 'border-green-500 bg-green-500/20 ring-2 ring-green-500/50'
              : 'border-[#2d3a5c] hover:border-[#3d4a6c] cursor-pointer'
          : 'border-transparent bg-[#1a1a2e]'
        }
        ${slotDef.required && isEmpty && !isSelected ? 'border-yellow-500/50' : ''}
      `}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg">{slotDef.icon}</span>
        <span className="font-medium text-sm">{slotDef.label}</span>
        {slotDef.required && (
          <span className="text-xs text-yellow-500">Required</span>
        )}
      </div>

      {isEmpty ? (
        <div className="text-xs text-gray-500 italic">
          Drop {slotDef.domains?.join(' or ')} here
        </div>
      ) : (
        <div className="flex items-center gap-2 mt-2">
          <div className="flex-1 min-w-0">
            <div className="text-sm truncate">
              {entity?.friendly_name || entityId}
            </div>
            <div className="text-xs text-gray-500 font-mono truncate">
              {entityId}
            </div>
          </div>
          <button
            onClick={() => onClear(category, slotType)}
            className="p-1 hover:bg-red-500/20 rounded text-red-400 hover:text-red-300"
            title="Remove"
          >
            ✕
          </button>
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

  // Clear a slot
  const clearSlot = (category, slotType) => {
    const updated = { ...tent }
    if (updated[category]) {
      updated[category] = { ...updated[category] }
      delete updated[category][slotType]
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
                  entityId={tent.sensors?.[slotType]}
                  entity={getEntity(tent.sensors?.[slotType])}
                  onClear={clearSlot}
                  category="sensors"
                  tentId={tent.id}
                  onSelect={onSlotSelect}
                  isSelected={selectedSlot?.category === 'sensors' && selectedSlot?.slotType === slotType}
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
                  entityId={tent.actuators?.[slotType]}
                  entity={getEntity(tent.actuators?.[slotType])}
                  onClear={clearSlot}
                  category="actuators"
                  tentId={tent.id}
                  onSelect={onSlotSelect}
                  isSelected={selectedSlot?.category === 'actuators' && selectedSlot?.slotType === slotType}
                />
              ))}
            </div>
          </div>

          {/* Targets */}
          <div>
            <h4 className="text-sm font-medium text-gray-400 mb-2">Targets</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="text-xs text-gray-500">Day Temp (min-max)</label>
                <div className="flex gap-1">
                  <input
                    type="number"
                    value={tent.targets?.temp_day_min || ''}
                    onChange={e => onUpdate({
                      ...tent,
                      targets: { ...tent.targets, temp_day_min: parseFloat(e.target.value) || 0 }
                    })}
                    className="input w-16 text-sm"
                    placeholder="22"
                  />
                  <input
                    type="number"
                    value={tent.targets?.temp_day_max || ''}
                    onChange={e => onUpdate({
                      ...tent,
                      targets: { ...tent.targets, temp_day_max: parseFloat(e.target.value) || 0 }
                    })}
                    className="input w-16 text-sm"
                    placeholder="28"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500">Night Temp (min-max)</label>
                <div className="flex gap-1">
                  <input
                    type="number"
                    value={tent.targets?.temp_night_min || ''}
                    onChange={e => onUpdate({
                      ...tent,
                      targets: { ...tent.targets, temp_night_min: parseFloat(e.target.value) || 0 }
                    })}
                    className="input w-16 text-sm"
                    placeholder="18"
                  />
                  <input
                    type="number"
                    value={tent.targets?.temp_night_max || ''}
                    onChange={e => onUpdate({
                      ...tent,
                      targets: { ...tent.targets, temp_night_max: parseFloat(e.target.value) || 0 }
                    })}
                    className="input w-16 text-sm"
                    placeholder="24"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500">Day Humidity (min-max)</label>
                <div className="flex gap-1">
                  <input
                    type="number"
                    value={tent.targets?.humidity_day_min || ''}
                    onChange={e => onUpdate({
                      ...tent,
                      targets: { ...tent.targets, humidity_day_min: parseFloat(e.target.value) || 0 }
                    })}
                    className="input w-16 text-sm"
                    placeholder="50"
                  />
                  <input
                    type="number"
                    value={tent.targets?.humidity_day_max || ''}
                    onChange={e => onUpdate({
                      ...tent,
                      targets: { ...tent.targets, humidity_day_max: parseFloat(e.target.value) || 0 }
                    })}
                    className="input w-16 text-sm"
                    placeholder="70"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500">Night Humidity (min-max)</label>
                <div className="flex gap-1">
                  <input
                    type="number"
                    value={tent.targets?.humidity_night_min || ''}
                    onChange={e => onUpdate({
                      ...tent,
                      targets: { ...tent.targets, humidity_night_min: parseFloat(e.target.value) || 0 }
                    })}
                    className="input w-16 text-sm"
                    placeholder="50"
                  />
                  <input
                    type="number"
                    value={tent.targets?.humidity_night_max || ''}
                    onChange={e => onUpdate({
                      ...tent,
                      targets: { ...tent.targets, humidity_night_max: parseFloat(e.target.value) || 0 }
                    })}
                    className="input w-16 text-sm"
                    placeholder="65"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Schedules */}
          <div>
            <h4 className="text-sm font-medium text-gray-400 mb-2">Schedules</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="text-xs text-gray-500">Lights On</label>
                <input
                  type="time"
                  value={tent.schedules?.photoperiod_on || '06:00'}
                  onChange={e => onUpdate({
                    ...tent,
                    schedules: { ...tent.schedules, photoperiod_on: e.target.value }
                  })}
                  className="input w-full text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">Lights Off</label>
                <input
                  type="time"
                  value={tent.schedules?.photoperiod_off || '22:00'}
                  onChange={e => onUpdate({
                    ...tent,
                    schedules: { ...tent.schedules, photoperiod_off: e.target.value }
                  })}
                  className="input w-full text-sm"
                />
              </div>
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
      actuators: {},
      targets: {
        temp_day_min: 22,
        temp_day_max: 28,
        temp_night_min: 18,
        temp_night_max: 24,
        humidity_day_min: 50,
        humidity_day_max: 70,
        humidity_night_min: 50,
        humidity_night_max: 65
      },
      schedules: {
        photoperiod_on: '06:00',
        photoperiod_off: '22:00'
      },
      notifications: { enabled: true }
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
