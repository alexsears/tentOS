"""Standard tent report. Recorded switch states only; missing history stays unknown."""
import math
import re
from datetime import datetime, timezone

FAMILIES = ('temperature', 'humidity', 'co2')
ACTUATORS = {'light': 'Light', 'exhaust_fan': 'Exhaust', 'humidifier': 'Humidifier',
             'circulation_fan': 'Circulation fan', 'intake_fan': 'Intake fan', 'fan': 'Fan',
             'water_pump': 'Water pump'}
UNITS = {'temperature': '°C', 'humidity': '%', 'co2': 'ppm', 'vpd': 'kPa'}
# A 30 day window returns far more points than a chart can draw. Thin only past
# this, so every range a grower actually reads stays exactly as recorded.
MAX_POINTS = 2000


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


def thin(points, limit=MAX_POINTS):
    """Average points into buckets once a series is longer than a chart can draw."""
    if len(points) <= limit:
        return points
    size = math.ceil(len(points) / limit)
    result = []
    for index in range(0, len(points), size):
        bucket = points[index:index + size]
        values = [p['value'] for p in bucket if p['value'] is not None]
        result.append({'timestamp': bucket[len(bucket) // 2]['timestamp'],
                       'value': round(sum(values) / len(values), 2) if values else None})
    return result


def sensor_series(tent, families=FAMILIES):
    """One series stub per configured sensor entity, keeping its slot for VPD pairing."""
    series = []
    for slot, ids in tent.config.sensors.items():
        family = re.sub(r'_\d+$', '', slot)
        if family not in families:
            continue
        for entity in (ids if isinstance(ids, list) else [ids]):
            if entity:
                series.append({'entity_id': entity, 'metric': family, 'slot': slot,
                               'label': entity, 'unit': UNITS.get(family, ''), 'data': []})
    return series


def switch_rows(tent, kinds=None):
    """One row per configured actuator entity, in the order the tent declares them."""
    rows = []
    for slot, entity in tent.slot_to_entity.items():
        family = re.sub(r'_\d+$', '', slot)
        if entity and family in ACTUATORS and (kinds is None or family in kinds):
            rows.append({'entity_id': entity, 'kind': family, 'label': ACTUATORS[family], 'slot': slot})
    return rows


async def fetch_history(ha, entity_ids, start, end):
    """Recorder history keyed by entity id. Entities with no rows stay absent."""
    ids = list(dict.fromkeys(entity_ids))
    history = await ha.get_history(ids, start.isoformat(), end.isoformat()) if ids else []
    return {rows[0]['entity_id']: rows for rows in history or [] if rows and rows[0].get('entity_id')}


def fill_series(item, rows, start, end):
    """Numeric readings inside the window, normalized to Celsius where relevant."""
    attrs = next((r.get('attributes') for r in rows if r.get('attributes')), {})
    item['label'] = attrs.get('friendly_name') or item['entity_id']
    unit = attrs.get('unit_of_measurement') or ''
    item['unit'] = UNITS.get(item['metric'], unit)
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
        item['data'].append({'timestamp': max(start, at).isoformat(),
                             'value': round(value, 2) if value is not None else None})
    item['data'].sort(key=lambda r: r['timestamp'])
    item['data'] = thin(item['data'])
    add_stats(item)
    return item


def add_stats(item):
    values = [r['value'] for r in item['data'] if r['value'] is not None]
    item['stats'] = ({'min': min(values), 'max': max(values), 'avg': round(sum(values) / len(values), 2),
                      'last': values[-1]} if values else None)
    return item


def fill_switch(item, rows, start, end):
    attrs = next((r.get('attributes') for r in rows if r.get('attributes')), {})
    item['name'] = attrs.get('friendly_name') or item['entity_id']
    item['intervals'] = switch_intervals(rows, start, end)
    item.update(switch_counts(rows, start, end))
    item['on_seconds'] = sum((timestamp(p['end']) - timestamp(p['start'])).total_seconds()
                             for p in item['intervals'] if p['state'] == 'on')
    item['unknown_seconds'] = sum((timestamp(p['end']) - timestamp(p['start'])).total_seconds()
                                  for p in item['intervals'] if p['state'] == 'unknown')
    return item


def vpd_series(series):
    """Leaf VPD from the canonical temperature and humidity slots, the pair the live
    tent state uses. Both slots average their own entities, then each recorded change
    carries the other slot's last known reading forward, so VPD moves when either does.
    """
    from state_manager import calculate_vpd  # local: keeps this module importable on its own

    groups = {'temperature': [], 'humidity': []}
    for item in series:
        if item['slot'] in groups:
            groups[item['slot']].append(item)
    if not groups['temperature'] or not groups['humidity']:
        return None
    readings = {}
    for slot, items in groups.items():
        for item in items:
            for point in item['data']:
                readings.setdefault(point['timestamp'], []).append((slot, item['entity_id'], point['value']))
    latest, data = {}, []
    for at in sorted(readings):
        for slot, entity, value in readings[at]:
            latest[(slot, entity)] = value
        averages = {}
        for slot, items in groups.items():
            values = [latest.get((slot, item['entity_id'])) for item in items]
            values = [v for v in values if v is not None]
            averages[slot] = sum(values) / len(values) if values else None
        if averages['temperature'] is None or averages['humidity'] is None:
            continue
        data.append({'timestamp': at, 'value': calculate_vpd(averages['temperature'], averages['humidity'])})
    item = {'entity_id': 'vpd', 'metric': 'vpd', 'slot': 'vpd', 'label': 'Leaf VPD',
            'unit': UNITS['vpd'], 'data': thin(data)}
    return add_stats(item)


async def build_standard_report(tent, ha, start, end):
    series = sensor_series(tent)
    switches = switch_rows(tent)
    by_entity = await fetch_history(ha, [r['entity_id'] for r in series + switches], start, end)
    for item in series:
        fill_series(item, by_entity.get(item['entity_id'], []), start, end)
    for item in switches:
        fill_switch(item, by_entity.get(item['entity_id'], []), start, end)
    derived = vpd_series(series)
    if derived:
        series.append(derived)
    return {'tent_name': tent.config.name, 'from': start.isoformat(), 'to': end.isoformat(),
            'series': series, 'switches': switches, 'source': 'home_assistant'}
