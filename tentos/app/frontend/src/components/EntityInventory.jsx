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

  const handleCheckboxClick = (e) => {
    e.stopPropagation()
    onToggleSelect(entity.entity_id)
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`p-2 bg-[#1a1a2e] rounded border transition-colors
        ${isSelected
          ? 'border-green-500 bg-green-500/10'
          : 'border-[#2d3a5c] hover:border-green-500/50 hover:bg-[#1a1a2e]/80'
        }
        ${isDragging ? 'ring-2 ring-green-500' : ''}`}
    >
      <div className="flex items-center gap-2">
        {/* Checkbox */}
        <input
          type="checkbox"
          checked={isSelected}
          onChange={handleCheckboxClick}
          className="w-4 h-4 accent-green-500 cursor-pointer flex-shrink-0"
        />

        {/* Draggable area */}
        <div
          {...listeners}
          {...attributes}
          className="flex-1 min-w-0 flex items-center gap-2 cursor-grab"
        >
          <span className="text-lg">{entity.icon || '📍'}</span>
          <div className="flex-1 min-w-0">
            <div className="font-medium truncate text-sm">
              {entity.friendly_name || entity.entity_id}
            </div>
            <div className="text-xs text-gray-500 font-mono truncate">
              {entity.entity_id}
            </div>
          </div>
          <div className="text-xs text-gray-400">
            {entity.state}{entity.unit ? ` ${entity.unit}` : ''}
          </div>
        </div>
      </div>
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

                  {/* Collapsible content */}
                  {!isCollapsed && (
                    <div className="p-2 space-y-1 bg-[#0d0d1a]">
                      {domainEntities.slice(0, 50).map(entity => (
                        <DraggableEntity
                          key={entity.entity_id}
                          entity={entity}
                          slotType={getSlotType(entity)}
                          isSelected={selectedEntities.includes(entity.entity_id)}
                          onToggleSelect={onToggleSelect}
                        />
                      ))}
                      {domainEntities.length > 50 && (
                        <div className="text-xs text-gray-500 text-center py-1">
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
