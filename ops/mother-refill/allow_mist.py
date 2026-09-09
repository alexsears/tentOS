"""Remove only the reservoir refill mist interlock from a current controller."""
import copy

ACTIVE = "is_state('input_boolean.mother_refill_active', 'on')"
OFF = "is_state('switch.mother_humidifier', 'off')"
BUSY = '(' + ACTIVE + " or is_state('switch.office_heater', 'on'))"
GUARD = '{{ not ' + BUSY + ' }}'
FORCE_OFF = '{{ ' + BUSY + ' and not ' + OFF + ' }}'


def allow_mist(original):
    counts = {'guard': 0, 'off': 0}

    def visit(node):
        if isinstance(node, list):
            result = []
            for item in node:
                if isinstance(item, dict) and item.get('if') == [{'condition': 'template', 'value_template': GUARD}]:
                    assert item['then'] == [{'action': 'switch.turn_on', 'target': {'entity_id': 'switch.mother_humidifier'}}]
                    result.extend(copy.deepcopy(item['then']))
                    counts['guard'] += 1
                elif isinstance(item, dict) and item.get('if') == [{'condition': 'template', 'value_template': FORCE_OFF}]:
                    assert item['then'] == [{'action': 'switch.turn_off', 'target': {'entity_id': 'switch.mother_humidifier'}}]
                    counts['off'] += 1
                else:
                    result.append(visit(item))
            return result
        if isinstance(node, dict):
            return {key: visit(value) for key, value in node.items()}
        return node

    result = visit(original)
    assert counts == {'guard': 4, 'off': 1}, counts
    result['description'] = result['description'].replace(
        ' Water-reservoir refill inhibits mist while preserving cooling fan control.',
        ' Reservoir refill allows normal misting; humidity, runtime and safety controls still apply.')
    return result
