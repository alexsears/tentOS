import { useParams, Link } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useTent, useTents } from '../hooks/useTents'
import { SensorChart } from '../components/SensorChart'
import { EventLog } from '../components/EventLog'
import { CameraFeed, CameraGrid } from '../components/CameraFeed'
import { useTemperatureUnit } from '../hooks/useTemperatureUnit'
import { apiFetch } from '../utils/api'

export default function TentDetail() {
  const { tentId } = useParams()
  const { tent, loading, error } = useTent(tentId)
  const { performAction } = useTents()
  const { formatTemp, getTempUnit } = useTemperatureUnit()
  const [activeTab, setActiveTab] = useState('overview')
  const [chartRange, setChartRange] = useState('24h')
  const [actionLoading, setActionLoading] = useState(null)
  const [haAutomations, setHaAutomations] = useState([])
  const [automationsLoading, setAutomationsLoading] = useState(false)

  // Fetch HA automations for this tent
  useEffect(() => {
    if (activeTab === 'automations' && tentId) {
      setAutomationsLoading(true)
      apiFetch(`api/automations/ha?tent_id=${tentId}`)
        .then(r => r.json())
        .then(data => setHaAutomations(data.automations || []))
        .catch(console.error)
        .finally(() => setAutomationsLoading(false))
    }
  }, [activeTab, tentId])

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

  if (loading) {
    return <div className="text-gray-400 text-center py-8">Loading...</div>
  }

  if (error || !tent) {
    return (
      <div className="card border-red-500/50">
        <div className="text-red-400">Error: {error || 'Tent not found'}</div>
        <Link to="/" className="btn btn-secondary mt-4">← Back to Dashboard</Link>
      </div>
    )
  }

  const getSensorDisplay = (type, label, unit = '', isTemp = false) => {
    const sensor = tent.sensors?.[type]
    const value = sensor?.value
    const displayValue = isTemp && value != null ? formatTemp(value, 1) : (value != null ? value.toFixed(1) : null)
    const displayUnit = isTemp ? getTempUnit() : unit
    return (
      <div className="card text-center">
        <div className="text-3xl font-bold mb-1">
          {displayValue != null ? `${displayValue}${displayUnit}` : '--'}
        </div>
        <div className="text-sm text-gray-400">{label}</div>
      </div>
    )
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

  const getActuatorControl = (type, label, icon) => {
    const state = tent.actuators?.[type]?.state || 'unknown'
    const isOn = state === 'on'
    return (
      <div className="card">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className={`text-2xl ${isOn ? '' : 'opacity-50'}`}>{icon}</span>
            <div>
              <div className="font-medium">{label}</div>
              <div className={`text-sm ${isOn ? 'text-green-400' : 'text-gray-400'}`}>
                {state}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => handleAction('turn_on', { entity_type: type })}
              disabled={actionLoading}
              className={`btn btn-sm ${isOn ? 'btn-primary' : 'btn-secondary'}`}
            >
              On
            </button>
            <button
              onClick={() => handleAction('turn_off', { entity_type: type })}
              disabled={actionLoading}
              className={`btn btn-sm ${!isOn ? 'btn-primary' : 'btn-secondary'}`}
            >
              Off
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Link to="/" className="text-gray-400 hover:text-white">←</Link>
        <div>
          <h2 className="text-2xl font-bold">{tent.name}</h2>
          {tent.description && <p className="text-gray-400">{tent.description}</p>}
        </div>
        {tent.alerts?.length > 0 && (
          <span className="badge badge-danger ml-auto">
            {tent.alerts.length} Alert{tent.alerts.length !== 1 && 's'}
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 border-b border-[#2d3a5c] pb-2">
        {['overview', ...(cameras.length > 0 ? ['cameras'] : []), 'charts', 'automations', 'events', 'settings'].map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-t-lg capitalize ${
              activeTab === tab
                ? 'bg-[#16213e] text-white border-b-2 border-green-500'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            {tab === 'cameras' ? `📷 ${tab}` : tab === 'automations' ? `⚡ ${tab}` : tab}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Alerts */}
          {tent.alerts?.length > 0 && (
            <div className="card border-red-500/50">
              <h3 className="font-semibold text-red-400 mb-3">⚠️ Active Alerts</h3>
              <div className="space-y-2">
                {tent.alerts.map((alert, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm">
                    <span className={`badge badge-${alert.severity === 'critical' ? 'danger' : 'warning'}`}>
                      {alert.severity}
                    </span>
                    <span>{alert.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Camera Preview on Overview */}
          {cameras.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">📷 Camera{cameras.length > 1 ? 's' : ''}</h3>
                {cameras.length > 1 && (
                  <button
                    onClick={() => setActiveTab('cameras')}
                    className="text-sm text-green-400 hover:text-green-300"
                  >
                    View all →
                  </button>
                )}
              </div>
              {/* Show first camera only on overview */}
              <div className="max-w-xl">
                <CameraFeed
                  tentId={tentId}
                  entityId={cameras[0]}
                  defaultMode="snapshot"
                  refreshInterval={10000}
                />
              </div>
            </div>
          )}

          {/* Sensors */}
          <div>
            <h3 className="font-semibold mb-3">Environment</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {getSensorDisplay('temperature', 'Temperature', '', true)}
              {getSensorDisplay('humidity', 'Humidity', '%')}
              <div className="card text-center">
                <div className="text-3xl font-bold mb-1">
                  {tent.vpd != null ? tent.vpd.toFixed(1) : '--'}
                </div>
                <div className="text-sm text-gray-400">VPD (kPa)</div>
              </div>
              <div className="card text-center">
                <div className={`text-3xl font-bold mb-1 ${
                  tent.environment_score >= 80 ? 'text-green-400' :
                  tent.environment_score >= 60 ? 'text-yellow-400' : 'text-red-400'
                }`}>
                  {tent.environment_score || '--'}
                </div>
                <div className="text-sm text-gray-400">Env Score</div>
              </div>
            </div>
          </div>

          {/* Additional Sensors */}
          {(tent.sensors?.co2 || tent.sensors?.reservoir_level || tent.sensors?.power_usage) && (
            <div>
              <h3 className="font-semibold mb-3">Additional Sensors</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {tent.sensors?.co2 && getSensorDisplay('co2', 'CO2', ' ppm')}
                {tent.sensors?.reservoir_level && getSensorDisplay('reservoir_level', 'Reservoir', '%')}
                {tent.sensors?.power_usage && getSensorDisplay('power_usage', 'Power', ' W')}
              </div>
            </div>
          )}

          {/* Actuators */}
          <div>
            <h3 className="font-semibold mb-3">Controls</h3>
            <div className="grid md:grid-cols-2 gap-4">
              {tent.actuators?.light && getActuatorControl('light', 'Light 1', '💡')}
              {tent.actuators?.light_2 && getActuatorControl('light_2', 'Light 2', '💡')}
              {tent.actuators?.light_3 && getActuatorControl('light_3', 'Light 3', '💡')}
              {tent.actuators?.exhaust_fan && getActuatorControl('exhaust_fan', 'Exhaust Fan', '🌀')}
              {tent.actuators?.circulation_fan && getActuatorControl('circulation_fan', 'Circulation Fan', '🔄')}
              {tent.actuators?.humidifier && getActuatorControl('humidifier', 'Humidifier', '💨')}
              {tent.actuators?.dehumidifier && getActuatorControl('dehumidifier', 'Dehumidifier', '🏜️')}
              {tent.actuators?.heater && getActuatorControl('heater', 'Heater', '🔥')}
              {tent.actuators?.ac && getActuatorControl('ac', 'A/C', '❄️')}
              {tent.actuators?.water_pump && getActuatorControl('water_pump', 'Water Pump 1', '🚿')}
              {tent.actuators?.water_pump_2 && getActuatorControl('water_pump_2', 'Water Pump 2', '🚿')}
              {tent.actuators?.water_pump_3 && getActuatorControl('water_pump_3', 'Water Pump 3', '🚿')}
              {tent.actuators?.drain_pump && getActuatorControl('drain_pump', 'Drain Pump', '🔽')}
            </div>
          </div>

          {/* Quick Actions */}
          <div>
            <h3 className="font-semibold mb-3">Quick Actions</h3>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => handleAction('run_watering', { duration_minutes: 1 })}
                disabled={actionLoading}
                className="btn btn-primary"
              >
                💧 Run Watering (1 min)
              </button>
              <button
                onClick={() => handleAction('set_override', {
                  entity_type: 'light',
                  value: 'auto',
                  duration_minutes: 0
                })}
                disabled={actionLoading}
                className="btn btn-secondary"
              >
                🔄 Clear Overrides
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cameras Tab */}
      {activeTab === 'cameras' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Cameras ({cameras.length})</h3>
          </div>
          <CameraGrid tentId={tentId} cameras={cameras} />
        </div>
      )}

      {/* Charts Tab */}
      {activeTab === 'charts' && (
        <div className="space-y-6">
          <div className="flex justify-end gap-2">
            {['24h', '7d', '30d'].map(range => (
              <button
                key={range}
                onClick={() => setChartRange(range)}
                className={`btn btn-sm ${chartRange === range ? 'btn-primary' : 'btn-secondary'}`}
              >
                {range}
              </button>
            ))}
          </div>

          <div className="card">
            <h3 className="font-semibold mb-4">Temperature & Humidity</h3>
            <SensorChart
              tentId={tentId}
              sensors={['temperature', 'humidity']}
              range={chartRange}
            />
          </div>

          <div className="card">
            <h3 className="font-semibold mb-4">VPD</h3>
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
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Home Assistant Automations</h3>
            <span className="text-sm text-gray-400">
              Automations related to this tent's entities
            </span>
          </div>

          {automationsLoading ? (
            <div className="text-center text-gray-400 py-8">Loading automations...</div>
          ) : haAutomations.length === 0 ? (
            <div className="card text-center py-8">
              <div className="text-gray-400 mb-2">No related automations found</div>
              <p className="text-sm text-gray-500">
                Create automations in Home Assistant that use this tent's sensors or actuators,
                and they'll appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {haAutomations.map(auto => {
                const isEnabled = auto.state === 'on'
                const lastTriggered = auto.attributes?.last_triggered
                const friendlyName = auto.attributes?.friendly_name || auto.entity_id

                return (
                  <div key={auto.entity_id} className="card">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className={`text-2xl ${isEnabled ? '' : 'opacity-50'}`}>⚡</span>
                        <div>
                          <div className="font-medium">{friendlyName}</div>
                          <div className="text-xs text-gray-500">{auto.entity_id}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        {lastTriggered && (
                          <div className="text-xs text-gray-400">
                            Last: {new Date(lastTriggered).toLocaleString()}
                          </div>
                        )}
                        <div className={`px-2 py-1 rounded text-xs ${
                          isEnabled ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'
                        }`}>
                          {isEnabled ? 'Enabled' : 'Disabled'}
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={async () => {
                              setActionLoading(auto.entity_id)
                              try {
                                await apiFetch(`api/automations/ha/${auto.entity_id}/trigger`, { method: 'POST' })
                                // Refresh automations
                                const res = await apiFetch(`api/automations/ha?tent_id=${tentId}`)
                                const data = await res.json()
                                setHaAutomations(data.automations || [])
                              } catch (e) {
                                console.error('Failed to trigger:', e)
                              } finally {
                                setActionLoading(null)
                              }
                            }}
                            disabled={actionLoading === auto.entity_id}
                            className="btn btn-sm btn-primary"
                          >
                            {actionLoading === auto.entity_id ? '...' : 'Run'}
                          </button>
                          <button
                            onClick={async () => {
                              setActionLoading(`toggle-${auto.entity_id}`)
                              try {
                                await apiFetch(`api/automations/ha/${auto.entity_id}/toggle`, { method: 'POST' })
                                // Refresh automations
                                const res = await apiFetch(`api/automations/ha?tent_id=${tentId}`)
                                const data = await res.json()
                                setHaAutomations(data.automations || [])
                              } catch (e) {
                                console.error('Failed to toggle:', e)
                              } finally {
                                setActionLoading(null)
                              }
                            }}
                            disabled={actionLoading === `toggle-${auto.entity_id}`}
                            className={`btn btn-sm ${isEnabled ? 'btn-secondary' : 'btn-primary'}`}
                          >
                            {actionLoading === `toggle-${auto.entity_id}` ? '...' : (isEnabled ? 'Disable' : 'Enable')}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <div className="text-sm text-gray-500 text-center">
            Automations are matched by entity names containing keywords from your tent's sensors and actuators.
          </div>
        </div>
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
          <div className="card">
            <h3 className="font-semibold mb-4">Targets</h3>
            <div className="grid md:grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-400">Day Temp:</span>{' '}
                {tent.targets?.temp_day_min || '?'} - {tent.targets?.temp_day_max || '?'}°C
              </div>
              <div>
                <span className="text-gray-400">Night Temp:</span>{' '}
                {tent.targets?.temp_night_min || '?'} - {tent.targets?.temp_night_max || '?'}°C
              </div>
              <div>
                <span className="text-gray-400">Day Humidity:</span>{' '}
                {tent.targets?.humidity_day_min || '?'} - {tent.targets?.humidity_day_max || '?'}%
              </div>
              <div>
                <span className="text-gray-400">Night Humidity:</span>{' '}
                {tent.targets?.humidity_night_min || '?'} - {tent.targets?.humidity_night_max || '?'}%
              </div>
            </div>
          </div>

          <div className="card">
            <h3 className="font-semibold mb-4">Schedules</h3>
            <div className="grid md:grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-400">Photoperiod On:</span>{' '}
                {tent.schedules?.photoperiod_on || 'Not set'}
              </div>
              <div>
                <span className="text-gray-400">Photoperiod Off:</span>{' '}
                {tent.schedules?.photoperiod_off || 'Not set'}
              </div>
              <div>
                <span className="text-gray-400">Quiet Hours:</span>{' '}
                {tent.schedules?.quiet_hours_start && tent.schedules?.quiet_hours_end
                  ? `${tent.schedules.quiet_hours_start} - ${tent.schedules.quiet_hours_end}`
                  : 'Not set'}
              </div>
            </div>
          </div>

          <div className="text-sm text-gray-400">
            To modify these settings, edit the add-on configuration in Home Assistant.
          </div>
        </div>
      )}
    </div>
  )
}
