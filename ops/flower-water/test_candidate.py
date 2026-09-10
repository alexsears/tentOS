import copy
import json
from pathlib import Path
import unittest
import yaml

ROOT = Path(__file__).parent

class CandidateTests(unittest.TestCase):
    def test_only_both_pump_targets_change(self):
        before = json.loads((ROOT / "before.json").read_text())
        candidate = json.loads((ROOT / "candidate.json").read_text())
        expected = copy.deepcopy(before)
        for index in (0, 2):
            expected["actions"][index]["target"]["entity_id"] = "switch.mother_water_2"
        self.assertEqual(candidate, expected)
        self.assertEqual(candidate["actions"][0]["action"], "switch.turn_on")
        self.assertEqual(candidate["actions"][2]["action"], "switch.turn_off")
        self.assertEqual(candidate["actions"][1]["delay"]["seconds"], 30)

    def test_yaml_is_same_single_existing_automation(self):
        candidate = json.loads((ROOT / "candidate.json").read_text())
        self.assertEqual(yaml.safe_load((ROOT / "candidate.yaml").read_text()), [candidate])
        self.assertEqual(candidate["id"], "mister_hourly_10_seconds")
        self.assertEqual(candidate["mode"], "single")

    def test_existing_schedule_light_and_humidity_guards_remain(self):
        c = json.loads((ROOT / "candidate.json").read_text())
        self.assertEqual(c["triggers"], [{"minutes": "0", "trigger": "time_pattern"}])
        light, window, humidity = c["conditions"]
        self.assertEqual(light["condition"], "switch.is_on")
        self.assertEqual(light["target"]["entity_id"], "switch.lab_diablo")
        self.assertEqual(window, {"condition": "time", "after": "22:00:00", "before": "06:00:00"})
        self.assertEqual(humidity, {"condition": "numeric_state", "entity_id": "sensor.avg_flower_humidity", "below": 60})

if __name__ == "__main__":
    unittest.main()
