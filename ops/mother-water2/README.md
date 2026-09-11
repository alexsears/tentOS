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
