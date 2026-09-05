"""CO2 supplementation: the injector template, its safety gating and the targets API."""
import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))

from routes.automations import (  # noqa: E402
    AUTOMATION_TEMPLATES,
    ENTITY_AUTOMATION_MAP,
    TemplateApply,
    apply_template,
    categorize_automation,
)
from routes.config import SLOT_DEFINITIONS, TARGET_FIELDS, TargetsUpdate  # noqa: E402


class FakeHAClient:
    def __init__(self):
        self.created = None

    async def create_automation(self, config):
        self.created = config
        return {"success": True}


def make_tent(actuators, sensors):
    return SimpleNamespace(
        id="mother",
        name="Mother",
        config=SimpleNamespace(actuators=actuators, sensors=sensors),
    )


def make_request(client, tent):
    state_manager = SimpleNamespace(
        tents={tent.id: tent},
        get_tent=lambda tent_id: tent if tent_id == tent.id else None,
    )
    return SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(
        ha_client=client, state_manager=state_manager,
    )))


def triggers_by_id(config, trigger_id):
    return [t for t in config["trigger"] if t["id"] == trigger_id]


def test_co2_injector_is_a_known_actuator_slot_and_target():
    assert "co2_injector" in SLOT_DEFINITIONS["actuators"]
    assert "co2_day_target" in TARGET_FIELDS and "co2_max" in TARGET_FIELDS
    assert ENTITY_AUTOMATION_MAP["sensors"]["co2"]["enables"] == ["low_co2_injector"]
    assert ENTITY_AUTOMATION_MAP["actuators"]["co2_injector"]["enables"] == ["low_co2_injector"]
    assert AUTOMATION_TEMPLATES["low_co2_injector"]["actuator_type"] == "co2_injector"


def test_co2_template_gates_on_light_and_adds_runtime_cutoff():
    client = FakeHAClient()
    tent = make_tent(
        actuators={"co2_injector": "switch.mother_co2", "light": "switch.mother_light"},
        sensors={"co2": "sensor.moth_a_mother_co2"},
    )

    result = asyncio.run(apply_template(
        "low_co2_injector", TemplateApply(tent_id="mother"), make_request(client, tent)
    ))

    assert result["success"] is True
    config = client.created
    on = triggers_by_id(config, "on")
    assert on == [{
        "platform": "numeric_state", "entity_id": "sensor.moth_a_mother_co2",
        "below": 1000, "id": "on",
    }]

    offs = triggers_by_id(config, "off")
    # Hysteresis is CO2-sized (150 ppm), not the 5 used for humidity.
    assert {"platform": "numeric_state", "entity_id": "sensor.moth_a_mother_co2",
            "above": 1150, "id": "off"} in offs
    # Lights off stops injection.
    assert {"platform": "state", "entity_id": "switch.mother_light", "to": "off", "id": "off"} in offs
    # A stuck-on injector is cut after 10 minutes.
    assert {"platform": "state", "entity_id": "switch.mother_co2", "to": "on",
            "for": {"minutes": 10}, "id": "off"} in offs

    on_branch = config["action"][0]["choose"][0]
    assert {"condition": "state", "entity_id": "switch.mother_light", "state": "on"} in on_branch["conditions"]
    assert on_branch["sequence"][0]["target"]["entity_id"] == "switch.mother_co2"
    assert config["action"][0]["choose"][1]["sequence"][0]["service"] == "homeassistant.turn_off"


def test_co2_template_custom_threshold_and_no_light():
    client = FakeHAClient()
    tent = make_tent(
        actuators={"co2_injector": ["switch.co2_a", "switch.co2_b"]},
        sensors={"co2": "sensor.tent_co2"},
    )

    asyncio.run(apply_template(
        "low_co2_injector", TemplateApply(tent_id="mother", threshold=1200), make_request(client, tent)
    ))

    config = client.created
    assert triggers_by_id(config, "on")[0]["below"] == 1200
    offs = triggers_by_id(config, "off")
    assert offs[0]["above"] == 1350
    # No light on the tent: no light gate, no light trigger.
    assert all(t.get("entity_id") != "switch.mother_light" for t in offs)
    assert config["action"][0]["choose"][0]["conditions"] == [{"condition": "trigger", "id": "on"}]
    # One cutoff per injector switch.
    cutoffs = [t for t in offs if t.get("for")]
    assert sorted(t["entity_id"] for t in cutoffs) == ["switch.co2_a", "switch.co2_b"]


def test_older_templates_keep_their_hysteresis():
    client = FakeHAClient()
    tent = make_tent(
        actuators={"humidifier": "switch.h", "light": "switch.l"},
        sensors={"humidity": "sensor.rh"},
    )
    asyncio.run(apply_template(
        "low_humidity_humidifier", TemplateApply(tent_id="mother"), make_request(client, tent)
    ))
    config = client.created
    assert len(config["trigger"]) == 2
    assert triggers_by_id(config, "off")[0]["above"] == 55
    assert config["action"][0]["choose"][0]["conditions"] == [{"condition": "trigger", "id": "on"}]


def test_co2_automations_are_grouped_under_co2():
    assert categorize_automation({"entity_id": "automation.tentos_mother_low_co2_injector_1"}) == "co2"


def test_targets_model_accepts_co2_fields():
    values = TargetsUpdate(co2_day_target=1000, co2_max=1500).model_dump(exclude_none=True)
    assert values == {"co2_day_target": 1000, "co2_max": 1500}
