import asyncio
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from standard_report import switch_intervals, switch_counts, build_standard_report

START = datetime(2026, 9, 12, tzinfo=timezone.utc)
END = START + timedelta(hours=1)
def row(minutes, state, entity='switch.light', unit=None):
    return {'entity_id': entity, 'last_changed': (START+timedelta(minutes=minutes)).isoformat(),
            'state': state, 'attributes': {'unit_of_measurement': unit} if unit else {}}

def test_switch_seed_short_pulse_and_unknown_gaps():
    data = [row(-10, 'on'), row(10, 'unavailable'), row(20, 'off'), row(30, 'on'), row(30.25, 'off')]
    spans = switch_intervals(data, START, END)
    assert [s['state'] for s in spans] == ['on', 'unknown', 'off', 'on', 'off']
    assert spans[0]['start'] == START.isoformat()
    assert spans[-1]['end'] == END.isoformat()
    assert (datetime.fromisoformat(spans[3]['end'])-datetime.fromisoformat(spans[3]['start'])).total_seconds() == 15

def test_missing_history_is_unknown_and_outside_rows_are_clamped():
    assert switch_intervals([], START, END) == [{'start': START.isoformat(), 'end': END.isoformat(), 'state': 'unknown'}]
    assert switch_intervals([row(-10,'on'), row(90,'off')], START, END)[0]['end'] == END.isoformat()
    spans = switch_intervals([row(30,'on')], START, END)
    assert [r['state'] for r in spans] == ['unknown','on']

def test_all_sensor_entities_and_numbered_switches_are_separate():
    class HA:
        async def get_history(self, ids, start, end):
            assert set(ids) == {'sensor.temp', 'sensor.temp2', 'switch.light', 'switch.light2', 'switch.exhaust', 'switch.mist'}
            return [[row(0,'77','sensor.temp','°F'),row(2,'unknown','sensor.temp'),row(3,'NaN','sensor.temp')],
                    [row(0,'24','sensor.temp2','°C')], [row(-1,'on','switch.light')]]
        async def get_state(self, entity):
            raise AssertionError('Never invent history from current state')
    tent = SimpleNamespace(config=SimpleNamespace(name='Test', sensors={'temperature':['sensor.temp','sensor.temp2']}),
                           slot_to_entity={'light':'switch.light','light_2':'switch.light2','exhaust_fan':'switch.exhaust','humidifier':'switch.mist'})
    result = asyncio.run(build_standard_report(tent, HA(), START, END))
    assert len(result['series']) == 2
    assert result['series'][0]['data'][0]['value'] == 25
    assert result['series'][0]['data'][1]['value'] is None
    assert result['series'][0]['data'][2]['value'] is None
    assert result['switches'][0]['on_seconds'] == 3600
    assert result['switches'][1]['unknown_seconds'] == 3600


def test_counts_exclude_initial_state_duplicates_and_unknown_transitions():
    data = [row(-10,'on'), row(1,'on'), row(2,'off'), row(3,'on'),
            row(4,'unavailable'), row(5,'on'), row(6,'off'), row(7,'on'), row(70,'off')]
    assert switch_counts(data, START, END) == {'starts': 2, 'changes': 4}
    assert switch_counts([row(-1,'on')], START, END) == {'starts': 0, 'changes': 0}
    assert switch_counts([], START, END) == {'starts': 0, 'changes': 0}

def test_all_fan_types_have_separate_timelines_and_counts():
    mapping = {'exhaust_fan':'switch.exhaust', 'circulation_fan':'switch.circ',
               'circulation_fan_2':'switch.circ2', 'intake_fan':'fan.intake', 'fan':'fan.other'}
    class HA:
        async def get_history(self, ids, start, end):
            assert set(ids) == set(mapping.values())
            return [[row(-1,'off',e), row(5,'on',e), row(5.25,'off',e)] for e in ids]
    tent = SimpleNamespace(config=SimpleNamespace(name='Fans', sensors={}), slot_to_entity=mapping)
    result = asyncio.run(build_standard_report(tent, HA(), START, END))
    assert len(result['switches']) == 5
    for fan in result['switches']:
        assert fan['starts'] == 1
        assert fan['changes'] == 2
        assert fan['on_seconds'] == 15
