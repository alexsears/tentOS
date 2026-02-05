import { Link } from 'react-router-dom'
import { useState, useEffect, useRef } from 'react'
import { useTemperatureUnit } from '../hooks/useTemperatureUnit'
import { getApiBase } from '../utils/api'

// Actuator icon definitions with states
const ACTUATOR_ICONS = {
  light: { icon: '💡', activeColor: 'text-yellow-400', label: 'Light' },
  exhaust_fan: { icon: '🌀', activeColor: 'text-blue-400', label: 'Exhaust' },
  circulation_fan: { icon: '🔄', activeColor: 'text-cyan-400', label: 'Circ Fan' },
  humidifier: { icon: '💨', activeColor: 'text-blue-300', label: 'Humid' },
  dehumidifier: { icon: '🏜️', activeColor: 'text-orange-400', label: 'Dehumid' },
  heater: { icon: '🔥', activeColor: 'text-red-400', label: 'Heater' },
  ac: { icon: '❄️', activeColor: 'text-cyan-400', label: 'A/C' },
  water_pump: { icon: '🚿', activeColor: 'text-blue-400', label: 'Water' },
  drain_pump: { icon: '🔽', activeColor: 'text-gray-400', label: 'Drain' }
}

function ActuatorButton({ slot, state, pending, onToggle, customLabel, customIcon }) {
  const def = ACTUATOR_ICONS[slot] || { icon: '⚡', activeColor: 'text-green-400', label: slot }
  const isOn = state === 'on' || state === 'playing' || state === 'open'
  const isUnavailable = state === 'unavailable' || state === 'unknown'

  // Use custom label/icon if provided
  const displayLabel = customLabel || def.label
  const displayIcon = customIcon || def.icon

  return (
    <button
      onClick={() => onToggle(slot)}
      disabled={pending || isUnavailable}
      className={`
        relative flex flex-col items-center justify-center p-3 rounded-lg
        transition-all duration-200 min-w-[70px]
        ${isUnavailable
          ? 'bg-gray-800 cursor-not-allowed opacity-50'
          : isOn
            ? 'bg-green-900/30 hover:bg-green-900/50 border border-green-600/50'
            : 'bg-[#1a1a2e] hover:bg-[#2d3a5c] border border-transparent'
        }
        ${pending ? 'animate-pulse' : ''}
      `}
      title={`${displayLabel}: ${state || 'unknown'}`}
    >
      {/* Icon with animation for fans */}
      <span className={`text-2xl ${isOn ? def.activeColor : 'text-gray-500'}
        ${isOn && (slot.includes('fan')) ? 'animate-spin' : ''}
      `} style={{ animationDuration: '2s' }}>
        {displayIcon}
      </span>

      {/* Label */}
      <span className={`text-xs mt-1 ${isOn ? 'text-white' : 'text-gray-500'}`}>
        {displayLabel}
      </span>

      {/* State indicator dot */}
      <span className={`absolute top-1 right-1 w-2 h-2 rounded-full
        ${pending ? 'bg-yellow-400 animate-pulse' :
          isUnavailable ? 'bg-gray-600' :
          isOn ? 'bg-green-400' : 'bg-gray-600'}
      `} />
    </button>
  )
}

function SensorDisplay({ value, unit, label, icon, color = 'text-white' }) {
  return (
    <div className="text-center">
      <div className="text-xs text-gray-500 mb-1">{icon}</div>
      <div className={`text-xl font-bold ${color}`}>
        {value != null ? value : '--'}
        {value != null && unit && <span className="text-xs text-gray-400 ml-0.5">{unit}</span>}
      </div>
      <div className="text-xs text-gray-400">{label}</div>
    </div>
  )
}

function CameraPreview({ tentId, entityId }) {
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const streamImgRef = useRef(null)
  const apiBase = getApiBase()

  // Auto-refresh snapshot every 10 seconds (slower on dashboard to save bandwidth)
  useEffect(() => {
    if (error) return
    const interval = setInterval(() => {
      setRefreshKey(k => k + 1)
    }, 10000)
    return () => clearInterval(interval)
  }, [error])

  // Cleanup MJPEG stream when closing expanded view
  useEffect(() => {
    if (!expanded && streamImgRef.current) {
      streamImgRef.current.src = ''
    }
    return () => {
      if (streamImgRef.current) {
        streamImgRef.current.src = ''
      }
    }
  }, [expanded])

  const snapshotUrl = `${apiBase}/api/camera/${tentId}/${entityId}/snapshot?t=${refreshKey}`
  const streamUrl = `${apiBase}/api/camera/${tentId}/${entityId}/stream`

  const handleClick = (e) => {
    e.stopPropagation()
    setExpanded(!expanded)
  }

  const handleClose = (e) => {
    e.stopPropagation()
    setExpanded(false)
  }

  return (
    <>
      {/* Normal preview */}
      {!expanded && (
        <div
          className="relative rounded-lg overflow-hidden cursor-pointer bg-gray-900 h-32"
          onClick={handleClick}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && handleClick(e)}
          aria-label="Expand camera view"
        >
          {error ? (
            <div className="flex items-center justify-center h-full text-gray-500">
              <span>📷 Camera unavailable</span>
            </div>
          ) : (
            <img
              key={refreshKey}
              src={snapshotUrl}
              alt={`Camera snapshot`}
              className="w-full h-full object-cover"
              onError={() => setError(true)}
            />
          )}
          {!error && (
            <div className="absolute bottom-1 right-1 text-xs bg-black/50 text-white px-2 py-0.5 rounded">
              Click for live
            </div>
          )}
        </div>
      )}

      {/* Fullscreen expanded view */}
      {expanded && (
        <div
          className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center"
          onClick={handleClose}
        >
          <div
            className="relative w-full h-full max-w-6xl max-h-[90vh] m-4"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              ref={streamImgRef}
              src={streamUrl}
              alt={`Live stream from camera`}
              className="w-full h-full object-contain"
              onError={() => setError(true)}
            />
            <button
              onClick={handleClose}
              className="absolute top-2 right-2 bg-black/70 hover:bg-black text-white px-3 py-1 rounded text-sm"
            >
              ✕ Close
            </button>
            <div className="absolute bottom-2 left-2 text-xs bg-black/70 text-red-400 px-2 py-1 rounded">
              ● LIVE
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// Grow tent icon component
function GrowTentIcon({ color = '#22c55e', size = 40 }) {
  return (
    <svg viewBox="0 0 40 40" width={size} height={size}>
      {/* Tent body */}
      <rect x="4" y="8" width="32" height="28" rx="2" fill="#1a1a2e" stroke="#374151" strokeWidth="1.5"/>
      {/* Door zipper */}
      <line x1="20" y1="12" x2="20" y2="36" stroke="#4b5563" strokeWidth="1" strokeDasharray="2,2"/>
      {/* Door panels */}
      <path d="M8,12 L20,12 L20,32 L8,32 Z" fill="#111827" opacity="0.5"/>
      <path d="M20,12 L32,12 L32,32 L20,32 Z" fill="#0d1117" opacity="0.5"/>
      {/* Top vent port */}
      <circle cx="20" cy="5" r="3" fill="#1a1a2e" stroke="#374151" strokeWidth="1"/>
      <circle cx="20" cy="5" r="1.5" fill={color} opacity="0.8"/>
      {/* Side vent ports */}
      <circle cx="6" cy="18" r="2.5" fill="#111827" stroke="#374151" strokeWidth="1"/>
      <circle cx="34" cy="18" r="2.5" fill="#111827" stroke="#374151" strokeWidth="1"/>
      {/* Status light */}
      <circle cx="30" cy="10" r="2" fill={color}/>
      {/* Grow light glow inside */}
      <ellipse cx="20" cy="20" rx="8" ry="4" fill={color} opacity="0.15"/>
    </svg>
  )
}

export function TentCard({ tent, onAction, onToggle, isPending, onUpdateControlSettings }) {
  const { unit, formatTemp, getTempUnit } = useTemperatureUnit()
  const [editMode, setEditMode] = useState(false)
  const [editingSlot, setEditingSlot] = useState(null)
  const [tempLabel, setTempLabel] = useState('')
  const [tempIcon, setTempIcon] = useState('')
  const [localOrder, setLocalOrder] = useState(null)
  const [localLabels, setLocalLabels] = useState({})
  const [localIcons, setLocalIcons] = useState({})

  const getSensorValue = (type) => {
    const sensor = tent.sensors?.[type]
    if (!sensor) return null
    return sensor.value
  }

  const getActuatorState = (type) => {
    return tent.actuators?.[type]?.state || 'unknown'
  }

  // Use averaged values if available, fallback to single sensor
  const temp = tent.avg_temperature ?? getSensorValue('temperature')
  const humidity = tent.avg_humidity ?? getSensorValue('humidity')
  const co2 = getSensorValue('co2')

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

  const configuredActuators = getOrderedActuators()

  // Get custom label for actuator
  const getCustomLabel = (slot) => {
    const labels = tent.control_settings?.labels
    return labels?.[slot] || null
  }

  // Get custom icon for actuator
  const getCustomIcon = (slot) => {
    if (editMode && localIcons[slot]) return localIcons[slot]
    const icons = tent.control_settings?.icons
    return icons?.[slot] || null
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
    const def = ACTUATOR_ICONS[slot] || { label: slot, icon: '⚡' }
    setTempLabel(localLabels[slot] || tent.control_settings?.labels?.[slot] || '')
    setTempIcon(localIcons[slot] || tent.control_settings?.icons?.[slot] || '')
  }

  const saveSlotEdit = () => {
    if (editingSlot) {
      const newLabels = { ...localLabels }
      const newIcons = { ...localIcons }
      if (tempLabel.trim()) {
        newLabels[editingSlot] = tempLabel.trim()
      } else {
        delete newLabels[editingSlot]
      }
      if (tempIcon.trim()) {
        newIcons[editingSlot] = tempIcon.trim()
      } else {
        delete newIcons[editingSlot]
      }
      setLocalLabels(newLabels)
      setLocalIcons(newIcons)
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

  // Get configured cameras
  const getCameras = () => {
    const cameras = tent.sensors?.camera
    if (!cameras) return []
    if (Array.isArray(cameras)) {
      // Handle array of entity IDs or objects with entity_id
      return cameras.map(c => typeof c === 'string' ? c : c?.entity_id).filter(Boolean)
    }
    if (typeof cameras === 'string') return [cameras]
    // Handle object with _entities
    if (cameras._entities) {
      return Object.keys(cameras._entities)
    }
    return []
  }

  const checkPending = (slot) => {
    return isPending ? isPending(tent.id, slot) : false
  }

  // Get tent status color
  const getTentColor = () => {
    if (tent.alerts?.length > 0) return '#ef4444' // red
    if (tent.environment_score >= 80) return '#22c55e' // green
    if (tent.environment_score >= 60) return '#eab308' // yellow
    return '#6b7280' // gray
  }

  return (
    <div className="card hover:border-green-600/50 transition-colors">
      {/* Header */}
      <div className="flex items-start gap-3 mb-4">
        <GrowTentIcon color={getTentColor()} size={48} />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between">
            <div>
              <Link to={`/tent/${tent.id}`} className="text-lg font-semibold hover:text-green-400">
                {tent.name}
              </Link>
              {tent.description && (
                <p className="text-sm text-gray-400">{tent.description}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {tent.alerts?.length > 0 && (
                <span className="badge badge-danger animate-pulse">
                  {tent.alerts.length} Alert{tent.alerts.length !== 1 && 's'}
                </span>
              )}
              <span className={`text-2xl font-bold ${getScoreColor(tent.environment_score)}`}>
                {tent.environment_score || '--'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Sensors - Real-time values */}
      <div className="grid grid-cols-4 gap-2 mb-4 p-3 bg-[#1a1a2e] rounded-lg">
        <SensorDisplay
          value={temp != null ? formatTemp(temp, 1) : null}
          unit={getTempUnit()}
          label="Temp"
          icon="🌡️"
          color={getTempColor()}
        />
        <SensorDisplay
          value={humidity != null ? humidity.toFixed(1) : null}
          unit="%"
          label="Humidity"
          icon="💧"
          color={getHumidityColor()}
        />
        <SensorDisplay
          value={tent.vpd != null ? tent.vpd.toFixed(1) : null}
          unit=""
          label="VPD"
          icon="🫧"
          color={getVpdColor(tent.vpd)}
        />
        {co2 != null ? (
          <SensorDisplay
            value={co2.toFixed(1)}
            unit="ppm"
            label="CO2"
            icon="💨"
            color="text-white"
          />
        ) : (
          <SensorDisplay
            value={tent.last_updated ? 'Live' : null}
            unit=""
            label="Status"
            icon="📡"
            color="text-green-400"
          />
        )}
      </div>

      {/* Camera Preview */}
      {getCameras().length > 0 && (
        <div className="mb-4">
          <div className="text-xs text-gray-500 mb-2">Camera{getCameras().length > 1 ? 's' : ''}</div>
          <div className={`grid gap-2 ${getCameras().length > 1 ? 'grid-cols-2' : ''}`}>
            {getCameras().map(cameraId => (
              <CameraPreview
                key={cameraId}
                tentId={tent.id}
                entityId={cameraId}
              />
            ))}
          </div>
        </div>
      )}

      {/* Actuators - Clickable Controls */}
      {getDisplayOrder().length > 0 && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs text-gray-500">
              {editMode ? 'Drag to reorder, click ✏️ to rename' : 'Controls (click to toggle)'}
            </div>
            {!editMode ? (
              <button
                onClick={enterEditMode}
                className="text-xs text-gray-400 hover:text-white px-2 py-0.5 rounded hover:bg-[#2d3a5c]"
                title="Customize controls"
              >
                ✏️ Edit
              </button>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={exitEditMode}
                  className="text-xs text-gray-400 hover:text-white px-2 py-0.5 rounded hover:bg-[#2d3a5c]"
                >
                  Cancel
                </button>
                <button
                  onClick={saveChanges}
                  className="text-xs text-green-400 hover:text-green-300 px-2 py-0.5 rounded bg-green-900/30 hover:bg-green-900/50"
                >
                  Save
                </button>
              </div>
            )}
          </div>

          {editMode ? (
            // Edit mode: show reorder controls
            <div className="space-y-1">
              {getDisplayOrder().map((slot, idx) => {
                const def = ACTUATOR_ICONS[slot] || { icon: '⚡', label: slot }
                const state = getActuatorState(slot)
                const isOn = state === 'on' || state === 'playing' || state === 'open'
                const displayIcon = getCustomIcon(slot) || def.icon
                const displayLabel = getDisplayLabel(slot) || def.label

                return (
                  <div key={slot} className="flex items-center gap-2 p-2 bg-[#1a1a2e] rounded-lg">
                    {/* Reorder buttons */}
                    <div className="flex flex-col">
                      <button
                        onClick={() => moveControl(slot, 'up')}
                        disabled={idx === 0}
                        className="text-xs text-gray-400 hover:text-white disabled:opacity-30 px-1"
                      >
                        ▲
                      </button>
                      <button
                        onClick={() => moveControl(slot, 'down')}
                        disabled={idx === getDisplayOrder().length - 1}
                        className="text-xs text-gray-400 hover:text-white disabled:opacity-30 px-1"
                      >
                        ▼
                      </button>
                    </div>

                    {/* Icon and label */}
                    <span className={`text-xl ${isOn ? def.activeColor : 'text-gray-500'}`}>
                      {displayIcon}
                    </span>
                    <span className="flex-1 text-sm">{displayLabel}</span>
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      isOn ? 'bg-green-900/30 text-green-400' : 'text-gray-500'
                    }`}>
                      {state}
                    </span>

                    {/* Edit button */}
                    <button
                      onClick={() => startEditSlot(slot)}
                      className="p-1 hover:bg-[#2d3a5c] rounded text-gray-400 hover:text-white"
                      title="Edit label & icon"
                    >
                      ✏️
                    </button>
                  </div>
                )
              })}
            </div>
          ) : (
            // Normal mode: clickable buttons
            <div className="flex flex-wrap gap-2">
              {getDisplayOrder().map(slot => (
                <ActuatorButton
                  key={slot}
                  slot={slot}
                  state={getActuatorState(slot)}
                  pending={checkPending(slot)}
                  onToggle={handleToggle}
                  customLabel={getDisplayLabel(slot)}
                  customIcon={getCustomIcon(slot)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Edit slot modal */}
      {editingSlot && (
        <div
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
          onClick={() => setEditingSlot(null)}
        >
          <div
            className="bg-[#16213e] rounded-lg p-4 w-80"
            onClick={e => e.stopPropagation()}
          >
            <h4 className="font-semibold mb-3">
              Edit "{ACTUATOR_ICONS[editingSlot]?.label || editingSlot}"
            </h4>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Custom Label</label>
                <input
                  type="text"
                  value={tempLabel}
                  onChange={e => setTempLabel(e.target.value)}
                  placeholder={ACTUATOR_ICONS[editingSlot]?.label || editingSlot}
                  className="input w-full"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Custom Icon (emoji)</label>
                <input
                  type="text"
                  value={tempIcon}
                  onChange={e => setTempIcon(e.target.value)}
                  placeholder={ACTUATOR_ICONS[editingSlot]?.icon || '⚡'}
                  className="input w-full"
                  maxLength={4}
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setEditingSlot(null)} className="btn btn-sm">
                  Cancel
                </button>
                <button onClick={saveSlotEdit} className="btn btn-sm btn-primary">
                  Apply
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Alerts */}
      {tent.alerts?.length > 0 && (
        <div className="mb-4 space-y-1">
          {tent.alerts.slice(0, 2).map((alert, i) => {
            // Format alert message based on user's temperature preference
            let message = alert.message
            if (alert.type === 'temp_out_of_range' && alert.unit === 'C' && unit === 'F') {
              // Convert Celsius values to Fahrenheit for display
              const tempF = formatTemp(alert.value, 1)
              const minF = formatTemp(alert.range_min, 0)
              const maxF = formatTemp(alert.range_max, 0)
              message = `Temperature ${tempF}°F is outside range (${minF}-${maxF}°F)`
            }
            return (
              <div
                key={i}
                className={`text-xs p-2 rounded ${
                  alert.severity === 'critical'
                    ? 'bg-red-900/30 text-red-300'
                    : 'bg-yellow-900/30 text-yellow-300'
                }`}
              >
                {message}
              </div>
            )
          })}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-3 border-t border-[#2d3a5c]">
        <div className="text-xs text-gray-500">
          {tent.last_updated && `Updated: ${new Date(tent.last_updated).toLocaleTimeString()}`}
        </div>
        <Link to={`/tent/${tent.id}`} className="btn btn-primary btn-sm">
          Details →
        </Link>
      </div>
    </div>
  )
}
