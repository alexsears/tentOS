import { useState, useMemo } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'

function DraggableEntity({ entity, slotType }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: entity.entity_id,
    data: { entity, slotType }
  })

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`p-2 bg-[#1a1a2e] rounded border border-[#2d3a5c] cursor-grab
        hover:border-green-500/50 hover:bg-[#1a1a2e]/80 transition-colors
        ${isDragging ? 'ring-2 ring-green-500' : ''}`}
    >
      <div className="flex items-center gap-2">
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
  )
}

export default function EntityInventory({ entities, slots, assignedEntities = {} }) {
  const [search, setSearch] = useState('')
  const [domainFilter, setDomainFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')

  // Get unique domains
  const domains = useMemo(() => {
    const domainSet = new Set(entities.map(e => e.domain))
    return Array.from(domainSet).sort()
  }, [entities])

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

  // Filter entities
  const filteredEntities = useMemo(() => {
    return entities.filter(entity => {
      // Exclude already assigned
      if (assignedIds.has(entity.entity_id)) return false

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
  }, [entities, search, domainFilter, categoryFilter, assignedIds, slotCompatibility])

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

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-[#2d3a5c] space-y-2">
        <h3 className="font-semibold text-sm">Entity Inventory</h3>

        <input
          type="text"
          placeholder="Search entities..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="input w-full text-sm"
        />

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
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {Object.keys(groupedEntities).length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            {entities.length === 0 ? 'Loading entities...' : 'No matching entities'}
          </div>
        ) : (
          Object.entries(groupedEntities).map(([domain, domainEntities]) => (
            <div key={domain}>
              <div className="text-xs font-medium text-gray-400 uppercase mb-2">
                {domain} ({domainEntities.length})
              </div>
              <div className="space-y-1">
                {domainEntities.slice(0, 50).map(entity => (
                  <DraggableEntity
                    key={entity.entity_id}
                    entity={entity}
                    slotType={getSlotType(entity)}
                  />
                ))}
                {domainEntities.length > 50 && (
                  <div className="text-xs text-gray-500 text-center py-1">
                    +{domainEntities.length - 50} more
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="p-2 border-t border-[#2d3a5c] text-xs text-gray-500 text-center">
        {filteredEntities.length} entities available
      </div>
    </div>
  )
}
