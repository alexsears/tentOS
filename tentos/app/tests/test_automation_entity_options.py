"""Tests for entity metadata exposed to the Automation Editor."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))

from config import TentConfig  # noqa: E402
from state_manager import TentState  # noqa: E402


def test_actuator_state_includes_home_assistant_entity_id():
    config = TentConfig({
        "name": "Flower",
        "actuators": {"light": ["switch.lab1a", "switch.lab_diablo"]},
    })
    state = TentState(config)

    state.update_actuator("light", "on", {"friendly_name": "Lab1a"})
    state.update_actuator("light_2", "on", {"friendly_name": "Lab Diablo"})

    payload = state.to_dict()
    assert payload["actuators"]["light"]["entity_id"] == "switch.lab1a"
    assert payload["actuators"]["light_2"]["entity_id"] == "switch.lab_diablo"
