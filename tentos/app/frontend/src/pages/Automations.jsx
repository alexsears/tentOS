import { useState, useEffect } from 'react'

const TRIGGER_TYPES = {
  sensor_above: 'Sensor Above Threshold',
  sensor_below: 'Sensor Below Threshold',
  sensor_range: 'Sensor Out of Range',
  schedule: 'Time Schedule'
}

const ACTION_TYPES = {
  turn_on: 'Turn On',
  turn_off: 'Turn Off',
  set_speed: 'Set Speed'
}

const SENSOR_OPTIONS = [
  { value: 'temperature', label: 'Temperature' },
  { value: 'humidity', label: 'Humidity' },
  { value: 'vpd', label: 'VPD' },
  { value: 'co2', label: 'CO2' }
]

const ACTUATOR_OPTIONS = [
  { value: 'light', label: 'Light' },
  { value: 'exhaust_fan', label: 'Exhaust Fan' },
  { value: 'circulation_fan', label: 'Circulation Fan' },
  { value: 'humidifier', label: 'Humidifier' },
  { value: 'dehumidifier', label: 'Dehumidifier' },
  { value: 'heater', label: 'Heater' },
  { value: 'water_pump', label: 'Water Pump' }
]

function RuleCard({ rule, onToggle, onDelete }) {
  const getTriggerDescription = () => {
    if (rule.trigger_type === 'schedule') {
      return `${rule.trigger_schedule_on} - ${rule.trigger_schedule_off}`
    }
    const sensor = SENSOR_OPTIONS.find(s => s.value === rule.trigger_sensor)?.label || rule.trigger_sensor
    if (rule.trigger_type === 'sensor_above') {
      return `${sensor} > ${rule.trigger_value}`
    }
    if (rule.trigger_type === 'sensor_below') {
      return `${sensor} < ${rule.trigger_value}`
    }
    if (rule.trigger_type === 'sensor_range') {
      return `${sensor} outside ${rule.trigger_value} - ${rule.trigger_value_max}`
    }
    return rule.trigger_type
  }

  const getActionDescription = () => {
    const actuator = ACTUATOR_OPTIONS.find(a => a.value === rule.action_actuator)?.label || rule.action_actuator
    if (rule.action_type === 'set_speed') {
      return `Set ${actuator} to ${rule.action_value}%`
    }
    return `${ACTION_TYPES[rule.action_type]} ${actuator}`
  }

  return (
    <div className={`card ${!rule.enabled ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between mb-2">
        <div>
          <h4 className="font-semibold">{rule.name}</h4>
          <p className="text-xs text-gray-500">ID: {rule.id}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onToggle(rule.id, !rule.enabled)}
            className={`px-3 py-1 rounded text-xs ${
              rule.enabled ? 'bg-green-600 text-white' : 'bg-gray-600 text-gray-300'
            }`}
          >
            {rule.enabled ? 'Enabled' : 'Disabled'}
          </button>
          <button
            onClick={() => onDelete(rule.id)}
            className="p-1 hover:bg-red-500/20 rounded text-red-400"
            title="Delete rule"
          >
            🗑️
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <span className="text-gray-500">When:</span>
          <div className="font-medium">{getTriggerDescription()}</div>
        </div>
        <div>
          <span className="text-gray-500">Then:</span>
          <div className="font-medium">{getActionDescription()}</div>
        </div>
      </div>

      <div className="mt-2 text-xs text-gray-500">
        Hysteresis: {rule.hysteresis} | Cooldown: {rule.cooldown}s
      </div>
    </div>
  )
}

function RuleForm({ tents, onSave, onCancel, initialRule = null }) {
  const [form, setForm] = useState(initialRule || {
    name: '',
    tent_id: tents[0]?.id || '',
    enabled: true,
    trigger_type: 'sensor_above',
    trigger_sensor: 'temperature',
    trigger_value: 28,
    trigger_value_max: null,
    trigger_schedule_on: '06:00',
    trigger_schedule_off: '22:00',
    action_type: 'turn_on',
    action_actuator: 'exhaust_fan',
    action_value: 100,
    hysteresis: 0.5,
    min_on_duration: 60,
    min_off_duration: 60,
    cooldown: 30
  })

  const handleSubmit = (e) => {
    e.preventDefault()
    onSave(form)
  }

  const isSchedule = form.trigger_type === 'schedule'
  const isRange = form.trigger_type === 'sensor_range'
  const isSetSpeed = form.action_type === 'set_speed'

  return (
    <form onSubmit={handleSubmit} className="card space-y-4">
      <h3 className="font-semibold text-lg">
        {initialRule ? 'Edit Rule' : 'Create Automation Rule'}
      </h3>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm text-gray-400">Rule Name</label>
          <input
            type="text"
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            className="input w-full"
            required
          />
        </div>
        <div>
          <label className="text-sm text-gray-400">Tent</label>
          <select
            value={form.tent_id}
            onChange={e => setForm({ ...form, tent_id: e.target.value })}
            className="input w-full"
            required
          >
            {tents.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="border-t border-[#2d3a5c] pt-4">
        <h4 className="text-sm font-medium text-gray-400 mb-2">Trigger (When)</h4>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-gray-400">Trigger Type</label>
            <select
              value={form.trigger_type}
              onChange={e => setForm({ ...form, trigger_type: e.target.value })}
              className="input w-full"
            >
              {Object.entries(TRIGGER_TYPES).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
          </div>

          {!isSchedule && (
            <div>
              <label className="text-sm text-gray-400">Sensor</label>
              <select
                value={form.trigger_sensor}
                onChange={e => setForm({ ...form, trigger_sensor: e.target.value })}
                className="input w-full"
              >
                {SENSOR_OPTIONS.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
          )}

          {!isSchedule && (
            <div>
              <label className="text-sm text-gray-400">
                {isRange ? 'Min Value' : 'Threshold'}
              </label>
              <input
                type="number"
                step="0.1"
                value={form.trigger_value || ''}
                onChange={e => setForm({ ...form, trigger_value: parseFloat(e.target.value) })}
                className="input w-full"
              />
            </div>
          )}

          {isRange && (
            <div>
              <label className="text-sm text-gray-400">Max Value</label>
              <input
                type="number"
                step="0.1"
                value={form.trigger_value_max || ''}
                onChange={e => setForm({ ...form, trigger_value_max: parseFloat(e.target.value) })}
                className="input w-full"
              />
            </div>
          )}

          {isSchedule && (
            <>
              <div>
                <label className="text-sm text-gray-400">Turn On Time</label>
                <input
                  type="time"
                  value={form.trigger_schedule_on || ''}
                  onChange={e => setForm({ ...form, trigger_schedule_on: e.target.value })}
                  className="input w-full"
                />
              </div>
              <div>
                <label className="text-sm text-gray-400">Turn Off Time</label>
                <input
                  type="time"
                  value={form.trigger_schedule_off || ''}
                  onChange={e => setForm({ ...form, trigger_schedule_off: e.target.value })}
                  className="input w-full"
                />
              </div>
            </>
          )}
        </div>
      </div>

      <div className="border-t border-[#2d3a5c] pt-4">
        <h4 className="text-sm font-medium text-gray-400 mb-2">Action (Then)</h4>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-gray-400">Action</label>
            <select
              value={form.action_type}
              onChange={e => setForm({ ...form, action_type: e.target.value })}
              className="input w-full"
            >
              {Object.entries(ACTION_TYPES).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm text-gray-400">Actuator</label>
            <select
              value={form.action_actuator}
              onChange={e => setForm({ ...form, action_actuator: e.target.value })}
              className="input w-full"
            >
              {ACTUATOR_OPTIONS.map(a => (
                <option key={a.value} value={a.value}>{a.label}</option>
              ))}
            </select>
          </div>
          {isSetSpeed && (
            <div>
              <label className="text-sm text-gray-400">Speed (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                value={form.action_value || ''}
                onChange={e => setForm({ ...form, action_value: parseInt(e.target.value) })}
                className="input w-full"
              />
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-[#2d3a5c] pt-4">
        <h4 className="text-sm font-medium text-gray-400 mb-2">Safety Settings</h4>
        <div className="grid grid-cols-4 gap-4">
          <div>
            <label className="text-sm text-gray-400">Hysteresis</label>
            <input
              type="number"
              step="0.1"
              value={form.hysteresis}
              onChange={e => setForm({ ...form, hysteresis: parseFloat(e.target.value) })}
              className="input w-full"
            />
          </div>
          <div>
            <label className="text-sm text-gray-400">Min On (s)</label>
            <input
              type="number"
              value={form.min_on_duration}
              onChange={e => setForm({ ...form, min_on_duration: parseInt(e.target.value) })}
              className="input w-full"
            />
          </div>
          <div>
            <label className="text-sm text-gray-400">Min Off (s)</label>
            <input
              type="number"
              value={form.min_off_duration}
              onChange={e => setForm({ ...form, min_off_duration: parseInt(e.target.value) })}
              className="input w-full"
            />
          </div>
          <div>
            <label className="text-sm text-gray-400">Cooldown (s)</label>
            <input
              type="number"
              value={form.cooldown}
              onChange={e => setForm({ ...form, cooldown: parseInt(e.target.value) })}
              className="input w-full"
            />
          </div>
        </div>
      </div>

      <div className="flex gap-2 pt-4">
        <button type="submit" className="btn btn-primary">
          {initialRule ? 'Update Rule' : 'Create Rule'}
        </button>
        <button type="button" onClick={onCancel} className="btn">
          Cancel
        </button>
      </div>
    </form>
  )
}

export default function Automations() {
  const [rules, setRules] = useState([])
  const [tents, setTents] = useState([])
  const [templates, setTemplates] = useState({})
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingRule, setEditingRule] = useState(null)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const [rulesRes, tentsRes, templatesRes] = await Promise.all([
        fetch('/api/automations').then(r => r.json()),
        fetch('/api/tents').then(r => r.json()),
        fetch('/api/automations/templates/list').then(r => r.json())
      ])
      setRules(rulesRes.rules || [])
      setTents(tentsRes.tents || [])
      setTemplates(templatesRes.templates || {})
    } catch (e) {
      setError('Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async (formData) => {
    try {
      const url = editingRule
        ? `/api/automations/${editingRule.id}`
        : '/api/automations'
      const method = editingRule ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      })

      if (!res.ok) throw new Error('Failed to save rule')

      setSuccess(editingRule ? 'Rule updated!' : 'Rule created!')
      setShowForm(false)
      setEditingRule(null)
      loadData()
      setTimeout(() => setSuccess(null), 3000)
    } catch (e) {
      setError(e.message)
    }
  }

  const handleToggle = async (ruleId, enabled) => {
    try {
      const endpoint = enabled ? 'enable' : 'disable'
      await fetch(`/api/automations/${ruleId}/${endpoint}`, { method: 'POST' })
      loadData()
    } catch (e) {
      setError('Failed to toggle rule')
    }
  }

  const handleDelete = async (ruleId) => {
    if (!confirm('Delete this automation rule?')) return
    try {
      await fetch(`/api/automations/${ruleId}`, { method: 'DELETE' })
      setSuccess('Rule deleted')
      loadData()
      setTimeout(() => setSuccess(null), 3000)
    } catch (e) {
      setError('Failed to delete rule')
    }
  }

  const applyTemplate = async (templateId, tentId) => {
    try {
      const res = await fetch(`/api/automations/templates/${templateId}/apply?tent_id=${tentId}`, {
        method: 'POST'
      })
      if (!res.ok) throw new Error('Failed to apply template')
      setSuccess('Template applied!')
      loadData()
      setTimeout(() => setSuccess(null), 3000)
    } catch (e) {
      setError(e.message)
    }
  }

  if (loading) {
    return <div className="text-center text-gray-400 py-12">Loading...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Automations</h2>
          <p className="text-gray-400">Create rules to automatically control your tent equipment</p>
        </div>
        <button
          onClick={() => { setShowForm(true); setEditingRule(null) }}
          className="btn btn-primary"
        >
          + Create Rule
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-500/20 border border-red-500/50 rounded text-red-300">
          {error}
          <button onClick={() => setError(null)} className="ml-2">✕</button>
        </div>
      )}

      {success && (
        <div className="p-3 bg-green-500/20 border border-green-500/50 rounded text-green-300">
          {success}
        </div>
      )}

      {showForm && (
        <RuleForm
          tents={tents}
          initialRule={editingRule}
          onSave={handleSave}
          onCancel={() => { setShowForm(false); setEditingRule(null) }}
        />
      )}

      {/* Quick Templates */}
      {!showForm && tents.length > 0 && (
        <div className="card">
          <h3 className="font-semibold mb-3">Quick Start Templates</h3>
          <div className="flex flex-wrap gap-2">
            {Object.entries(templates).map(([id, template]) => (
              <div key={id} className="flex items-center gap-1">
                <button
                  onClick={() => applyTemplate(id, tents[0].id)}
                  className="btn btn-sm"
                  title={`Apply to ${tents[0].name}`}
                >
                  {template.name}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Rules List */}
      {rules.length === 0 ? (
        <div className="card text-center py-8">
          <p className="text-gray-400 mb-4">No automation rules configured</p>
          <button onClick={() => setShowForm(true)} className="btn btn-primary">
            Create Your First Rule
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {tents.map(tent => {
            const tentRules = rules.filter(r => r.tent_id === tent.id)
            if (tentRules.length === 0) return null

            return (
              <div key={tent.id}>
                <h3 className="font-semibold mb-2">{tent.name}</h3>
                <div className="space-y-2">
                  {tentRules.map(rule => (
                    <RuleCard
                      key={rule.id}
                      rule={rule}
                      onToggle={handleToggle}
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
