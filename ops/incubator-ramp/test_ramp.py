from datetime import datetime, timedelta
from pathlib import Path

import jinja2
import pytest
import yaml

CONFIG=yaml.safe_load(Path(__file__).with_name('incubator_rh_template.yaml').read_text(encoding='utf-8'))
TARGET=next(s for s in CONFIG['sensor'] if s.get('unique_id')=='incubator_target_rh')

def target_on(day):
    start=datetime(2026,8,22)
    env=jinja2.Environment()
    text=env.from_string(TARGET['state']).render(
        states=lambda e:'2026-08-22',is_state=lambda e,v:False,
        now=lambda:start+timedelta(days=day),strptime=datetime.strptime)
    return float(text.strip())

@pytest.mark.parametrize('day,target',[(-1,87),(0,87),(6,85.29),(7,85),(14,76.92),(20,70),(21,68.75),(22,67.5),(27,61.25),(28,60),(60,60)])
def test_daily_boundaries(day,target):
    assert target_on(day)==target

def test_daily_changes_are_monotonic_and_bounded():
    values=[target_on(day) for day in range(31)]
    assert all(0 <= a-b <= 1.25 for a,b in zip(values,values[1:]))

def test_missing_date_retains_starting_humidity():
    env=jinja2.Environment()
    text=env.from_string(TARGET['state']).render(states=lambda e:'unknown',is_state=lambda e,v:False)
    assert float(text.strip())==87

def test_manual_override_still_works():
    env=jinja2.Environment()
    text=env.from_string(TARGET['state']).render(states=lambda e:'72',is_state=lambda e,v:True)
    assert float(text.strip())==72
