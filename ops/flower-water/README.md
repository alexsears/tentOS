# Both overnight watering routines

Prepared and checked for review only. No live automation or relay was changed.
This replaces the earlier proposal to move Mister onto Mother water 2.
Keep Mister and add a separate Mother Water Two routine.

## Current configuration

Live read on 2026-09-09 in America/Chicago:

| Item | Current configuration | Candidate change |
| --- | --- | --- |
| Mister Hourly for 30 Seconds (10 PM-6 AM, only if Flower RH < 60%) | Enabled; `switch.mister` on and off | None |
| Mother Water Two | `switch.mother_water_2` exists; no scheduler found | Add `mother_water_2_overnight` |
| Flower light cycle | Enabled; on 20:00, off 08:00 | None |
| Water Pump Limiters | Enabled; both switches have a 30-second cap | None |
| Lab water daily run | `switch.lab_water_2` at 08:00 | None; separate irrigation routine |

The user calls Mister "Mr.". Its current Home Assistant friendly name is Mister;
there is no switch named Mr. Water. Mother water 2 is the verified friendly name
for the other requested relay. No current `switch.flower_water` reference was
found in the inspected automation configurations or package/script search.

| Proposed rule for both routines | Value |
| --- | --- |
| Eligible starts | 22:00, 23:00, 00:00, 01:00, 02:00, 03:00, 04:00, 05:00 |
| Time zone | America/Chicago |
| Duration | 30 seconds |
| Light gate | `switch.lab_diablo` must be on |
| Humidity gate | `sensor.avg_flower_humidity` below 60% |
| Mode | single |

The new Mother routine copies Mister's timing, duration and humidity gate as
conservative draft defaults. The humidity gate was added to Mister to prevent
misting into humid air. Its suitability for Mother Water Two is unconfirmed.
Alex was asked whether that gate should apply to the new routine. Until answered,
the draft retains it. Scheduled opportunities can be skipped; this does not
promise nightly watering or establish a suitable irrigation dose.

## Evidence and verification

The live scan covered all loaded automation entities. UI configuration reads
covered the routines and shared limiter. Package-owned entries returned 404 and
were supplemented by a read-only search of packages, scripts, configuration,
Node-RED and AppDaemon locations. The only package match is garden_mister, which
references Mister. No Mother Water Two scheduler was found in these surfaces.
Other integrations or device firmware rules are not exhaustively proven absent.

`candidate.json` and `candidate.yaml` contain exactly the two intended routines.
`before-mister.json` and `before-limiters.json` hold selected live evidence.
Run `python ops/flower-water/test_candidate.py` for target, guard, duration,
unique ID, YAML parity and overnight boundary checks. Tests do not actuate pumps.

## Release handoff

Deployment is excluded by the current task contract. Do not install this list as
an additional package: it contains the existing Mister ID for comparison.
After deployment is authorized, refresh live configs and stop on drift.
Keep Mister unchanged. Add only the new Mother automation by its distinct ID,
after checking that no matching automation has since been created. Back up the
affected configuration and preserve the independent pump limiter. Validate
with HA core check, use the supported reload path and read back the result.
No TentOS rebuild, public hosting or device activation is part of this artifact.

Confirm the proposed Mother humidity gate before release. The existing state
duration limiter does not establish restart-safe shutoff. Review relay power-on
behavior and recovery safeguards before enabling a new physical schedule.
Monitor the next naturally qualified run and light-off boundary. Record relay
on/off timestamps and the light/humidity gates. Do not force watering for a test.
Rollback removes only the newly added automation after checking for newer edits.

Originating request: https://app.asana.com/0/1215742280859369/1218344963957293
