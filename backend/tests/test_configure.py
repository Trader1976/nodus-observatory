import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from collector import DEFAULTS, load_config
from configure import discover


class ConfigureTests(unittest.TestCase):
    def discovery(self, directory, mount="/", device_type="part", fingerprint="cd" * 64):
        def command(args):
            if args[-1] == "status":
                return f"fingerprint: {fingerprint}\nchain id: {'ef' * 32}\ndata_path: {directory}\n"
            if args[0] == "findmnt":
                return json.dumps({"filesystems": [{"target": mount, "source": "/dev/nvme2n1p3"}]})
            if args[0] == "lsblk":
                return json.dumps({"blockdevices": [{"name": "/dev/nvme2n1p3", "type": device_type, "pkname": "/dev/nvme2n1"}]})
            raise AssertionError(args)
        with patch("configure.command", side_effect=command), patch("configure.shutil.which", return_value="/usr/local/bin/nodus-cli"):
            return discover(DEFAULTS)

    def test_discovers_local_identity_and_root_filesystem(self):
        with tempfile.TemporaryDirectory() as directory:
            config = self.discovery(directory)
            self.assertEqual(config["fingerprint"], "cd" * 64)
            self.assertEqual(config["data_path"], directory)
            self.assertEqual(config["mount_path"], "/")
            self.assertEqual(config["disk_device"], "nvme2n1")
            self.assertEqual(config["rewards_source_db"], str(Path(directory) / ("witness_" + "ef" * 16 + ".db")))
            self.assertIsNone(config["network_interface"])
            self.assertEqual(config["bind_host"], "127.0.0.1")
            self.assertEqual(config["bind_port"], 8890)
            path = Path(directory) / "config.json"
            path.write_text(json.dumps(config))
            self.assertEqual(load_config(path)["fingerprint"], "cd" * 64)

    def test_dedicated_filesystem_remains_the_expected_mount(self):
        with tempfile.TemporaryDirectory() as directory:
            self.assertEqual(self.discovery(directory, mount=directory)["mount_path"], directory)

    def test_lvm_does_not_guess_a_physical_smart_device(self):
        with tempfile.TemporaryDirectory() as directory:
            self.assertIsNone(self.discovery(directory, device_type="lvm")["disk_device"])

    def test_unavailable_node_does_not_fall_back_to_another_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "fingerprint"):
                self.discovery(directory, fingerprint="not available")

    def test_missing_data_path_refuses_discovery(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "data directory"):
                self.discovery(str(Path(directory) / "missing"))

    def test_template_is_generic_and_legacy_settings_still_load(self):
        self.assertIsNone(load_config(Path(__file__).parents[1] / "config.example.json")["fingerprint"])
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            path.write_text(json.dumps({"fingerprint": "12" * 64, "disk_device": "sda", "network_interface": "eno1"}))
            config = load_config(path)
            self.assertEqual(config["fingerprint"], "12" * 64)
            self.assertEqual(config["disk_device"], "sda")


if __name__ == "__main__":
    unittest.main()
