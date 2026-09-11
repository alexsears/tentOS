# Tomato seed sprouting

The seed-start tent uses the SCD30 on `pot-scale-weight-c3`. Its separate
touchscreen continues displaying scale data. Tomato switches retain their
existing entity IDs, including the historical `garage_` prefixes.

`tomato_sprouting.yaml` is a Home Assistant package loaded explicitly under
`homeassistant.packages`. The enable helper restores its previous setting;
on first installation it is off. The controller checks every 15 seconds.

- Humidify below 75% RH and stop at 80%. There is no routine runtime limit or
  forced rest while humidity is below target. Exhaust and fault cutoffs remain.
- Confirm circulation on and exhaust off before starting mist.
- Exhaust for the first 30 seconds of each ten-minute clock interval.
- Circulate for the first two minutes of each ten-minute interval, whenever
  humidity is below target, during misting, and during recovery ventilation.
- At 85 F or 85% RH, stop mist and ventilate until below those thresholds.
- Missing, invalid or older-than-two-minute sensor reports stop mist and
  ventilate. Both Celsius and Fahrenheit HA temperature units are supported.
- Disabling the helper stops all three climate outputs. No light or water
  commands are included. Fault cutoffs depend on HA and relay connectivity.

These are initial commissioning settings for unsprouted seeds. Once seedlings
emerge, revise humidity and airflow; high humidity does not establish that the
growing medium has enough water. The water switch destination and delivery rate
must be established before adding a watering schedule. Alex confirmed the future
peristaltic pump will fill a seed-plug tray, but it is not connected yet. The scale currently holds
a reference weight, so its readings cannot control tray watering.

## Verification and deployment

Run `python -m pytest ops/tomato/test_sprouting.py -q`. Tests exercise the actual
YAML templates for stale/invalid sensors, fan/exhaust confirmation, humidity
hysteresis, temperature units, sustained low-RH operation and clock boundaries.

Copy the package to `/config/packages/tomato_sprouting.yaml`; add its named
include to `/config/configuration.yaml`. Run `ha core check`, reload
`input_boolean` and `automation`, then enable `input_boolean.tomato_sprouting_enabled`.
Observe future clock boundaries and humidity response before claiming behavior
verified. Back up live configuration and avoid unrelated changes.

September 11 commissioning: 13 tests and HA configuration validation passed.
Independent physical-control review completed; missing entity and relay failure
handling were corrected. HA history confirms exhaust off at 20:10:30 UTC,
mist on at 20:10:45.396 UTC, and automatic mist off at 20:13:45.468 UTC
(180.07 seconds). RH rose from about 50.3% to 52.8% during the first cycle;
the target humidity band has not yet been reached or proven maintainable.
Water remains off pending confirmation of destination and filled/connected
reservoir/tubing. Implementation task: 1218415080996693; PR: 36.

## Continuous humidity control and climate history correction

Alex approved removing the three-minute cutoff and forced rest after observing
the humidifier off below target. The cutoff automation must be explicitly disabled
before loading the revised package so a removed controller cannot interrupt it.

The existing recorder wildcard excludes all `sensor.pot_scale_weight_c3_*`
entities. Merge the three exact entity IDs in `recorder_include.yaml` into the
existing recorder.include.entities list. Exact includes override the broad
exclusion while weight and raw diagnostics remain excluded. Preserve existing
includes, exclusions and retention. Run `ha core check`, then restart HA to apply
the recorder configuration. New reports begin when recording starts; there is no
historical climate data to backfill from HA for the excluded period.

Shared operating/writing guidance: [workspace rules](C:/code/CLAUDE.md).
