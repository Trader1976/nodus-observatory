"""Role selection survives outages and does not leak disabled-role observations."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from collector import DEFAULTS, collect, load_config, parse_status, witness_committee
from configure import discover_roles
from test_backend import STATUS


COMMITTEE = """Committee for block 250689
[0]
  p2p id: {identity}
  address: public-address
  stake: 123456789012345678901234 raw
  power: 42
  commission: 250
""".format(identity="ab" * 32)


class RoleConfigurationTests(unittest.TestCase):
    def load(self, value):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            path.write_text(json.dumps(value))
            return load_config(path, include_overrides=False)

    def test_legacy_configuration_retains_both_roles_and_name_is_optional(self):
        config = self.load({"history_days": 45})
        self.assertEqual(config["roles"], {"storage": True, "witness": True})
        self.assertEqual(config["node_name"], "")
        self.assertEqual(config["history_days"], 45)
        config["roles"]["storage"] = False
        self.assertIs(DEFAULTS["roles"]["storage"], True)

    def test_role_shape_and_boolean_types_are_strict(self):
        for value in (None, [], {}, {"storage": True}, {"storage": True, "witness": 0},
                      {"storage": False, "witness": False},
                      {"storage": True, "witness": True, "other": True}):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "roles"):
                self.load({"roles": value})

    def test_disabled_default_role_falls_back_without_changing_selection(self):
        config = self.load({"roles": {"storage": False, "witness": True}, "default_view": "storage"})
        self.assertEqual(config["default_view"], "overview")
        self.assertEqual(config["roles"], {"storage": False, "witness": True})
        for field, value in (("node_name", "name\nextra"), ("node_name", "a" * 81),
                             ("default_view", "contracts")):
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.load({field: value})

    def test_discovery_keeps_installed_but_stopped_or_failed_roles(self):
        status = parse_status("")
        for state in ("active, enabled", "inactive, disabled", "failed, enabled", "inactive, masked"):
            with self.subTest(state=state):
                roles = discover_roles("nodus-storage: not-found\nnodus-witness: " + state, status)
                self.assertEqual(roles, {"storage": False, "witness": True})
        self.assertEqual(discover_roles("nodus-storage: inactive, disabled\nnodus-witness: not installed", status),
                         {"storage": True, "witness": False})

    def test_discovery_uses_registration_and_preserves_legacy_when_unknown(self):
        self.assertIsNone(discover_roles("fingerprint: unavailable", parse_status("")))
        self.assertEqual(discover_roles("", parse_status(STATUS)), {"storage": True, "witness": True})
        self.assertEqual(discover_roles("nodus-witness: active, enabled", parse_status("")),
                         {"storage": True, "witness": True})
        with self.assertRaisesRegex(ValueError, "no installed"):
            discover_roles("nodus-storage: not-found\nnodus-witness: not-found", parse_status(""))

    def test_committee_membership_uses_public_p2p_identity_and_exact_amounts(self):
        seat = witness_committee(COMMITTEE, {"p2p_id": "ab" * 32})
        self.assertTrue(seat["is_member"])
        self.assertEqual(seat["height"], 250689)
        self.assertEqual(seat["stake_raw"], "123456789012345678901234")
        self.assertEqual(seat["power"], 42)
        self.assertEqual(seat["commission_bps"], 250)
        self.assertFalse(witness_committee(COMMITTEE, {"p2p_id": "cd" * 32})["is_member"])
        self.assertIsNone(witness_committee(COMMITTEE, {"p2p_id": None})["is_member"])
        unknown = witness_committee("unsupported output", {"p2p_id": "ab" * 32})
        self.assertIsNone(unknown["is_member"])
        self.assertIsNone(unknown["count"])


class RoleCollectionTests(unittest.TestCase):
    def collection(self, roles, witness_state="active", committee=COMMITTEE):
        calls = []
        with tempfile.TemporaryDirectory() as directory:
            config = dict(DEFAULTS, state_dir=directory, data_path=directory, mount_path="/",
                          roles=roles, network_enabled=False, rewards_enabled=False, node_name="Example node")

            def command(args, *unused):
                calls.append(args)
                output, code = "", 0
                if args == [config["cli_path"], "status"]:
                    output = STATUS
                elif args[-1] == "witness":
                    output = committee
                elif args[0] == "/usr/bin/systemctl":
                    units = [value.removesuffix(".service") for value in args if value.endswith(".service")]
                    blocks = []
                    for name in units:
                        state = witness_state if name == "nodus-witness" else "active"
                        loaded = "not-found" if name in ("pqnas", "cloudflared") else "loaded"
                        if loaded == "not-found":
                            state, code = "inactive", 1
                        blocks.append(f"Id={name}.service\nActiveState={state}\nUnitFileState=enabled\nLoadState={loaded}")
                    output = "\n\n".join(blocks)
                elif args[0] == "/usr/bin/timedatectl":
                    output = "yes"
                return {"output": output, "returncode": code, "error": None}

            with patch("collector.run_command", side_effect=command), \
                 patch("collector.read_counters", return_value=({"hostname": "host"}, {})), \
                 patch("collector.os.path.ismount", return_value=True):
                snapshot = collect(config)
            stored = json.loads((Path(directory) / "snapshot.json").read_text())
            self.assertEqual(stored["roles"], roles)
        return snapshot, calls

    def test_witness_only_skips_storage_queries_and_keeps_shared_measurements(self):
        snapshot, calls = self.collection({"storage": False, "witness": True})
        self.assertFalse(snapshot["storage"]["enabled"])
        self.assertIsNone(snapshot["storage"]["complete_segments"])
        self.assertIsNone(snapshot["storage"]["bond_raw"])
        self.assertEqual(snapshot["chain"]["height"], 250688)
        self.assertGreater(snapshot["resources"]["disk_total_bytes"], 0)
        self.assertEqual(snapshot["node"]["display_name"], "Example node")
        self.assertTrue(snapshot["witness"]["committee"]["is_member"])
        self.assertEqual(snapshot["witness"]["status"], "active")
        self.assertFalse(snapshot["quality"]["partial"])
        self.assertFalse(any("storage" in args or "nodus-storage.service" in args or "nodus-storage" in args for args in calls))

    def test_storage_only_has_no_witness_probe_or_false_witness_health_failure(self):
        snapshot, calls = self.collection({"storage": True, "witness": False})
        self.assertEqual(snapshot["witness"]["status"], "disabled")
        self.assertFalse(snapshot["witness"]["enabled"])
        self.assertIsNone(snapshot["witness"]["committee"]["height"])
        self.assertFalse(any("witness" in args or "nodus-witness.service" in args or "nodus-witness" in args for args in calls))
        self.assertFalse(any(error["source"].startswith("witness") for error in snapshot["quality"]["errors"]))

    def test_failed_enabled_witness_stays_configured_and_reports_its_failure(self):
        snapshot, unused = self.collection({"storage": False, "witness": True}, witness_state="failed")
        self.assertTrue(snapshot["roles"]["witness"])
        self.assertTrue(snapshot["witness"]["enabled"])
        self.assertEqual(snapshot["witness"]["status"], "failed")
        self.assertTrue(snapshot["quality"]["partial"])
        self.assertTrue(any(error["source"] == "witness-service" for error in snapshot["quality"]["errors"]))

    def test_unparseable_committee_does_not_claim_membership(self):
        snapshot, unused = self.collection({"storage": False, "witness": True}, committee="changed upstream output")
        self.assertIsNone(snapshot["witness"]["committee"]["is_member"])
        self.assertTrue(any(error["source"] == "witness-committee" for error in snapshot["quality"]["errors"]))


if __name__ == "__main__":
    unittest.main()
