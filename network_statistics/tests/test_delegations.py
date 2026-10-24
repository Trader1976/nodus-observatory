"""Synthetic HF-6 committed state: exact totals, identity joins and read bounds."""
import hashlib
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from network_statistics import SCAN_CHAIN_ID
from network_statistics import delegations


class DelegationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / ("witness_" + SCAN_CHAIN_ID[:32] + ".db")
        self.db = sqlite3.connect(self.path)
        self.db.executescript("""
            CREATE TABLE v2_blocks(global_height INTEGER PRIMARY KEY, block_id BLOB);
            CREATE TABLE validators(pubkey_hash BLOB PRIMARY KEY, pubkey BLOB, self_stake INTEGER,
              total_delegated INTEGER, external_delegated INTEGER, commission_bps INTEGER, status INTEGER);
            CREATE TABLE v2_validator_roles(validator_id BLOB PRIMARY KEY, owner_fp BLOB);
            CREATE TABLE delegations(delegator_hash BLOB,validator_hash BLOB, amount INTEGER,
              delegated_at_block INTEGER,PRIMARY KEY(delegator_hash,validator_hash));
            CREATE INDEX idx_validator ON delegations(validator_hash);
        """)
        self.db.execute("INSERT INTO v2_blocks VALUES(10,?)", (b"a" * 64,))
        self.key, self.owner, self.public_key = b"v" * 64, b"o" * 64, b"p" * 2592
        self.owner_amount, self.other_amount = 9_007_199_254_740_993, 200_000_001
        total = self.owner_amount + self.other_amount
        self.db.execute("INSERT INTO validators VALUES(?,?,?,?,?,?,?)",
                        (self.key, self.public_key, 200_000_000, total, total, 500, 0))
        self.db.execute("INSERT INTO v2_validator_roles VALUES(?,?)", (self.key, self.owner))
        self.db.executemany("INSERT INTO delegations VALUES(?,?,?,?)",
                            [(self.owner, self.key, self.owner_amount, 5),
                             (b"e" * 64, self.key, self.other_amount, 7)])
        self.db.commit()
        self.config = {"rewards_source_db": str(self.path)}
        self.snapshot = {"chain": {"chain_id": SCAN_CHAIN_ID, "height": 10}}

    def tearDown(self):
        self.db.close()
        self.temp.cleanup()

    def read(self, **options):
        return delegations.read_delegations(self.config, self.snapshot, **options)

    def test_exact_totals_self_delegation_and_consensus_key_identity(self):
        before = self.path.read_bytes()
        result = self.read(anchor=(10, (b"a" * 64).hex()))
        self.assertTrue(result["available"])
        self.assertTrue(result["anchor_verified"])
        self.assertFalse(result["truncated"])
        self.assertEqual(result["at_height"], 10)
        fingerprint = hashlib.sha3_512(self.public_key).hexdigest()
        self.assertNotEqual(fingerprint[:64], self.key.hex()[:64])
        record = result["validators"][fingerprint[:64]]
        self.assertEqual(record["validator_id"], self.key.hex())
        self.assertEqual(record["consensus_fingerprint"], fingerprint)
        self.assertEqual(record["owner_fp"], self.owner.hex())
        self.assertEqual(record["owner_delegated_raw"], str(self.owner_amount))
        self.assertEqual(record["external_delegated_raw"], str(self.other_amount))
        self.assertEqual(record["delegated_raw"], str(self.owner_amount + self.other_amount))
        self.assertEqual(record["total_stake_raw"], str(200_000_000 + self.owner_amount + self.other_amount))
        self.assertEqual(record["delegator_count"], 2)
        self.assertTrue(record["delegations"][0]["is_owner"])
        self.assertEqual(self.path.read_bytes(), before, "source chain DB must not be modified")

    def test_statuses_and_supported_empty_registry_are_real_zero(self):
        for status, name in delegations.STATUSES.items():
            self.db.execute("UPDATE validators SET status=?", (status,))
            self.db.commit()
            self.assertEqual(next(iter(self.read()["validators"].values()))["status"], name)
        self.db.executescript("DELETE FROM delegations; DELETE FROM validators; DELETE FROM v2_validator_roles;")
        self.db.commit()
        self.assertEqual(self.read()["validators"], {})

    def test_chain_filename_source_height_and_anchor_mismatch_refused(self):
        for snapshot in ({"chain": {"chain_id": "b" * 64, "height": 10}},
                         {"chain": {"chain_id": SCAN_CHAIN_ID, "height": 11}}):
            with self.assertRaises(ValueError):
                delegations.read_delegations(self.config, snapshot)
        with self.assertRaises(ValueError):
            delegations.read_delegations({"rewards_source_db": str(self.path.with_name("other.db"))}, self.snapshot)
        for anchor in ((10, (b"b" * 64).hex()), (11, (b"a" * 64).hex()), (10, "bad")):
            with self.subTest(anchor=anchor), self.assertRaises(ValueError):
                self.read(anchor=anchor)

    def test_missing_roles_or_half_migrated_rows_never_use_legacy_hashes(self):
        self.db.execute("DELETE FROM v2_validator_roles")
        self.db.commit()
        with self.assertRaises(ValueError):
            self.read()
        self.db.execute("DELETE FROM validators")
        self.db.execute("DELETE FROM delegations")
        self.db.execute("INSERT INTO v2_validator_roles VALUES(?,?)", (self.key, self.owner))
        self.db.commit()
        with self.assertRaises(ValueError):
            self.read()
        self.db.execute("DROP TABLE v2_validator_roles")
        self.db.commit()
        with self.assertRaises(ValueError):
            self.read()

    def test_incomplete_or_mismatching_totals_never_become_partial_success(self):
        self.db.execute("UPDATE validators SET external_delegated=1")
        self.db.commit()
        with self.assertRaises(ValueError):
            self.read()
        self.db.execute("UPDATE validators SET external_delegated=total_delegated")
        self.db.execute("DELETE FROM delegations WHERE delegator_hash=?", (self.owner,))
        self.db.commit()
        with self.assertRaises(ValueError):
            self.read()

    def test_malformed_identity_amount_status_and_future_delegation_refused(self):
        mutations = [
            ("UPDATE delegations SET amount=0", ()),
            ("UPDATE delegations SET amount=-1", ()),
            ("UPDATE delegations SET delegator_hash=? WHERE delegator_hash=?", (b"short", self.owner)),
            ("UPDATE delegations SET delegated_at_block=11", ()),
            ("UPDATE validators SET status=5", ()),
            ("UPDATE validators SET pubkey=?", (b"short",)),
            ("UPDATE validators SET commission_bps=5001", ()),
        ]
        for statement, parameters in mutations:
            with self.subTest(statement=statement):
                self.db.execute("SAVEPOINT bad")
                self.db.execute(statement, parameters)
                # Separate reader sees committed state, so commit the candidate,
                # then restore the small fixture for the next case.
                self.db.execute("RELEASE bad")
                self.db.commit()
                with self.assertRaises(ValueError):
                    self.read()
                self.db.execute("UPDATE validators SET status=0,pubkey=?,commission_bps=500", (self.public_key,))
                self.db.execute("DELETE FROM delegations")
                self.db.executemany("INSERT INTO delegations VALUES(?,?,?,?)", [
                    (self.owner, self.key, self.owner_amount, 5), (b"e" * 64, self.key, self.other_amount, 7)])
                self.db.commit()

    def test_orphan_delegations_and_ambiguous_consensus_key_refused(self):
        self.db.execute("UPDATE delegations SET validator_hash=?", (b"z" * 64,))
        self.db.commit()
        with self.assertRaises(ValueError):
            self.read()
        self.db.execute("UPDATE delegations SET validator_hash=?", (self.key,))
        self.db.execute("INSERT INTO validators VALUES(?,?,?,?,?,?,?)", (b"q" * 64, self.public_key, 1, 0, 0, 500, 4))
        self.db.execute("INSERT INTO v2_validator_roles VALUES(?,?)", (b"q" * 64, self.owner))
        self.db.commit()
        with self.assertRaises(ValueError):
            self.read()

    def test_bounds_and_deadline_raise_instead_of_truncating(self):
        with patch.object(delegations, "MAX_VALIDATORS", 0), self.assertRaises(ValueError):
            self.read()
        with patch.object(delegations, "MAX_DELEGATIONS", 1), self.assertRaises(ValueError):
            self.read()
        with patch.object(delegations, "READ_SECONDS", -1), self.assertRaises((TimeoutError, sqlite3.OperationalError)):
            self.read()


if __name__ == "__main__":
    unittest.main()
