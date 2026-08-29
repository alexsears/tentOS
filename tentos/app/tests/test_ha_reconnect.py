"""The live dashboard must recover when Home Assistant drops its WebSocket."""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from ha_client import HAClient  # noqa: E402


def test_reconnect_restores_subscription_and_replays_current_state(monkeypatch):
    client = HAClient.__new__(HAClient)
    client.connected = False
    client._stopping = False
    client.state_callbacks = [object()]
    client.ws = None
    calls = []

    async def no_wait(_delay):
        return None

    async def connect():
        calls.append("connect")
        client.connected = True

    async def subscribe():
        calls.append("subscribe")

    async def replay():
        calls.append("replay")

    monkeypatch.setattr(asyncio, "sleep", no_wait)
    client._real_connect = connect
    client._subscribe_state_changes = subscribe
    client._replay_current_states = replay

    asyncio.run(client._reconnect_loop())

    assert calls == ["connect", "subscribe", "replay"]


def test_reconnect_retries_with_backoff_after_failure(monkeypatch):
    client = HAClient.__new__(HAClient)
    client.connected = False
    client._stopping = False
    client.state_callbacks = []
    client.ws = None
    delays = []
    attempts = 0

    async def record_wait(delay):
        delays.append(delay)

    async def connect():
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise ConnectionError("temporary outage")
        client.connected = True

    monkeypatch.setattr(asyncio, "sleep", record_wait)
    client._real_connect = connect

    asyncio.run(client._reconnect_loop())

    assert attempts == 2
    assert delays == [1, 2]
