import { apiFetch } from '../utils/api'
import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import { Droplets, Filter, FlaskConical, Leaf, Lightbulb, StickyNote, TriangleAlert, Waves, Workflow, Wrench } from 'lucide-react'

const EVENT_ICONS = {
  watering: Droplets,
  refill: Waves,
  filter_change: Filter,
  solution_change: FlaskConical,
  maintenance: Wrench,
  note: StickyNote,
  feeding: Leaf,
  light_schedule: Lightbulb,
  alert: TriangleAlert,
  automation: Workflow
}

export function EventLog({ tentId, limit = 10 }) {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [newEvent, setNewEvent] = useState({ event_type: 'watering', notes: '' })

  const fetchEvents = () => {
    const url = tentId
      ? `api/events?tent_id=${tentId}&limit=${limit}`
      : `api/events?limit=${limit}`

    apiFetch(url)
      .then(r => r.json())
      .then(data => setEvents(data.events || []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchEvents()
  }, [tentId, limit])

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      await apiFetch('api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tent_id: tentId,
          ...newEvent
        })
      })
      setShowForm(false)
      setNewEvent({ event_type: 'watering', notes: '' })
      fetchEvents()
    } catch (err) {
      console.error(err)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold">Recent Events</h3>
        {tentId && (
          <button
            onClick={() => setShowForm(!showForm)}
            className="btn btn-primary btn-sm"
          >
            + Log Event
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="mb-4 p-4 bg-[#1a1a2e] rounded-lg">
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Event Type</label>
              <select
                value={newEvent.event_type}
                onChange={e => setNewEvent({ ...newEvent, event_type: e.target.value })}
                className="input w-full"
              >
                <option value="watering">Watering</option>
                <option value="refill">Reservoir refill</option>
                <option value="filter_change">Filter change</option>
                <option value="solution_change">Solution change</option>
                <option value="maintenance">Maintenance</option>
                <option value="note">Note</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Notes</label>
              <input
                type="text"
                value={newEvent.notes}
                onChange={e => setNewEvent({ ...newEvent, notes: e.target.value })}
                placeholder="Optional notes..."
                className="input w-full"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setShowForm(false)} className="btn btn-secondary btn-sm">
              Cancel
            </button>
            <button type="submit" className="btn btn-primary btn-sm">
              Save Event
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="text-gray-400 text-center py-4">Loading...</div>
      ) : events.length === 0 ? (
        <div className="text-gray-400 text-center py-4">No events logged</div>
      ) : (
        <div className="space-y-2">
          {events.map(event => {
            const Icon = EVENT_ICONS[event.event_type] || StickyNote
            return (
            <div
              key={event.id}
              className="flex items-center gap-3 p-3 bg-[#1a1a2e] rounded-lg"
            >
              <Icon size={18} className="flex-shrink-0 text-gray-400" aria-hidden="true" />
              <div className="flex-1">
                <div className="font-medium capitalize">
                  {event.event_type.replace('_', ' ')}
                </div>
                {event.notes && (
                  <div className="text-sm text-gray-400">{event.notes}</div>
                )}
              </div>
              <div className="text-sm text-gray-400">
                {format(new Date(event.timestamp), 'MMM d, HH:mm')}
              </div>
            </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
