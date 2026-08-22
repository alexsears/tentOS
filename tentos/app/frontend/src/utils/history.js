/**
 * Helpers for jumping from any live reading in the UI to its graph on Reports.
 *
 * Every readout in TentOS ultimately comes from one or more HA entities, but the
 * shape differs per surface: tent sensors carry an `_entities` map, actuators a
 * single `entity_id`, and the entity browser a bare string. These normalise that.
 */

/** Pull the entity IDs behind a tent sensor slot value. */
export function sensorEntities(sensor) {
  if (!sensor) return []
  if (typeof sensor === 'string') return [sensor]
  if (Array.isArray(sensor)) {
    return sensor.map(s => (typeof s === 'string' ? s : s?.entity_id)).filter(Boolean)
  }
  if (sensor._entities) return Object.keys(sensor._entities)
  if (sensor.entity_id) return [sensor.entity_id]
  return []
}

/** Route to the Reports tab focused on one or more entities. */
export function entityHistoryPath(entities, range) {
  const list = (Array.isArray(entities) ? entities : [entities]).filter(Boolean)
  if (!list.length) return null
  const params = new URLSearchParams({ entity: list.join(',') })
  if (range) params.set('range', range)
  return `/reports?${params.toString()}`
}

/** Route to the Reports tab showing a calculated tent series (VPD has no entity). */
export function tentHistoryPath(tentId, sensorType, range) {
  if (!tentId) return null
  const params = new URLSearchParams({ tent: tentId })
  if (sensorType) params.set('sensors', sensorType)
  if (range) params.set('range', range)
  return `/reports?${params.toString()}`
}
