import { useState, useEffect, useMemo } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  Footprints,
  Layers,
  Lightbulb,
  ListChecks,
  Pencil,
  Play,
  Radio,
  RefreshCw,
  ScrollText,
  Search,
  Settings2,
  SlidersHorizontal,
  Sun,
  Trash2,
  Workflow,
  X,
  Zap,
} from 'lucide-react'
import { apiFetch } from '../utils/api'
import { usePreloadedData } from '../App'
import AutomationChains from '../components/AutomationChains'
import {
  AlertGlyph,
  actuatorIcon,
  sensorIcon,
  stageIcon,
  SENSOR_ICONS,
} from '../utils/icons'

// The backend ships emoji strings as `icon` on categories, tags, templates,
// bundles and entity suggestions. Those are ignored for rendering; every glyph
// below comes from the shared lucide vocabulary.
const CATEGORY_ICONS = {
  light: actuatorIcon('light'),
  climate: SENSOR_ICONS.temperature,
  exhaust: actuatorIcon('exhaust_fan'),
  humidity: SENSOR_ICONS.humidity,
  circulation: actuatorIcon('circulation_fan'),
  water: actuatorIcon('water_pump'),
  co2: SENSOR_ICONS.co2,
  other: Settings2,
}

const CATEGORY_LABELS = {
  light: 'Lighting',
  climate: 'Climate control',
  exhaust: 'Ventilation',
  humidity: 'Humidity',
  circulation: 'Air circulation',
  water: 'Irrigation',
  co2: 'CO2',
  other: 'Other',
}

const TAG_ICONS = {
  schedule: Clock,
  threshold: SlidersHorizontal,
  sensor: Radio,
  state: RefreshCw,
  sun: Sun,
  motion: Footprints,
  multi: Zap,
}

const BUNDLE_ICONS = {
  veg_basic: stageIcon('veg'),
  flower_basic: stageIcon('flower'),
  vpd_control: SENSOR_ICONS.vpd,
  full_climate: SENSOR_ICONS.temperature,
}

const SUGGESTIONS_OPEN_KEY = 'tentos.automations.suggestionsOpen'

function categoryLabel(catId, categoryInfo) {
  if (CATEGORY_LABELS[catId]) return CATEGORY_LABELS[catId]
  const raw = (categoryInfo?.name || catId || '').replace(/_/g, ' ').trim()
  if (!raw) return 'Other'
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}

function templateIcon(template) {
  if (!template) return Workflow
  if (template.actuator_type) return actuatorIcon(template.actuator_type)
  if (template.sensor_type) return sensorIcon(template.sensor_type)
  return Workflow
}

function readSuggestionsOpen() {
  try {
    return window.localStorage.getItem(SUGGESTIONS_OPEN_KEY) === 'true'
  } catch {
    return false
  }
}

function writeSuggestionsOpen(open) {
  try {
    window.localStorage.setItem(SUGGESTIONS_OPEN_KEY, open ? 'true' : 'false')
  } catch {
    // Storage can be unavailable in private mode; the toggle still works for this visit.
  }
}

// Shared small controls -------------------------------------------------------

function Segmented({ value, options, onChange, className = '' }) {
  return (
    <div className={`flex rounded-lg overflow-hidden border border-[#2d3a5c] ${className}`}>
      {options.map(opt => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          aria-pressed={value === opt.value}
          title={opt.title}
          className={`min-h-11 flex-1 sm:flex-none px-3 text-sm whitespace-nowrap transition-colors ${
            value === opt.value ? 'bg-green-600 text-white' : 'text-gray-400 hover:bg-[#1f2b4d]'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

function IconButton({ icon: Icon, label, onClick, active = false, danger = false, className = '', ...rest }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      className={`inline-flex items-center justify-center min-h-11 min-w-11 rounded-lg border transition-colors ${
        active
          ? 'border-green-600 bg-green-600 text-white'
          : danger
            ? 'border-[#2d3a5c] text-gray-400 hover:text-red-400 hover:bg-red-500/10'
            : 'border-[#2d3a5c] text-gray-300 hover:bg-[#1f2b4d] hover:text-white'
      } ${className}`}
      {...rest}
    >
      <Icon size={16} aria-hidden="true" />
    </button>
  )
}

function Disclosure({ icon: Icon, iconClass = 'text-gray-400', label, open, onToggle, children }) {
  return (
    <div className="card p-0 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full min-h-11 flex items-center gap-3 px-3 py-2 text-left hover:bg-[#1a1a2e] transition-colors"
      >
        <Icon size={18} className={`shrink-0 ${iconClass}`} aria-hidden="true" />
        <span className="flex-1 min-w-0 text-sm font-medium truncate">{label}</span>
        {open
          ? <ChevronDown size={16} className="shrink-0 text-gray-400" aria-hidden="true" />
          : <ChevronRight size={16} className="shrink-0 text-gray-400" aria-hidden="true" />}
      </button>
      {open && <div className="border-t border-[#2d3a5c] p-3">{children}</div>}
    </div>
  )
}

function EmptyState({ icon: Icon, text }) {
  return (
    <div className="card text-center py-8">
      <Icon size={28} className="mx-auto mb-3 text-gray-500" aria-hidden="true" />
      <p className="text-sm text-gray-400">{text}</p>
    </div>
  )
}

// Suggestions: one collapsed row by default, the list behind it.
function SuggestionsBanner({ suggestions, onApply }) {
  const [dismissed, setDismissed] = useState(new Set())
  const [open, setOpen] = useState(readSuggestionsOpen)

  const visible = suggestions.filter(s => !dismissed.has(`${s.tent_id}-${s.template_id}`))
  if (visible.length === 0) return null

  const toggle = () => {
    setOpen(prev => {
      writeSuggestionsOpen(!prev)
      return !prev
    })
  }

  return (
    <Disclosure
      icon={Lightbulb}
      label={`${visible.length} suggestion${visible.length !== 1 ? 's' : ''}`}
      open={open}
      onToggle={toggle}
    >
      <div className="space-y-2">
        {visible.map(s => {
          const Icon = templateIcon(s.template)
          return (
            <div key={`${s.tent_id}-${s.template_id}`} className="flex items-center gap-3 p-2 rounded-lg bg-[#1a1a2e]">
              <Icon size={18} className="shrink-0 text-gray-400" aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium break-words">{s.tent_name}: {s.template?.name}</div>
                <div className="text-xs text-gray-400 truncate">{s.reason}</div>
              </div>
              <button
                type="button"
                onClick={() => onApply(s)}
                className="btn btn-primary btn-sm min-h-11 shrink-0"
              >
                Create
              </button>
              <IconButton
                icon={X}
                label="Dismiss suggestion"
                onClick={() => setDismissed(prev => new Set([...prev, `${s.tent_id}-${s.template_id}`]))}
              />
            </div>
          )
        })}
        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={() => setDismissed(new Set(suggestions.map(s => `${s.tent_id}-${s.template_id}`)))}
            className="min-h-11 px-3 text-sm text-gray-400 hover:text-white"
          >
            Dismiss all
          </button>
        </div>
      </div>
    </Disclosure>
  )
}

// Conflicts warning
function ConflictsWarning({ conflicts }) {
  const [expanded, setExpanded] = useState(false)

  if (conflicts.length === 0) return null

  return (
    <Disclosure
      icon={AlertGlyph}
      iconClass="text-amber-400"
      label={`${conflicts.length} possible conflict${conflicts.length !== 1 ? 's' : ''}`}
      open={expanded}
      onToggle={() => setExpanded(!expanded)}
    >
      <div className="space-y-2">
        {conflicts.map((c, i) => (
          <div key={i} className="p-2 rounded-lg bg-[#1a1a2e] text-sm">
            <div className="text-amber-300">{c.detail}</div>
            <div className="text-xs text-gray-400 mt-1 break-words">
              {c.automation1} and {c.automation2}
            </div>
          </div>
        ))}
      </div>
    </Disclosure>
  )
}

// Automation row. `compact` hides the entity id and last-run line.
function AutomationCard({ automation, tagsInfo, onTrigger, onToggle, onDelete, compact = false, selectable = false, selected = false, onSelect }) {
  const entityId = automation.entity_id || ''
  const name = automation.attributes?.friendly_name || entityId.replace('automation.', '').replace(/_/g, ' ')
  const state = automation.state
  const lastTriggered = automation.attributes?.last_triggered
  const isTentOS = entityId.includes('tentos_')
  const tags = automation.tags || []
  const shownTags = compact ? tags.slice(0, 2) : tags

  return (
    <div className={`flex items-center gap-2 sm:gap-3 p-2 sm:p-3 rounded-lg bg-[#1a1a2e] ${state === 'off' ? 'opacity-60' : ''}`}>
      {selectable && (
        <label className="inline-flex items-center justify-center min-h-11 min-w-11 shrink-0">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onSelect(entityId)}
            aria-label={`Select ${name}`}
            className="w-4 h-4 rounded"
          />
        </label>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`font-medium truncate ${compact ? 'text-sm' : ''}`}>{name}</span>
          {shownTags.length > 0 && (
            <div className="flex gap-1 shrink-0">
              {shownTags.map(tag => {
                const TagIcon = TAG_ICONS[tag] || Zap
                const label = tagsInfo?.[tag]?.name || tag
                return (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#2d3a5c] text-gray-300 text-[11px]"
                    title={label}
                  >
                    <TagIcon size={11} aria-hidden="true" />
                    {!compact && <span>{label}</span>}
                  </span>
                )
              })}
            </div>
          )}
        </div>
        {!compact && (
          <div className="text-xs text-gray-400 mt-0.5 min-w-0">
            <span className="block truncate">{entityId}</span>
            {lastTriggered && (
              <span className="block truncate">Last run {new Date(lastTriggered).toLocaleString()}</span>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <IconButton icon={Play} label="Run now" onClick={() => onTrigger(entityId)} />
        <button
          type="button"
          onClick={() => onToggle(entityId)}
          aria-pressed={state === 'on'}
          className={`min-h-11 px-3 rounded-lg text-xs font-medium border transition-colors ${
            state === 'on'
              ? 'border-green-600 bg-green-600 text-white hover:bg-green-700'
              : 'border-[#2d3a5c] text-gray-400 hover:bg-[#1f2b4d]'
          }`}
        >
          {state === 'on' ? 'On' : 'Off'}
        </button>
        {isTentOS && (
          <IconButton icon={Trash2} label="Delete automation" danger onClick={() => onDelete(entityId)} />
        )}
        <a
          href={`/config/automation/edit/${entityId.replace('automation.', '')}`}
          target="_top"
          aria-label="Edit in Home Assistant"
          title="Edit in Home Assistant"
          className="inline-flex items-center justify-center min-h-11 min-w-11 rounded-lg border border-[#2d3a5c] text-gray-300 hover:bg-[#1f2b4d] hover:text-white transition-colors"
        >
          <Pencil size={16} aria-hidden="true" />
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
  const Icon = CATEGORY_ICONS[categoryId] || Settings2

  return (
    <div className="card p-0 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="w-full min-h-11 flex items-center gap-3 px-3 py-2 hover:bg-[#1a1a2e] transition-colors text-left"
      >
        <Icon size={18} className="shrink-0 text-gray-400" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm truncate">{categoryLabel(categoryId, categoryInfo)}</h3>
          <span className="text-xs text-gray-400">
            {automations.length} automation{automations.length !== 1 ? 's' : ''}
            {selectable && selectedCount > 0 && `, ${selectedCount} selected`}
          </span>
        </div>
        <span className={`text-xs shrink-0 ${activeCount > 0 ? 'text-green-400' : 'text-gray-500'}`}>
          {activeCount}/{automations.length} on
        </span>
        {expanded
          ? <ChevronDown size={16} className="shrink-0 text-gray-400" aria-hidden="true" />
          : <ChevronRight size={16} className="shrink-0 text-gray-400" aria-hidden="true" />}
      </button>
      {expanded && (
        <div className="border-t border-[#2d3a5c] p-2 sm:p-3 space-y-2">
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
  const Icon = templateIcon(template)

  return (
    <button
      type="button"
      onClick={() => hasAvailableTents && onApply(template)}
      disabled={!hasAvailableTents}
      className={`p-3 rounded-lg text-left transition-colors border border-[#2d3a5c] ${
        hasAvailableTents
          ? 'bg-[#1a1a2e] hover:bg-[#1f2b4d] cursor-pointer'
          : 'bg-[#1a1a2e]/50 opacity-50 cursor-not-allowed'
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <Icon size={18} className="shrink-0 text-gray-400" aria-hidden="true" />
        <span className="font-medium text-sm">{template.name}</span>
      </div>
      <p className="text-xs text-gray-400">{template.description}</p>
      {!hasAvailableTents && (
        <p className="text-xs text-amber-400 mt-2">No tent has the required sensors and equipment</p>
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
    <Disclosure
      icon={Layers}
      label={`${allSuggestions.length} more automation${allSuggestions.length !== 1 ? 's' : ''} available with extra equipment`}
      open={expanded}
      onToggle={() => setExpanded(!expanded)}
    >
      <div className="space-y-2">
        {allSuggestions.slice(0, 6).map((s, i) => {
          const Icon = s.type === 'sensor' ? sensorIcon(s.slot) : actuatorIcon(s.slot)
          return (
            <div key={`${s.tentId}-${s.slot}-${i}`} className="p-2 rounded-lg bg-[#1a1a2e]">
              <div className="flex items-center gap-3">
                <Icon size={18} className="shrink-0 text-gray-400" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{s.label} <span className="text-gray-400 font-normal">for {s.tentName}</span></div>
                  <div className="text-xs text-gray-400">{s.description}</div>
                </div>
                <a
                  href="#/settings"
                  className="btn btn-sm min-h-11 inline-flex items-center border border-[#2d3a5c] text-gray-200 hover:bg-[#1f2b4d] shrink-0"
                >
                  Settings
                </a>
              </div>
              <div className="flex flex-wrap gap-1 mt-2">
                <span className="text-xs text-gray-500">Enables</span>
                {s.enables.map(t => (
                  <span key={t.id} className="px-2 py-0.5 rounded bg-[#2d3a5c] text-xs">
                    {t.name}
                  </span>
                ))}
              </div>
            </div>
          )
        })}
        {allSuggestions.length > 6 && (
          <div className="text-xs text-center text-gray-400">
            {allSuggestions.length - 6} more
          </div>
        )}
      </div>
    </Disclosure>
  )
}

// Bundle card
function BundleCard({ bundle, onApply }) {
  const hasAvailableTents = bundle.available_tents?.length > 0
  const Icon = BUNDLE_ICONS[bundle.id] || Layers

  return (
    <button
      type="button"
      onClick={() => hasAvailableTents && onApply(bundle)}
      disabled={!hasAvailableTents}
      className={`p-3 rounded-lg text-left transition-colors border border-[#2d3a5c] ${
        hasAvailableTents
          ? 'bg-[#1a1a2e] hover:bg-[#1f2b4d] cursor-pointer'
          : 'bg-[#1a1a2e]/50 opacity-50 cursor-not-allowed'
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <Icon size={18} className="shrink-0 text-gray-400" aria-hidden="true" />
        <div className="min-w-0">
          <div className="font-semibold text-sm">{bundle.name}</div>
          <div className="text-xs text-gray-400">{bundle.templates.length} automations</div>
        </div>
      </div>
      <p className="text-xs text-gray-400">{bundle.description}</p>
      {!hasAvailableTents && (
        <p className="text-xs text-amber-400 mt-2">No tent has all the required equipment</p>
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
  const Icon = type === 'bundle' ? (BUNDLE_ICONS[item.id] || Layers) : templateIcon(item)

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
      <div className="bg-[#16213e] border border-[#2d3a5c] rounded-xl p-4 sm:p-6 max-w-md w-full space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-semibold flex items-center gap-2 min-w-0">
            <Icon size={20} className="shrink-0 text-gray-400" aria-hidden="true" />
            <span className="truncate">{item.name}</span>
          </h3>
          <IconButton icon={X} label="Close" onClick={onCancel} />
        </div>

        <p className="text-sm text-gray-400">{item.description}</p>

        <div>
          <label className="text-xs text-gray-400 block mb-1">Tent</label>
          <select
            value={tentId}
            onChange={e => setTentId(e.target.value)}
            className="input w-full min-h-11"
          >
            {item.available_tents?.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>

        {type === 'template' && item.trigger_type === 'numeric_state' && (
          <div>
            <label className="text-xs text-gray-400 block mb-1">
              Threshold ({item.sensor_type === 'temperature' ? '°C' : item.sensor_type === 'vpd' ? 'kPa' : '%'})
            </label>
            <input
              type="number"
              step="0.1"
              value={threshold}
              onChange={e => setThreshold(e.target.value)}
              className="input w-full min-h-11"
              placeholder={String(item.above || item.below)}
            />
          </div>
        )}

        {type === 'template' && item.trigger_type === 'time' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400 block mb-1">Turn on</label>
              <input
                type="time"
                value={timeOn}
                onChange={e => setTimeOn(e.target.value)}
                className="input w-full min-h-11"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Turn off</label>
              <input
                type="time"
                value={timeOff}
                onChange={e => setTimeOff(e.target.value)}
                className="input w-full min-h-11"
              />
            </div>
          </div>
        )}

        {type === 'bundle' && (
          <div className="text-sm text-gray-400">
            Creates {item.templates.length} automations:
            <ul className="list-disc list-inside mt-1">
              {item.templates.map(t => <li key={t}>{t.replace(/_/g, ' ')}</li>)}
            </ul>
          </div>
        )}

        <div className="flex gap-2 pt-4 border-t border-[#2d3a5c]">
          <button
            type="button"
            onClick={handleApply}
            disabled={loading}
            className="btn btn-primary flex-1 min-h-11"
          >
            {loading ? 'Creating...' : type === 'bundle' ? 'Create all' : 'Create'}
          </button>
          <button type="button" onClick={onCancel} className="btn min-h-11 border border-[#2d3a5c]">Cancel</button>
        </div>
      </div>
    </div>
  )
}

// Bulk actions bar
function BulkActionsBar({ selectedCount, onEnable, onDisable, onTrigger, onClear }) {
  if (selectedCount === 0) return null

  return (
    <div className="sticky bottom-4 mx-auto w-fit max-w-full bg-[#16213e] rounded-lg shadow-lg border border-[#2d3a5c] p-2 flex items-center gap-2 flex-wrap">
      <span className="text-sm px-1">{selectedCount} selected</span>
      <button type="button" onClick={onEnable} className="btn btn-primary btn-sm min-h-11">
        Enable
      </button>
      <button type="button" onClick={onDisable} className="btn btn-sm min-h-11 border border-[#2d3a5c] hover:bg-[#1f2b4d]">
        Disable
      </button>
      <button type="button" onClick={onTrigger} className="btn btn-sm min-h-11 border border-[#2d3a5c] hover:bg-[#1f2b4d]">
        Run
      </button>
      <IconButton icon={X} label="Clear selection" onClick={onClear} />
    </div>
  )
}

const TABS = [
  { id: 'automations', label: 'Automations' },
  { id: 'create', label: 'Create' },
  { id: 'history', label: 'History' },
  { id: 'chains', label: 'Chains' },
]

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
  // The page was hardwired to the first tent, so the others' automations were
  // only reachable from their own detail page.
  const [selectedTentId, setSelectedTentId] = useState(null)

  // Use preloaded data immediately if available
  useEffect(() => {
    if (preloaded.automations && !showAllAutomations && !selectedTentId) {
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

  const activeTentId = tents.find(t => t.id === selectedTentId)?.id || tents[0]?.id || null

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
  }, [showAllAutomations, selectedTentId])

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
        const chosen = tentsList.find(t => t.id === selectedTentId) || tentsList[0]
        autoParams.set('tent_id', chosen.id)
      }

      // Use preloaded automations if available and not forcing refresh
      const isDefaultTent = !selectedTentId || selectedTentId === tentsList[0]?.id
      const usePreloadedAuto =
        preloaded.automations && !showAllAutomations && !forceRefresh && isDefaultTent

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
      setSuccess('Automation triggered')
      setTimeout(() => setSuccess(null), 3000)
    } catch (e) {
      setError('Failed to trigger automation')
      setTimeout(() => setError(null), 3000)
    }
  }

  const handleToggle = async (entityId) => {
    try {
      await apiFetch(`api/automations/${encodeURIComponent(entityId)}/toggle`, { method: 'POST' })
      loadData(true)
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
      loadData(true)
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
      loadData(true)
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
      loadData(true)
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
      loadData(true)
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

  const historyItems = automations
    .filter(a => a.attributes?.last_triggered)
    .sort((a, b) => (b.attributes?.last_triggered || '').localeCompare(a.attributes?.last_triggered || ''))
    .slice(0, 20)

  return (
    <div className="space-y-4 pb-20">
      {/* Header: title and tent select on one row; the count only on sm and up */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold leading-tight">Automations</h2>
          <p className="hidden sm:block text-xs text-gray-400">
            {totalCount} {showAllAutomations ? 'Home Assistant' : 'tent'} automation{totalCount !== 1 ? 's' : ''}
          </p>
        </div>
        {!showAllAutomations && tents.length > 1 && (
          <select
            className="input min-h-11 max-w-[50%] shrink-0"
            value={activeTentId || ''}
            onChange={e => setSelectedTentId(e.target.value)}
            aria-label="Tent"
          >
            {tents.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* Tabs */}
      <div className="app-scroll-strip flex border-b border-[#2d3a5c]" role="tablist">
        {TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`shrink-0 whitespace-nowrap min-h-11 px-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab.id ? 'border-green-500 text-white' : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-300 text-sm flex items-center justify-between gap-2">
          <span className="min-w-0">{error}</span>
          <IconButton icon={X} label="Dismiss error" onClick={() => setError(null)} className="border-transparent text-red-300" />
        </div>
      )}

      {success && (
        <div className="p-3 bg-green-500/20 border border-green-500/50 rounded-lg text-green-300 text-sm">
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

          {/* Search, filter and view toggle */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" aria-hidden="true" />
              <input
                type="search"
                placeholder="Search"
                aria-label="Search automations"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="input w-full min-h-11"
                style={{ paddingLeft: '2.25rem' }}
              />
            </div>
            <div className="flex items-center gap-2 min-w-0">
              {tents.length > 0 && (
                <Segmented
                  value={showAllAutomations ? 'all' : 'tent'}
                  onChange={v => setShowAllAutomations(v === 'all')}
                  className="flex-1 sm:flex-none min-w-0"
                  options={[
                    { value: 'tent', label: 'My tent', title: 'Automations that use this tent' },
                    { value: 'all', label: 'All HA', title: 'Every Home Assistant automation' },
                  ]}
                />
              )}
              <Segmented
                value={viewMode}
                onChange={setViewMode}
                className="flex-1 sm:flex-none min-w-0"
                options={[
                  { value: 'categories', label: 'By type' },
                  { value: 'list', label: 'List' },
                ]}
              />
              <IconButton
                icon={ListChecks}
                label={selectMode ? 'Cancel selection' : 'Select automations'}
                active={selectMode}
                onClick={() => { setSelectMode(!selectMode); setSelectedIds(new Set()) }}
              />
              <a
                href="/config/automation/dashboard"
                target="_top"
                aria-label="Open automations in Home Assistant"
                title="Open automations in Home Assistant"
                className="inline-flex items-center justify-center min-h-11 min-w-11 rounded-lg border border-[#2d3a5c] text-gray-300 hover:bg-[#1f2b4d] hover:text-white transition-colors shrink-0"
              >
                <ExternalLink size={16} aria-hidden="true" />
              </a>
            </div>
          </div>

          {/* Category View */}
          {viewMode === 'categories' && (
            <div className="space-y-3">
              {Object.entries(filteredByCategory).length === 0 ? (
                <EmptyState icon={Search} text="No automations found" />
              ) : (
                Object.entries(filteredByCategory).map(([catId, autos]) => (
                  <CategoryGroup
                    key={catId}
                    categoryId={catId}
                    categoryInfo={categories[catId]}
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
                <EmptyState icon={Search} text="No automations found" />
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
            <h3 className="text-base font-semibold mb-1">Preset bundles</h3>
            <p className="text-xs text-gray-400 mb-3">Several automations for one tent in one step</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
            <h3 className="text-base font-semibold mb-1">Templates</h3>
            <p className="text-xs text-gray-400 mb-3">One automation from a template</p>
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
        <div className="space-y-3">
          <p className="text-xs text-gray-400">Most recent runs first</p>
          <div className="space-y-2">
            {historyItems.map(auto => (
              <div key={auto.entity_id} className="flex items-center gap-3 p-2 sm:p-3 rounded-lg bg-[#1a1a2e]">
                <div className={`w-2 h-2 rounded-full shrink-0 ${auto.state === 'on' ? 'bg-green-500' : 'bg-gray-500'}`} aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">
                    {auto.attributes?.friendly_name || auto.entity_id}
                  </div>
                  <div className="text-xs text-gray-400">
                    {new Date(auto.attributes.last_triggered).toLocaleString()}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleTrigger(auto.entity_id)}
                  className="inline-flex items-center gap-1.5 min-h-11 px-3 rounded-lg border border-[#2d3a5c] text-xs text-gray-200 hover:bg-[#1f2b4d] shrink-0"
                >
                  <Play size={14} aria-hidden="true" />
                  Run again
                </button>
              </div>
            ))}
            {historyItems.length === 0 && (
              <EmptyState icon={ScrollText} text="No automation has run yet" />
            )}
          </div>
        </div>
      )}

      {/* Chains Tab */}
      {activeTab === 'chains' && (
        <AutomationChains />
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
