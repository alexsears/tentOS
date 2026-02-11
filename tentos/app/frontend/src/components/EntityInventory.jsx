import { useState, useMemo } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'

// Domains relevant for grow tent management
const ALLOWED_DOMAINS = new Set([
  'sensor',        // Temperature, humidity, CO2, water level, VPD, etc.
  'binary_sensor', // Leak sensors, motion, door/window
  'switch',        // Smart plugs for lights, fans, pumps
  'light',         // Grow lights with dimming
  'climate',       // HVAC units
  'humidifier',    // Humidifiers/dehumidifiers
  'water_heater',  // Reservoir heaters
  'counter',       // Event counters
  'camera',        // Tent cameras
  'cover',         // Motorized vents/covers
  'button',        // Trigger buttons
])

// Domain display info
const DOMAIN_INFO = {
  sensor: { icon: '📡', label: 'Sensors', order: 1 },
  binary_sensor: { icon: '🚨', label: 'Binary Sensors', order: 2 },
  switch: { icon: '🔌', label: 'Switches', order: 3 },
  light: { icon: '💡', label: 'Lights', order: 4 },
  climate: { icon: '🌡️', label: 'Climate', order: 5 },
  humidifier: { icon: '💨', label: 'Humidifiers', order: 6 },
  water_heater: { icon: '🔥', label: 'Water Heaters', order: 7 },
  counter: { icon: '🔢', label: 'Counters', order: 8 },
  camera: { icon: '📷', label: 'Cameras', order: 9 },
  cover: { icon: '🚪', label: 'Covers', order: 10 },
  button: { icon: '🔘', label: 'Buttons', order: 11 },
}

function DraggableEntity({ entity, slotType, isSelected, onToggleSelect }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: entity.entity_id,
    data: { entity, slotType }
  })

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
  }

  const handleClick = () => {
    onToggleSelect(entity.entity_id)
  }

  const st = (entity.state || '').toLowerCase()
  const isOn = st === 'on' || st === 'playing' || st === 'open'
  const isOff = st === 'off' || st === 'closed' || st === 'false'
  const isNumeric = entity.state != null && !isNaN(parseFloat(entity.state))
  const isSensor = entity.domain === 'sensor' || entity.domain === 'binary_sensor'

  // Card background - matches ActuatorButton style
  let cardClass = 'bg-[#1a1a2e] hover:bg-[#2d3a5c] border border-transparent'
  if (isSelected) {
    cardClass = 'bg-green-900/30 hover:bg-green-900/50 border border-green-500'
  } else if (isOn) {
    cardClass = 'bg-green-900/30 hover:bg-green-900/50 border border-green-600/50'
  }

  // Status dot color
  let dotColor = 'bg-gray-600'
  if (isOn) dotColor = 'bg-green-400'
  else if (isNumeric) dotColor = 'bg-cyan-400'

  // Icon color
  let iconColor = 'text-gray-500'
  if (isOn) iconColor = 'text-green-400'
  else if (isNumeric) iconColor = 'text-cyan-300'

  // State value display
  let stateColor = 'text-gray-500'
  let displayValue = st || '--'
  if (isSensor && isNumeric) {
    displayValue = Number(entity.state).toFixed(1)
    stateColor = 'text-cyan-300'
  } else if (isOn) {
    stateColor = 'text-green-400'
  }

  // Friendly name shortened for tile
  const name = entity.friendly_name || entity.entity_id.split('.').pop().replace(/_/g, ' ')

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={handleClick}
      className={'relative flex flex-col items-center justify-center p-3 rounded-lg transition-all duration-200 cursor-grab ' + cardClass + (isDragging ? ' ring-2 ring-green-500' : '')}
      title={entity.entity_id}
    >
      {/* Status dot */}
      <span className={'absolute top-1 right-1 w-2 h-2 rounded-full ' + dotColor} />

      {/* Selection check */}
      {isSelected && (
        <span className="absolute top-1 left-1 text-green-400 text-xs">✓</span>
      )}

      {/* Icon - large and centered like dashboard */}
      <span className={'text-2xl ' + iconColor}>
        {entity.icon || DOMAIN_INFO[entity.domain]?.icon || '📍'}
      </span>

      {/* Value for sensors, state for actuators */}
      {isSensor && isNumeric ? (
        <div className="text-center mt-1">
          <span className={'text-lg font-bold ' + stateColor}>
            {displayValue}
          </span>
          {entity.unit && (
            <span className="text-xs text-gray-500 ml-0.5">{entity.unit}</span>
          )}
        </div>
      ) : (
        <span className={'text-xs mt-1 font-medium ' + stateColor}>
          {isOn ? 'ON' : isOff ? 'OFF' : displayValue}
        </span>
      )}

      {/* Label */}
      <span className={'text-xs mt-0.5 text-center truncate w-full ' + (isOn ? 'text-white' : 'text-gray-500')}>
        {name}
      </span>
    </div>
  )
}

export default function EntityInventory({
  entities,
  slots,
  assignedEntities = {},
  slotFilter,
  onClearFilter,
  selectedEntities = [],
  onToggleSelect,
  onSelectAll,
  onDeselectAll,
  onAddSelected
}) {
  const [search, setSearch] = useState('')
  const [domainFilter, setDomainFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [collapsedDomains, setCollapsedDomains] = useState(new Set())

  // Toggle domain collapse
  const toggleDomain = (domain) => {
    setCollapsedDomains(prev => {
      const next = new Set(prev)
      if (next.has(domain)) {
        next.delete(domain)
      } else {
        next.add(domain)
      }
      return next
    })
  }

  // Filter to only allowed domains and exclude unavailable entities
  const relevantEntities = useMemo(() => {
    return entities.filter(e =>
      ALLOWED_DOMAINS.has(e.domain) &&
      e.state !== 'unavailable' &&
      e.state !== 'unknown'
    )
  }, [entities])

  // Get unique domains from relevant entities only
  const domains = useMemo(() => {
    const domainSet = new Set(relevantEntities.map(e => e.domain))
    return Array.from(domainSet).sort((a, b) => {
      const orderA = DOMAIN_INFO[a]?.order || 99
      const orderB = DOMAIN_INFO[b]?.order || 99
      return orderA - orderB
    })
  }, [relevantEntities])

  // Build slot compatibility map
  const slotCompatibility = useMemo(() => {
    const map = {}
    if (!slots) return map

    for (const [category, categorySlots] of Object.entries(slots)) {
      for (const [slotType, slotDef] of Object.entries(categorySlots)) {
        for (const domain of slotDef.domains || []) {
          if (!map[domain]) map[domain] = []
          map[domain].push({ slotType, category, ...slotDef })
        }
      }
    }
    return map
  }, [slots])

  // Get assigned entity IDs to filter them out
  const assignedIds = useMemo(() => {
    const ids = new Set()
    for (const entityId of Object.values(assignedEntities)) {
      if (entityId) ids.add(entityId)
    }
    return ids
  }, [assignedEntities])

  // Filter entities (using relevantEntities which is already filtered to allowed domains)
  const filteredEntities = useMemo(() => {
    return relevantEntities.filter(entity => {
      // Exclude already assigned
      if (assignedIds.has(entity.entity_id)) return false

      // If slot filter is active, filter by slot's domains and device_classes
      if (slotFilter?.slotDef) {
        const { domains = [], device_classes = [] } = slotFilter.slotDef
        // Must match domain
        if (domains.length > 0 && !domains.includes(entity.domain)) return false
        // If device_classes specified, must match (allow null in device_classes to match any)
        if (device_classes.length > 0 && !device_classes.includes(null) && !device_classes.includes(entity.device_class)) return false
        // Apply search within slot-filtered results
        if (search) {
          const searchLower = search.toLowerCase()
          const matchesId = entity.entity_id.toLowerCase().includes(searchLower)
          const matchesName = entity.friendly_name?.toLowerCase().includes(searchLower)
          if (!matchesId && !matchesName) return false
        }
        return true
      }

      // Search filter
      if (search) {
        const searchLower = search.toLowerCase()
        const matchesId = entity.entity_id.toLowerCase().includes(searchLower)
        const matchesName = entity.friendly_name?.toLowerCase().includes(searchLower)
        if (!matchesId && !matchesName) return false
      }

      // Domain filter
      if (domainFilter && entity.domain !== domainFilter) return false

      // Category filter (sensors vs actuators)
      if (categoryFilter !== 'all') {
        const compatible = slotCompatibility[entity.domain] || []
        const hasCategory = compatible.some(s => s.category === categoryFilter)
        if (!hasCategory) return false
      }

      return true
    })
  }, [relevantEntities, search, domainFilter, categoryFilter, assignedIds, slotCompatibility, slotFilter])

  // Group by domain
  const groupedEntities = useMemo(() => {
    const groups = {}
    for (const entity of filteredEntities) {
      if (!groups[entity.domain]) groups[entity.domain] = []
      groups[entity.domain].push(entity)
    }
    return groups
  }, [filteredEntities])

  // Find compatible slot type for entity
  const getSlotType = (entity) => {
    const compatible = slotCompatibility[entity.domain] || []
    // Match by device_class if available
    if (entity.device_class) {
      const match = compatible.find(s =>
        s.device_classes?.includes(entity.device_class)
      )
      if (match) return match.slotType
    }
    // Fallback to first compatible
    return compatible[0]?.slotType || null
  }

  // Count selected entities that are visible
  const visibleSelectedCount = filteredEntities.filter(e => selectedEntities.includes(e.entity_id)).length
  const allVisibleSelected = filteredEntities.length > 0 && visibleSelectedCount === filteredEntities.length

  const handleSelectAllVisible = () => {
    const visibleIds = filteredEntities.map(e => e.entity_id)
    if (allVisibleSelected) {
      onDeselectAll()
    } else {
      onSelectAll(visibleIds)
    }
  }

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-[#2d3a5c] space-y-2">
        <h3 className="font-semibold text-sm">Available Entities</h3>

        {/* Slot filter indicator */}
        {slotFilter && (
          <div className="flex items-center gap-2 p-2 bg-green-500/20 border border-green-500/50 rounded text-sm">
            <span className="text-lg">{slotFilter.slotDef?.icon}</span>
            <div className="flex-1">
              <span className="text-green-400">Adding to: </span>
              <span className="font-medium">{slotFilter.slotDef?.label}</span>
            </div>
            <button
              onClick={onClearFilter}
              className="px-2 py-1 text-xs bg-green-600 hover:bg-green-700 rounded"
            >
              Done
            </button>
          </div>
        )}

        <input
          type="text"
          placeholder="Search entities..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="input w-full text-sm"
        />

        {!slotFilter && (
          <div className="flex gap-2">
            <select
              value={categoryFilter}
              onChange={e => setCategoryFilter(e.target.value)}
              className="input flex-1 text-sm"
            >
              <option value="all">All Types</option>
              <option value="sensors">Sensors</option>
              <option value="actuators">Actuators</option>
            </select>

            <select
              value={domainFilter}
              onChange={e => setDomainFilter(e.target.value)}
              className="input flex-1 text-sm"
            >
              <option value="">All Domains</option>
              {domains.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
        )}

        {/* Selection controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleSelectAllVisible}
            className="text-xs text-gray-400 hover:text-white"
          >
            {allVisibleSelected ? '☑ Deselect All' : '☐ Select All'}
          </button>

          {visibleSelectedCount > 0 && (
            <span className="text-xs text-green-400">
              {visibleSelectedCount} selected
            </span>
          )}
        </div>

        {/* Add Selected button */}
        {slotFilter && visibleSelectedCount > 0 && (
          <button
            onClick={() => onAddSelected(slotFilter)}
            className="w-full btn btn-primary text-sm py-2"
          >
            + Add {visibleSelectedCount} to {slotFilter.slotDef?.label}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {Object.keys(groupedEntities).length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            {entities.length === 0 ? 'Loading entities...' : 'No matching entities'}
          </div>
        ) : (
          Object.entries(groupedEntities)
            .sort(([a], [b]) => {
              const orderA = DOMAIN_INFO[a]?.order || 99
              const orderB = DOMAIN_INFO[b]?.order || 99
              return orderA - orderB
            })
            .map(([domain, domainEntities]) => {
              const info = DOMAIN_INFO[domain] || { icon: '📦', label: domain }
              const isCollapsed = collapsedDomains.has(domain)

              return (
                <div key={domain} className="border border-[#2d3a5c] rounded overflow-hidden">
                  {/* Collapsible header */}
                  <button
                    onClick={() => toggleDomain(domain)}
                    className="w-full flex items-center gap-2 px-3 py-2 bg-[#1a1a2e] hover:bg-[#252545] transition-colors text-left"
                  >
                    <span className="text-sm">{isCollapsed ? '▶' : '▼'}</span>
                    <span className="text-lg">{info.icon}</span>
                    <span className="flex-1 text-sm font-medium">{info.label}</span>
                    <span className="text-xs text-gray-400 bg-[#2d3a5c] px-2 py-0.5 rounded-full">
                      {domainEntities.length}
                    </span>
                  </button>

                  {/* Collapsible content - grid layout like dashboard */}
                  {!isCollapsed && (
                    <div className="p-2 bg-[#0d0d1a]">
                      <div className="grid grid-cols-3 gap-1.5">
                        {domainEntities.slice(0, 50).map(entity => (
                          <DraggableEntity
                            key={entity.entity_id}
                            entity={entity}
                            slotType={getSlotType(entity)}
                            isSelected={selectedEntities.includes(entity.entity_id)}
                            onToggleSelect={onToggleSelect}
                          />
                        ))}
                      </div>
                      {domainEntities.length > 50 && (
                        <div className="text-xs text-gray-500 text-center py-2">
                          +{domainEntities.length - 50} more (use search to filter)
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })
        )}
      </div>

      <div className="p-2 border-t border-[#2d3a5c] text-xs text-gray-500 text-center">
        {filteredEntities.length} of {relevantEntities.length} entities
        {selectedEntities.length > 0 && ` • ${selectedEntities.length} selected`}
      </div>
    </div>
  )
}
