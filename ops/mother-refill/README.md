# Mother humidifier refill

Prepared 2026-09-06; **not installed or enabled**. Alex authorized automatic
refilling but the physical pump has not been identified in Home Assistant.
The YAML deliberately targets `switch.confirm_mother_refill_pump`.

## Proposed starting behavior

- RH below 58% continuously for 20 minutes, valid fresh sensors, both fans off,
  and the existing humidifier controller in normal operation.
- A 10-minute refill, at most one attempt per low-humidity episode. Rearm only
  after RH is at least 65% for 20 minutes with the pump off. At least six hours
  between attempts even after recovery.
- Independent deadline checks every 10 seconds and at the deadline. Stop on
  restart/reload, disabling, ventilation, unsafe RH/temperature/CO2, or stale RH.
  Active state resets off on startup; the lock and last-start time are restored.
- Keep current Mother humidifier/fan logic and low-humidity notifications.
  Humidity is an indirect dry-tank signal, not a water-level measurement. A long
  open tent can still qualify; the delay excludes short disturbances, not all
  openings. No door or tank-level sensor was found in the Mother entity set.

## Live findings and blocker

Home Assistant 2026.7.3 at 192.168.77.50. The last 24 hours sampled on Sep 6 had
RH 59.96-70.61%, never below 58%. The existing alert package uses 58% for ten
minutes. The current controller holds 65-68%, has 94/92 F heat vent hysteresis,
90-second humidifier pulses, and a separate 120-second humidifier cutoff.

No entity currently has the name Mother humidifier refill. Available candidates
are `switch.mother_water`, `switch.mother_water_2`, and `switch.water_refill`.
`automation.water_pump_limiters` caps the first two at 30 seconds and the last
at 20 minutes. Do not remove or extend a cutoff on an unconfirmed watering pump.
An older Asana suggestion named mother_water, but that is not hardware evidence.

All 96 automation entities were scanned through UI config routes. The limiter
and Mother humidity controller were the relevant matches. YAML packages and
scripts were inspected for pump references; no additional matching controller
was found there. Finish the controller inventory once the real entity is known.

## Commissioning after exact pump confirmation

1. Verify entity/device identity and confirm existing limiter ownership. Replace
   the placeholder everywhere. Align only this pump's legacy limiter to the new
   ten-minute limit and set its power-on behavior to Off if supported. Leave
   other watering pumps unchanged. Runtime protection depends on HA and switch
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
