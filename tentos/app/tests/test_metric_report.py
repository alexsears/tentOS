import asyncio
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from metric_report import build_metric_report, metric_catalog, tent_has, BY_KEY
from standard_report import build_standard_report, vpd_series

START = datetime(2026, 9, 12, tzinfo=timezone.utc)
END = START + timedelta(hours=1)


def row(minutes, state, entity, unit=None):
    return {'entity_id': entity, 'last_changed': (START + timedelta(minutes=minutes)).isoformat(),
            'state': state, 'attributes': {'unit_of_measurement': unit} if unit else {}}


def tent(id_, name, sensors, actuators):
    slots = {}
    for kind, ids in actuators.items():
        for index, entity in enumerate(ids if isinstance(ids, list) else [ids]):
            slots[kind if index == 0 else f'{kind}_{index + 1}'] = entity
    return SimpleNamespace(config=SimpleNamespace(id=id_, name=name, sensors=sensors), slot_to_entity=slots)


FLOWER = tent('flower', 'Flower',
              {'temperature': 'sensor.f_temp', 'humidity': 'sensor.f_hum', 'temperature_2': 'sensor.f_temp2'},
              {'light': ['switch.f_light', 'switch.f_light2'], 'water_pump': 'switch.f_pump'})
INCUBATOR = tent('incubator', 'Incubator',
                 {'temperature': 'sensor.i_temp', 'humidity': 'sensor.i_hum', 'co2': 'sensor.i_co2'},
                 {'circulation_fan': 'switch.i_fan', 'humidifier': 'switch.i_mist'})


class HA:
    def __init__(self, rows):
        self.rows, self.asked = rows, None

    async def get_history(self, ids, start, end):
        self.asked = list(ids)
        return [self.rows[e] for e in ids if e in self.rows]


def test_catalog_only_offers_metrics_a_tent_actually_has():
    catalog = {m['key']: m['tents'] for m in metric_catalog([FLOWER, INCUBATOR])}
    assert catalog['temperature'] == ['flower', 'incubator']
    assert catalog['co2'] == ['incubator']
    assert catalog['water_pump'] == ['flower']
    assert catalog['circulation_fan'] == ['incubator']
    assert 'exhaust_fan' not in catalog and 'intake_fan' not in catalog
    assert [m['key'] for m in metric_catalog([FLOWER])].index('temperature') == 0


def test_vpd_is_offered_only_when_both_inputs_exist():
    dry = tent('dry', 'Dry', {'temperature': 'sensor.t'}, {})
    assert tent_has(FLOWER, BY_KEY['vpd']) and not tent_has(dry, BY_KEY['vpd'])


def test_numeric_metric_keeps_one_series_per_entity_per_tent():
    ha = HA({'sensor.f_temp': [row(0, '77', 'sensor.f_temp', '°F')],
             'sensor.f_temp2': [row(0, '24', 'sensor.f_temp2', '°C')],
             'sensor.i_temp': [row(0, '30', 'sensor.i_temp', '°C'), row(30, 'unavailable', 'sensor.i_temp')]})
    result = asyncio.run(build_metric_report('temperature', [FLOWER, INCUBATOR], ha, START, END))
    assert result['unit'] == '°C' and result['kind'] == 'numeric'
    assert [t['tent_id'] for t in result['tents']] == ['flower', 'incubator']
    assert 'sensor.f_hum' not in ha.asked
    assert result['tents'][0]['series'][0]['data'][0]['value'] == 25
    assert len(result['tents'][0]['series']) == 2
    assert result['tents'][1]['series'][0]['stats'] == {'min': 30.0, 'max': 30.0, 'avg': 30.0, 'last': 30.0}
    assert result['tents'][1]['series'][0]['data'][1]['value'] is None


def test_vpd_metric_pairs_the_canonical_slots_and_ignores_extra_temperature():
    ha = HA({'sensor.f_temp': [row(0, '26', 'sensor.f_temp', '°C'), row(30, '28', 'sensor.f_temp', '°C')],
             'sensor.f_hum': [row(0, '60', 'sensor.f_hum', '%')]})
    result = asyncio.run(build_metric_report('vpd', [FLOWER], ha, START, END))
    series = result['tents'][0]['series']
    assert len(series) == 1 and series[0]['unit'] == 'kPa'
    assert 'sensor.f_temp2' not in ha.asked  # a second temperature slot is not the tent's VPD input
    # Humidity holds at 60% while the air warms, so leaf VPD must rise.
    assert [p['value'] for p in series[0]['data']] == [0.97, 1.09]
    assert series[0]['stats']['last'] == 1.09


def test_vpd_needs_both_slots_and_skips_leading_half_readings():
    assert vpd_series([{'slot': 'temperature', 'entity_id': 'a', 'data': [], 'metric': 'temperature'}]) is None
    series = [{'slot': 'temperature', 'entity_id': 'a', 'metric': 'temperature',
               'data': [{'timestamp': '2026-09-12T00:00:00+00:00', 'value': 25.0},
                        {'timestamp': '2026-09-12T00:20:00+00:00', 'value': 25.0}]},
              {'slot': 'humidity', 'entity_id': 'b', 'metric': 'humidity',
               'data': [{'timestamp': '2026-09-12T00:10:00+00:00', 'value': 50.0}]}]
    assert [p['timestamp'][11:16] for p in vpd_series(series)['data']] == ['00:10', '00:20']


def test_switch_metric_gathers_one_lane_per_entity_across_tents():
    ha = HA({'switch.f_light': [row(-5, 'off', 'switch.f_light'), row(10, 'on', 'switch.f_light')],
             'switch.f_light2': [row(-5, 'on', 'switch.f_light2')]})
    result = asyncio.run(build_metric_report('light', [FLOWER, INCUBATOR], ha, START, END))
    assert result['kind'] == 'switch'
    assert [t['tent_id'] for t in result['tents']] == ['flower']
    lanes = result['tents'][0]['switches']
    assert [l['slot'] for l in lanes] == ['light', 'light_2']
    assert lanes[0]['changes'] == 1 and lanes[0]['starts'] == 1
    assert lanes[0]['on_seconds'] == 3000 and lanes[1]['on_seconds'] == 3600
    assert lanes[1]['unknown_seconds'] == 0


def test_water_pumps_reach_both_the_metric_report_and_the_tent_report():
    ha = HA({'switch.f_pump': [row(-5, 'off', 'switch.f_pump'), row(30, 'on', 'switch.f_pump'),
                               row(30.5, 'off', 'switch.f_pump')]})
    pumps = asyncio.run(build_metric_report('water_pump', [FLOWER, INCUBATOR], ha, START, END))
    lane = pumps['tents'][0]['switches'][0]
    assert lane['label'] == 'Water pump' and lane['on_seconds'] == 30 and lane['changes'] == 2
    tent_report = asyncio.run(build_standard_report(FLOWER, HA({}), START, END))
    assert 'water_pump' in [s['slot'] for s in tent_report['switches']]
    assert 'vpd' in [s['metric'] for s in tent_report['series']]


def test_a_tent_with_no_recorded_history_still_reports_its_lanes_as_unknown():
    result = asyncio.run(build_metric_report('humidifier', [INCUBATOR], HA({}), START, END))
    lane = result['tents'][0]['switches'][0]
    assert lane['unknown_seconds'] == 3600 and lane['changes'] == 0
    assert lane['intervals'] == [{'start': START.isoformat(), 'end': END.isoformat(), 'state': 'unknown'}]


def test_thinning_keeps_stats_honest_and_leaves_outages_as_gaps():
    from standard_report import MAX_POINTS, add_stats, thin
    # One bucket of real readings, one bucket that is mostly a dropout.
    size = 4
    points = ([{'timestamp': f'2026-09-12T00:{i:02d}:00+00:00', 'value': 10.0 + i} for i in range(size)]
              + [{'timestamp': f'2026-09-12T01:{i:02d}:00+00:00', 'value': None if i else 99.0}
                 for i in range(size)])
    thinned = thin(points, limit=2)
    assert [p['value'] for p in thinned] == [11.5, None]
    # Stats taken before thinning still carry the extremes and the real last reading.
    item = add_stats({'data': points})
    assert item['stats'] == {'min': 10.0, 'max': 99.0, 'avg': 29.0, 'last': 99.0}
    assert thin(points, limit=MAX_POINTS) is points


def test_impossible_humidity_is_a_gap_not_zero_vpd():
    from standard_report import vpd_series
    series = [{'slot': 'temperature', 'entity_id': 'a', 'metric': 'temperature',
               'data': [{'timestamp': '2026-09-12T00:00:00+00:00', 'value': 26.0}]},
              {'slot': 'humidity', 'entity_id': 'b', 'metric': 'humidity',
               'data': [{'timestamp': '2026-09-12T00:00:00+00:00', 'value': 0.0},
                        {'timestamp': '2026-09-12T00:10:00+00:00', 'value': 60.0},
                        {'timestamp': '2026-09-12T00:20:00+00:00', 'value': 140.0}]}]
    data = vpd_series(series)['data']
    assert [p['timestamp'][11:16] for p in data] == ['00:10']
    assert data[0]['value'] == 0.97


def test_a_probe_listed_in_two_slots_draws_one_line():
    from standard_report import sensor_series
    # Flower's real config: climate 2 appears in the canonical list and again as slot 2.
    flower = tent('flower', 'Flower', {
        'temperature_2': 'sensor.c2_temp',
        'temperature': ['sensor.c1_temp', 'sensor.c2_temp'],
        'humidity': ['sensor.c1_hum', 'sensor.c2_hum'],
        'humidity_2': 'sensor.c2_hum',
    }, {})
    series = sensor_series(flower)
    assert [i['entity_id'] for i in series] == ['sensor.c1_temp', 'sensor.c2_temp',
                                                'sensor.c1_hum', 'sensor.c2_hum']
    # The canonical slot wins, so both probes still feed VPD.
    assert [i['slot'] for i in series] == ['temperature', 'temperature', 'humidity', 'humidity']
