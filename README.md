# TentOS

A Home Assistant add-on for monitoring and automating indoor grow tents and grow cabinets.

![TentOS Dashboard](docs/screenshot.png)

## Features

- **Real-time Monitoring** - Temperature, humidity, VPD, CO2, light levels, and more
- **Automated Controls** - Light schedules, fan curves, sensor-triggered automations
- **Smart Alerts** - Get notified when conditions go out of range
- **Event Logging** - Track waterings, feedings, refills, maintenance activities
- **Growth Stage Tracking** - Monitor seedling, veg, flower stages with day counters
- **Historical Reports** - Charts and CSV export for any date range
- **Developer Chat** - Request features and get support in-app
- **One-Click Updates** - Update TentOS directly from the Settings page
- **Beautiful Dashboard** - Dark theme UI with charts and quick actions
- **VPD Calculation** - Automatic vapor pressure deficit calculation
- **Environment Scoring** - At-a-glance health indicator per tent

## Installation

### Add Repository

1. In Home Assistant, go to **Settings > Add-ons > Add-on Store**
2. Click the three dots menu (top right) > **Repositories**
3. Add: `https://github.com/alexsears/tentOS`
4. Click **Add** then refresh the page

### Install Add-on

1. Find "TentOS" in the add-on store
2. Click **Install**
3. Configure your tents in the **Configuration** tab
4. Start the add-on
5. Click **Open Web UI** or access via the sidebar

## Configuration

Configure tents in the add-on options:

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

### Finding Entity IDs

1. Go to **Developer Tools > States** in Home Assistant
2. Search for your sensors/switches
3. Copy the entity_id (e.g., `sensor.tent_temperature`)
4. Or use the Entity Browser in TentOS Settings page

## VPD Reference

| VPD (kPa) | Stage |
|-----------|-------|
| 0.4 - 0.8 | Seedlings/clones |
| 0.8 - 1.0 | Early veg |
| 1.0 - 1.2 | Late veg |
| 1.2 - 1.5 | Flower |
| 1.5+ | Late flower |

Formula: `VPD = SVP * (1 - RH/100)` where `SVP = 0.6108 * exp(17.27 * T / (T + 237.3))`

## API Endpoints

### Tents
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/tents` | GET | List all tents |
| `/api/tents/{id}` | GET | Get tent details |
| `/api/tents/{id}/actions` | POST | Perform action |
| `/api/tents/{id}/history` | GET | Get sensor history |
| `/api/tents/{id}/growth-stage` | GET/PUT | Get/set growth stage |

### Events
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/events` | GET | List events |
| `/api/events` | POST | Create event |
| `/api/events/{id}` | DELETE | Delete event |

### Automations
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/automations` | GET | List TentOS rules |
| `/api/automations` | POST | Create rule |
| `/api/automations/ha` | GET | List HA automations |
| `/api/automations/templates/list` | GET | List rule templates |

### Reports
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/reports/{tent_id}` | GET | Get report data |
| `/api/reports/{tent_id}/export` | GET | Export CSV |

### Chat
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/chat/messages` | GET | Get message history |
| `/api/chat/messages` | POST | Send message |
| `/api/chat/user` | GET | Get user profile |
| `/api/chat/user/nickname` | PUT | Set nickname |

### Updates
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/updates/check` | GET | Check for updates |
| `/api/updates/changelog` | GET | Get recent changes |
| `/api/updates/trigger-update` | POST | Trigger update via HA |

### System
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/alerts/summary` | GET | Get active alerts |
| `/api/system/entities` | GET | Browse HA entities |

## Security

- Uses Home Assistant Supervisor authentication
- All data stored locally in `/data`
- No cloud connectivity required
- Tokens are never logged

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

## Development

```bash
# Clone repo
git clone https://github.com/alexsears/tentOS
cd tentOS/tentos/app

# Backend
cd backend
pip install -r requirements.txt
python -m uvicorn main:app --reload --port 8100

# Frontend
cd frontend
npm install
npm run dev
```

## Support

- **GitHub Issues**: [github.com/alexsears/tentOS/issues](https://github.com/alexsears/tentOS/issues)
- **Developer Chat**: Use the Chat tab in the app to request features

## License

MIT License - See [LICENSE](LICENSE)
