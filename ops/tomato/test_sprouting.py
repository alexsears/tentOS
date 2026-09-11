from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import jinja2
import pytest
import yaml

CONFIG = yaml.safe_load(Path(__file__).with_name('tomato_sprouting.yaml').read_text(encoding='utf-8'))

def evaluate(rh='50', temp='76', unit='°F', enabled=True, fan='on', exhaust='off', mist='off', mist_age=90, sensor_age=0, minute=3, second=0):
    now = datetime(2026,9,11,15,minute,second,tzinfo=timezone.utc)
    values = {
        'input_boolean.tomato_sprouting_enabled': 'on' if enabled else 'off',
        'sensor.pot_scale_weight_c3_humidity': rh,
        'sensor.pot_scale_weight_c3_temperature': temp,
        'switch.garage_tomato_fan': fan,
        'switch.tomato_exhaust': exhaust,
        'switch.garage_tomato_humidifier': mist,
    }
    class States:
        def __call__(self, key): return values.get(key, 'unknown')
        def __getattr__(self, domain):
            return SimpleNamespace(**{key.split('.')[1]:SimpleNamespace(last_reported=now-timedelta(seconds=sensor_age),last_changed=now-timedelta(seconds=mist_age)) for key in values if key.startswith(domain+'.')})
    def timestamp(value, default=0):
        return value.timestamp() if isinstance(value,datetime) else default
    def is_number(value):
        try: return float('-inf') < float(value) < float('inf')
        except ValueError: return False
    env=jinja2.Environment()
    env.globals.update(states=States(),is_state=lambda k,v:values.get(k)==v,state_attr=lambda k,a:unit,now=lambda:now,as_timestamp=timestamp,is_number=is_number)
    context={}
    for key, template in CONFIG['automation'][0]['actions'][0]['variables'].items():
        result=env.from_string(template).render(**context).strip()
        context[key] = {'True':True,'False':False}.get(result, result)
        if isinstance(context[key],str):
            try: context[key]=float(result)
            except ValueError: pass
    return context

def test_normal_start_requires_confirmed_fan_and_exhaust_off():
    assert evaluate()['mist']
    assert not evaluate(fan='off')['mist']
    assert evaluate(fan='off')['circulate']
    assert not evaluate(fan='unavailable')['mist']
    assert not evaluate(exhaust='unavailable')['mist']
    assert not evaluate(exhaust='on')['mist']

@pytest.mark.parametrize('kwargs',[{'rh':'unknown'},{'temp':'unavailable'},{'rh':'nan'},{'rh':'0'},{'rh':'100'},{'sensor_age':120},{'unit':'K'}])
def test_bad_sensor_stops_mist_and_ventilates(kwargs):
    r=evaluate(**kwargs)
    assert not r['mist']
    assert r['vent'] and r['circulate']

def test_band_has_no_routine_runtime_limit_or_rest():
    assert evaluate(rh='77',mist='on')['mist']
    assert not evaluate(rh='77')['mist']
    assert not evaluate(rh='80',mist='on')['mist']
    for age in [0, 59, 60, 180, 3600]:
        assert evaluate(mist='on',mist_age=age)['mist']
        assert evaluate(mist='off',mist_age=age)['mist']
    assert not evaluate(temp='85')['mist']
    assert evaluate(temp='85')['vent']
    assert evaluate(temp='24',unit='°C')['mist']

def test_natural_schedule_boundaries():
    assert evaluate(rh='78',minute=10,second=0)['vent']
    assert evaluate(rh='78',minute=10,second=15)['vent']
    assert not evaluate(rh='78',minute=10,second=30)['vent']
    assert evaluate(rh='78',minute=11)['circulate']
    assert not evaluate(rh='78',minute=12)['circulate']

def test_disabled_stops_all_climate_outputs():
    r=evaluate(enabled=False,mist='on',temp='90')
    assert not any(r[k] for k in ['mist','vent','circulate'])

def test_no_water_or_light_actuation():
    text=Path(__file__).with_name('tomato_sprouting.yaml').read_text()
    assert 'switch.tomato_water' not in text
    assert 'switch.garage_tomato_light' not in text

def test_missing_humidifier_entity_does_not_abort_controller():
    assert not evaluate(mist='unknown')['mist']
    assert not evaluate(mist='unavailable')['mist']

def test_legacy_runtime_cutoff_is_removed():
    assert all(a['id'] != 'tomato_sprouting_mist_cutoff' for a in CONFIG['automation'])

def test_high_humidity_still_stops_mist():
    result=evaluate(rh='85',mist='on')
    assert not result['mist']
    assert result['vent']
