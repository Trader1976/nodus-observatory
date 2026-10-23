#!/usr/bin/env bash
# Explicit opt-in: dependency, two monitor preferences and the GeoIP update timer.
set -euo pipefail
[ "${EUID}" -eq 0 ] || { echo "Run this helper with sudo." >&2; exit 1; }
[ "$#" -eq 0 ] || { echo "This helper takes no arguments." >&2; exit 1; }
[ -f /opt/nodus-monitor/network_statistics/geoip_update.py ] || { echo "Install the updated Observatory first." >&2; exit 1; }

if ! /usr/bin/python3 -c 'import maxminddb' 2>/dev/null; then
  command -v apt-get >/dev/null || { echo "Install the maxminddb module for /usr/bin/python3 first." >&2; exit 1; }
  apt-get update
  apt-get install -y python3-maxminddb
fi
/usr/bin/python3 -c 'import maxminddb'

/usr/bin/python3 - <<'PY'
import grp
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
from datetime import datetime, timezone
sys.path.insert(0, '/opt/nodus-monitor')
from collector import load_config
path = Path('/etc/nodus-monitor/config.json')
if path.is_symlink() or not path.is_file():
    raise SystemExit('Installed monitor configuration must be a regular file.')
config = load_config(path)
if config['state_dir'] != '/var/lib/nodus-monitor':
    raise SystemExit('GeoIP service requires the standard monitor state directory.')
if not config['network_enabled'] or not config['statistics_enabled']:
    raise SystemExit('Enable network and statistics collection in Observatory settings first.')
directory = Path(config['state_dir']) / 'geoip'
if directory.is_symlink():
    raise SystemExit('GeoIP directory must not be a symbolic link.')
directory.mkdir(mode=0o750, exist_ok=True)
import pwd
account = pwd.getpwnam('nodus-monitor')
os.chown(directory, account.pw_uid, account.pw_gid)
os.chmod(directory, 0o750)
base = json.loads(path.read_text())
if base.get('statistics_geoip_auto_update') is not True or base.get('statistics_geoip_enabled') is not True:
    backup = path.with_name('config.before-geoip-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '.json')
    shutil.copy2(path, backup)
    os.chown(backup, 0, grp.getgrnam('nodus-monitor').gr_gid)
    os.chmod(backup, 0o640)
    base.update(statistics_geoip_enabled=True, statistics_geoip_auto_update=True)
    descriptor, temporary = tempfile.mkstemp(prefix='.geoip-config-', dir=path.parent)
    try:
        os.fchmod(descriptor, 0o640)
        os.fchown(descriptor, 0, grp.getgrnam('nodus-monitor').gr_gid)
        with os.fdopen(descriptor, 'w') as target:
            json.dump(base, target, ensure_ascii=False, indent=2)
            target.write('\n')
            target.flush()
            os.fsync(target.fileno())
        load_config(temporary)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    print('GeoIP settings enabled. Backup:', backup)
PY

systemctl daemon-reload
systemctl enable --now nodus-monitor-geoip-update.timer
systemctl start --no-block nodus-monitor-geoip-update.service
echo "GeoIP download started in the background. Node addresses are looked up locally."
echo "Data: DB-IP City Lite, CC BY 4.0 — https://db-ip.com"
echo "Check: systemctl status nodus-monitor-geoip-update.service --no-pager"
echo "The timer checks daily; an installed current-month database is not downloaded again."
