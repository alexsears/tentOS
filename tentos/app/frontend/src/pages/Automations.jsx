import { useState, useEffect, useMemo } from 'react'
import { apiFetch } from '../utils/api'

// Sensor metadata for display
const SENSOR_META = {
  temperature: { label: 'Temperature', icon: '🌡️', unit: '°C' },
  humidity: { label: 'Humidity', icon: '💧', unit: '%' },
  vpd: { label: 'VPD', icon: '🎯', unit: 'kPa' },
  co2: { label: 'CO2', icon: '🫧', unit: 'ppm' },
  light_level: { label: 'Light Level', icon: '☀️', unit: 'lux' },
  reservoir_level: { label: 'Reservoir', icon: '🪣', unit: '%' },
  power_usage: { label: 'Power', icon: '⚡', unit: 'W' }
}

// Actuator metadata for display
const ACTUATOR_META = {
  light: { label: 'Grow Lights', icon: '💡' },
  exhaust_fan: { label: 'Exhaust Fans', icon: '🌀' },
  circulation_fan: { label: 'Circulation Fans', icon: '🔄' },
  humidifier: { label: 'Humidifier', icon: '💨' },
  dehumidifier: { label: 'Dehumidifier', icon: '🏜️' },
  heater: { label: 'Heater', icon: '🔥' },
  water_pump: { label: 'Water Pumps', icon: '🚿' },
  drain_pump: { label: 'Drain Pump', icon: '🔽' }
}

// Quick scenario templates
const SCENARIOS = [
  { id: 'high_temp', name: 'High Temp → Fan', icon: '🌡️', sensor: 'temperature', type: 'sensor_above', value: 28, actuator: 'exhaust_fan', action: 'turn_on' },
  { id: 'low_temp', name: 'Low Temp → Heater', icon: '🔥', sensor: 'temperature', type: 'sensor_below', value: 18, actuator: 'heater', action: 'turn_on' },
  { id: 'low_humidity', name: 'Low Humidity → Humidifier', icon: '💧', sensor: 'humidity', type: 'sensor_below', value: 50, actuator: 'humidifier', action: 'turn_on' },
  { id: 'high_humidity', name: 'High Humidity → Dehumidifier', icon: '🏜️', sensor: 'humidity', type: 'sensor_above', value: 70, actuator: 'dehumidifier', action: 'turn_on' },
  { id: 'high_vpd', name: 'High VPD → Humidifier', icon: '🎯', sensor: 'vpd', type: 'sensor_above', value: 1.4, actuator: 'humidifier', action: 'turn_on' },
  { id: 'light_on', name: 'Light Schedule', icon: '💡', sensor: null, type: 'schedule', actuator: 'light', action: 'turn_on' }
]

// Automation Builder - simplified with dropdowns
function AutomationBuilder({ tents, config, onSave, onCancel, initialRule = null }) {
  const [form, setForm] = useState(initialRule || {
    name: '',
    tent_id: tents[0]?.id || '',
    enabled: true,
    trigger_type: 'sensor_above',
    trigger_sensor: '',
    trigger_value: '',
    trigger_schedule_on: '06:00',
    trigger_schedule_off: '22:00',
    action_type: 'turn_on',
    action_actuator: '',
    hysteresis: 1.0
  })

  // Get the selected tent's configured sensors and actuators
  const selectedTent = useMemo(() => {
    return config?.tents?.find(t => t.id === form.tent_id) || null
  }, [config, form.tent_id])

  const availableSensors = useMemo(() => {
    if (!selectedTent?.sensors) return []
    // Always include VPD since it's calculated
    const sensors = Object.entries(selectedTent.sensors)
      .filter(([_, entityId]) => entityId)
      .map(([type, _]) => ({
        id: type,
        ...SENSOR_META[type] || { label: type, icon: '📊' }
      }))

    // Add VPD if temp and humidity are configured
    if (selectedTent.sensors.temperature && selectedTent.sensors.humidity) {
      sensors.push({ id: 'vpd', ...SENSOR_META.vpd })
    }
    return sensors
  }, [selectedTent])

  const availableActuators = useMemo(() => {
    if (!selectedTent?.actuators) return []
    return Object.entries(selectedTent.actuators)
      .filter(([_, entityId]) => entityId)
      .map(([type, _]) => ({
        id: type,
        ...ACTUATOR_META[type] || { label: type, icon: '🔌' }
      }))
  }, [selectedTent])

  // Apply a quick scenario
  const applyScenario = (scenario) => {
    setForm(prev => ({
      ...prev,
      name: scenario.name,
      trigger_type: scenario.type,
      trigger_sensor: scenario.sensor || '',
      trigger_value: scenario.value || '',
      action_type: scenario.action,
      action_actuator: scenario.actuator
    }))
  }

  // Filter scenarios to only show ones that work with configured entities
  const applicableScenarios = useMemo(() => {
    return SCENARIOS.filter(s => {
      if (s.sensor && !availableSensors.find(sen => sen.id === s.sensor)) return false
      if (s.actuator && !availableActuators.find(act => act.id === s.actuator)) return false
      return true
    })
  }, [availableSensors, availableActuators])

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!form.name || !form.tent_id) {
      alert('Please fill in all required fields')
      return
    }
    if (form.trigger_type !== 'schedule' && !form.trigger_sensor) {
      alert('Please select a trigger sensor')
      return
    }
    if (!form.action_actuator) {
      alert('Please select an actuator')
      return
    }
    onSave(form)
  }

  const isSchedule = form.trigger_type === 'schedule'
  const selectedSensor = SENSOR_META[form.trigger_sensor]

  return (
    <div className="card space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-semibold">
          {initialRule ? 'Edit Automation' : 'Create Automation'}
        </h3>
        <button onClick={onCancel} className="text-gray-400 hover:text-white">✕</button>
      </div>

      {/* Quick Scenarios - only show applicable ones */}
      {!initialRule && applicableScenarios.length > 0 && (
        <div>
          <label className="text-sm text-gray-400 block mb-2">Quick Start</label>
          <div className="flex flex-wrap gap-2">
            {applicableScenarios.map(scenario => (
              <button
                key={scenario.id}
                onClick={() => applyScenario(scenario)}
                className="px-3 py-2 bg-[#1a1a2e] hover:bg-[#2d3a5c] rounded-lg text-sm flex items-center gap-2"
              >
                <span>{scenario.icon}</span>
                <span>{scenario.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Basic Info */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm text-gray-400 block mb-1">Rule Name *</label>
          <input
            type="text"
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            className="input w-full"
            placeholder="e.g., High Temp Fan Control"
          />
        </div>
        <div>
          <label className="text-sm text-gray-400 block mb-1">Tent *</label>
          <select
            value={form.tent_id}
            onChange={e => setForm({ ...form, tent_id: e.target.value, trigger_sensor: '', action_actuator: '' })}
            className="input w-full"
          >
            {tents.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* IF (Trigger) */}
      <div className="p-4 bg-[#0d1117] rounded-lg">
        <div className="flex items-center gap-2 mb-4">
          <span className="bg-blue-600 text-white text-xs font-bold px-2 py-1 rounded">IF</span>
          <span className="text-sm text-gray-400">When this condition is met</span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label className="text-sm text-gray-400 block mb-1">Trigger Type</label>
            <select
              value={form.trigger_type}
              onChange={e => setForm({ ...form, trigger_type: e.target.value })}
              className="input w-full"
            >
              <option value="sensor_above">Sensor Above</option>
              <option value="sensor_below">Sensor Below</option>
              <option value="schedule">Time Schedule</option>
            </select>
          </div>

          {!isSchedule ? (
            <>
              <div>
                <label className="text-sm text-gray-400 block mb-1">Sensor</label>
                <select
                  value={form.trigger_sensor}
                  onChange={e => setForm({ ...form, trigger_sensor: e.target.value })}
                  className="input w-full"
                >
                  <option value="">Select sensor...</option>
                  {availableSensors.map(s => (
                    <option key={s.id} value={s.id}>{s.icon} {s.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm text-gray-400 block mb-1">
                  Threshold {selectedSensor?.unit && `(${selectedSensor.unit})`}
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={form.trigger_value}
                  onChange={e => setForm({ ...form, trigger_value: parseFloat(e.target.value) || '' })}
                  className="input w-full"
                  placeholder={selectedSensor?.unit === '°C' ? '28' : selectedSensor?.unit === '%' ? '70' : ''}
                />
              </div>
              <div>
                <label className="text-sm text-gray-400 block mb-1">Hysteresis</label>
                <input
                  type="number"
                  step="0.1"
                  value={form.hysteresis}
                  onChange={e => setForm({ ...form, hysteresis: parseFloat(e.target.value) || 0 })}
                  className="input w-full"
                  placeholder="1.0"
                />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="text-sm text-gray-400 block mb-1">Turn On Time</label>
                <input
                  type="time"
                  value={form.trigger_schedule_on}
                  onChange={e => setForm({ ...form, trigger_schedule_on: e.target.value })}
                  className="input w-full"
                />
              </div>
              <div>
                <label className="text-sm text-gray-400 block mb-1">Turn Off Time</label>
                <input
                  type="time"
                  value={form.trigger_schedule_off}
                  onChange={e => setForm({ ...form, trigger_schedule_off: e.target.value })}
                  className="input w-full"
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* THEN (Action) */}
      <div className="p-4 bg-[#0d1117] rounded-lg">
        <div className="flex items-center gap-2 mb-4">
          <span className="bg-green-600 text-white text-xs font-bold px-2 py-1 rounded">THEN</span>
          <span className="text-sm text-gray-400">Perform this action</span>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-gray-400 block mb-1">Action</label>
            <select
              value={form.action_type}
              onChange={e => setForm({ ...form, action_type: e.target.value })}
              className="input w-full"
            >
              <option value="turn_on">Turn On</option>
              <option value="turn_off">Turn Off</option>
            </select>
          </div>
          <div>
            <label className="text-sm text-gray-400 block mb-1">Actuator</label>
            <select
              value={form.action_actuator}
              onChange={e => setForm({ ...form, action_actuator: e.target.value })}
              className="input w-full"
            >
              <option value="">Select actuator...</option>
              {availableActuators.map(a => (
                <option key={a.id} value={a.id}>{a.icon} {a.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* No sensors/actuators warning */}
      {availableSensors.length === 0 && availableActuators.length === 0 && (
        <div className="p-4 bg-yellow-500/20 border border-yellow-500/50 rounded-lg text-yellow-300 text-sm">
          No sensors or actuators configured for this tent. Go to Settings → Tent Builder to add them first.
        </div>
      )}

      {/* Submit */}
      <div className="flex gap-2 pt-4 border-t border-[#2d3a5c]">
        <button
          onClick={handleSubmit}
          disabled={availableSensors.length === 0 && availableActuators.length === 0}
          className="btn btn-primary"
        >
          {initialRule ? 'Update Automation' : 'Create Automation'}
        </button>
        <button onClick={onCancel} className="btn">Cancel</button>
      </div>
    </div>
  )
}

// Rule card display
function RuleCard({ rule, tents, onToggle, onEdit, onDelete }) {
  const sensor = SENSOR_META[rule.trigger_sensor]
  const actuator = ACTUATOR_META[rule.action_actuator]

  const getTriggerText = () => {
    if (rule.trigger_type === 'schedule') {
      return `${rule.trigger_schedule_on} → ${rule.trigger_schedule_off}`
    }
    const op = rule.trigger_type === 'sensor_above' ? '>' : '<'
    return `${sensor?.label || rule.trigger_sensor} ${op} ${rule.trigger_value}${sensor?.unit || ''}`
  }

  return (
    <div className={`flex items-center gap-4 p-3 rounded-lg bg-[#1a1a2e] ${!rule.enabled ? 'opacity-60' : ''}`}>
      <div className="text-2xl">{sensor?.icon || actuator?.icon || '⚡'}</div>

      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{rule.name}</div>
        <div className="text-sm text-gray-400 truncate">
          <span className="text-blue-400">IF</span> {getTriggerText()}{' '}
          <span className="text-green-400">THEN</span> {rule.action_type.replace('_', ' ')} {actuator?.label || rule.action_actuator}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={() => onToggle(rule.id, !rule.enabled)}
          className={`px-3 py-1 rounded text-xs font-medium ${
            rule.enabled ? 'bg-green-600' : 'bg-gray-600'
          }`}
        >
          {rule.enabled ? 'ON' : 'OFF'}
        </button>
        <button onClick={() => onEdit(rule)} className="p-2 hover:bg-[#2d3a5c] rounded">
          ✏️
        </button>
        <button onClick={() => onDelete(rule.id)} className="p-2 hover:bg-red-500/20 rounded text-red-400">
          🗑️
        </button>
      </div>
    </div>
  )
}

// HA Automation card
function HAAutomationCard({ automation, onTrigger, onToggle }) {
  const entityId = automation.entity_id || ''
  const name = automation.attributes?.friendly_name || entityId.replace('automation.', '')
  const state = automation.state  // 'on' or 'off'
  const lastTriggered = automation.attributes?.last_triggered

  return (
    <div className={`flex items-center gap-4 p-3 rounded-lg bg-[#1a1a2e] ${state === 'off' ? 'opacity-60' : ''}`}>
      <div className="text-2xl">🏠</div>
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{name}</div>
        <div className="text-sm text-gray-400 truncate">
          {entityId}
          {lastTriggered && (
            <span className="ml-2">• Last: {new Date(lastTriggered).toLocaleString()}</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={() => onTrigger(entityId)}
          className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-700 text-xs font-medium"
          title="Manually trigger this automation"
        >
          Run
        </button>
        <button
          onClick={() => onToggle(entityId)}
          className={`px-3 py-1 rounded text-xs font-medium ${
            state === 'on' ? 'bg-green-600' : 'bg-gray-600'
          }`}
        >
          {state === 'on' ? 'ON' : 'OFF'}
        </button>
      </div>
    </div>
  )
}

// Main Automations page
export default function Automations() {
  const [rules, setRules] = useState([])
  const [haAutomations, setHaAutomations] = useState([])
  const [tents, setTents] = useState([])
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showBuilder, setShowBuilder] = useState(false)
  const [editingRule, setEditingRule] = useState(null)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [collapsedGroups, setCollapsedGroups] = useState({})
  const [activeTab, setActiveTab] = useState('tentos')  // 'tentos' or 'ha'
  const [selectedTentFilter, setSelectedTentFilter] = useState('')

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      // Load core data first
      const [rulesRes, tentsRes, configRes] = await Promise.all([
        apiFetch('api/automations').then(r => r.json()).catch(() => ({ rules: [] })),
        apiFetch('api/tents').then(r => r.json()).catch(() => ({ tents: [] })),
        apiFetch('api/config').then(r => r.json()).catch(() => ({}))
      ])
      setRules(rulesRes.rules || [])
      setTents(tentsRes.tents || [])
      setConfig(configRes)

      // Load HA automations separately so failures don't break the page
      try {
        const haRes = await apiFetch('api/automations/ha?show_all=true')
        if (haRes.ok) {
          const haData = await haRes.json()
          setHaAutomations(haData.automations || [])
        } else {
          console.warn('HA automations endpoint returned', haRes.status)
          setHaAutomations([])
        }
      } catch (haErr) {
        console.warn('Failed to load HA automations:', haErr)
        setHaAutomations([])
      }
    } catch (e) {
      console.error('Failed to load automations data:', e)
      setError('Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  const handleTriggerHA = async (entityId) => {
    try {
      await apiFetch(`api/automations/ha/${encodeURIComponent(entityId)}/trigger`, { method: 'POST' })
      setSuccess('Automation triggered!')
      setTimeout(() => setSuccess(null), 3000)
    } catch (e) {
      setError('Failed to trigger automation')
    }
  }

  const handleToggleHA = async (entityId) => {
    try {
      await apiFetch(`api/automations/ha/${encodeURIComponent(entityId)}/toggle`, { method: 'POST' })
      loadData()
    } catch (e) {
      setError('Failed to toggle automation')
    }
  }

  const handleSave = async (formData) => {
    try {
      const url = editingRule ? `api/automations/${editingRule.id}` : 'api/automations'
      const method = editingRule ? 'PUT' : 'POST'

      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      })

      if (!res.ok) throw new Error('Failed to save')

      setSuccess(editingRule ? 'Automation updated!' : 'Automation created!')
      setShowBuilder(false)
      setEditingRule(null)
      loadData()
      setTimeout(() => setSuccess(null), 3000)
    } catch (e) {
      setError(e.message)
    }
  }

  const handleToggle = async (ruleId, enabled) => {
    try {
      await apiFetch(`api/automations/${ruleId}/${enabled ? 'enable' : 'disable'}`, { method: 'POST' })
      loadData()
    } catch (e) {
      setError('Failed to toggle')
    }
  }

  const handleDelete = async (ruleId) => {
    if (!confirm('Delete this automation?')) return
    try {
      await apiFetch(`api/automations/${ruleId}`, { method: 'DELETE' })
      setSuccess('Automation deleted')
      loadData()
      setTimeout(() => setSuccess(null), 3000)
    } catch (e) {
      setError('Failed to delete')
    }
  }

  const handleEdit = (rule) => {
    setEditingRule(rule)
    setShowBuilder(true)
  }

  if (loading) {
    return <div className="text-center text-gray-400 py-12">Loading...</div>
  }

  // Filter HA automations by search/tent
  const filteredHaAutomations = useMemo(() => {
    // Ensure haAutomations is always an array
    const automations = Array.isArray(haAutomations) ? haAutomations : []
    if (!selectedTentFilter) return automations
    const tent = config?.tents?.find(t => t.id === selectedTentFilter)
    if (!tent) return automations
    return automations
  }, [haAutomations, selectedTentFilter, config])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Automations</h2>
          <p className="text-gray-400">Manage TentOS rules and Home Assistant automations</p>
        </div>
        {!showBuilder && activeTab === 'tentos' && (
          <button
            onClick={() => { setShowBuilder(true); setEditingRule(null) }}
            className="btn btn-primary"
            disabled={tents.length === 0}
          >
            + New Automation
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-[#2d3a5c] pb-2">
        <button
          onClick={() => setActiveTab('tentos')}
          className={`px-4 py-2 rounded-t-lg font-medium transition-colors ${
            activeTab === 'tentos'
              ? 'bg-green-600/20 text-green-400 border-b-2 border-green-500'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          🤖 TentOS Rules ({rules.length})
        </button>
        <button
          onClick={() => setActiveTab('ha')}
          className={`px-4 py-2 rounded-t-lg font-medium transition-colors ${
            activeTab === 'ha'
              ? 'bg-blue-600/20 text-blue-400 border-b-2 border-blue-500'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          🏠 Home Assistant ({haAutomations.length})
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-500/20 border border-red-500/50 rounded text-red-300 flex justify-between">
          {error}
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {success && (
        <div className="p-3 bg-green-500/20 border border-green-500/50 rounded text-green-300">
          {success}
        </div>
      )}

      {/* TentOS Rules Tab */}
      {activeTab === 'tentos' && (
        <>
          {tents.length === 0 && !showBuilder && (
            <div className="card text-center py-12">
              <div className="text-4xl mb-4">⚙️</div>
              <h3 className="text-xl font-semibold mb-2">No Tents Configured</h3>
              <p className="text-gray-400 mb-4">
                Set up your tents in Settings first, then create automations for them.
              </p>
              <a href="#/settings" className="btn btn-primary">
                Go to Settings
              </a>
            </div>
          )}

          {showBuilder ? (
            <AutomationBuilder
              tents={tents}
              config={config}
              initialRule={editingRule}
              onSave={handleSave}
              onCancel={() => { setShowBuilder(false); setEditingRule(null) }}
            />
          ) : rules.length === 0 && tents.length > 0 ? (
            <div className="card text-center py-12">
              <div className="text-4xl mb-4">🤖</div>
              <h3 className="text-xl font-semibold mb-2">No TentOS Rules Yet</h3>
              <p className="text-gray-400 mb-4">
                Create your first automation to automatically control your tent equipment
              </p>
              <button onClick={() => setShowBuilder(true)} className="btn btn-primary">
                Create Automation
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {tents.map(tent => {
                const tentRules = rules.filter(r => r.tent_id === tent.id)
                if (tentRules.length === 0) return null

                const isCollapsed = collapsedGroups[tent.id]
                const toggleCollapse = () => setCollapsedGroups(prev => ({
                  ...prev,
                  [tent.id]: !prev[tent.id]
                }))

                return (
                  <div key={tent.id} className="card p-0 overflow-hidden">
                    <button
                      onClick={toggleCollapse}
                      className="w-full flex items-center gap-3 p-4 hover:bg-[#1a1a2e] transition-colors text-left"
                    >
                      <span className="text-lg">{isCollapsed ? '▶' : '▼'}</span>
                      <div className="flex-1">
                        <h3 className="font-medium">{tent.name}</h3>
                        <span className="text-sm text-gray-400">
                          {tentRules.length} automation{tentRules.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${
                          tentRules.every(r => r.enabled) ? 'bg-green-500' :
                          tentRules.some(r => r.enabled) ? 'bg-yellow-500' : 'bg-gray-500'
                        }`} />
                        <span className="text-xs text-gray-400">
                          {tentRules.filter(r => r.enabled).length}/{tentRules.length} active
                        </span>
                      </div>
                    </button>
                    {!isCollapsed && (
                      <div className="border-t border-[#2d3a5c] p-4 space-y-2">
                        {tentRules.map(rule => (
                          <RuleCard
                            key={rule.id}
                            rule={rule}
                            tents={tents}
                            onToggle={handleToggle}
                            onEdit={handleEdit}
                            onDelete={handleDelete}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* Home Assistant Automations Tab */}
      {activeTab === 'ha' && (
        <>
          {haAutomations.length === 0 ? (
            <div className="card text-center py-12">
              <div className="text-4xl mb-4">🏠</div>
              <h3 className="text-xl font-semibold mb-2">No HA Automations Found</h3>
              <p className="text-gray-400 mb-4">
                Create automations in Home Assistant to see them here.
              </p>
              <a
                href="/config/automation/dashboard"
                target="_top"
                className="btn btn-primary"
              >
                Open HA Automations
              </a>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-400">
                  Showing {filteredHaAutomations.length} Home Assistant automations
                </p>
                <a
                  href="/config/automation/dashboard"
                  target="_top"
                  className="text-sm text-blue-400 hover:text-blue-300"
                >
                  Edit in HA →
                </a>
              </div>
              <div className="space-y-2">
                {filteredHaAutomations.map(automation => (
                  <HAAutomationCard
                    key={automation.entity_id}
                    automation={automation}
                    onTrigger={handleTriggerHA}
                    onToggle={handleToggleHA}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
