"""Synthetic Scan fixtures exercise completeness, identity and exact counting."""
import copy
from pathlib import Path
import sqlite3
import sys
import time
import unittest
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from network_statistics.indexer import SCAN_CHAIN_ID, activity_report, init_index, sync_index


BASE = 1_800_000_000_000
NATIVE_A, NATIVE_B = "a" * 128, "b" * 128
EVM_A, EVM_CONTRACT = "c" * 64, "d" * 64
ZERO = "0" * 128


def hash_id(height):
    return "%0128x" % height


def item(height, index=0, op="spend", kind="envelope", code=0, fee="1"):
    return {"position": "%d:%d" % (height, index), "height": height, "index": index,
            "time": BASE + height * 60_000, "kind": kind, "op": op, "code": code,
            "refused": code != 0, "fee": fee,
            "wire_id": hash_id(height * 1000 + index) if code == 0 else None,
            "intent_id": hash_id(height * 1000 + index + 100000) if code == 0 else None,
            "burned": None, "name": None, "name_price": None, "name_owner": None}


def io(address, amount="10", token=ZERO):
    return {"coin_id": hash_id(999), "address": address, "token_id": token,
            "amount": amount, "unlock_block": 0}


class Scan:
    def __init__(self, blocks=5):
        self.headers = {}
        self.items = {}
        self.details = {}
        self.requests = []
        self.chain = SCAN_CHAIN_ID
        self.hook = None
        for height in range(1, blocks + 1):
            self.headers[height] = {"height": height, "block_id": hash_id(height),
                "prev_id": hash_id(height - 1), "global_root": hash_id(123),
                "time": BASE + height * 60_000, "proposer": "e" * 40,
                "applied_count": 0, "n_items": 0}
            self.items[height] = []

    def add(self, data, *, inputs=None, outputs=None, evm=None, record=None):
        height, index = data["height"], data["index"]
        assert index == len(self.items[height])
        self.items[height].append(data)
        self.headers[height]["n_items"] += 1
        if data["kind"] == "envelope" and data["code"] == 0:
            self.headers[height]["applied_count"] += 1
        self.details[(height, index)] = {"tx": {**copy.deepcopy(data), "record": record},
            "inputs": inputs if inputs is not None else [io(NATIVE_A)],
            "outputs": outputs if outputs is not None else [io(NATIVE_B, "7"), io(NATIVE_A, "2")],
            "evm": evm}

    def read(self, endpoint):
        self.requests.append(endpoint)
        if self.hook:
            result = self.hook(endpoint)
            if result is not None:
                return result
        if endpoint == "stats":
            return {"chain_id": self.chain, "indexed_height": max(self.headers, default=0)}
        parsed = urlsplit(endpoint)
        if parsed.path.startswith("block/"):
            height = int(parsed.path.split("/")[1])
            start = int(parse_qs(parsed.query).get("from", [0])[0])
            data = self.items[height][start:start + 100]
            end = start + len(data)
            return copy.deepcopy({"block": self.headers[height], "items": data,
                                  "next_from": end if end < len(self.items[height]) else None})
        if parsed.path.startswith("tx/"):
            height, index = map(int, parsed.path.split("/")[1].split(":"))
            return copy.deepcopy(self.details[(height, index)])
        raise AssertionError(endpoint)


class IndexTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.row_factory = sqlite3.Row
        self.scan = Scan()
        init_index(self.db)

    def tearDown(self):
        self.db.close()

    def sync(self, **kwargs):
        options = {"backfill_blocks": 0, **kwargs}
        return sync_index(self.db, self.scan.read, SCAN_CHAIN_ID,
                          max(self.scan.headers, default=0), **options)

    def report(self, range_key="24h"):
        return activity_report(self.db, range_key, BASE + 6 * 60_000)

    def test_applied_envelopes_claims_paid_failure_and_refusal_are_separate(self):
        self.scan.add(item(1))
        self.scan.add(item(2, op="claim", kind="claim", fee=None), inputs=[], outputs=[io(NATIVE_B)])
        self.scan.add(item(3, op="evm_call", fee="9"), evm={"status": "failed", "gas_used": 99,
            "from": EVM_A, "to": EVM_CONTRACT, "created": None})
        self.scan.add(item(4, code=8))
        self.assertEqual(self.sync()["status"], "ok")
        summary = self.report()["summary"]
        self.assertEqual((summary["transactions"], summary["claims"], summary["refused"]), (2, 1, 1))
        self.assertEqual((summary["evm_calls"], summary["evm_failed"], summary["fee_raw"]), (1, 1, "10"))
        self.assertEqual(summary["gas_used"], "99")
        self.assertEqual(summary["blocks"], 5)
        self.assertEqual(summary["empty_blocks"], 1)
        self.assertEqual(summary["active_native_addresses"], 2)
        self.assertEqual(summary["active_evm_addresses"], 2)
        self.assertEqual(self.report()["contracts"][0], {"address": EVM_CONTRACT,
            "calls": 1, "creates": 0, "failed": 1, "gas_used": "99"})

    def test_exact_fee_sum_above_uint64_and_change_exclusion(self):
        self.scan.add(item(1, fee=str(2**64 - 1)))
        self.scan.add(item(2, fee=str(2**64 - 1)))
        self.sync()
        summary = self.report()["summary"]
        self.assertEqual(summary["fee_raw"], str(2 * (2**64 - 1)))
        self.assertEqual(summary["transfer_raw"], "14")
        self.assertEqual(summary["native_senders"], 1)
        self.assertEqual(summary["native_receivers"], 2)

    def test_unknown_reward_input_is_retained_as_unknown(self):
        self.scan.add(item(1), inputs=[io(None, None, None)])
        self.sync()
        report = self.report()
        self.assertIsNone(report["summary"]["transfer_raw"])
        self.assertEqual(report["summary"]["known_transfer_raw"], "0")
        self.assertEqual(report["summary"]["unknown_native_inputs"], 1)
        self.assertFalse(report["coverage"]["addresses_complete"])

    def test_missing_fee_and_missing_evm_facts_are_not_zero(self):
        self.scan.add(item(1, op="evm_call", fee=None))
        self.sync()
        summary = self.report()["summary"]
        self.assertIsNone(summary["fee_raw"])
        self.assertFalse(summary["fees_complete"])
        self.assertEqual(summary["evm_receipts_missing"], 1)
        self.assertIsNone(summary["gas_used"])
        self.assertEqual(summary["known_gas_used"], "0")
        self.assertEqual(summary["active_evm_addresses"], 0)

    def test_validator_role_identifier_is_not_a_native_wallet(self):
        self.scan.add(item(1, op="delegate"), record={"validator": "f" * 128,
            "delegator": NATIVE_A, "destination": None})
        self.sync()
        self.assertEqual(self.report()["summary"]["active_native_addresses"], 2)

    def test_network_failure_does_not_commit_partial_block(self):
        self.scan.add(item(1))
        self.scan.add(item(1, index=1))
        def broken(endpoint):
            if endpoint == "tx/1:1":
                raise OSError("test request failed")
        self.scan.hook = broken
        result = self.sync()
        self.assertEqual(result["status"], "error")
        self.assertIsNone(result["coverage"]["indexed_to_height"])
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM index_items").fetchone()[0], 0)
        self.scan.hook = None
        self.assertEqual(self.sync()["coverage"]["indexed_to_height"], 5)

    def test_bad_details_identity_refused(self):
        self.scan.add(item(1))
        self.scan.details[(1, 0)]["tx"]["fee"] = "50"
        result = self.sync()
        self.assertEqual(result["status"], "error")
        self.assertEqual(result["blocks_added"], 0)

    def test_chain_mismatch_preserves_index(self):
        self.sync(max_blocks=1)
        self.scan.chain = "f" * 64
        result = self.sync()
        self.assertEqual(result["status"], "error")
        self.assertEqual(result["coverage"]["indexed_to_height"], 1)
        result = sync_index(self.db, self.scan.read, "a" * 64, 5)
        self.assertEqual(result["status"], "error")
        self.assertEqual(result["coverage"]["indexed_to_height"], 1)

    def test_contiguous_links_and_immutable_anchor(self):
        self.sync(max_blocks=1)
        self.scan.headers[2]["prev_id"] = "f" * 128
        self.assertEqual(self.sync()["status"], "error")
        self.assertEqual(self.report()["coverage"]["indexed_to_height"], 1)
        self.scan.headers[1]["block_id"] = "f" * 128
        result = self.sync()
        self.assertIn("changed an indexed", result["error"])

    def test_recent_first_backfill_contiguous_and_first_seen_moves(self):
        self.scan.add(item(1))
        self.scan.add(item(4))
        result = self.sync(start_height=4, max_blocks=2, backfill_blocks=0)
        self.assertEqual((result["coverage"]["indexed_from_height"], result["coverage"]["indexed_to_height"]), (4, 5))
        self.assertFalse(result["coverage"]["complete_from_genesis"])
        self.assertFalse(self.report()["coverage"]["range_complete"])
        self.assertEqual(self.db.execute("SELECT time_ms FROM index_first_seen WHERE space='native' AND address=?", (NATIVE_A,)).fetchone()[0], BASE + 240_000)
        result = self.sync(backfill_blocks=3)
        self.assertEqual(result["blocks_added"], 3)
        self.assertTrue(result["coverage"]["complete_from_genesis"])
        self.assertEqual(self.db.execute("SELECT time_ms FROM index_first_seen WHERE space='native' AND address=?", (NATIVE_A,)).fetchone()[0], BASE + 60_000)
        self.assertEqual(self.report()["summary"]["first_seen_native_addresses"], 2)

    def test_recent_backfill_rejects_wrong_predecessor(self):
        self.sync(start_height=4)
        self.scan.headers[3]["block_id"] = "f" * 128
        result = self.sync(backfill_blocks=2)
        self.assertEqual(result["status"], "error")
        self.assertEqual(result["coverage"]["indexed_from_height"], 4)

    def test_pagination_and_no_duplicate_reimport(self):
        for index in range(101):
            self.scan.add(item(1, index=index, code=8))
        self.assertEqual(self.sync()["status"], "ok")
        self.assertIn("block/1?from=100&limit=100", self.scan.requests)
        before = self.report()["summary"]
        self.scan.requests.clear()
        self.assertEqual(self.sync()["blocks_added"], 0)
        self.assertEqual(self.report()["summary"], before)
        self.assertEqual(len(self.scan.requests), 2)  # stats + immutable anchor

    def test_page_header_mutation_is_atomic(self):
        for index in range(101):
            self.scan.add(item(1, index=index, code=8))
        def mutate(endpoint):
            if endpoint == "block/1?from=100&limit=100":
                header = {**self.scan.headers[1], "block_id": "f" * 128}
                return {"block": header, "items": self.scan.items[1][100:], "next_from": None}
        self.scan.hook = mutate
        result = self.sync()
        self.assertEqual(result["status"], "error")
        self.assertIn("header changed", result["error"])
        self.assertEqual(result["blocks_added"], 0)

    def test_global_root_mutation_is_not_ignored(self):
        self.sync()
        self.scan.headers[5]["global_root"] = "f" * 128
        self.assertEqual(self.sync()["status"], "error")

    def test_truncated_page_and_wrong_applied_count_rejected(self):
        self.scan.headers[1]["n_items"] = 1
        self.assertEqual(self.sync()["status"], "error")
        self.scan.headers[1]["n_items"] = 0
        self.scan.headers[1]["applied_count"] = 1
        self.assertEqual(self.sync()["status"], "error")

    def test_deadline_and_request_budgets(self):
        result = self.sync(deadline=time.monotonic() - 1)
        self.assertEqual(result["status"], "budget")
        self.assertEqual(len(self.scan.requests), 0)
        result = self.sync(max_requests=2)
        self.assertEqual(result["status"], "budget")
        self.assertEqual(result["blocks_added"], 1)
        self.assertEqual(result["coverage"]["indexed_to_height"], 1)

    def test_busy_block_resumes_without_partial_watermark_or_repeated_details(self):
        self.scan = Scan(1)
        for index in range(5):
            self.scan.add(item(1, index=index))
        first = self.sync(max_requests=4)
        self.assertEqual(first["status"], "budget")
        self.assertEqual(first["blocks_added"], 0)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM index_pending").fetchone()[0], 3)
        second = self.sync(max_requests=4)
        self.assertEqual(second["blocks_added"], 0)
        third = self.sync(max_requests=4)
        self.assertEqual(third["status"], "ok")
        self.assertEqual(third["blocks_added"], 1)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM index_pending").fetchone()[0], 0)
        self.assertEqual(self.scan.requests.count("tx/1:0"), 1)
        self.assertEqual(self.scan.requests.count("tx/1:4"), 1)
        self.assertEqual(self.report()["summary"]["transactions"], 5)

    def test_resumed_cache_is_bound_to_fresh_block_identity(self):
        self.scan = Scan(1)
        self.scan.add(item(1))
        self.scan.add(item(1, index=1))
        self.sync(max_requests=3)
        self.scan.headers[1]["block_id"] = "f" * 128
        self.assertEqual(self.sync()["status"], "ok")
        self.assertEqual(self.scan.requests.count("tx/1:0"), 2)

    def test_advancing_initial_seed_does_not_abandon_busy_first_block(self):
        self.scan = Scan(1)
        for index in range(5):
            self.scan.add(item(1, index=index))
        self.assertEqual(self.sync(start_height=1, max_requests=4)["blocks_added"], 0)
        expanded = Scan(3)
        self.scan.headers[2] = expanded.headers[2]
        self.scan.items[2] = []
        self.assertEqual(self.sync(start_height=2, max_requests=4)["blocks_added"], 0)
        self.assertEqual(self.db.execute("SELECT MIN(height),MAX(height) FROM index_pending").fetchone()[0], 1)
        self.scan.headers[3] = expanded.headers[3]
        self.scan.items[3] = []
        self.sync(start_height=3, max_requests=4)
        self.assertIsNotNone(self.db.execute("SELECT height FROM index_blocks WHERE height=1").fetchone())
        self.assertEqual(self.scan.requests.count("tx/1:0"), 1)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM index_pending WHERE height=1").fetchone()[0], 0)

    def test_sql_write_fault_rolls_back_whole_block(self):
        self.scan.add(item(1))
        self.db.execute("CREATE TRIGGER reject_item BEFORE INSERT ON index_items BEGIN SELECT RAISE(ABORT,'test fault'); END")
        result = self.sync()
        self.assertEqual(result["status"], "error")
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM index_blocks").fetchone()[0], 0)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM index_first_seen").fetchone()[0], 0)

    def test_missing_index_and_outside_coverage_are_unknown(self):
        self.assertIsNone(self.report()["summary"]["transactions"])
        self.sync()
        later = activity_report(self.db, "24h", BASE + 3 * 86400_000)
        self.assertIsNone(later["summary"]["transactions"])
        self.assertEqual(later["activity"], [])

    def test_read_only_report_and_invalid_range(self):
        self.sync()
        self.db.execute("PRAGMA query_only=ON")
        self.assertEqual(self.report()["summary"]["blocks"], 5)
        with self.assertRaises(ValueError):
            self.report("invalid")

    def test_source_tip_regression_preserves_prior_coverage(self):
        self.sync()
        def backwards(endpoint):
            if endpoint == "stats":
                return {"chain_id": SCAN_CHAIN_ID, "indexed_height": 3}
        self.scan.hook = backwards
        result = self.sync()
        self.assertEqual(result["status"], "error")
        self.assertEqual(result["coverage"]["tip_height"], 5)

    def test_scan_index_lag_is_not_complete_chain_coverage(self):
        def lagged(endpoint):
            if endpoint == "stats":
                return {"chain_id": SCAN_CHAIN_ID, "indexed_height": 5, "tip_height": 500}
        self.scan.hook = lagged
        result = self.sync()
        self.assertEqual(result["coverage"]["indexed_to_height"], 5)
        self.assertEqual(result["coverage"]["tip_height"], 500)
        self.assertEqual(result["coverage"]["source_indexed_height"], 5)
        self.assertFalse(result["caught_up"])
        self.assertFalse(self.report()["coverage"]["range_complete"])


if __name__ == "__main__":
    unittest.main()
