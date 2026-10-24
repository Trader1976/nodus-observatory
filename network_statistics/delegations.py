"""Bounded read of committed HF-6 validator/delegation state; no wallet RPCs."""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
from pathlib import Path
import re
import sqlite3
import time

from . import SCAN_CHAIN_ID

MAX_VALIDATORS = 256
MAX_DELEGATIONS = 16_384
MAX_VM_OPERATIONS = 750_000
READ_SECONDS = 1.5
STATUSES = {0: "active", 1: "retiring", 2: "unstaked", 3: "auto_retired", 4: "eligible"}


def _uint(value, minimum=0, maximum=(1 << 63) - 1):
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError("Invalid committed delegation integer")
    return value


def _blob(value, size=64):
    if not isinstance(value, bytes) or len(value) != size:
        raise ValueError("Invalid committed delegation identity")
    return value


def _schema(db, table, columns):
    # Names are internal constants, never supplied by a request.
    actual = {row[1]: row[2].upper() for row in db.execute('PRAGMA table_info("%s")' % table)}
    if any(actual.get(key) != kind for key, kind in columns.items()):
        raise ValueError("Unsupported committed delegation schema: " + table)


def read_delegations(config, snapshot, anchor=None):
    """Return one local-chain snapshot or raise; a failure is never a zero.

    HF-6 revalues historical SQL key columns: validators.pubkey_hash and
    delegations.validator_hash are validator_id; delegator_hash is the
    delegator wallet fingerprint. Consensus-key SHA3-512 identifies the
    P2P node, not validator_id. Existing owner-gated delegation RPCs are
    deliberately not called.
    """
    chain = snapshot.get("chain", {}).get("chain_id")
    if chain != SCAN_CHAIN_ID:
        raise ValueError("Local delegation chain is not supported")
    path = Path(config.get("rewards_source_db", ""))
    if not path.is_absolute() or path.name != "witness_" + chain[:32] + ".db":
        raise ValueError("Delegation database filename differs from the observed chain")
    path = path.resolve(strict=True)
    db = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=0.1)
    db.row_factory = sqlite3.Row
    try:
        db.execute("PRAGMA query_only=ON")
        db.execute("PRAGMA trusted_schema=OFF")
        deadline, operations = time.monotonic() + READ_SECONDS, [0]
        def progress():
            operations[0] += 1000
            return int(operations[0] > MAX_VM_OPERATIONS or time.monotonic() > deadline)
        db.set_progress_handler(progress, 1000)
        db.execute("BEGIN")
        _schema(db, "v2_blocks", {"global_height": "INTEGER", "block_id": "BLOB"})
        _schema(db, "validators", {"pubkey_hash": "BLOB", "pubkey": "BLOB", "self_stake": "INTEGER",
                "total_delegated": "INTEGER", "external_delegated": "INTEGER", "commission_bps": "INTEGER",
                "status": "INTEGER"})
        _schema(db, "v2_validator_roles", {"validator_id": "BLOB", "owner_fp": "BLOB"})
        _schema(db, "delegations", {"delegator_hash": "BLOB", "validator_hash": "BLOB",
                "amount": "INTEGER", "delegated_at_block": "INTEGER"})
        tip = db.execute("SELECT global_height FROM v2_blocks ORDER BY global_height DESC LIMIT 1").fetchone()
        if tip is None:
            raise ValueError("Local delegation chain has no committed block")
        tip = _uint(tip[0], 1)
        observed = snapshot.get("chain", {}).get("height")
        if type(observed) is not int or tip < observed:
            raise ValueError("Delegation source trails the observed local node")
        anchor_verified = False
        if anchor is not None:
            height, block_id = anchor
            expected = bytes.fromhex(block_id) if isinstance(block_id, str) and re.fullmatch(r"[0-9a-f]{128}", block_id) else None
            if expected is None or _uint(height, 1) > tip:
                raise ValueError("Invalid common-height delegation anchor")
            row = db.execute("SELECT block_id FROM v2_blocks WHERE global_height=?", (height,)).fetchone()
            if row is None or row[0] != expected:
                raise ValueError("Delegation source block differs from Scan")
            anchor_verified = True

        rows = db.execute("SELECT v.pubkey_hash,v.pubkey,v.self_stake,v.total_delegated,"
                          "v.external_delegated,v.commission_bps,v.status,r.validator_id,r.owner_fp "
                          "FROM validators v LEFT JOIN v2_validator_roles r ON r.validator_id=v.pubkey_hash "
                          "ORDER BY v.pubkey_hash LIMIT ?", (MAX_VALIDATORS + 1,)).fetchall()
        if len(rows) > MAX_VALIDATORS:
            raise ValueError("Delegation validator bound exceeded")
        if db.execute("SELECT r.validator_id FROM v2_validator_roles r LEFT JOIN validators v "
                      "ON v.pubkey_hash=r.validator_id WHERE v.pubkey_hash IS NULL LIMIT 1").fetchone() is not None:
            raise ValueError("Delegation registry has an orphan validator role")
        validators, ids = {}, {}
        for row in rows:
            key, validator_id, owner = _blob(row["pubkey_hash"]), _blob(row["validator_id"]), _blob(row["owner_fp"])
            if key != validator_id or not any(key) or not any(owner):
                raise ValueError("Delegation registry identity mismatch")
            public_key = _blob(row["pubkey"], 2592)
            fingerprint = hashlib.sha3_512(public_key).hexdigest()
            node_id = fingerprint[:64]
            if node_id in validators or key in ids:
                raise ValueError("Ambiguous delegation consensus identity")
            stake = _uint(row["self_stake"])
            delegated, source_external = _uint(row["total_delegated"]), _uint(row["external_delegated"])
            # Since W-B this legacy-named counter includes owner delegations.
            if delegated != source_external:
                raise ValueError("Delegation registry totals disagree")
            status = _uint(row["status"], 0, 4)
            record = {"validator_id": key.hex(), "owner_fp": owner.hex(),
                      "consensus_fingerprint": fingerprint, "self_stake_raw": str(stake),
                      "delegated_raw": str(delegated), "owner_delegated_raw": "0", "external_delegated_raw": "0",
                      "total_stake_raw": str(stake + delegated), "delegator_count": 0,
                      "commission_bps": _uint(row["commission_bps"], 0, 5000),
                      "status": STATUSES[status], "delegations": []}
            validators[node_id], ids[key] = record, record

        rows = db.execute("SELECT delegator_hash,validator_hash,amount,delegated_at_block FROM delegations "
                          "ORDER BY delegator_hash,validator_hash LIMIT ?", (MAX_DELEGATIONS + 1,)).fetchall()
        if len(rows) > MAX_DELEGATIONS:
            raise ValueError("Delegation row bound exceeded")
        seen = set()
        for row in rows:
            owner, validator = _blob(row["delegator_hash"]), _blob(row["validator_hash"])
            amount = _uint(row["amount"], 1)
            if _uint(row["delegated_at_block"]) > tip:
                raise ValueError("Delegation is newer than source snapshot")
            if not any(owner) or validator not in ids or (owner, validator) in seen:
                raise ValueError("Orphan or duplicate committed delegation")
            seen.add((owner, validator))
            record = ids[validator]
            record["delegations"].append({"owner_fp": owner.hex(), "amount_raw": str(amount),
                                            "is_owner": owner.hex() == record["owner_fp"]})

        for record in validators.values():
            entries = record["delegations"]
            if len(entries) > 2048:
                raise ValueError("Per-validator delegation bound exceeded")
            total = sum(int(row["amount_raw"]) for row in entries)
            if total != int(record["delegated_raw"]):
                raise ValueError("Committed delegation rows differ from validator total")
            owner_total = sum(int(row["amount_raw"]) for row in entries if row["is_owner"])
            record.update(owner_delegated_raw=str(owner_total), external_delegated_raw=str(total - owner_total),
                          delegator_count=len(entries))
            entries.sort(key=lambda row: (-int(row["amount_raw"]), row["owner_fp"]))
        if time.monotonic() > deadline:
            raise TimeoutError("Delegation read budget exceeded")
        return {"available": True, "at_height": tip, "observed_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "source": "local_committed_delegations", "validators": validators, "truncated": False,
                "anchor_verified": anchor_verified, "anchor_height": anchor[0] if anchor else None}
    finally:
        db.close()
