import assert from 'node:assert/strict'
import test from 'node:test'

import { getTentEntityOptions } from '../src/utils/automationEntities.js'


test('extracts sensor IDs from live _entities maps', () => {
  const options = getTentEntityOptions({
    temperature: {
      value: 28.6,
      _entities: {
        'sensor.flower_climate_1_temperature': 28.6,
        'sensor.flower_climate_2_temperature': 27.9
      }
    }
  })

  assert.deepEqual(options, [
    {
      key: 'temperature',
      entity_id: 'sensor.flower_climate_1_temperature',
      label: 'temperature 1'
    },
    {
      key: 'temperature_2',
      entity_id: 'sensor.flower_climate_2_temperature',
      label: 'temperature 2'
    }
  ])
})


test('extracts actuator ID and friendly name from live actuator state', () => {
  const options = getTentEntityOptions({
    light: {
      entity_id: 'switch.lab1a',
      state: 'on',
      attributes: { friendly_name: 'Lab1a' }
    }
  })

  assert.deepEqual(options, [{
    key: 'light',
    entity_id: 'switch.lab1a',
    label: 'Lab1a'
  }])
})
