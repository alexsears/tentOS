"""Lights-on periods behind the chart shading: clamped to the window, merged across
lights, and falling back to the live state when the recorder has nothing."""
import asyncio
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))

from routes.reports import (  # noqa: E402
    extract_light_periods,
    fetch_light_periods,
    get_entity_history,
    merge_light_periods,
)

NOW = datetime(2026, 9, 4, 12, 0, tzinfo=timezone.utc)
START = NOW - timedelta(hours=24)


def at(hours_after_start):
    return START + timedelta(hours=hours_after_start)


def row(entity_id, state, when):
    return {"entity_id": entity_id, "state": state, "last_changed": when.isoformat()}


class FakeHAClient:
    def __init__(self, history, states=None):
        self._history = history
        self._states = states or {}
        self.requested = []

    async def get_history(self, entity_ids, start_time, end_time=None):
        self.requested.append(list(entity_ids))
        return self._history

    async def get_state(self, entity_id):
        return self._states.get(entity_id)


def test_light_already_on_at_window_start_shades_from_the_start():
    # HA reports the state at the start of the window as the first row
    periods = extract_light_periods(
        [row("switch.a", "on", START), row("switch.a", "off", at(8))], START, NOW
    )
    assert periods == [{"start": START, "end": at(8)}]


def test_light_still_on_shades_to_the_window_end():
    periods = extract_light_periods([row("switch.a", "on", at(20))], START, NOW)
    assert periods == [{"start": at(20), "end": NOW}]


def test_dropouts_do_not_end_a_period():
    periods = extract_light_periods(
        [row("switch.a", "on", at(1)), row("switch.a", "unavailable", at(2)), row("switch.a", "off", at(3))],
        START, NOW,
    )
    assert periods == [{"start": at(1), "end": at(3)}]


def test_two_lights_on_the_same_photoperiod_give_one_band():
    merged = merge_light_periods([
        {"start": at(9), "end": at(21)},
        {"start": at(9) + timedelta(seconds=1), "end": at(21) + timedelta(seconds=1)},
        {"start": at(22), "end": at(23)},
    ])
    assert merged == [
        {"start": at(9), "end": at(21) + timedelta(seconds=1)},
        {"start": at(22), "end": at(23)},
    ]


def test_fetch_merges_every_light_and_returns_iso_strings():
    client = FakeHAClient(history=[
        [row("switch.a", "off", START), row("switch.a", "on", at(9)), row("switch.a", "off", at(21))],
        [row("switch.b", "off", START), row("switch.b", "on", at(9)), row("switch.b", "off", at(21))],
    ])
    periods = asyncio.run(fetch_light_periods(client, ["switch.a", "switch.b"], START, NOW))
    assert client.requested == [["switch.a", "switch.b"]]
    assert periods == [{"start": at(9).isoformat(), "end": at(21).isoformat()}]


def test_light_with_no_history_falls_back_to_its_live_state():
    client = FakeHAClient(history=[], states={"switch.mother_light": {"state": "on"}})
    periods = asyncio.run(fetch_light_periods(client, ["switch.mother_light"], START, NOW))
    assert periods == [{"start": START.isoformat(), "end": NOW.isoformat()}]

    dark = FakeHAClient(history=[], states={"switch.mother_light": {"state": "off"}})
    assert asyncio.run(fetch_light_periods(dark, ["switch.mother_light"], START, NOW)) == []


def test_entity_history_carries_the_tent_lights():
    """A sensor charted on its own still gets its tent's photoperiod for shading."""
    tent = SimpleNamespace(slot_to_entity={"light": "switch.a", "exhaust_fan": "switch.fan"})
    state_manager = SimpleNamespace(
        entity_to_tent={"sensor.temp": ("flower", "sensor", "temperature")},
        get_tent=lambda tent_id: tent if tent_id == "flower" else None,
    )

    class Client(FakeHAClient):
        async def get_history(self, entity_ids, start_time, end_time=None):
            self.requested.append(list(entity_ids))
            if entity_ids == ["sensor.temp"]:
                return [[row("sensor.temp", "24.5", at(1)), row("sensor.temp", "25.0", at(2))]]
            return [[row("switch.a", "on", at(9)), row("switch.a", "off", at(21))]]

    client = Client(history=[], states={"sensor.temp": {"attributes": {"friendly_name": "Temp"}}})
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(
        ha_client=client, state_manager=state_manager)))

    result = asyncio.run(get_entity_history(
        request, entity_id="sensor.temp", range="24h", from_time=None, to_time=None, max_points=500,
    ))

    assert result["kind"] == "numeric"
    assert result["light_entities"] == ["switch.a"]
    assert len(result["light_periods"]) == 1
    assert result["light_periods"][0]["start"] == at(9).isoformat()
    assert ["switch.a"] in client.requested
