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


## Known Issues


## Important Patterns

