# Mother humidifier refill

Alex identified the renamed Office heater plug on 2026-09-06. Its friendly name
is Mother humidifier refill and its relay remains `switch.office_heater`.
The attached generic thermostat was still in heat mode: it was turned off and
its config entry `01KCW3156CYMQY5R564ACGZNJN` disabled through the HA API
(no restart required). The physical switch remains available. The plug already
uses Off power-on behavior. Existing Mother watering pump limiters are unrelated
and remain unchanged.

## Starting behavior

- RH below 58% continuously for 20 minutes, valid fresh sensors, both fans off,
  and the existing humidifier controller in normal operation.
- A 10-minute refill, at most one attempt per low-humidity episode. Rearm only
  after RH is at least 62% for 20 minutes with the pump off. At least six hours
  between attempts even after recovery.
- Independent deadline checks every 10 seconds and at the deadline. Stop on
  restart/reload, disabling, ventilation, unsafe RH/temperature/CO2, or stale sensors.
  Active state resets off on startup; the lock and last-start time are restored.
- Keep current Mother humidifier/fan logic and low-humidity notifications.
  Humidity is an indirect dry-tank signal, not a water-level measurement. A long
  open tent can still qualify; the delay excludes short disturbances, not all
  openings. No door or tank-level sensor was found in the Mother entity set.

## Live findings

Home Assistant 2026.7.3 at 192.168.77.50. The last 24 hours sampled on Sep 6 had
RH 59.96-70.61%, never below 58%. The existing alert package uses 58% for ten
minutes. The current controller holds 65-68%, has 94/92 F heat vent hysteresis,
90-second humidifier pulses, and a separate 120-second humidifier cutoff.

The earlier name search missed this device because its entity ID remained
`switch.office_heater`. The user confirmed the repurposed plug. Do not rename
other watering switches or extend their unrelated 30-second/20-minute limiters.
The office-heater generic thermostat must remain disabled to prevent cold office
temperature from powering the refill pump.

All 96 automation entities were scanned through UI config routes. The limiter
and Mother humidity controller were the relevant matches. YAML packages and
scripts were inspected for pump references; no additional matching controller
was found there. The new identity was then scanned across all UI automations and YAML packages/scripts; no additional office_heater reference was found outside its thermostat.

## Commissioning

1. Identity and power-on behavior are verified. Keep the old thermostat disabled.
   The dedicated refill watchdog owns this relay; unrelated watering pump
   cutoffs remain unchanged. Runtime protection depends on HA and switch
   communications; an independent device timeout is preferable if available.
2. Back up the affected HA files. Install as a new named package in
   `configuration.yaml` alongside the existing mother_humidity_alert package.
   Run `ha core check`; load helpers/templates/automations with the supported
   reload path or controlled restart. Verify the pump is off before enabling.
3. Verify the rendered templates in HA, including stale/unknown sensors, short
   dips, ventilation, the six-hour boundary, recovery latch, reload and deadline.
   The local tests exercise templates, not the physical relay or HA runtime.
4. Enable after identity and cutoff validation. Do not force a ten-minute fill
   into a tank that is not known to need water. Monitor the first naturally
   qualified cycle: pump on/off timestamps, delivered amount and humidity
   recovery. The user proposed ten minutes; no mL/min or tank capacity is known.
5. Record the next-cycle verification as an Asana follow-up until observed.

Task: 1218217840076418. Related prior dry-tank decision: 1218190083035464.

HA documents that trigger `for` windows reset on restart/reload, so qualification
starts fresh; the independent deadline and startup stop cover an interrupted run:
https://www.home-assistant.io/docs/automation/trigger/
https://www.home-assistant.io/integrations/input_datetime/

Recovery calibration: live twelve-hour history had only a 17.2-minute longest
continuous interval at or above 65%, but 713.6 minutes at or above 62%. Therefore
recovery uses 62% for twenty minutes, preserving hysteresis above the 58% start
threshold without permanently locking out a normally cycling humidifier.

## Live commissioning result (2026-09-06)

Enabled on HA after PR 21 merged as `0a0c494`. Package is
`/config/packages/mother_humidifier_refill.yaml`, named under homeassistant
packages in configuration.yaml. Original configuration backup:
`/config/configuration.yaml.bak-20260906-mother-refill`.

- `ha core check` passed before and after the final change. Loaded through
  input_boolean, input_datetime, template and automation reloads; no HA core
  restart or TentOS add-on deployment was needed.
- Actual automations are `automation.mother_humidifier_refill_after_sustained_dry_air`,
  `automation.mother_humidifier_refill_independent_stop`, and
  `automation.mother_humidifier_refill_rearm_after_recovery`.
- Enabled helper is on; active and lock are off; pump is off; dry candidate off.
  All three sensors were 6.4 seconds fresh during validation.
- Invoking the start automation with normal humidity did not turn on the pump
  or change last-start/lock state. A helper-only 20-second simulated active
  window cleared at its actual scheduled deadline (+0.4 seconds), with the
  physical relay off throughout. This proves deadline execution, not pumping.
- Thermostat config-entry readback is disabled_by=user, state=not_loaded.
  Plug power-on setting is Off. No watering-pump limiter was modified.
- Twenty local template tests and required independent review passed.
- First real-cycle verification is Asana `1218218324487567`, due Sep 7. Check
  actual runtime, stop, humidity recovery and delivered volume before claiming
  refill calibration complete. No pump-on or water delivery was forced here.

Rollback: turn off `input_boolean.mother_refill_enabled`, verify
`switch.office_heater` off, then remove only the new named package include and
reload its domains. Keep the old thermostat disabled while the plug operates a
water pump. Do not restore the entire old configuration over later changes.
