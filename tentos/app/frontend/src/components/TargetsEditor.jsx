import { useState, useEffect } from 'react'
import { apiFetch, requireOk } from '../utils/api'
import { useTemperatureUnit, celsiusToFahrenheit, fahrenheitToCelsius } from '../hooks/useTemperatureUnit'

/**
 * Editor for a tent's alert and score targets.
 *
 * Alerts and the environment score have always read these values, but nothing
 * in the UI could write them, so every tent ran on the built-in defaults and
 * the card here showed "? - ?". Defaults are shown as placeholders so it is
 * obvious what a blank field falls back to.
 */

// Mirrors the fallbacks in state_manager.py
const DEFAULTS = {
  temp_day_min: 18,
  temp_day_max: 30,
  temp_night_min: 18,
  temp_night_max: 24,
  humidity_day_min: 40,
  humidity_day_max: 70,
  humidity_night_min: 40,
  humidity_night_max: 70,
  co2_day_target: 1000,
  co2_max: 1500,
}

const ROWS = [
  { label: 'Day temp', min: 'temp_day_min', max: 'temp_day_max', temp: true },
  { label: 'Night temp', min: 'temp_night_min', max: 'temp_night_max', temp: true },
  { label: 'Day humidity', min: 'humidity_day_min', max: 'humidity_day_max' },
  { label: 'Night humidity', min: 'humidity_night_min', max: 'humidity_night_max' },
  { label: 'CO2 target / max', min: 'co2_day_target', max: 'co2_max', ppm: true },
]

const round1 = (v) => Math.round(v * 10) / 10

export function TargetsEditor({ tentId, targets, onSaved }) {
  const { unit, getTempUnit } = useTemperatureUnit()
  const [values, setValues] = useState({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)

  // Stored in Celsius, edited in whatever the header is set to
  const toDisplay = (key, celsius) => {
    if (celsius == null || celsius === '') return ''
    if (!key.startsWith('temp') || unit !== 'F') return String(celsius)
    return String(round1(celsiusToFahrenheit(Number(celsius))))
  }

  const toStored = (key, shown) => {
    const num = Number(shown)
    if (shown === '' || Number.isNaN(num)) return null
    if (!key.startsWith('temp') || unit !== 'F') return num
    return round1(fahrenheitToCelsius(num))
  }

  useEffect(() => {
    const next = {}
    Object.keys(DEFAULTS).forEach(key => {
      next[key] = toDisplay(key, targets?.[key])
    })
    setValues(next)
    setSaved(false)
  }, [tentId, targets, unit])

  const placeholder = (key) =>
    key.startsWith('temp') && unit === 'F'
      ? String(round1(celsiusToFahrenheit(DEFAULTS[key])))
      : String(DEFAULTS[key])

  const save = async () => {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const payload = {}
      Object.keys(DEFAULTS).forEach(key => {
        const stored = toStored(key, values[key])
        if (stored != null) payload[key] = stored
      })
      const res = await apiFetch(`api/config/tents/${tentId}/targets`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      await requireOk(res, 'Failed to save targets')
      setSaved(true)
      if (onSaved) onSaved()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const usingDefaults = !targets || Object.keys(targets).length === 0

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-semibold">Targets</h3>
        {usingDefaults && (
          <span className="text-xs text-yellow-400">Using built-in defaults</span>
        )}
      </div>
      <p className="text-xs text-gray-500 mb-4">
        Alerts and the environment score are measured against these. Leave a field blank to keep the default.
      </p>

      <div className="space-y-2">
        {ROWS.map(row => (
          <div key={row.label} className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
            <span className="text-sm text-gray-400">
              {row.label} <span className="opacity-60">({row.temp ? getTempUnit() : row.ppm ? 'ppm' : '%'})</span>
            </span>
            <input
              type="number"
              step={row.ppm ? '50' : '0.5'}
              className="input w-24"
              placeholder={placeholder(row.min)}
              value={values[row.min] ?? ''}
              onChange={e => setValues(v => ({ ...v, [row.min]: e.target.value }))}
              aria-label={`${row.label} minimum`}
            />
            <input
              type="number"
              step={row.ppm ? '50' : '0.5'}
              className="input w-24"
              placeholder={placeholder(row.max)}
              value={values[row.max] ?? ''}
              onChange={e => setValues(v => ({ ...v, [row.max]: e.target.value }))}
              aria-label={`${row.label} maximum`}
            />
          </div>
        ))}
      </div>

      {error && <div className="text-sm text-red-400 mt-3">{error}</div>}

      <div className="flex items-center gap-3 mt-4">
        <button onClick={save} disabled={saving} className="btn btn-primary">
          {saving ? 'Saving...' : 'Save Targets'}
        </button>
        {saved && <span className="text-sm text-green-400">Saved</span>}
      </div>
    </div>
  )
}
