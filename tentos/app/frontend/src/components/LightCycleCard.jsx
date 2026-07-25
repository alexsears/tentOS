import { useState, useEffect } from 'react'
import { apiFetch } from '../utils/api'

// Per-mode photoperiod bounds (hours of light per day) — must match backend
const BOUNDS = { veg: [12, 24], flower: [6, 12] }
const PRESETS = { veg: 18, flower: 12 }

function parseHHMM(str) {
  if (!str || typeof str !== 'string') return null
  const [h, m] = str.split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return null
  return h * 60 + m
}

function formatHHMM(minutes) {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

function clamp(value, [lo, hi]) {
  return Math.min(hi, Math.max(lo, value))
}

// Infer initial hours from existing photoperiod_on/off if no light_cycle saved yet
function inferHours(schedules) {
  const on = parseHHMM(schedules?.photoperiod_on)
  const off = parseHHMM(schedules?.photoperiod_off)
  if (on == null || off == null) return null
  const minutes = off > on ? off - on : (1440 - on) + off
  return Math.round((minutes / 60) * 2) / 2
}

export function LightCycleCard({ tent }) {
  const schedules = tent?.schedules || {}
  const saved = schedules.light_cycle || null

  const initialMode = saved?.mode
    || (tent?.growth_stage?.stage === 'flower' ? 'flower' : 'veg')
  const inferredHours = saved?.photoperiod_hours ?? inferHours(schedules)

  const [mode, setMode] = useState(initialMode)
  const [hours, setHours] = useState(
    inferredHours != null
      ? clamp(inferredHours, BOUNDS[initialMode])
      : PRESETS[initialMode]
  )
  const [onTime, setOnTime] = useState(saved?.on_time || schedules.photoperiod_on || '06:00')
  const [enabled, setEnabled] = useState(saved?.enabled ?? false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null) // { type: 'ok'|'error', text }

  // Re-sync from server state when the tent updates (e.g. WebSocket refresh)
  useEffect(() => {
    const lc = tent?.schedules?.light_cycle
    if (lc) {
      setMode(lc.mode)
      setHours(clamp(lc.photoperiod_hours, BOUNDS[lc.mode] || BOUNDS.veg))
      setOnTime(lc.on_time || '06:00')
      setEnabled(!!lc.enabled)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tent?.id])

  const bounds = BOUNDS[mode]
  const darkHours = Math.round((24 - hours) * 2) / 2
  const onMinutes = parseHHMM(onTime) ?? 360
  const offMinutes = (onMinutes + Math.round(hours * 60)) % 1440
  const offTime = formatHHMM(offMinutes)

  const hasLight = Object.keys(tent?.actuators || {}).some(
    k => k === 'light' || k.startsWith('light_')
  )

  // Segments of the 24h bar where the light is ON (as % of the day)
  const onSegments = []
  if (hours >= 24) {
    onSegments.push([0, 100])
  } else if (hours > 0) {
    const startPct = (onMinutes / 1440) * 100
    const widthPct = (hours / 24) * 100
    if (startPct + widthPct <= 100) {
      onSegments.push([startPct, widthPct])
    } else {
      onSegments.push([startPct, 100 - startPct])
      onSegments.push([0, (startPct + widthPct) - 100])
    }
  }

  const selectPreset = (newMode) => {
    setMode(newMode)
    setHours(PRESETS[newMode])
  }

  const save = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const res = await apiFetch(`api/tents/${tent.id}/light-cycle`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          photoperiod_hours: hours,
          on_time: onTime,
          enabled
        })
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || 'Failed to save light cycle')
      }
      const data = await res.json()
      setMessage({
        type: 'ok',
        text: data.applied_now
          ? 'Saved — light state applied'
          : 'Saved'
      })
      setTimeout(() => setMessage(null), 4000)
    } catch (e) {
      setMessage({ type: 'error', text: e.message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold">💡 Light Cycle</h3>
        <span className={`px-2 py-1 rounded text-xs ${
          mode === 'flower'
            ? 'bg-purple-500/20 text-purple-300'
            : 'bg-green-500/20 text-green-400'
        }`}>
          {mode === 'flower' ? '🌸 Flower' : '🌱 Veg'}
        </span>
      </div>

      {/* Veg / Flower preset buttons */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <button
          onClick={() => selectPreset('veg')}
          className={`rounded-lg border px-3 py-2 text-left transition-colors ${
            mode === 'veg'
              ? 'border-green-500 bg-green-500/10'
              : 'border-[#2d3a5c] hover:border-green-500/50'
          }`}
        >
          <div className="font-medium text-sm">🌱 Veg</div>
          <div className="text-xs text-gray-400">18/6 · range 12-24h light</div>
        </button>
        <button
          onClick={() => selectPreset('flower')}
          className={`rounded-lg border px-3 py-2 text-left transition-colors ${
            mode === 'flower'
              ? 'border-purple-500 bg-purple-500/10'
              : 'border-[#2d3a5c] hover:border-purple-500/50'
          }`}
        >
          <div className="font-medium text-sm">🌸 Flower</div>
          <div className="text-xs text-gray-400">12/12 · range 6-12h light</div>
        </button>
      </div>

      {/* Photoperiod slider */}
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-sm text-gray-400">Photoperiod</span>
        <span className="text-sm font-semibold text-amber-300">
          {hours % 1 === 0 ? hours : hours.toFixed(1)}h light
          <span className="text-gray-400 font-normal">
            {' '}/ {darkHours % 1 === 0 ? darkHours : darkHours.toFixed(1)}h dark
          </span>
        </span>
      </div>
      <input
        type="range"
        min={bounds[0]}
        max={bounds[1]}
        step={0.5}
        value={hours}
        onChange={e => setHours(Number(e.target.value))}
        className="w-full accent-amber-400 cursor-pointer"
      />
      <div className="flex justify-between text-xs text-gray-500 mb-4">
        <span>{bounds[0]}h</span>
        <span>{bounds[1]}h</span>
      </div>

      {/* 24h day bar: amber = lights on, dark = lights off */}
      <div className="mb-1 relative h-8 rounded-lg overflow-hidden bg-[#0d1430] border border-[#2d3a5c]">
        {onSegments.map(([left, width], i) => (
          <div
            key={i}
            className="absolute top-0 h-full bg-gradient-to-b from-amber-300 to-amber-500 opacity-90"
            style={{ left: `${left}%`, width: `${width}%` }}
          />
        ))}
        {/* Hour tick marks */}
        {[6, 12, 18].map(h => (
          <div
            key={h}
            className="absolute top-0 h-full w-px bg-black/30"
            style={{ left: `${(h / 24) * 100}%` }}
          />
        ))}
      </div>
      <div className="flex justify-between text-xs text-gray-500 mb-4">
        <span>00:00</span>
        <span>06:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>24:00</span>
      </div>

      {/* Lights-on time + computed off time */}
      <div className="flex flex-wrap items-center gap-4 mb-4">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-gray-400">Lights on at</span>
          <input
            type="time"
            value={onTime}
            onChange={e => setOnTime(e.target.value || '06:00')}
            className="bg-[#0d1430] border border-[#2d3a5c] rounded px-2 py-1 text-sm"
          />
        </label>
        <div className="text-sm">
          <span className="text-gray-400">Lights off at</span>{' '}
          <span className="font-medium text-amber-300">{offTime}</span>
        </div>
      </div>

      {/* Automatic control toggle */}
      <label className="flex items-center gap-2 text-sm mb-4 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={e => setEnabled(e.target.checked)}
          className="rounded accent-green-500"
        />
        <span>Automatic control — TentOS switches the grow light on this schedule</span>
      </label>

      {!hasLight && (
        <div className="text-xs text-yellow-400/90 bg-yellow-500/10 border border-yellow-500/30 rounded p-2 mb-4">
          No grow light entity detected for this tent. The schedule will be saved,
          but TentOS can't switch anything until a light is assigned in the Tent Builder.
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="btn btn-primary"
        >
          {saving ? 'Saving...' : 'Save Light Cycle'}
        </button>
        {message && (
          <span className={`text-sm ${message.type === 'ok' ? 'text-green-400' : 'text-red-400'}`}>
            {message.type === 'ok' ? '✓ ' : ''}{message.text}
          </span>
        )}
      </div>
    </div>
  )
}

export default LightCycleCard
