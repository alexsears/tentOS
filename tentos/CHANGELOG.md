# Changelog

## 1.2.1
- Group automations by type (Lighting, Climate, Ventilation, Humidity, etc.)
- Add trigger tags: Schedule, Threshold, Sensor, State, Sun, Motion
- Toggle between "By Type" and "List" views
- Collapsible category groups with active count

## 1.2.0
- **BREAKING**: Remove TentOS rules system - now uses Home Assistant automations only
- Add quick-create templates that generate real HA automations
- Templates include: High/Low Temp, High/Low Humidity, Light Schedule, Circulation Fan
- Automations created by TentOS are prefixed with [TentOS] and can be edited in HA
- Simplified Automations page with search and better organization

## 1.1.63
- Fix React hooks order violation causing blank screen crash on Automations page

## 1.1.62
- Add CHANGELOG.md for HA add-on page
- Remove 32-bit ARM architectures (armhf, armv7) - only amd64 and aarch64 now

## 1.1.61
- Fix Automations page crash with better error handling
- Separate HA automations fetch so failures don't break page

## 1.1.60
- Fix /api/automations/ha route ordering (404 fix)
- Default growth stage to "veg" instead of "unknown"
- Add telemetry dashboard at /dashboard endpoint

## 1.1.59
- Add telemetry tracking for install statistics
- Ping on startup to track active users

## 1.1.58
- Add HA automations tab to Automations page
- Show and control Home Assistant automations from TentOS

## 1.1.57
- Fetch GitHub commits as changelog for updates
- Fix update check to use GitHub raw config

## 1.1.56
- Add developer chat feature
- Real-time WebSocket chat with DEV badge
- Anonymous users with optional nicknames

## 1.1.55
- Growth stage tracking (Veg/Flower)
- Auto-detect stage from light schedule
- Flower week counter

## 1.1.54
- Auto-update support
- One-click updates from TentOS Settings

## 1.1.53
- Improved sensor slot management
- Multi-entity support for temperature/humidity

## 1.1.52
- VPD calculation and display
- Environment score based on targets

## 1.1.51
- Initial public release
- Tent monitoring dashboard
- Automation rules engine
- Alert system
