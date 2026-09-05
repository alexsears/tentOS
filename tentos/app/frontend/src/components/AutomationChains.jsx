import { useState, useEffect, useMemo, useRef } from 'react'
import { useTents } from '../hooks/useTents'
import { useTemperatureUnit } from '../hooks/useTemperatureUnit'
import { apiFetch } from '../utils/api'
import { Check, ChevronDown, ChevronRight, Moon, Pencil, Sun, X } from 'lucide-react'
import { actuatorBaseType, actuatorIcon, sensorIcon, stageIcon, SENSOR_ICONS } from '../utils/icons'

// Chain definitions mapping to backend AUTOMATION_TEMPLATES
const CHAIN_DEFS = [
  {
    templateId: 'high_temp_exhaust',
    sensorType: 'temperature',
    actuatorType: 'exhaust_fan',
    condition: 'above',
    defaultThreshold: 28,
    targetKey: 'temp_day_max',
    description: (t) => 'Temp > ' + t + ' \u{2192} Exhaust fan',
    unit: '\u{00B0}',
  },
  {
    templateId: 'high_temp_ac',
    sensorType: 'temperature',
    actuatorType: 'ac',
    condition: 'above',
    defaultThreshold: 28,
    targetKey: 'temp_day_max',
    description: (t) => 'Temp > ' + t + ' \u{2192} A/C',
    unit: '\u{00B0}',
  },
  {
    templateId: 'low_temp_heater',
    sensorType: 'temperature',
    actuatorType: 'heater',
    condition: 'below',
    defaultThreshold: 18,
    targetKey: 'temp_night_min',
    description: (t) => 'Temp < ' + t + ' \u{2192} Heater',
    unit: '\u{00B0}',
  },
  {
    templateId: 'high_humidity_dehumidifier',
    sensorType: 'humidity',
    actuatorType: 'dehumidifier',
    condition: 'above',
    defaultThreshold: 70,
    targetKey: 'humidity_day_max',
    description: (t) => 'Humidity > ' + t + '% \u{2192} Dehumidifier',
    unit: '%',
  },
  {
    templateId: 'low_humidity_humidifier',
    sensorType: 'humidity',
    actuatorType: 'humidifier',
    condition: 'below',
    defaultThreshold: 50,
    targetKey: 'humidity_day_min',
    description: (t) => 'Humidity < ' + t + '% \u{2192} Humidifier',
    unit: '%',
  },
  {
    templateId: 'high_vpd_humidifier',
    sensorType: 'vpd',
    actuatorType: 'humidifier',
    condition: 'above',
    defaultThreshold: 1.4,
    targetKey: null,
    description: (t) => 'VPD > ' + t + ' kPa \u{2192} Humidifier',
    unit: ' kPa',
    requires: ['temperature', 'humidity'],
  },
  {
    templateId: 'low_vpd_dehumidifier',
    sensorType: 'vpd',
    actuatorType: 'dehumidifier',
    condition: 'below',
    defaultThreshold: 0.8,
    targetKey: null,
    description: (t) => 'VPD < ' + t + ' kPa \u{2192} Dehumidifier',
    unit: ' kPa',
    requires: ['temperature', 'humidity'],
  },
  {
    templateId: 'light_schedule',
    sensorType: null,
    actuatorType: 'light',
    condition: 'time',
    description: () => 'Light schedule',
    unit: '',
  },
  {
    templateId: 'circulation_fan_with_lights',
    sensorType: null,
    actuatorType: 'circulation_fan',
    condition: 'state',
    description: () => 'Circ fan follows lights',
    unit: '',
  },
  {
    templateId: 'watering_schedule',
    sensorType: null,
    actuatorType: 'water_pump',
    condition: 'time',
    description: () => 'Watering schedule',
    unit: '',
  },
  {
    templateId: 'low_co2_injector',
    sensorType: 'co2',
    actuatorType: 'co2_injector',
    condition: 'below',
    defaultThreshold: 1000,
    targetKey: 'co2_day_target',
    description: (t) => 'CO2 < ' + t + ' ppm \u{2192} CO2 injector (lights on)',
    unit: ' ppm',
  },
]

// Labels only; the glyph for each slot comes from the shared icon vocabulary.
const ACTUATOR_INFO = {
  light: { label: 'Lights' },
  exhaust_fan: { label: 'Exhaust' },
  circulation_fan: { label: 'Circ fan' },
  humidifier: { label: 'Humidifier' },
  dehumidifier: { label: 'Dehu' },
  heater: { label: 'Heater' },
  ac: { label: 'A/C' },
  water_pump: { label: 'Water' },
  drain_pump: { label: 'Drain' },
  co2_injector: { label: 'CO2' },
}

// A chain is drawn with the icon of the sensor that triggers it, or of the
// actuator it drives when it is a schedule or state rule.
function chainIcon(def) {
  return def.sensorType ? sensorIcon(def.sensorType) : actuatorIcon(def.actuatorType)
}

function hasEntity(mapping, key) {
  const val = mapping?.[key]
  if (Array.isArray(val)) return val.some(v => v)
  return !!val
}

function nameToId(name) {
  return (name || '').toLowerCase().replace(/\s+/g, '_')
}

function findMatchingTent(tents, tentConfig) {
  return tents.find(t => t.id === tentConfig.id) ||
    tents.find(t => t.id === nameToId(tentConfig.name)) ||
    tents.find(t => nameToId(t.name) === nameToId(tentConfig.name))
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
  const tentNameId = nameToId(tentConfig.name)

  const suggestionSet = new Set(
    (suggestions || [])
      .filter(s => s.tent_id === tentId || s.tent_id === tentNameId)
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

// --- Components ---

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

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <div>
        <label className="text-xs text-gray-400">Day temp min ({'\u{00B0}'}{unit})</label>
        <input type="number" value={displayTemp(targets.temp_day_min ?? 22)}
          onChange={e => { const c = parseTemp(e.target.value); if (c != null) onTargetChange('temp_day_min', c) }}
          className="input w-full text-sm py-1" step={tempStep} />
      </div>
      <div>
        <label className="text-xs text-gray-400">Day temp max ({'\u{00B0}'}{unit})</label>
        <input type="number" value={displayTemp(targets.temp_day_max ?? 28)}
          onChange={e => { const c = parseTemp(e.target.value); if (c != null) onTargetChange('temp_day_max', c) }}
          className="input w-full text-sm py-1" step={tempStep} />
      </div>
      <div>
        <label className="text-xs text-gray-400">Night temp min ({'\u{00B0}'}{unit})</label>
        <input type="number" value={displayTemp(targets.temp_night_min ?? 18)}
          onChange={e => { const c = parseTemp(e.target.value); if (c != null) onTargetChange('temp_night_min', c) }}
          className="input w-full text-sm py-1" step={tempStep} />
      </div>
      <div>
        <label className="text-xs text-gray-400">Night temp max ({'\u{00B0}'}{unit})</label>
        <input type="number" value={displayTemp(targets.temp_night_max ?? 24)}
          onChange={e => { const c = parseTemp(e.target.value); if (c != null) onTargetChange('temp_night_max', c) }}
          className="input w-full text-sm py-1" step={tempStep} />
      </div>
      <div>
        <label className="text-xs text-gray-400">Day humidity min (%)</label>
        <input type="number" value={targets.humidity_day_min ?? 50}
          onChange={e => { const n = parseFloat(e.target.value); if (!isNaN(n)) onTargetChange('humidity_day_min', n) }}
          className="input w-full text-sm py-1" />
      </div>
      <div>
        <label className="text-xs text-gray-400">Day humidity max (%)</label>
        <input type="number" value={targets.humidity_day_max ?? 70}
          onChange={e => { const n = parseFloat(e.target.value); if (!isNaN(n)) onTargetChange('humidity_day_max', n) }}
          className="input w-full text-sm py-1" />
      </div>
      <div>
        <label className="text-xs text-gray-400">Day CO2 target (ppm)</label>
        <input type="number" value={targets.co2_day_target ?? 1000} step="50"
          onChange={e => { const n = parseFloat(e.target.value); if (!isNaN(n)) onTargetChange('co2_day_target', n) }}
          className="input w-full text-sm py-1" />
      </div>
      <div>
        <label className="text-xs text-gray-400">CO2 max (ppm)</label>
        <input type="number" value={targets.co2_max ?? 1500} step="50"
          onChange={e => { const n = parseFloat(e.target.value); if (!isNaN(n)) onTargetChange('co2_max', n) }}
          className="input w-full text-sm py-1" />
      </div>
      <div>
        <label className="text-xs text-gray-400">Lights on</label>
        <input type="time" value={schedules.photoperiod_on ?? '06:00'}
          onChange={e => onScheduleChange('photoperiod_on', e.target.value)}
          className="input w-full text-sm py-1" />
      </div>
      <div>
        <label className="text-xs text-gray-400">Lights off</label>
        <input type="time" value={schedules.photoperiod_off ?? '22:00'}
          onChange={e => onScheduleChange('photoperiod_off', e.target.value)}
          className="input w-full text-sm py-1" />
      </div>
    </div>
  )
}

function TentSection({ tent, tentConfig, suggestions, config, setConfig, creating, setCreating, setError, setSuccess, reloadSuggestions, formatTemp, unit }) {
  const [showTargets, setShowTargets] = useState(false)
  const [editingChain, setEditingChain] = useState(null)
  const [editVal, setEditVal] = useState('')
  const tentId = tentConfig?.id
  const apiTentId = tent?.id || nameToId(tentConfig?.name) || tentId

  const chains = useMemo(() => buildChains(tent, tentConfig, suggestions), [tent, tentConfig, suggestions])
  const missingCount = chains.filter(c => c.status === 'missing').length

  // Build equipment list from configured actuators only
  const equipment = useMemo(() => {
    if (!tentConfig) return []
    const items = []
    const actuators = tentConfig.actuators || {}
    for (const [type, val] of Object.entries(actuators)) {
      const entities = Array.isArray(val) ? val.filter(v => v) : (val ? [val] : [])
      if (entities.length === 0) continue
      const info = ACTUATOR_INFO[actuatorBaseType(type)] || { label: type.replace(/_/g, ' ') }
      const state = getActuatorState(tent, type)
      items.push({ type, ...info, Icon: actuatorIcon(type), count: entities.length, state })
    }
    return items
  }, [tentConfig, tent])

  // Context info
  const stage = tent?.growth_stage || {}
  const StageIcon = stageIcon(stage.stage)
  const daytime = isDaytime(tentConfig?.schedules)
  const score = tent?.environment_score

  // Sensor readings
  const temp = tent?.avg_temperature ?? null
  const humidity = tent?.avg_humidity ?? null
  const vpd = tent?.vpd ?? null
  const targets = tentConfig?.targets || {}

  const tempInRange = temp != null && temp >= (targets.temp_day_min ?? 18) && temp <= (targets.temp_day_max ?? 30)
  const humidInRange = humidity != null && humidity >= (targets.humidity_day_min ?? 40) && humidity <= (targets.humidity_day_max ?? 80)

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
    if (chain.targetKey) handleTargetChange(chain.targetKey, newValue)
    setEditingChain(null)
  }

  const handleCreateAutomation = async (chain) => {
    setCreating(chain.templateId)
    setError(null)
    try {
      const body = { tent_id: apiTentId }
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
        let detail = 'Failed (HTTP ' + res.status + ')'
        try { const data = await res.json(); detail = data.detail || detail } catch {}
        throw new Error(detail)
      }
      setSuccess('Automation created!')
      setTimeout(() => setSuccess(null), 4000)
      await reloadSuggestions()
    } catch (err) {
      setError(err.message)
    } finally {
      setCreating(null)
    }
  }

  const handleCreateAllMissing = async () => {
    const missing = chains.filter(c => c.status === 'missing')
    if (missing.length === 0) return
    setError(null)
    let created = 0
    const errors = []
    for (const chain of missing) {
      setCreating(chain.templateId)
      try {
        const body = { tent_id: apiTentId }
        if (chain.condition === 'above' || chain.condition === 'below') body.threshold = chain.threshold
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
        else {
          let detail = 'HTTP ' + res.status
          try { const d = await res.json(); detail = d.detail || detail } catch {}
          errors.push(chain.description(chain.threshold) + ': ' + detail)
        }
      } catch (err) {
        errors.push(chain.description(chain.threshold) + ': ' + err.message)
      }
    }
    setCreating(null)
    if (created > 0) { setSuccess('Created ' + created + ' automation' + (created !== 1 ? 's' : '')); setTimeout(() => setSuccess(null), 4000) }
    if (errors.length > 0) setError(errors.join('; '))
    await reloadSuggestions()
  }

  // Format threshold for display
  // Descriptions already carry their unit, so only temperature needs conversion.
  const fmtThreshold = (chain) => {
    if (chain.sensorType === 'temperature') return formatTemp(chain.threshold)
    return chain.threshold
  }

  // Build description with formatted threshold
  const chainDesc = (chain) => {
    if (chain.condition === 'time' || chain.condition === 'state') return chain.description()
    return chain.description(fmtThreshold(chain))
  }

  return (
    <div className="card">
      {/* Header row: name + badges */}
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <h3 className="font-semibold text-lg">{tent?.name || tentConfig?.name || tentId}</h3>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border border-[#2d3a5c] text-gray-300">
            {daytime
              ? <Sun size={12} aria-hidden="true" />
              : <Moon size={12} aria-hidden="true" />}
            {daytime ? 'Day' : 'Night'}
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border border-[#2d3a5c] text-gray-300 capitalize">
            <StageIcon size={12} aria-hidden="true" />
            {stage.stage || 'Veg'}
            {stage.flower_week ? ' wk ' + stage.flower_week : ''}
          </span>
          {score != null && (
            <span className={'px-2 py-0.5 rounded-full text-xs font-medium bg-[#2d3a5c] ' +
              (score >= 80 ? 'text-green-400' : score >= 60 ? 'text-yellow-400' : 'text-red-400')}>
              {score}/100
            </span>
          )}
        </div>
      </div>

      {/* Live readings */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className={'rounded-lg p-3 text-center border ' +
          (temp == null ? 'border-[#2d3a5c] bg-[#1a1a2e]' : tempInRange ? 'border-green-600/40 bg-green-900/10' : 'border-red-500/40 bg-red-900/10')}>
          <div className="text-2xl font-bold">{temp != null ? formatTemp(temp) : '--'}</div>
          <div className="text-xs text-gray-400 mt-1 inline-flex items-center gap-1"><SENSOR_ICONS.temperature size={12} aria-hidden="true" />Temperature</div>
        </div>
        <div className={'rounded-lg p-3 text-center border ' +
          (humidity == null ? 'border-[#2d3a5c] bg-[#1a1a2e]' : humidInRange ? 'border-green-600/40 bg-green-900/10' : 'border-red-500/40 bg-red-900/10')}>
          <div className="text-2xl font-bold">{humidity != null ? Number(humidity).toFixed(0) + '%' : '--'}</div>
          <div className="text-xs text-gray-400 mt-1 inline-flex items-center gap-1"><SENSOR_ICONS.humidity size={12} aria-hidden="true" />Humidity</div>
        </div>
        <div className="rounded-lg p-3 text-center border border-[#2d3a5c] bg-[#1a1a2e]">
          <div className="text-2xl font-bold">{vpd != null ? Number(vpd).toFixed(2) : '--'}</div>
          <div className="text-xs text-gray-400 mt-1 inline-flex items-center gap-1"><SENSOR_ICONS.vpd size={12} aria-hidden="true" />VPD</div>
        </div>
      </div>

      {/* Equipment pills */}
      {equipment.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {equipment.map(eq => {
            const isOn = eq.state === 'on'
            return (
              <span key={eq.type} className={'inline-flex items-center gap-1 px-2 py-1 rounded text-xs ' +
                (isOn ? 'bg-green-900/30 text-green-400' : 'bg-[#1a1a2e] text-gray-500')}>
                <eq.Icon size={12} aria-hidden="true" />
                {eq.label}{eq.count > 1 ? ' x' + eq.count : ''}
                <span className={'inline-block w-1.5 h-1.5 rounded-full ' + (isOn ? 'bg-green-400' : 'bg-gray-600')} />
              </span>
            )
          })}
        </div>
      )}

      {/* Automation rules */}
      {chains.length > 0 && (
        <div className="mb-3">
          <div className="text-xs text-gray-400 mb-2 font-medium">
            Automations
            {missingCount > 0 && <span className="text-amber-400 ml-1">({missingCount} missing)</span>}
          </div>
          <div className="space-y-1">
            {chains.map(chain => {
              const isActive = chain.status === 'active'
              const ChainIcon = chainIcon(chain)
              return (
                <div key={chain.templateId}
                  className={'flex items-center gap-2 px-3 py-2 rounded-lg text-sm ' +
                    (isActive ? 'bg-green-900/10 border border-green-600/20' : 'bg-[#1a1a2e] border border-dashed border-[#2d3a5c]')}>
                  <ChainIcon size={16} className={'flex-shrink-0 ' + (isActive ? 'text-green-400' : 'text-gray-500')} aria-hidden="true" />
                  <span className={'flex-1 min-w-0 truncate ' + (isActive ? 'text-gray-200' : 'text-gray-500')}>
                    {editingChain === chain.templateId ? (
                      <span className="inline-flex items-center gap-1">
                        <span>{chain.condition === 'above' ? '>' : '<'}</span>
                        <input type="number" autoFocus value={editVal}
                          onChange={e => setEditVal(e.target.value)}
                          onBlur={() => { const n = parseFloat(editVal); if (!isNaN(n)) handleThresholdEdit(chain, n); else setEditingChain(null) }}
                          onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditingChain(null) }}
                          className="input w-16 text-center py-0 px-1 text-sm inline-block"
                          step={chain.sensorType === 'vpd' ? '0.1' : '1'} />
                      </span>
                    ) : (
                      <span>
                        {chainDesc(chain)}
                        {chain.targetKey && (
                          <button
                            type="button"
                            onClick={() => { setEditingChain(chain.templateId); setEditVal(chain.threshold) }}
                            className="ml-1 -my-2 inline-flex items-center justify-center min-h-11 min-w-11 rounded-lg text-gray-500 hover:text-green-400 align-middle"
                            aria-label="Edit threshold"
                            title="Edit threshold"
                          ><Pencil size={14} aria-hidden="true" /></button>
                        )}
                      </span>
                    )}
                  </span>
                  {isActive ? (
                    <span className="inline-flex items-center gap-1 text-green-400 text-xs font-medium flex-shrink-0"><Check size={14} aria-hidden="true" />Active</span>
                  ) : (
                    <button
                      onClick={() => handleCreateAutomation(chain)}
                      disabled={creating === chain.templateId}
                      className="text-xs px-3 min-h-11 -my-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded-lg text-white flex-shrink-0 transition-colors"
                    >
                      {creating === chain.templateId ? 'Creating...' : 'Create'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
          {missingCount > 1 && (
            <button
              onClick={handleCreateAllMissing}
              disabled={creating}
              className="mt-2 w-full text-xs min-h-11 bg-green-600/20 hover:bg-green-600/30 disabled:opacity-50 border border-green-600/30 rounded-lg text-green-400 transition-colors"
            >
              {creating ? 'Creating...' : 'Create all ' + missingCount + ' missing'}
            </button>
          )}
        </div>
      )}

      {/* Targets */}
      <button
        onClick={() => setShowTargets(!showTargets)}
        aria-expanded={showTargets}
        className="min-h-11 text-xs font-medium text-gray-400 hover:text-gray-200 flex items-center gap-1.5 transition-colors"
      >
        {showTargets
          ? <ChevronDown size={14} aria-hidden="true" />
          : <ChevronRight size={14} aria-hidden="true" />}
        Climate targets
      </button>
      {showTargets && (
        <div className="mt-3">
          <TargetsPanel
            tentConfig={tentConfig}
            onTargetChange={handleTargetChange}
            onScheduleChange={handleScheduleChange}
            formatTemp={formatTemp}
            unit={unit}
          />
        </div>
      )}
    </div>
  )
}

// --- Main Component ---

const NoTentIcon = stageIcon('veg')

export default function AutomationChains() {
  const { tents, loading: tentsLoading, connected } = useTents()
  const { formatTemp, unit } = useTemperatureUnit()
  const [config, setConfig] = useState(null)
  const [suggestions, setSuggestions] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(null)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const autoSaveTimer = useRef(null)
  const isInitialLoad = useRef(true)

  useEffect(() => {
    Promise.all([
      apiFetch('api/config').then(r => r.json()).catch(() => null),
      apiFetch('api/automations/suggestions').then(r => r.json()).catch(() => ({ suggestions: [] })),
    ]).then(([configData, suggestionsData]) => {
      if (configData) setConfig(configData)
      setSuggestions(suggestionsData?.suggestions || [])
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
      } catch {
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
        <div className="text-gray-400">Loading...</div>
      </div>
    )
  }

  if (!config?.tents?.length) {
    return (
      <div className="card text-center py-12">
        <NoTentIcon size={28} className="mx-auto mb-3 text-gray-500" aria-hidden="true" />
        <h3 className="text-xl font-semibold mb-2">No tents configured</h3>
        <p className="text-gray-400 mb-4">Set up a tent in Settings first.</p>
        <a href="#/settings" className="btn btn-primary inline-flex items-center min-h-11">Go to settings</a>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Automation chains</h2>
        {!connected && <span className="text-xs text-red-400">Disconnected</span>}
      </div>

      {error && (
        <div className="p-3 bg-red-500/20 border border-red-500/50 rounded text-red-300 text-sm flex items-start justify-between gap-2">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss error" className="text-red-400 hover:text-red-200 flex-shrink-0 inline-flex items-center justify-center min-h-11 min-w-11 -my-2"><X size={16} aria-hidden="true" /></button>
        </div>
      )}
      {success && (
        <div className="p-3 bg-green-500/20 border border-green-500/50 rounded text-green-300 text-sm">{success}</div>
      )}

      {(config?.tents || []).map(tentConfig => {
        const tent = findMatchingTent(tents, tentConfig)
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
    </div>
  )
}
