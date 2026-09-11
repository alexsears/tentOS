# Incubator daily humidity ramp

Alex requested daily decreases on September 11, 2026, replacing weekly steps.
The batch date remains August 22. The target is 70% today, 68.75% September 12,
then 1.25 percentage points lower each midnight until 60% on September 19.
It holds 60% afterward. Actual humidity can lag the requested target.

For future batches, interpolate daily between these age anchors: day 0 at 87%,
day 7 at 85%, day 20 at 70%, day 28 at 60%. Future or unset batch dates hold
87%. Manual override still takes precedence. Existing ventilation, humidifier,
sensor and refill controls continue reading sensor.incubator_target_rh.

Deploy incubator_rh_template.yaml to /config/incubator_rh_template.yaml, already
included under template in configuration.yaml. Back up the live file, run
ha core check, reload templates, and verify the target and source. HA refreshes
now() templates each minute; local calendar dates determine the daily step.

Run python -m pytest ops/incubator-ramp/test_ramp.py -q. All 14 boundary,
monotonicity and override tests passed, as did independent control review.

A read-only check for September 12 at 00:02 CDT runs
C:/code/artifacts/tomato-commissioning/check-daily-ramp.py and writes
 daily-ramp-midnight-result.json in that directory. It depends on Windows
remaining awake; the future midnight boundary is not yet verified.

TentOS display/alert limits remain 67-73%. These static limits are separate
from the active HA daily ramp and do not automatically follow it.

Tracking: Asana 1218416275728789; https://github.com/alexsears/tentOS/pull/37.
Shared operating/writing rules: [workspace guidance](C:/code/CLAUDE.md).
