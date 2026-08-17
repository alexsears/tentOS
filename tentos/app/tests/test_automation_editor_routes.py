"""Tests for the advanced automation create/update API routes."""
import asyncio
import sys
from types import SimpleNamespace

sys.path.insert(0, '../backend')

from routes.automations import (  # noqa: E402
    HAAutomationCreate,
    create_automation,
    update_automation,
)


class FakeHAClient:
    def __init__(self):
        self.created = None
        self.updated = None

    async def create_automation(self, config):
        self.created = config
        return {"success": True}

    async def update_automation(self, automation_id, config):
        self.updated = (automation_id, config)
        return {"success": True}


def make_request(client):
    return SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(ha_client=client)))


def automation_payload():
    return HAAutomationCreate(
        alias="Flower overheat cutoff",
        description="Turn Lab1a off above 90 F",
        triggers=[{
            "platform": "numeric_state",
            "entity_id": "sensor.avg_flower_temp",
            "above": 90,
        }],
        actions=[{
            "service": "switch.turn_off",
            "target": {"entity_id": "switch.lab1a"},
        }],
    )


def test_create_automation_passes_editor_payload_to_home_assistant():
    client = FakeHAClient()

    result = asyncio.run(create_automation(automation_payload(), make_request(client)))

    assert result["success"] is True
    assert result["automation_id"].startswith("tentos_")
    assert client.created["id"] == result["automation_id"]
    assert client.created["trigger"][0]["above"] == 90
    assert client.created["action"][0]["target"]["entity_id"] == "switch.lab1a"


def test_update_automation_preserves_id_and_replaces_configuration():
    client = FakeHAClient()

    result = asyncio.run(update_automation(
        "automation.tentos_flower_cutoff",
        automation_payload(),
        make_request(client),
    ))

    automation_id, config = client.updated
    assert result["success"] is True
    assert automation_id == "tentos_flower_cutoff"
    assert config["id"] == "tentos_flower_cutoff"
    assert config["alias"] == "Flower overheat cutoff"
    assert config["action"][0]["service"] == "switch.turn_off"
