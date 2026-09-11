"""Read-only observation of one scheduled Mother Water 2 run on CT 109.

Start ten seconds before the scheduled boundary. Reads existing HA credentials
in memory; never calls a service or writes Home Assistant state.
"""
import json
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


def main():
    env = {}
    for line in Path('/etc/trash-watch.env').read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            key, value = line.split('=', 1)
            env[key] = value.strip().strip('"').strip("'")
    cfg = json.loads(Path('/opt/trash-watch/config.json').read_text())
    folder = Path('/var/lib/mother-water2-monitor')
    folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    rows = []
    deadline = time.monotonic() + 80
    while time.monotonic() < deadline:
        row = {'observed_at': datetime.now(timezone.utc).isoformat()}
        try:
            request = urllib.request.Request(
                cfg['ha_url'] + '/api/states/switch.mother_water_2',
                headers={'Authorization': 'Bearer ' + env['HA_TOKEN']},
            )
            with urllib.request.urlopen(request, timeout=3) as response:
                state = json.load(response)
            row.update(state=state['state'], last_changed=state['last_changed'])
        except Exception as error:
            row.update(state='observation_failed', error=type(error).__name__)
        rows.append(row)
        time.sleep(1)
    (folder / (stamp + '.json')).write_text(json.dumps(rows, indent=2))
    start = next((r for r in rows if r['state'] == 'on'), None)
    stop = next((r for r in rows if start and r['state'] == 'off'
                 and r.get('last_changed', '') > start['last_changed']), None)
    summary = {'sample_file': stamp + '.json', 'samples': len(rows),
               'result': 'unverified', 'reason': 'No complete on/off transition observed.'}
    if start and stop:
        elapsed = (datetime.fromisoformat(stop['last_changed'])
                   - datetime.fromisoformat(start['last_changed'])).total_seconds()
        summary.update(result='verified' if 18 <= elapsed <= 25 else 'duration_mismatch',
                       on=start['last_changed'], off=stop['last_changed'], seconds=elapsed,
                       reason='Measured HA relay transition; water flow is not measured.')
    (folder / 'latest-summary.json').write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary))
    return 0 if summary['result'] == 'verified' else 1


if __name__ == '__main__':
    raise SystemExit(main())
