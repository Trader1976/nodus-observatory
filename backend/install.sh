#!/usr/bin/env bash
# Install only the monitor. Does not alter or restart Nodus or PQ-NAS.
set -euo pipefail

[ "${EUID}" -eq 0 ] || { echo "Run: sudo bash backend/install.sh" >&2; exit 1; }
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
project_dir=$(dirname -- "$source_dir")
frontend_source=""
for candidate in "$project_dir/frontend/dist" "$project_dir/dist" "$project_dir/frontend"; do
  if [ -f "$candidate/index.html" ]; then frontend_source=$candidate; break; fi
done
[ -n "$frontend_source" ] || { echo "Built frontend/index.html or dist/index.html is missing." >&2; exit 1; }
command -v python3 >/dev/null
command -v systemctl >/dev/null
mountpoint -q /var/lib/nodus || { echo "STOP: /var/lib/nodus must be the mounted Nodus data partition." >&2; exit 1; }
[ -x /usr/local/bin/nodus-cli ] || { echo "Nodus CLI not found at /usr/local/bin/nodus-cli." >&2; exit 1; }
for filename in collector.py server.py config.example.json nodus-monitor.service nodus-monitor-collect.service nodus-monitor-collect.timer; do
  [ -f "$source_dir/$filename" ] || { echo "Missing backend file: $filename" >&2; exit 1; }
done

if ! getent passwd nodus-monitor >/dev/null; then
  useradd --system --user-group --home-dir /nonexistent --shell /usr/sbin/nologin nodus-monitor
fi
getent group nodus-monitor >/dev/null
for dir in /opt/nodus-monitor /opt/nodus-monitor/frontend /var/lib/nodus-monitor /etc/nodus-monitor /etc/nodus-monitor/config.json; do
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
install -d -m 0750 -o root -g nodus-monitor /etc/nodus-monitor
for filename in collector.py server.py; do
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
cp -a "$frontend_source/." /opt/nodus-monitor/frontend/
# Frozen preview files are never installed in the live monitoring application.
for filename in snapshot.json history.json events.json network.json rewards.json; do
  rm -f -- "/opt/nodus-monitor/frontend/$filename"
done
chown -R root:root /opt/nodus-monitor/frontend
find /opt/nodus-monitor/frontend -type d -exec chmod 0755 {} +
find /opt/nodus-monitor/frontend -type f -exec chmod 0644 {} +
if [ ! -e /etc/nodus-monitor/config.json ]; then
  install -m 0640 -o root -g nodus-monitor "$source_dir/config.example.json" /etc/nodus-monitor/config.json
else
  echo "Keeping existing /etc/nodus-monitor/config.json"
fi

/usr/bin/python3 -c 'import sys; sys.path.insert(0,"/opt/nodus-monitor"); from collector import load_config; load_config("/etc/nodus-monitor/config.json")'
for unit in nodus-monitor.service nodus-monitor-collect.service nodus-monitor-collect.timer; do
  install -m 0644 -o root -g root "$source_dir/$unit" "/etc/systemd/system/$unit"
done
systemctl daemon-reload
systemctl start nodus-monitor-collect.service
systemctl enable --now nodus-monitor-collect.timer nodus-monitor.service
echo "Monitor installed: http://127.0.0.1:8890"
echo "From your desktop: ssh -N -L 8890:127.0.0.1:8890 timo@192.168.1.107"
echo "Then open http://127.0.0.1:8890 in the desktop browser."
echo "Nodus and PQ-NAS were left running."
