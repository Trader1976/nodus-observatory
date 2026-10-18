import copy
import http.client
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from functools import partial
from http.server import ThreadingHTTPServer

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from collector import DEFAULTS, parse_status, parse_storage, rates, parse_events, parse_services, run_command, store_sample, utc_now, collect
from server import Handler, readonly_connection, history


STATUS = """Nodus node status — 127.0.0.1:4001, config /etc/nodus.conf
Node
  nodus-cli version:     0.26.7
  installed commit:      24f93e6b709119a3013efacf3a374930c97871b7
  fingerprint:           {fp}
  P2P ID:                {p2p}
Services
  nodus-core:            active, enabled   [OK]
Chain
  this node's height:    250688 (rule-set generation 4)
  chain id:              a48d1a785500a1cdecd739ecd53ef0e95b1dc4a7a300f49176a7fa25ae176114
  nodus-core uptime:     0d 15h 32m
  network height:        250688 (highest of 3 answer(s); asked 3)
  behind by:             0 block(s)   [OK]
Roles
  storage node:          ACTIVE, bond 100000000000000 raw, registered at 250174
    owner:               {owner}
    fail_streak:         0   [OK]
    grace_until:         257040 — IN GRACE this epoch: fetching segments, not probed, earns nothing
    storage set:         epoch (250560, 251280]: 4 member(s), this node IS a member
    eligible segments:   0 (0 blocks)
Resources
  chain database:        19.7 GiB (witness_a48d.db with -wal/-shm)
  segments:              0 complete (seg-*.ok), 167.0 MiB in /var/lib/nodus/data/segments
Clock
  NTP synchronized:      yes   [OK]
Config
  external_ip:           83.146.239.12
""".format(fp="ab" * 64, p2p="ab" * 32, owner="08" * 64)


class ParserTests(unittest.TestCase):
    def test_registered_grace_snapshot(self):
        data = parse_status(STATUS)
        self.assertEqual(data["chain"]["height"], 250688)
        self.assertEqual(data["chain"]["generation"], 4)
        self.assertTrue(data["chain"]["sync_ok"])
        self.assertEqual(data["storage"]["bond_raw"], "100000000000000")
        self.assertTrue(data["storage"]["in_grace"])
        self.assertEqual(data["storage"]["grace_epochs_left"], 9)
        self.assertTrue(data["storage"]["is_member"])
        self.assertEqual(data["storage"]["segment_bytes"], 167 * 1024 * 1024)
        self.assertEqual(data["node"]["uptime_seconds"], 55920)
        self.assertTrue(data["clock"]["ntp_synchronized"])

    def test_missing_output_is_unknown_not_zero_or_healthy(self):
        data = parse_status("connection refused")
        self.assertIsNone(data["chain"]["height"])
        self.assertIsNone(data["chain"]["behind"])
        self.assertIsNone(data["chain"]["sync_ok"])
        self.assertIsNone(data["storage"]["registered"])
        self.assertIsNone(data["storage"]["complete_segments"])
        self.assertIsNone(data["clock"]["ntp_synchronized"])
        self.assertIsNone(data["resources"]["cpu_percent"])

    def test_unregistered_and_explicit_empty_segments(self):
        data = parse_status("  storage node: not registered\n  segments: none (/var/lib/nodus/data/segments does not exist)")
        self.assertIs(data["storage"]["registered"], False)
        self.assertEqual(data["storage"]["complete_segments"], 0)
        self.assertEqual(data["storage"]["segment_bytes"], 0)
        self.assertIsNone(data["chain"]["sync_ok"])

    def test_storage_reports_after_grace(self):
        data = parse_status(STATUS.replace("257040", "250560"))
        parse_storage("registry: ACTIVE, bond 100000000000000 raw, fail_streak 2, registered at 250174\n  eligible segments this epoch: 17 (12240 blocks)", data)
        self.assertFalse(data["storage"]["in_grace"])
        self.assertEqual(data["storage"]["grace_epochs_left"], 0)
        self.assertEqual(data["storage"]["fail_streak"], 2)
        self.assertEqual(data["storage"]["eligible_blocks"], 12240)

    def test_rates_first_sample_and_reboot_are_unknown(self):
        current = {"boot_id": "a", "monotonic": 100, "cpu_total": 1000, "cpu_idle": 900, "network_rx": 10000}
        resources = {}
        rates(resources, current, None)
        self.assertIsNone(resources["network_rx_bps"])
        previous = dict(current, boot_id="old", monotonic=40, cpu_total=400, cpu_idle=400, network_rx=4000)
        rates(resources, current, previous)
        self.assertIsNone(resources["cpu_percent"])
        previous["boot_id"] = "a"
        rates(resources, current, previous)
        self.assertEqual(resources["network_rx_bps"], 100.0)
        self.assertEqual(resources["cpu_percent"], 16.67)

    def test_journal_events_never_copy_arbitrary_raw_messages(self):
        raw = {"__REALTIME_TIMESTAMP": "1792247651000000", "__CURSOR": "abc", "MESSAGE": "SendTimeout secret=do-not-copy peer=public"}
        event = parse_events(json.dumps(raw))[0]
        self.assertEqual(event["kind"], "peer_timeout")
        self.assertNotIn("do-not-copy", json.dumps(event))
        self.assertEqual(parse_events("not JSON\n" + json.dumps({"MESSAGE": "unrelated"})), [])

    def test_services_missing_fields_remain_unknown(self):
        data = parse_services("Id=nodus-core.service\nActiveState=active\nUnitFileState=enabled\n\nId=pqnas.service\nActiveState=active\n")
        self.assertEqual(data[0]["active"], "active")
        self.assertIsNone(data[1]["active"])
        self.assertEqual(data[3]["active"], "active")

    def test_subprocess_timeout_and_output_budget(self):
        timeout = run_command([sys.executable, "-c", "import time;time.sleep(5)"], timeout=0.1)
        self.assertEqual(timeout["error"], "command timed out")
        oversized = run_command([sys.executable, "-c", "print('x'*20000)"], timeout=2, max_bytes=1024)
        self.assertEqual(oversized["error"], "command output exceeded limit")
        self.assertEqual(len(oversized["output"]), 1024)

    def test_complete_collection_with_failed_node_has_no_false_zero_values(self):
        with tempfile.TemporaryDirectory() as directory:
            config = dict(DEFAULTS, state_dir=directory, network_enabled=False, rewards_enabled=False)
            failed = {"output": "not available", "returncode": 1, "error": None}
            counters = {"monotonic": 1, "boot_id": "a", "cpu_total": 100, "cpu_idle": 90}
            with patch("collector.run_command", return_value=failed), patch("collector.os.path.ismount", return_value=False), patch("collector.read_counters", return_value=({}, counters)):
                result = collect(config)
            self.assertTrue(result["quality"]["partial"])
            self.assertIsNone(result["chain"]["height"])
            self.assertIsNone(result["storage"]["complete_segments"])
            self.assertIsNone(result["resources"]["disk_free_bytes"])
            self.assertFalse(result["resources"]["disk_mount_ok"])
            self.assertEqual(json.loads((Path(directory) / "snapshot.json").read_text())["chain"]["behind"], None)

    def test_storage_query_uses_local_identity_and_rejects_mismatched_override(self):
        for override in (None, "fe" * 64):
            with self.subTest(override=override), tempfile.TemporaryDirectory() as directory:
                config = dict(DEFAULTS, state_dir=directory, fingerprint=override, network_enabled=False, rewards_enabled=False)
                calls = []
                def command(args, *unused):
                    calls.append(args)
                    return {"output": STATUS if args == [config["cli_path"], "status"] else "", "returncode": 0, "error": None}
                with patch("collector.run_command", side_effect=command), patch("collector.os.path.ismount", return_value=False), patch("collector.read_counters", return_value=({}, {})):
                    result = collect(config)
                storage_calls = [args for args in calls if "--fp" in args]
                if override is None:
                    self.assertEqual(storage_calls[0][-1], "ab" * 64)
                else:
                    self.assertEqual(storage_calls, [])
                    self.assertTrue(any("differs" in error["message"] for error in result["quality"]["errors"]))


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.state = self.root / "state"
        self.state.mkdir()
        frontend = self.root / "frontend"
        frontend.mkdir()
        (frontend / "index.html").write_text("<h1>Monitor</h1>")
        (self.root / "private.txt").write_text("never exposed")
        (frontend / "leak.txt").symlink_to(self.root / "private.txt")
        config = dict(DEFAULTS, state_dir=str(self.state), frontend_dir=str(frontend))
        snapshot = parse_status(STATUS)
        snapshot.update(generated_at=utc_now(), stale_after_seconds=180, events=[], quality={"partial": False, "errors": []})
        (self.state / "snapshot.json").write_text(json.dumps(snapshot))
        store_sample(self.state / "metrics.sqlite3", snapshot, 30)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, config=config))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def request(self, path, method="GET", host=None):
        client = http.client.HTTPConnection("127.0.0.1", self.server.server_address[1], timeout=3)
        headers = {"Host": host} if host else {}
        client.request(method, path, headers=headers)
        response = client.getresponse()
        status, body = response.status, response.read()
        client.close()
        return status, body

    def test_dashboard_history_rewards_missing_are_honest(self):
        status, body = self.request("/api/dashboard")
        self.assertEqual(status, 200)
        self.assertFalse(json.loads(body)["freshness"]["stale"])
        _, body = self.request("/api/history?hours=24")
        points = json.loads(body)["points"]
        self.assertEqual(len(points), 1)
        self.assertIsNone(points[0]["cpu_percent"])
        _, body = self.request("/api/rewards")
        self.assertFalse(json.loads(body)["available"])
        self.assertIsNone(json.loads(body)["summary"])

    def test_no_write_methods_or_path_traversal_or_foreign_host(self):
        for method in ("POST", "PUT", "PATCH", "DELETE"):
            self.assertEqual(self.request("/api/dashboard", method)[0], 405)
        for path in ("/../private.txt", "/%2e%2e/private.txt", "/leak.txt", "/%00"):
            status, body = self.request(path)
            self.assertEqual(status, 404)
            self.assertNotIn(b"never exposed", body)
        self.assertEqual(self.request("/", host="attacker.example")[0], 403)

    def test_bad_history_bounds_and_readonly_database(self):
        for hours in ("nan", "inf", "-1", "100000", "x"):
            self.assertEqual(self.request("/api/history?hours=" + hours)[0], 400)
        connection = readonly_connection(self.state / "metrics.sqlite3")
        with self.assertRaises(sqlite3.OperationalError):
            connection.execute("DELETE FROM samples")
        connection.close()
        self.assertEqual(len(history(self.state / "metrics.sqlite3", 24)["points"]), 1)
        with self.assertRaises(sqlite3.OperationalError):
            readonly_connection(self.state / "missing.sqlite3")
        self.assertFalse((self.state / "missing.sqlite3").exists())

    def test_stale_snapshot_and_missing_snapshot_health(self):
        data = json.loads((self.state / "snapshot.json").read_text())
        data["generated_at"] = "2020-01-01T00:00:00+00:00"
        (self.state / "snapshot.json").write_text(json.dumps(data))
        status, body = self.request("/api/health")
        self.assertEqual(status, 503)
        self.assertTrue(json.loads(body)["stale"])
        (self.state / "snapshot.json").unlink()
        self.assertEqual(self.request("/api/dashboard")[0], 503)


if __name__ == "__main__":
    unittest.main()
