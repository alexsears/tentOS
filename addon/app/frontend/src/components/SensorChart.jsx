import { useState, useEffect } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts'
import { format } from 'date-fns'

const COLORS = {
  temperature: '#ef4444',
  humidity: '#3b82f6',
  vpd: '#22c55e',
  co2: '#f59e0b',
  light_level: '#fcd34d',
  reservoir_level: '#06b6d4'
}

const LABELS = {
  temperature: 'Temperature',
  humidity: 'Humidity',
  vpd: 'VPD',
  co2: 'CO2',
  light_level: 'Light',
  reservoir_level: 'Reservoir'
}

export function SensorChart({ tentId, sensors = ['temperature', 'humidity'], range = '24h' }) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/tents/${tentId}/history?range=${range}`)
      .then(r => r.json())
      .then(response => {
        const history = response.history || {}

        // Combine all sensor data by timestamp
        const timeMap = new Map()

        for (const [sensorType, readings] of Object.entries(history)) {
          if (!sensors.includes(sensorType)) continue

          for (const reading of readings) {
            const time = new Date(reading.timestamp).getTime()
            if (!timeMap.has(time)) {
              timeMap.set(time, { time })
            }
            timeMap.get(time)[sensorType] = reading.value
          }
        }

        // Convert to array and sort
        const chartData = Array.from(timeMap.values())
          .sort((a, b) => a.time - b.time)

        setData(chartData)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [tentId, range, sensors.join(',')])

  const formatTime = (time) => {
    const date = new Date(time)
    if (range === '24h') return format(date, 'HH:mm')
    return format(date, 'MM/dd HH:mm')
  }

  if (loading) {
    return (
      <div className="h-64 flex items-center justify-center text-gray-400">
        Loading chart...
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-gray-400">
        No data available
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#2d3a5c" />
        <XAxis
          dataKey="time"
          tickFormatter={formatTime}
          stroke="#6b7280"
          tick={{ fill: '#9ca3af', fontSize: 12 }}
        />
        <YAxis stroke="#6b7280" tick={{ fill: '#9ca3af', fontSize: 12 }} />
        <Tooltip
          contentStyle={{
            backgroundColor: '#16213e',
            border: '1px solid #2d3a5c',
            borderRadius: '8px'
          }}
          labelFormatter={(value) => format(new Date(value), 'yyyy-MM-dd HH:mm')}
        />
        <Legend />
        {sensors.map(sensor => (
          <Line
            key={sensor}
            type="monotone"
            dataKey={sensor}
            name={LABELS[sensor] || sensor}
            stroke={COLORS[sensor] || '#888'}
            strokeWidth={2}
            dot={false}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
