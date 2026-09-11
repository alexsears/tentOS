# Mother Water 2 nightly schedule

Version 2026.09.10.1. Alex requested five runs each night, twenty seconds per run,
starting at 9pm, and explicitly confirmed one-hour spacing on September 10.

Starts: 21:00, 22:00, 23:00, 00:00, 01:00 in America/Chicago, every day. Only
switch.mother_water_2 is controlled. An already-on or unavailable pump is skipped.
There is no catch-up run and no Flower light or humidity condition: those were
unconfirmed defaults in the older, undeployed PR #32 proposal, superseded by the
user's explicit nightly schedule. Mister remains separate.

The existing Water Pump Limiters automation retains its independent 30-second cap.
The new recovery automation turns this pump off when Home Assistant starts or
automations reload, because a delayed shutoff can otherwise be interrupted.
Set the relay's power-on behavior to Off, so power restoration cannot resume an
interrupted watering cycle. Do not force a watering cycle for testing.

Deploy only these two automation IDs into the live automations.yaml after checking
for collisions and backing up the file. Preserve all other automations. Validate
with ha core check and reload when unrelated automations are idle. Read back the
loaded schedule, limiter, relay power-on behavior, and HA time zone. Observe the
next natural start and stop, or arrange read-only monitoring for that boundary.

Rollback removes only these two IDs, after stopping any active scheduled run and
turning this pump off. Preserve unrelated changes. The old Power-on behavior was
PreviousValue; restoring it is a separate deliberate choice, not required to remove
the schedule.

Task: https://app.asana.com/0/1215742280859369/1218383637492728

## Deployment evidence

Enabled September 10 at 21:02 CDT, after the first 21:00 slot passed. No catch-up
run was issued. The first eligible run is September 10 at 22:00; the first complete
five-run night starts September 11 at 21:00.

The independent reviewer found no blocking gaps. Exact schedule/duration/target
checks and ha core check passed. Parsed comparison confirmed every pre-existing
automation unchanged. HA had no running automations when reloaded.

Live readback confirmed America/Chicago; both new automations enabled; the shared
30-second limiter still enabled; relay power-on behavior Off; pump off. The reload
recovery automation ran successfully at 2026-09-11T02:02:09Z. No pumping was forced
for validation. HA-based timing still depends on HA/network availability; relay
power-on Off protects restoration of relay power, not an unrelated HA outage.

Read-only monitoring is scheduled on CT 109 as
mother-water2-verify-20260910.timer for 2026-09-11 02:59:50 UTC (21:59:50 CDT).
It observes for 80 seconds around the first start, with no HA writes. Results go to
/var/lib/mother-water2-monitor/latest-summary.json and timestamped samples.
The actual scheduled on/off behavior is pending that boundary; configuration
validation is not reported as a measured watering cycle.

Live configuration backup: /config/automations.yaml.before-mother-water2-20260910.
Restore only the affected IDs if other changes have occurred. PR #33 records this
change; it supersedes the Mother Water Two draft timing in PR #32.
