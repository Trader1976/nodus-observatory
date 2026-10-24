"""Synthetic collection tests: freshness, source binding and readable reports."""
import copy
import csv
from datetime import datetime, timezone, timedelta
import hashlib
import io
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import time
import unittest
from unittest.mock import patch, PropertyMock

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from network_statistics import SCAN_CHAIN_ID
from network_statistics.api import report, export_csv
from network_statistics.collector import collect_statistics, read_local_storage, read_peer_endpoints, api_reader, _nodes, NoRedirect
from network_statistics.geolocation import address_ip, load_locations, locate
from network_statistics.store import writer, save_observation, set_meta, utcnow, observations


def snapshot(stats=True):
    result = {"chain": {"chain_id": SCAN_CHAIN_ID, "height": 10},
              "network": {"generated_at": utcnow(), "available": True, "stale": False, "errors": [],
                          "stats": {"chain_id": SCAN_CHAIN_ID, "indexed_height": 10, "tip_height": 10,
                                    "staking": {"validators": 2, "active_validators": 1, "self_stake": "9007199254740993", "delegated": "150", "delegations": 2},
                                    "circulating": "100", "reward_pool": "200", "treasury": ["1"] * 9},
                          "tps": {"last_minute": {"tps": "0.10"}, "last_hour": {"tps": "0.20"},
                                  "history": [{"start_ms": int(time.time() // 3600 * 3600000), "tx": 3, "blocks": 2, "seconds": 20, "tps": "0.15"}]},
                          "committee": {"height": 11, "count": 1, "seats": [{"id": "a" * 64, "address": "198.51.100.8:4004", "stake_raw": "9007199254740993", "power": 1, "commission_bps": 500}]}}}
    if not stats:
        result["network"].update(stats=None, tps=None, errors=[{"source": "scan/stats", "message": "HTTPError"}, {"source": "scan/tps", "message": "HTTPError"}])
    return result


class CollectionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "statistics.sqlite3"

    def tearDown(self):
        self.temp.cleanup()

    def collect(self, data=None, **config):
        data = snapshot() if data is None else data
        with patch("network_statistics.collector.api_reader", return_value=lambda endpoint: {"chain_id": SCAN_CHAIN_ID, "indexed_height": 10}), \
             patch("network_statistics.indexer.sync_index", return_value={"status": "ok", "caught_up": True}) as index:
            status = collect_statistics(self.temp.name, config, data)
        return status, index

    def test_first_committee_only_collection_survives_scan_failure(self):
        status, index = self.collect(snapshot(False))
        data = report(self.path)
        self.assertTrue(data["available"])
        self.assertFalse(data["stale"])
        self.assertEqual(data["summary"]["active_validators"], 1)
        self.assertIsNone(data["summary"]["tps_1m"])
        self.assertIsNone(data["summary"]["transactions"])
        self.assertEqual(data["nodes"][0]["id"], "a" * 64)
        index.assert_not_called()

    def test_exact_staking_values_and_tps_survive_api(self):
        status, index = self.collect()
        data = report(self.path)
        self.assertTrue(data["available"])
        self.assertEqual(data["summary"]["self_stake_raw"], "9007199254740993")
        self.assertEqual(data["summary"]["tps_1m"], "0.10")
        self.assertEqual(data["series"]["tps"][0]["transactions"], 3)
        self.assertIsNone(data["summary"]["tx_24h"])
        self.assertIsNone(data["nodes"][0]["location"])
        self.assertEqual(index.call_args.args[3], 10)

    def test_cached_snapshot_is_not_a_new_observation(self):
        data = snapshot()
        self.collect(data)
        self.collect(data)
        with sqlite3.connect(self.path) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM observations").fetchone()[0], 1)

    def test_public_report_redacts_legacy_ips_without_recollection(self):
        self.collect(snapshot(False))
        with sqlite3.connect(self.path) as db:
            old = json.loads(db.execute("SELECT payload FROM observations").fetchone()[0])
            old["nodes"][0].update(address="198.51.100.8:4004", external_ip="192.0.2.1",
                                     storage={"status": "active", "owner": "b" * 128, "address": "192.0.2.2"},
                                     location={"city": "Example", "latitude": 60, "longitude": 20, "ip": "192.0.2.3"})
            old["errors"] = [{"source": "peer_endpoints", "message": "Failed connecting to 192.0.2.4"}]
            db.execute("UPDATE observations SET payload=?", (json.dumps(old),))
            set_meta(db, "peer_observation", {"available": True, "items": [{"address": "[2001:db8::8]:4001", "identity": None,
                              "location": {"city": "Example", "latitude": 60, "longitude": 20}}]})
            set_meta(db, "geolocation", {"configured": True, "internal_ip": "192.0.2.5"})
            db.execute("DELETE FROM statistics_meta WHERE key='endpoint_privacy_key'")
        result = report(self.path)
        self.assertTrue(result["available"])
        encoded = json.dumps(result)
        for address in ("198.51.100.8", "192.0.2.", "2001:db8::8"):
            self.assertNotIn(address, encoded)
        self.assertNotIn("address", result["nodes"][0])
        self.assertEqual(result["peer_endpoints"][0]["location"]["city"], "Example")
        self.assertNotIn("id", result["peer_endpoints"][0])

    def test_endpoint_ids_are_private_stable_and_installation_specific(self):
        self.collect(snapshot(False))
        with sqlite3.connect(self.path) as db:
            set_meta(db, "peer_observation", {"available": True, "items": [{"address": "198.51.100.8:4001", "identity": None}]})
        first = report(self.path)["peer_endpoints"][0]["id"]
        self.assertRegex(first, r"^[0-9a-f]{64}$")
        self.assertEqual(first, report(self.path)["peer_endpoints"][0]["id"])
        self.assertNotEqual(first, hashlib.sha256(b"198.51.100.8:4001").hexdigest())
        with sqlite3.connect(self.path) as db:
            set_meta(db, "endpoint_privacy_key", "ab" * 32)
        self.assertNotEqual(first, report(self.path)["peer_endpoints"][0]["id"])

    def test_wrong_chain_cannot_replace_prior_history(self):
        self.collect()
        data = snapshot()
        data["network"]["stats"]["chain_id"] = "b" * 64
        status, index = self.collect(data)
        self.assertEqual(status["status"], "error")
        self.assertTrue(report(self.path)["available"])
        with sqlite3.connect(self.path) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM observations").fetchone()[0], 1)
        index.assert_not_called()

    def test_stale_remote_values_are_not_relabelled_as_current(self):
        data = snapshot()
        data["network"].update(stale=True, last_good={"stats": utcnow(), "tps": utcnow()}, errors=[{"source": "scan/stats"}, {"source": "scan/tps"}])
        self.collect(data)
        summary = report(self.path)["summary"]
        self.assertIsNone(summary["self_stake_raw"])
        self.assertIsNone(summary["tps_1m"])
        self.assertEqual(summary["active_validators"], 1)

    def test_old_observations_stale_without_collector_running(self):
        data = snapshot()
        self.collect(data)
        old = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat(timespec="seconds")
        with sqlite3.connect(self.path) as db:
            row = json.loads(db.execute("SELECT payload FROM observations").fetchone()[0])
            row["timestamp"] = old
            db.execute("UPDATE observations SET timestamp=?,payload=?", (old, json.dumps(row)))
        self.assertTrue(report(self.path)["stale"])

    def test_disabled_preserves_existing_data_and_performs_no_reads(self):
        self.collect()
        status, index = self.collect(network_enabled=False)
        self.assertEqual(status["status"], "disabled")
        self.assertTrue(report(self.path)["stale"])
        self.assertTrue(report(self.path)["available"])
        index.assert_not_called()

    def test_history_only_decodes_selected_payloads(self):
        db = writer(self.path)
        try:
            for i in range(101):
                stamp = (datetime.now(timezone.utc) - timedelta(minutes=101 - i)).isoformat(timespec="seconds")
                save_observation(db, {"timestamp": stamp, "chain_id": SCAN_CHAIN_ID, "stats": {}, "nodes": []})
            db.commit()
            original = json.loads
            with patch("network_statistics.store.json.loads", wraps=original) as decode:
                points, total, stride = observations(db, limit=10)
                self.assertLessEqual(decode.call_count, 11)
            self.assertEqual(total, 101)
            self.assertEqual(stride, 11)
            self.assertEqual(len(points), 11)
            self.assertLess(points[0]["timestamp"], points[-1]["timestamp"])
        finally:
            db.close()

    def test_missing_database_and_invalid_range(self):
        self.assertFalse(report(self.path)["available"])
        with self.assertRaises(ValueError):
            report(self.path, "invalid")
        with self.assertRaises(ValueError):
            export_csv(self.path)

    def test_api_does_not_open_network_or_node(self):
        self.collect()
        with patch("network_statistics.collector.api_reader", side_effect=AssertionError), \
             patch("network_statistics.collector.read_local_storage", side_effect=AssertionError):
            self.assertTrue(report(self.path)["available"])
            self.assertIn("indexed_from_height", export_csv(self.path))

    def test_committed_delegations_update_without_new_network_sample_and_fail_honestly(self):
        from network_statistics.tests.test_delegations import DelegationTests
        source = DelegationTests()
        source.setUp()
        try:
            data = snapshot(False)
            fingerprint = hashlib.sha3_512(source.public_key).hexdigest()
            data["network"]["committee"]["seats"][0]["id"] = fingerprint[:64]
            self.collect(data, rewards_source_db=str(source.path))
            current = report(self.path)["nodes"][0]["delegation"]
            self.assertTrue(current["available"])
            self.assertEqual(current["at_height"], 10)
            self.assertEqual(current["owner_delegated_raw"], str(source.owner_amount))
            self.assertEqual(current["external_delegated_raw"], str(source.other_amount))
            self.assertNotIn("198.51.100.8", json.dumps(report(self.path)))
            with sqlite3.connect(self.path) as db:
                old = json.loads(db.execute("SELECT payload FROM observations").fetchone()[0])
                old["stats"] = {"tip_height": 20}
                db.execute("UPDATE observations SET payload=?", (json.dumps(old),))
                set_meta(db, "collection", {"status": "disabled"})
            current = report(self.path)["nodes"][0]["delegation"]
            self.assertTrue(current["stale"])
            self.assertEqual(current["lag_blocks"], 10)
            source.db.execute("DELETE FROM delegations")
            source.db.execute("UPDATE validators SET total_delegated=0,external_delegated=0")
            source.db.commit()
            self.collect(data, rewards_source_db=str(source.path))
            current = report(self.path)["nodes"][0]["delegation"]
            self.assertTrue(current["available"])
            self.assertEqual(current["delegator_count"], 0)
            self.assertEqual(current["delegated_raw"], "0")
            self.assertEqual(report(self.path)["coverage"]["network_samples"], 1)
            source.db.execute("UPDATE validators SET total_delegated=1,external_delegated=1")
            source.db.commit()
            self.collect(data, rewards_source_db=str(source.path))
            self.assertFalse(report(self.path)["nodes"][0]["delegation"]["available"])
        finally:
            source.tearDown()

    def test_scan_lag_target_remains_local_chain_tip(self):
        data = snapshot()
        data["chain"]["height"] = 100
        data["network"]["stats"].update(indexed_height=5, tip_height=99)
        unused, index = self.collect(data)
        self.assertEqual(index.call_args.args[3], 100)
        self.assertEqual(index.call_args.kwargs["start_height"], 1)


class PeerTests(unittest.TestCase):
    def test_local_endpoint_query_is_bounded_and_does_not_claim_identity(self):
        import types
        from unittest.mock import Mock
        runner = Mock(return_value={"output": "Cluster servers (2):\n  198.51.100.8:4001\n  203.0.113.9:4001\n", "returncode": 0, "error": None})
        with patch.dict(sys.modules, {"collector": types.SimpleNamespace(run_command=runner)}):
            data = read_peer_endpoints({"cli_path": "/usr/local/bin/nodus-cli"}, time.monotonic() + 10, [])
        self.assertTrue(data["available"])
        self.assertEqual(len(data["items"]), 2)
        self.assertIsNone(data["items"][0]["identity"])
        self.assertEqual(runner.call_args.args[0], ["/usr/local/bin/nodus-cli", "-s", "127.0.0.1", "servers"])
        self.assertLessEqual(runner.call_args.kwargs["timeout"], 6)
        self.assertEqual(runner.call_args.kwargs["max_bytes"], 65536)

    def test_unparseable_or_over_limit_endpoint_list_is_not_zero(self):
        import types
        from unittest.mock import Mock
        for output in ("", "Cluster servers (99999):", "Cluster servers (0):\n  198.51.100.8:4001"):
            runner = Mock(return_value={"output": output, "returncode": 0, "error": None})
            with self.subTest(output=output), patch.dict(sys.modules, {"collector": types.SimpleNamespace(run_command=runner)}):
                with self.assertRaises(ValueError):
                    read_peer_endpoints({"cli_path": "/nodus-cli"}, time.monotonic() + 10, [])

    def test_cli_bare_ipv6_is_normalized_without_dns(self):
        import types
        from unittest.mock import Mock
        runner = Mock(return_value={"output": "Cluster servers (1):\n  2001:db8::8:4001\n", "returncode": 0, "error": None})
        with patch.dict(sys.modules, {"collector": types.SimpleNamespace(run_command=runner)}):
            data = read_peer_endpoints({"cli_path": "/nodus-cli"}, time.monotonic() + 10, [])
        self.assertEqual(data["items"][0]["address"], "[2001:db8::8]:4001")
        self.assertFalse(data["truncated"])

    def test_no_cli_or_expired_budget_does_not_probe(self):
        self.assertFalse(read_peer_endpoints({}, time.monotonic() + 10, [])["available"])
        self.assertFalse(read_peer_endpoints({"cli_path": "/nodus-cli"}, time.monotonic() - 1, [])["available"])


class GeoTests(unittest.TestCase):
    def test_local_status_binds_only_the_matching_registered_identity(self):
        row = {"id": "b" * 64, "fingerprint": "b" * 128, "roles": ["storage"],
               "address": None, "status": "active", "storage": {}}
        local = {"fingerprint": "b" * 128, "p2p_id": "b" * 64, "external_ip": "198.51.100.8"}
        with patch("ipaddress.IPv4Address.is_global", new_callable=PropertyMock, return_value=True):
            nodes = _nodes({}, {"nodes": [row]}, utcnow(), [], local)
        self.assertEqual(len(nodes), 1)
        self.assertTrue(nodes[0]["local"])
        self.assertEqual(nodes[0]["address"], "198.51.100.8")
        self.assertEqual(nodes[0]["address_source"], "local_status_external_ip")
        for bad in ({**local, "p2p_id": "c" * 64},
                    {**local, "fingerprint": "b" * 64 + "c" * 64},
                    {**local, "fingerprint": None}):
            result = _nodes({}, {"nodes": [row]}, utcnow(), [], bad)[0]
            self.assertIsNone(result["address"])
            self.assertFalse(result.get("local", False))
        self.assertEqual(_nodes({}, None, utcnow(), [], local), [])

    def test_local_address_does_not_replace_committee_endpoint_or_use_private_ip(self):
        local = {"fingerprint": "a" * 128, "p2p_id": "a" * 64, "external_ip": "198.51.100.99"}
        committee = snapshot(False)["network"]["committee"]
        with patch("ipaddress.IPv4Address.is_global", new_callable=PropertyMock, return_value=True):
            result = _nodes(committee, None, utcnow(), [], local)[0]
        self.assertEqual(result["address"], "198.51.100.8:4004")
        self.assertTrue(result["local"])
        row = {"id": "a" * 64, "fingerprint": "a" * 128, "roles": ["storage"], "address": None}
        for address in ("127.0.0.1", "not-a-host.example", "192.0.2.8", None):
            result = _nodes({}, {"nodes": [row]}, utcnow(), [], {**local, "external_ip": address})[0]
            self.assertIsNone(result["address"])

    def test_ip_parsing_never_resolves_names(self):
        self.assertEqual(str(address_ip("198.51.100.8:4004")), "198.51.100.8")
        self.assertEqual(str(address_ip("[2001:db8::8]:4004")), "2001:db8::8")
        self.assertIsNone(address_ip("example.com:4004"))
        self.assertIsNone(address_ip("198.51.100.8:99999"))

    def test_prefix_override_and_private_addresses(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "geo.csv"
            path.write_text("network,country,country_code,city,latitude,longitude\n198.51.100.0/24,Example,EX,Broad,10,20\n198.51.100.8,Example,EX,Specific,30,40\n192.0.2.0/24,Private,PR,No,30,40\n")
            maps = load_locations(path)
            with patch("network_statistics.geolocation.ipaddress.IPv4Address.is_global", new_callable=PropertyMock, return_value=True):
                self.assertEqual(locate("198.51.100.8:4004", maps)["city"], "Specific")
                self.assertEqual(locate("198.51.100.7:4004", maps)["city"], "Broad")
            self.assertIsNone(locate("192.0.2.1", maps))
            self.assertIsNone(locate("203.0.113.9", maps))
            path.write_text("network,country,country_code,city,latitude,longitude\n198.51.100.8,Example,EX,Bad,nan,20\n")
            with self.assertRaises(ValueError):
                load_locations(path)

    def test_geo_failure_does_not_hide_network(self):
        with tempfile.TemporaryDirectory() as directory:
            data = snapshot(False)
            result = collect_statistics(directory, {"statistics_geoip_file": "/nonexistent/test.csv"}, data)
            self.assertTrue(result["available"])
            self.assertEqual(result["errors"][0]["source"], "geolocation_csv")


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / ("witness_" + SCAN_CHAIN_ID[:32] + ".db")
        self.pk = bytes([7]) * 2592
        self.fp = hashlib.sha3_512(self.pk).digest()
        self.block_id = bytes([9]) * 64
        with sqlite3.connect(self.path) as db:
            db.executescript("""
                CREATE TABLE v2_blocks(global_height INTEGER PRIMARY KEY,block_id BLOB);
                CREATE TABLE v2_storage_nodes(node_fp BLOB PRIMARY KEY,node_pk BLOB,payee_fp BLOB,bond INTEGER,status INTEGER,registered_height INTEGER,exit_height INTEGER,fail_streak INTEGER,grace_until INTEGER);
                CREATE TABLE v2_storage_sets(epoch_start INTEGER PRIMARY KEY,member_count INTEGER);
                CREATE TABLE v2_storage_set_members(epoch_start INTEGER,node_fp BLOB,fail_streak INTEGER,grace_until INTEGER);
            """)
            db.execute("INSERT INTO v2_blocks VALUES (?,?)", (720, self.block_id))
            db.execute("INSERT INTO v2_storage_nodes VALUES (?,?,?,?,?,?,?,?,?)", (self.fp, self.pk, bytes([4]) * 64, 100, 1, 5, 0, 2, 1440))
            db.execute("INSERT INTO v2_storage_sets VALUES (720,1)")
            db.execute("INSERT INTO v2_storage_set_members VALUES (720,?,2,1440)", (self.fp,))
        self.data = snapshot(False)
        self.data["chain"]["height"] = 719
        self.config = {"rewards_source_db": str(self.path)}

    def tearDown(self):
        self.temp.cleanup()

    def test_readonly_public_registry_and_anchored_frozen_set(self):
        before = self.path.read_bytes()
        data = read_local_storage(self.config, self.data, (720, self.block_id.hex()))
        self.assertTrue(data["anchor_verified"])
        self.assertEqual(data["members"], 1)
        self.assertTrue(data["nodes"][0]["storage"]["member"])
        self.assertTrue(data["nodes"][0]["storage"]["in_grace"])
        self.assertNotIn("node_pk", data["nodes"][0])
        self.assertEqual(self.path.read_bytes(), before)

    def test_mismatched_anchor_and_hash_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "differs"):
            read_local_storage(self.config, self.data, (720, "0" * 128))
        with sqlite3.connect(self.path) as db:
            db.execute("UPDATE v2_storage_nodes SET node_pk=?", (bytes(2592),))
        with self.assertRaisesRegex(ValueError, "identity"):
            read_local_storage(self.config, self.data)

    def test_same_node_witness_storage_join_uses_validated_hash(self):
        storage = read_local_storage(self.config, self.data)
        committee = {"seats": [{"id": self.fp.hex()[:64], "address": "198.51.100.8:4004"}]}
        nodes = _nodes(committee, storage, utcnow(), [])
        self.assertEqual(len(nodes), 1)
        self.assertEqual(nodes[0]["roles"], ["witness", "storage"])
        self.assertEqual(nodes[0]["fingerprint"], self.fp.hex())

    def test_frozen_members_and_schema_are_checked(self):
        with sqlite3.connect(self.path) as db:
            db.execute("UPDATE v2_storage_sets SET member_count=2")
        with self.assertRaisesRegex(ValueError, "count"):
            read_local_storage(self.config, self.data)
        with sqlite3.connect(self.path) as db:
            db.execute("DROP TABLE v2_storage_sets")
            db.execute("CREATE VIEW v2_storage_sets AS SELECT 720 AS epoch_start,1 AS member_count")
        with self.assertRaisesRegex(ValueError, "table"):
            read_local_storage(self.config, self.data)


class SourceReaderTests(unittest.TestCase):
    def test_deadline_and_endpoint_allowlist(self):
        read = api_reader(time.monotonic() - 1)
        with self.assertRaises(TimeoutError):
            read("stats")
        with self.assertRaises(ValueError):
            read("https://example.com")
        with self.assertRaises(ValueError):
            NoRedirect().redirect_request(None, None, 302, "", {}, "http://127.0.0.1/")

    def test_stream_deadline_json_keys_and_numbers(self):
        class Response:
            status = 200
            def __init__(self, body): self.body, self.reads = body, 0
            def geturl(self): return "https://scan.nodusnetwork.io/api/stats"
            def __enter__(self): return self
            def __exit__(self, *unused): pass
            def read1(self, size):
                self.reads += 1
                return self.body if self.reads == 1 else b""
        for body in (b'{"a":1,"a":2}', b'{"a":NaN}', b'[]'):
            with self.subTest(body=body), patch("network_statistics.collector.build_opener") as opener:
                opener.return_value.open.return_value = Response(body)
                with self.assertRaises(ValueError):
                    api_reader(time.monotonic() + 5)("stats")
        with patch("network_statistics.collector.build_opener") as opener:
            response = Response(b'{}')
            opener.return_value.open.return_value = response
            with patch("network_statistics.collector.time.monotonic", side_effect=[0, 0, 2]):
                with self.assertRaises(TimeoutError):
                    api_reader(1)("stats")


if __name__ == "__main__":
    unittest.main()
