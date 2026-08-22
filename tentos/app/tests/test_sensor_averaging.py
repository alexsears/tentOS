"""Non-numeric sensor states must not break a tent's state update.

A camera slot reports "recording" and any sensor can report "unavailable".
Averaging those raised TypeError: unsupported operand type(s) for +: 'int' and
'str', which escaped update_sensor, skipped the WebSocket broadcast, and left
the tent frozen until the entity reported a number again.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))

from state_manager import TentState  # noqa: E402


def make_tent():
    class Config:
        name = "Flower"
        id = "flower"
        sensors = {}
        actuators = {}
        targets = {}
        schedules = {}
        notifications = {}
        control_settings = {}
        growth_stage = {}
        description = ""

    return TentState(Config())


def test_camera_state_does_not_raise():
    tent = make_tent()

    tent.update_sensor("camera", "recording", None, "camera.front")
    tent.update_sensor("camera", "recording", None, "camera.nursery")

    assert tent.sensors["camera"]["value"] == "recording"


def test_unavailable_reading_is_left_out_of_the_average():
    tent = make_tent()

    tent.update_sensor("humidity", 60.0, "%", "sensor.a")
    tent.update_sensor("humidity", 70.0, "%", "sensor.b")
    assert tent.sensors["humidity"]["value"] == 65.0

    # One of the pair drops out
    tent.update_sensor("humidity", "unavailable", "%", "sensor.b")

    assert tent.sensors["humidity"]["value"] == 60.0


def test_all_readings_unavailable_falls_back_to_the_raw_state():
    tent = make_tent()

    tent.update_sensor("humidity", "unavailable", "%", "sensor.a")
    tent.update_sensor("humidity", "unknown", "%", "sensor.b")

    assert tent.sensors["humidity"]["value"] == "unknown"


def test_numeric_readings_still_average():
    tent = make_tent()

    tent.update_sensor("temperature", 20.0, "°C", "sensor.a")
    tent.update_sensor("temperature", 24.0, "°C", "sensor.b")

    assert tent.sensors["temperature"]["value"] == 22.0
