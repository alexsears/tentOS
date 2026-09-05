// Shared icon vocabulary for the whole UI.
//
// One place decides which glyph stands for a fan, a light, a reading, or a
// page, so every surface draws the same thing. Icons are lucide-react
// components: pass `size` and `className` like any SVG. No emoji anywhere.
import {
  ArrowDownToLine,
  Camera,
  ChartLine,
  Cloud,
  Cylinder,
  Droplet,
  Droplets,
  Fan,
  Flame,
  Flower2,
  Gauge,
  History,
  LayoutDashboard,
  Leaf,
  Lightbulb,
  MessageSquare,
  RefreshCw,
  ScrollText,
  Settings,
  Snowflake,
  Sparkles,
  Sprout,
  Thermometer,
  TriangleAlert,
  Waves,
  Wind,
  Workflow,
  Zap,
} from 'lucide-react'

// Actuator slot base type -> icon. Numbered variants (exhaust_fan_2) resolve
// through actuatorIcon().
export const ACTUATOR_ICONS = {
  light: Lightbulb,
  exhaust_fan: Fan,
  circulation_fan: RefreshCw,
  humidifier: Droplets,
  dehumidifier: Wind,
  heater: Flame,
  ac: Snowflake,
  water_pump: Waves,
  drain_pump: ArrowDownToLine,
  co2_injector: Cylinder,
}

export function actuatorBaseType(slot) {
  if (!slot) return slot
  if (ACTUATOR_ICONS[slot]) return slot
  const match = slot.match(/^(.+)_(\d+)$/)
  if (match && ACTUATOR_ICONS[match[1]]) return match[1]
  return slot
}

export function actuatorIcon(slot) {
  return ACTUATOR_ICONS[actuatorBaseType(slot)] || Zap
}

// Sensor slot -> icon. Numbered variants (temperature_2) resolve the same way.
export const SENSOR_ICONS = {
  temperature: Thermometer,
  humidity: Droplet,
  vpd: Gauge,
  co2: Cloud,
  camera: Camera,
}

export function sensorIcon(slot) {
  if (!slot) return Gauge
  if (SENSOR_ICONS[slot]) return SENSOR_ICONS[slot]
  const match = slot.match(/^(.+)_(\d+)$/)
  if (match && SENSOR_ICONS[match[1]]) return SENSOR_ICONS[match[1]]
  return Gauge
}

// Growth stage -> icon.
export const STAGE_ICONS = {
  seedling: Leaf,
  veg: Sprout,
  flower: Flower2,
}

export function stageIcon(stage) {
  return STAGE_ICONS[stage] || Sprout
}

// Route path -> icon, used by both the desktop nav and the phone tab bar.
export const NAV_ICONS = {
  '/': LayoutDashboard,
  '/assistant': Sparkles,
  '/climate': Gauge,
  '/reports': ChartLine,
  '/automations': Workflow,
  '/events': ScrollText,
  '/chat': MessageSquare,
  '/settings': Settings,
}

export { History as HistoryGlyph, TriangleAlert as AlertGlyph, Leaf as BrandGlyph }
