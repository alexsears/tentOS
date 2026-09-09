"""Read-only, bounded polling of Mother refill states. Never actuates equipment."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
import subprocess
import time
import requests


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--log', required=True)
    parser.add_argument('--minutes', type=int, default=90)
    args = parser.parse_args()
    if not 1 <= args.minutes <= 1440:
        parser.error('Monitoring must last between one and 1440 minutes')
    key = subprocess.check_output([
        shutil.which('gcloud') or shutil.which('gcloud.cmd'),
        'secrets', 'versions', 'access', 'latest',
        '--secret=home-assistant-token-current', '--project=alexsearscpa'],
        text=True).strip()
    session = requests.Session()
    session.headers['Authorization'] = 'Bearer '+key
    end = time.monotonic()+args.minutes*60
    started = None
    previous = None
    result = 'No complete refill relay cycle observed within the monitoring window.'
    ids = ['switch.office_heater', 'switch.mother_humidifier', 'input_boolean.mother_refill_active',
        'input_boolean.mother_refill_aborted', 'input_boolean.mother_refill_locked',
        'binary_sensor.mother_refill_dry_candidate', 'input_datetime.mother_refill_deadline',
        'input_select.mother_humidity_control_state', 'switch.mother_fan',
        'switch.mother_intake_fan', 'sensor.moth_a_mother_humidity',
        'sensor.moth_a_mother_temperature']
    with Path(args.log).open('a', encoding='utf-8', buffering=1) as log:
        while time.monotonic() < end:
            now = datetime.now(timezone.utc).isoformat()
            try:
                r = session.get('http://192.168.77.50:8123/api/states', timeout=15)
                r.raise_for_status()
                states = {x['entity_id']: x for x in r.json()}
                snapshot = {k: states.get(k, {}).get('state', 'unknown') for k in ids}
                line = json.dumps({'at': now, 'states': snapshot})
                log.write(line+'\n')
                print(line, flush=True)
                pump = snapshot['switch.office_heater']
                if pump == 'on' and previous == 'off' and started is None:
                    started = states['switch.office_heater']['last_changed']
                if started and previous == 'on' and pump == 'off':
                    stopped = states['switch.office_heater']['last_changed']
                    result = ('Refill relay start: '+started+'; stop: '+stopped+
                        '. Relay reports do not prove water volume delivered.')
                    break
                previous = pump
            except requests.RequestException as exc:
                previous = None
                log.write(json.dumps({'at': now, 'error': type(exc).__name__})+'\n')
            time.sleep(10)
        log.write(json.dumps({'result': result, 'started': started})+'\n')
    print(result, flush=True)


if __name__ == '__main__':
    main()
