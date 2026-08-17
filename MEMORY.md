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
- (2026-07-24) Branch `voz/light-cycles-v2` (v1.3.1, not merged/pushed): Light Cycle card reworked per Alex feedback ("lights off is not editable, i want sliders"). Day bar is now the primary editor: pointer-event drag (touch-safe, `touch-none`, 28px handle hit targets, 15-min snap) with start/end circular handles + span-body drag to shift the window; lights-off is a real time input; duration = (off - on) mod 24h, equal times = 24h; live clamp to mode bounds. Shared state is (onMin, duration) in minutes inside LightCycleCard.jsx. Backend unchanged except new `duration_hours_from_times()` helper in light_scheduler.py + tests. Second commit adds backup native HA automations: saving with enabled=true upserts `tentos_light_cycle_<tent_id>_on/_off` (time triggers, homeassistant.turn_on/off on all light slots) via ha_client config API; enabled=false deletes them; idempotency = get_automation_config(id) existence check before create-vs-update/delete-vs-skip; write failure still saves schedule, returns `warning` in PUT response (UI shows it under the save button) + logs a light_schedule event. Builder is pure (`build_light_cycle_automations`) and unit-tested.
- (2026-07-24) tests/test_vpd.py has 5 pre-existing failures on master (TestVPDRanges — calculate_vpd rounds to 1 decimal, ranges too tight); not caused by light-cycle work.


## Known Issues

- (2026-08-16) The live `/api/tents/{id}` payload previously omitted actuator entity IDs, leaving the Automation Editor Device selector empty. `TentState.update_actuator()` now includes the slot's `entity_id`, and the editor expands sensor `_entities` maps through `automationEntities.js`.
- (2026-08-16) Fixed the advanced Automation Editor's silent save failure: `AutomationEditor.jsx` used obsolete `/api/automations/ha/*` URLs while FastAPI exposes `/api/automations/*`, and it treated non-2xx responses as success. The editor now uses the live routes, surfaces API errors, and the backend exposes the previously missing update route.

## Important Patterns

- (2026-07-24) v1.3.0 light cycles: per-tent veg/flower photoperiod slider (LightCycleCard.jsx in TentDetail Settings), backend light_scheduler.py enforces via ha_client every 60s, PUT /api/tents/{id}/light-cycle. Veg 12-24h, flower 6-12h. Manual overrides beat the scheduler.
- (2026-07-24) Remote access: tentos.alexsears.org -> tunnel (CT 112) -> 192.168.77.50:8109, Cloudflare Access app "tentos" (Alex only reusable allow + Home network bypass). Port 8099 on the HA host is HomeOS, tentOS is host port 8109.
- (2026-07-24) android-app v1.2.0 (versionCode 3): server.url now https://tentos.alexsears.org (was LAN IP) so the app works remotely; APK published on GitHub release android-v1.1.0 (asset clobbered on rebuilds).
