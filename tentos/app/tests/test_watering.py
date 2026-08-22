"""Tests for timed watering runs.

The bug these cover: the manual watering action turned a pump on and returned,
with no timer anywhere to turn it back off.
"""
import asyncio
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))

import watering  # noqa: E402


class FakePump:
    def __init__(self):
        self.calls = []

    async def turn_on(self, entity_id):
        self.calls.append(("on", entity_id))

    async def turn_off(self, entity_id):
        self.calls.append(("off", entity_id))


@pytest.fixture(autouse=True)
def no_db(monkeypatch):
    """The database is not the subject here; keep the persistence calls inert."""
    async def noop(*args, **kwargs):
        return None

    monkeypatch.setattr(watering, "_log", noop)
    monkeypatch.setattr(watering, "_record_run", noop)
    monkeypatch.setattr(watering, "_clear_run", noop)
    watering._runs.clear()
    yield
    watering._runs.clear()


def test_run_turns_the_pump_off_when_the_time_is_up(monkeypatch):
    pump = FakePump()

    async def instant_sleep(_seconds):
        return None

    monkeypatch.setattr(watering.asyncio, "sleep", instant_sleep)

    async def scenario():
        minutes = await watering.start(pump, "flower", "switch.mister", 1)
        # Let the timer task run to completion
        await asyncio.gather(*[t for t in watering._runs.values()], return_exceptions=True)
        return minutes

    minutes = asyncio.run(scenario())

    assert minutes == 1
    assert pump.calls == [("on", "switch.mister"), ("off", "switch.mister")]


def test_a_second_press_does_not_leave_two_timers_on_one_pump(monkeypatch):
    pump = FakePump()

    async def slow_sleep(_seconds):
        await asyncio.sleep(0)  # yield without waiting out the real duration

    monkeypatch.setattr(watering.asyncio, "sleep", slow_sleep)

    async def scenario():
        await watering.start(pump, "flower", "switch.mister", 5)
        await watering.start(pump, "flower", "switch.mister", 5)
        await asyncio.gather(*[t for t in watering._runs.values()], return_exceptions=True)

    asyncio.run(scenario())

    # Whatever the interleaving, the pump must end up off
    assert pump.calls[-1] == ("off", "switch.mister")
    assert ("on", "switch.mister") in pump.calls


def test_duration_is_clamped_to_something_sane():
    assert watering.clamp_minutes(None) == 1
    assert watering.clamp_minutes(0) == 1
    assert watering.clamp_minutes(-5) == 1
    assert watering.clamp_minutes("3") == 3
    assert watering.clamp_minutes(10_000) == watering.MAX_MINUTES


def test_recovery_stops_a_pump_left_on_by_a_dead_timer(monkeypatch):
    pump = FakePump()

    class StrandedOverride:
        tent_id = "flower"
        entity_id = "switch.mister"

    class FakeResult:
        def scalars(self):
            class Scalars:
                def all(self_inner):
                    return [StrandedOverride()]
            return Scalars()

    class FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def execute(self, *args, **kwargs):
            return FakeResult()

    monkeypatch.setattr(watering, "async_session", lambda: FakeSession())

    asyncio.run(watering.recover_stranded(pump))

    assert pump.calls == [("off", "switch.mister")]
