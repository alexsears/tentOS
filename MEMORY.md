# Project Memory

> This file is maintained by Claude Code. It persists important context across sessions.
> **Do not delete this file.** It is auto-committed to git by Voz.

## Key Decisions


## Architecture Notes

- (2026-07-22) `Dockerfile.standalone` builds the React UI and serves it from FastAPI using `FRONTEND_DIR`; this is the standalone website/Cloud Run path and remains separate from the Home Assistant nginx add-on path.
- (2026-07-22) `android-app` is a Capacitor 7 Android shell for the hosted standalone TentOS site; Capacitor 7 is used for compatibility with this workstation's Node 20 runtime.


## Current State


## Known Issues


## Important Patterns

