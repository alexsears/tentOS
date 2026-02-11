# TentOS

A Home Assistant add-on for monitoring and automating indoor grow tents and grow cabinets.

![TentOS Dashboard](docs/screenshot.png)

## Features

- **Real-time Monitoring** - Temperature, humidity, VPD, CO2, light levels, and more
- **Automated Controls** - Create HA automations from quick-start templates (light schedules, fan curves, sensor triggers)
- **Smart Alerts** - Notifications when temperature, humidity, or other conditions go out of range
- **VPD Calculation** - Automatic vapor pressure deficit calculation with growth-stage-aware targets
- **Growth Stage Tracking** - Monitor seedling, veg, flower stages with day counters and auto-detection from light schedule
- **Event Logging** - Track waterings, feedings, refills, maintenance activities, plus HA entity state history
- **Historical Reports** - Charts and CSV export for any date range
- **Environment Scoring** - At-a-glance health score (0-100) per tent based on targets
- **Developer Chat** - Real-time in-app chat for feature requests and support
- **One-Click Updates** - Update TentOS directly from the Settings page
- **Entity Browser** - Browse and assign HA entities to tents from the UI
- **Drag-and-Drop Tent Builder** - Configure tents visually in Settings
- **Temperature Unit Toggle** - Switch between Fahrenheit and Celsius

## Installation

### Add Repository

1. In Home Assistant, go to **Settings > Add-ons > Add-on Store**
2. Click the three dots menu (top right) > **Repositories**
3. Add: `https://github.com/alexsears/tentOS`
4. Click **Add** then refresh the page

### Install Add-on

1. Find "TentOS" in the add-on store
2. Click **Install**
3. Configure your tents in the **Configuration** tab (or use the Tent Builder in Settings after starting)
4. Start the add-on
5. Click **Open Web UI** or access via the sidebar

## Configuration

Configure tents in the add-on options or via the Tent Builder UI:

```yaml
log_level: info
developer_ha_user: ""  # Your HA username for dev badge in chat
tents:
  - name: "Veg Tent"
    description: "Vegetative growth chamber"
    sensors:
      temperature:
        - sensor.tent_temperature
      humidity:
        - sensor.tent_humidity
      co2: sensor.tent_co2
      reservoir_level: sensor.reservoir_percent
      leak_sensor: binary_sensor.tent_leak
    actuators:
      light:
        - switch.tent_light
      exhaust_fan:
        - fan.tent_exhaust
      circulation_fan:
        - fan.tent_circ
      humidifier: switch.tent_humidifier
      water_pump:
        - switch.water_pump
    targets:
      temp_day_min: 22
      temp_day_max: 28
      temp_night_min: 18
      temp_night_max: 24
      humidity_day_min: 50
      humidity_day_max: 70
      humidity_night_min: 50
      humidity_night_max: 65
    schedules:
      photoperiod_on: "06:00"
      photoperiod_off: "22:00"
    notifications:
      enabled: true
      alert_temp_out_of_range: true
      alert_humidity_out_of_range: true
      alert_leak_detected: true
      alert_reservoir_low: true
    growth_stage:
      stage: "veg"
      flower_start_date: ""
      auto_flip_enabled: false
```

### Sensor Types

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

### Actuator Types

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

### Finding Entity IDs

1. Go to **Developer Tools > States** in Home Assistant
2. Search for your sensors/switches
3. Copy the entity_id (e.g., `sensor.tent_temperature`)
4. Or use the **Entity Browser** in TentOS Settings

## VPD Reference

| VPD (kPa) | Stage |
|-----------|-------|
| 0.4 - 0.8 | Seedlings/clones |
| 0.8 - 1.0 | Early veg |
| 1.0 - 1.2 | Late veg |
| 1.2 - 1.5 | Flower |
| 1.5+ | Late flower |

Formula: `VPD = SVP * (1 - RH/100)` where `SVP = 0.6108 * exp(17.27 * T / (T + 237.3))`

TentOS automatically adjusts VPD targets based on growth stage and flower week.

## API

### Tents
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/tents` | GET | List all tents with current state |
| `/api/tents/{id}` | GET | Get tent details |
| `/api/tents/{id}/actions` | POST | Perform action (toggle_light, set_fan, turn_on, turn_off, set_override) |
| `/api/tents/{id}/history` | GET | Get sensor history (24h, 7d, 30d) |
| `/api/tents/{id}/growth-stage` | GET/PUT | Get/set growth stage |

### Events
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/events` | GET | List events (filterable by tent, type, time) |
| `/api/events` | POST | Create event |
| `/api/events/{id}` | DELETE | Delete event |
| `/api/events/ha-history` | GET | Get HA entity state history |

### Automations
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/automations` | GET | List automations (filtered to tent-related by default) |
| `/api/automations` | POST | Create automation from template |
| `/api/automations/ha` | GET | List all HA automations |
| `/api/automations/templates/list` | GET | List available templates |

### Reports
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/reports/{tent_id}` | GET | Get report data for date range |
| `/api/reports/{tent_id}/export` | GET | Export CSV |

### Chat
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/chat/messages` | GET | Get message history |
| `/api/chat/messages` | POST | Send message |
| `/api/chat/user` | GET | Get user profile |
| `/api/chat/user/nickname` | PUT | Set nickname |

### System
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check (version, HA connection status) |
| `/api/alerts/summary` | GET | Get active alerts summary |
| `/api/system/entities` | GET | Browse HA entities |
| `/api/config` | GET/POST | Read/write tent configuration |
| `/api/updates/check` | GET | Check for updates |
| `/api/updates/changelog` | GET | Get recent changes |
| `/api/updates/trigger-update` | POST | Trigger update via HA |
| `/api/camera/{entity_id}/stream` | GET | Camera stream proxy |
| `/api/ws` | WS | WebSocket for real-time tent updates + chat |

## Development

```bash
# Clone repo
git clone https://github.com/alexsears/tentOS
cd tentOS/tentos/app

# Backend (auto-enters dev mode with mock data)
cd backend
pip install -r requirements.txt
python -m uvicorn main:app --reload --port 8100

# Frontend (proxies /api to backend)
cd ../frontend
npm install
npm run dev
```

Dev mode activates automatically when `/data` doesn't exist, providing mock sensor data for two tents with simulated temperature and humidity fluctuations.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3 / FastAPI / Uvicorn |
| Frontend | React 18 / Vite 5 / Tailwind CSS 3 |
| Charts | ECharts + Recharts |
| Database | SQLite (aiosqlite + SQLAlchemy async) |
| Drag & Drop | @dnd-kit |
| Reverse Proxy | Nginx |
| Container | Alpine Linux 3.18 (HA base images) |
| Real-time | WebSocket (state changes + chat) |
| HA Communication | WebSocket API + REST API |

## Security

- Uses Home Assistant Supervisor authentication tokens
- All data stored locally in `/data`
- No cloud connectivity required (telemetry is opt-in)
- Tokens are never logged
- Chat messages are rate-limited and sanitized

## Troubleshooting

### Add-on won't start
1. Check logs: **Settings > Add-ons > TentOS > Logs**
2. Verify entity IDs exist in Home Assistant
3. Ensure sensors are reporting values

### Entities show "unavailable"
- Check the entity exists in HA Developer Tools
- Verify the integration providing the entity is working
- Some entities may take time to report after HA restart

### WebSocket disconnects
- Normal during HA restarts
- Auto-reconnects within 5 seconds
- Check HA logs for supervisor issues

### Automations not showing
- Ensure your HA automations reference tent entity IDs
- Toggle between "My Tent" and "All HA" views
- HA automations need `automation.` entity prefix

## Support

- **GitHub Issues**: [github.com/alexsears/tentOS/issues](https://github.com/alexsears/tentOS/issues)
- **Developer Chat**: Use the Chat tab in the app

## License

MIT License - See [LICENSE](LICENSE)
