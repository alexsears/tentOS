# Flower watering switch candidate

Prepared for review only. No Home Assistant configuration, relay state, schedule,
or TentOS assignment was changed. The task contract authorizes artifact verification
and explicitly excludes deployment.

## Identification

Live inspection on 2026-09-09 America/Chicago found no automation named Flower
water. The matching overnight routine is `automation.mister_hourly_10_seconds`.
It operates `switch.mister`. The separate `automation.lab_water_daily_run` uses
`switch.lab_water_2` once daily at the Flower lights-off boundary. Neither is
silently treated as a renamed Flower water entity.

The candidate uses the overnight routine because it matches the requested timing
and existing light check. Alex has been asked to confirm which routine he means.
Resolve that identity before release. Keep the existing alias and description
until identity is confirmed, so this artifact changes only the requested targets.

| Existing rule | Value |
| --- | --- |
| Run opportunities | Hourly, 22:00 through 05:00, America/Chicago |
| Pump duration | 30 seconds |
| Required light | `switch.lab_diablo` on |
| Required humidity | `sensor.avg_flower_humidity` below 60% |
| Flower light schedule | 20:00 to 08:00 |
| Replacement relay | `switch.mother_water_2`, friendly name Mother water 2 |

High humidity prevents this routine from running even when the light is on.
The candidate preserves that existing restriction; it does not promise watering
at every scheduled opportunity. Removing it would require a separate decision
about whether this is plant irrigation or humidity control.

## Changes and checks

`before.json` is the exact selected live configuration. `candidate.json` changes
both on and off actions to Mother water 2. `candidate.yaml` is the equivalent
single-automation list for review, not a new package to install alongside the old
routine. Run `python ops/flower-water/test_candidate.py`.

All loaded automation entities were inspected through the API. Package-owned
entities that return 404 were covered by a read-only package/script file search.
The existing enabled Water Pump Limiters automation already caps Mother water 2
at 30 seconds. No additional on-controller reference to that relay was found in
active automations, packages, scripts, Node-RED or AppDaemon files searched.
TentOS still assigns this relay to Mother water_pump_2; that assignment is not
changed by this candidate. Its power-on behavior currently restores the previous
value. The existing state-duration limiter does not prove restart-safe shutoff.

## Release handoff

1. Confirm that the overnight Mister routine is the intended Flower water routine,
   including whether the humidity gate should remain. Obtain deployment authorization.
2. Refresh the live config and compare it with before.json. Stop on drift; do not
   overwrite a newer edit. Recheck the relay, light schedule and competing controllers.
3. Back up only the affected automation. Update the existing automation by its ID
   with candidate.json; do not append a duplicate or replace all automations.yaml.
   Validate with HA core check and use the supported automation reload path.
4. Read back both pump actions and all conditions. Keep the existing pump limiter.
   No TentOS add-on rebuild or public hosting change is needed.
5. Arrange monitoring of the next naturally qualified hourly run before calling
   deployment verified. Record the light and humidity gate, relay on/off timestamps,
   and duration. A humidity-blocked run proves the gate, not delivered water.
   Do not force watering merely to test. Rollback restores only this automation
   from its fresh pre-release backup after checking for newer edits.

Local tests prove the artifact diff and preservation of the schedule and guards.
They do not prove HA schema acceptance, physical operation, water volume or the next
nightly boundary. Those checks belong to an authorized release.

Originating task: https://app.asana.com/0/1215742280859369/1218344833816521
