import { useState, useEffect } from 'react'
import { DndContext, DragOverlay, useDraggable, useDroppable, pointerWithin } from '@dnd-kit/core'

// Scenario templates
const SCENARIOS = {
  high_temp: {
    name: 'High Temperature Control',
    description: 'Turn on exhaust fan when temperature exceeds threshold',
    icon: '🌡️',
    color: '#ef4444',
    defaults: {
      trigger_type: 'sensor_above',
      trigger_sensor: 'temperature',
      trigger_value: 28,
      action_type: 'turn_on',
      action_actuator: 'exhaust_fan',
      hysteresis: 1.0
    }
  },
  low_humidity: {
    name: 'Low Humidity Control',
    description: 'Turn on humidifier when humidity drops below threshold',
    icon: '💧',
    color: '#3b82f6',
    defaults: {
      trigger_type: 'sensor_below',
      trigger_sensor: 'humidity',
      trigger_value: 50,
      action_type: 'turn_on',
      action_actuator: 'humidifier',
      hysteresis: 5
    }
  },
  high_humidity: {
    name: 'High Humidity Control',
    description: 'Turn on dehumidifier when humidity exceeds threshold',
    icon: '🏜️',
    color: '#f59e0b',
    defaults: {
      trigger_type: 'sensor_above',
      trigger_sensor: 'humidity',
      trigger_value: 70,
      action_type: 'turn_on',
      action_actuator: 'dehumidifier',
      hysteresis: 5
    }
  },
  vpd_control: {
    name: 'VPD Optimization',
    description: 'Maintain optimal VPD by controlling humidifier',
    icon: '🎯',
    color: '#22c55e',
    defaults: {
      trigger_type: 'sensor_above',
      trigger_sensor: 'vpd',
      trigger_value: 1.4,
      action_type: 'turn_on',
      action_actuator: 'humidifier',
      hysteresis: 0.2
    }
  },
  light_schedule: {
    name: 'Light Schedule',
    description: 'Automated photoperiod control',
    icon: '💡',
    color: '#eab308',
    defaults: {
      trigger_type: 'schedule',
      trigger_schedule_on: '06:00',
      trigger_schedule_off: '00:00',
      action_type: 'turn_on',
      action_actuator: 'light'
    }
  },
  night_temp: {
    name: 'Night Temperature',
    description: 'Turn on heater when temperature drops at night',
    icon: '🔥',
    color: '#dc2626',
    defaults: {
      trigger_type: 'sensor_below',
      trigger_sensor: 'temperature',
      trigger_value: 18,
      action_type: 'turn_on',
      action_actuator: 'heater',
      hysteresis: 1.0
    }
  },
  circulation: {
    name: 'Air Circulation',
    description: 'Keep air moving with circulation fan',
    icon: '🔄',
    color: '#06b6d4',
    defaults: {
      trigger_type: 'schedule',
      trigger_schedule_on: '00:00',
      trigger_schedule_off: '23:59',
      action_type: 'turn_on',
      action_actuator: 'circulation_fan'
    }
  }
}

const SENSOR_OPTIONS = [
  { id: 'temperature', label: 'Temperature', icon: '🌡️', unit: '°C' },
  { id: 'humidity', label: 'Humidity', icon: '💧', unit: '%' },
  { id: 'vpd', label: 'VPD', icon: '🎯', unit: 'kPa' },
  { id: 'co2', label: 'CO2', icon: '💨', unit: 'ppm' }
]

const ACTUATOR_OPTIONS = [
  { id: 'light', label: 'Light', icon: '💡' },
  { id: 'exhaust_fan', label: 'Exhaust Fan', icon: '🌀' },
  { id: 'circulation_fan', label: 'Circulation Fan', icon: '🔄' },
  { id: 'humidifier', label: 'Humidifier', icon: '💨' },
  { id: 'dehumidifier', label: 'Dehumidifier', icon: '🏜️' },
  { id: 'heater', label: 'Heater', icon: '🔥' },
  { id: 'water_pump', label: 'Water Pump', icon: '🚿' }
]

// Draggable entity item
function DraggableEntity({ entity, type }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `${type}.${entity.id}`,
    data: { entity, type }
  })

  const style = transform ? {
    transform: `translate(${transform.x}px, ${transform.y}px)`,
  } : undefined

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`flex items-center gap-2 p-2 bg-[#1a1a2e] rounded cursor-grab
        hover:bg-[#2d3a5c] transition-colors
        ${isDragging ? 'opacity-50 ring-2 ring-green-500' : ''}`}
    >
      <span className="text-lg">{entity.icon}</span>
      <span className="text-sm">{entity.label}</span>
    </div>
  )
}

// Droppable slot
function DropSlot({ id, label, value, onClear, accepts }) {
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: { accepts }
  })

  const entity = accepts === 'sensor'
    ? SENSOR_OPTIONS.find(s => s.id === value)
    : ACTUATOR_OPTIONS.find(a => a.id === value)

  return (
    <div
      ref={setNodeRef}
      className={`p-4 rounded-lg border-2 border-dashed min-h-[80px] flex items-center justify-center
        ${isOver ? 'border-green-500 bg-green-500/10' : 'border-[#2d3a5c]'}
        ${value ? 'bg-[#1a1a2e] border-solid' : ''}`}
    >
      {value && entity ? (
        <div className="flex items-center gap-3 w-full">
          <span className="text-2xl">{entity.icon}</span>
          <div className="flex-1">
            <div className="font-medium">{entity.label}</div>
            <div className="text-xs text-gray-500">{label}</div>
          </div>
          <button
            onClick={onClear}
            className="p-1 hover:bg-red-500/20 rounded text-red-400"
          >
            ✕
          </button>
        </div>
      ) : (
        <div className="text-gray-500 text-sm text-center">
          <div className="mb-1">Drop {accepts} here</div>
          <div className="text-xs">{label}</div>
        </div>
      )}
    </div>
  )
}

// Visual automation builder
function AutomationBuilder({ tents, onSave, onCancel, initialRule = null }) {
  const [form, setForm] = useState(initialRule || {
    name: '',
    tent_id: tents[0]?.id || '',
    enabled: true,
    trigger_type: 'sensor_above',
    trigger_sensor: '',
    trigger_value: '',
    trigger_value_max: '',
    trigger_schedule_on: '06:00',
    trigger_schedule_off: '22:00',
    action_type: 'turn_on',
    action_actuator: '',
    action_value: 100,
    hysteresis: 0.5,
    min_on_duration: 60,
    min_off_duration: 60,
    cooldown: 30
  })

  const [activeScenario, setActiveScenario] = useState(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [draggedItem, setDraggedItem] = useState(null)

  // Apply scenario template
  const applyScenario = (scenarioId) => {
    const scenario = SCENARIOS[scenarioId]
    if (scenario) {
      setForm(prev => ({
        ...prev,
        name: scenario.name,
        ...scenario.defaults
      }))
      setActiveScenario(scenarioId)
    }
  }

  // Handle drag end
  const handleDragEnd = (event) => {
    const { active, over } = event
    setDraggedItem(null)

    if (!over || !active.data.current) return

    const { entity, type } = active.data.current
    const slotAccepts = over.data.current?.accepts

    if (type === slotAccepts) {
      if (type === 'sensor') {
        setForm(prev => ({ ...prev, trigger_sensor: entity.id }))
      } else if (type === 'actuator') {
        setForm(prev => ({ ...prev, action_actuator: entity.id }))
      }
    }
  }

  const handleDragStart = (event) => {
    const { entity, type } = event.active.data.current || {}
    setDraggedItem({ entity, type })
  }

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

  return (
    <DndContext
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="card space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-semibold">
            {initialRule ? 'Edit Automation' : 'Create Automation'}
          </h3>
          <button onClick={onCancel} className="text-gray-400 hover:text-white">✕</button>
        </div>

        {/* Scenario Templates */}
        {!initialRule && (
          <div>
            <label className="text-sm text-gray-400 block mb-2">Quick Start Scenarios</label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {Object.entries(SCENARIOS).map(([id, scenario]) => (
                <button
                  key={id}
                  onClick={() => applyScenario(id)}
                  className={`p-3 rounded-lg text-left transition-all ${
                    activeScenario === id
                      ? 'ring-2 ring-green-500'
                      : 'hover:bg-[#2d3a5c]'
                  }`}
                  style={{
                    backgroundColor: activeScenario === id
                      ? `${scenario.color}20`
                      : '#1a1a2e'
                  }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span>{scenario.icon}</span>
                    <span className="font-medium text-sm">{scenario.name}</span>
                  </div>
                  <p className="text-xs text-gray-500">{scenario.description}</p>
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
              placeholder="e.g., High Temp Exhaust Control"
              required
            />
          </div>
          <div>
            <label className="text-sm text-gray-400 block mb-1">Tent *</label>
            <select
              value={form.tent_id}
              onChange={e => setForm({ ...form, tent_id: e.target.value })}
              className="input w-full"
            >
              {tents.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Visual Builder */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Entity Inventory */}
          <div className="space-y-4">
            <div>
              <h4 className="text-sm font-medium text-gray-400 mb-2">Sensors</h4>
              <div className="space-y-1">
                {SENSOR_OPTIONS.map(sensor => (
                  <DraggableEntity key={sensor.id} entity={sensor} type="sensor" />
                ))}
              </div>
            </div>
            <div>
              <h4 className="text-sm font-medium text-gray-400 mb-2">Actuators</h4>
              <div className="space-y-1">
                {ACTUATOR_OPTIONS.map(actuator => (
                  <DraggableEntity key={actuator.id} entity={actuator} type="actuator" />
                ))}
              </div>
            </div>
          </div>

          {/* Automation Flow */}
          <div className="lg:col-span-2 space-y-4">
            {/* IF (Trigger) */}
            <div className="p-4 bg-[#0d1117] rounded-lg">
              <div className="flex items-center gap-2 mb-3">
                <span className="bg-blue-600 text-white text-xs font-bold px-2 py-1 rounded">IF</span>
                <span className="text-sm text-gray-400">When this condition is met</span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-gray-400 block mb-1">Trigger Type</label>
                  <select
                    value={form.trigger_type}
                    onChange={e => setForm({ ...form, trigger_type: e.target.value })}
                    className="input w-full"
                  >
                    <option value="sensor_above">Sensor Above</option>
                    <option value="sensor_below">Sensor Below</option>
                    <option value="sensor_range">Sensor Out of Range</option>
                    <option value="schedule">Time Schedule</option>
                  </select>
                </div>

                {!isSchedule ? (
                  <>
                    <DropSlot
                      id="trigger-sensor"
                      label="Trigger Sensor"
                      value={form.trigger_sensor}
                      accepts="sensor"
                      onClear={() => setForm({ ...form, trigger_sensor: '' })}
                    />
                    <div>
                      <label className="text-sm text-gray-400 block mb-1">
                        {form.trigger_type === 'sensor_range' ? 'Min Value' : 'Threshold'}
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        value={form.trigger_value}
                        onChange={e => setForm({ ...form, trigger_value: parseFloat(e.target.value) || '' })}
                        className="input w-full"
                        placeholder="28"
                      />
                    </div>
                    {form.trigger_type === 'sensor_range' && (
                      <div>
                        <label className="text-sm text-gray-400 block mb-1">Max Value</label>
                        <input
                          type="number"
                          step="0.1"
                          value={form.trigger_value_max}
                          onChange={e => setForm({ ...form, trigger_value_max: parseFloat(e.target.value) || '' })}
                          className="input w-full"
                        />
                      </div>
                    )}
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

            {/* Arrow */}
            <div className="flex justify-center">
              <span className="text-2xl text-gray-500">⬇️</span>
            </div>

            {/* THEN (Action) */}
            <div className="p-4 bg-[#0d1117] rounded-lg">
              <div className="flex items-center gap-2 mb-3">
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
                    <option value="set_speed">Set Speed</option>
                  </select>
                </div>

                <DropSlot
                  id="action-actuator"
                  label="Target Actuator"
                  value={form.action_actuator}
                  accepts="actuator"
                  onClear={() => setForm({ ...form, action_actuator: '' })}
                />

                {form.action_type === 'set_speed' && (
                  <div>
                    <label className="text-sm text-gray-400 block mb-1">Speed %</label>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={form.action_value}
                      onChange={e => setForm({ ...form, action_value: parseInt(e.target.value) })}
                      className="w-full"
                    />
                    <div className="text-center text-sm">{form.action_value}%</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Advanced Settings */}
        <div>
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-sm text-gray-400 hover:text-white"
          >
            {showAdvanced ? '▼' : '▶'} Advanced Settings
          </button>

          {showAdvanced && (
            <div className="grid grid-cols-4 gap-4 mt-3 p-4 bg-[#0d1117] rounded-lg">
              <div>
                <label className="text-sm text-gray-400 block mb-1">Hysteresis</label>
                <input
                  type="number"
                  step="0.1"
                  value={form.hysteresis}
                  onChange={e => setForm({ ...form, hysteresis: parseFloat(e.target.value) })}
                  className="input w-full"
                />
                <p className="text-xs text-gray-500 mt-1">Prevents rapid toggling</p>
              </div>
              <div>
                <label className="text-sm text-gray-400 block mb-1">Min On (sec)</label>
                <input
                  type="number"
                  value={form.min_on_duration}
                  onChange={e => setForm({ ...form, min_on_duration: parseInt(e.target.value) })}
                  className="input w-full"
                />
              </div>
              <div>
                <label className="text-sm text-gray-400 block mb-1">Min Off (sec)</label>
                <input
                  type="number"
                  value={form.min_off_duration}
                  onChange={e => setForm({ ...form, min_off_duration: parseInt(e.target.value) })}
                  className="input w-full"
                />
              </div>
              <div>
                <label className="text-sm text-gray-400 block mb-1">Cooldown (sec)</label>
                <input
                  type="number"
                  value={form.cooldown}
                  onChange={e => setForm({ ...form, cooldown: parseInt(e.target.value) })}
                  className="input w-full"
                />
              </div>
            </div>
          )}
        </div>

        {/* Submit */}
        <div className="flex gap-2 pt-4 border-t border-[#2d3a5c]">
          <button onClick={handleSubmit} className="btn btn-primary">
            {initialRule ? 'Update Automation' : 'Create Automation'}
          </button>
          <button onClick={onCancel} className="btn">Cancel</button>
        </div>
      </div>

      {/* Drag Overlay */}
      <DragOverlay>
        {draggedItem?.entity && (
          <div className="flex items-center gap-2 p-2 bg-[#1a1a2e] rounded shadow-lg ring-2 ring-green-500">
            <span className="text-lg">{draggedItem.entity.icon}</span>
            <span className="text-sm">{draggedItem.entity.label}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}

// Rule card display
function RuleCard({ rule, onToggle, onEdit, onDelete }) {
  const sensor = SENSOR_OPTIONS.find(s => s.id === rule.trigger_sensor)
  const actuator = ACTUATOR_OPTIONS.find(a => a.id === rule.action_actuator)

  const getTriggerText = () => {
    if (rule.trigger_type === 'schedule') {
      return `${rule.trigger_schedule_on} - ${rule.trigger_schedule_off}`
    }
    const op = rule.trigger_type === 'sensor_above' ? '>' : rule.trigger_type === 'sensor_below' ? '<' : 'outside'
    return `${sensor?.label || rule.trigger_sensor} ${op} ${rule.trigger_value}${sensor?.unit || ''}`
  }

  return (
    <div className={`card flex items-center gap-4 ${!rule.enabled ? 'opacity-60' : ''}`}>
      <div className="text-3xl">{sensor?.icon || actuator?.icon || '⚡'}</div>

      <div className="flex-1">
        <div className="font-semibold">{rule.name}</div>
        <div className="text-sm text-gray-400">
          <span className="text-blue-400">IF</span> {getTriggerText()}{' '}
          <span className="text-green-400">THEN</span> {rule.action_type.replace('_', ' ')} {actuator?.label || rule.action_actuator}
        </div>
      </div>

      <div className="flex items-center gap-2">
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

// Main Automations page
export default function Automations() {
  const [rules, setRules] = useState([])
  const [tents, setTents] = useState([])
  const [loading, setLoading] = useState(true)
  const [showBuilder, setShowBuilder] = useState(false)
  const [editingRule, setEditingRule] = useState(null)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const [rulesRes, tentsRes] = await Promise.all([
        fetch('/api/automations').then(r => r.json()),
        fetch('/api/tents').then(r => r.json())
      ])
      setRules(rulesRes.rules || [])
      setTents(tentsRes.tents || [])
    } catch (e) {
      setError('Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async (formData) => {
    try {
      const url = editingRule ? `/api/automations/${editingRule.id}` : '/api/automations'
      const method = editingRule ? 'PUT' : 'POST'

      const res = await fetch(url, {
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
      await fetch(`/api/automations/${ruleId}/${enabled ? 'enable' : 'disable'}`, { method: 'POST' })
      loadData()
    } catch (e) {
      setError('Failed to toggle')
    }
  }

  const handleDelete = async (ruleId) => {
    if (!confirm('Delete this automation?')) return
    try {
      await fetch(`/api/automations/${ruleId}`, { method: 'DELETE' })
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Automations</h2>
          <p className="text-gray-400">Create rules to automatically control your equipment</p>
        </div>
        {!showBuilder && (
          <button
            onClick={() => { setShowBuilder(true); setEditingRule(null) }}
            className="btn btn-primary"
          >
            + New Automation
          </button>
        )}
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

      {showBuilder ? (
        <AutomationBuilder
          tents={tents}
          initialRule={editingRule}
          onSave={handleSave}
          onCancel={() => { setShowBuilder(false); setEditingRule(null) }}
        />
      ) : rules.length === 0 ? (
        <div className="card text-center py-12">
          <div className="text-4xl mb-4">🤖</div>
          <h3 className="text-xl font-semibold mb-2">No Automations Yet</h3>
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

            return (
              <div key={tent.id}>
                <h3 className="text-sm font-medium text-gray-400 mb-2">{tent.name}</h3>
                <div className="space-y-2">
                  {tentRules.map(rule => (
                    <RuleCard
                      key={rule.id}
                      rule={rule}
                      onToggle={handleToggle}
                      onEdit={handleEdit}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
