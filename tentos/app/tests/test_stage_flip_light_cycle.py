"""Flipping a tent's stage must move the photoperiod the scheduler enforces.

Mother was flipped to flower on 2026-09-11 and kept its 18 hour veg cycle: the
flip wrote growth_stage and photoperiod_on/off but never schedules.light_cycle,
so the LightScheduler went on enforcing veg while the automation the flip created
switched the light off at 20:00. The two fought until the scheduler backed off.
"""
import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))

import config as config_module  # noqa: E402
from routes.tents import (  # noqa: E402
    FlipToFlowerRequest,
    flip_to_flower,
    reset_to_veg,
)


class FakeHAClient:
    def __init__(self, existing=()):
        self.existing = set(existing)
        self.written = {}
        self.deleted = []

    async def get_automation_config(self, automation_id):
        return {"id": automation_id} if automation_id in self.existing else None

    async def create_automation(self, config):
        self.written[config["id"]] = config
        self.existing.add(config["id"])
        return {"success": True}

    async def update_automation(self, automation_id, config):
        self.written[automation_id] = config
        return {"success": True}

    async def delete_automation(self, automation_id):
        self.deleted.append(automation_id)
        self.existing.discard(automation_id)
        return {"success": True}


class FakeStateManager:
    def __init__(self, tent):
        self._tent = tent
        self.reloads = 0

    def get_tent(self, tent_id):
        return self._tent if tent_id == "mother" else None

    async def reload_config(self):
        self.reloads += 1


def build(schedules, monkeypatch, existing=()):
    """Wire a tent named Mother plus an in-memory add-on config."""
    tent = SimpleNamespace(
        config=SimpleNamespace(name="Mother", schedules=dict(schedules)),
        slot_to_entity={"light": "switch.mother_light"},
    )
    stored = {"tents": [{"name": "Mother", "schedules": dict(schedules)}]}
    monkeypatch.setattr(config_module, "load_addon_config", lambda: stored, raising=False)
    monkeypatch.setattr(config_module, "save_addon_config", lambda cfg: stored.update(cfg), raising=False)

    client = FakeHAClient(existing)
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(ha_client=client)))
    return tent, stored, client, request


VEG = {"photoperiod_on": "08:00", "photoperiod_off": "02:00",
       "light_cycle": {"mode": "veg", "photoperiod_hours": 18.0, "on_time": "08:00", "enabled": True}}


def test_flip_to_flower_moves_the_enforced_light_cycle(monkeypatch):
    tent, stored, client, request = build(VEG, monkeypatch)
    state_manager = FakeStateManager(tent)

    asyncio.run(flip_to_flower(
        "mother",
        FlipToFlowerRequest(create_light_automation=True, light_on_time="08:00", light_off_time="20:00"),
        request,
        state_manager,
    ))

    cycle = stored["tents"][0]["schedules"]["light_cycle"]
    assert cycle["mode"] == "flower"
    assert cycle["photoperiod_hours"] == 12
    assert cycle["on_time"] == "08:00"
    assert cycle["enabled"] is True
    assert stored["tents"][0]["schedules"]["photoperiod_off"] == "20:00"
    assert stored["tents"][0]["growth_stage"]["stage"] == "flower"


def test_flip_writes_the_managed_backup_pair_not_a_second_owner(monkeypatch):
    tent, stored, client, request = build(VEG, monkeypatch)

    asyncio.run(flip_to_flower(
        "mother",
        FlipToFlowerRequest(light_on_time="08:00", light_off_time="20:00"),
        request,
        FakeStateManager(tent),
    ))

    assert set(client.written) == {"tentos_light_cycle_mother_on", "tentos_light_cycle_mother_off"}
    assert "tentos_mother_flower_light" not in client.written


def test_flip_removes_the_legacy_flower_automation(monkeypatch):
    tent, stored, client, request = build(VEG, monkeypatch, existing=["tentos_mother_flower_light"])

    asyncio.run(flip_to_flower(
        "mother",
        FlipToFlowerRequest(light_on_time="08:00", light_off_time="20:00"),
        request,
        FakeStateManager(tent),
    ))

    assert client.deleted == ["tentos_mother_flower_light"]


def test_disabling_the_automation_leaves_tentos_out_of_the_switching(monkeypatch):
    tent, stored, client, request = build(VEG, monkeypatch)

    asyncio.run(flip_to_flower(
        "mother",
        FlipToFlowerRequest(create_light_automation=False, light_on_time="08:00", light_off_time="20:00"),
        request,
        FakeStateManager(tent),
    ))

    assert stored["tents"][0]["schedules"]["light_cycle"]["enabled"] is False
    assert client.written == {}


FLOWER = {"photoperiod_on": "08:00", "photoperiod_off": "20:00",
          "light_cycle": {"mode": "flower", "photoperiod_hours": 12.0, "on_time": "08:00", "enabled": True}}


def test_reset_to_veg_returns_the_light_to_eighteen_hours(monkeypatch):
    tent, stored, client, request = build(FLOWER, monkeypatch, existing=["tentos_mother_flower_light"])

    asyncio.run(reset_to_veg("mother", request, FakeStateManager(tent)))

    cycle = stored["tents"][0]["schedules"]["light_cycle"]
    assert cycle["mode"] == "veg"
    assert cycle["photoperiod_hours"] == 18
    assert cycle["on_time"] == "08:00"           # lights-on time is preserved
    assert stored["tents"][0]["schedules"]["photoperiod_off"] == "02:00"
    assert stored["tents"][0]["growth_stage"]["stage"] == "veg"
    assert stored["tents"][0]["growth_stage"]["flower_start_date"] is None
    assert client.deleted == ["tentos_mother_flower_light"]


class FakeResponse:
    status = 200

    async def json(self):
        return {}

    async def text(self):
        return ""

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class RecordingSession:
    """Records which HTTP verb the client used against the config API."""
    calls = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def post(self, url, **kwargs):
        RecordingSession.calls.append(("post", url))
        return FakeResponse()

    def put(self, url, **kwargs):
        RecordingSession.calls.append(("put", url))
        return FakeResponse()


def test_update_automation_posts_because_ha_rejects_put(monkeypatch):
    """HA's automation config API allows GET, POST and DELETE only.

    PUT returned "405: Method Not Allowed", so TentOS saved a new schedule while
    its backup automations kept the old times. Mother hit exactly that on Sep 11.
    """
    import ha_client as ha_client_module

    client = ha_client_module.HAClient.__new__(ha_client_module.HAClient)
    client._dev_mode = False
    client.token = "t"
    client.rest_url = "http://ha.local/api"

    RecordingSession.calls = []
    monkeypatch.setattr(ha_client_module.aiohttp, "ClientSession", RecordingSession)
    monkeypatch.setattr(client, "call_service", lambda *a, **k: asyncio.sleep(0))

    asyncio.run(client.update_automation("tentos_light_cycle_mother_off", {"id": "x"}))

    assert RecordingSession.calls == [
        ("post", "http://ha.local/api/config/automation/config/tentos_light_cycle_mother_off")
    ]
