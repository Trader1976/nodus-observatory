import csv
from datetime import datetime, timezone
import importlib.util
import io
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("rewards", Path(__file__).with_name("rewards.py"))
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)

CHAIN = "a" * 64
OWNER = "b" * 128
NODE = "c" * 128


class RewardLedgerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name)
        self.live = self.base / ("witness_" + CHAIN[:32] + ".db")
        self.ledger = self.base / "reporting.sqlite3"
        db = sqlite3.connect(self.live)
        db.executescript("""
          CREATE TABLE v2_blocks(global_height INTEGER PRIMARY KEY, block_id BLOB);
          INSERT INTO v2_blocks VALUES(1000, zeroblob(64));
          CREATE TABLE v2_reward_accrual(owner_fp BLOB PRIMARY KEY,amount INTEGER NOT NULL);
          CREATE TABLE addr_history(h INTEGER,i INTEGER,seq INTEGER,owner BLOB,
            kind TEXT,amount INTEGER,token BLOB,ts INTEGER,PRIMARY KEY(h,i,seq));
          CREATE INDEX idx_addr_history_owner ON addr_history(owner,h,i,seq);
          CREATE TABLE addr_history_mark(id INTEGER PRIMARY KEY,from_height INTEGER,last_height INTEGER);
          INSERT INTO addr_history_mark VALUES(1,1,1000);
        """)
        db.commit()
        db.close()

    def tearDown(self):
        self.tmp.cleanup()

    def add(self, height, seq, amount, kind="payout", ts=None, owner=OWNER, pos=r.BOUNDARY, token=r.NATIVE):
        if ts is None:
            ts = int(datetime(2026, 10, 18, tzinfo=timezone.utc).timestamp())
        with sqlite3.connect(self.live) as db:
            db.execute("INSERT INTO addr_history VALUES (?,?,?,?,?,?,?,?)",
                       (height, pos, seq, bytes.fromhex(owner), kind, amount, token, ts))

    def collect(self, **kwargs):
        return r.collect_rewards(self.live, self.ledger, CHAIN, OWNER, NODE, **kwargs)

    def test_exact_large_amount_dedupe_and_stake_release_separation(self):
        # Above JS Number's 2**53 limit but within Nodus' int64 storage.
        amount = 9_007_199_254_740_993
        self.add(720, 2, amount)
        self.add(720, 3, 5, "release")
        self.add(720, 4, 123, owner="d" * 128)
        self.assertEqual(self.collect()["status"], "ok")
        self.assertEqual(self.collect()["rows"], 2)
        report = r.report(self.ledger, 2026)
        self.assertEqual(report["summary"]["payout_count"], 1)
        self.assertEqual(report["summary"]["paid_raw"], str(amount))
        self.assertEqual(report["summary"]["paid_nodus"], "90071992.54740993")
        self.assertEqual(report["summary"]["released_raw"], "5")
        self.assertEqual(report["summary"]["eur_total"], None)
        self.assertEqual(report["summary"]["unvalued_count"], 1)
        self.assertEqual(report["scope"], "owner_aggregate")
        self.assertFalse(report["source"]["complete_year"])
        with sqlite3.connect(self.ledger) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM reward_events").fetchone()[0], 2)

    def test_no_history_is_unavailable_not_zero_and_pending_separate(self):
        with sqlite3.connect(self.live) as db:
            db.execute("DELETE FROM addr_history_mark")
            db.execute("INSERT INTO v2_reward_accrual VALUES (?,?)", (bytes.fromhex(OWNER), 123456789))
        self.assertEqual(self.collect()["status"], "unavailable")
        report = r.report(self.ledger, 2026)
        self.assertIsNone(report["summary"]["paid_raw"])
        self.assertEqual(report["summary"]["pending_nodus"], "1.23456789")
        self.assertEqual(report["items"], [])
        rows = list(csv.DictReader(io.StringIO(r.export_csv(self.ledger, 2026).decode("utf-8-sig"))))
        self.assertEqual(rows[0]["kind"], "coverage_metadata")
        self.assertEqual(rows[0]["amount_raw"], "")

    def test_helsinki_year_boundary_and_dst_offsets(self):
        # 2025 UTC but already 2026 in Helsinki.
        newyear = int(datetime(2025, 12, 31, 22, 30, tzinfo=timezone.utc).timestamp())
        self.add(100, 0, 1, ts=newyear)
        self.add(101, 0, 2, ts=int(datetime(2026, 3, 29, 0, 30, tzinfo=timezone.utc).timestamp()))
        self.add(102, 0, 3, ts=int(datetime(2026, 3, 29, 1, 30, tzinfo=timezone.utc).timestamp()))
        self.collect()
        report = r.report(self.ledger, 2026)
        self.assertEqual(report["summary"]["paid_raw"], "6")
        self.assertEqual(r.report(self.ledger, 2025)["summary"]["paid_raw"], "0")
        rows = sorted(report["items"], key=lambda x: x["height"])
        self.assertTrue(rows[0]["block_time_local"].startswith("2026-01-01"))
        self.assertTrue(rows[1]["block_time_local"].endswith("+02:00"))
        self.assertTrue(rows[2]["block_time_local"].endswith("+03:00"))

    def test_coverage_gap_preserves_observed_events_without_claiming_complete_year(self):
        self.add(100, 0, 11)
        self.collect()
        with sqlite3.connect(self.live) as db:
            db.execute("UPDATE addr_history_mark SET from_height=900,last_height=1000")
        self.add(950, 0, 22)
        self.collect()
        report = r.report(self.ledger, 2026)
        self.assertEqual(report["summary"]["paid_raw"], "33")
        self.assertEqual(len(report["source"]["runs"]), 2)
        self.assertFalse(report["source"]["complete_year"])
        exported = list(csv.DictReader(io.StringIO(r.export_csv(self.ledger, 2026).decode('utf-8-sig'))))
        evidence = {int(row['height']): row for row in exported}
        self.assertEqual(evidence[100]['source_from_height'], '1')
        self.assertEqual(evidence[950]['source_from_height'], '900')
        self.assertEqual(len(json.loads(evidence[100]['source_coverage_runs'])), 2)

    def test_bad_source_is_atomic_and_does_not_modify_live_database(self):
        self.add(100, 0, 100)
        self.collect()
        before = self.live.read_bytes()
        self.assertEqual(self.collect()["status"], "ok")
        self.assertEqual(before, self.live.read_bytes())
        with sqlite3.connect(self.live) as db:
            db.execute("UPDATE addr_history SET amount=200 WHERE h=100")
        with self.assertRaisesRegex(ValueError, "changed"):
            self.collect()
        self.assertEqual(r.report(self.ledger, 2026)["summary"]["paid_raw"], "100")

    def test_malformed_native_row_and_limit_fail_without_false_partial_totals(self):
        self.add(100, 0, 1)
        self.add(200, 0, 2)
        result = self.collect(max_rows=1)
        self.assertEqual(result["status"], "error")
        self.assertIsNone(r.report(self.ledger, 2026)["summary"]["paid_raw"])
        with sqlite3.connect(self.live) as db:
            db.execute("UPDATE addr_history SET amount='1.5' WHERE h=200")
        self.assertEqual(self.collect()["status"], "error")

    def test_pending_absent_valid_row_is_zero_but_not_paid(self):
        self.collect()
        report = r.report(self.ledger, 2026)
        self.assertEqual(report["summary"]["pending_raw"], "0")
        self.assertEqual(report["summary"]["paid_raw"], "0")

    def test_admin_valuation_exact_math_audit_and_csv_safety(self):
        self.add(100, 0, 123456789)
        self.add(200, 0, 9)
        self.collect()
        eid = next(e["event_id"] for e in r.report(self.ledger, 2026)["items"] if e["height"] == 100)
        path = self.base / "valuations.json"
        data = {"schema_version": 1, "valuations": [{"event_id": eid, "price_eur": "0.123456789",
            "source": "=DANGEROUS()", "valuation_at": "2026-10-18T03:00:00Z", "note": "evidence"}]}
        path.write_text(json.dumps(data))
        self.assertEqual(r.import_valuations(self.ledger, path), 1)
        report = r.report(self.ledger, 2026)
        self.assertEqual(report["summary"]["eur_total"], "0.15241578750190521")
        self.assertFalse(report["summary"]["eur_complete"])
        self.assertEqual(report["summary"]["unvalued_count"], 1)
        csv_rows = list(csv.DictReader(io.StringIO(r.export_csv(self.ledger, 2026).decode("utf-8-sig"))))
        self.assertTrue(next(x for x in csv_rows if x["event_id"] == eid)["valuation_source"].startswith("'="))
        data["valuations"][0]["price_eur"] = "0.2"
        path.write_text(json.dumps(data))
        r.import_valuations(self.ledger, path)
        with sqlite3.connect(self.ledger) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM reward_valuation_audit").fetchone()[0], 2)

    def test_float_valuation_and_naive_time_rejected(self):
        self.add(100, 0, 1)
        self.collect()
        eid = r.report(self.ledger, 2026)["items"][0]["event_id"]
        path = self.base / "values.json"
        value = {"event_id": eid, "price_eur": 0.1, "source": "evidence", "valuation_at": "2026-10-18T03:00:00Z"}
        path.write_text(json.dumps({"schema_version": 1, "valuations": [value]}))
        with self.assertRaises(ValueError):
            r.import_valuations(self.ledger, path)
        value.update(price_eur="0.1", valuation_at="2026-10-18T03:00:00")
        path.write_text(json.dumps({"schema_version": 1, "valuations": [value]}))
        with self.assertRaises(ValueError):
            r.import_valuations(self.ledger, path)

    def test_invalid_year_and_missing_ledger(self):
        with self.assertRaises(ValueError):
            r.report(self.ledger, 10000)
        result = r.report(self.base / "absent.sqlite3", 2026)
        self.assertEqual(result["source"]["status"], "unavailable")
        self.assertIsNone(result["summary"]["paid_nodus"])


if __name__ == "__main__":
    unittest.main()
