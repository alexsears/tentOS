import { useState, useEffect, useMemo } from 'react'
import { apiFetch } from '../utils/api'
import { usePreloadedData } from '../App'

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

// Suggestions banner
function SuggestionsBanner({ suggestions, onApply, onDismiss }) {
  const [dismissed, setDismissed] = useState(new Set())

  const visible = suggestions.filter(s => !dismissed.has(`${s.tent_id}-${s.template_id}`))
  if (visible.length === 0) return null

  return (
    <div className="card bg-blue-500/10 border-blue-500/30">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold flex items-center gap-2">
          <span>💡</span> Suggestions ({visible.length})
        </h3>
        <button
          onClick={() => setDismissed(new Set(suggestions.map(s => `${s.tent_id}-${s.template_id}`)))}
          className="text-sm text-gray-400 hover:text-white"
        >
          Dismiss all
        </button>
      </div>
      <div className="space-y-2">
        {visible.slice(0, 3).map(s => (
          <div key={`${s.tent_id}-${s.template_id}`} className="flex items-center gap-3 p-2 rounded bg-[#1a1a2e]">
            <span className="text-xl">{s.template.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">{s.tent_name}: {s.template.name}</div>
              <div className="text-xs text-gray-400 truncate">{s.reason}</div>
            </div>
            <button
              onClick={() => onApply(s)}
              className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-700 text-xs"
            >
              Create
            </button>
            <button
              onClick={() => setDismissed(prev => new Set([...prev, `${s.tent_id}-${s.template_id}`]))}
              className="p-1 text-gray-400 hover:text-white"
            >
              ✕
            </button>
          </div>
        ))}
        {visible.length > 3 && (
          <div className="text-sm text-gray-400 text-center">+{visible.length - 3} more suggestions</div>
        )}
      </div>
    </div>
  )
}

// Conflicts warning
function ConflictsWarning({ conflicts }) {
  const [expanded, setExpanded] = useState(false)

  if (conflicts.length === 0) return null

  return (
    <div className="card bg-yellow-500/10 border-yellow-500/30">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between"
      >
        <h3 className="font-semibold flex items-center gap-2">
          <span>⚠️</span> Potential Conflicts ({conflicts.length})
        </h3>
        <span className="text-gray-400">{expanded ? '▼' : '▶'}</span>
      </button>
      {expanded && (
        <div className="mt-3 space-y-2">
          {conflicts.map((c, i) => (
            <div key={i} className="p-2 rounded bg-[#1a1a2e] text-sm">
              <div className="text-yellow-300">{c.detail}</div>
              <div className="text-xs text-gray-400 mt-1">
                {c.automation1} ↔ {c.automation2}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Automation card component
function AutomationCard({ automation, tagsInfo, onTrigger, onToggle, onDelete, compact = false, selectable = false, selected = false, onSelect }) {
  const entityId = automation.entity_id || ''
  const name = automation.attributes?.friendly_name || entityId.replace('automation.', '').replace(/_/g, ' ')
  const state = automation.state
  const lastTriggered = automation.attributes?.last_triggered
  const isTentOS = entityId.includes('tentos_')
  const tags = automation.tags || []

  if (compact) {
    return (
      <div className={`flex items-center gap-3 p-3 rounded-lg bg-[#1a1a2e] ${state === 'off' ? 'opacity-60' : ''}`}>
        {selectable && (
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onSelect(entityId)}
            className="w-4 h-4 rounded"
          />
        )}
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
      {selectable && (
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onSelect(entityId)}
          className="w-4 h-4 rounded"
        />
      )}
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
function CategoryGroup({ categoryId, categoryInfo, automations, tagsInfo, onTrigger, onToggle, onDelete, defaultExpanded = true, selectable = false, selectedIds = new Set(), onSelect }) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const activeCount = automations.filter(a => a.state === 'on').length
  const selectedCount = automations.filter(a => selectedIds.has(a.entity_id)).length

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
            {selectable && selectedCount > 0 && ` (${selectedCount} selected)`}
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
              selectable={selectable}
              selected={selectedIds.has(automation.entity_id)}
              onSelect={onSelect}
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

// Entity suggestions card
function EntitySuggestionsCard({ suggestions }) {
  const [expanded, setExpanded] = useState(false)

  if (!suggestions || suggestions.length === 0) return null

  // Flatten all suggestions across tents
  const allSuggestions = suggestions.flatMap(t =>
    t.suggestions.map(s => ({ ...s, tentName: t.tent_name, tentId: t.tent_id }))
  )

  if (allSuggestions.length === 0) return null

  return (
    <div className="card bg-purple-500/10 border-purple-500/30">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between"
      >
        <h3 className="font-semibold flex items-center gap-2">
          <span>🔮</span> Unlock More Automations
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-sm text-purple-300">{allSuggestions.length} suggestions</span>
          <span className="text-gray-400">{expanded ? '▼' : '▶'}</span>
        </div>
      </button>

      {expanded && (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-gray-400">
            Add these entities to your tent configuration to enable more automations:
          </p>
          {allSuggestions.slice(0, 6).map((s, i) => (
            <div key={`${s.tentId}-${s.slot}-${i}`} className="p-3 rounded-lg bg-[#1a1a2e]">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-2xl">{s.icon}</span>
                <div className="flex-1">
                  <div className="font-medium">{s.label}</div>
                  <div className="text-xs text-gray-400">{s.description}</div>
                </div>
                <a
                  href="/settings"
                  className="px-3 py-1 rounded bg-purple-600 hover:bg-purple-700 text-xs"
                >
                  Add in Settings
                </a>
              </div>
              <div className="flex flex-wrap gap-1 mt-2">
                <span className="text-xs text-gray-500">Enables:</span>
                {s.enables.map(t => (
                  <span
                    key={t.id}
                    className="px-2 py-0.5 rounded bg-[#2d3a5c] text-xs flex items-center gap-1"
                  >
                    {t.icon} {t.name}
                  </span>
                ))}
              </div>
            </div>
          ))}
          {allSuggestions.length > 6 && (
            <div className="text-sm text-center text-gray-400">
              +{allSuggestions.length - 6} more suggestions
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Bundle card
function BundleCard({ bundle, onApply }) {
  const hasAvailableTents = bundle.available_tents?.length > 0

  return (
    <button
      onClick={() => hasAvailableTents && onApply(bundle)}
      disabled={!hasAvailableTents}
      className={`p-4 rounded-lg text-left transition-colors border-2 ${
        hasAvailableTents
          ? 'bg-gradient-to-br from-[#1a1a2e] to-[#2d3a5c] hover:from-[#2d3a5c] hover:to-[#3d4a6c] cursor-pointer border-transparent'
          : 'bg-[#1a1a2e]/50 opacity-50 cursor-not-allowed border-transparent'
      }`}
    >
      <div className="flex items-center gap-3 mb-2">
        <span className="text-3xl">{bundle.icon}</span>
        <div>
          <div className="font-semibold">{bundle.name}</div>
          <div className="text-xs text-gray-400">{bundle.templates.length} automations</div>
        </div>
      </div>
      <p className="text-sm text-gray-400">{bundle.description}</p>
      {!hasAvailableTents && (
        <p className="text-xs text-yellow-500 mt-2">No tents have all required equipment</p>
      )}
    </button>
  )
}

// Apply modal (template or bundle)
function ApplyModal({ item, type, onApply, onCancel }) {
  const [tentId, setTentId] = useState(item.available_tents?.[0]?.id || '')
  const [threshold, setThreshold] = useState(item.above || item.below || '')
  const [timeOn, setTimeOn] = useState(item.time_on?.slice(0, 5) || '06:00')
  const [timeOff, setTimeOff] = useState(item.time_off?.slice(0, 5) || '00:00')
  const [loading, setLoading] = useState(false)

  const handleApply = async () => {
    setLoading(true)
    const data = { tent_id: tentId }

    if (type === 'template') {
      if (item.trigger_type === 'numeric_state') {
        data.threshold = parseFloat(threshold)
      } else if (item.trigger_type === 'time') {
        data.time_on = timeOn + ':00'
        data.time_off = timeOff + ':00'
      }
    }

    await onApply(item.id, data, type)
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#0d1117] rounded-xl p-6 max-w-md w-full space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-semibold flex items-center gap-2">
            <span>{item.icon}</span>
            {item.name}
          </h3>
          <button onClick={onCancel} className="text-gray-400 hover:text-white">✕</button>
        </div>

        <p className="text-sm text-gray-400">{item.description}</p>

        <div>
          <label className="text-sm text-gray-400 block mb-1">Tent</label>
          <select
            value={tentId}
            onChange={e => setTentId(e.target.value)}
            className="input w-full"
          >
            {item.available_tents?.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>

        {type === 'template' && item.trigger_type === 'numeric_state' && (
          <div>
            <label className="text-sm text-gray-400 block mb-1">
              Threshold ({item.sensor_type === 'temperature' ? '°C' : item.sensor_type === 'vpd' ? 'kPa' : '%'})
            </label>
            <input
              type="number"
              step="0.1"
              value={threshold}
              onChange={e => setThreshold(e.target.value)}
              className="input w-full"
              placeholder={String(item.above || item.below)}
            />
          </div>
        )}

        {type === 'template' && item.trigger_type === 'time' && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-gray-400 block mb-1">Turn On</label>
              <input
                type="time"
                value={timeOn}
                onChange={e => setTimeOn(e.target.value)}
                className="input w-full"
              />
            </div>
            <div>
              <label className="text-sm text-gray-400 block mb-1">Turn Off</label>
              <input
                type="time"
                value={timeOff}
                onChange={e => setTimeOff(e.target.value)}
                className="input w-full"
              />
            </div>
          </div>
        )}

        {type === 'bundle' && (
          <div className="text-sm text-gray-400">
            This will create {item.templates.length} automations:
            <ul className="list-disc list-inside mt-1">
              {item.templates.map(t => <li key={t}>{t.replace(/_/g, ' ')}</li>)}
            </ul>
          </div>
        )}

        <div className="flex gap-2 pt-4 border-t border-[#2d3a5c]">
          <button
            onClick={handleApply}
            disabled={loading}
            className="btn btn-primary flex-1"
          >
            {loading ? 'Creating...' : type === 'bundle' ? 'Create All' : 'Create'}
          </button>
          <button onClick={onCancel} className="btn">Cancel</button>
        </div>
      </div>
    </div>
  )
}

// Bulk actions bar
function BulkActionsBar({ selectedCount, onEnable, onDisable, onTrigger, onClear }) {
  if (selectedCount === 0) return null

  return (
    <div className="sticky bottom-4 mx-auto w-fit bg-[#1a1a2e] rounded-lg shadow-lg border border-[#2d3a5c] p-3 flex items-center gap-3">
      <span className="text-sm">{selectedCount} selected</span>
      <button onClick={onEnable} className="px-3 py-1 rounded bg-green-600 hover:bg-green-700 text-xs">
        Enable All
      </button>
      <button onClick={onDisable} className="px-3 py-1 rounded bg-gray-600 hover:bg-gray-700 text-xs">
        Disable All
      </button>
      <button onClick={onTrigger} className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-700 text-xs">
        Trigger All
      </button>
      <button onClick={onClear} className="p-1 text-gray-400 hover:text-white">
        ✕
      </button>
    </div>
  )
}

// Main Automations page
export default function Automations() {
  // Use preloaded data from App for instant display
  const preloaded = usePreloadedData()

  const [automations, setAutomations] = useState([])
  const [byCategory, setByCategory] = useState({})
  const [categories, setCategories] = useState({})
  const [tagsInfo, setTagsInfo] = useState({})
  const [templates, setTemplates] = useState([])
  const [bundles, setBundles] = useState([])
  const [suggestions, setSuggestions] = useState([])
  const [conflicts, setConflicts] = useState([])
  const [entitySuggestions, setEntitySuggestions] = useState([])
  const [tents, setTents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [activeTab, setActiveTab] = useState('automations') // 'automations', 'create', 'history'
  const [applyingItem, setApplyingItem] = useState(null)
  const [applyingType, setApplyingType] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [viewMode, setViewMode] = useState('categories')
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [showAllAutomations, setShowAllAutomations] = useState(false) // Default to tent-only

  // Use preloaded data immediately if available
  useEffect(() => {
    if (preloaded.automations && !showAllAutomations) {
      setAutomations(preloaded.automations.automations || [])
      setByCategory(preloaded.automations.by_category || {})
      setCategories(preloaded.automations.categories || {})
      setTagsInfo(preloaded.automations.tags || {})
      setLoading(false)
    }
    if (preloaded.tents) {
      setTents(preloaded.tents)
    }
  }, [preloaded])

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
  }, [showAllAutomations])

  const loadData = async (forceRefresh = false) => {
    try {
      // Use preloaded tents if available, otherwise fetch
      let tentsList = preloaded.tents
      if (!tentsList || forceRefresh) {
        const tentsRes = await apiFetch('api/tents').then(r => r.json()).catch(() => ({ tents: [] }))
        tentsList = tentsRes.tents || []
      }
      setTents(tentsList)

      // Build automations URL with filter params
      const autoParams = new URLSearchParams()
      autoParams.set('show_all', showAllAutomations.toString())
      // If we have tents and not showing all, the backend will filter to tent entities
      if (tentsList.length > 0 && !showAllAutomations) {
        // Use first tent's ID for filtering (could extend to multi-tent later)
        autoParams.set('tent_id', tentsList[0].id)
      }

      // Use preloaded automations if available and not forcing refresh
      const usePreloadedAuto = preloaded.automations && !showAllAutomations && !forceRefresh

      const [autoRes, templatesRes, bundlesRes, suggestionsRes, conflictsRes, entitySuggestionsRes] = await Promise.all([
        usePreloadedAuto
          ? Promise.resolve(preloaded.automations)
          : apiFetch(`api/automations?${autoParams}`).then(r => r.json()).catch(() => ({ automations: [], by_category: {}, categories: {}, tags: {} })),
        apiFetch('api/automations/templates').then(r => r.json()).catch(() => ({ templates: [] })),
        apiFetch('api/automations/bundles').then(r => r.json()).catch(() => ({ bundles: [] })),
        apiFetch('api/automations/suggestions').then(r => r.json()).catch(() => ({ suggestions: [] })),
        apiFetch('api/automations/conflicts').then(r => r.json()).catch(() => ({ conflicts: [] })),
        apiFetch('api/automations/entity-suggestions').then(r => r.json()).catch(() => ({ suggestions: [] }))
      ])
      setAutomations(autoRes.automations || [])
      setByCategory(autoRes.by_category || {})
      setCategories(autoRes.categories || {})
      setTagsInfo(autoRes.tags || {})
      setTemplates(templatesRes.templates || [])
      setBundles(bundlesRes.bundles || [])
      setSuggestions(suggestionsRes.suggestions || [])
      setConflicts(conflictsRes.conflicts || [])
      setEntitySuggestions(entitySuggestionsRes.suggestions || [])
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

  const handleApply = async (itemId, data, type) => {
    try {
      const endpoint = type === 'bundle'
        ? `api/automations/bundles/${itemId}/apply`
        : `api/automations/templates/${itemId}/apply`

      const res = await apiFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Failed to create')
      }

      const result = await res.json()
      if (type === 'bundle') {
        setSuccess(`Created ${result.created.length} automations from ${result.bundle}`)
      } else {
        setSuccess(`Created: ${result.alias}`)
      }
      setApplyingItem(null)
      setApplyingType(null)
      loadData()
      setTimeout(() => setSuccess(null), 3000)
    } catch (e) {
      setError(e.message || 'Failed to create automation')
      setTimeout(() => setError(null), 5000)
    }
  }

  const handleSuggestionApply = (suggestion) => {
    const template = templates.find(t => t.id === suggestion.template_id) || suggestion.template
    if (template) {
      setApplyingItem({ ...template, available_tents: [{ id: suggestion.tent_id, name: suggestion.tent_name }] })
      setApplyingType('template')
    }
  }

  const handleSelect = (entityId) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(entityId)) {
        next.delete(entityId)
      } else {
        next.add(entityId)
      }
      return next
    })
  }

  const handleBulkEnable = async () => {
    try {
      await apiFetch('api/automations/bulk/enable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity_ids: [...selectedIds] })
      })
      setSuccess(`Enabled ${selectedIds.size} automations`)
      setSelectedIds(new Set())
      setSelectMode(false)
      loadData()
      setTimeout(() => setSuccess(null), 3000)
    } catch (e) {
      setError('Failed to enable automations')
      setTimeout(() => setError(null), 3000)
    }
  }

  const handleBulkDisable = async () => {
    try {
      await apiFetch('api/automations/bulk/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity_ids: [...selectedIds] })
      })
      setSuccess(`Disabled ${selectedIds.size} automations`)
      setSelectedIds(new Set())
      setSelectMode(false)
      loadData()
      setTimeout(() => setSuccess(null), 3000)
    } catch (e) {
      setError('Failed to disable automations')
      setTimeout(() => setError(null), 3000)
    }
  }

  const handleBulkTrigger = async () => {
    try {
      await apiFetch('api/automations/bulk/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity_ids: [...selectedIds] })
      })
      setSuccess(`Triggered ${selectedIds.size} automations`)
      setSelectedIds(new Set())
      setSelectMode(false)
      setTimeout(() => setSuccess(null), 3000)
    } catch (e) {
      setError('Failed to trigger automations')
      setTimeout(() => setError(null), 3000)
    }
  }

  if (loading) {
    return <div className="text-center text-gray-400 py-12">Loading...</div>
  }

  return (
    <div className="space-y-6 pb-20">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Automations</h2>
          <p className="text-gray-400">
            {totalCount} {showAllAutomations ? 'Home Assistant' : 'tent-related'} automations
            {!showAllAutomations && tents.length > 0 && ` for ${tents[0]?.name || 'your tent'}`}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setSelectMode(!selectMode); setSelectedIds(new Set()) }}
            className={`btn ${selectMode ? 'bg-blue-600' : ''}`}
          >
            {selectMode ? 'Cancel' : 'Select'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-[#2d3a5c]">
        <button
          onClick={() => setActiveTab('automations')}
          className={`px-4 py-2 font-medium ${activeTab === 'automations' ? 'border-b-2 border-blue-500 text-blue-400' : 'text-gray-400'}`}
        >
          Automations
        </button>
        <button
          onClick={() => setActiveTab('create')}
          className={`px-4 py-2 font-medium ${activeTab === 'create' ? 'border-b-2 border-green-500 text-green-400' : 'text-gray-400'}`}
        >
          + Create
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`px-4 py-2 font-medium ${activeTab === 'history' ? 'border-b-2 border-purple-500 text-purple-400' : 'text-gray-400'}`}
        >
          History
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

      {/* Automations Tab */}
      {activeTab === 'automations' && (
        <>
          {/* Suggestions */}
          <SuggestionsBanner
            suggestions={suggestions}
            onApply={handleSuggestionApply}
          />

          {/* Conflicts */}
          <ConflictsWarning conflicts={conflicts} />

          {/* Search, Filter and View Toggle */}
          <div className="flex items-center gap-4 flex-wrap">
            <input
              type="text"
              placeholder="Search automations..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="input flex-1 min-w-[200px]"
            />
            {/* Tent filter toggle */}
            {tents.length > 0 && (
              <div className="flex rounded-lg overflow-hidden border border-[#2d3a5c]">
                <button
                  onClick={() => setShowAllAutomations(false)}
                  className={`px-3 py-2 text-sm ${!showAllAutomations ? 'bg-green-600' : 'hover:bg-[#1a1a2e]'}`}
                  title="Show only automations using your tent's entities"
                >
                  🌱 My Tent
                </button>
                <button
                  onClick={() => setShowAllAutomations(true)}
                  className={`px-3 py-2 text-sm ${showAllAutomations ? 'bg-[#2d3a5c]' : 'hover:bg-[#1a1a2e]'}`}
                  title="Show all Home Assistant automations"
                >
                  All HA
                </button>
              </div>
            )}
            {/* View mode toggle */}
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
            <a href="/config/automation/dashboard" target="_top" className="btn">
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
                    selectable={selectMode}
                    selectedIds={selectedIds}
                    onSelect={handleSelect}
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
                    selectable={selectMode}
                    selected={selectedIds.has(automation.entity_id)}
                    onSelect={handleSelect}
                  />
                ))
              )}
            </div>
          )}
        </>
      )}

      {/* Create Tab */}
      {activeTab === 'create' && (
        <div className="space-y-6">
          {/* Entity Suggestions */}
          <EntitySuggestionsCard suggestions={entitySuggestions} />

          {/* Bundles */}
          <div>
            <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <span>📦</span> Preset Bundles
            </h3>
            <p className="text-sm text-gray-400 mb-4">
              Create multiple automations at once for common setups
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {bundles.map(b => (
                <BundleCard
                  key={b.id}
                  bundle={b}
                  onApply={(bundle) => { setApplyingItem(bundle); setApplyingType('bundle') }}
                />
              ))}
            </div>
          </div>

          {/* Individual Templates */}
          <div>
            <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <span>⚡</span> Individual Templates
            </h3>
            <p className="text-sm text-gray-400 mb-4">
              Create a single automation from a template
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {templates.map(t => (
                <TemplateCard
                  key={t.id}
                  template={t}
                  onApply={(template) => { setApplyingItem(template); setApplyingType('template') }}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* History Tab */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-400">Recent automation triggers (sorted by last triggered)</p>
          <div className="space-y-2">
            {automations
              .filter(a => a.attributes?.last_triggered)
              .sort((a, b) => (b.attributes?.last_triggered || '').localeCompare(a.attributes?.last_triggered || ''))
              .slice(0, 20)
              .map(auto => (
                <div key={auto.entity_id} className="flex items-center gap-4 p-3 rounded-lg bg-[#1a1a2e]">
                  <div className={`w-2 h-2 rounded-full ${auto.state === 'on' ? 'bg-green-500' : 'bg-gray-500'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">
                      {auto.attributes?.friendly_name || auto.entity_id}
                    </div>
                    <div className="text-xs text-gray-400">
                      {new Date(auto.attributes.last_triggered).toLocaleString()}
                    </div>
                  </div>
                  <button
                    onClick={() => handleTrigger(auto.entity_id)}
                    className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-xs"
                  >
                    Run Again
                  </button>
                </div>
              ))}
            {automations.filter(a => a.attributes?.last_triggered).length === 0 && (
              <div className="card text-center py-8">
                <div className="text-4xl mb-4">📜</div>
                <p className="text-gray-400">No automation history available</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bulk Actions Bar */}
      <BulkActionsBar
        selectedCount={selectedIds.size}
        onEnable={handleBulkEnable}
        onDisable={handleBulkDisable}
        onTrigger={handleBulkTrigger}
        onClear={() => { setSelectedIds(new Set()); setSelectMode(false) }}
      />

      {/* Apply Modal */}
      {applyingItem && (
        <ApplyModal
          item={applyingItem}
          type={applyingType}
          onApply={handleApply}
          onCancel={() => { setApplyingItem(null); setApplyingType(null) }}
        />
      )}
    </div>
  )
}
