import { useState, useEffect } from 'react'
import { apiFetch } from '../utils/api'
import { format, formatDistanceToNow } from 'date-fns'
import { EventLog } from '../components/EventLog'

// Icons for different event types
const EVENT_ICONS = {
  device_on: '🟢',
  device_off: '⚫',
  sensor_reading: '📊',
  sensor_trigger: '⚡',
  state_change: '🔄',
  // Manual event types
  watering: '💧',
  refill: '🪣',
  filter_change: '🔄',
  solution_change: '🧪',
  maintenance: '🔧',
  note: '📝'
}

// Domain icons for entity types
const DOMAIN_ICONS = {
  switch: '🔌',
  light: '💡',
  fan: '🌀',
  sensor: '📡',
  binary_sensor: '🚨',
  climate: '🌡️',
  automation: '⚙️'
}

function HAEventItem({ event }) {
  const icon = EVENT_ICONS[event.event_type] || DOMAIN_ICONS[event.domain] || '📌'
  const time = event.timestamp ? new Date(event.timestamp) : null
  const automation = event.related_automations?.[0] // Show first related automation

  return (
    <div className="flex items-center gap-3 p-3 bg-[#1a1a2e] rounded-lg hover:bg-[#252545] transition-colors">
      <span className="text-xl flex-shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm">{event.description}</div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span className="truncate">{event.entity_id}</span>
          {automation && (
            <>
              <span className="text-gray-600">•</span>
              <a
                href={`/config/automation/edit/${automation.id}`}
                target="_top"
                className="text-blue-400 hover:text-blue-300 hover:underline truncate"
                title={`Edit automation: ${automation.name}`}
              >
                ⚙️ {automation.name}
              </a>
            </>
          )}
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        <div className="text-sm text-gray-400">
          {time ? format(time, 'HH:mm') : '-'}
        </div>
        <div className="text-xs text-gray-500">
          {time ? formatDistanceToNow(time, { addSuffix: true }) : ''}
        </div>
      </div>
    </div>
  )
}

export default function Events() {
  const [activeTab, setActiveTab] = useState('ha-history')
  const [haEvents, setHaEvents] = useState([])
  const [tents, setTents] = useState([])
  const [selectedTent, setSelectedTent] = useState('')
  const [hours, setHours] = useState(24)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    // Fetch tents first
    apiFetch('api/tents')
      .then(r => r.json())
      .then(data => {
        setTents(data.tents || [])
        if (data.tents?.length > 0) {
          setSelectedTent(data.tents[0].id)
        }
      })
      .catch(console.error)
  }, [])

  useEffect(() => {
    if (activeTab === 'ha-history') {
      loadHAHistory()
    }
  }, [activeTab, selectedTent, hours])

  const loadHAHistory = async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      params.set('hours', hours.toString())
      if (selectedTent) {
        params.set('tent_id', selectedTent)
      }

      const res = await apiFetch(`api/events/ha-history?${params}`)
      const data = await res.json()

      if (!res.ok) {
        const errorMsg = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail) || 'Failed to load history'
        throw new Error(errorMsg)
      }

      setHaEvents(data.events || [])
    } catch (e) {
      console.error('Failed to load HA history:', e)
      setError(e.message || 'Failed to load entity history')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Events</h2>
        <p className="text-gray-400">State changes and activity log</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-[#2d3a5c]">
        <button
          onClick={() => setActiveTab('ha-history')}
          className={`px-4 py-2 font-medium ${activeTab === 'ha-history' ? 'border-b-2 border-blue-500 text-blue-400' : 'text-gray-400'}`}
        >
          Entity History
        </button>
        <button
          onClick={() => setActiveTab('manual')}
          className={`px-4 py-2 font-medium ${activeTab === 'manual' ? 'border-b-2 border-green-500 text-green-400' : 'text-gray-400'}`}
        >
          Manual Log
        </button>
      </div>

      {/* HA History Tab */}
      {activeTab === 'ha-history' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-4">
            {tents.length > 0 && (
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-400">Tent:</label>
                <select
                  value={selectedTent}
                  onChange={e => setSelectedTent(e.target.value)}
                  className="input py-1"
                >
                  <option value="">All Tents</option>
                  {tents.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-400">Period:</label>
              <select
                value={hours}
                onChange={e => setHours(parseInt(e.target.value))}
                className="input py-1"
              >
                <option value="1">Last hour</option>
                <option value="6">Last 6 hours</option>
                <option value="12">Last 12 hours</option>
                <option value="24">Last 24 hours</option>
                <option value="48">Last 2 days</option>
                <option value="168">Last week</option>
              </select>
            </div>
            <button
              onClick={loadHAHistory}
              className="btn btn-primary btn-sm"
              disabled={loading}
            >
              {loading ? 'Loading...' : 'Refresh'}
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="p-3 bg-red-500/20 border border-red-500/50 rounded text-red-300">
              {error}
            </div>
          )}

          {/* Events List */}
          <div className="card">
            {loading ? (
              <div className="text-center text-gray-400 py-8">Loading entity history...</div>
            ) : haEvents.length === 0 ? (
              <div className="text-center py-8">
                <div className="text-4xl mb-4">📭</div>
                <p className="text-gray-400">No entity events found</p>
                <p className="text-sm text-gray-500 mt-2">
                  {tents.length === 0
                    ? 'Configure tent entities in Settings first'
                    : 'Try extending the time period or check your tent configuration'}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-sm text-gray-400 mb-3">
                  Showing {haEvents.length} state changes
                </div>
                {haEvents.map((event, idx) => (
                  <HAEventItem key={`${event.entity_id}-${event.timestamp}-${idx}`} event={event} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Manual Events Tab */}
      {activeTab === 'manual' && (
        <div className="card">
          <EventLog
            tentId={selectedTent || (tents[0]?.id)}
            limit={50}
          />
        </div>
      )}
    </div>
  )
}
