import { Link } from 'react-router-dom'
import { useState } from 'react'

export function TentCard({ tent, onAction }) {
  const [actionLoading, setActionLoading] = useState(null)

  const handleAction = async (action, params = {}) => {
    setActionLoading(action)
    try {
      await onAction(tent.id, action, params)
    } catch (e) {
      console.error(e)
    } finally {
      setActionLoading(null)
    }
  }

  const getSensorValue = (type) => {
    const sensor = tent.sensors?.[type]
    if (!sensor) return null
    return {
      value: sensor.value,
      unit: sensor.unit || ''
    }
  }

  const getActuatorState = (type) => {
    return tent.actuators?.[type]?.state || 'unknown'
  }

  const temp = getSensorValue('temperature')
  const humidity = getSensorValue('humidity')
  const lightState = getActuatorState('light')
  const fanState = getActuatorState('exhaust_fan')

  const getScoreColor = (score) => {
    if (score >= 80) return 'text-green-400'
    if (score >= 60) return 'text-yellow-400'
    return 'text-red-400'
  }

  return (
    <div className="card hover:border-green-600/50 transition-colors">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <Link to={`/tent/${tent.id}`} className="text-lg font-semibold hover:text-green-400">
            {tent.name}
          </Link>
          {tent.description && (
            <p className="text-sm text-gray-400">{tent.description}</p>
          )}
        </div>
        {tent.alerts?.length > 0 && (
          <span className="badge badge-danger">
            {tent.alerts.length} Alert{tent.alerts.length !== 1 && 's'}
          </span>
        )}
      </div>

      {/* Sensors */}
      <div className="grid grid-cols-4 gap-4 mb-4">
        <div className="text-center">
          <div className="text-2xl font-bold">
            {temp ? `${temp.value}°` : '--'}
          </div>
          <div className="text-xs text-gray-400">Temperature</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold">
            {humidity ? `${humidity.value}%` : '--'}
          </div>
          <div className="text-xs text-gray-400">Humidity</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold">
            {tent.vpd != null ? tent.vpd.toFixed(2) : '--'}
          </div>
          <div className="text-xs text-gray-400">VPD (kPa)</div>
        </div>
        <div className="text-center">
          <div className={`text-2xl font-bold ${getScoreColor(tent.environment_score)}`}>
            {tent.environment_score || '--'}
          </div>
          <div className="text-xs text-gray-400">Score</div>
        </div>
      </div>

      {/* Status indicators */}
      <div className="flex items-center gap-4 mb-4 text-sm">
        <div className="flex items-center gap-2">
          <span className={lightState === 'on' ? 'text-yellow-400' : 'text-gray-500'}>💡</span>
          <span className={lightState === 'on' ? 'text-yellow-400' : 'text-gray-400'}>
            Light {lightState}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className={fanState === 'on' ? 'text-blue-400' : 'text-gray-500'}>🌀</span>
          <span className={fanState === 'on' ? 'text-blue-400' : 'text-gray-400'}>
            Fan {fanState}
          </span>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="flex gap-2 pt-3 border-t border-[#2d3a5c]">
        <button
          onClick={() => handleAction('toggle_light')}
          disabled={actionLoading === 'toggle_light'}
          className="btn btn-secondary btn-sm flex-1"
        >
          {actionLoading === 'toggle_light' ? '...' : '💡 Toggle Light'}
        </button>
        <button
          onClick={() => handleAction('set_fan', { entity_type: 'exhaust_fan' })}
          disabled={actionLoading === 'set_fan'}
          className="btn btn-secondary btn-sm flex-1"
        >
          {actionLoading === 'set_fan' ? '...' : '🌀 Toggle Fan'}
        </button>
        <Link to={`/tent/${tent.id}`} className="btn btn-primary btn-sm">
          Details →
        </Link>
      </div>
    </div>
  )
}
