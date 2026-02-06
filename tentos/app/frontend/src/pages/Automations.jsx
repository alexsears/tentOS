import { useState, useEffect, useMemo } from 'react'
import { apiFetch } from '../utils/api'

// Tag colors
const TAG_COLORS = {
  schedule: 'bg-blue-500/20 text-blue-300',
  threshold: 'bg-purple-500/20 text-purple-300',
  sensor: 'bg-cyan-500/20 text-cyan-300',
  state: 'bg-orange-500/20 text-orange-300',
  sun: 'bg-yellow-500/20 text-yellow-300',
  motion: 'bg-green-500/20 text-green-300',
  multi: 'bg-red-500/20 text-red-300',
}

// Automation card component
function AutomationCard({ automation, tagsInfo, onTrigger, onToggle, onDelete, compact = false }) {
  const entityId = automation.entity_id || ''
  const name = automation.attributes?.friendly_name || entityId.replace('automation.', '').replace(/_/g, ' ')
  const state = automation.state
  const lastTriggered = automation.attributes?.last_triggered
  const isTentOS = entityId.includes('tentos_')
  const tags = automation.tags || []

  if (compact) {
    return (
      <div className={`flex items-center gap-3 p-3 rounded-lg bg-[#1a1a2e] ${state === 'off' ? 'opacity-60' : ''}`}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm truncate">{name}</span>
            {tags.length > 0 && (
              <div className="flex gap-1 flex-shrink-0">
                {tags.slice(0, 2).map(tag => (
                  <span
                    key={tag}
                    className={`px-1.5 py-0.5 rounded text-[10px] ${TAG_COLORS[tag] || 'bg-gray-500/20 text-gray-300'}`}
                    title={tagsInfo?.[tag]?.name || tag}
                  >
                    {tagsInfo?.[tag]?.icon || tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => onTrigger(entityId)}
            className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-xs"
            title="Run"
          >
            ▶
          </button>
          <button
            onClick={() => onToggle(entityId)}
            className={`px-2 py-1 rounded text-xs ${
              state === 'on' ? 'bg-green-600' : 'bg-gray-600'
            }`}
          >
            {state === 'on' ? 'ON' : 'OFF'}
          </button>
          {isTentOS && (
            <button
              onClick={() => onDelete(entityId)}
              className="p-1 hover:bg-red-500/20 rounded text-red-400 text-xs"
            >
              ✕
            </button>
          )}
          <a
            href={`/config/automation/edit/${entityId.replace('automation.', '')}`}
            target="_top"
            className="p-1 hover:bg-[#2d3a5c] rounded text-xs"
          >
            ✏️
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className={`flex items-center gap-4 p-4 rounded-lg bg-[#1a1a2e] ${state === 'off' ? 'opacity-60' : ''}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-medium truncate">{name}</span>
          {tags.length > 0 && (
            <div className="flex gap-1 flex-shrink-0">
              {tags.map(tag => (
                <span
                  key={tag}
                  className={`px-1.5 py-0.5 rounded text-xs ${TAG_COLORS[tag] || 'bg-gray-500/20 text-gray-300'}`}
                  title={tagsInfo?.[tag]?.name || tag}
                >
                  {tagsInfo?.[tag]?.icon} {tagsInfo?.[tag]?.name || tag}
                </span>
              ))}
            </div>
          )}
        </div>
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
          className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-xs font-medium"
          title="Manually trigger this automation"
        >
          Run
        </button>
        <button
          onClick={() => onToggle(entityId)}
          className={`px-3 py-1.5 rounded text-xs font-medium ${
            state === 'on' ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-600 hover:bg-gray-700'
          }`}
        >
          {state === 'on' ? 'ON' : 'OFF'}
        </button>
        {isTentOS && (
          <button
            onClick={() => onDelete(entityId)}
            className="p-2 hover:bg-red-500/20 rounded text-red-400"
            title="Delete this automation"
          >
            🗑️
          </button>
        )}
        <a
          href={`/config/automation/edit/${entityId.replace('automation.', '')}`}
          target="_top"
          className="p-2 hover:bg-[#2d3a5c] rounded"
          title="Edit in Home Assistant"
        >
          ✏️
        </a>
      </div>
    </div>
  )
}

// Category group component
function CategoryGroup({ categoryId, categoryInfo, automations, tagsInfo, onTrigger, onToggle, onDelete, defaultExpanded = true }) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const activeCount = automations.filter(a => a.state === 'on').length

  return (
    <div className="card p-0 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 p-4 hover:bg-[#1a1a2e] transition-colors text-left"
      >
        <span className="text-2xl">{categoryInfo.icon}</span>
        <div className="flex-1">
          <h3 className="font-semibold">{categoryInfo.name}</h3>
          <span className="text-sm text-gray-400">
            {automations.length} automation{automations.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-sm ${activeCount > 0 ? 'text-green-400' : 'text-gray-500'}`}>
            {activeCount}/{automations.length} active
          </span>
          <span className="text-gray-400">{expanded ? '▼' : '▶'}</span>
        </div>
      </button>
      {expanded && (
        <div className="border-t border-[#2d3a5c] p-3 space-y-2">
          {automations.map(automation => (
            <AutomationCard
              key={automation.entity_id}
              automation={automation}
              tagsInfo={tagsInfo}
              onTrigger={onTrigger}
              onToggle={onToggle}
              onDelete={onDelete}
              compact={true}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// Template card for quick creation
function TemplateCard({ template, onApply }) {
  const hasAvailableTents = template.available_tents?.length > 0

  return (
    <button
      onClick={() => hasAvailableTents && onApply(template)}
      disabled={!hasAvailableTents}
      className={`p-4 rounded-lg text-left transition-colors ${
        hasAvailableTents
          ? 'bg-[#1a1a2e] hover:bg-[#2d3a5c] cursor-pointer'
          : 'bg-[#1a1a2e]/50 opacity-50 cursor-not-allowed'
      }`}
    >
      <div className="flex items-center gap-3 mb-2">
        <span className="text-2xl">{template.icon}</span>
        <span className="font-medium">{template.name}</span>
      </div>
      <p className="text-sm text-gray-400">{template.description}</p>
      {!hasAvailableTents && (
        <p className="text-xs text-yellow-500 mt-2">No tents have required sensors/actuators</p>
      )}
    </button>
  )
}

// Template apply modal
function ApplyTemplateModal({ template, onApply, onCancel }) {
  const [tentId, setTentId] = useState(template.available_tents?.[0]?.id || '')
  const [threshold, setThreshold] = useState(template.above || template.below || '')
  const [timeOn, setTimeOn] = useState(template.time_on?.slice(0, 5) || '06:00')
  const [timeOff, setTimeOff] = useState(template.time_off?.slice(0, 5) || '00:00')
  const [loading, setLoading] = useState(false)

  const handleApply = async () => {
    setLoading(true)
    const data = { tent_id: tentId }

    if (template.trigger_type === 'numeric_state') {
      data.threshold = parseFloat(threshold)
    } else if (template.trigger_type === 'time') {
      data.time_on = timeOn + ':00'
      data.time_off = timeOff + ':00'
    }

    await onApply(template.id, data)
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#0d1117] rounded-xl p-6 max-w-md w-full space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-semibold flex items-center gap-2">
            <span>{template.icon}</span>
            {template.name}
          </h3>
          <button onClick={onCancel} className="text-gray-400 hover:text-white">✕</button>
        </div>

        <p className="text-sm text-gray-400">{template.description}</p>

        <div>
          <label className="text-sm text-gray-400 block mb-1">Tent</label>
          <select
            value={tentId}
            onChange={e => setTentId(e.target.value)}
            className="input w-full"
          >
            {template.available_tents?.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>

        {template.trigger_type === 'numeric_state' && (
          <div>
            <label className="text-sm text-gray-400 block mb-1">
              Threshold ({template.sensor_type === 'temperature' ? '°C' : '%'})
            </label>
            <input
              type="number"
              step="0.5"
              value={threshold}
              onChange={e => setThreshold(e.target.value)}
              className="input w-full"
              placeholder={String(template.above || template.below)}
            />
            <p className="text-xs text-gray-500 mt-1">
              {template.above ? `Triggers when above this value` : `Triggers when below this value`}
            </p>
          </div>
        )}

        {template.trigger_type === 'time' && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-gray-400 block mb-1">Turn On Time</label>
              <input
                type="time"
                value={timeOn}
                onChange={e => setTimeOn(e.target.value)}
                className="input w-full"
              />
            </div>
            <div>
              <label className="text-sm text-gray-400 block mb-1">Turn Off Time</label>
              <input
                type="time"
                value={timeOff}
                onChange={e => setTimeOff(e.target.value)}
                className="input w-full"
              />
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-4 border-t border-[#2d3a5c]">
          <button
            onClick={handleApply}
            disabled={loading}
            className="btn btn-primary flex-1"
          >
            {loading ? 'Creating...' : 'Create Automation'}
          </button>
          <button onClick={onCancel} className="btn">Cancel</button>
        </div>

        <p className="text-xs text-gray-500 text-center">
          This creates a real Home Assistant automation you can edit in HA
        </p>
      </div>
    </div>
  )
}

// Main Automations page
export default function Automations() {
  const [automations, setAutomations] = useState([])
  const [byCategory, setByCategory] = useState({})
  const [categories, setCategories] = useState({})
  const [tagsInfo, setTagsInfo] = useState({})
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [showTemplates, setShowTemplates] = useState(false)
  const [applyingTemplate, setApplyingTemplate] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [viewMode, setViewMode] = useState('categories') // 'categories' or 'list'

  // Filter automations by search (must be before early returns)
  const filteredByCategory = useMemo(() => {
    if (!searchTerm) return byCategory
    const term = searchTerm.toLowerCase()

    const filtered = {}
    for (const [cat, autos] of Object.entries(byCategory)) {
      const matching = autos.filter(a => {
        const name = a.attributes?.friendly_name || a.entity_id || ''
        return name.toLowerCase().includes(term)
      })
      if (matching.length > 0) {
        filtered[cat] = matching
      }
    }
    return filtered
  }, [byCategory, searchTerm])

  const filteredAutomations = useMemo(() => {
    const list = Array.isArray(automations) ? automations : []
    if (!searchTerm) return list
    const term = searchTerm.toLowerCase()
    return list.filter(a => {
      const name = a.attributes?.friendly_name || a.entity_id || ''
      return name.toLowerCase().includes(term)
    })
  }, [automations, searchTerm])

  const totalCount = useMemo(() => {
    return Object.values(filteredByCategory).reduce((sum, arr) => sum + arr.length, 0)
  }, [filteredByCategory])

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const [autoRes, templatesRes] = await Promise.all([
        apiFetch('api/automations').then(r => r.json()).catch(() => ({ automations: [], by_category: {}, categories: {} })),
        apiFetch('api/automations/templates').then(r => r.json()).catch(() => ({ templates: [] }))
      ])
      setAutomations(autoRes.automations || [])
      setByCategory(autoRes.by_category || {})
      setCategories(autoRes.categories || {})
      setTagsInfo(autoRes.tags || {})
      setTemplates(templatesRes.templates || [])
    } catch (e) {
      console.error('Failed to load automations:', e)
      setError('Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  const handleTrigger = async (entityId) => {
    try {
      await apiFetch(`api/automations/${encodeURIComponent(entityId)}/trigger`, { method: 'POST' })
      setSuccess('Automation triggered!')
      setTimeout(() => setSuccess(null), 3000)
    } catch (e) {
      setError('Failed to trigger automation')
      setTimeout(() => setError(null), 3000)
    }
  }

  const handleToggle = async (entityId) => {
    try {
      await apiFetch(`api/automations/${encodeURIComponent(entityId)}/toggle`, { method: 'POST' })
      loadData()
    } catch (e) {
      setError('Failed to toggle automation')
      setTimeout(() => setError(null), 3000)
    }
  }

  const handleDelete = async (entityId) => {
    if (!confirm('Delete this automation? This cannot be undone.')) return
    try {
      await apiFetch(`api/automations/${encodeURIComponent(entityId)}`, { method: 'DELETE' })
      setSuccess('Automation deleted')
      loadData()
      setTimeout(() => setSuccess(null), 3000)
    } catch (e) {
      setError('Failed to delete automation')
      setTimeout(() => setError(null), 3000)
    }
  }

  const handleApplyTemplate = async (templateId, data) => {
    try {
      const res = await apiFetch(`api/automations/templates/${templateId}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Failed to create')
      }

      const result = await res.json()
      setSuccess(`Created: ${result.alias}`)
      setApplyingTemplate(null)
      setShowTemplates(false)
      loadData()
      setTimeout(() => setSuccess(null), 3000)
    } catch (e) {
      setError(e.message || 'Failed to create automation')
      setTimeout(() => setError(null), 5000)
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
          <p className="text-gray-400">{totalCount} Home Assistant automations</p>
        </div>
        <button
          onClick={() => setShowTemplates(!showTemplates)}
          className="btn btn-primary"
        >
          {showTemplates ? 'Hide Templates' : '+ Quick Create'}
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

      {/* Template Selection */}
      {showTemplates && (
        <div className="card">
          <h3 className="text-lg font-semibold mb-4">Quick Create from Template</h3>
          <p className="text-sm text-gray-400 mb-4">
            Select a template to create a real Home Assistant automation.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {templates.map(t => (
              <TemplateCard
                key={t.id}
                template={t}
                onApply={setApplyingTemplate}
              />
            ))}
          </div>
        </div>
      )}

      {/* Search and View Toggle */}
      <div className="flex items-center gap-4">
        <input
          type="text"
          placeholder="Search automations..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="input flex-1"
        />
        <div className="flex rounded-lg overflow-hidden border border-[#2d3a5c]">
          <button
            onClick={() => setViewMode('categories')}
            className={`px-3 py-2 text-sm ${viewMode === 'categories' ? 'bg-[#2d3a5c]' : 'hover:bg-[#1a1a2e]'}`}
          >
            By Type
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`px-3 py-2 text-sm ${viewMode === 'list' ? 'bg-[#2d3a5c]' : 'hover:bg-[#1a1a2e]'}`}
          >
            List
          </button>
        </div>
        <a
          href="/config/automation/dashboard"
          target="_top"
          className="btn"
        >
          HA
        </a>
      </div>

      {/* Category View */}
      {viewMode === 'categories' && (
        <div className="space-y-4">
          {Object.entries(filteredByCategory).length === 0 ? (
            <div className="card text-center py-8">
              <div className="text-4xl mb-4">🔍</div>
              <p className="text-gray-400">No automations found</p>
            </div>
          ) : (
            Object.entries(filteredByCategory).map(([catId, autos]) => (
              <CategoryGroup
                key={catId}
                categoryId={catId}
                categoryInfo={categories[catId] || { name: catId, icon: '⚙️' }}
                automations={autos}
                tagsInfo={tagsInfo}
                onTrigger={handleTrigger}
                onToggle={handleToggle}
                onDelete={handleDelete}
                defaultExpanded={Object.keys(filteredByCategory).length <= 3}
              />
            ))
          )}
        </div>
      )}

      {/* List View */}
      {viewMode === 'list' && (
        <div className="space-y-2">
          {filteredAutomations.length === 0 ? (
            <div className="card text-center py-8">
              <div className="text-4xl mb-4">🔍</div>
              <p className="text-gray-400">No automations found</p>
            </div>
          ) : (
            filteredAutomations.map(automation => (
              <AutomationCard
                key={automation.entity_id}
                automation={automation}
                tagsInfo={tagsInfo}
                onTrigger={handleTrigger}
                onToggle={handleToggle}
                onDelete={handleDelete}
              />
            ))
          )}
        </div>
      )}

      {/* Template Apply Modal */}
      {applyingTemplate && (
        <ApplyTemplateModal
          template={applyingTemplate}
          onApply={handleApplyTemplate}
          onCancel={() => setApplyingTemplate(null)}
        />
      )}
    </div>
  )
}
