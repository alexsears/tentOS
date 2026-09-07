"""Exercise the actual YAML templates at sensor, cooldown and deadline boundaries.

Run: python -m pytest ops/mother-refill/test_refill.py -q
This does not actuate a pump or replace HA configuration/runtime validation.
"""
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import jinja2
import pytest
import yaml

CONFIG = yaml.safe_load(Path(__file__).with_name('mother_humidifier_refill.yaml').read_text())
NOW = datetime(2026, 9, 7, tzinfo=timezone.utc)
PUMP = 'switch.office_heater'


def render(template, changes=None, age=0, trigger='tick'):
    values = {
        'sensor.moth_a_mother_humidity': '55',
        'sensor.moth_a_mother_temperature': '90',
        'sensor.moth_a_mother_co2': '700',
        'switch.mother_fan': 'off', 'switch.mother_intake_fan': 'off',
        'switch.mother_humidifier': 'on', PUMP: 'off',
        'automation.mother_humidifier_pulse_control': 'on',
        'input_select.mother_humidity_control_state': 'Humidifying',
        'input_boolean.mother_refill_enabled': 'on',
        'input_boolean.mother_refill_active': 'off',
        'input_boolean.mother_refill_locked': 'off',
        'binary_sensor.mother_refill_dry_candidate': 'on',
        'input_datetime.mother_refill_last_started': (NOW-timedelta(hours=7)).isoformat(),
        'input_datetime.mother_refill_deadline': (NOW+timedelta(minutes=10)).isoformat(),
    }
    values.update(changes or {})

    class States:
        def __call__(self, key):
            return values.get(key, 'unknown')

        def __getattr__(self, domain):
            return SimpleNamespace(**{
                k.split('.', 1)[1]: SimpleNamespace(last_updated=NOW-timedelta(seconds=age))
                for k in values if k.startswith(domain+'.')
            })

    def timestamp(value, default=None):
        try:
            return value.timestamp() if isinstance(value, datetime) else datetime.fromisoformat(value).timestamp()
        except (ValueError, TypeError):
            return default

    def number(value):
        try:
            return float('-inf') < float(value) < float('inf')
        except (ValueError, TypeError):
            return False

    env = jinja2.Environment()
    result = env.from_string(template).render(
        states=States(), is_state=lambda k, v: values.get(k)==v,
        is_number=number, now=lambda: NOW, as_timestamp=timestamp,
        trigger=SimpleNamespace(id=trigger),
    )
    return result.strip() == 'True'


DRY = CONFIG['template'][0]['binary_sensor'][0]['state']
START = CONFIG['automation'][0]['actions'][0]['value_template']
STOP = CONFIG['automation'][1]['actions'][0]['value_template']


def test_short_opening_requires_fresh_twenty_minute_window():
    assert CONFIG['template'][0]['binary_sensor'][0]['delay_on'] == '00:20:00'
    assert render(DRY)
    assert not render(DRY, {'sensor.moth_a_mother_humidity': '58'})
    assert not render(START, {'binary_sensor.mother_refill_dry_candidate': 'off'})


@pytest.mark.parametrize('changes', [
    {'switch.mother_fan': 'on'}, {'switch.mother_intake_fan': 'unavailable'},
    {'sensor.moth_a_mother_humidity': 'unknown'}, {'sensor.moth_a_mother_humidity': '0'},
    {'sensor.moth_a_mother_temperature': '94'}, {'sensor.moth_a_mother_co2': '1200'},
    {'automation.mother_humidifier_pulse_control': 'off'},
    {'input_select.mother_humidity_control_state': 'Critical Cooling'},
])
def test_vent_and_sensor_faults_never_qualify(changes):
    assert not render(DRY, changes)


def test_stale_sensor_never_qualifies():
    assert not render(DRY, age=120)


@pytest.mark.parametrize('changes', [
    {'input_boolean.mother_refill_enabled': 'off'},
    {'input_boolean.mother_refill_locked': 'on'},
    {'input_boolean.mother_refill_active': 'on'},
    {PUMP: 'on'}, {PUMP: 'unavailable'},
    {'input_datetime.mother_refill_last_started': (NOW-timedelta(hours=6)+timedelta(seconds=1)).isoformat()},
])
def test_repeat_or_unready_pump_cannot_start(changes):
    assert not render(START, changes)


def test_cooldown_boundary_allows_one_qualified_attempt():
    assert render(START, {'input_datetime.mother_refill_last_started': (NOW-timedelta(hours=6)).isoformat()})


def test_deadline_and_restart_stop_without_delay_completion():
    active = {'input_boolean.mother_refill_active': 'on', PUMP: 'on'}
    assert not render(STOP, active)
    assert render(STOP, active, trigger='restart')
    assert render(STOP, {**active, 'input_datetime.mother_refill_deadline': NOW.isoformat()})
    assert render(STOP, {**active, 'input_datetime.mother_refill_deadline': 'unavailable'})
    assert render(STOP, {**active, 'input_boolean.mother_refill_enabled': 'off'})
    assert render(STOP, {**active, 'switch.mother_fan': 'on'})
    assert render(STOP, active, age=120)


def test_recovery_does_not_automatically_repeat_or_cut_short_ten_minutes():
    assert not render(STOP, {'input_boolean.mother_refill_active': 'on', PUMP: 'on', 'sensor.moth_a_mother_humidity': '66'})
    assert CONFIG['template'][0]['binary_sensor'][1]['delay_on'] == '00:20:00'
    assert CONFIG['input_boolean']['mother_refill_active']['initial'] is False
    assert 'initial' not in CONFIG['input_boolean']['mother_refill_locked']
    assert 'initial' not in CONFIG['input_datetime']['mother_refill_last_started']
    assert {'delay': '00:10:00'} in CONFIG['automation'][0]['actions']
