import { sensorEntities } from './history.js'

/** Treat numbered slots (temperature_2, temperature_3) as one sensor family. */
export function sensorFamily(slot) {
  return String(slot || '').replace(/_\d+$/, '')
}

function entityLabel(entityId) {
  const objectId = String(entityId || '').split('.').pop() || ''
  return objectId
    .split('_')
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * Return the configured TentOS sensors that are comparable with the focused
 * entity. This deliberately stays inside the same measurement family, so a
 * temperature click never suggests humidity, VPD, or actuator states.
 */
export function similarSensorOptions(tents, focusedEntities) {
  const focused = new Set(focusedEntities || [])
  const families = new Set()

  for (const tent of tents || []) {
    Object.entries(tent.sensors || {}).forEach(([slot, sensor]) => {
      if (sensorEntities(sensor).some(entityId => focused.has(entityId))) {
        families.add(sensorFamily(slot))
      }
    })
  }

  if (!families.size) return []

  const seen = new Set()
  const options = []
  for (const tent of tents || []) {
    Object.entries(tent.sensors || {}).forEach(([slot, sensor]) => {
      if (!families.has(sensorFamily(slot))) return
      sensorEntities(sensor).forEach(entityId => {
        if (!entityId || seen.has(entityId)) return
        seen.add(entityId)
        options.push({
          entityId,
          label: entityLabel(entityId) || entityId,
          tentName: tent.name || tent.id || 'Tent',
        })
      })
    })
  }

  return options
}
