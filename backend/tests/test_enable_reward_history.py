import contextlib
import importlib.util
import io
import json
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import call, patch


BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
SPEC = importlib.util.spec_from_file_location('enable_reward_history', BACKEND / 'enable-reward-history.py')
enable = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(enable)


class EnableRewardHistoryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.mount = self.root / 'node-volume'
        self.data = self.mount / 'data'
        self.data.mkdir(parents=True)
        self.config = self.root / 'nodus.conf'
        self.monitor = self.root / 'monitor.json'
        self.original = {'data_path': str(self.data), 'identity_path': '/var/lib/nodus/identity', 'tcp_port': 4001}
        self.config.write_text(json.dumps(self.original) + '\n')
        self.config.chmod(0o640)
        self.monitor.write_text(json.dumps({'data_path': str(self.data), 'mount_path': str(self.mount)}))
        self.initial_bytes = self.config.read_bytes()
        self.patchers = [
            patch.object(enable, 'CONFIG', self.config),
            patch.object(enable, 'MONITOR_CONFIG', self.monitor),
            patch.object(enable.os, 'geteuid', return_value=0),
            patch.object(enable.os, 'chown'),
            patch.object(enable.os, 'fchown'),
        ]
        for patcher in self.patchers:
            patcher.start()
            self.addCleanup(patcher.stop)

    def write_monitor(self, **changes):
        settings = json.loads(self.monitor.read_text())
        settings.update(changes)
        self.monitor.write_text(json.dumps(settings))

    def assert_unchanged(self, commands):
        self.assertEqual(self.config.read_bytes(), self.initial_bytes)
        self.assertEqual(list(self.root.glob('nodus.conf.before-monitor-*')), [])
        self.assertEqual(list(self.root.glob('.nodus-monitor-*')), [])
        commands.assert_not_called()

    def test_apply_accepts_custom_mount_and_preserves_settings_backup_and_permissions(self):
        with patch.object(enable.os.path, 'ismount', return_value=True) as mount_check, \
                patch.object(enable.subprocess, 'run') as commands, contextlib.redirect_stdout(io.StringIO()):
            enable.main(['--apply'])
        mount_check.assert_called_once_with(self.mount)
        self.assertEqual(json.loads(self.config.read_text()), dict(self.original, addr_history_index=True))
        backups = list(self.root.glob('nodus.conf.before-monitor-*'))
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_bytes(), self.initial_bytes)
        self.assertEqual(stat.S_IMODE(backups[0].stat().st_mode), 0o640)
        self.assertEqual(stat.S_IMODE(self.config.stat().st_mode), 0o640)
        self.assertEqual(list(self.root.glob('.nodus-monitor-*')), [])
        self.assertEqual(commands.call_args_list, [
            call(['systemctl', 'is-active', '--quiet', 'nodus-witness.service'], check=True),
            call(['systemctl', 'restart', 'nodus-witness.service'], check=True),
            call(['systemctl', 'is-active', '--quiet', 'nodus-witness.service'], check=True),
        ])

    def test_apply_accepts_data_on_root_filesystem(self):
        self.write_monitor(mount_path='/')
        original_stat = Path.stat
        root_device = Path('/').stat().st_dev

        def matching_filesystem(path, *args, **kwargs):
            result = original_stat(path, *args, **kwargs)
            if path == self.data:
                return SimpleNamespace(st_mode=result.st_mode, st_dev=root_device)
            return result

        with patch.object(Path, 'stat', matching_filesystem), \
                patch.object(enable.os.path, 'ismount', side_effect=lambda path: path == Path('/')), \
                patch.object(enable.subprocess, 'run') as commands, contextlib.redirect_stdout(io.StringIO()):
            enable.main(['--apply'])
        self.assertIs(json.loads(self.config.read_text())['addr_history_index'], True)
        self.assertEqual(sum(args.args[0][1] == 'restart' for args in commands.call_args_list), 1)

    def test_invalid_or_missing_monitor_paths_refuse_before_any_mutation(self):
        for changes in ({'data_path': 'relative/data'}, {'mount_path': 'relative'},
                        {'data_path': str(self.root / 'missing')}, {'mount_path': str(self.root / 'missing')},
                        {'data_path': str(self.config)}, {'data_path': str(self.mount)}):
            with self.subTest(changes=changes):
                self.monitor.write_text(json.dumps({'data_path': str(self.data), 'mount_path': str(self.mount), **changes}))
                with patch.object(enable.os.path, 'ismount', return_value=True), \
                        patch.object(enable.subprocess, 'run') as commands, contextlib.redirect_stdout(io.StringIO()):
                    with self.assertRaises(SystemExit):
                        enable.main(['--apply'])
                self.assert_unchanged(commands)

    def test_absent_expected_mount_refuses_before_any_mutation(self):
        with patch.object(enable.os.path, 'ismount', return_value=False), \
                patch.object(enable.subprocess, 'run') as commands, contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(SystemExit, 'mount is absent'):
                enable.main(['--apply'])
        self.assert_unchanged(commands)

    def test_data_on_different_device_refuses_before_any_mutation(self):
        original_stat = Path.stat

        def different_filesystem(path, *args, **kwargs):
            result = original_stat(path, *args, **kwargs)
            if path == self.data:
                return SimpleNamespace(st_mode=result.st_mode, st_dev=result.st_dev + 1)
            return result

        with patch.object(Path, 'stat', different_filesystem), \
                patch.object(enable.os.path, 'ismount', return_value=True), \
                patch.object(enable.subprocess, 'run') as commands, contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(SystemExit, 'different filesystem'):
                enable.main(['--apply'])
        self.assert_unchanged(commands)

    def test_missing_or_symlinked_installed_monitor_config_refuses(self):
        self.monitor.unlink()
        for symlink in (False, True):
            with self.subTest(symlink=symlink):
                if symlink:
                    target = self.root / 'monitor-target.json'
                    target.write_text(json.dumps({'data_path': str(self.data), 'mount_path': str(self.mount)}))
                    self.monitor.symlink_to(target)
                with patch.object(enable.subprocess, 'run') as commands, contextlib.redirect_stdout(io.StringIO()):
                    with self.assertRaisesRegex(SystemExit, 'installed monitor configuration'):
                        enable.main(['--apply'])
                self.assert_unchanged(commands)

    def test_node_data_must_match_installed_monitor(self):
        another_data = self.root / 'another-data'
        another_data.mkdir()
        for value in (str(another_data), 'relative/data', None):
            with self.subTest(data_path=value):
                self.config.write_text(json.dumps(dict(self.original, data_path=value)) + '\n')
                self.initial_bytes = self.config.read_bytes()
                with patch.object(enable.os.path, 'ismount', return_value=True), \
                        patch.object(enable.subprocess, 'run') as commands, contextlib.redirect_stdout(io.StringIO()):
                    with self.assertRaises(SystemExit):
                        enable.main(['--apply'])
                self.assert_unchanged(commands)

    def test_dry_run_and_already_enabled_do_not_require_mount_or_restart(self):
        self.monitor.unlink()
        for arguments, enabled in (([], False), (['--apply'], True)):
            with self.subTest(arguments=arguments, already_enabled=enabled):
                self.config.write_text(json.dumps(dict(self.original, addr_history_index=enabled)) + '\n')
                self.initial_bytes = self.config.read_bytes()
                with patch.object(enable.subprocess, 'run') as commands, \
                        patch.object(enable.os.path, 'ismount') as mount_check, contextlib.redirect_stdout(io.StringIO()):
                    enable.main(arguments)
                self.assert_unchanged(commands)
                mount_check.assert_not_called()

    def test_inactive_witness_refuses_before_backup_or_config_change(self):
        with patch.object(enable.os.path, 'ismount', return_value=True), \
                patch.object(enable.subprocess, 'run', side_effect=subprocess.CalledProcessError(3, 'systemctl')) as commands, \
                contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(subprocess.CalledProcessError):
                enable.main(['--apply'])
        self.assertEqual(self.config.read_bytes(), self.initial_bytes)
        self.assertEqual(list(self.root.glob('nodus.conf.before-monitor-*')), [])
        commands.assert_called_once_with(['systemctl', 'is-active', '--quiet', 'nodus-witness.service'], check=True)

    def test_unprivileged_or_symlinked_node_config_is_refused(self):
        with patch.object(enable.os, 'geteuid', return_value=1000), patch.object(enable.subprocess, 'run') as commands:
            with self.assertRaisesRegex(SystemExit, 'sudo'):
                enable.main(['--apply'])
        self.assert_unchanged(commands)
        target = self.root / 'node-target.conf'
        self.config.rename(target)
        self.config.symlink_to(target)
        with patch.object(enable.subprocess, 'run') as commands:
            with self.assertRaisesRegex(SystemExit, 'regular'):
                enable.main(['--apply'])
        self.assertEqual(target.read_bytes(), self.initial_bytes)
        commands.assert_not_called()


if __name__ == '__main__':
    unittest.main()
