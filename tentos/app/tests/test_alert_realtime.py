"""Alert changes must reach both the tent dashboard and global header live."""
import asyncio
import json
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from state_manager import StateManager  # noqa: E402
from routes.alerts import MuteRequest, mute_alert  # noqa: E402


class RecordingSocket:
    def __init__(self):
        self.messages = []

    async def send_text(self, message):
        self.messages.append(json.loads(message))


class FakeTent:
    def __init__(self):
        self.config = SimpleNamespace(
            name="Flower",
            targets={
                "temp_day_min": 20,
                "temp_day_max": 28,
                "humidity_day_min": 40,
                "humidity_day_max": 70,
            },
            notifications={"enabled": True},
        )
        self.sensors = {
            "temperature": {"value": 24},
            "humidity": {"value": 85},
        }
        self.alerts = []

    def to_dict(self):
        return {"id": "flower", "name": "Flower", "alerts": self.alerts}


def make_manager():
    manager = StateManager.__new__(StateManager)
    manager.tents = {"flower": FakeTent()}
    manager.muted_alerts = {}
    manager.ws_clients = [RecordingSocket()]
    return manager


def test_new_and_resolved_alerts_broadcast_tent_and_summary_updates():
    manager = make_manager()
    socket = manager.ws_clients[0]

    asyncio.run(manager._check_alerts())

    assert [message["type"] for message in socket.messages] == ["tent_update", "alert_summary"]
    assert socket.messages[0]["data"]["alerts"][0]["type"] == "humidity_out_of_range"
    assert socket.messages[1]["data"] == {"critical": 0, "warning": 1, "info": 0, "total": 1}

    socket.messages.clear()
    manager.tents["flower"].sensors["humidity"]["value"] = 55
    asyncio.run(manager._check_alerts())

    assert socket.messages[0]["data"]["alerts"] == []
    assert socket.messages[1]["data"]["total"] == 0


def test_muting_an_alert_broadcasts_the_updated_tent_and_summary():
    manager = make_manager()
    asyncio.run(manager._check_alerts())
    manager.ws_clients[0].messages.clear()

    asyncio.run(mute_alert(MuteRequest(key="flower:humidity_out_of_range", hours=8), manager))

    messages = manager.ws_clients[0].messages
    assert messages[0]["type"] == "tent_update"
    assert messages[0]["data"]["alerts"] == []
    assert messages[1] == {
        "type": "alert_summary",
        "data": {"critical": 0, "warning": 0, "info": 0, "total": 0},
    }
