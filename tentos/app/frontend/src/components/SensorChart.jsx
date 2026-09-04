import { useState, useEffect } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceArea
} from 'recharts'
import { format } from 'date-fns'
import { apiFetch } from '../utils/api'
import { useTemperatureUnit } from '../hooks/useTemperatureUnit'
import { useShadeLights, LIGHT_BAND_FILL, LIGHT_BAND_OPACITY } from '../utils/lightShading'

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
  const [lightPeriods, setLightPeriods] = useState([])
  const [loading, setLoading] = useState(true)
  const [shadeLights] = useShadeLights()
  // History is stored in Celsius; the chart showed it raw and unlabelled while
  // the rest of the app followed the header's unit toggle.
  const { unit: tempUnit, getTempUnit } = useTemperatureUnit()
  const isTemp = (sensor) => sensor === 'temperature' || /^temperature_\d+$/.test(sensor)
  const toDisplay = (sensor, value) =>
    isTemp(sensor) && tempUnit === 'F' && value != null
      ? Math.round(((value * 9) / 5 + 32) * 10) / 10
      : value
  const unitFor = (sensor) => {
    if (isTemp(sensor)) return getTempUnit()
    if (sensor === 'humidity') return '%'
    if (sensor === 'vpd') return ' kPa'
    if (sensor === 'co2') return ' ppm'
    return ''
  }

  useEffect(() => {
    setLoading(true)
    apiFetch(`api/tents/${tentId}/history?range=${range}`)
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
            timeMap.get(time)[sensorType] = toDisplay(sensorType, reading.value)
          }
        }

        // Convert to array and sort
        const chartData = Array.from(timeMap.values())
          .sort((a, b) => a.time - b.time)

        setData(chartData)
        setLightPeriods(response.light_periods || [])
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [tentId, range, sensors.join(','), tempUnit])

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

  // The bands live on the same numeric time axis as the readings; clip them to the
  // plotted span so a light that was on before the first reading does not push the
  // axis out beyond the data.
  const firstTime = data[0].time
  const lastTime = data[data.length - 1].time
  const bands = shadeLights
    ? lightPeriods
      .map(period => ({
        start: Math.max(firstTime, new Date(period.start).getTime()),
        end: Math.min(lastTime, new Date(period.end).getTime())
      }))
      .filter(band => Number.isFinite(band.start) && Number.isFinite(band.end) && band.end > band.start)
    : []

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#2d3a5c" />
        <XAxis
          dataKey="time"
          type="number"
          scale="time"
          domain={['dataMin', 'dataMax']}
          tickFormatter={formatTime}
          stroke="#6b7280"
          tick={{ fill: '#9ca3af', fontSize: 12 }}
        />
        <YAxis stroke="#6b7280" tick={{ fill: '#9ca3af', fontSize: 12 }} />
        {bands.map(band => (
          <ReferenceArea
            key={`${band.start}-${band.end}`}
            x1={band.start}
            x2={band.end}
            ifOverflow="hidden"
            fill={LIGHT_BAND_FILL}
            fillOpacity={LIGHT_BAND_OPACITY}
            stroke="none"
          />
        ))}
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
            name={`${LABELS[sensor] || sensor} (${unitFor(sensor).trim()})`}
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
