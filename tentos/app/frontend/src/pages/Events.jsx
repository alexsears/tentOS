import { EventLog } from '../components/EventLog'

export default function Events() {
  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Event Log</h2>
      <div className="card">
        <EventLog limit={50} />
      </div>
    </div>
  )
}
