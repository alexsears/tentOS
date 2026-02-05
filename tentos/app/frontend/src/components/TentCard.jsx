import { Link } from 'react-router-dom'
import { useState } from 'react'
import { useTemperatureUnit } from '../hooks/useTemperatureUnit'

// Actuator icon definitions with states
const ACTUATOR_ICONS = {
  light: { icon: '💡', activeColor: 'text-yellow-400', label: 'Light 1' },
  light_2: { icon: '💡', activeColor: 'text-yellow-400', label: 'Light 2' },
  light_3: { icon: '💡', activeColor: 'text-yellow-400', label: 'Light 3' },
  exhaust_fan: { icon: '🌀', activeColor: 'text-blue-400', label: 'Exhaust' },
  circulation_fan: { icon: '🔄', activeColor: 'text-cyan-400', label: 'Circ Fan' },
  humidifier: { icon: '💨', activeColor: 'text-blue-300', label: 'Humid' },
  dehumidifier: { icon: '🏜️', activeColor: 'text-orange-400', label: 'Dehumid' },
  heater: { icon: '🔥', activeColor: 'text-red-400', label: 'Heater' },
  water_pump: { icon: '🚿', activeColor: 'text-blue-400', label: 'Water 1' },
  water_pump_2: { icon: '🚿', activeColor: 'text-blue-400', label: 'Water 2' },
  water_pump_3: { icon: '🚿', activeColor: 'text-blue-400', label: 'Water 3' },
  drain_pump: { icon: '🔽', activeColor: 'text-gray-400', label: 'Drain' }
}

function ActuatorButton({ slot, state, pending, onToggle, config }) {
  const def = ACTUATOR_ICONS[slot] || { icon: '⚡', activeColor: 'text-green-400', label: slot }
  const isOn = state === 'on' || state === 'playing' || state === 'open'
  const isUnavailable = state === 'unavailable' || state === 'unknown'

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
      title={`${def.label}: ${state || 'unknown'}`}
    >
      {/* Icon with animation for fans */}
      <span className={`text-2xl ${isOn ? def.activeColor : 'text-gray-500'}
        ${isOn && (slot.includes('fan')) ? 'animate-spin' : ''}
      `} style={{ animationDuration: '2s' }}>
        {def.icon}
      </span>

      {/* Label */}
      <span className={`text-xs mt-1 ${isOn ? 'text-white' : 'text-gray-500'}`}>
        {def.label}
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

export function TentCard({ tent, onAction, onToggle, isPending }) {
  const { unit, formatTemp, getTempUnit } = useTemperatureUnit()

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

  // Get configured actuators
  const configuredActuators = Object.keys(tent.actuators || {}).filter(slot =>
    tent.actuators[slot]?.state !== undefined
  )

  const handleToggle = (slot) => {
    if (onToggle) {
      onToggle(tent.id, slot)
    }
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

      {/* Actuators - Clickable Controls */}
      {configuredActuators.length > 0 && (
        <div className="mb-4">
          <div className="text-xs text-gray-500 mb-2">Controls (click to toggle)</div>
          <div className="flex flex-wrap gap-2">
            {configuredActuators.map(slot => (
              <ActuatorButton
                key={slot}
                slot={slot}
                state={getActuatorState(slot)}
                pending={checkPending(slot)}
                onToggle={handleToggle}
              />
            ))}
          </div>
        </div>
      )}

      {/* Alerts */}
      {tent.alerts?.length > 0 && (
        <div className="mb-4 space-y-1">
          {tent.alerts.slice(0, 2).map((alert, i) => (
            <div
              key={i}
              className={`text-xs p-2 rounded ${
                alert.severity === 'critical'
                  ? 'bg-red-900/30 text-red-300'
                  : 'bg-yellow-900/30 text-yellow-300'
              }`}
            >
              {alert.message}
            </div>
          ))}
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
