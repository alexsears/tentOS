# Incubator humidity ramp

Alex requested 70% RH now on September 11, 2026. Batch start remains August 22.
The ramp now uses 87%, 85%, 70%, 70%, then 60% for weeks one through five.
Week five starts September 19. Manual override remains off, so the later drop
still occurs automatically. This changes the week-three target only.

Deploy `incubator_rh_template.yaml` to `/config/incubator_rh_template.yaml`,
already included under `template` in configuration.yaml. Back up the live file,
run `ha core check`, reload templates, and verify `sensor.incubator_target_rh`.
Existing humidity and high-RH ventilation automations read that entity.

Run `python -m pytest ops/incubator-ramp/test_ramp.py -q` to verify week
boundaries and manual-override behavior. Confirm the next natural vent cycle;
the requested setpoint is not proof actual humidity has reached it.

September 11 deployment: 11 boundary/override tests and HA configuration check
passed. Live target is 70%, source is weaning ramp, manual override remains off.
Actual RH was 84.3%, humidifier off. The existing high-RH vent runs at minute
boundaries when RH exceeds target by five points and the fan has rested for more
than five minutes; its pulse remains eight seconds. A five-minute read-only
monitor was arranged in `C:/code/artifacts/tomato-commissioning/monitor-incubator.py`
with observations in `incubator-70-observations.jsonl` to capture the next cycle.
TentOS humidity display/alert limits are now 67–73%, matching the current 70%
target and three-point band. These display limits are separate from the HA ramp.

Shared operating/writing rules: [workspace guidance](C:/code/CLAUDE.md).
