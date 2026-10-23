import copy
import datetime as dt
from functools import partial
import http.client
from http.server import ThreadingHTTPServer
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from collector import DEFAULTS, load_config, utc_now
import settings
from server import Handler, allowed_settings_origins


class SettingsStoreTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.config = copy.deepcopy(DEFAULTS)
        self.config.update(state_dir=str(self.root), node_name="Original")
        self.base_path = self.root / "administrator.json"
        self.base_path.write_text(json.dumps(self.config))

    def tearDown(self):
        self.temporary.cleanup()

    def payload(self, changes):
        return {"settings": changes, "revision": settings.document(self.config, "token")["revision"]}

    def test_save_is_atomic_scoped_and_visible_to_collector_without_base_changes(self):
        before = self.base_path.read_bytes()
        result = settings.save(self.config, self.payload({"node_name": "Test node", "roles": {"storage": False, "witness": True}}), "token")
        self.assertTrue(result["saved"])
        self.assertEqual(result["applies"], "next_collection")
        self.assertEqual(load_config(self.base_path)["node_name"], "Test node")
        self.assertEqual(load_config(self.base_path, include_overrides=False)["node_name"], "Original")
        self.assertEqual(self.base_path.read_bytes(), before)
        path = settings.settings_path(self.config)
        self.assertEqual(path.stat().st_mode & 0o777, 0o640)
        self.assertEqual(set(json.loads(path.read_text())), {"node_name", "roles"})
        self.assertFalse(list(path.parent.glob("*.tmp")))

    def test_second_save_preserves_previous_preferences(self):
        settings.save(self.config, self.payload({"node_name": "First"}), "token")
        first = settings.settings_path(self.config).read_bytes()
        settings.save(self.config, self.payload({"history_days": 14}), "token")
        self.assertEqual(settings.settings_path(self.config).with_name("settings.previous.json").read_bytes(), first)
        self.assertEqual(settings.load_overrides(self.config), {"node_name": "First", "history_days": 14})

    def test_concurrent_edits_reject_lost_updates(self):
        payload = self.payload({"node_name": "First"})
        settings.save(self.config, payload, "token")
        with self.assertRaises(settings.RevisionConflict):
            settings.save(self.config, {**payload, "settings": {"node_name": "Second"}}, "token")
        self.assertEqual(settings.load_overrides(self.config)["node_name"], "First")

    def test_administrator_edit_invalidates_revision(self):
        payload = self.payload({"node_name": "New"})
        self.config["cli_path"] = "/usr/bin/nodus-cli"
        with self.assertRaises(settings.RevisionConflict):
            settings.save(self.config, payload, "token")

    def test_no_executable_database_listener_or_arbitrary_path_overrides(self):
        for key in ("cli_path", "data_path", "mount_path", "rewards_source_db", "state_dir", "frontend_dir", "bind_host", "settings_allowed_origins"):
            with self.subTest(key=key), self.assertRaises(ValueError):
                settings.save(self.config, self.payload({key: "/tmp/malicious"}), "token")
        path = settings.settings_path(self.config)
        path.parent.mkdir()
        path.write_text(json.dumps({"cli_path": "/tmp/malicious"}))
        with self.assertRaises(ValueError):
            load_config(self.base_path)

    def test_strict_types_bounds_device_identifiers_and_roles(self):
        cases = [
            {"roles": {"storage": False, "witness": False}},
            {"roles": {"storage": 1, "witness": True}},
            {"roles": {"storage": True, "witness": True, "extra": True}},
            {"history_days": True}, {"history_days": 0}, {"history_days": 367},
            {"network_enabled": 1}, {"node_name": "bad\nname"},
            {"node_name": "a" * 81}, {"default_view": "contracts"},
            {"disk_device": "../../etc/passwd"}, {"network_interface": ".."},
        ]
        for candidate in cases:
            with self.subTest(candidate=candidate), self.assertRaises(ValueError):
                settings.save(self.config, self.payload(candidate), "token")
        self.assertFalse(settings.settings_path(self.config).exists())

    def test_disabled_default_view_normalizes_and_stays_normalized(self):
        settings.save(self.config, self.payload({"default_view": "storage"}), "token")
        result = settings.save(self.config, self.payload({"roles": {"storage": False, "witness": True}}), "token")
        self.assertEqual(result["settings"]["default_view"], "overview")
        self.assertEqual(settings.load_overrides(self.config)["default_view"], "overview")

    def test_corrupt_preferences_are_visible_and_can_be_repaired_with_backup(self):
        path = settings.settings_path(self.config)
        path.parent.mkdir()
        broken = b'{"node_name": '
        path.write_bytes(broken)
        with self.assertRaises(ValueError):
            settings.load_overrides(self.config)
        document = settings.document(self.config, "token")
        self.assertIn("settings_error", document)
        self.assertEqual(document["settings"]["node_name"], "Original")
        result = settings.save(self.config, {"settings": {"node_name": "Recovered"}, "revision": document["revision"]}, "token")
        self.assertNotIn("settings_error", result)
        self.assertEqual(path.with_name("settings.previous.json").read_bytes(), broken)

    def test_symlink_and_nonregular_preferences_are_never_read(self):
        path = settings.settings_path(self.config)
        path.parent.mkdir()
        secret = self.root / "secret"
        secret.write_text('{"node_name":"should not read"}')
        path.symlink_to(secret)
        with self.assertRaises(OSError):
            settings.load_overrides(self.config)
        path.unlink()
        os.mkfifo(path)
        with self.assertRaises(ValueError):
            settings.load_overrides(self.config)

    def test_symbolic_settings_directory_and_oversized_file_are_rejected(self):
        outside = self.root / "outside"
        outside.mkdir()
        directory = self.root / "settings"
        directory.symlink_to(outside, target_is_directory=True)
        with self.assertRaises(ValueError):
            settings.load_overrides(self.config)
        directory.unlink()
        directory.mkdir()
        (directory / "settings.json").write_bytes(b" " * (settings.MAX_SETTINGS_BYTES + 1))
        with self.assertRaises(ValueError):
            settings.load_overrides(self.config)

    def test_check_uses_only_fresh_observations_without_mutation(self):
        snapshot = {"generated_at": utc_now(), "stale_after_seconds": 180, "services": [{"name": "nodus-storage", "active": "active"}, {"name": "nodus-witness", "active": "failed"}]}
        (self.root / "snapshot.json").write_text(json.dumps(snapshot))
        payload = self.payload({"node_name": "Preview"})
        result = settings.check(self.config, payload)
        statuses = {entry["name"]: entry["status"] for entry in result["checks"]}
        self.assertTrue(result["valid"])
        self.assertEqual(statuses["storage"], "ok")
        self.assertEqual(statuses["witness"], "warning")
        self.assertFalse(settings.settings_path(self.config).exists())
        snapshot["generated_at"] = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=1)).isoformat()
        (self.root / "snapshot.json").write_text(json.dumps(snapshot))
        result = settings.check(self.config, payload)
        self.assertEqual({item["name"]: item["status"] for item in result["checks"]}["storage"], "unknown")

    def test_duplicate_json_keys_and_nonfinite_values_are_rejected(self):
        for raw in ('{"roles":{},"roles":{}}', '{"history_days":NaN}', '{"value":Infinity}'):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                settings.decode_json(raw)


class SettingsApiTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.config = copy.deepcopy(DEFAULTS)
        self.config.update(state_dir=str(self.root), frontend_dir=str(self.root), settings_allowed_origins=[])
        (self.root / "snapshot.json").write_text(json.dumps({"generated_at": utc_now(), "stale_after_seconds": 180, "node": {"hostname": "test-node"}, "monitor": {"data_path": "/data", "history_days": 30}, "events": []}))
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, config=self.config))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.origin = "http://127.0.0.1:" + str(self.server.server_address[1])
        _, self.document = self.request("/api/settings")

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temporary.cleanup()

    def request(self, path, method="GET", payload=None, headers=None, raw=None):
        client = http.client.HTTPConnection("127.0.0.1", self.server.server_address[1], timeout=3)
        request_headers = {}
        body = raw
        if method == "POST":
            request_headers.update({"Origin": self.origin, "Content-Type": "application/json", "X-CSRF-Token": self.document["csrf_token"]})
            body = json.dumps(payload) if raw is None else raw
        if headers:
            request_headers.update(headers)
        client.request(method, path, body=body, headers=request_headers)
        response = client.getresponse()
        status, data = response.status, json.loads(response.read())
        client.close()
        return status, data

    def payload(self, changes):
        return {"settings": changes, "revision": self.document["revision"]}

    def test_get_check_save_and_dashboard_effective_settings(self):
        self.assertIn("roles", self.document["settings"])
        self.assertNotIn("cli_path", self.document["editable_fields"])
        status, checked = self.request("/api/settings/check", "POST", self.payload({"node_name": "Witness lab"}))
        self.assertEqual(status, 200)
        self.assertTrue(checked["valid"])
        self.assertFalse(settings.settings_path(self.config).exists())
        status, saved = self.request("/api/settings", "POST", self.payload({"node_name": "Witness lab", "roles": {"storage": False, "witness": True}}))
        self.assertEqual(status, 200)
        self.assertTrue(saved["saved"])
        status, dashboard = self.request("/api/dashboard")
        self.assertEqual(status, 200)
        self.assertEqual(dashboard["monitor"]["data_path"], "/data")
        self.assertEqual(dashboard["monitor"]["roles"], {"storage": False, "witness": True})
        self.assertEqual(dashboard["node"]["display_name"], "Witness lab")

    def test_csrf_and_origin_fail_closed_including_nonascii_token(self):
        for headers in ({"Origin": "https://attacker.example"}, {"Origin": "null"}, {"Origin": ""}, {"X-CSRF-Token": "wrong"}, {"X-CSRF-Token": "caf\u00e9"}, {"Host": "attacker.example"}):
            with self.subTest(headers=headers):
                status, _ = self.request("/api/settings", "POST", self.payload({"node_name": "Forbidden"}), headers)
                self.assertEqual(status, 403)
        self.assertFalse(settings.settings_path(self.config).exists())

    def test_trusted_public_origin_supports_host_rewriting_without_forwarded_trust(self):
        payload = self.payload({"node_name": "Proxy"})
        headers = {"Origin": "https://node.example.com", "Host": "localhost", "X-Forwarded-Host": "node.example.com"}
        self.assertEqual(self.request("/api/settings", "POST", payload, headers)[0], 403)
        self.config["settings_allowed_origins"] = ["https://node.example.com"]
        self.assertEqual(self.request("/api/settings", "POST", payload, headers)[0], 200)

    def test_content_type_body_bounds_unknown_fields_and_other_write_methods(self):
        payload = self.payload({"node_name": "Bad"})
        self.assertEqual(self.request("/api/settings", "POST", payload, {"Content-Type": "text/plain"})[0], 415)
        self.assertEqual(self.request("/api/settings", "POST", raw="x" * (settings.MAX_SETTINGS_BYTES + 1))[0], 413)
        self.assertEqual(self.request("/api/settings", "POST", raw='{"bad":NaN}')[0], 400)
        self.assertEqual(self.request("/api/settings", "POST", self.payload({"cli_path": "/tmp/nodus-cli"}))[0], 400)
        self.assertEqual(self.request("/api/settings?x=1", "POST", payload)[0], 405)
        for method in ("PUT", "PATCH", "DELETE", "OPTIONS"):
            self.assertEqual(self.request("/api/settings", method)[0], 405)
        self.assertEqual(self.request("/api/dashboard", "POST", payload)[0], 405)

    def test_concurrent_http_saves_have_one_winner(self):
        payload = self.payload({"node_name": "Concurrent"})
        with ThreadPoolExecutor(max_workers=2) as workers:
            results = list(workers.map(lambda _: self.request("/api/settings", "POST", payload)[0], range(2)))
        self.assertEqual(sorted(results), [200, 409])

    def test_corrupt_overlay_keeps_dashboard_available_and_explains_recovery(self):
        path = settings.settings_path(self.config)
        path.parent.mkdir()
        path.write_text("not JSON")
        status, dashboard = self.request("/api/dashboard")
        self.assertEqual(status, 200)
        self.assertIn("settings_error", dashboard)
        self.assertEqual(dashboard["monitor"]["data_path"], "/data")
        status, document = self.request("/api/settings")
        self.assertEqual(status, 200)
        self.assertIn("settings_error", document)
        self.assertEqual(self.request("/api/settings", "POST", {"settings": {"node_name": "Recovered"}, "revision": document["revision"]})[0], 200)

    def test_exact_trusted_origins_reject_credentials_paths_and_bad_ports(self):
        for value in ("https://node.example.com/", "https://node.example.com/path", "https://user@node.example.com", "https://@node.example.com", "https://node.example.com:bad", "https://node.example.com\n", "*"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                allowed_settings_origins({"settings_allowed_origins": [value]})


if __name__ == "__main__":
    unittest.main()
