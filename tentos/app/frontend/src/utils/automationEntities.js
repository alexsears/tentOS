/**
 * Convert live tent sensor/actuator state into Automation Editor options.
 * Sensors expose their HA IDs through `_entities`; actuators expose `entity_id`.
 */
export function getTentEntityOptions(entityStates = {}) {
  const seen = new Set()
  const options = []

  Object.entries(entityStates).forEach(([slot, value]) => {
    const entityIds = []

    if (typeof value === 'string') {
      entityIds.push(value)
    } else if (value && typeof value === 'object') {
      if (typeof value.entity_id === 'string' && value.entity_id) {
        entityIds.push(value.entity_id)
      }
      Object.keys(value._entities || {}).forEach(entityId => entityIds.push(entityId))
    }

    const uniqueIds = [...new Set(entityIds)].filter(entityId => !seen.has(entityId))
    uniqueIds.forEach((entityId, index) => {
      seen.add(entityId)
      const friendlyName = value?.attributes?.friendly_name
      const label = friendlyName || (uniqueIds.length > 1 ? `${slot} ${index + 1}` : slot)
      options.push({
        key: index === 0 ? slot : `${slot}_${index + 1}`,
        entity_id: entityId,
        label
      })
    })
  })

  return options
}
