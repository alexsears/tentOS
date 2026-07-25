import { useState, useEffect, useRef } from 'react'
import { apiFetch } from '../utils/api'

// Per-mode photoperiod bounds (hours of light per day), must match backend
const BOUNDS = { veg: [12, 24], flower: [6, 12] }
const PRESETS = { veg: 18, flower: 12 }
const DAY_MIN = 24 * 60
const STEP_MIN = 15 // drag snap step on the day bar

function parseHHMM(str) {
  if (!str || typeof str !== 'string') return null
  const [h, m] = str.split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return null
  return h * 60 + m
}

function formatHHMM(minutes) {
  const m = ((Math.round(minutes) % DAY_MIN) + DAY_MIN) % DAY_MIN
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

function clamp(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value))
}

// Photoperiod duration in minutes from on/off times: (off - on) mod 24h.
// Equal times mean the light is on the full 24 hours, never 0.
function durationFromTimes(onMin, offMin) {
  const d = (((offMin - onMin) % DAY_MIN) + DAY_MIN) % DAY_MIN
  return d === 0 ? DAY_MIN : d
}

function formatDuration(minutes) {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return m ? `${h}h ${m}m` : `${h}h`
}

// Infer initial duration from existing photoperiod_on/off if no light_cycle saved yet
function inferDuration(schedules) {
  const on = parseHHMM(schedules?.photoperiod_on)
  const off = parseHHMM(schedules?.photoperiod_off)
  if (on == null || off == null) return null
  return durationFromTimes(on, off)
}

export function LightCycleCard({ tent }) {
  const schedules = tent?.schedules || {}
  const saved = schedules.light_cycle || null

  const initialMode = saved?.mode
    || (tent?.growth_stage?.stage === 'flower' ? 'flower' : 'veg')
  const initialDuration = saved?.photoperiod_hours != null
    ? Math.round(saved.photoperiod_hours * 60)
    : (inferDuration(schedules) ?? PRESETS[initialMode] * 60)

  const clampDuration = (minutes, m) => {
    const [lo, hi] = BOUNDS[m] || BOUNDS.veg
    return clamp(minutes, lo * 60, hi * 60)
  }

  const [mode, setMode] = useState(initialMode)
  // Shared state: lights-on time + photoperiod duration, both in minutes.
  // Every editor (presets, slider, time inputs, bar handles) reads/writes these two.
  const [onMin, setOnMin] = useState(
    parseHHMM(saved?.on_time || schedules.photoperiod_on || '06:00') ?? 360
  )
  const [duration, setDuration] = useState(clampDuration(initialDuration, initialMode))
  const [enabled, setEnabled] = useState(saved?.enabled ?? false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null) // { type: 'ok'|'error', text }
  const [warning, setWarning] = useState(null) // backup-automation warning from the API
  const [dragging, setDragging] = useState(null) // 'start' | 'end' | 'move' | null

  const trackRef = useRef(null)
  const dragRef = useRef(null)

  // Re-sync from server state when the tent changes
  useEffect(() => {
    const lc = tent?.schedules?.light_cycle
    if (lc) {
      setMode(lc.mode)
      setDuration(clampDuration(Math.round(lc.photoperiod_hours * 60), lc.mode))
      setOnMin(parseHHMM(lc.on_time) ?? 360)
      setEnabled(!!lc.enabled)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tent?.id])

  const bounds = BOUNDS[mode]
  const offMin = (onMin + duration) % DAY_MIN
  const onTime = formatHHMM(onMin)
  const offTime = formatHHMM(offMin)
  const darkMinutes = DAY_MIN - duration

  const hasLight = Object.keys(tent?.actuators || {}).some(
    k => k === 'light' || k.startsWith('light_')
  )

  // Segments of the 24h bar where the light is ON (as [left%, width%])
  const onSegments = []
  if (duration >= DAY_MIN) {
    onSegments.push([0, 100])
  } else if (duration > 0) {
    const startPct = (onMin / DAY_MIN) * 100
    const widthPct = (duration / DAY_MIN) * 100
    if (startPct + widthPct <= 100) {
      onSegments.push([startPct, widthPct])
    } else {
      onSegments.push([startPct, 100 - startPct])
      onSegments.push([0, (startPct + widthPct) - 100])
    }
  }

  const selectPreset = (newMode) => {
    setMode(newMode)
    setDuration(PRESETS[newMode] * 60)
  }

  // Both time inputs are real editors: duration = (off - on) mod 24h, live-clamped
  const handleOnTimeChange = (value) => {
    const v = parseHHMM(value)
    if (v == null) return
    const d = clampDuration(durationFromTimes(v, offMin), mode)
    setOnMin(v)
    setDuration(d)
  }

  const handleOffTimeChange = (value) => {
    const v = parseHHMM(value)
    if (v == null) return
    setDuration(clampDuration(durationFromTimes(onMin, v), mode))
  }

  // --- Day-bar drag interactions (pointer events, works for touch + mouse) ---

  const minutesFromPointer = (e) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return null
    const pct = clamp((e.clientX - rect.left) / rect.width, 0, 1)
    return (Math.round((pct * DAY_MIN) / STEP_MIN) * STEP_MIN) % DAY_MIN
  }

  const handlePointerDown = (e) => {
    const target = e.target.closest('[data-drag]')
    if (!target) return
    const cursor = minutesFromPointer(e)
    if (cursor == null) return
    e.preventDefault()
    dragRef.current = {
      type: target.dataset.drag,
      startCursor: cursor,
      startOn: onMin,
      startDuration: duration
    }
    setDragging(target.dataset.drag)
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* ignore */ }
  }

  const handlePointerMove = (e) => {
    const drag = dragRef.current
    if (!drag) return
    const cursor = minutesFromPointer(e)
    if (cursor == null) return

    if (drag.type === 'move') {
      // Shift the whole lights-on window, duration unchanged
      const delta = cursor - drag.startCursor
      setOnMin((((drag.startOn + delta) % DAY_MIN) + DAY_MIN) % DAY_MIN)
    } else if (drag.type === 'start') {
      // Left handle: move lights-on, keep lights-off fixed
      const off = (drag.startOn + drag.startDuration) % DAY_MIN
      const d = clampDuration(durationFromTimes(cursor, off), mode)
      setDuration(d)
      setOnMin((((off - d) % DAY_MIN) + DAY_MIN) % DAY_MIN)
    } else if (drag.type === 'end') {
      // Right handle: move lights-off, keep lights-on fixed
      setDuration(clampDuration(durationFromTimes(drag.startOn, cursor), mode))
    }
  }

  const endDrag = (e) => {
    if (!dragRef.current) return
    dragRef.current = null
    setDragging(null)
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
  }

  const save = async () => {
    setSaving(true)
    setMessage(null)
    setWarning(null)
    try {
      const res = await apiFetch(`api/tents/${tent.id}/light-cycle`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          photoperiod_hours: duration / 60,
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
        text: data.applied_now ? 'Saved, light state applied' : 'Saved'
      })
      if (data.warning) setWarning(data.warning)
      setTimeout(() => setMessage(null), 4000)
    } catch (e) {
      setMessage({ type: 'error', text: e.message })
    } finally {
      setSaving(false)
    }
  }

  const handlePct = (minutes) => (minutes / DAY_MIN) * 100

  const renderHandle = (type, minutes) => (
    <div
      data-drag={type}
      role="slider"
      aria-label={type === 'start' ? 'Lights on time' : 'Lights off time'}
      aria-valuetext={type === 'start' ? onTime : offTime}
      className="absolute top-1/2 z-10 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center"
      style={{ left: `${handlePct(minutes)}%` }}
    >
      <div className={`h-5 w-5 rounded-full border-2 bg-white shadow ${
        dragging === type ? 'border-amber-300 scale-110' : 'border-amber-500'
      }`} />
    </div>
  )

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold">Light Cycle</h3>
        <span className={`px-2 py-1 rounded text-xs ${
          mode === 'flower'
            ? 'bg-purple-500/20 text-purple-300'
            : 'bg-green-500/20 text-green-400'
        }`}>
          {mode === 'flower' ? 'Flower' : 'Veg'}
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
          <div className="font-medium text-sm">Veg</div>
          <div className="text-xs text-gray-400">18/6 preset, range 12-24h light</div>
        </button>
        <button
          onClick={() => selectPreset('flower')}
          className={`rounded-lg border px-3 py-2 text-left transition-colors ${
            mode === 'flower'
              ? 'border-purple-500 bg-purple-500/10'
              : 'border-[#2d3a5c] hover:border-purple-500/50'
          }`}
        >
          <div className="font-medium text-sm">Flower</div>
          <div className="text-xs text-gray-400">12/12 preset, range 6-12h light</div>
        </button>
      </div>

      {/* Photoperiod summary + linear slider */}
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-sm text-gray-400">Photoperiod</span>
        <span className="text-sm font-semibold text-amber-300">
          {formatDuration(duration)} light
          <span className="text-gray-400 font-normal"> / {formatDuration(darkMinutes)} dark</span>
        </span>
      </div>
      <input
        type="range"
        min={bounds[0]}
        max={bounds[1]}
        step={0.25}
        value={duration / 60}
        onChange={e => setDuration(Math.round(Number(e.target.value) * 60))}
        className="w-full accent-amber-400 cursor-pointer"
      />
      <div className="flex justify-between text-xs text-gray-500 mb-4">
        <span>{bounds[0]}h</span>
        <span>{bounds[1]}h</span>
      </div>

      {/* 24h day bar: the primary editor. Amber = lights on, dark = lights off. */}
      <div
        ref={trackRef}
        className="relative mb-1 h-10 touch-none select-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="absolute inset-0 overflow-hidden rounded-lg bg-[#0d1430] border border-[#2d3a5c]">
          {onSegments.map(([left, width], i) => (
            <div
              key={i}
              data-drag="move"
              className={`absolute top-0 h-full bg-gradient-to-b from-amber-300 to-amber-500 opacity-90 ${
                dragging === 'move' ? 'cursor-grabbing' : 'cursor-grab'
              }`}
              style={{ left: `${left}%`, width: `${width}%` }}
            />
          ))}
          {/* Hour tick marks */}
          {[6, 12, 18].map(h => (
            <div
              key={h}
              className="absolute top-0 h-full w-px bg-black/30 pointer-events-none"
              style={{ left: `${(h / 24) * 100}%` }}
            />
          ))}
        </div>
        {renderHandle('start', onMin)}
        {renderHandle('end', offMin)}
      </div>
      <div className="flex justify-between text-xs text-gray-500 mb-1">
        <span>00:00</span>
        <span>06:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>24:00</span>
      </div>
      <div className="text-xs text-gray-500 mb-4">
        Drag the handles to set lights-on and lights-off. Drag the amber span to shift
        the whole window. Steps of 15 minutes.
      </div>

      {/* Lights-on and lights-off time inputs, both editable */}
      <div className="flex flex-wrap items-center gap-4 mb-4">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-gray-400">Lights on</span>
          <input
            type="time"
            step={900}
            value={onTime}
            onChange={e => handleOnTimeChange(e.target.value)}
            className="bg-[#0d1430] border border-[#2d3a5c] rounded px-2 py-1 text-sm"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-gray-400">Lights off</span>
          <input
            type="time"
            step={900}
            value={offTime}
            onChange={e => handleOffTimeChange(e.target.value)}
            className="bg-[#0d1430] border border-[#2d3a5c] rounded px-2 py-1 text-sm"
          />
        </label>
      </div>

      {/* Automatic control toggle */}
      <label className="flex items-center gap-2 text-sm mb-4 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={e => setEnabled(e.target.checked)}
          className="rounded accent-green-500"
        />
        <span>Automatic control. TentOS switches the grow light on this schedule.</span>
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
            {message.text}
          </span>
        )}
      </div>
      {warning && (
        <div className="mt-3 text-xs text-yellow-400/90 bg-yellow-500/10 border border-yellow-500/30 rounded p-2">
          {warning}
        </div>
      )}
    </div>
  )
}

export default LightCycleCard
