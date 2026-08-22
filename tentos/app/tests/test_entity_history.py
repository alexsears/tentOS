"""Tests for the any-entity history route behind click-through to Reports."""
import asyncio
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))

from routes.reports import get_entity_history  # noqa: E402


def call(client, entity_id, range="24h"):
    """FastAPI fills Query defaults at request time; supply them directly here."""
    return asyncio.run(get_entity_history(
        make_request(client), entity_id=entity_id, range=range,
        from_time=None, to_time=None, max_points=500,
    ))


class FakeHAClient:
    def __init__(self, history, state=None):
        self._history = history
        self._state = state
        self.requested = None

    async def get_history(self, entity_ids, start_time, end_time=None):
        self.requested = (entity_ids, start_time, end_time)
        return self._history

    async def get_state(self, entity_id):
        return self._state


def make_request(client):
    return SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(ha_client=client)))


def iso(minutes_ago):
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).isoformat()


def test_numeric_sensor_returns_series_and_stats():
    client = FakeHAClient(
        history=[[
            {"entity_id": "sensor.pot_scale_co2", "state": "600", "last_changed": iso(30)},
            {"entity_id": "sensor.pot_scale_co2", "state": "800", "last_changed": iso(20)},
            {"entity_id": "sensor.pot_scale_co2", "state": "unavailable", "last_changed": iso(10)},
        ]],
        state={"entity_id": "sensor.pot_scale_co2",
               "attributes": {"friendly_name": "Pot scale CO2", "unit_of_measurement": "ppm",
                              "device_class": "carbon_dioxide"}},
    )

    result = call(client, "sensor.pot_scale_co2")

    assert result["kind"] == "numeric"
    assert result["unit"] == "ppm"
    assert result["friendly_name"] == "Pot scale CO2"
    assert [p["value"] for p in result["data"]] == [600.0, 800.0]
    assert result["stats"]["min"] == 600.0
    assert result["stats"]["max"] == 800.0
    assert result["stats"]["current"] == 800.0


def test_switch_returns_step_states_with_duty_cycle():
    client = FakeHAClient(
        history=[[
            {"entity_id": "switch.incubator_fan", "state": "off", "last_changed": iso(60)},
            {"entity_id": "switch.incubator_fan", "state": "on", "last_changed": iso(30)},
        ]],
        state={"entity_id": "switch.incubator_fan",
               "attributes": {"friendly_name": "Incubator fan"}},
    )

    result = call(client, "switch.incubator_fan", range="1h")

    assert result["kind"] == "state"
    assert [s["on"] for s in result["states"]] == [False, True]
    assert result["stats"]["current"] == "on"
    # On for the final half of a one hour window
    assert 45 <= result["stats"]["on_percent"] <= 55


def test_empty_history_is_not_an_error():
    client = FakeHAClient(history=[], state=None)

    result = call(client, "sensor.does_not_exist")

    assert result["kind"] == "empty"
    assert result["data"] == []
    assert result["states"] == []
    assert result["stats"] is None


def test_range_is_passed_through_to_home_assistant():
    client = FakeHAClient(history=[[]], state=None)

    call(client, "sensor.x", range="7d")

    entity_ids, start_time, end_time = client.requested
    assert entity_ids == ["sensor.x"]
    span = datetime.fromisoformat(end_time) - datetime.fromisoformat(start_time)
    assert timedelta(days=6, hours=23) < span < timedelta(days=7, hours=1)
