import json
from pathlib import Path
import unittest
import yaml

ROOT = Path(__file__).parent

class CandidateTests(unittest.TestCase):
    def setUp(self):
        self.rows = json.loads((ROOT / 'candidate.json').read_text())

    def test_two_distinct_routines_and_preserved_mister(self):
        self.assertEqual(len(self.rows), 2)
        self.assertEqual(self.rows[0], json.loads((ROOT / 'before-mister.json').read_text()))
        self.assertEqual([r['id'] for r in self.rows],
                         ['mister_hourly_10_seconds', 'mother_water_2_overnight'])

    def test_bounded_correct_targets_and_independent_cutoff(self):
        limiters = json.loads((ROOT / 'before-limiters.json').read_text())
        for row, entity in zip(self.rows, ['switch.mister', 'switch.mother_water_2']):
            on, delay, off = row['actions']
            self.assertEqual(on, {'target': {'entity_id': entity}, 'action': 'switch.turn_on'})
            self.assertEqual(off, {'target': {'entity_id': entity}, 'action': 'switch.turn_off'})
            self.assertEqual(delay['delay'], {'hours': 0, 'minutes': 0, 'seconds': 30, 'milliseconds': 0})
            self.assertEqual(row['mode'], 'single')
            self.assertTrue(any(t['entity_id'] == entity and t['for'] == {'seconds': 30}
                                for t in limiters['triggers']))

    def test_schedule_guards_and_day_boundaries(self):
        for row in self.rows:
            self.assertEqual(row['triggers'], [{'minutes': '0', 'trigger': 'time_pattern'}])
            light, window, humidity = row['conditions']
            self.assertEqual(light['condition'], 'switch.is_on')
            self.assertEqual(light['target']['entity_id'], 'switch.lab_diablo')
            self.assertEqual(window, {'condition': 'time', 'after': '22:00:00', 'before': '06:00:00'})
            self.assertEqual(humidity, {'condition': 'numeric_state', 'entity_id': 'sensor.avg_flower_humidity', 'below': 60})
            start = int(window['after'][:2]) * 60
            end = int(window['before'][:2]) * 60
            eligible = [m for m in range(1440) if m % 60 == 0 and (m >= start or m < end)]
            self.assertEqual(eligible, [0, 60, 120, 180, 240, 300, 1320, 1380])
            self.assertTrue(all(m >= 20 * 60 or m < 8 * 60 for m in eligible))

    def test_yaml_parity_and_no_old_target(self):
        self.assertEqual(yaml.safe_load((ROOT / 'candidate.yaml').read_text()), self.rows)
        self.assertNotIn('switch.flower_water', json.dumps(self.rows))

if __name__ == '__main__':
    unittest.main()
