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


def render(template, changes=None, age=0, trigger='tick', source='off', relay_age=10, raw=False, context=None):
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
                k.split('.', 1)[1]: SimpleNamespace(last_updated=NOW-timedelta(seconds=age), last_changed=NOW-timedelta(seconds=relay_age))
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
        trigger=SimpleNamespace(id=trigger, from_state=SimpleNamespace(state=source)),
        **(context or {}),
    )
    return result.strip() if raw else result.strip() == 'True'


DRY = CONFIG['template'][0]['binary_sensor'][0]['state']
START = CONFIG['automation'][0]['actions'][0]['value_template']
STOP = CONFIG['automation'][1]['actions'][2]['value_template']
MANUAL = CONFIG['automation'][1]['actions'][1]['if'][0]['value_template']


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
    assert render(STOP, active, trigger='disabled')
    assert not render(STOP, {**active, 'input_boolean.mother_refill_enabled':'off'})
    assert render(STOP, {**active, 'switch.mother_fan': 'on'})
    assert render(STOP, active, age=120)


def test_recovery_does_not_automatically_repeat_or_cut_short_ten_minutes():
    assert not render(STOP, {'input_boolean.mother_refill_active': 'on', PUMP: 'on', 'sensor.moth_a_mother_humidity': '66'})
    assert CONFIG['template'][0]['binary_sensor'][1]['delay_on'] == '00:20:00'
    assert CONFIG['input_boolean']['mother_refill_active']['initial'] is False
    assert 'initial' not in CONFIG['input_boolean']['mother_refill_locked']
    assert 'initial' not in CONFIG['input_datetime']['mother_refill_last_started']
    assert not any('delay' in action for action in CONFIG['automation'][0]['actions'])


def test_rearm_accepts_normal_control_band_but_not_dry_or_stale_air():
    recovery = CONFIG['template'][0]['binary_sensor'][1]['state']
    assert render(recovery, {'sensor.moth_a_mother_humidity':'62'})
    assert not render(recovery, {'sensor.moth_a_mother_humidity':'61.9'})
    assert not render(recovery, {'sensor.moth_a_mother_humidity':'unknown'})
    assert not render(recovery, {'sensor.moth_a_mother_humidity':'66'}, age=120)
    assert not render(recovery, {'sensor.moth_a_mother_humidity':'66', PUMP:'on'})


def test_manual_on_gets_timer_without_low_humidity_or_auto_enable():
    assert render(MANUAL, {PUMP:'on', 'input_boolean.mother_refill_enabled':'off',
                           'binary_sensor.mother_refill_dry_candidate':'off'}, trigger='pump_on')
    assert CONFIG['automation'][1]['mode']=='queued'
    setup=CONFIG['automation'][1]['actions'][1]['then']
    deadline=next(x for x in setup if x.get('target',{}).get('entity_id')=='input_datetime.mother_refill_deadline')
    assert '+ 600' in deadline['data']['timestamp']


@pytest.mark.parametrize('source',['unknown','unavailable'])
def test_reconnect_never_looks_like_manual_start(source):
    assert not render(MANUAL, {PUMP:'on'}, trigger='pump_on', source=source)


def test_automatic_on_keeps_existing_deadline_and_manual_off_cancels():
    assert not render(MANUAL, {PUMP:'on','input_boolean.mother_refill_active':'on'}, trigger='pump_on')
    assert CONFIG['automation'][1]['actions'][0]['then'][-1].get('stop')


def run_watch(values, event, source='off', relay_age=10):
    switched_off=[]
    context={}
    def run(actions):
        for action in actions:
            if 'stop' in action:
                return False
            if 'condition' in action:
                if not render(action['value_template'], values, trigger=event, source=source, relay_age=relay_age, context=context):
                    return False
            elif 'variables' in action:
                for key, value in action['variables'].items():
                    context[key]=render(value, values, trigger=event, relay_age=relay_age, context=context)
            elif 'if' in action:
                condition=action['if'][0]
                result=(values.get(condition['entity_id'])==condition['state']) if condition['condition']=='state' else render(condition['value_template'],values,trigger=event,source=source,relay_age=relay_age,context=context)
                if result and run(action['then']) is False:
                    return False
            elif 'action' in action:
                service=action['action'];target=action.get('target',{}).get('entity_id')
                if service.startswith('input_boolean.'):
                    values[target]='on' if service.endswith('turn_on') else 'off'
                elif service=='input_datetime.set_datetime':
                    stamp=float(render(action['data']['timestamp'],values,raw=True))
                    values[target]=datetime.fromtimestamp(stamp,timezone.utc).isoformat()
                elif service=='switch.turn_off':
                    switched_off.append(target);values[target]='off'
        return True
    run(CONFIG['automation'][1]['actions'])
    return switched_off


def test_tick_before_manual_event_does_not_recreate_immediate_shutoff():
    values={PUMP:'on','input_boolean.mother_refill_active':'off',
            'input_datetime.mother_refill_deadline':(NOW-timedelta(hours=1)).isoformat()}
    assert run_watch(values,'tick',relay_age=0.1)==[]
    assert run_watch(values,'pump_on',relay_age=0.2)==[]
    assert values['input_boolean.mother_refill_active']=='on'
    assert values['input_datetime.mother_refill_deadline']==(NOW+timedelta(seconds=600)).isoformat()
    assert run_watch(values,'tick',relay_age=10)==[]
    values['input_datetime.mother_refill_deadline']=NOW.isoformat()
    assert run_watch(values,'tick',relay_age=600)==[PUMP]


def test_queued_old_off_then_new_on_never_switches_off_new_run():
    values={PUMP:'on','input_boolean.mother_refill_active':'on'}
    assert run_watch(values,'pump_off',relay_age=0.1)==[]
    assert values['input_boolean.mother_refill_active']=='off'
    assert run_watch(values,'pump_on',relay_age=0.2)==[]
    assert values['input_boolean.mother_refill_active']=='on'


def test_orphaned_on_is_bounded_and_grace_does_not_suppress_safety():
    values={PUMP:'on','input_boolean.mother_refill_active':'off'}
    assert run_watch(values,'tick',relay_age=2)==[PUMP]
    values={PUMP:'on','input_boolean.mother_refill_active':'off','switch.mother_fan':'on'}
    assert run_watch(values,'tick',relay_age=0.1)==[PUMP]
