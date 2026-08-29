import assert from 'node:assert/strict'
import test from 'node:test'

import { finiteNumberOrNull } from '../src/utils/numbers.js'

test('finiteNumberOrNull accepts finite readings', () => {
  assert.equal(finiteNumberOrNull(23.5), 23.5)
  assert.equal(finiteNumberOrNull('67.2'), 67.2)
})

test('finiteNumberOrNull rejects unavailable and non-finite readings', () => {
  for (const value of [null, undefined, '', 'unavailable', 'unknown', NaN, Infinity, -Infinity, 'NaN', 'Infinity']) {
    assert.equal(finiteNumberOrNull(value), null)
  }
})
