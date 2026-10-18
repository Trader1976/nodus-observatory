"""Collector integration: network choices do not interrupt local bookkeeping."""
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from collector import DEFAULTS, collect, load_config
from test_backend import STATUS


class CollectorRewardTests(unittest.TestCase):
    def run_collector(self, **settings):
        rewards = SimpleNamespace(
            collect_rewards=Mock(return_value={"status": "ok", "rows": 0}),
            collect_scan_rewards=Mock(return_value={"status": "ok", "rows": 2}),
        )
        if settings.pop("scan_fails", False):
            rewards.collect_scan_rewards.side_effect = ValueError("unavailable")
        network = SimpleNamespace(collect_network=Mock(return_value={"available": True}))
        def module(name):
            return {"rewards": rewards, "network": network}[name]
        def command(args, *unused):
            return {"output": STATUS if args[-1] == "status" else "", "returncode": 0, "error": None}
        with tempfile.TemporaryDirectory() as directory:
            config = dict(DEFAULTS, state_dir=directory, **settings)
            with patch("collector.run_command", side_effect=command), \
                 patch("collector.read_counters", return_value=({}, {})), \
                 patch("collector.os.path.ismount", return_value=False), \
                 patch("collector.importlib.import_module", side_effect=module):
                snapshot = collect(config)
            self.assertTrue((Path(directory) / "snapshot.json").is_file())
        return snapshot, rewards, network

    def test_existing_configuration_opts_into_scan_without_replacing_settings(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            path.write_text(json.dumps({"bind_port": 8891, "history_days": 45}))
            config = load_config(path)
            self.assertIs(config["rewards_scan_enabled"], True)
            self.assertEqual(config["bind_port"], 8891)
            self.assertEqual(config["history_days"], 45)
            path.write_text(json.dumps({"rewards_scan_enabled": "false"}))
            with self.assertRaisesRegex(ValueError, "boolean"):
                load_config(path)

    def test_same_observed_wallet_and_chain_reach_both_sources(self):
        snapshot, rewards, unused = self.run_collector()
        local = rewards.collect_rewards.call_args
        scan = rewards.collect_scan_rewards.call_args
        self.assertEqual(local.args[1:], scan.args)
        self.assertIs(scan.kwargs["enabled"], True)
        self.assertEqual(snapshot["reward_collection"]["rows"], 0)
        self.assertEqual(snapshot["reward_collection"]["scan"]["rows"], 2)

    def test_network_or_scan_disabled_keeps_local_collection(self):
        for settings in ({"network_enabled": False}, {"rewards_scan_enabled": False}):
            with self.subTest(settings=settings):
                unused, rewards, network = self.run_collector(**settings)
                rewards.collect_rewards.assert_called_once()
                self.assertIs(rewards.collect_scan_rewards.call_args.kwargs["enabled"], False)
                if settings.get("network_enabled") is False:
                    network.collect_network.assert_not_called()

    def test_rewards_disabled_calls_neither_reward_source(self):
        snapshot, rewards, unused = self.run_collector(rewards_enabled=False)
        rewards.collect_rewards.assert_not_called()
        rewards.collect_scan_rewards.assert_not_called()
        self.assertEqual(snapshot["reward_collection"]["status"], "disabled")

    def test_scan_failure_does_not_erase_local_result_or_host_metrics(self):
        snapshot, rewards, unused = self.run_collector(scan_fails=True)
        self.assertEqual(snapshot["reward_collection"]["status"], "ok")
        self.assertEqual(snapshot["reward_collection"]["scan"]["status"], "error")
        self.assertEqual(snapshot["chain"]["height"], 250688)
        self.assertIn("resources", snapshot)


if __name__ == "__main__":
    unittest.main()
