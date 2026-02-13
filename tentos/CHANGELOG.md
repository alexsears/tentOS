# Changelog

## 1.2.29
- Smart Filters: auto-detect entity groups (energy, power, voltage, signal, battery, integration prefixes)
- Toggle pills to hide/show entire groups at once, dramatically reducing entity list clutter
- Hide All / Show All buttons for quick bulk filtering
- Hidden group counts shown in footer and filter badge

## 1.2.28
- Dashboard actuator tiles now show real HA entity names instead of slot categories

## 1.2.27
- Fix: tent-only automations filter now matches exact entity IDs only (no more nap modes and bathroom motions)
- Fix: automations list no longer resets to "all" after toggling/deleting an automation

## 1.2.26
- Entity rename: click pencil on assigned entities to set custom display names (stored in config.customNames)
- Show entity_id suffix below name on assigned entity tiles for identification
- Mobile/touch fixes: all icon-only buttons now have text labels and larger touch targets across the app
- Growth stage badge shows visible "Change" label instead of hover-only indicator
- Customize Controls section collapsed by default, click to expand
- Quick-add slot matching uses entity name to guess correct slot (fan→exhaust_fan, water→water_pump, etc.)
- Fix: tent-only automations filter no longer falls back to showing all automations

## 1.2.25
- Hide entities: select entities and click "Hide" to remove them from the available list
- Hidden entities collapsible section at bottom with "Show" button to unhide
- Hidden entity IDs persist in config (auto-saved)

## 1.2.24
- Quick-add: single "+ Add to Tent" button appears at top after selecting entities
- Auto-detects which tent by matching entity name to tent names
- Auto-deduces slot per entity based on domain and device class, with dropdown override
- Supports bulk add of multiple selected entities at once

## 1.2.23
- Quick-add "+" button on each entity to add to a tent without drag-and-drop

## 1.2.22
- Entity list "N more" message replaced with clickable expand button

## 1.2.21
- Used slots shown at top with full tile display, unused slots grouped below as compact pills
- Available Slots section with small icon+label chips for easy scanning

## 1.2.20
- Assigned entities in tent slots now show as dashboard-style tiles with icons, state, status dots
- Drag overlay shows tile preview (centered icon, value, name) instead of plain text
- Available entity list kept as original list style for easy scanning

## 1.2.18
- Fix .toFixed() crash when HA returns sensor values as strings instead of numbers
- Wrap all .toFixed() calls with Number() in TentCard, TentDetail, and useTemperatureUnit

## 1.2.17
- Revert entity tile changes again - investigating build issue

## 1.2.15
- Revert entity inventory styling changes (caused blank screen)

## 1.2.14
- Restyle Settings entity inventory to match dashboard tile aesthetic (reverted in 1.2.15)

## 1.2.13
- Fix multi-entity actuators (e.g. 2 exhaust fans) only showing one control
- Expand array actuators into numbered slots (exhaust_fan, exhaust_fan_2, etc.)
- Each fan now gets its own toggle button and state tracking

## 1.2.12
- Automations Create tab shows entity suggestions: what entities to add to unlock more automations
- Shows which templates each entity would enable (e.g., "Add a humidifier to enable Low Humidity → Humidifier")

## 1.2.11
- Events page defaults to "All Tents" instead of auto-selecting first tent

## 1.2.10
- Filter out unavailable/unknown entities from Settings entity list

## 1.2.9
- Events show related automation that controls the device
- Click automation name to edit it in Home Assistant

## 1.2.8
- Events page now only shows device state changes (on/off), not sensor readings
- Filter out sensor domain from entity history - only show actionable events

## 1.2.7
- Preload automations and tents data on app startup for instant page loads
- Automations page now displays immediately using preloaded data

## 1.2.6
- Fix route ordering: /ha-history now before /{event_id} to prevent 422 errors

## 1.2.5
- Filter Settings entity list to only relevant domains (sensor, switch, light, binary_sensor, climate, humidifier, camera, counter, etc.)
- Remove irrelevant entity types (automation, input_*, media_player, person, scene, tts, etc.)
- Make entity domain sections collapsible with click-to-expand
- Add icons and labels for each entity domain

## 1.2.4
- Fix 500 errors on templates, bundles, and suggestions endpoints
- Fix tent entity lookup for TentState vs TentConfig objects

## 1.2.3
- Events page now shows Home Assistant entity history for tent entities
- Entity History tab shows state changes (lights on/off, sensor readings)
- Filter events by tent and time period (1 hour to 1 week)
- Manual Log tab for user-logged events (watering, maintenance, etc.)

## 1.2.2
- Filter automations to only show tent-related by default
- Add "My Tent" / "All HA" toggle to switch between filtered and full view
- Automations page now only shows automations that reference your tent's configured sensors/actuators

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
