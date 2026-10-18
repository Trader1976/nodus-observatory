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

CONFIG = Path('/etc/nodus.conf')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Enable index, back up config, restart witness once')
    args = parser.parse_args()
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
    # Check mount before restarting any node process.
    subprocess.run(['mountpoint', '-q', '/var/lib/nodus'], check=True)
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
