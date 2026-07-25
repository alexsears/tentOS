# Project Memory

> This file is maintained by Claude Code. It persists important context across sessions.
> **Do not delete this file.** It is auto-committed to git by Voz.

## Key Decisions


## Architecture Notes

- (2026-07-22) `Dockerfile.standalone` builds the React UI and serves it from FastAPI using `FRONTEND_DIR`; this is the standalone website/Cloud Run path and remains separate from the Home Assistant nginx add-on path.
- (2026-07-22) `android-app` is a Capacitor 7 Android shell for the hosted standalone TentOS site; Capacitor 7 is used for compatibility with this workstation's Node 20 runtime.
- (2026-07-22) The LAN APK targets the HA host at `http://192.168.77.50:8109`; add-on container port 8099 maps to LAN host port 8109 to avoid a collision with an existing service on 8099. The HA/Supervisor token remains inside the add-on.
- (2026-07-22) Mobile UI uses a fixed five-item bottom navigation with Events/Chat/Settings in a More sheet; dashboard cards hide camera previews below the `sm` breakpoint and use touch-sized responsive actuator grids.


## Current State

- (2026-07-24) Branch `voz/light-cycles` (v1.3.0, not merged): per-tent veg/flower light cycle. Backend `app/backend/light_scheduler.py` (LightScheduler loop, 60s tick, switches HA light entities, skips active Overrides, logs `light_schedule` Events) + `PUT /api/tents/{id}/light-cycle` in routes/tents.py (bounds: veg 12-24h, flower 6-12h; persists schedules.light_cycle + photoperiod_on/off + syncs growth_stage). Frontend `src/components/LightCycleCard.jsx` (slider + 24h bar + presets) mounted in TentDetail settings tab. Tests in tests/test_light_cycle.py.
- (2026-07-24) tests/test_vpd.py has 5 pre-existing failures on master (TestVPDRanges — calculate_vpd rounds to 1 decimal, ranges too tight); not caused by light-cycle work.


## Known Issues


## Important Patterns

- (2026-07-24) v1.3.0 light cycles: per-tent veg/flower photoperiod slider (LightCycleCard.jsx in TentDetail Settings), backend light_scheduler.py enforces via ha_client every 60s, PUT /api/tents/{id}/light-cycle. Veg 12-24h, flower 6-12h. Manual overrides beat the scheduler.
- (2026-07-24) Remote access: tentos.alexsears.org -> tunnel (CT 112) -> 192.168.77.50:8109, Cloudflare Access app "tentos" (Alex only reusable allow + Home network bypass). Port 8099 on the HA host is HomeOS, tentOS is host port 8109.
- (2026-07-24) android-app v1.2.0 (versionCode 3): server.url now https://tentos.alexsears.org (was LAN IP) so the app works remotely; APK published on GitHub release android-v1.1.0 (asset clobbered on rebuilds).
