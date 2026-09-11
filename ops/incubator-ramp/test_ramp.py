from datetime import datetime, timedelta
from pathlib import Path

import jinja2
import pytest
import yaml

CONFIG=yaml.safe_load(Path(__file__).with_name('incubator_rh_template.yaml').read_text(encoding='utf-8'))
TARGET=next(s for s in CONFIG['sensor'] if s.get('unique_id')=='incubator_target_rh')

@pytest.mark.parametrize('day,target',[(0,87),(6,87),(7,85),(13,85),(14,70),(20,70),(21,70),(27,70),(28,60),(60,60)])
def test_week_boundaries(day,target):
    start=datetime(2026,8,22)
    env=jinja2.Environment()
    text=env.from_string(TARGET['state']).render(
        states=lambda e:'2026-08-22',is_state=lambda e,v:False,
        now=lambda:start+timedelta(days=day),strptime=datetime.strptime)
    assert int(text.strip())==target

def test_manual_override_still_works():
    env=jinja2.Environment()
    text=env.from_string(TARGET['state']).render(states=lambda e:'72',is_state=lambda e,v:True)
    assert float(text.strip())==72
