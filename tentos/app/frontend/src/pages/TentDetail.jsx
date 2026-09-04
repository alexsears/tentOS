import { useParams, Link, useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Droplet,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Trash2,
  TriangleAlert,
  Workflow,
} from 'lucide-react'
import { useTent, useTents } from '../hooks/useTents'
import { SensorChart } from '../components/SensorChart'
import { LightShadeToggle } from '../components/LightShadeToggle'
import { EventLog } from '../components/EventLog'
import { CameraFeed, CameraGrid } from '../components/CameraFeed'
import { AutomationEditor } from '../components/AutomationEditor'
import { LightCycleCard } from '../components/LightCycleCard'
import { TargetsEditor } from '../components/TargetsEditor'
import { HistoryIcon } from '../components/HistoryIcon'
import { useTemperatureUnit } from '../hooks/useTemperatureUnit'
import { apiFetch, requireOk } from '../utils/api'
import { sensorEntities, entityHistoryPath, tentHistoryPath } from '../utils/history'
import { finiteNumberOrNull } from '../utils/numbers'
import { actuatorIcon, actuatorBaseType, sensorIcon, stageIcon } from '../utils/icons'

const TAB_LABELS = {
  overview: 'Overview',
  cameras: 'Cameras',
  charts: 'Charts',
  automations: 'Automations',
  events: 'Events',
  settings: 'Settings',
}

// The order controls are listed in when the tent has no custom order saved.
const DEFAULT_CONTROL_ORDER = [
  'light', 'light_2', 'light_3',
  'exhaust_fan', 'exhaust_fan_2', 'exhaust_fan_3',
  'circulation_fan', 'circulation_fan_2', 'circulation_fan_3',
  'humidifier', 'dehumidifier', 'heater', 'ac',
  'water_pump', 'water_pump_2', 'water_pump_3',
  'drain_pump',
]

const CONTROL_LABELS = {
  light: 'Light',
  exhaust_fan: 'Exhaust fan',
  circulation_fan: 'Circulation fan',
  humidifier: 'Humidifier',
  dehumidifier: 'Dehumidifier',
  heater: 'Heater',
  ac: 'A/C',
  water_pump: 'Water pump',
  drain_pump: 'Drain pump',
}

function defaultControlLabel(slot) {
  const base = actuatorBaseType(slot)
  const name = CONTROL_LABELS[base] || slot.replace(/_/g, ' ')
  const numbered = slot.match(/_(\d+)$/)
  return numbered && base !== slot ? `${name} ${numbered[1]}` : name
}

function stateLabel(state) {
  if (state === 'on') return 'On'
  if (state === 'off') return 'Off'
  return 'Unavailable'
}

function titleCase(value) {
  if (!value) return ''
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export default function TentDetail() {
  const { tentId } = useParams()
  const navigate = useNavigate()
  const { tent, loading, error } = useTent(tentId)
  const { performAction } = useTents()
  const { formatTemp, getTempUnit } = useTemperatureUnit()
  const [activeTab, setActiveTab] = useState('overview')
  const [chartRange, setChartRange] = useState('24h')
  const [actionLoading, setActionLoading] = useState(null)
  const [pendingSlot, setPendingSlot] = useState(null)
  const [haAutomations, setHaAutomations] = useState([])
  const [automationsLoading, setAutomationsLoading] = useState(false)
  const [showAllAutomations, setShowAllAutomations] = useState(false)
  const [editingAutomation, setEditingAutomation] = useState(null)
  const [showCreateModal, setShowCreateModal] = useState(false)

  // Fetch HA automations for this tent
  const fetchAutomations = async () => {
    setAutomationsLoading(true)
    try {
      const url = showAllAutomations
        ? `api/automations?show_all=true`
        : `api/automations?show_all=false&tent_id=${tentId}`
      const res = await apiFetch(url)
      await requireOk(res, 'Failed to load automations')
      const data = await res.json()
      setHaAutomations(data.automations || [])
    } catch (e) {
      console.error(e)
    } finally {
      setAutomationsLoading(false)
    }
  }

  useEffect(() => {
    if (activeTab === 'automations' && tentId) {
      fetchAutomations()
    }
  }, [activeTab, tentId, showAllAutomations])

  const handleAction = async (action, params = {}) => {
    setActionLoading(action)
    try {
      await performAction(tentId, action, params)
    } catch (e) {
      console.error(e)
    } finally {
      setActionLoading(null)
    }
  }

  // One switch per actuator: it calls the same turn_on / turn_off action the
  // old button pair did, and remembers which row is waiting on HA.
  const toggleActuator = async (slot, isOn) => {
    setPendingSlot(slot)
    try {
      await handleAction(isOn ? 'turn_off' : 'turn_on', { entity_type: slot })
    } finally {
      setPendingSlot(null)
    }
  }

  if (loading) {
    return <div className="text-gray-400 text-center py-8">Loading...</div>
  }

  if (error || !tent) {
    return (
      <div className="card border-red-500/50">
        <div className="text-red-400">Error: {error || 'Tent not found'}</div>
        <Link to="/" className="btn btn-secondary mt-4 inline-flex min-h-[44px] items-center gap-1">
          <ChevronLeft size={18} />
          Back to dashboard
        </Link>
      </div>
    )
  }

  // Any reading is a link to its own graph on the Reports tab.
  const goToHistory = (path) => {
    if (path) navigate(path)
  }

  const renderReadingTile = ({ key, type, label, value, historyPath, valueClass = '', icon }) => {
    const Icon = icon || sensorIcon(type)
    const Tag = historyPath ? 'button' : 'div'
    return (
      <Tag
        key={key}
        type={historyPath ? 'button' : undefined}
        onClick={historyPath ? () => goToHistory(historyPath) : undefined}
        title={historyPath ? `${label} history` : undefined}
        className={`card flex min-h-[72px] flex-col justify-between text-left ${
          historyPath ? 'hover:border-green-600/50 transition-colors' : ''
        }`}
      >
        <div className="flex items-center gap-1.5 text-xs text-gray-400">
          <Icon size={14} className="shrink-0" aria-hidden="true" />
          <span className="truncate">{label}</span>
          {historyPath && <HistoryIcon className="opacity-50 shrink-0" />}
        </div>
        <div className={`mt-1 text-2xl font-semibold leading-tight ${valueClass}`}>
          {value ?? '--'}
        </div>
      </Tag>
    )
  }

  const getSensorTile = (type, label, unit = '', isTemp = false) => {
    const sensor = tent.sensors?.[type]
    const value = finiteNumberOrNull(sensor?.value)
    const displayValue = isTemp && value != null ? formatTemp(value, 1) : (value != null ? value.toFixed(1) : null)
    const displayUnit = isTemp ? getTempUnit() : unit
    const historyPath = type === 'vpd'
      ? tentHistoryPath(tentId, 'vpd')
      : entityHistoryPath(sensorEntities(sensor))
    return renderReadingTile({
      key: type,
      type,
      label,
      value: displayValue != null ? `${displayValue}${displayUnit}` : null,
      historyPath,
    })
  }

  // Get configured cameras from sensor config
  const getCameras = () => {
    const cameras = tent.sensors?.camera
    if (!cameras) return []
    if (Array.isArray(cameras)) {
      return cameras.map(c => typeof c === 'string' ? c : c?.entity_id).filter(Boolean)
    }
    if (typeof cameras === 'string') return [cameras]
    if (cameras._entities) {
      return Object.keys(cameras._entities)
    }
    return []
  }

  const cameras = getCameras()
  const displayVpd = finiteNumberOrNull(tent.vpd)
  const envScore = tent.environment_score
  const envScoreClass = envScore >= 80 ? 'text-green-400' : envScore >= 60 ? 'text-yellow-400' : 'text-red-400'

  const growthStage = tent.growth_stage || {}
  const StageIcon = stageIcon(growthStage.stage)
  const stageText = growthStage.stage
    ? (growthStage.stage === 'flower' && growthStage.flower_week
      ? `Flower week ${growthStage.flower_week}`
      : titleCase(growthStage.stage))
    : null

  // Controls: every mapped actuator, in the saved order if there is one.
  const getControlSlots = () => {
    const present = Object.keys(tent.actuators || {}).filter(slot => tent.actuators[slot])
    const customOrder = Array.isArray(tent.control_settings?.order) ? tent.control_settings.order : []
    const ordered = []
    for (const slot of [...customOrder, ...DEFAULT_CONTROL_ORDER, ...present]) {
      if (present.includes(slot) && !ordered.includes(slot)) ordered.push(slot)
    }
    return ordered
  }
  const controlSlots = getControlSlots()
  const controlLabel = (slot) => tent.control_settings?.labels?.[slot] || defaultControlLabel(slot)

  const renderActuatorRow = (slot) => {
    const actuator = tent.actuators?.[slot]
    const state = actuator?.state || 'unknown'
    const isOn = state === 'on'
    const unavailable = state !== 'on' && state !== 'off'
    const pending = pendingSlot === slot
    const historyPath = entityHistoryPath(actuator?.entity_id)
    const label = controlLabel(slot)
    const Icon = actuatorIcon(slot)
    return (
      <div key={slot} className="flex min-h-[44px] items-center gap-3">
        <div
          className={`flex min-w-0 flex-1 items-center gap-3 ${historyPath ? 'cursor-pointer' : ''}`}
          onClick={() => goToHistory(historyPath)}
          title={historyPath ? `${label} history` : undefined}
        >
          <Icon size={20} className={`shrink-0 ${isOn ? 'text-green-400' : 'text-gray-500'}`} aria-hidden="true" />
          <div className="min-w-0">
            <div className="truncate font-medium">
              {label}
              {historyPath && <HistoryIcon className="ml-1 opacity-50" />}
            </div>
            <div className={`text-xs ${isOn ? 'text-green-400' : 'text-gray-400'}`}>
              {stateLabel(state)}
            </div>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={isOn}
          aria-label={`${label} ${isOn ? 'on' : 'off'}`}
          disabled={pending}
          onClick={() => toggleActuator(slot, isOn)}
          className={`flex h-11 w-14 shrink-0 items-center justify-center ${
            pending || unavailable ? 'opacity-50' : ''
          } ${pending ? 'cursor-wait' : ''}`}
        >
          <span
            className={`relative inline-block h-6 w-11 rounded-full transition-colors ${
              isOn ? 'bg-green-500' : 'bg-gray-600'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                isOn ? 'translate-x-5' : ''
              }`}
            />
          </span>
        </button>
      </div>
    )
  }

  const renderClimateRow = () => {
    const state = tent.actuators.ac?.state || 'unknown'
    const active = state !== 'off' && state !== 'unknown' && state !== 'unavailable'
    const Icon = actuatorIcon('ac')
    return (
      <button
        key="ac"
        type="button"
        onClick={() => navigate('/climate')}
        className="flex min-h-[44px] w-full items-center gap-3 text-left"
      >
        <Icon size={20} className={`shrink-0 ${active ? 'text-cyan-400' : 'text-gray-500'}`} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{controlLabel('ac')}</div>
          <div className={`text-xs ${active ? 'text-cyan-400' : 'text-gray-400'}`}>
            {titleCase(state)}
          </div>
        </div>
        <span className="flex h-11 w-11 shrink-0 items-center justify-center text-gray-400">
          <ChevronRight size={20} aria-hidden="true" />
        </span>
      </button>
    )
  }

  const tabs = ['overview', ...(cameras.length > 0 ? ['cameras'] : []), 'charts', 'automations', 'events', 'settings']

  return (
    <div>
      {/* Header */}
      <div className="mb-3 flex items-center gap-1">
        <Link
          to="/"
          aria-label="Back to dashboard"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:text-white"
        >
          <ChevronLeft size={24} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-xl font-bold md:text-2xl">{tent.name}</h2>
            {stageText && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[#2d3a5c] px-2 py-0.5 text-xs text-gray-300">
                <StageIcon size={12} aria-hidden="true" />
                {stageText}
              </span>
            )}
          </div>
          {tent.description && <p className="truncate text-sm text-gray-400">{tent.description}</p>}
        </div>
      </div>

      {/* Tabs */}
      <div className="app-scroll-strip mb-5">
        <div className="flex min-w-max gap-1 border-b border-[#2d3a5c]" role="tablist">
          {tabs.map(tab => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => setActiveTab(tab)}
              className={`min-h-[44px] shrink-0 whitespace-nowrap border-b-2 px-3 text-sm font-medium ${
                activeTab === tab
                  ? 'border-green-500 text-white'
                  : 'border-transparent text-gray-400 hover:text-white'
              }`}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Alerts */}
          {tent.alerts?.length > 0 && (
            <div className="space-y-1">
              {tent.alerts.map((alert, i) => (
                <div
                  key={i}
                  className={`flex min-h-[44px] items-center gap-2 rounded-lg border px-3 text-sm ${
                    alert.severity === 'critical'
                      ? 'border-red-500/50 text-red-300'
                      : 'border-yellow-500/50 text-yellow-300'
                  }`}
                >
                  <TriangleAlert size={16} className="shrink-0" aria-hidden="true" />
                  <span className="min-w-0 flex-1">{alert.message}</span>
                </div>
              ))}
            </div>
          )}

          {/* Environment */}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-gray-300">Environment</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {getSensorTile('temperature', 'Temperature', '', true)}
              {getSensorTile('humidity', 'Humidity', '%')}
              {renderReadingTile({
                key: 'vpd',
                type: 'vpd',
                label: 'VPD (kPa)',
                value: displayVpd != null ? displayVpd.toFixed(1) : null,
                historyPath: tentHistoryPath(tentId, 'vpd'),
              })}
              {tent.sensors?.co2 && getSensorTile('co2', 'CO2', ' ppm')}
              {tent.sensors?.reservoir_level && getSensorTile('reservoir_level', 'Reservoir', '%')}
              {tent.sensors?.power_usage && getSensorTile('power_usage', 'Power', ' W')}
              {renderReadingTile({
                key: 'score',
                type: 'score',
                icon: Activity,
                label: 'Env score',
                value: envScore || null,
                valueClass: envScore ? envScoreClass : '',
              })}
            </div>
          </div>

          {/* Controls */}
          {controlSlots.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-gray-300">Controls</h3>
              <div className="card divide-y divide-[#2d3a5c] py-1">
                {controlSlots.map(slot => (
                  <div key={slot} className="py-1">
                    {slot === 'ac' ? renderClimateRow() : renderActuatorRow(slot)}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Camera */}
          {cameras.length > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-300">Camera{cameras.length > 1 ? 's' : ''}</h3>
                {cameras.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('cameras')}
                    className="inline-flex min-h-[44px] items-center gap-0.5 text-sm text-green-400 hover:text-green-300"
                  >
                    All cameras
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                )}
              </div>
              {/* Show first camera only on overview */}
              <div className="w-full lg:max-w-3xl">
                <CameraFeed
                  tentId={tentId}
                  entityId={cameras[0]}
                  defaultMode="snapshot"
                  refreshInterval={10000}
                />
              </div>
            </div>
          )}

          {/* Quick actions */}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-gray-300">Quick actions</h3>
            <div className="flex flex-wrap gap-3">
              {/* Only offered when a pump is mapped; without one the action 400s */}
              {tent.actuators?.water_pump && (
                <button
                  type="button"
                  onClick={() => handleAction('run_watering', { duration_minutes: 1 })}
                  disabled={actionLoading}
                  className="btn btn-primary inline-flex min-h-[44px] items-center gap-2"
                >
                  <Droplet size={16} aria-hidden="true" />
                  Run watering (1 min)
                </button>
              )}
              <button
                type="button"
                onClick={() => handleAction('clear_overrides')}
                disabled={actionLoading}
                className="btn btn-secondary inline-flex min-h-[44px] items-center gap-2"
              >
                <RotateCcw size={16} aria-hidden="true" />
                Clear overrides
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cameras Tab */}
      {activeTab === 'cameras' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-300">Cameras ({cameras.length})</h3>
          </div>
          <CameraGrid tentId={tentId} cameras={cameras} />
        </div>
      )}

      {/* Charts Tab */}
      {activeTab === 'charts' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between gap-2">
            {Object.keys(tent.actuators || {}).some(slot => slot === 'light' || slot.startsWith('light_'))
              ? <LightShadeToggle />
              : <span />}
            <div className="flex gap-2">
              {['24h', '7d', '30d'].map(range => (
                <button
                  key={range}
                  type="button"
                  onClick={() => setChartRange(range)}
                  className={`btn btn-sm min-h-[44px] ${chartRange === range ? 'btn-primary' : 'btn-secondary'}`}
                >
                  {range}
                </button>
              ))}
            </div>
          </div>

          <div className="card">
            <h3 className="mb-4 text-sm font-semibold text-gray-300">Temperature and humidity</h3>
            <SensorChart
              tentId={tentId}
              sensors={['temperature', 'humidity']}
              range={chartRange}
            />
          </div>

          <div className="card">
            <h3 className="mb-4 text-sm font-semibold text-gray-300">VPD</h3>
            <SensorChart
              tentId={tentId}
              sensors={['vpd']}
              range={chartRange}
            />
          </div>
        </div>
      )}

      {/* Automations Tab */}
      {activeTab === 'automations' && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-gray-300">Home Assistant automations</h3>
            <div className="flex items-center gap-3">
              <label className="flex min-h-[44px] items-center gap-2 text-sm text-gray-400">
                <input
                  type="checkbox"
                  checked={showAllAutomations}
                  onChange={e => setShowAllAutomations(e.target.checked)}
                  className="rounded"
                />
                Show all
              </label>
              <button
                type="button"
                onClick={() => setShowCreateModal(true)}
                className="btn btn-primary inline-flex min-h-[44px] items-center gap-1.5"
              >
                <Plus size={16} aria-hidden="true" />
                New automation
              </button>
            </div>
          </div>

          {automationsLoading ? (
            <div className="text-center text-gray-400 py-8">Loading automations...</div>
          ) : haAutomations.length === 0 ? (
            <div className="card flex flex-col items-center py-8 text-center">
              <Workflow size={32} className="mb-3 text-gray-500" aria-hidden="true" />
              <div className="mb-4 text-gray-400">No automations for this tent</div>
              <button
                type="button"
                onClick={() => setShowCreateModal(true)}
                className="btn btn-primary min-h-[44px]"
              >
                Create automation
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {haAutomations.map(auto => {
                const isEnabled = auto.state === 'on'
                const lastTriggered = auto.attributes?.last_triggered
                const friendlyName = auto.attributes?.friendly_name || auto.entity_id
                const running = actionLoading === auto.entity_id
                const toggling = actionLoading === `toggle-${auto.entity_id}`

                return (
                  <div key={auto.entity_id} className="card hover:border-green-600/30 transition-colors">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <Workflow
                          size={20}
                          className={`shrink-0 ${isEnabled ? 'text-green-400' : 'text-gray-500'}`}
                          aria-hidden="true"
                        />
                        <div className="min-w-0">
                          <div className="font-medium truncate">{friendlyName}</div>
                          <div className="text-xs text-gray-500 truncate">{auto.entity_id}</div>
                          {lastTriggered && (
                            <div className="text-xs text-gray-400 mt-1">
                              Last triggered: {new Date(lastTriggered).toLocaleString()}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                        <div className={`px-2 py-1 rounded text-xs ${
                          isEnabled ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'
                        }`}>
                          {isEnabled ? 'On' : 'Off'}
                        </div>
                        <button
                          type="button"
                          onClick={async () => {
                            setActionLoading(auto.entity_id)
                            try {
                              const response = await apiFetch(`api/automations/${auto.entity_id}/trigger`, { method: 'POST' })
                              await requireOk(response, 'Failed to trigger automation')
                              fetchAutomations()
                            } catch (e) {
                              console.error('Failed to trigger:', e)
                            } finally {
                              setActionLoading(null)
                            }
                          }}
                          disabled={running}
                          className="btn btn-sm inline-flex min-h-[44px] items-center gap-1.5 border border-[#2d3a5c] text-gray-200 hover:bg-[#1f2b4d]"
                        >
                          <Play size={14} aria-hidden="true" />
                          {running ? '...' : 'Run'}
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            setActionLoading(`toggle-${auto.entity_id}`)
                            try {
                              const response = await apiFetch(`api/automations/${auto.entity_id}/toggle`, { method: 'POST' })
                              await requireOk(response, 'Failed to toggle automation')
                              fetchAutomations()
                            } catch (e) {
                              console.error('Failed to toggle:', e)
                            } finally {
                              setActionLoading(null)
                            }
                          }}
                          disabled={toggling}
                          className={`btn btn-sm inline-flex min-h-[44px] items-center gap-1.5 ${
                            isEnabled
                              ? 'border border-[#2d3a5c] text-gray-200 hover:bg-[#1f2b4d]'
                              : 'btn-primary'
                          }`}
                        >
                          {isEnabled
                            ? <Pause size={14} aria-hidden="true" />
                            : <Play size={14} aria-hidden="true" />}
                          {toggling ? '...' : (isEnabled ? 'Disable' : 'Enable')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingAutomation(auto)}
                          className="btn btn-sm inline-flex min-h-[44px] items-center gap-1.5 border border-[#2d3a5c] text-gray-200 hover:bg-[#1f2b4d]"
                        >
                          <Pencil size={14} aria-hidden="true" />
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            if (confirm(`Delete "${friendlyName}"?`)) {
                              try {
                                const response = await apiFetch(`api/automations/${auto.entity_id}`, { method: 'DELETE' })
                                await requireOk(response, 'Failed to delete automation')
                                fetchAutomations()
                              } catch (e) {
                                console.error('Failed to delete:', e)
                              }
                            }
                          }}
                          className="btn btn-sm inline-flex min-h-[44px] items-center gap-1.5 text-red-400 hover:bg-red-500/20"
                        >
                          <Trash2 size={14} aria-hidden="true" />
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Create Automation Modal */}
      {showCreateModal && (
        <AutomationEditor
          tent={tent}
          onClose={() => setShowCreateModal(false)}
          onSave={() => {
            setShowCreateModal(false)
            fetchAutomations()
          }}
        />
      )}

      {/* Edit Automation Modal */}
      {editingAutomation && (
        <AutomationEditor
          tent={tent}
          automation={editingAutomation}
          onClose={() => setEditingAutomation(null)}
          onSave={() => {
            setEditingAutomation(null)
            fetchAutomations()
          }}
        />
      )}

      {/* Events Tab */}
      {activeTab === 'events' && (
        <div className="card">
          <EventLog tentId={tentId} limit={20} />
        </div>
      )}

      {/* Settings Tab */}
      {activeTab === 'settings' && (
        <div className="space-y-6">
          <LightCycleCard tent={tent} />

          <TargetsEditor tentId={tentId} targets={tent.targets} />

          <div className="card">
            <h3 className="mb-4 text-sm font-semibold text-gray-300">Schedules</h3>
            <div className="grid gap-4 text-sm md:grid-cols-2">
              <div>
                <span className="text-gray-400">Photoperiod on:</span>{' '}
                {tent.schedules?.photoperiod_on || 'Not set'}
              </div>
              <div>
                <span className="text-gray-400">Photoperiod off:</span>{' '}
                {tent.schedules?.photoperiod_off || 'Not set'}
              </div>
              <div>
                <span className="text-gray-400">Quiet hours:</span>{' '}
                {tent.schedules?.quiet_hours_start && tent.schedules?.quiet_hours_end
                  ? `${tent.schedules.quiet_hours_start} to ${tent.schedules.quiet_hours_end}`
                  : 'Not set'}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
