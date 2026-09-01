import test from 'node:test'
import assert from 'node:assert/strict'

import { sensorFamily, similarSensorOptions } from '../src/utils/sensorComparison.js'

const tents = [
  {
    id: 'flower',
    name: 'Flower',
    sensors: {
      temperature: { _entities: { 'sensor.flower_canopy_temperature': 25 } },
      temperature_2: { _entities: { 'sensor.flower_floor_temperature': 23 } },
      humidity: { _entities: { 'sensor.flower_humidity': 60 } },
    },
  },
  {
    id: 'veg',
    name: 'Veg',
    sensors: {
      temperature: { _entities: { 'sensor.veg_temperature': 24 } },
      humidity: { _entities: { 'sensor.veg_humidity': 58 } },
    },
  },
]

test('numbered sensor slots share a comparison family', () => {
  assert.equal(sensorFamily('temperature_3'), 'temperature')
  assert.equal(sensorFamily('humidity'), 'humidity')
})

test('offers configured sensors from only the focused measurement family', () => {
  assert.deepEqual(
    similarSensorOptions(tents, ['sensor.flower_canopy_temperature']),
    [
      {
        entityId: 'sensor.flower_canopy_temperature',
        label: 'Flower Canopy Temperature',
        tentName: 'Flower',
      },
      {
        entityId: 'sensor.flower_floor_temperature',
        label: 'Flower Floor Temperature',
        tentName: 'Flower',
      },
      {
        entityId: 'sensor.veg_temperature',
        label: 'Veg Temperature',
        tentName: 'Veg',
      },
    ]
  )
})

test('does not suggest comparisons for non-sensor entities', () => {
  assert.deepEqual(similarSensorOptions(tents, ['switch.flower_light']), [])
})
