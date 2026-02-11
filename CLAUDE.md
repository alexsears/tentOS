# TentOS - Development Reference

## What This Is

TentOS is a Home Assistant add-on for monitoring and automating indoor grow tents. It runs as a Docker container inside HA, accessible via ingress. Version 1.2.12.

**Repo:** https://github.com/alexsears/tentOS
**Slug:** `tentos`

## Architecture

```
Nginx (:8099) ──> Static files (React SPA from /app/frontend/dist)
              ──> /api/* proxy to FastAPI (:8100)
              ──> /api/ws WebSocket proxy to FastAPI
```

- **Backend:** Python 3 / FastAPI / Uvicorn / SQLAlchemy (async) / aiosqlite
- **Frontend:** React 18 / Vite 5 / Tailwind CSS 3 / ECharts + Recharts
- **Database:** SQLite at `/data/tent_garden.db` (container) or `app/backend/data/tent_garden.db` (dev)
- **Container:** Alpine Linux 3.18 (HA base images), supports aarch64 + amd64

## Project Structure

```
tentos/                          # Root (HA add-on repo)
  repository.json                # HA repo metadata
  README.md                      # User-facing docs
  CLAUDE.md                      # This file
  telemetry-worker/              # Cloudflare Worker for install stats
  tentos/                        # The actual add-on
    config.yaml                  # HA add-on manifest (version, schema, ports)
    build.yaml                   # Docker base images per arch
    Dockerfile                   # Container build
    run.sh                       # Startup script (bashio)
    nginx.conf                   # Reverse proxy config
    CHANGELOG.md                 # Version history
    DOCS.md                      # In-app documentation
    translations/                # i18n
    app/
      backend/
        main.py                  # FastAPI app, lifespan, WebSocket endpoint
        config.py                # Settings, TentConfig, load/save config
        database.py              # SQLAlchemy models
        ha_client.py             # HA WebSocket + REST client (with dev mock mode)
        state_manager.py         # Tent state tracking, VPD calc, alerts, history
        requirements.txt         # Python deps
        run_dev.py               # Dev server launcher
        data/options.json        # Mock config for local dev
        routes/
          tents.py               # Tent CRUD + actions (toggle, fan, override)
          events.py              # Event logging + HA entity history
          alerts.py              # Alert management
          automations.py         # HA automation discovery + templates
          reports.py             # Historical data + CSV export
          camera.py              # Camera proxy
          chat.py                # Developer chat (WebSocket)
          config.py              # Config read/write API
          system.py              # Health, entity browser
          updates.py             # Version check + update trigger
          telemetry.py           # Install ping
      frontend/
        package.json             # React deps
        vite.config.js           # Vite config (proxy /api to :8100 in dev)
        tailwind.config.js
        index.html
        src/
          main.jsx               # React entry
          App.jsx                # Router, nav, header, PreloadContext
          index.css              # Tailwind + custom styles
          pages/
            Home.jsx             # Dashboard - tent cards grid
            TentDetail.jsx       # Single tent detail view
            Automations.jsx      # HA automations + templates
            Events.jsx           # Event log + HA entity history
            Reports.jsx          # Historical charts
            Chat.jsx             # Developer chat
            Settings.jsx         # Tent builder + entity browser
          components/
            TentCard.jsx         # Tent summary card
            TentBuilder.jsx      # Tent config drag-and-drop
            AutomationEditor.jsx # Automation create/edit
            EntityInventory.jsx  # HA entity browser
            EventLog.jsx         # Event list
            SensorChart.jsx      # Sensor data chart
            AlertBanner.jsx      # Global alert banner
            CameraFeed.jsx       # Camera stream
          hooks/
            useTents.js          # Tent state + actions hook
            useWebSocket.js      # WebSocket connection hook
            useTemperatureUnit.jsx  # F/C toggle context
            useChat.js           # Chat hook
          utils/
            api.js               # apiFetch helper (ingress-aware)
      shared/                    # Shared utilities
      tests/                     # Test suite (alerts, schedules, VPD)
```

## Key Concepts

### Tent Configuration
- Configured via HA add-on options (options.json) or Tent Builder UI (config.json)
- config.json takes priority over options.json
- Tent ID is derived from name: `name.lower().replace(" ", "_")`
- Each tent has: sensors, actuators, targets, schedules, notifications, growth_stage, control_settings

### State Management
- `StateManager` maps HA entity IDs to tents via `entity_to_tent` dict
- Subscribes to HA state_changed events via WebSocket
- Calculates VPD from temp + humidity (auto-detects Fahrenheit, normalizes to Celsius)
- Calculates environment score (0-100) based on targets
- Background loops: alert check (60s), history recording (300s)
- Broadcasts updates to connected WebSocket clients

### HA Integration
- WebSocket API for real-time state changes + service calls
- REST API for history, automations, entity states
- Supervisor token passed via environment variables
- Dev mode auto-detected when `/data` doesn't exist (uses mock data)

### Ingress
- HA proxies the add-on through ingress at `/api/hassio_ingress/{token}/`
- Frontend `apiFetch()` auto-detects ingress path from `window.location.pathname`
- FastAPI `root_path` set from `INGRESS_PATH` env var
- Nginx on :8099 serves static + proxies /api to :8100

## Database Models

| Model | Table | Purpose |
|-------|-------|---------|
| Event | events | Activity log (watering, feeding, maintenance) |
| Alert | alerts | Active alerts with severity + acknowledgement |
| Override | overrides | Manual actuator overrides with expiry |
| MaintenanceReminder | maintenance_reminders | Scheduled maintenance |
| SensorHistory | sensor_history | Local sensor value history |
| ChatMessage | chat_messages | Developer chat messages |
| ChatUser | chat_users | Chat user profiles |
| TelemetrySettings | telemetry_settings | Anonymous install tracking |

## API Routes

All routes prefixed with `/api/`.

| Route | Prefix | File |
|-------|--------|------|
| Tents | /api/tents | routes/tents.py |
| Events | /api/events | routes/events.py |
| Alerts | /api/alerts | routes/alerts.py |
| Automations | /api/automations | routes/automations.py |
| Reports | /api/reports | routes/reports.py |
| Camera | /api/camera | routes/camera.py |
| Chat | /api/chat | routes/chat.py |
| Config | /api/config | routes/config.py |
| System | /api/system | routes/system.py |
| Updates | /api/updates | routes/updates.py |
| Health | /api/health | main.py (direct) |
| WebSocket | /api/ws | main.py (direct) |

## Development

### Local Dev (no HA needed)
```bash
# Backend - auto-enters dev mode with mock data
cd tentos/app/backend
pip install -r requirements.txt
python -m uvicorn main:app --reload --port 8100

# Frontend - proxies /api to :8100
cd tentos/app/frontend
npm install
npm run dev
```

Dev mode activates when `/data` doesn't exist. Mock data simulates two tents with fluctuating temp/humidity.

### Build for HA
The Dockerfile:
1. Installs python3, nodejs, npm, sqlite, nginx
2. `pip install` backend requirements
3. `npm install && npm run build` frontend
4. Copies backend, nginx.conf, run.sh
5. Exposes :8099

### Version Bumps
Update version in `tentos/config.yaml` — the backend reads it at startup.

## Conventions

- Backend: async everywhere (aiosqlite, aiohttp, FastAPI async routes)
- Frontend: dark theme, green accent (`green-600`), plant emoji (leaf icon)
- Temperature: stored internally as Celsius, auto-converts from Fahrenheit
- Entity IDs: standard HA format (`sensor.tent_temperature`, `switch.tent_light`)
- Automations created by TentOS are prefixed with `tentos_` in their HA entity ID
- Config priority: config.json (Tent Builder UI) > options.json (HA add-on config)
