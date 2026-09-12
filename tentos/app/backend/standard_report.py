"""Standard tent report. Recorded switch states only; missing history stays unknown."""
import math
import re
from datetime import datetime, timezone

FAMILIES = ('temperature', 'humidity', 'co2')
ACTUATORS = {'light': 'Light', 'exhaust_fan': 'Exhaust', 'humidifier': 'Humidifier',
             'circulation_fan': 'Circulation fan', 'intake_fan': 'Intake fan', 'fan': 'Fan'}


def switch_counts(history, start, end):
    """Count confirmed transitions inside (start, end]; seed and dropouts are not starts."""
    events = sorted([(timestamp(r.get('last_changed') or r.get('last_updated')), r.get('state'))
                     for r in history], key=lambda r: r[0] or start)
    previous, starts, changes = None, 0, 0
    for at, raw in events:
        if at is None or at > end:
            continue
        current = raw if raw in ('on', 'off') else None
        if at > start and previous is not None and current is not None and previous != current:
            changes += 1
            starts += int(current == 'on')
        previous = current
    return {'starts': starts, 'changes': changes}


def timestamp(raw):
    try:
        dt = datetime.fromisoformat(str(raw).replace('Z', '+00:00'))
        return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
    except (ValueError, TypeError):
        return None


def switch_intervals(history, start, end):
    """Clamp seed state and transitions to the window, retaining unknown spans."""
    events = sorted([(timestamp(r.get('last_changed') or r.get('last_updated')), r.get('state'))
                     for r in history], key=lambda r: r[0] or start)
    cursor, current, result = start, 'unknown', []
    for at, raw in events:
        if at is None or at > end:
            continue
        state = raw if raw in ('on', 'off') else 'unknown'
        at = max(start, at)
        if at > cursor:
            result.append({'start': cursor.isoformat(), 'end': at.isoformat(), 'state': current})
        cursor, current = at, state
    if cursor < end:
        result.append({'start': cursor.isoformat(), 'end': end.isoformat(), 'state': current})
    merged = []
    for interval in result:
        if merged and merged[-1]['state'] == interval['state']:
            merged[-1]['end'] = interval['end']
        else:
            merged.append(interval.copy())
    return merged


async def build_standard_report(tent, ha, start, end):
    series, switches = [], []
    for slot, ids in tent.config.sensors.items():
        family = re.sub(r'_\d+$', '', slot)
        if family not in FAMILIES:
            continue
        for entity in (ids if isinstance(ids, list) else [ids]):
            if entity:
                series.append({'entity_id': entity, 'metric': family, 'label': entity, 'data': []})
    for slot, entity in tent.slot_to_entity.items():
        family = re.sub(r'_\d+$', '', slot)
        if family in ACTUATORS and entity:
            switches.append({'entity_id': entity, 'kind': family, 'label': ACTUATORS[family], 'slot': slot})
    ids = list(dict.fromkeys(r['entity_id'] for r in series + switches))
    history = await ha.get_history(ids, start.isoformat(), end.isoformat()) if ids else []
    by_entity = {rows[0]['entity_id']: rows for rows in history or [] if rows and rows[0].get('entity_id')}
    for item in series:
        rows = by_entity.get(item['entity_id'], [])
        attrs = next((r.get('attributes') for r in rows if r.get('attributes')), {})
        item['label'] = attrs.get('friendly_name') or item['entity_id']
        unit = attrs.get('unit_of_measurement') or ''
        item['unit'] = '°C' if item['metric'] == 'temperature' else ('%' if item['metric'] == 'humidity' else 'ppm')
        for row in rows:
            at = timestamp(row.get('last_changed') or row.get('last_updated'))
            if at is None or at > end:
                continue
            try:
                value = float(row.get('state'))
                if not math.isfinite(value):
                    value = None
            except (ValueError, TypeError):
                value = None
            row_unit = (row.get('attributes') or {}).get('unit_of_measurement') or unit
            if value is not None and item['metric'] == 'temperature' and 'f' in row_unit.lower():
                value = (value - 32) * 5 / 9
            item['data'].append({'timestamp': max(start, at).isoformat(), 'value': round(value, 2) if value is not None else None})
        item['data'].sort(key=lambda r: r['timestamp'])
        values = [r['value'] for r in item['data'] if r['value'] is not None]
        item['stats'] = {'min': min(values), 'max': max(values), 'avg': round(sum(values)/len(values), 2)} if values else None
    for item in switches:
        rows = by_entity.get(item['entity_id'], [])
        attrs = next((r.get('attributes') for r in rows if r.get('attributes')), {})
        item['name'] = attrs.get('friendly_name') or item['entity_id']
        item['intervals'] = switch_intervals(rows, start, end)
        item.update(switch_counts(rows, start, end))
        item['on_seconds'] = sum((timestamp(p['end'])-timestamp(p['start'])).total_seconds()
                                 for p in item['intervals'] if p['state'] == 'on')
        item['unknown_seconds'] = sum((timestamp(p['end'])-timestamp(p['start'])).total_seconds()
                                      for p in item['intervals'] if p['state'] == 'unknown')
    return {'tent_name': tent.config.name, 'from': start.isoformat(), 'to': end.isoformat(),
            'series': series, 'switches': switches, 'source': 'home_assistant'}
