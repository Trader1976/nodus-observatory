#!/usr/bin/env bash
# Install only the monitor. Does not alter or restart Nodus or PQ-NAS.
set -euo pipefail

[ "${EUID}" -eq 0 ] || { echo "Run: sudo bash backend/install.sh" >&2; exit 1; }
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
project_dir=$(dirname -- "$source_dir")
provided_config=""
case "${1:-}" in
  --config)
    [ "$#" -eq 2 ] || { echo "Usage: sudo bash backend/install.sh [--config FILE]" >&2; exit 1; }
    provided_config=$(realpath -- "$2")
    [ -f "$provided_config" ] || { echo "Configuration file not found." >&2; exit 1; }
    ;;
  "") ;;
  *) echo "Usage: sudo bash backend/install.sh [--config FILE]" >&2; exit 1 ;;
esac
frontend_source=""
for candidate in "$project_dir/frontend/dist" "$project_dir/dist" "$project_dir/frontend"; do
  if [ -f "$candidate/index.html" ]; then frontend_source=$candidate; break; fi
done
[ -n "$frontend_source" ] || { echo "Built frontend/index.html or dist/index.html is missing." >&2; exit 1; }
command -v python3 >/dev/null
command -v systemctl >/dev/null
for filename in collector.py configure.py server.py settings.py document_registry.py config.example.json nodus-monitor.service nodus-monitor-collect.service nodus-monitor-collect.timer; do
  [ -f "$source_dir/$filename" ] || { echo "Missing backend file: $filename" >&2; exit 1; }
done

for filename in __init__.py collector.py store.py api.py indexer.py geolocation.py; do
  [ -f "$project_dir/network_statistics/$filename" ] || { echo "Missing Statistics file: $filename" >&2; exit 1; }
done
python3 "$project_dir/network_statistics/sync_frontend.py" --check

# Prepare and validate machine-local settings before changing users or services.
# Updates always preserve installed settings; --config is for the first install.
temporary_config_dir=$(mktemp -d)
trap 'rm -rf -- "$temporary_config_dir"' EXIT
if [ -e /etc/nodus-monitor/config.json ]; then
  [ -z "$provided_config" ] || { echo "STOP: existing configuration is preserved; edit /etc/nodus-monitor/config.json explicitly." >&2; exit 1; }
  config_source=/etc/nodus-monitor/config.json
elif [ -n "$provided_config" ]; then
  config_source=$provided_config
else
  config_source="$temporary_config_dir/config.json"
  python3 "$source_dir/configure.py" --output "$config_source"
fi
python3 - "$source_dir" "$config_source" <<'PY'
import os
from pathlib import Path
import sys
sys.path.insert(0, sys.argv[1])
from collector import load_config
from server import allowed_settings_origins
config = load_config(sys.argv[2])
allowed_settings_origins(config)
if any('\n' in config[key] or '\r' in config[key] for key in ('data_path', 'mount_path')):
    raise SystemExit('STOP: invalid data or mount path.')
if config['state_dir'] != '/var/lib/nodus-monitor' or config['frontend_dir'] != '/opt/nodus-monitor/frontend':
    raise SystemExit('STOP: installer requires the standard monitor state_dir and frontend_dir.')
if not os.path.ismount(config['mount_path']) or not Path(config['data_path']).is_dir():
    raise SystemExit('STOP: configured Nodus data directory or expected filesystem mount is absent.')
if os.stat(config['data_path']).st_dev != os.stat(config['mount_path']).st_dev:
    raise SystemExit('STOP: Nodus data is on a different filesystem than the configured mount.')
if not os.access(config['cli_path'], os.X_OK):
    raise SystemExit('STOP: configured Nodus CLI is not executable.')
if config['bind_host'] not in ('127.0.0.1', '::1', 'localhost') or not 1 <= int(config['bind_port']) <= 65535:
    raise SystemExit('STOP: choose a loopback bind_host and a valid port.')
print('Monitor config validated for', config['data_path'], 'on', config['mount_path'])
PY

if ! getent passwd nodus-monitor >/dev/null; then
  useradd --system --user-group --home-dir /nonexistent --shell /usr/sbin/nologin nodus-monitor
fi
getent group nodus-monitor >/dev/null
for dir in /opt/nodus-monitor /opt/nodus-monitor/frontend /var/lib/nodus-monitor /var/lib/nodus-monitor/settings /var/lib/nodus-monitor/settings/settings.json /var/lib/nodus-monitor/settings/settings.previous.json /etc/nodus-monitor /etc/nodus-monitor/config.json; do
  if [ -L "$dir" ]; then echo "STOP: unexpected symbolic link: $dir" >&2; exit 1; fi
done

if find "$frontend_source" -type l -print -quit | read -r unused; then
  echo "STOP: symbolic links are not accepted in frontend assets." >&2
  exit 1
fi

# Stop only this dashboard's units while replacing its files.
systemctl stop nodus-monitor-collect.timer nodus-monitor.service nodus-monitor-collect.service 2>/dev/null || true
install -d -m 0755 -o root -g root /opt/nodus-monitor /opt/nodus-monitor/frontend
install -d -m 2750 -o root -g nodus-monitor /var/lib/nodus-monitor
install -d -m 2750 -o nodus-monitor -g nodus-monitor /var/lib/nodus-monitor/settings
install -d -m 0750 -o root -g nodus-monitor /etc/nodus-monitor
for filename in collector.py server.py settings.py document_registry.py; do
  install -m 0644 -o root -g root "$source_dir/$filename" "/opt/nodus-monitor/$filename"
done
for filename in network.py rewards.py enable-reward-history.py; do
  if [ -f "$source_dir/$filename" ]; then
    install -m 0644 -o root -g root "$source_dir/$filename" "/opt/nodus-monitor/$filename"
  elif [ -f "$project_dir/rewards/$filename" ]; then
    install -m 0644 -o root -g root "$project_dir/rewards/$filename" "/opt/nodus-monitor/$filename"
  fi
done
# Frontend assets were checked before any service changes.
install -d -m 0755 -o root -g root /opt/nodus-monitor/network_statistics
for filename in __init__.py collector.py store.py api.py indexer.py geolocation.py; do
  install -m 0644 -o root -g root "$project_dir/network_statistics/$filename" "/opt/nodus-monitor/network_statistics/$filename"
done
cp -a "$frontend_source/." /opt/nodus-monitor/frontend/
# Frozen preview files are never installed in the live monitoring application.
for filename in snapshot.json history.json events.json network.json rewards.json; do
  rm -f -- "/opt/nodus-monitor/frontend/$filename"
done
rm -f -- /opt/nodus-monitor/frontend/statistics/preview.json
chown -R root:root /opt/nodus-monitor/frontend
find /opt/nodus-monitor/frontend -type d -exec chmod 0755 {} +
find /opt/nodus-monitor/frontend -type f -exec chmod 0644 {} +
if [ ! -e /etc/nodus-monitor/config.json ]; then
  install -m 0640 -o root -g nodus-monitor "$config_source" /etc/nodus-monitor/config.json
else
  echo "Keeping existing /etc/nodus-monitor/config.json"
fi

/usr/bin/python3 -c 'import sys; sys.path.insert(0,"/opt/nodus-monitor"); from collector import load_config; load_config("/etc/nodus-monitor/config.json")'
for unit in nodus-monitor.service nodus-monitor-collect.service nodus-monitor-collect.timer; do
  install -m 0644 -o root -g root "$source_dir/$unit" "/etc/systemd/system/$unit"
done
# Match the actual data path, including nodes using the root filesystem.
python3 - "$source_dir/nodus-monitor-collect.service" <<'PY'
from pathlib import Path
import sys
sys.path.insert(0, '/opt/nodus-monitor')
from collector import load_config
config = load_config('/etc/nodus-monitor/config.json')
path = config['data_path']
if '\n' in path or '\r' in path:
    raise SystemExit('Invalid data_path for systemd')
quoted = '"' + path.replace('\\', '\\\\').replace('"', '\\"').replace('%', '%%') + '"'
unit = Path(sys.argv[1]).read_text().replace('RequiresMountsFor=/var/lib/nodus', 'RequiresMountsFor=' + quoted)
Path('/etc/systemd/system/nodus-monitor-collect.service').write_text(unit)
PY
systemctl daemon-reload
systemctl start nodus-monitor-collect.service
systemctl enable --now nodus-monitor-collect.timer nodus-monitor.service
python3 - <<'PY'
import sys
sys.path.insert(0, '/opt/nodus-monitor')
from collector import load_config
config = load_config('/etc/nodus-monitor/config.json')
host, port = config['bind_host'], config['bind_port']
host = '[' + host + ']' if ':' in host else host
print(f'Monitor installed: http://{host}:{port}')
print(f'From your desktop: ssh -N -L 8890:{host}:{port} USER@NODE_SERVER')
print('Then open http://127.0.0.1:8890 in the desktop browser.')
print('Optional remote browser access: see docs/remote-access.md in the repository.')
PY
echo "Nodus and PQ-NAS were left running."
