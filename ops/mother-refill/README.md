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
  after RH is at least 65% for 20 minutes with the pump off. At least six hours
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
