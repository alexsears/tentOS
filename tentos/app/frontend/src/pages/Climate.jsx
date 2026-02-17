import { useState, useEffect, useMemo, useRef } from 'react'
import { useTents } from '../hooks/useTents'
import { useTemperatureUnit } from '../hooks/useTemperatureUnit'
import { apiFetch } from '../utils/api'

// Chain definitions mapping to backend AUTOMATION_TEMPLATES
const CHAIN_DEFS = [
  {
    templateId: 'high_temp_exhaust',
    sensorType: 'temperature',
    actuatorType: 'exhaust_fan',
    label: 'High Temp',
    condition: 'above',
    defaultThreshold: 28,
    targetKey: 'temp_day_max',
    sensorIcon: '\u{1F321}\u{FE0F}',
    actuatorIcon: '\u{1F300}',
    actuatorLabel: 'Exhaust Fan',
    unit: '\u{00B0}',
  },
  {
    templateId: 'low_temp_heater',
    sensorType: 'temperature',
    actuatorType: 'heater',
    label: 'Low Temp',
    condition: 'below',
    defaultThreshold: 18,
    targetKey: 'temp_night_min',
    sensorIcon: '\u{1F321}\u{FE0F}',
    actuatorIcon: '\u{1F525}',
    actuatorLabel: 'Heater',
    unit: '\u{00B0}',
  },
  {
    templateId: 'high_humidity_dehumidifier',
    sensorType: 'humidity',
    actuatorType: 'dehumidifier',
    label: 'High Humidity',
    condition: 'above',
    defaultThreshold: 70,
    targetKey: 'humidity_day_max',
    sensorIcon: '\u{1F4A7}',
    actuatorIcon: '\u{1F3DC}\u{FE0F}',
    actuatorLabel: 'Dehumidifier',
    unit: '%',
  },
  {
    templateId: 'low_humidity_humidifier',
    sensorType: 'humidity',
    actuatorType: 'humidifier',
    label: 'Low Humidity',
    condition: 'below',
    defaultThreshold: 50,
    targetKey: 'humidity_day_min',
    sensorIcon: '\u{1F4A7}',
    actuatorIcon: '\u{1F4A8}',
    actuatorLabel: 'Humidifier',
    unit: '%',
  },
  {
    templateId: 'high_vpd_humidifier',
    sensorType: 'vpd',
    actuatorType: 'humidifier',
    label: 'High VPD',
    condition: 'above',
    defaultThreshold: 1.4,
    targetKey: null,
    sensorIcon: '\u{1FAE7}',
    actuatorIcon: '\u{1F4A8}',
    actuatorLabel: 'Humidifier',
    unit: ' kPa',
    requires: ['temperature', 'humidity'],
  },
  {
    templateId: 'low_vpd_dehumidifier',
    sensorType: 'vpd',
    actuatorType: 'dehumidifier',
    label: 'Low VPD',
    condition: 'below',
    defaultThreshold: 0.8,
    targetKey: null,
    sensorIcon: '\u{1FAE7}',
    actuatorIcon: '\u{1F3DC}\u{FE0F}',
    actuatorLabel: 'Dehumidifier',
    unit: ' kPa',
    requires: ['temperature', 'humidity'],
  },
  {
    templateId: 'light_schedule',
    sensorType: null,
    actuatorType: 'light',
    label: 'Light Schedule',
    condition: 'time',
    sensorIcon: '\u{23F0}',
    actuatorIcon: '\u{1F4A1}',
    actuatorLabel: 'Grow Lights',
    unit: '',
  },
  {
    templateId: 'circulation_fan_with_lights',
    sensorType: null,
    actuatorType: 'circulation_fan',
    label: 'Follow Lights',
    condition: 'state',
    sensorIcon: '\u{1F4A1}',
    actuatorIcon: '\u{1F504}',
    actuatorLabel: 'Circ Fan',
    unit: '',
  },
  {
    templateId: 'high_temp_ac',
    sensorType: 'temperature',
    actuatorType: 'ac',
    label: 'High Temp',
    condition: 'above',
    defaultThreshold: 28,
    targetKey: 'temp_day_max',
    sensorIcon: '\u{1F321}\u{FE0F}',
    actuatorIcon: '\u{2744}\u{FE0F}',
    actuatorLabel: 'A/C',
    unit: '\u{00B0}',
  },
  {
    templateId: 'watering_schedule',
    sensorType: null,
    actuatorType: 'water_pump',
    label: 'Water Schedule',
    condition: 'time',
    sensorIcon: '\u{23F0}',
    actuatorIcon: '\u{1F6BF}',
    actuatorLabel: 'Water Pump',
    unit: '',
  },
]

// All actuator slot info for the equipment section
const ACTUATOR_INFO = {
  light: { icon: '\u{1F4A1}', label: 'Grow Lights' },
  exhaust_fan: { icon: '\u{1F300}', label: 'Exhaust Fan' },
  circulation_fan: { icon: '\u{1F504}', label: 'Circ Fan' },
  humidifier: { icon: '\u{1F4A8}', label: 'Humidifier' },
  dehumidifier: { icon: '\u{1F3DC}\u{FE0F}', label: 'Dehumidifier' },
  heater: { icon: '\u{1F525}', label: 'Heater' },
  ac: { icon: '\u{2744}\u{FE0F}', label: 'A/C' },
  water_pump: { icon: '\u{1F6BF}', label: 'Water Pump' },
  drain_pump: { icon: '\u{1F53D}', label: 'Drain Pump' },
}

function hasEntity(mapping, key) {
  const val = mapping?.[key]
  if (Array.isArray(val)) return val.some(v => v)
  return !!val
}

function getSensorValue(tent, sensorType) {
  if (sensorType === 'temperature') return tent?.avg_temperature ?? tent?.sensors?.temperature?.value ?? null
  if (sensorType === 'humidity') return tent?.avg_humidity ?? tent?.sensors?.humidity?.value ?? null
  if (sensorType === 'vpd') return tent?.vpd ?? null
  return null
}

function getActuatorState(tent, actuatorType) {
  const act = tent?.actuators?.[actuatorType]
  if (!act) return null
  return act.state || act
}

function isDaytime(schedules) {
  if (!schedules?.photoperiod_on || !schedules?.photoperiod_off) return true
  const now = new Date()
  const [onH, onM] = schedules.photoperiod_on.split(':').map(Number)
  const [offH, offM] = schedules.photoperiod_off.split(':').map(Number)
  const mins = now.getHours() * 60 + now.getMinutes()
  const onMins = onH * 60 + (onM || 0)
  const offMins = offH * 60 + (offM || 0)
  if (onMins < offMins) return mins >= onMins && mins < offMins
  return mins >= onMins || mins < offMins
}

function buildChains(tent, tentConfig, suggestions) {
  if (!tent || !tentConfig) return []
  const sensors = tentConfig.sensors || {}
  const actuators = tentConfig.actuators || {}
  const targets = tentConfig.targets || {}
  const tentId = tentConfig.id

  const suggestionSet = new Set(
    (suggestions || [])
      .filter(s => s.tent_id === tentId)
      .map(s => s.template_id)
  )

  const chains = []
  for (const def of CHAIN_DEFS) {
    if (!hasEntity(actuators, def.actuatorType)) continue
    if (def.requires) {
      if (!def.requires.every(r => hasEntity(sensors, r))) continue
    } else if (def.sensorType && def.sensorType !== 'vpd') {
      if (!hasEntity(sensors, def.sensorType)) continue
    }

    const sensorValue = def.sensorType ? getSensorValue(tent, def.sensorType) : null
    const threshold = def.targetKey ? (targets[def.targetKey] ?? def.defaultThreshold) : def.defaultThreshold
    const actuatorState = getActuatorState(tent, def.actuatorType)
    const isMissing = suggestionSet.has(def.templateId)

    chains.push({
      ...def,
      sensorValue,
      threshold,
      actuatorState,
      status: isMissing ? 'missing' : 'active',
    })
  }
  return chains
}

// --- Inline Components ---

function ContextBar({ tent, schedules }) {
  if (!tent) return null
  const stage = tent.growth_stage || {}
  const daytime = isDaytime(schedules)
  const score = tent.environment_score
  const scoreColor = score >= 80 ? 'text-green-400' : score >= 60 ? 'text-yellow-400' : 'text-red-400'
  const vpdTarget = stage.vpd_target

  return (
    <div className="flex items-center gap-3 flex-wrap text-sm">
      <span className={'px-2 py-0.5 rounded-full text-xs font-medium ' +
        (daytime ? 'bg-yellow-900/40 text-yellow-400' : 'bg-blue-900/40 text-blue-400')}>
        {daytime ? '\u{2600}\u{FE0F} Day' : '\u{1F319} Night'}
      </span>
      <span className={'px-2 py-0.5 rounded-full text-xs font-medium ' +
        (stage.stage === 'flower' ? 'bg-pink-900/40 text-pink-400' : 'bg-green-900/40 text-green-400')}>
        {stage.stage === 'flower' ? '\u{1F338}' : '\u{1F331}'} {stage.stage || 'Veg'}
        {stage.flower_week ? ' (Wk ' + stage.flower_week + ')' : ''}
      </span>
      {vpdTarget && (
        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-[#2d3a5c] text-gray-300">
          VPD Target: {vpdTarget.min}-{vpdTarget.max} kPa
        </span>
      )}
      {score != null && (
        <span className={'px-2 py-0.5 rounded-full text-xs font-medium bg-[#2d3a5c] ' + scoreColor}>
          Score: {score}/100
        </span>
      )}
    </div>
  )
}

function SensorNode({ chain, formatTemp }) {
  const { sensorType, sensorIcon, sensorValue, unit } = chain
  let display = '--'
  let color = 'border-gray-600 text-gray-500'

  if (sensorValue != null) {
    if (sensorType === 'temperature') {
      display = formatTemp(sensorValue)
    } else {
      display = Number(sensorValue).toFixed(1) + unit
    }
    // Color based on threshold comparison
    if (chain.condition === 'above') {
      color = sensorValue > chain.threshold ? 'border-red-500 text-red-400' : 'border-green-500 text-green-400'
    } else if (chain.condition === 'below') {
      color = sensorValue < chain.threshold ? 'border-red-500 text-red-400' : 'border-green-500 text-green-400'
    } else {
      color = 'border-cyan-500 text-cyan-400'
    }
  }

  const label = sensorType === 'temperature' ? 'Temp'
    : sensorType === 'humidity' ? 'Humidity'
    : sensorType === 'vpd' ? 'VPD'
    : 'Schedule'

  return (
    <div className={'rounded-lg p-2.5 bg-[#1a1a2e] border-2 text-center min-w-0 ' + color}>
      <div className="text-lg leading-none mb-1">{sensorIcon}</div>
      <div className="text-sm font-bold truncate">{display}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  )
}

function RuleNode({ chain, onEdit, onCreate, creating, formatTemp }) {
  const [editing, setEditing] = useState(false)
  const [tempVal, setTempVal] = useState(chain.threshold)
  const isActive = chain.status === 'active'
  const isMissing = chain.status === 'missing'

  const borderClass = isActive
    ? 'border-green-500/50 bg-green-900/10'
    : 'border-gray-600 border-dashed bg-[#1a1a2e]'

  const statusDot = isActive ? 'bg-green-400' : 'bg-gray-600'

  const handleBlur = () => {
    setEditing(false)
    const num = parseFloat(tempVal)
    if (!isNaN(num) && num !== chain.threshold) {
      onEdit(chain, num)
    }
  }

  if (chain.condition === 'above' || chain.condition === 'below') {
    const displayThreshold = chain.sensorType === 'temperature'
      ? formatTemp(chain.threshold)
      : chain.threshold + chain.unit
    return (
      <div className={'rounded-lg p-2.5 border-2 min-w-0 ' + borderClass}>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-gray-300 truncate">{chain.label}</span>
          <span className={'w-2 h-2 rounded-full flex-shrink-0 ' + statusDot} />
        </div>
        <div className="text-center">
          <span className="text-xs text-gray-500">{chain.condition === 'above' ? '>' : '<'} </span>
          {editing ? (
            <input
              type="number"
              value={tempVal}
              autoFocus
              onChange={e => setTempVal(e.target.value)}
              onBlur={handleBlur}
              onKeyDown={e => e.key === 'Enter' && e.target.blur()}
              className="input w-16 text-center py-0 px-1 text-sm inline-block"
              step={chain.sensorType === 'vpd' ? '0.1' : '1'}
            />
          ) : (
            <button
              onClick={() => { setTempVal(chain.threshold); setEditing(true) }}
              className="text-base font-bold hover:text-green-400 transition-colors"
              title="Click to edit threshold"
            >
              {displayThreshold}
            </button>
          )}
        </div>
        {isMissing && (
          <button
            onClick={() => onCreate(chain)}
            disabled={creating === chain.templateId}
            className="mt-2 w-full text-xs px-2 py-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded text-white transition-colors"
          >
            {creating === chain.templateId ? 'Creating...' : '+ Create'}
          </button>
        )}
      </div>
    )
  }

  // Time or state-based conditions
  return (
    <div className={'rounded-lg p-2.5 border-2 min-w-0 ' + borderClass}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-gray-300 truncate">{chain.label}</span>
        <span className={'w-2 h-2 rounded-full flex-shrink-0 ' + statusDot} />
      </div>
      <div className="text-center text-xs text-gray-400">
        {chain.condition === 'time' ? 'Time-based' : 'Follows lights'}
      </div>
      {isMissing && (
        <button
          onClick={() => onCreate(chain)}
          disabled={creating === chain.templateId}
          className="mt-2 w-full text-xs px-2 py-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded text-white transition-colors"
        >
          {creating === chain.templateId ? 'Creating...' : '+ Create'}
        </button>
      )}
    </div>
  )
}

function ActuatorNode({ chain }) {
  const state = chain.actuatorState
  const isOn = state === 'on'
  const bg = isOn ? 'bg-green-900/20 border-green-600/50' : 'bg-[#1a1a2e] border-[#2d3a5c]'
  const iconColor = isOn ? 'text-green-400' : 'text-gray-500'

  return (
    <div className={'rounded-lg p-2.5 text-center border min-w-0 ' + bg}>
      <div className={'text-lg leading-none mb-1 ' + iconColor}>{chain.actuatorIcon}</div>
      <div className={'text-xs font-medium truncate ' + (isOn ? 'text-white' : 'text-gray-500')}>
        {chain.actuatorLabel}
      </div>
      <div className={'text-xs ' + (isOn ? 'text-green-400' : 'text-gray-600')}>
        {isOn ? 'ON' : state || '--'}
      </div>
    </div>
  )
}

function ChainRow({ chain, onEdit, onCreate, creating, formatTemp }) {
  const arrowColor = chain.status === 'active' ? 'text-green-500' : 'text-gray-600'

  return (
    <>
      {/* Desktop: 5-column grid */}
      <div className="hidden md:grid grid-cols-[1fr_auto_1.2fr_auto_1fr] items-center gap-2">
        <SensorNode chain={chain} formatTemp={formatTemp} />
        <span className={'text-xl font-bold ' + arrowColor}>{'\u{2192}'}</span>
        <RuleNode chain={chain} onEdit={onEdit} onCreate={onCreate} creating={creating} formatTemp={formatTemp} />
        <span className={'text-xl font-bold ' + arrowColor}>{'\u{2192}'}</span>
        <ActuatorNode chain={chain} />
      </div>

      {/* Mobile: compact card */}
      <div className="md:hidden card p-3">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-lg">{chain.sensorIcon}</span>
          <span className="text-sm font-medium flex-1">{chain.label}</span>
          <span className={'w-2 h-2 rounded-full ' + (chain.status === 'active' ? 'bg-green-400' : 'bg-gray-600')} />
          <span className="text-lg">{chain.actuatorIcon}</span>
        </div>
        <div className="flex items-center justify-between text-xs text-gray-400">
          <span>
            {chain.sensorValue != null
              ? (chain.sensorType === 'temperature' ? formatTemp(chain.sensorValue) : Number(chain.sensorValue).toFixed(1) + chain.unit)
              : '--'}
            {(chain.condition === 'above' || chain.condition === 'below') &&
              ' ' + (chain.condition === 'above' ? '>' : '<') + ' ' +
              (chain.sensorType === 'temperature' ? formatTemp(chain.threshold) : chain.threshold + chain.unit)}
          </span>
          <span className={chain.actuatorState === 'on' ? 'text-green-400' : 'text-gray-600'}>
            {chain.actuatorLabel}: {chain.actuatorState === 'on' ? 'ON' : chain.actuatorState || '--'}
          </span>
        </div>
        {chain.status === 'missing' && (
          <button
            onClick={() => onCreate(chain)}
            disabled={creating === chain.templateId}
            className="mt-2 w-full text-xs px-2 py-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded text-white"
          >
            {creating === chain.templateId ? 'Creating...' : '+ Create Automation'}
          </button>
        )}
      </div>
    </>
  )
}

function TargetsPanel({ tentConfig, onTargetChange, onScheduleChange, formatTemp, unit }) {
  const targets = tentConfig?.targets || {}
  const schedules = tentConfig?.schedules || {}

  const tempStep = unit === 'F' ? 1 : 0.5

  const displayTemp = (c) => {
    if (c == null) return ''
    return unit === 'F' ? Math.round(c * 9 / 5 + 32) : c
  }
  const parseTemp = (val) => {
    const num = parseFloat(val)
    if (isNaN(num)) return null
    return unit === 'F' ? Number(((num - 32) * 5 / 9).toFixed(1)) : num
  }

  const TempInput = ({ targetKey, defaultVal }) => (
    <input
      type="number"
      value={displayTemp(targets[targetKey] ?? defaultVal)}
      onChange={e => {
        const c = parseTemp(e.target.value)
        if (c != null) onTargetChange(targetKey, c)
      }}
      className="input w-full text-sm py-1"
      step={tempStep}
    />
  )

  const NumInput = ({ targetKey, defaultVal, step = 1 }) => (
    <input
      type="number"
      value={targets[targetKey] ?? defaultVal}
      onChange={e => {
        const num = parseFloat(e.target.value)
        if (!isNaN(num)) onTargetChange(targetKey, num)
      }}
      className="input w-full text-sm py-1"
      step={step}
    />
  )

  const TimeInput = ({ schedKey, defaultVal }) => (
    <input
      type="time"
      value={schedules[schedKey] ?? defaultVal}
      onChange={e => onScheduleChange(schedKey, e.target.value)}
      className="input w-full text-sm py-1"
    />
  )

  return (
    <div className="card">
      <h3 className="font-semibold mb-3">Climate Targets</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className="text-xs text-gray-400">Day Temp Min ({'\u{00B0}'}{unit})</label>
          <TempInput targetKey="temp_day_min" defaultVal={22} />
        </div>
        <div>
          <label className="text-xs text-gray-400">Day Temp Max ({'\u{00B0}'}{unit})</label>
          <TempInput targetKey="temp_day_max" defaultVal={28} />
        </div>
        <div>
          <label className="text-xs text-gray-400">Night Temp Min ({'\u{00B0}'}{unit})</label>
          <TempInput targetKey="temp_night_min" defaultVal={18} />
        </div>
        <div>
          <label className="text-xs text-gray-400">Night Temp Max ({'\u{00B0}'}{unit})</label>
          <TempInput targetKey="temp_night_max" defaultVal={24} />
        </div>
        <div>
          <label className="text-xs text-gray-400">Day Humidity Min (%)</label>
          <NumInput targetKey="humidity_day_min" defaultVal={50} />
        </div>
        <div>
          <label className="text-xs text-gray-400">Day Humidity Max (%)</label>
          <NumInput targetKey="humidity_day_max" defaultVal={70} />
        </div>
        <div>
          <label className="text-xs text-gray-400">Night Humidity Min (%)</label>
          <NumInput targetKey="humidity_night_min" defaultVal={50} />
        </div>
        <div>
          <label className="text-xs text-gray-400">Night Humidity Max (%)</label>
          <NumInput targetKey="humidity_night_max" defaultVal={65} />
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
        <div>
          <label className="text-xs text-gray-400">Lights On</label>
          <TimeInput schedKey="photoperiod_on" defaultVal="06:00" />
        </div>
        <div>
          <label className="text-xs text-gray-400">Lights Off</label>
          <TimeInput schedKey="photoperiod_off" defaultVal="22:00" />
        </div>
      </div>
    </div>
  )
}

// --- Per-Tent Section ---

function TentSection({ tent, tentConfig, suggestions, config, setConfig, creating, setCreating, setError, setSuccess, reloadSuggestions, formatTemp, unit }) {
  const [showTargets, setShowTargets] = useState(false)
  const tentId = tentConfig?.id

  const chains = useMemo(() => buildChains(tent, tentConfig, suggestions), [tent, tentConfig, suggestions])
  const missingCount = chains.filter(c => c.status === 'missing').length

  const equipment = useMemo(() => {
    if (!tentConfig) return []
    const items = []
    const actuators = tentConfig.actuators || {}
    for (const [type, val] of Object.entries(actuators)) {
      const entities = Array.isArray(val) ? val.filter(v => v) : (val ? [val] : [])
      if (entities.length === 0) continue
      const info = ACTUATOR_INFO[type] || { icon: '\u{26A1}', label: type }
      const state = getActuatorState(tent, type)
      items.push({ type, ...info, count: entities.length, state, entityIds: entities })
    }
    return items
  }, [tentConfig, tent])

  const handleTargetChange = (key, value) => {
    if (!tentConfig) return
    const updatedTents = config.tents.map(t => {
      if (t.id !== tentId) return t
      return { ...t, targets: { ...t.targets, [key]: value } }
    })
    setConfig({ ...config, tents: updatedTents })
  }

  const handleScheduleChange = (key, value) => {
    if (!tentConfig) return
    const updatedTents = config.tents.map(t => {
      if (t.id !== tentId) return t
      return { ...t, schedules: { ...t.schedules, [key]: value } }
    })
    setConfig({ ...config, tents: updatedTents })
  }

  const handleThresholdEdit = (chain, newValue) => {
    if (chain.targetKey) {
      handleTargetChange(chain.targetKey, newValue)
    }
  }

  const handleCreateAutomation = async (chain) => {
    setCreating(chain.templateId)
    setError(null)
    try {
      const body = { tent_id: tentId }
      if (chain.condition === 'above' || chain.condition === 'below') {
        body.threshold = chain.threshold
      }
      if (chain.condition === 'time' && chain.templateId === 'light_schedule') {
        const schedules = tentConfig?.schedules || {}
        body.time_on = (schedules.photoperiod_on || '06:00') + ':00'
        body.time_off = (schedules.photoperiod_off || '22:00') + ':00'
      }
      const res = await apiFetch('api/automations/templates/' + chain.templateId + '/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.detail || 'Failed to create automation')
      }
      setSuccess('Automation created: ' + chain.label)
      setTimeout(() => setSuccess(null), 3000)
      await reloadSuggestions()
    } catch (err) {
      setError(err.message)
      setTimeout(() => setError(null), 5000)
    } finally {
      setCreating(null)
    }
  }

  const handleCreateAllMissing = async () => {
    const missing = chains.filter(c => c.status === 'missing')
    if (missing.length === 0) return
    setError(null)
    let created = 0
    for (const chain of missing) {
      setCreating(chain.templateId)
      try {
        const body = { tent_id: tentId }
        if (chain.condition === 'above' || chain.condition === 'below') {
          body.threshold = chain.threshold
        }
        if (chain.condition === 'time' && chain.templateId === 'light_schedule') {
          const schedules = tentConfig?.schedules || {}
          body.time_on = (schedules.photoperiod_on || '06:00') + ':00'
          body.time_off = (schedules.photoperiod_off || '22:00') + ':00'
        }
        const res = await apiFetch('api/automations/templates/' + chain.templateId + '/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        })
        if (res.ok) created++
      } catch {}
    }
    setCreating(null)
    setSuccess('Created ' + created + ' automation' + (created !== 1 ? 's' : ''))
    setTimeout(() => setSuccess(null), 3000)
    await reloadSuggestions()
  }

  return (
    <div className="space-y-3">
      {/* Tent header + context */}
      <div className="card py-3">
        <h3 className="font-semibold text-lg mb-2">{tent?.name || tentConfig?.name || tentId}</h3>
        {tent && <ContextBar tent={tent} schedules={tentConfig?.schedules} />}
      </div>

      {/* Equipment */}
      <div className="card py-3">
        <h3 className="font-semibold mb-2 text-sm text-gray-400">EQUIPMENT ({equipment.length})</h3>
        {equipment.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {equipment.map(eq => {
              const isOn = eq.state === 'on'
              return (
                <div
                  key={eq.type}
                  className={'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-sm ' +
                    (isOn ? 'bg-green-900/20 border-green-600/40 text-white' : 'bg-[#1a1a2e] border-[#2d3a5c] text-gray-500')}
                >
                  <span>{eq.icon}</span>
                  <span className="text-xs font-medium">{eq.label}</span>
                  {eq.count > 1 && <span className="text-xs text-gray-500">x{eq.count}</span>}
                  <span className={'w-1.5 h-1.5 rounded-full ' + (isOn ? 'bg-green-400' : 'bg-gray-600')} />
                </div>
              )
            })}
          </div>
        ) : (
          <p className="text-xs text-gray-500">No actuators configured. Add equipment in Settings.</p>
        )}
      </div>

      {/* Flow diagram */}
      {chains.length > 0 ? (
        <div className="card">
          <h3 className="font-semibold mb-3 text-sm text-gray-400">
            CONTROL FLOW
            <span className="ml-2 text-xs">
              {chains.filter(c => c.status === 'active').length} active
              {missingCount > 0 && ', ' + missingCount + ' missing'}
            </span>
          </h3>
          <div className="space-y-3">
            {chains.map(chain => (
              <ChainRow
                key={chain.templateId}
                chain={chain}
                onEdit={handleThresholdEdit}
                onCreate={handleCreateAutomation}
                creating={creating}
                formatTemp={formatTemp}
              />
            ))}
          </div>

          {missingCount > 0 && (
            <div className="mt-4 pt-3 border-t border-[#2d3a5c] text-center">
              <button
                onClick={handleCreateAllMissing}
                disabled={creating}
                className="btn btn-primary"
              >
                {creating ? 'Creating...' : 'Create ' + missingCount + ' Missing Automation' + (missingCount !== 1 ? 's' : '')}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="card text-center py-8">
          <div className="text-2xl mb-2">{'\u{2699}\u{FE0F}'}</div>
          <p className="text-gray-400">No climate chains available.</p>
          <p className="text-gray-500 text-sm mt-1">Add actuators (fans, heater, humidifier, etc.) to your tent in Settings.</p>
        </div>
      )}

      {/* Targets panel */}
      <div>
        <button
          onClick={() => setShowTargets(!showTargets)}
          className="text-sm font-medium text-gray-400 hover:text-white flex items-center gap-2 mb-2"
        >
          <span>{showTargets ? '\u{25BC}' : '\u{25B6}'}</span>
          Climate Targets
        </button>
        {showTargets && (
          <TargetsPanel
            tentConfig={tentConfig}
            onTargetChange={handleTargetChange}
            onScheduleChange={handleScheduleChange}
            formatTemp={formatTemp}
            unit={unit}
          />
        )}
      </div>
    </div>
  )
}

// --- Debug Panel ---

function DebugPanel({ config, tents, suggestions }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="card mt-4 border border-yellow-600/30">
      <button
        onClick={() => setOpen(!open)}
        className="w-full text-left text-sm font-medium text-yellow-400 flex items-center gap-2"
      >
        <span>{open ? '\u25BC' : '\u25B6'}</span>
        Debug Panel
      </button>
      {open && (
        <div className="mt-3 space-y-4 text-xs font-mono">
          {/* Config tents overview */}
          <div>
            <h4 className="text-yellow-400 font-bold mb-1">config.tents ({config?.tents?.length || 0})</h4>
            {(config?.tents || []).map((t, i) => (
              <div key={i} className="bg-[#1a1a2e] p-2 rounded mb-2">
                <div className="text-white font-bold mb-1">Tent: {t.name} (id: {t.id})</div>
                <div className="text-gray-400">
                  <div>sensors: {JSON.stringify(t.sensors)}</div>
                  <div className="mt-1">actuators: {JSON.stringify(t.actuators)}</div>
                  <div className="mt-1">targets: {JSON.stringify(t.targets)}</div>
                  <div className="mt-1">schedules: {JSON.stringify(t.schedules)}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Live tents from useTents() */}
          <div>
            <h4 className="text-yellow-400 font-bold mb-1">useTents() ({tents?.length || 0})</h4>
            {(tents || []).map((t, i) => (
              <div key={i} className="bg-[#1a1a2e] p-2 rounded mb-2">
                <div className="text-white font-bold mb-1">Tent: {t.name} (id: {t.id})</div>
                <div className="text-gray-400">
                  <div>avg_temperature: {t.avg_temperature}</div>
                  <div>avg_humidity: {t.avg_humidity}</div>
                  <div>vpd: {t.vpd}</div>
                  <div>sensors: {JSON.stringify(t.sensors)}</div>
                  <div className="mt-1">actuators: {JSON.stringify(t.actuators)}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Chain building per tent */}
          <div>
            <h4 className="text-yellow-400 font-bold mb-1">buildChains() results</h4>
            {(config?.tents || []).map((tentConfig, i) => {
              const tent = tents?.find(t => t.id === tentConfig.id)
              const chains = buildChains(tent, tentConfig, suggestions)
              const actuators = tentConfig.actuators || {}
              const sensors = tentConfig.sensors || {}
              return (
                <div key={i} className="bg-[#1a1a2e] p-2 rounded mb-2">
                  <div className="text-white font-bold mb-1">{tentConfig.name}: {chains.length} chains</div>
                  <div className="text-gray-500 mb-1">
                    hasEntity checks:
                    {Object.keys(ACTUATOR_INFO).map(k => (
                      <span key={k} className={'ml-2 ' + (hasEntity(actuators, k) ? 'text-green-400' : 'text-red-400')}>
                        {k}:{hasEntity(actuators, k) ? 'Y' : 'N'}
                      </span>
                    ))}
                  </div>
                  <div className="text-gray-500 mb-1">
                    sensor checks:
                    {['temperature', 'humidity', 'co2', 'light_level'].map(k => (
                      <span key={k} className={'ml-2 ' + (hasEntity(sensors, k) ? 'text-green-400' : 'text-red-400')}>
                        {k}:{hasEntity(sensors, k) ? 'Y' : 'N'}
                      </span>
                    ))}
                  </div>
                  {chains.length > 0 ? chains.map((c, j) => (
                    <div key={j} className="text-gray-400 ml-2">
                      {c.templateId}: sensor={c.sensorValue} threshold={c.threshold} actuator={c.actuatorState} status={c.status}
                    </div>
                  )) : (
                    <div className="text-red-400 ml-2">No chains built — all CHAIN_DEFS filtered out (missing actuators or sensors)</div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Suggestions */}
          <div>
            <h4 className="text-yellow-400 font-bold mb-1">suggestions ({suggestions?.length || 0})</h4>
            <div className="bg-[#1a1a2e] p-2 rounded">
              {suggestions?.length > 0
                ? suggestions.map((s, i) => (
                    <div key={i} className="text-gray-400">{s.tent_id}: {s.template_id}</div>
                  ))
                : <div className="text-gray-500">No suggestions returned</div>}
            </div>
          </div>

          {/* ID matching */}
          <div>
            <h4 className="text-yellow-400 font-bold mb-1">Tent ID matching</h4>
            <div className="bg-[#1a1a2e] p-2 rounded">
              {(config?.tents || []).map((tc, i) => {
                const match = tents?.find(t => t.id === tc.id)
                return (
                  <div key={i} className={'text-gray-400'}>
                    config tent "{tc.id}" → useTents match: <span className={match ? 'text-green-400' : 'text-red-400'}>{match ? 'FOUND (id=' + match.id + ')' : 'NOT FOUND'}</span>
                    {!match && tents?.length > 0 && (
                      <span className="text-yellow-400"> (available IDs: {tents.map(t => t.id).join(', ')})</span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// --- Main Component ---

export default function Climate() {
  const { tents, loading: tentsLoading, connected } = useTents()
  const { formatTemp, unit } = useTemperatureUnit()
  const [config, setConfig] = useState(null)
  const [suggestions, setSuggestions] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(null)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [weather, setWeather] = useState(null)
  const autoSaveTimer = useRef(null)
  const isInitialLoad = useRef(true)

  // Load config + suggestions + weather
  useEffect(() => {
    Promise.all([
      apiFetch('api/config').then(r => r.json()).catch(() => null),
      apiFetch('api/automations/suggestions').then(r => r.json()).catch(() => ({ suggestions: [] })),
      apiFetch('api/system/entities?domain=weather').then(r => r.json()).catch(() => ({ entities: [] })),
    ]).then(([configData, suggestionsData, entitiesData]) => {
      if (configData) setConfig(configData)
      setSuggestions(suggestionsData?.suggestions || [])
      const weatherEntities = (entitiesData?.entities || []).filter(e => e.entity_id.startsWith('weather.'))
      if (weatherEntities.length > 0) {
        apiFetch('api/system/entity/' + weatherEntities[0].entity_id)
          .then(r => r.json())
          .then(data => setWeather(data))
          .catch(() => {})
      }
    }).catch(() => {
      setError('Failed to load climate data')
    }).finally(() => {
      setLoading(false)
      setTimeout(() => { isInitialLoad.current = false }, 500)
    })
  }, [])

  // Auto-save config changes
  useEffect(() => {
    if (isInitialLoad.current || !config) return
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(async () => {
      try {
        await apiFetch('api/config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config)
        })
      } catch (err) {
        setError('Failed to save targets')
      }
    }, 1500)
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current) }
  }, [config])

  const reloadSuggestions = async () => {
    try {
      const res = await apiFetch('api/automations/suggestions')
      const data = await res.json()
      setSuggestions(data.suggestions || [])
    } catch {}
  }

  if (loading || tentsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Loading climate data...</div>
      </div>
    )
  }

  if (!config?.tents?.length) {
    return (
      <div className="space-y-4">
        <div className="card text-center py-12">
          <div className="text-4xl mb-4">{'\u{1F331}'}</div>
          <h3 className="text-xl font-semibold mb-2">No Tents Configured</h3>
          <p className="text-gray-400 mb-4">Set up a tent in Settings to see the climate control flow.</p>
          <a href="#/settings" className="btn btn-primary">Go to Settings</a>
        </div>
        <DebugPanel config={config} tents={tents} suggestions={suggestions} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-2xl font-bold">Climate Control <span className="text-xs text-gray-600 font-normal">v1.2.44</span></h2>
        {!connected && (
          <span className="text-xs text-red-400">Disconnected</span>
        )}
      </div>

      {/* Debug Panel - right after header */}
      <DebugPanel config={config} tents={tents} suggestions={suggestions} />

      {/* Status messages */}
      {error && (
        <div className="p-3 bg-red-500/20 border border-red-500/50 rounded text-red-300 text-sm">{error}</div>
      )}
      {success && (
        <div className="p-3 bg-green-500/20 border border-green-500/50 rounded text-green-300 text-sm">{success}</div>
      )}

      {/* Outdoor Conditions */}
      {weather ? (
        <div className="card py-3">
          <h3 className="font-semibold mb-2 text-sm text-gray-400">OUTDOOR CONDITIONS</h3>
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-lg">{'\u{1F326}\u{FE0F}'}</span>
              <div>
                <div className="text-sm font-medium capitalize">{weather.state}</div>
                <div className="text-xs text-gray-500">{weather.attributes?.friendly_name || 'Weather'}</div>
              </div>
            </div>
            {weather.attributes?.temperature != null && (
              <div className="text-center">
                <div className="text-lg font-bold">{formatTemp(weather.attributes.temperature)}</div>
                <div className="text-xs text-gray-500">Temp</div>
              </div>
            )}
            {weather.attributes?.humidity != null && (
              <div className="text-center">
                <div className="text-lg font-bold">{weather.attributes.humidity}%</div>
                <div className="text-xs text-gray-500">Humidity</div>
              </div>
            )}
            {weather.attributes?.wind_speed != null && (
              <div className="text-center">
                <div className="text-sm font-bold">{weather.attributes.wind_speed}</div>
                <div className="text-xs text-gray-500">Wind</div>
              </div>
            )}
            {weather.attributes?.pressure != null && (
              <div className="text-center">
                <div className="text-sm font-bold">{weather.attributes.pressure}</div>
                <div className="text-xs text-gray-500">hPa</div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="card py-3">
          <h3 className="font-semibold mb-2 text-sm text-gray-400">OUTDOOR CONDITIONS</h3>
          <p className="text-xs text-gray-500">No weather integration found. Add OpenWeatherMap in HA for outdoor data.</p>
        </div>
      )}

      {/* All tents */}
      {(config?.tents || []).map(tentConfig => {
        const tent = tents.find(t => t.id === tentConfig.id)
        return (
          <TentSection
            key={tentConfig.id}
            tent={tent}
            tentConfig={tentConfig}
            suggestions={suggestions}
            config={config}
            setConfig={setConfig}
            creating={creating}
            setCreating={setCreating}
            setError={setError}
            setSuccess={setSuccess}
            reloadSuggestions={reloadSuggestions}
            formatTemp={formatTemp}
            unit={unit}
          />
        )
      })}

      {/* Legend */}
      <div className="text-xs text-gray-500 flex items-center gap-4 flex-wrap">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-green-400" /> Automation active
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-gray-600" /> No automation
        </span>
        <span className="flex items-center gap-1">
          <span className="text-green-400">{'\u{2192}'}</span> Active link
        </span>
        <span className="flex items-center gap-1">
          <span className="text-gray-600">{'\u{2192}'}</span> Missing link
        </span>
        <span>Click threshold values to edit</span>
      </div>

    </div>
  )
}
