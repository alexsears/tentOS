import { Link, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  ExternalLink,
  ListOrdered,
  LoaderCircle,
  Pencil,
  RefreshCw,
  TriangleAlert,
  X,
} from 'lucide-react'
import { useTemperatureUnit } from '../hooks/useTemperatureUnit'
import { apiFetch } from '../utils/api'
import { sensorEntities, entityHistoryPath, tentHistoryPath } from '../utils/history'
import { finiteNumberOrNull } from '../utils/numbers'
import { actuatorBaseType, actuatorIcon, sensorIcon, stageIcon } from '../utils/icons'
import { HistoryIcon } from './HistoryIcon'
import { CardMenu } from './CardMenu'

// Default short labels per actuator base type. Numbered variants
// (exhaust_fan_2) get the number appended.
const ACTUATOR_LABELS = {
  light: 'Light',
  exhaust_fan: 'Exhaust',
  circulation_fan: 'Circ fan',
  humidifier: 'Humidifier',
  dehumidifier: 'Dehumidifier',
  heater: 'Heater',
  ac: 'A/C',
  water_pump: 'Water',
  drain_pump: 'Drain',
}

// Plural labels for grouped actuators
const GROUP_LABELS = {
  light: 'Lights', exhaust_fan: 'Fans', circulation_fan: 'Circ fans',
  humidifier: 'Humidifiers', dehumidifier: 'Dehumidifiers', heater: 'Heaters',
  ac: 'A/Cs', water_pump: 'Pumps', drain_pump: 'Drains'
}

const STAGE_LABELS = {
  seedling: 'Seedling',
  veg: 'Veg',
  flower: 'Flower',
}

function getActuatorLabel(slot) {
  if (ACTUATOR_LABELS[slot]) return ACTUATOR_LABELS[slot]
  const match = slot.match(/^(.+)_(\d+)$/)
  if (match && ACTUATOR_LABELS[match[1]]) return `${ACTUATOR_LABELS[match[1]]} ${match[2]}`
  return slot
}

function getGroupLabel(baseType) {
  return GROUP_LABELS[baseType] || `${getActuatorLabel(baseType)}s`
}

function isOnState(state) {
  return state === 'on' || state === 'playing' || state === 'open'
}

function isUnavailableState(state) {
  return state === 'unavailable' || state === 'unknown'
}

function groupActuatorsByType(slots) {
  const groups = []
  const seen = new Set()
  for (const slot of slots) {
    const base = actuatorBaseType(slot)
    if (seen.has(base)) {
      const group = groups.find(g => g.baseType === base)
      if (group) group.slots.push(slot)
    } else {
      seen.add(base)
      groups.push({ baseType: base, slots: [slot] })
    }
  }
  return groups
}

function relativeTime(iso, now) {
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) return null
  const diff = Math.max(0, now - at)
  const sec = Math.round(diff / 1000)
  if (sec < 45) return 'just now'
  const min = Math.round(sec / 60)
  if (min < 60) return `${min} min ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr} h ago`
  const day = Math.round(hr / 24)
  if (day < 7) return `${day} d ago`
  return new Date(at).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function HistoryButton({ path, label, className = '' }) {
  const navigate = useNavigate()
  if (!path) return null
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); navigate(path) }}
      title={label ? `${label} history` : 'History'}
      aria-label={label ? `${label} history` : 'History'}
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-[#2d3a5c] hover:text-white ${className}`}
    >
      <HistoryIcon size={16} />
    </button>
  )
}

// Compact 44px pill: icon, label, state colouring. Custom emoji icons are
// ignored on purpose; custom labels win over friendly names.
function ActuatorPill({ slot, state, pending, onToggle, onClick, customLabel, friendlyName, fill = false }) {
  const Icon = actuatorIcon(slot)
  const isOn = isOnState(state)
  const isUnavailable = isUnavailableState(state)
  const displayLabel = customLabel || friendlyName || getActuatorLabel(slot)

  return (
    <button
      type="button"
      onClick={onClick || (() => onToggle(slot))}
      disabled={pending || isUnavailable}
      aria-pressed={isOn}
      title={`${displayLabel}: ${state || 'unknown'}`}
      className={`inline-flex h-11 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs font-medium transition-colors ${
        fill ? 'min-w-0 flex-1 justify-start' : 'shrink-0'
      } ${
        isUnavailable
          ? 'cursor-not-allowed border-[#2d3a5c] bg-[#1a1a2e] text-gray-500 opacity-50'
          : isOn
            ? 'border-green-500/60 bg-green-500/10 text-green-300 hover:bg-green-500/20'
            : 'border-[#2d3a5c] bg-[#1a1a2e] text-gray-400 hover:border-gray-500 hover:text-gray-200'
      } ${pending ? 'animate-pulse' : ''}`}
    >
      <Icon size={16} className="shrink-0" aria-hidden="true" />
      <span className="truncate">{displayLabel}</span>
    </button>
  )
}

function ActuatorGroupPill({ group, getState, onClick }) {
  const Icon = actuatorIcon(group.baseType)
  const onCount = group.slots.filter(s => isOnState(getState(s))).length
  const anyOn = onCount > 0
  const label = getGroupLabel(group.baseType)

  return (
    <button
      type="button"
      onClick={onClick}
      title={`${label}: ${onCount} of ${group.slots.length} on`}
      className={`inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs font-medium transition-colors ${
        anyOn
          ? 'border-green-500/60 bg-green-500/10 text-green-300 hover:bg-green-500/20'
          : 'border-[#2d3a5c] bg-[#1a1a2e] text-gray-400 hover:border-gray-500 hover:text-gray-200'
      }`}
    >
      <Icon size={16} className="shrink-0" aria-hidden="true" />
      <span>{label}</span>
      <span className={`rounded-full px-1.5 text-xs leading-5 ${anyOn ? 'bg-green-500/20' : 'bg-white/10'}`}>
        {group.slots.length}
      </span>
    </button>
  )
}

function GroupPopup({ group, getState, checkPending, onToggle, getDisplayLabel, getActuatorName, getActuatorEntity, onClose }) {
  const Icon = actuatorIcon(group.baseType)
  const label = getGroupLabel(group.baseType)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-lg bg-[#16213e]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[#2d3a5c] py-2 pl-4 pr-2">
          <h4 className="flex items-center gap-2 font-semibold">
            <Icon size={18} className="text-gray-400" aria-hidden="true" />
            {label}
          </h4>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 items-center justify-center rounded-lg text-gray-400 hover:bg-[#2d3a5c] hover:text-white"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="space-y-2 p-4">
          {group.slots.map(slot => (
            <div key={slot} className="flex items-center gap-2">
              <ActuatorPill
                slot={slot}
                state={getState(slot)}
                pending={checkPending(slot)}
                onToggle={onToggle}
                customLabel={getDisplayLabel(slot)}
                friendlyName={getActuatorName(slot)}
                fill
              />
              <HistoryButton
                path={entityHistoryPath(getActuatorEntity?.(slot))}
                label={getDisplayLabel(slot) || getActuatorName(slot) || slot}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// Compact mode (four readings) trims the number size so a 300px-wide card
// still fits every column without clipping.
function Reading({ value, unit, label, slot, color = 'text-white', historyPath, compact = false }) {
  const navigate = useNavigate()
  const Icon = sensorIcon(slot)
  const clickable = Boolean(historyPath)
  return (
    <div
      className={`flex min-h-[44px] min-w-0 flex-col items-center justify-center overflow-hidden rounded-lg px-0.5 py-1 ${
        clickable ? 'cursor-pointer transition-colors hover:bg-[#2d3a5c]/60' : ''
      }`}
      onClick={clickable ? (e) => { e.stopPropagation(); navigate(historyPath) } : undefined}
      title={clickable ? `${label} history` : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(historyPath) } } : undefined}
    >
      <div className={`flex max-w-full items-baseline ${compact ? 'gap-0.5' : 'gap-1'}`}>
        {!compact && <Icon size={14} className="shrink-0 self-center text-gray-500" aria-hidden="true" />}
        <span className={`font-semibold leading-7 ${compact ? 'text-lg' : 'text-xl'} ${color}`}>
          {value != null ? value : '--'}
        </span>
        {value != null && unit && <span className="text-xs text-gray-400">{unit}</span>}
      </div>
      <div className="text-xs leading-4 text-gray-400">{label}</div>
    </div>
  )
}

// Flip stage confirmation modal
function FlipStageModal({ tent, currentStage, onConfirm, onCancel }) {
  const [lightOnTime, setLightOnTime] = useState('06:00')
  const [lightOffTime, setLightOffTime] = useState('18:00')
  const [createAutomation, setCreateAutomation] = useState(true)

  const isFlippingToFlower = currentStage !== 'flower'
  const TargetIcon = stageIcon(isFlippingToFlower ? 'flower' : 'veg')

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-[#16213e] rounded-lg w-full max-w-md">
        <div className="p-4 border-b border-[#2d3a5c]">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <TargetIcon size={20} className="text-gray-400" aria-hidden="true" />
            {isFlippingToFlower ? 'Flip to flower?' : 'Reset to veg?'}
          </h3>
        </div>

        <div className="p-4 space-y-4">
          {isFlippingToFlower ? (
            <>
              <p className="text-gray-300">
                This will set <strong>{tent.name}</strong> to flower stage and:
              </p>
              <ul className="text-sm text-gray-400 list-disc list-inside space-y-1">
                <li>Start tracking flower week (week 1)</li>
                <li>Adjust VPD targets for flowering</li>
                <li>Update light schedule to 12/12</li>
              </ul>

              <div className="bg-[#1a1a2e] rounded-lg p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="createAuto"
                    checked={createAutomation}
                    onChange={e => setCreateAutomation(e.target.checked)}
                    className="rounded"
                  />
                  <label htmlFor="createAuto" className="text-sm">
                    Create light schedule automation (12/12)
                  </label>
                </div>

                {createAutomation && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Lights on</label>
                      <input
                        type="time"
                        value={lightOnTime}
                        onChange={e => setLightOnTime(e.target.value)}
                        className="input w-full"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Lights off</label>
                      <input
                        type="time"
                        value={lightOffTime}
                        onChange={e => setLightOffTime(e.target.value)}
                        className="input w-full"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded p-3 text-sm text-yellow-300">
                Make sure the tent is ready for flower before confirming.
              </div>
            </>
          ) : (
            <>
              <p className="text-gray-300">
                Reset <strong>{tent.name}</strong> back to vegetative stage?
              </p>
              <ul className="text-sm text-gray-400 list-disc list-inside space-y-1">
                <li>Clear flower start date</li>
                <li>Reset VPD targets for veg</li>
                <li>The light schedule needs a manual update afterwards</li>
              </ul>
            </>
          )}
        </div>

        <div className="p-4 border-t border-[#2d3a5c] flex gap-2 justify-end">
          <button type="button" onClick={onCancel} className="btn">Cancel</button>
          <button
            type="button"
            onClick={() => onConfirm({
              createAutomation,
              lightOnTime,
              lightOffTime
            })}
            className="btn btn-primary"
          >
            {isFlippingToFlower ? 'Flip to flower' : 'Reset to veg'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function TentCard({
  tent,
  onAction,
  onToggle,
  isPending,
  onUpdateControlSettings,
  onRefresh,
  isLive = false,
  hasUsableData = false,
  now = Date.now(),
}) {
  const navigate = useNavigate()
  const { unit, formatTemp, getTempUnit } = useTemperatureUnit()
  const [editMode, setEditMode] = useState(false)
  const [editingSlot, setEditingSlot] = useState(null)
  const [tempLabel, setTempLabel] = useState('')
  const [localOrder, setLocalOrder] = useState(null)
  const [localLabels, setLocalLabels] = useState({})
  const [localIcons, setLocalIcons] = useState({})
  const [showFlipModal, setShowFlipModal] = useState(false)
  const [flipping, setFlipping] = useState(false)
  const [openGroup, setOpenGroup] = useState(null)

  // Growth stage from tent data
  const growthStage = tent.growth_stage || {}
  const currentStage = growthStage.stage || 'unknown'
  const flowerWeek = growthStage.flower_week
  const StageIcon = stageIcon(currentStage)
  const stageLabel = STAGE_LABELS[currentStage] || 'Unknown'
  const stageText = currentStage === 'flower' && flowerWeek ? `${stageLabel}, week ${flowerWeek}` : stageLabel
  const stageTitle = growthStage.vpd_target
    ? `Target VPD ${growthStage.vpd_target.min}-${growthStage.vpd_target.max} kPa`
    : `Growth stage: ${stageLabel}`

  // Handle flip stage
  const handleFlipStage = async (options) => {
    setFlipping(true)
    try {
      if (currentStage === 'flower') {
        // Reset to veg
        await apiFetch(`api/tents/${tent.id}/reset-to-veg`, { method: 'POST' })
      } else {
        // Flip to flower
        await apiFetch(`api/tents/${tent.id}/flip-to-flower`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            create_light_automation: options.createAutomation,
            light_on_time: options.lightOnTime,
            light_off_time: options.lightOffTime
          })
        })
      }
      setShowFlipModal(false)
      if (onRefresh) onRefresh()
    } catch (e) {
      console.error('Failed to flip stage:', e)
    } finally {
      setFlipping(false)
    }
  }

  const getSensorValue = (type) => {
    const sensor = tent.sensors?.[type]
    if (!sensor) return null
    return finiteNumberOrNull(sensor.value)
  }

  const getActuatorState = (type) => {
    return tent.actuators?.[type]?.state || 'unknown'
  }

  const getActuatorName = (type) => {
    return tent.actuators?.[type]?.attributes?.friendly_name || null
  }

  const getActuatorEntity = (type) => {
    return tent.actuators?.[type]?.entity_id || null
  }

  // Use averaged values if available, fallback to single sensor
  const temp = finiteNumberOrNull(tent.avg_temperature) ?? getSensorValue('temperature')
  const humidity = finiteNumberOrNull(tent.avg_humidity) ?? getSensorValue('humidity')
  const co2 = getSensorValue('co2')
  const vpd = finiteNumberOrNull(tent.vpd)

  // Determine VPD color
  const getVpdColor = (vpd) => {
    if (vpd == null) return 'text-gray-400'
    if (vpd >= 0.8 && vpd <= 1.2) return 'text-green-400'
    if (vpd >= 0.4 && vpd <= 1.6) return 'text-yellow-400'
    return 'text-red-400'
  }

  const getScoreColor = (score) => {
    if (score >= 80) return 'text-green-400'
    if (score >= 60) return 'text-yellow-400'
    return 'text-red-400'
  }

  // Get temp color based on targets
  const getTempColor = () => {
    if (temp == null) return 'text-white'
    const min = tent.targets?.temp_day_min || 18
    const max = tent.targets?.temp_day_max || 30
    if (temp >= min && temp <= max) return 'text-green-400'
    return 'text-red-400'
  }

  // Get humidity color based on targets
  const getHumidityColor = () => {
    if (humidity == null) return 'text-white'
    const min = tent.targets?.humidity_day_min || 40
    const max = tent.targets?.humidity_day_max || 70
    if (humidity >= min && humidity <= max) return 'text-green-400'
    return 'text-red-400'
  }

  // Get configured actuators with custom order support
  const getOrderedActuators = () => {
    const available = Object.keys(tent.actuators || {}).filter(slot =>
      tent.actuators[slot]?.state !== undefined
    )

    // If custom order is defined, use it (filtering to only available actuators)
    const customOrder = tent.control_settings?.order
    if (customOrder && Array.isArray(customOrder)) {
      const ordered = customOrder.filter(slot => available.includes(slot))
      // Add any actuators not in custom order at the end
      const remaining = available.filter(slot => !ordered.includes(slot))
      return [...ordered, ...remaining]
    }

    return available
  }

  // Get custom label for actuator
  const getCustomLabel = (slot) => {
    const labels = tent.control_settings?.labels
    return labels?.[slot] || null
  }

  // Get custom label (with edit mode support)
  const getDisplayLabel = (slot) => {
    if (editMode && localLabels[slot]) return localLabels[slot]
    return getCustomLabel(slot)
  }

  // Edit mode functions
  const enterEditMode = () => {
    setEditMode(true)
    setLocalOrder(getOrderedActuators())
    setLocalLabels({ ...(tent.control_settings?.labels || {}) })
    setLocalIcons({ ...(tent.control_settings?.icons || {}) })
  }

  const exitEditMode = () => {
    setEditMode(false)
    setEditingSlot(null)
    setLocalOrder(null)
    setLocalLabels({})
    setLocalIcons({})
  }

  const saveChanges = async () => {
    if (onUpdateControlSettings) {
      await onUpdateControlSettings(tent.id, {
        order: localOrder,
        labels: localLabels,
        icons: localIcons
      })
    }
    exitEditMode()
  }

  const moveControl = (slot, direction) => {
    const order = [...(localOrder || getOrderedActuators())]
    const idx = order.indexOf(slot)
    if (direction === 'up' && idx > 0) {
      [order[idx - 1], order[idx]] = [order[idx], order[idx - 1]]
    } else if (direction === 'down' && idx < order.length - 1) {
      [order[idx], order[idx + 1]] = [order[idx + 1], order[idx]]
    }
    setLocalOrder(order)
  }

  const startEditSlot = (slot) => {
    setEditingSlot(slot)
    setTempLabel(localLabels[slot] || tent.control_settings?.labels?.[slot] || '')
  }

  const saveSlotEdit = () => {
    if (editingSlot) {
      const newLabels = { ...localLabels }
      if (tempLabel.trim()) {
        newLabels[editingSlot] = tempLabel.trim()
      } else {
        delete newLabels[editingSlot]
      }
      setLocalLabels(newLabels)
    }
    setEditingSlot(null)
  }

  // Get display order for edit mode
  const getDisplayOrder = () => {
    return editMode && localOrder ? localOrder : getOrderedActuators()
  }

  const handleToggle = (slot) => {
    if (onToggle) {
      onToggle(tent.id, slot)
    }
  }

  const checkPending = (slot) => {
    return isPending ? isPending(tent.id, slot) : false
  }

  // Status cluster
  const statusLabel = isLive
    ? 'Live'
    : hasUsableData
      ? 'Stale'
      : Object.keys(tent.sensors || {}).length > 0 ? 'Unavailable' : 'No data'
  const statusDot = isLive ? 'bg-green-400' : hasUsableData ? 'bg-yellow-400' : 'bg-gray-500'
  const statusText = isLive ? 'text-green-400' : hasUsableData ? 'text-yellow-300' : 'text-gray-400'
  const updatedAgo = relativeTime(tent.last_updated, now)
  const score = finiteNumberOrNull(tent.environment_score)

  // Alert line: highest severity, one line
  const alerts = Array.isArray(tent.alerts) ? tent.alerts : []
  const primaryAlert = alerts.find(alert => alert.severity === 'critical') || alerts[0] || null
  let alertMessage = primaryAlert?.message || ''
  if (primaryAlert && primaryAlert.type === 'temp_out_of_range' && primaryAlert.unit === 'C' && unit === 'F') {
    // Convert Celsius values to Fahrenheit for display
    const tempF = formatTemp(primaryAlert.value, 1)
    const minF = formatTemp(primaryAlert.range_min, 0)
    const maxF = formatTemp(primaryAlert.range_max, 0)
    alertMessage = `Temperature ${tempF}°F is outside range (${minF}-${maxF}°F)`
  }
  const alertIsCritical = primaryAlert?.severity === 'critical'

  const displayOrder = getDisplayOrder()
  const detailPath = `/tent/${tent.id}`

  const menuItems = [
    { label: 'Change stage', icon: RefreshCw, onSelect: () => setShowFlipModal(true), disabled: flipping },
    displayOrder.length > 0 && !editMode
      ? { label: 'Arrange controls', icon: ListOrdered, onSelect: enterEditMode }
      : null,
    { label: 'Open details', icon: ExternalLink, onSelect: () => navigate(detailPath) },
  ]

  return (
    <div className="card relative flex min-w-0 flex-col gap-2 transition-colors hover:border-green-600/50">
      {/* Header: name + stage on the left, status on the right, overflow menu at the corner */}
      <div className="flex items-start gap-1">
        <Link
          to={detailPath}
          title={tent.description || tent.name}
          className="group flex min-h-[44px] min-w-0 flex-1 items-center gap-2 rounded-lg"
        >
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-semibold leading-6 group-hover:text-green-400">
              {tent.name}
            </div>
            <span
              className="mt-0.5 inline-flex max-w-full items-center gap-1 rounded-md bg-white/5 px-1.5 text-xs leading-5 text-gray-300"
              title={stageTitle}
            >
              {flipping
                ? <LoaderCircle size={12} className="shrink-0 animate-spin text-gray-400" aria-hidden="true" />
                : <StageIcon size={12} className="shrink-0 text-gray-400" aria-hidden="true" />}
              <span className="truncate">{stageText}</span>
            </span>
          </div>
          <div className="shrink-0 text-right text-xs leading-5">
            <div className={`flex items-center justify-end gap-1.5 ${statusText}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${statusDot}`} aria-hidden="true" />
              <span>{statusLabel}</span>
              {updatedAgo && <span className="text-gray-500">{updatedAgo}</span>}
            </div>
            <div className="text-gray-400">
              Env <span className={`font-semibold ${score != null ? getScoreColor(score) : 'text-gray-500'}`}>{score != null ? score : '--'}</span>
            </div>
          </div>
          <ChevronRight size={16} className="shrink-0 text-gray-500 group-hover:text-green-400" aria-hidden="true" />
        </Link>
        <CardMenu items={menuItems} label={`${tent.name} actions`} className="-mr-2 -mt-1" />
      </div>

      {/* Readings */}
      <div className={`grid ${co2 != null ? 'grid-cols-4' : 'grid-cols-3'} gap-1 rounded-lg bg-[#1a1a2e] px-1 py-0.5`}>
        <Reading
          value={temp != null ? formatTemp(temp, 1) : null}
          unit={getTempUnit()}
          label="Temp"
          slot="temperature"
          compact={co2 != null}
          color={getTempColor()}
          historyPath={entityHistoryPath(sensorEntities(tent.sensors?.temperature))}
        />
        <Reading
          value={humidity != null ? Number(humidity).toFixed(1) : null}
          unit="%"
          label="Humidity"
          slot="humidity"
          compact={co2 != null}
          color={getHumidityColor()}
          historyPath={entityHistoryPath(sensorEntities(tent.sensors?.humidity))}
        />
        <Reading
          value={vpd != null ? vpd.toFixed(1) : null}
          unit="kPa"
          label="VPD"
          slot="vpd"
          compact={co2 != null}
          color={getVpdColor(vpd)}
          historyPath={tentHistoryPath(tent.id, 'vpd')}
        />
        {co2 != null && (
          <Reading
            value={Number(co2).toFixed(0)}
            unit="ppm"
            label="CO2"
            slot="co2"
            compact
            color="text-white"
            historyPath={entityHistoryPath(sensorEntities(tent.sensors?.co2))}
          />
        )}
      </div>

      {/* Alert line */}
      {primaryAlert && (
        <Link
          to={detailPath}
          title={alertMessage}
          className={`flex min-w-0 items-center gap-1.5 text-xs leading-5 ${alertIsCritical ? 'text-red-300' : 'text-yellow-300'}`}
        >
          <TriangleAlert size={14} className="shrink-0" aria-hidden="true" />
          <span className="truncate">{alertMessage}</span>
        </Link>
      )}

      {/* Controls */}
      {displayOrder.length > 0 && (
        editMode ? (
          <div className="mt-auto space-y-1">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-medium text-gray-400">Arrange controls</div>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={exitEditMode}
                  className="h-11 rounded-lg px-3 text-xs text-gray-400 hover:bg-[#2d3a5c] hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveChanges}
                  className="h-11 rounded-lg bg-green-900/30 px-3 text-xs font-medium text-green-400 hover:bg-green-900/50 hover:text-green-300"
                >
                  Save
                </button>
              </div>
            </div>
            {displayOrder.map((slot, idx) => {
              const Icon = actuatorIcon(slot)
              const state = getActuatorState(slot)
              const isOn = isOnState(state)
              const displayLabel = getDisplayLabel(slot) || getActuatorName(slot) || getActuatorLabel(slot)

              return (
                <div key={slot} className="flex items-center gap-1 rounded-lg bg-[#1a1a2e] pl-1 pr-1">
                  <button
                    type="button"
                    onClick={() => moveControl(slot, 'up')}
                    disabled={idx === 0}
                    aria-label={`Move ${displayLabel} up`}
                    className="flex h-11 w-9 items-center justify-center rounded text-gray-400 hover:bg-[#2d3a5c] hover:text-white disabled:opacity-30"
                  >
                    <ArrowUp size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveControl(slot, 'down')}
                    disabled={idx === displayOrder.length - 1}
                    aria-label={`Move ${displayLabel} down`}
                    className="flex h-11 w-9 items-center justify-center rounded text-gray-400 hover:bg-[#2d3a5c] hover:text-white disabled:opacity-30"
                  >
                    <ArrowDown size={16} aria-hidden="true" />
                  </button>
                  <Icon size={16} className={`ml-1 shrink-0 ${isOn ? 'text-green-400' : 'text-gray-500'}`} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-sm">{displayLabel}</span>
                  <span className={`shrink-0 text-xs ${isOn ? 'text-green-400' : 'text-gray-500'}`}>
                    {state}
                  </span>
                  <button
                    type="button"
                    onClick={() => startEditSlot(slot)}
                    aria-label={`Rename ${displayLabel}`}
                    title="Rename"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-[#2d3a5c] hover:text-white"
                  >
                    <Pencil size={16} aria-hidden="true" />
                  </button>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="app-scroll-strip -mx-1 mt-2 px-1">
            <div className="flex w-max gap-2 py-0.5 xl:w-auto xl:flex-wrap">
              {groupActuatorsByType(displayOrder).map(group => (
                group.slots.length === 1 ? (
                  <ActuatorPill
                    key={group.slots[0]}
                    slot={group.slots[0]}
                    state={getActuatorState(group.slots[0])}
                    pending={checkPending(group.slots[0])}
                    onToggle={handleToggle}
                    onClick={group.slots[0] === 'ac' ? () => navigate('/climate') : undefined}
                    customLabel={getDisplayLabel(group.slots[0])}
                    friendlyName={getActuatorName(group.slots[0])}
                  />
                ) : (
                  <ActuatorGroupPill
                    key={group.baseType}
                    group={group}
                    getState={getActuatorState}
                    onClick={() => setOpenGroup(group)}
                  />
                )
              ))}
            </div>
          </div>
        )
      )}

      {/* Rename control dialog */}
      {editingSlot && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setEditingSlot(null)}
        >
          <div
            className="w-full max-w-xs rounded-lg bg-[#16213e] p-4"
            onClick={e => e.stopPropagation()}
          >
            <h4 className="mb-3 font-semibold">
              Rename {getActuatorName(editingSlot) || getActuatorLabel(editingSlot)}
            </h4>
            <div className="space-y-3">
              <div>
                <label htmlFor={`rename-${tent.id}-${editingSlot}`} className="mb-1 block text-xs text-gray-400">Label</label>
                <input
                  id={`rename-${tent.id}-${editingSlot}`}
                  type="text"
                  value={tempLabel}
                  onChange={e => setTempLabel(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveSlotEdit() }}
                  placeholder={getActuatorName(editingSlot) || getActuatorLabel(editingSlot)}
                  className="input w-full"
                  autoFocus
                />
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setEditingSlot(null)} className="btn btn-sm">
                  Cancel
                </button>
                <button type="button" onClick={saveSlotEdit} className="btn btn-sm btn-primary">
                  Apply
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Actuator Group Popup */}
      {openGroup && (
        <GroupPopup
          group={openGroup}
          getState={getActuatorState}
          checkPending={checkPending}
          onToggle={handleToggle}
          getDisplayLabel={getDisplayLabel}
          getActuatorName={getActuatorName}
          getActuatorEntity={getActuatorEntity}
          onClose={() => setOpenGroup(null)}
        />
      )}

      {/* Flip Stage Modal */}
      {showFlipModal && (
        <FlipStageModal
          tent={tent}
          currentStage={currentStage}
          onConfirm={handleFlipStage}
          onCancel={() => setShowFlipModal(false)}
        />
      )}
    </div>
  )
}
