# Incubator humidifier refill

Alex confirmed Water 1a was renamed **Incubator humifier refill** on Sep 6, 2026.
The actual relay is `switch.incubator_humifier_refill` (retain its current spelling).
Its power-on behavior is Off. The prior water_1a counter/timer are idle; a scan
of all 99 UI automations by old/new name, device ID and entity-registry ID found
no controller targeting this relay. YAML packages/scripts had no matching action.
Other pumps, misting controls and cuttings schedules are unchanged.

## Behavior

- Automatic start after RH stays below `target RH - misting band - 7` for twenty
  minutes. Current target 80 and band 3 give a 70% floor. The existing weekly
  target ramp is 87, 85, 80, 70, 60; the refill floor follows it.
- Up to ten minutes per run, one attempt until sustained recovery, and six hours
  between automatic attempts. Recovery is `target - band - 2` for ten minutes
  with pump off (currently 75%). The shorter recovery interval fits the existing
  twenty-minute air-exchange schedule.
- Require fresh numeric RH/temperature/CO2, valid target/band, normal enabled
  misting control, no pause/blind-burst mode. Start only with fan off. Routine
  short ventilation (8 seconds every 20 minutes) does not restart qualification
  or stop an active refill; a fan-on interval of 60 seconds or more does.
- Manual off-to-on starts a fresh ten-minute timer; off cancels it. Manual starts
  bypass automatic humidity/cooldown eligibility, while retaining sensor and
  prolonged-ventilation safety stops. Reconnect is not treated as manual intent.
- Independent exact deadline and ten-second watchdog; restart/reload/disable
  stop an active run. Queued event handling and two-second adoption grace prevent
  the immediate manual-start cancellation found and fixed on Mother.
- Runtime sensors must update within four minutes, matching existing incubator
  fault handling. Stop on invalid readings, RH <=0.5 or >=99, temperature outside
  40-95 F, negative CO2 or CO2 >=1200, or missing/prolonged fan state.

These are indirect dry-tank checks. Without a door or water-level sensor a long
opening can still qualify. No delivered volume is inferred from relay runtime.
Software cutoff depends on HA and switch communication; power-on Off prevents
automatic power restoration after a plug outage.

## Deployment and validation

Package path `/config/packages/incubator_humidifier_refill.yaml`, named include
under `homeassistant.packages`. Run `ha core check`, load helpers/templates and
automations, inspect sensor freshness and all helper states, then enable
`input_boolean.incubator_refill_enabled`. No TentOS add-on update is needed.

Run `python -m pytest ops/incubator-refill/test_refill.py -q`. Tests cover stage
thresholds, short versus prolonged ventilation, manual restart ordering, stale
sensors, recovery/cooldown and deadline boundaries using the actual YAML.

Live observation before deployment: target 80%, band 3%, 24-hour RH minimum
71.16%, mean about 80%. Sensors briefly became unavailable during setup and
recovered; the draft requires valid fresh data before automatic pumping.

Verify a brief manual run survives a watchdog boundary, then use a shortened
commissioning deadline to prove relay shutoff. Leave the pump off and undo only
that test's cooldown/lock after checking no intervening user action occurred.
The first full refill still needs actual duration, delivery and RH recovery
verification. Do not force a full refill into a tank without known free capacity.

Asana implementation task: `1218218883554659`.
