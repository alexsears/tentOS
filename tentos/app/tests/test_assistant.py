"""Tests for TentOS AI context, entity resolution, and confirmed actions."""

import asyncio
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))

from routes import assistant, config as config_routes
from routes.config import AppConfig, TentConfig


class FakeHAClient:
    def __init__(self, states):
        self.states = states

    async def get_states(self):
        return self.states

    async def get_state(self, entity_id):
        return next((state for state in self.states if state['entity_id'] == entity_id), None)


class FakeStateManager:
    def __init__(self, tent, assignment=None):
        self.tent = tent
        self.entity_to_tent = assignment or {}
        self.reloaded = False

    def get_tent(self, tent_id):
        return self.tent if tent_id == self.tent.config.id else None

    async def reload_config(self):
        self.reloaded = True


def fake_tent():
    config = SimpleNamespace(
        id='veg_tent',
        name='Veg Tent',
        sensors={'temperature': ['sensor.veg_temperature']},
        actuators={'light': ['switch.veg_light']},
    )
    return SimpleNamespace(
        config=config,
        slot_to_entity={'light': 'switch.veg_light'},
    )


def fake_request(states, assignment=None):
    tent = fake_tent()
    manager = FakeStateManager(tent, assignment)
    app_state = SimpleNamespace(state_manager=manager, ha_client=FakeHAClient(states))
    return SimpleNamespace(app=SimpleNamespace(state=app_state)), manager


def entity(entity_id, friendly_name, device_class=None, state='on'):
    return {
        'entity_id': entity_id,
        'state': state,
        'attributes': {
            'friendly_name': friendly_name,
            'device_class': device_class,
        },
    }


def test_sensor_stats_groups_each_tent_and_sensor():
    start = datetime.now(timezone.utc) - timedelta(hours=1)
    rows = [
        SimpleNamespace(tent_id='veg_tent', sensor_type='temperature', value=22.0, timestamp=start),
        SimpleNamespace(tent_id='veg_tent', sensor_type='temperature', value=26.0, timestamp=start + timedelta(minutes=5)),
        SimpleNamespace(tent_id='veg_tent', sensor_type='humidity', value=60.0, timestamp=start),
    ]

    stats = assistant._sensor_stats(rows)

    assert stats['veg_tent']['temperature']['min'] == 22.0
    assert stats['veg_tent']['temperature']['max'] == 26.0
    assert stats['veg_tent']['temperature']['average'] == 24.0
    assert stats['veg_tent']['temperature']['latest'] == 26.0
    assert stats['veg_tent']['temperature']['samples'] == 2


def test_entity_search_resolves_friendly_name_and_filters_unsupported_domains():
    states = [
        entity('sensor.lab1a_temperature', 'Lab1a Temperature', 'temperature', '24.1'),
        entity('sensor.lab1a_humidity', 'Lab1a Humidity', 'humidity', '61'),
        entity('person.lab1a', 'Lab1a Person'),
    ]
    request, _ = fake_request(states)

    result = asyncio.run(assistant._find_home_assistant_entities('Lab1a', request))

    assert result['ok'] is True
    assert [match['entity_id'] for match in result['matches']] == [
        'sensor.lab1a_humidity',
        'sensor.lab1a_temperature',
    ]


def test_add_entity_proposal_validates_slot_compatibility():
    states = [entity('sensor.lab1a_temperature', 'Lab1a Temperature', 'temperature', '24.1')]
    request, _ = fake_request(states)

    result = asyncio.run(assistant._create_pending_action(
        'propose_add_entity_to_tent',
        {
            'tent_id': 'veg_tent',
            'entity_id': 'sensor.lab1a_temperature',
            'category': 'sensors',
            'role': 'temperature',
        },
        request,
        'session-123',
    ))

    assert result['ok'] is True
    pending = assistant._pending_actions[result['token']]
    assert pending['kind'] == 'add_entity'
    assert pending['summary'] == 'Add Lab1a Temperature (sensor.lab1a_temperature) to Veg Tent as temperature'

    incompatible = asyncio.run(assistant._create_pending_action(
        'propose_add_entity_to_tent',
        {
            'tent_id': 'veg_tent',
            'entity_id': 'sensor.lab1a_temperature',
            'category': 'sensors',
            'role': 'humidity',
        },
        request,
        'session-123',
    ))
    assert incompatible['ok'] is False
    assert 'not compatible' in incompatible['error']


def test_slot_compatibility_matches_tent_builder_null_wildcard():
    assert assistant._slot_compatible('actuators', 'light', {
        'domain': 'switch',
        'device_class': 'outlet',
    }) is True


def test_water_pump_control_is_rejected_server_side():
    request, manager = fake_request([])
    manager.tent.slot_to_entity['water_pump'] = 'switch.veg_water_pump'

    result = asyncio.run(assistant._create_pending_action(
        'propose_actuator_change',
        {'tent_id': 'veg_tent', 'actuator': 'water_pump', 'state': 'on'},
        request,
        'session-123',
    ))

    assert result['ok'] is False
    assert 'unavailable' in result['error']


def test_fan_percentage_rejects_switch_backed_fan():
    request, manager = fake_request([])
    manager.tent.slot_to_entity['exhaust_fan'] = 'switch.veg_exhaust'

    result = asyncio.run(assistant._create_pending_action(
        'propose_fan_speed',
        {'tent_id': 'veg_tent', 'actuator': 'exhaust_fan', 'percentage': 50},
        request,
        'session-123',
    ))

    assert result['ok'] is False
    assert 'fan entities' in result['error']


def test_confirm_add_entity_updates_config_and_reloads(monkeypatch):
    states = [entity('sensor.lab1a_temperature', 'Lab1a Temperature', 'temperature', '24.1')]
    request, manager = fake_request(states)
    config = AppConfig(tents=[TentConfig(
        id='veg_tent',
        name='Veg Tent',
        sensors={'temperature': ['sensor.veg_temperature']},
        actuators={'light': ['switch.veg_light']},
        control_settings={'order': ['light']},
        growth_stage={'stage': 'flower', 'week': 3},
    )])
    saved = []

    monkeypatch.setattr(assistant, 'load_config', lambda: config)
    monkeypatch.setattr(assistant, 'save_config', lambda value: saved.append(value) or True)

    async def no_log(*_args, **_kwargs):
        return None

    monkeypatch.setattr(assistant, '_log_assistant_action', no_log)
    token = 'confirm-add-token'
    assistant._pending_actions[token] = {
        'token': token,
        'session_id': 'session-123',
        'created_at': __import__('time').time(),
        'kind': 'add_entity',
        'tent_id': 'veg_tent',
        'tent_name': 'Veg Tent',
        'entity_id': 'sensor.lab1a_temperature',
        'friendly_name': 'Lab1a Temperature',
        'category': 'sensors',
        'role': 'temperature',
        'multiple': True,
        'replaces_entity': None,
        'summary': 'Add Lab1a Temperature to Veg Tent as temperature',
    }

    result = asyncio.run(assistant.confirm_action(
        token,
        assistant.ActionDecisionRequest(session_id='session-123'),
        request,
    ))

    assert result['success'] is True
    assert saved[0].tents[0].sensors['temperature'] == [
        'sensor.veg_temperature',
        'sensor.lab1a_temperature',
    ]
    assert manager.reloaded is True
    assert saved[0].tents[0].control_settings == {'order': ['light']}
    assert saved[0].tents[0].growth_stage == {'stage': 'flower', 'week': 3}
    assert token not in assistant._pending_actions


def test_config_merge_preserves_builder_control_and_growth_fields(monkeypatch, tmp_path):
    config_path = tmp_path / 'config.json'
    config_path.write_text(__import__('json').dumps({
        'tents': [{
            'id': 'veg_tent',
            'name': 'Veg Tent',
            'control_settings': {'order': ['exhaust_fan', 'light']},
            'growth_stage': {'stage': 'flower', 'week': 4},
        }],
    }))
    option_tent = config_routes.TentConfig(
        id='veg_tent',
        name='Veg Tent',
        control_settings={'order': ['light']},
        growth_stage={'stage': 'veg'},
    )
    monkeypatch.setattr(config_routes, 'CONFIG_PATH', config_path)
    monkeypatch.setattr(config_routes, '_load_tents_from_options', lambda: [option_tent])

    merged = config_routes.load_config()

    assert merged.tents[0].control_settings == {'order': ['exhaust_fan', 'light']}
    assert merged.tents[0].growth_stage == {'stage': 'flower', 'week': 4}


def test_confirm_add_entity_rejects_new_assignment():
    states = [entity('sensor.lab1a_temperature', 'Lab1a Temperature', 'temperature', '24.1')]
    assignment = {
        'sensor.lab1a_temperature': ('flower_tent', 'sensor', 'temperature'),
    }
    request, _ = fake_request(states, assignment)
    token = 'stale-add-token'
    assistant._pending_actions[token] = {
        'token': token,
        'session_id': 'session-123',
        'created_at': __import__('time').time(),
        'kind': 'add_entity',
        'tent_id': 'veg_tent',
        'tent_name': 'Veg Tent',
        'entity_id': 'sensor.lab1a_temperature',
        'friendly_name': 'Lab1a Temperature',
        'category': 'sensors',
        'role': 'temperature',
        'multiple': True,
        'replaces_entity': None,
        'summary': 'Add Lab1a Temperature to Veg Tent as temperature',
    }

    with pytest.raises(assistant.HTTPException) as exc_info:
        asyncio.run(assistant.confirm_action(
            token,
            assistant.ActionDecisionRequest(session_id='session-123'),
            request,
        ))

    assert exc_info.value.status_code == 409
    assert 'flower_tent' in exc_info.value.detail


def test_confirmation_token_cannot_execute_concurrently(monkeypatch):
    class BlockingHAClient(FakeHAClient):
        def __init__(self):
            super().__init__([])
            self.entered = asyncio.Event()
            self.release = asyncio.Event()

        async def turn_off(self, _entity_id):
            self.entered.set()
            await self.release.wait()

    async def no_log(*_args, **_kwargs):
        return None

    async def run_scenario():
        request, _ = fake_request([])
        client = BlockingHAClient()
        request.app.state.ha_client = client
        token = 'single-use-token'
        assistant._pending_actions[token] = {
            'token': token,
            'session_id': 'session-123',
            'created_at': __import__('time').time(),
            'kind': 'actuator_change',
            'tent_id': 'veg_tent',
            'tent_name': 'Veg Tent',
            'actuator': 'light',
            'entity_id': 'switch.veg_light',
            'state': 'off',
            'summary': 'Turn Veg Tent light off',
        }
        first = asyncio.create_task(assistant.confirm_action(
            token,
            assistant.ActionDecisionRequest(session_id='session-123'),
            request,
        ))
        await client.entered.wait()
        with pytest.raises(assistant.HTTPException) as exc_info:
            await assistant.confirm_action(
                token,
                assistant.ActionDecisionRequest(session_id='session-123'),
                request,
            )
        client.release.set()
        first_result = await first
        return exc_info.value.status_code, first_result

    monkeypatch.setattr(assistant, '_log_assistant_action', no_log)
    second_status, first_result = asyncio.run(run_scenario())

    assert second_status == 404
    assert first_result['success'] is True


def test_confirm_actuator_rejects_changed_entity_mapping():
    request, manager = fake_request([])
    manager.tent.slot_to_entity['light'] = 'switch.replacement_light'
    token = 'stale-actuator-token'
    assistant._pending_actions[token] = {
        'token': token,
        'session_id': 'session-123',
        'created_at': __import__('time').time(),
        'kind': 'actuator_change',
        'tent_id': 'veg_tent',
        'tent_name': 'Veg Tent',
        'actuator': 'light',
        'entity_id': 'switch.veg_light',
        'state': 'off',
        'summary': 'Turn Veg Tent light off',
    }

    with pytest.raises(assistant.HTTPException) as exc_info:
        asyncio.run(assistant.confirm_action(
            token,
            assistant.ActionDecisionRequest(session_id='session-123'),
            request,
        ))

    assert exc_info.value.status_code == 409
    assert 'changed after this proposal' in exc_info.value.detail


def test_the_tents_is_explicitly_mapped_to_all_configured_tents():
    prompt = assistant._instructions({'tents': [{'id': 'veg_tent'}, {'id': 'flower_tent'}]})

    assert '"the tents"' in prompt
    assert "['veg_tent', 'flower_tent']" in prompt
    assert 'TentOS only' in prompt
    assert 'Do not use Markdown markers' in prompt
