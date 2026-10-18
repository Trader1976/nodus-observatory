#!/usr/bin/env python3
"""Explicit, backed-up opt-in for Nodus' future payout history index."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile

from collector import load_config

CONFIG = Path('/etc/nodus.conf')
MONITOR_CONFIG = Path('/etc/nodus-monitor/config.json')


def validate_data_filesystem(current):
    """Check the installed monitor and node agree before changing node settings."""
    if MONITOR_CONFIG.is_symlink() or not MONITOR_CONFIG.is_file():
        raise SystemExit('Expected a regular installed monitor configuration; nothing changed.')
    try:
        monitor = load_config(MONITOR_CONFIG)
        paths = {}
        for field in ('data_path', 'mount_path'):
            value = monitor[field]
            if not isinstance(value, str) or not Path(value).is_absolute() or '\n' in value or '\r' in value:
                raise ValueError('Monitor ' + field + ' must be an absolute directory path')
            paths[field] = Path(value).resolve(strict=True)
            if not paths[field].is_dir():
                raise ValueError('Monitor ' + field + ' directory is missing')
        node_data = current.get('data_path', '/var/lib/nodus/data')
        if not isinstance(node_data, str) or not Path(node_data).is_absolute() or '\n' in node_data or '\r' in node_data:
            raise ValueError('Node data_path must be an absolute directory path')
        if Path(node_data).resolve(strict=True) != paths['data_path']:
            raise ValueError('Node and monitor data_path do not match')
        if not os.path.ismount(paths['mount_path']):
            raise ValueError('Expected Nodus data filesystem mount is absent')
        if paths['data_path'].stat().st_dev != paths['mount_path'].stat().st_dev:
            raise ValueError('Nodus data is on a different filesystem than the configured mount')
    except (OSError, TypeError, ValueError) as error:
        raise SystemExit(str(error) + '; nothing changed.') from error


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Enable index, back up config, restart witness once')
    args = parser.parse_args(argv)
    if os.geteuid() != 0:
        raise SystemExit('Run with sudo. No node identity keys are read.')
    if CONFIG.is_symlink() or not CONFIG.is_file():
        raise SystemExit('Expected a regular /etc/nodus.conf; nothing changed.')
    current = json.loads(CONFIG.read_text())
    if not isinstance(current, dict):
        raise SystemExit('Invalid node configuration; nothing changed.')
    if current.get('addr_history_index') is True:
        print('Payout history index is already enabled. No change or restart.')
        return
    print('Plan: set addr_history_index=true in /etc/nodus.conf.')
    print('Back up the config, then restart only nodus-witness once.')
    print('The index records future blocks; it does not backfill earlier payouts.')
    if not args.apply:
        print('Dry run. Add --apply to execute this plan.')
        return
    # The data may live on / or a custom mounted filesystem.
    validate_data_filesystem(current)
    subprocess.run(['systemctl', 'is-active', '--quiet', 'nodus-witness.service'], check=True)
    metadata = CONFIG.stat()
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup = CONFIG.with_name('nodus.conf.before-monitor-' + stamp)
    shutil.copy2(CONFIG, backup)
    os.chown(backup, metadata.st_uid, metadata.st_gid)
    os.chmod(backup, stat.S_IMODE(metadata.st_mode))
    current['addr_history_index'] = True
    fd, temporary = tempfile.mkstemp(prefix='.nodus-monitor-', dir=CONFIG.parent)
    try:
        os.fchmod(fd, stat.S_IMODE(metadata.st_mode))
        os.fchown(fd, metadata.st_uid, metadata.st_gid)
        with os.fdopen(fd, 'w') as handle:
            json.dump(current, handle, indent=2)
            handle.write('\n')
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, CONFIG)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    print('Configuration backup:', backup)
    subprocess.run(['systemctl', 'restart', 'nodus-witness.service'], check=True)
    subprocess.run(['systemctl', 'is-active', '--quiet', 'nodus-witness.service'], check=True)
    print('Future payout history enabled. Witness restarted; sync may briefly catch up.')
    print('Run sudo nodus-cli status and check behind by / storage fail_streak.')


if __name__ == '__main__':
    main()
