"""Build the reviewed mist-off interlock from captured live configurations."""
import copy
import json
from pathlib import Path
import yaml

HERE = Path(__file__).parent
ACTIVE = "is_state('input_boolean.mother_refill_active', 'on')"
BUSY = "("+ACTIVE+" or is_state('switch.office_heater', 'on'))"
OFF = "is_state('switch.mother_humidifier', 'off')"


def build_controller():
    original = json.loads((HERE/'controller-before-mist-off.json').read_text())
    def guard(node):
        if isinstance(node, list):
            return [guard(x) for x in node]
        if isinstance(node, dict):
            if node.get('action') == 'switch.turn_on' and node.get('target', {}).get('entity_id') == 'switch.mother_humidifier':
                return {'if': [{'condition': 'template', 'value_template': '{{ not '+BUSY+' }}'}], 'then': [copy.deepcopy(node)]}
            return {k: guard(v) for k, v in node.items()}
        return node
    config = guard(original)
    config['triggers'].extend([
        {'trigger': 'state', 'entity_id': 'input_boolean.mother_refill_active'},
        {'trigger': 'state', 'entity_id': 'switch.office_heater', 'to': 'on'},
    ])
    config['actions'].insert(0, {'if': [{'condition': 'template', 'value_template': '{{ '+BUSY+' and not '+OFF+' }}'}],
        'then': [{'action': 'switch.turn_off', 'target': {'entity_id': 'switch.mother_humidifier'}}]})
    config['description'] += ' Water-reservoir refill inhibits mist while preserving cooling fan control.'
    return config


def build_refill():
    config = yaml.safe_load((HERE/'refill-before-mist-off.yaml').read_text())
    off_action = {'action': 'switch.turn_off', 'target': {'entity_id': 'switch.mother_humidifier'}}
    confirmed = {'wait_template': '{{ '+OFF+' }}', 'timeout': '00:00:02', 'continue_on_timeout': True}
    failure = {'if': [{'condition': 'template', 'value_template': '{{ not '+OFF+' }}'}],
        'then': [{'action': 'switch.turn_off', 'target': {'entity_id': 'switch.office_heater'}},
                 {'stop': 'Misting did not stop; do not run a refill.'}]}
    prep = [off_action, confirmed, failure]
    config['automation'][0]['actions'][1:1] = copy.deepcopy(prep)
    config['automation'][1]['actions'][1]['then'][0:0] = copy.deepcopy(prep)
    stop = config['automation'][1]['actions'][2]['value_template']
    heat = "states('sensor.moth_a_mother_temperature') | float(100) >= 94"
    fans = ["not is_state('switch.mother_fan', 'off')", "not is_state('switch.mother_intake_fan', 'off')"]
    # An existing, timed refill may run alongside ventilation only with mist off.
    for clause in [heat]+fans:
        assert stop.count(clause) == 1
        stop = stop.replace(clause, '('+clause+') and not ('+ACTIVE+' and '+OFF+')')
    stop = stop.replace('{{ ', '{{ ('+ACTIVE+' and not '+OFF+') or ', 1)
    config['automation'][1]['actions'][2]['value_template'] = stop
    return config


if __name__ == '__main__':
    (HERE/'controller-mist-off.json').write_text(json.dumps(build_controller(), indent=2)+'\n')
    (HERE/'mother_humidifier_refill.yaml').write_text(yaml.safe_dump(build_refill(), sort_keys=False, width=100000))
