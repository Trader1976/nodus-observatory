"""Regression: several days of real-shaped history must not vanish at 7d.

One hundred thousand blocks and two address touches per spend exceed the old
20-million-instruction budget. Tiny fixtures do not exercise that failure.
All amounts remain exact and a short history stays available but incomplete.
"""
from datetime import datetime, timezone, timedelta
from pathlib import Path
import sqlite3
import tempfile
import time
import unittest
from unittest.mock import patch

from network_statistics import RANGES, SCAN_CHAIN_ID
from network_statistics.api import report, export_csv
from network_statistics.indexer import init_index
from network_statistics.store import reader, writer, save_observation


class ReportRangeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.path = Path(cls.temp.name) / "statistics.sqlite3"
        cls.now_ms = int(time.time() * 1000)
        cls.count = 100_000
        cls.fee = 9_007_199_254_740_993
        start = cls.now_ms - cls.count * 5000
        db = writer(cls.path)
        init_index(db)
        # Start above genesis: even the complete stored range is not all-chain
        # history. The blocks span less than six days, with a stable wallet set.
        db.executemany("INSERT INTO index_blocks VALUES (?,?,?,?,?,?,?,?)",
                       ((i + 50_000, str(i), str(i - 1), "root", start + i * 5000,
                         "proposer", 1, 1) for i in range(1, cls.count + 1)))
        db.executemany("INSERT INTO index_items VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                       ((i + 50_000, 0, start + i * 5000, "envelope", "spend", 0,
                         str(cls.fee), 0, "7", None, None, None, None, None)
                        for i in range(1, cls.count + 1)))
        db.executemany("INSERT INTO index_touches VALUES (?,?,?,?,?,?)",
                       ((i + 50_000, 0, start + i * 5000, "native", "wallet-" + str((i + j) % 8), role)
                        for i in range(1, cls.count + 1)
                        for j, role in ((0, "sender"), (1, "receiver"))))
        db.executemany("INSERT INTO index_first_seen VALUES (?,?,?)",
                       (("native", "wallet-" + str(i), start + 5000) for i in range(8)))
        db.executemany("INSERT INTO index_meta VALUES (?,?)",
                       (("chain_id", SCAN_CHAIN_ID), ("tip_height", str(cls.count + 50_000)),
                        ("source_indexed_height", str(cls.count + 50_000))))
        for days in (2, 0):
            stamp = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat(timespec="seconds")
            save_observation(db, {"timestamp": stamp, "chain_id": SCAN_CHAIN_ID,
                                 "stats": {"tip_height": cls.count + 50_000},
                                 "committee": {"height": cls.count + 50_000, "count": 8}, "nodes": []})
        db.commit()
        db.close()

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_all_ranges_keep_partial_history_and_exact_totals(self):
        with patch("network_statistics.indexer.time.time", return_value=self.now_ms / 1000):
            for key in RANGES:
                with self.subTest(range=key):
                    data = report(self.path, key)
                    self.assertTrue(data["available"], data.get("reason"))
                    self.assertFalse(data["stale"])
                    self.assertEqual(data["summary"]["active_validators"], 8)
                    self.assertEqual(data["summary"]["active_native_addresses"], 8,
                                     "wallets repeated across buckets count only once")
                    self.assertEqual(data["summary"]["tx_24h"], 17_281)
                    count = 17_281 if key == "24h" else self.count
                    self.assertEqual(data["summary"]["transactions"], count)
                    self.assertEqual(data["summary"]["fee_raw"], str(count * self.fee))
                    self.assertEqual(sum(p["transactions"] for p in data["series"]["activity"]), count)
                    self.assertTrue(data["series"]["network"])
                    self.assertEqual(data["coverage"]["range_complete"], key == "24h")
                    self.assertFalse(data["coverage"]["complete_from_genesis"])
                    self.assertTrue(data["coverage"]["caught_up"])
                    self.assertTrue(all(p["blocks"] > 0 for p in data["series"]["activity"]),
                                    "missing days are not filled with fake zero buckets")

    def test_long_range_csv_uses_the_same_available_report(self):
        with patch("network_statistics.indexer.time.time", return_value=self.now_ms / 1000):
            csv = export_csv(self.path, "all")
        self.assertIn("range_complete", csv)
        self.assertIn("testnet," + SCAN_CHAIN_ID + ",all,", csv)
        self.assertGreater(len(csv.splitlines()), 1)

    def test_reader_still_enforces_operation_time_and_readonly_limits(self):
        sql = "WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM n WHERE x<10000) SELECT SUM(x) FROM n"
        for options in ({"max_operations": 1000}, {"seconds": -1}):
            with self.subTest(options=options):
                db = reader(self.path, **options)
                try:
                    with self.assertRaisesRegex(sqlite3.OperationalError, "interrupted"):
                        db.execute(sql).fetchone()
                finally:
                    db.close()
        db = reader(self.path)
        try:
            with self.assertRaisesRegex(sqlite3.OperationalError, "readonly"):
                db.execute("DELETE FROM index_blocks")
        finally:
            db.close()


if __name__ == "__main__":
    unittest.main()
