import { useState, useEffect } from 'react'
import { apiFetch } from '../utils/api'

// Templates for common grow tent automations
const TEMPLATES = [
  {
    id: 'light_schedule',
    name: 'Light Schedule',
    icon: '💡',
    description: 'Turn lights on/off at specific times',
    config: {
      triggers: [{ type: 'time', at: '06:00:00' }],
      actions: [{ type: 'turn_on', target: 'light' }]
    }
  },
  {
    id: 'high_temp_exhaust',
    name: 'High Temp - Exhaust',
    icon: '🌡️',
    description: 'Turn on exhaust when temp exceeds threshold',
    config: {
      triggers: [{ type: 'numeric_state', target: 'temperature', above: 28 }],
      actions: [{ type: 'turn_on', target: 'exhaust_fan' }]
    }
  },
  {
    id: 'low_humidity_humidifier',
    name: 'Low Humidity - Humidifier',
    icon: '💧',
    description: 'Turn on humidifier when humidity drops',
    config: {
      triggers: [{ type: 'numeric_state', target: 'humidity', below: 50 }],
      actions: [{ type: 'turn_on', target: 'humidifier' }]
    }
  },
  {
    id: 'high_humidity_dehumidifier',
    name: 'High Humidity - Dehumidifier',
    icon: '🏜️',
    description: 'Turn on dehumidifier when humidity rises',
    config: {
      triggers: [{ type: 'numeric_state', target: 'humidity', above: 70 }],
      actions: [{ type: 'turn_on', target: 'dehumidifier' }]
    }
  },
  {
    id: 'vpd_control',
    name: 'VPD Control',
    icon: '🫧',
    description: 'Maintain optimal VPD range',
    config: {
      triggers: [{ type: 'numeric_state', target: 'vpd', above: 1.4 }],
      actions: [{ type: 'turn_on', target: 'humidifier' }]
    }
  },
  {
    id: 'night_mode',
    name: 'Night Mode',
    icon: '🌙',
    description: 'Reduce fan speed during quiet hours',
    config: {
      triggers: [{ type: 'time', at: '22:00:00' }],
      actions: [{ type: 'turn_off', target: 'circulation_fan' }]
    }
  }
]

const TRIGGER_TYPES = [
  { value: 'time', label: 'At a specific time' },
  { value: 'numeric_state', label: 'When sensor value changes' },
  { value: 'state', label: 'When device state changes' }
]

const ACTION_TYPES = [
  { value: 'turn_on', label: 'Turn on' },
  { value: 'turn_off', label: 'Turn off' },
  { value: 'toggle', label: 'Toggle' }
]

export function AutomationEditor({ tent, automation, onClose, onSave }) {
  const [step, setStep] = useState(automation ? 'edit' : 'template')
  const [selectedTemplate, setSelectedTemplate] = useState(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [triggerType, setTriggerType] = useState('time')
  const [triggerConfig, setTriggerConfig] = useState({})
  const [actionType, setActionType] = useState('turn_on')
  const [actionTarget, setActionTarget] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // Get available entities from tent
  const sensors = Object.entries(tent?.sensors || {})
    .filter(([_, v]) => v?.entity_id || (typeof v === 'string'))
    .map(([key, v]) => ({ key, entity_id: v?.entity_id || v }))

  const actuators = Object.entries(tent?.actuators || {})
    .filter(([_, v]) => v?.entity_id || (typeof v === 'string'))
    .map(([key, v]) => ({ key, entity_id: v?.entity_id || v }))

  // Load automation config if editing
  useEffect(() => {
    if (automation) {
      setName(automation.attributes?.friendly_name || '')
      // Fetch full config
      apiFetch(`api/automations/ha/${automation.entity_id}/config`)
        .then(r => r.json())
        .then(data => {
          if (data.config) {
            setDescription(data.config.description || '')
            // Parse triggers and actions
            const trigger = data.config.trigger?.[0] || {}
            const action = data.config.action?.[0] || {}

            if (trigger.platform === 'time') {
              setTriggerType('time')
              setTriggerConfig({ at: trigger.at || '06:00' })
            } else if (trigger.platform === 'numeric_state') {
              setTriggerType('numeric_state')
              setTriggerConfig({
                entity_id: trigger.entity_id,
                above: trigger.above,
                below: trigger.below
              })
            } else if (trigger.platform === 'state') {
              setTriggerType('state')
              setTriggerConfig({
                entity_id: trigger.entity_id,
                to: trigger.to
              })
            }

            if (action.service) {
              const [domain, service] = action.service.split('.')
              setActionType(service || 'turn_on')
              setActionTarget(action.target?.entity_id || action.entity_id || '')
            }
          }
        })
        .catch(console.error)
    }
  }, [automation])

  const applyTemplate = (template) => {
    setSelectedTemplate(template)
    setName(template.name)
    setDescription(template.description)

    const trigger = template.config.triggers[0]
    setTriggerType(trigger.type)

    if (trigger.type === 'time') {
      setTriggerConfig({ at: trigger.at })
    } else if (trigger.type === 'numeric_state') {
      // Find the sensor entity
      const sensorKey = trigger.target
      const sensor = sensors.find(s => s.key === sensorKey)
      setTriggerConfig({
        entity_id: sensor?.entity_id || '',
        above: trigger.above,
        below: trigger.below
      })
    }

    const action = template.config.actions[0]
    setActionType(action.type)
    // Find the actuator entity
    const actuator = actuators.find(a => a.key === action.target)
    setActionTarget(actuator?.entity_id || '')

    setStep('edit')
  }

  const buildHAConfig = () => {
    // Build trigger
    let trigger = {}
    if (triggerType === 'time') {
      trigger = {
        platform: 'time',
        at: triggerConfig.at || '06:00:00'
      }
    } else if (triggerType === 'numeric_state') {
      trigger = {
        platform: 'numeric_state',
        entity_id: triggerConfig.entity_id
      }
      if (triggerConfig.above !== undefined && triggerConfig.above !== '') {
        trigger.above = parseFloat(triggerConfig.above)
      }
      if (triggerConfig.below !== undefined && triggerConfig.below !== '') {
        trigger.below = parseFloat(triggerConfig.below)
      }
    } else if (triggerType === 'state') {
      trigger = {
        platform: 'state',
        entity_id: triggerConfig.entity_id,
        to: triggerConfig.to || 'on'
      }
    }

    // Build action
    const domain = actionTarget?.split('.')[0] || 'switch'
    const action = {
      service: `${domain}.${actionType}`,
      target: { entity_id: actionTarget }
    }

    return {
      alias: name,
      description: description,
      mode: 'single',
      triggers: [trigger],
      actions: [action]
    }
  }

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Name is required')
      return
    }
    if (!actionTarget) {
      setError('Please select a target device')
      return
    }

    setSaving(true)
    setError(null)

    try {
      const config = buildHAConfig()

      if (automation) {
        // Update existing
        const autoId = automation.entity_id.replace('automation.', '')
        await apiFetch(`api/automations/ha/${autoId}/update`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config)
        })
      } else {
        // Create new
        await apiFetch('api/automations/ha/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config)
        })
      }

      onSave()
    } catch (e) {
      setError(e.message || 'Failed to save automation')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-[#16213e] rounded-lg w-full max-w-2xl max-h-[90vh] overflow-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#2d3a5c]">
          <h3 className="text-lg font-semibold">
            {automation ? 'Edit Automation' : 'Create Automation'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl px-2 py-1 rounded hover:bg-[#2d3a5c]">
            &times;
          </button>
        </div>

        {/* Template Selection */}
        {step === 'template' && (
          <div className="p-4">
            <p className="text-gray-400 mb-4">Choose a template or start from scratch:</p>
            <div className="grid grid-cols-2 gap-3 mb-4">
              {TEMPLATES.map(template => (
                <button
                  key={template.id}
                  onClick={() => applyTemplate(template)}
                  className="p-4 bg-[#1a1a2e] rounded-lg text-left hover:bg-[#2d3a5c] transition-colors"
                >
                  <div className="text-2xl mb-2">{template.icon}</div>
                  <div className="font-medium">{template.name}</div>
                  <div className="text-xs text-gray-400">{template.description}</div>
                </button>
              ))}
            </div>
            <button
              onClick={() => setStep('edit')}
              className="w-full btn btn-secondary"
            >
              Start from scratch
            </button>
          </div>
        )}

        {/* Edit Form */}
        {step === 'edit' && (
          <div className="p-4 space-y-4">
            {error && (
              <div className="p-3 bg-red-500/20 border border-red-500/50 rounded text-red-300 text-sm">
                {error}
              </div>
            )}

            {/* Name */}
            <div>
              <label className="block text-sm text-gray-400 mb-1">Name</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                className="input w-full"
                placeholder="My Automation"
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm text-gray-400 mb-1">Description (optional)</label>
              <input
                type="text"
                value={description}
                onChange={e => setDescription(e.target.value)}
                className="input w-full"
                placeholder="What does this automation do?"
              />
            </div>

            {/* Trigger */}
            <div className="p-4 bg-[#1a1a2e] rounded-lg">
              <div className="text-sm font-medium mb-3">When...</div>

              <div className="space-y-3">
                <select
                  value={triggerType}
                  onChange={e => {
                    setTriggerType(e.target.value)
                    setTriggerConfig({})
                  }}
                  className="input w-full"
                >
                  {TRIGGER_TYPES.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>

                {triggerType === 'time' && (
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Time</label>
                    <input
                      type="time"
                      value={triggerConfig.at?.slice(0, 5) || '06:00'}
                      onChange={e => setTriggerConfig({ ...triggerConfig, at: e.target.value + ':00' })}
                      className="input"
                    />
                  </div>
                )}

                {triggerType === 'numeric_state' && (
                  <div className="space-y-2">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Sensor</label>
                      <select
                        value={triggerConfig.entity_id || ''}
                        onChange={e => setTriggerConfig({ ...triggerConfig, entity_id: e.target.value })}
                        className="input w-full"
                      >
                        <option value="">Select sensor...</option>
                        {sensors.map(s => (
                          <option key={s.key} value={s.entity_id}>
                            {s.key} ({s.entity_id})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Above</label>
                        <input
                          type="number"
                          value={triggerConfig.above ?? ''}
                          onChange={e => setTriggerConfig({ ...triggerConfig, above: e.target.value })}
                          className="input w-full"
                          placeholder="e.g. 28"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Below</label>
                        <input
                          type="number"
                          value={triggerConfig.below ?? ''}
                          onChange={e => setTriggerConfig({ ...triggerConfig, below: e.target.value })}
                          className="input w-full"
                          placeholder="e.g. 18"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {triggerType === 'state' && (
                  <div className="space-y-2">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Entity</label>
                      <select
                        value={triggerConfig.entity_id || ''}
                        onChange={e => setTriggerConfig({ ...triggerConfig, entity_id: e.target.value })}
                        className="input w-full"
                      >
                        <option value="">Select entity...</option>
                        {[...sensors, ...actuators].map(e => (
                          <option key={e.key} value={e.entity_id}>
                            {e.key} ({e.entity_id})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Changes to</label>
                      <input
                        type="text"
                        value={triggerConfig.to || ''}
                        onChange={e => setTriggerConfig({ ...triggerConfig, to: e.target.value })}
                        className="input w-full"
                        placeholder="on, off, etc."
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Action */}
            <div className="p-4 bg-[#1a1a2e] rounded-lg">
              <div className="text-sm font-medium mb-3">Then...</div>

              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Action</label>
                    <select
                      value={actionType}
                      onChange={e => setActionType(e.target.value)}
                      className="input w-full"
                    >
                      {ACTION_TYPES.map(a => (
                        <option key={a.value} value={a.value}>{a.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Device</label>
                    <select
                      value={actionTarget}
                      onChange={e => setActionTarget(e.target.value)}
                      className="input w-full"
                    >
                      <option value="">Select device...</option>
                      {actuators.map(a => (
                        <option key={a.key} value={a.entity_id}>
                          {a.key} ({a.entity_id})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2 justify-end pt-4 border-t border-[#2d3a5c]">
              {!automation && step === 'edit' && (
                <button onClick={() => setStep('template')} className="btn">
                  Back to Templates
                </button>
              )}
              <button onClick={onClose} className="btn">
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="btn btn-primary"
              >
                {saving ? 'Saving...' : (automation ? 'Update' : 'Create')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
