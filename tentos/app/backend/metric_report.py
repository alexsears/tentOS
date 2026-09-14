"""Metric reports. One measurement or one switch, every tent that has it, one timeline."""
from standard_report import (UNITS, fetch_history, fill_series, fill_switch,
                             sensor_series, switch_rows, vpd_series)

# Order is the order the reports flip through, climate first then equipment.
METRICS = [
    {'key': 'temperature', 'label': 'Temperature', 'kind': 'numeric'},
    {'key': 'humidity', 'label': 'Humidity', 'kind': 'numeric'},
    {'key': 'vpd', 'label': 'Leaf VPD', 'kind': 'numeric'},
    {'key': 'co2', 'label': 'CO2', 'kind': 'numeric'},
    {'key': 'light', 'label': 'Lights', 'kind': 'switch'},
    {'key': 'water_pump', 'label': 'Water pumps', 'kind': 'switch'},
    {'key': 'humidifier', 'label': 'Humidifiers', 'kind': 'switch'},
    {'key': 'exhaust_fan', 'label': 'Exhaust fans', 'kind': 'switch'},
    {'key': 'circulation_fan', 'label': 'Circulation fans', 'kind': 'switch'},
    {'key': 'intake_fan', 'label': 'Intake fans', 'kind': 'switch'},
    {'key': 'fan', 'label': 'Other fans', 'kind': 'switch'},
]
BY_KEY = {m['key']: m for m in METRICS}


def tent_has(tent, metric):
    """A metric belongs on the flip list only where some tent is configured for it."""
    if metric['kind'] == 'switch':
        return any(row['kind'] == metric['key'] for row in switch_rows(tent))
    if metric['key'] == 'vpd':
        slots = {item['slot'] for item in sensor_series(tent)}
        return 'temperature' in slots and 'humidity' in slots
    return any(item['metric'] == metric['key'] for item in sensor_series(tent))


def metric_catalog(tents):
    """Every metric at least one tent can report, with the tents that carry it."""
    catalog = []
    for metric in METRICS:
        ids = [tent.config.id for tent in tents if tent_has(tent, metric)]
        if ids:
            catalog.append({**metric, 'unit': UNITS.get(metric['key'], ''), 'tents': ids})
    return catalog


async def build_metric_report(metric_key, tents, ha, start, end):
    """One metric across every tent. Tents without it are left out, not faked."""
    metric = BY_KEY[metric_key]
    wanted = [tent for tent in tents if tent_has(tent, metric)]
    plans = []
    for tent in wanted:
        if metric['kind'] == 'switch':
            plans.append((tent, [], switch_rows(tent, kinds={metric_key})))
        elif metric_key == 'vpd':
            # Only the canonical slots feed VPD, the same pair the live tent state uses.
            inputs = [i for i in sensor_series(tent) if i['slot'] in ('temperature', 'humidity')]
            plans.append((tent, inputs, []))
        else:
            plans.append((tent, sensor_series(tent, families=(metric_key,)), []))
    by_entity = await fetch_history(
        ha, [row['entity_id'] for _, series, switches in plans for row in series + switches], start, end)
    results = []
    for tent, series, switches in plans:
        for item in series:
            fill_series(item, by_entity.get(item['entity_id'], []), start, end)
        for item in switches:
            fill_switch(item, by_entity.get(item['entity_id'], []), start, end)
        if metric_key == 'vpd':
            derived = vpd_series(series)
            series = [derived] if derived else []
        results.append({'tent_id': tent.config.id, 'tent_name': tent.config.name,
                        'series': series, 'switches': switches})
    return {'metric': metric_key, 'label': metric['label'], 'kind': metric['kind'],
            'unit': UNITS.get(metric_key, ''), 'from': start.isoformat(), 'to': end.isoformat(),
            'tents': results, 'source': 'home_assistant'}
