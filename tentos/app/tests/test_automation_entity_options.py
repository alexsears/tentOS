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


def test_temperature_state_reports_normalized_celsius_unit():
    config = TentConfig({"name": "Flower", "sensors": {"temperature": ["sensor.flower_temperature"]}})
    state = TentState(config)

    state.update_sensor("temperature", 77, "°F", "sensor.flower_temperature")

    payload = state.to_dict()
    assert payload["sensors"]["temperature"]["value"] == 25.0
    assert payload["sensors"]["temperature"]["unit"] == "°C"

    state.update_sensor("temperature_2", 77, "°F", "sensor.flower_temperature_2")
    payload = state.to_dict()
    assert payload["sensors"]["temperature_2"]["value"] == 25.0
    assert payload["sensors"]["temperature_2"]["unit"] == "°C"
