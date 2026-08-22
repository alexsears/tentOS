"""Tests for the second round of audit fixes.

Covers: cached/concurrent automation configs, alert muting, target validation,
and the light scheduler backing off when something keeps reverting a switch.
"""
import asyncio
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))

from routes import automations as automations_route  # noqa: E402
from light_scheduler import LightScheduler  # noqa: E402


# ---------------------------------------------------------------- automations

class CountingHAClient:
    def __init__(self):
        self.calls = 0
        self.concurrent = 0
        self.peak_concurrent = 0

    async def get_automation_config(self, auto_id):
        self.calls += 1
        self.concurrent += 1
        self.peak_concurrent = max(self.peak_concurrent, self.concurrent)
        await asyncio.sleep(0)  # let siblings interleave
        self.concurrent -= 1
        return {"id": auto_id, "alias": auto_id}


def automation_list(n):
    return [{"entity_id": f"automation.a{i}"} for i in range(n)]


@pytest.fixture(autouse=True)
def clear_cache():
    automations_route.invalidate_automation_configs()
    yield
    automations_route.invalidate_automation_configs()


def test_configs_are_fetched_once_and_then_cached():
    client = CountingHAClient()
    autos = automation_list(20)

    first = asyncio.run(automations_route.get_automation_configs(client, autos))
    second = asyncio.run(automations_route.get_automation_configs(client, autos))

    assert len(first) == 20
    assert len(second) == 20
    assert client.calls == 20, "second call should have been served from cache"


def test_configs_are_fetched_concurrently():
    client = CountingHAClient()

    asyncio.run(automations_route.get_automation_configs(client, automation_list(30)))

    # Sequentially this peaks at 1; the point of the fix is that it does not
    assert client.peak_concurrent > 1


def test_a_write_drops_the_cache():
    client = CountingHAClient()
    autos = automation_list(5)

    asyncio.run(automations_route.get_automation_configs(client, autos))
    automations_route.invalidate_automation_configs()
    asyncio.run(automations_route.get_automation_configs(client, autos))

    assert client.calls == 10


def test_expired_entries_are_refetched():
    client = CountingHAClient()
    autos = automation_list(3)

    asyncio.run(automations_route.get_automation_configs(client, autos))
    asyncio.run(automations_route.get_automation_configs(client, autos, ttl=0))

    assert client.calls == 6


# --------------------------------------------------------------------- alerts

class FakeStateManager:
    """Just enough of StateManager for the mute helpers."""

    def __init__(self):
        from state_manager import StateManager
        self.real = StateManager.__new__(StateManager)
        self.real.tents = {}
        self.real.muted_alerts = {}

    def apply(self, tent_id, alerts):
        return self.real._apply_mutes(tent_id, alerts)


def test_alerts_get_a_stable_key():
    sm = FakeStateManager()

    out = sm.apply("flower", [{"type": "humidity_out_of_range", "severity": "warning"}])

    assert out[0]["key"] == "flower:humidity_out_of_range"


def test_a_muted_alert_stops_being_reported():
    sm = FakeStateManager()
    alert = {"type": "humidity_out_of_range", "severity": "warning"}

    sm.real.muted_alerts["flower:humidity_out_of_range"] = datetime.now(timezone.utc) + timedelta(hours=1)

    assert sm.apply("flower", [alert]) == []


def test_a_lapsed_mute_lets_the_alert_back_through():
    sm = FakeStateManager()
    alert = {"type": "humidity_out_of_range", "severity": "warning"}

    sm.real.muted_alerts["flower:humidity_out_of_range"] = datetime.now(timezone.utc) - timedelta(minutes=1)

    assert len(sm.apply("flower", [alert])) == 1
    assert sm.real.muted_alerts == {}


def test_a_mute_clears_when_the_condition_resolves():
    sm = FakeStateManager()
    sm.real.muted_alerts["flower:humidity_out_of_range"] = datetime.now(timezone.utc) + timedelta(hours=1)

    sm.apply("flower", [])  # condition no longer firing

    assert sm.real.muted_alerts == {}, "a resolved condition should not stay muted"


def test_one_tents_mute_does_not_silence_another():
    sm = FakeStateManager()
    sm.real.muted_alerts["mother:humidity_out_of_range"] = datetime.now(timezone.utc) + timedelta(hours=1)

    out = sm.apply("flower", [{"type": "humidity_out_of_range", "severity": "warning"}])

    assert len(out) == 1
    assert "mother:humidity_out_of_range" in sm.real.muted_alerts


# ------------------------------------------------------------ light scheduler

def test_scheduler_backs_off_when_a_switch_keeps_reverting():
    scheduler = LightScheduler(ha_client=None, state_manager=SimpleNamespace(tents={}))

    results = [scheduler._should_back_off("switch.lab_diablo") for _ in range(5)]

    assert results[:3] == [False, False, False]
    assert results[3] is True and results[4] is True


def test_back_off_is_per_entity():
    scheduler = LightScheduler(ha_client=None, state_manager=SimpleNamespace(tents={}))

    for _ in range(4):
        scheduler._should_back_off("switch.a")

    assert scheduler._should_back_off("switch.b") is False
