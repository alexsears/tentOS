# TentOS Documentation

Monitor and automate your indoor grow tents with real-time dashboards, automated controls, and smart alerts.

## Features

### Dashboard
- **Real-time Monitoring** - Temperature, humidity, VPD, CO2, light levels
- **Environment Score** - At-a-glance health indicator for each tent
- **Quick Actions** - Control lights, fans, pumps with one click
- **Live Charts** - Visualize sensor data over time

### Automations
- **TentOS Rules** - Create custom automation rules (temp triggers, schedules, etc.)
- **Home Assistant Integration** - View and control HA automations for your tent entities
- **Rule Templates** - Quick-start with preset automation patterns

### Reports
- **Historical Data** - View temperature, humidity, VPD trends
- **Custom Date Ranges** - Analyze data by day, week, month, or custom range
- **CSV Export** - Download data for external analysis

### Growth Tracking
- **Growth Stages** - Track seedling, vegetative, flowering phases
- **Flower Counter** - Days since flower flip with auto-detection
- **Stage History** - Log when stages changed

### Events
- **Activity Logging** - Record waterings, feedings, maintenance
- **Searchable History** - Filter events by type and date
- **Custom Notes** - Add details to each event

### Chat
- **Developer Chat** - Request features and get support
- **Community Room** - See what others are asking
- **Real-time Updates** - Messages appear instantly

### Updates
- **Version Checking** - See when updates are available
- **One-Click Update** - Update directly from the app
- **Changelog** - View recent changes from GitHub commits

## Configuration

Configure your tents in the add-on options tab. Each tent can have:

### Sensors
| Type | Description |
|------|-------------|
| `temperature` | Temperature sensor(s) - supports multiple |
| `humidity` | Humidity sensor(s) - supports multiple |
| `co2` | CO2 sensor |
| `light_level` | Light intensity sensor |
| `reservoir_level` | Water level sensor |
| `leak_sensor` | Leak/water detection |
| `power_usage` | Power monitoring |
| `camera` | Camera entity(s) |

### Actuators
| Type | Description |
|------|-------------|
| `light` | Grow light(s) |
| `exhaust_fan` | Exhaust/ventilation fan(s) |
| `circulation_fan` | Circulation fan(s) |
| `humidifier` | Humidifier switch |
| `dehumidifier` | Dehumidifier switch |
| `heater` | Heater switch |
| `ac` | Air conditioner |
| `water_pump` | Irrigation pump(s) |
| `drain_pump` | Drain pump |

### Targets
Set ideal ranges for day and night:
- Temperature min/max (day & night)
- Humidity min/max (day & night)
- CO2 target
- Max fan speed

### Schedules
- `photoperiod_on` / `photoperiod_off` - Light schedule (e.g., "06:00" / "00:00")
- `quiet_hours_start` / `quiet_hours_end` - Reduce fan activity during quiet hours

## Example Configuration

```yaml
tents:
  - name: "Flower Tent"
    description: "4x4 flowering chamber"
    sensors:
      temperature:
        - sensor.flower_temp
      humidity:
        - sensor.flower_humidity
      co2: sensor.flower_co2
      reservoir_level: sensor.res_level
    actuators:
      light:
        - switch.flower_light
      exhaust_fan:
        - fan.flower_exhaust
      humidifier: switch.flower_humidifier
    targets:
      temp_day_min: 24
      temp_day_max: 28
      temp_night_min: 20
      temp_night_max: 24
      humidity_day_min: 45
      humidity_day_max: 55
    schedules:
      photoperiod_on: "06:00"
      photoperiod_off: "18:00"
    growth_stage:
      stage: "flower"
      flower_start_date: "2024-01-15"
```

## Finding Entity IDs

1. Go to **Developer Tools > States** in Home Assistant
2. Search for your device (e.g., "tent" or "grow")
3. Copy the entity_id (e.g., `sensor.tent_temperature`)
4. Or use the Entity Browser in TentOS Settings

## VPD Reference

| VPD (kPa) | Recommended Stage |
|-----------|-------------------|
| 0.4 - 0.8 | Seedlings, clones |
| 0.8 - 1.0 | Early veg |
| 1.0 - 1.2 | Late veg |
| 1.2 - 1.5 | Flower |
| 1.5+ | Late flower (with caution) |

## Troubleshooting

### Sensors show "unavailable"
- Verify the entity exists in HA Developer Tools
- Check that the integration providing the sensor is working
- Some sensors take time to report after HA restart

### Automations not showing
- Ensure your HA automations reference tent entity IDs
- Check the Automations debug endpoint in browser console
- HA automations need `automation.` prefix

### WebSocket disconnects
- Normal during HA restarts - auto-reconnects in 5 seconds
- Check HA supervisor logs if persistent

## Support

- **GitHub Issues**: [github.com/alexsears/tentOS/issues](https://github.com/alexsears/tentOS/issues)
- **Developer Chat**: Use the Chat tab in the app
