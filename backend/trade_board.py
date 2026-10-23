"""Bounded public P2P advertisements for one Observatory installation.

Listings and reservations are unverified public proposals, never evidence of
wallet ownership or funding. This module never signs or sends a transaction.
The HTTP host is responsible for its authenticated-origin and CSRF checks.
"""
from __future__ import annotations

from contextlib import contextmanager
import copy
import hashlib
import hmac
import json
from pathlib import Path
import re
import secrets
import sqlite3
import stat
import time


MAX_BYTES = 16_384
MAX_ACTIVE = 100
MAX_LIFETIME = 7 * 24 * 60 * 60
RESERVATION_SECONDS = 10 * 60
CLOCK_SKEW = 300
UINT256_MAX = (1 << 256) - 1
LISTING_FIELDS = {"schema", "id", "name", "side", "nodusAmount", "usdtAmount", "maker", "asset", "createdAt", "expiresAt"}


class BoardError(ValueError):
    def __init__(self, code, status=400, message=None):
        self.code, self.status = code, status
        super().__init__(message or code.replace("_", " "))


def _now():
    return int(time.time())


def _object(value, fields):
    if not isinstance(value, dict) or set(value) != set(fields):
        raise BoardError("invalid_schema")


def _hex(value, size, nonzero=True):
    if not isinstance(value, str) or not re.fullmatch(r"0x[0-9a-fA-F]{%d}" % (size * 2), value):
        raise BoardError("invalid_identifier")
    value = value.lower()
    if nonzero and int(value[2:], 16) == 0:
        raise BoardError("invalid_identifier")
    return value


def _parties(value):
    _object(value, {"nodus", "bsc"})
    return {"nodus": _hex(value["nodus"], 32), "bsc": _hex(value["bsc"], 20)}


def _amount(value, decimals, quantum=1):
    if not isinstance(value, str) or len(value) > 80 or not re.fullmatch(r"(0|[1-9][0-9]*)(\.[0-9]{1,%d})?" % decimals, value):
        raise BoardError("invalid_amount")
    whole, _, fractional = value.partition(".")
    units = (int(whole) * 10 ** decimals + int(fractional.ljust(decimals, "0"))) * quantum
    if not 0 < units <= UINT256_MAX:
        raise BoardError("invalid_amount")
    return value


def _bounded(value):
    try:
        encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    except (ValueError, TypeError, UnicodeError, RecursionError):
        raise BoardError("invalid_schema") from None
    if len(encoded) > MAX_BYTES:
        raise BoardError("request_too_large", 413)
    return encoded.decode("utf-8")


def validate_listing(value, now=None, *, creating=True):
    now = _now() if now is None else now
    _bounded(value)
    _object(value, LISTING_FIELDS)
    if value["schema"] != "nodus-trade/listing-v1" or value["side"] not in ("sell_nodus", "buy_nodus"):
        raise BoardError("invalid_schema")
    result = copy.deepcopy(value)
    result["id"] = _hex(value["id"], 32)
    name = value["name"]
    if not isinstance(name, str) or not 1 <= len(name) <= 80 or name != name.strip() or any(ord(c) < 32 or ord(c) == 127 for c in name):
        raise BoardError("invalid_name")
    _amount(value["nodusAmount"], 8, 10 ** 10)
    _amount(value["usdtAmount"], 18)
    result["maker"] = _parties(value["maker"])
    asset = value["asset"]
    _object(asset, {"kind", "chainId", "token", "decimals", "symbol"})
    if asset["kind"] != "bep20" or type(asset["chainId"]) is not int or asset["chainId"] != 97 or type(asset["decimals"]) is not int or asset["decimals"] != 18 or asset["symbol"] != "TEST-USDT":
        raise BoardError("unsupported_asset")
    result["asset"]["token"] = _hex(asset["token"], 20)
    created, expires = value["createdAt"], value["expiresAt"]
    if type(created) is not int or type(expires) is not int or not 0 <= created <= 253402300799 or not created < expires <= min(created + MAX_LIFETIME, 253402300799):
        raise BoardError("invalid_expiry")
    if creating and (abs(created - now) > CLOCK_SKEW or expires <= now or expires > now + MAX_LIFETIME):
        raise BoardError("invalid_expiry")
    return result


def _database(config):
    directory = Path(config["state_dir"]) / "trade"
    if directory.is_symlink():
        raise BoardError("board_unavailable", 503)
    directory.mkdir(mode=0o750, parents=False, exist_ok=True)
    if directory.is_symlink() or not directory.is_dir():
        raise BoardError("board_unavailable", 503)
    path = directory / "board.sqlite3"
    for candidate in (path, Path(str(path) + "-journal"), Path(str(path) + "-wal"), Path(str(path) + "-shm")):
        if candidate.is_symlink() or (candidate.exists() and not stat.S_ISREG(candidate.stat().st_mode)):
            raise BoardError("board_unavailable", 503)
    return path


@contextmanager
def _connection(config, *, write=False):
    connection = None
    try:
        path = _database(config)
        connection = sqlite3.connect(str(path), timeout=2, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA trusted_schema=OFF")
        connection.execute("PRAGMA journal_mode=DELETE")
        connection.execute("PRAGMA busy_timeout=2000")
        connection.execute("CREATE TABLE IF NOT EXISTS listings (id TEXT PRIMARY KEY, payload TEXT NOT NULL, management_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, cancelled INTEGER NOT NULL DEFAULT 0, reservation TEXT, reserved_until INTEGER NOT NULL DEFAULT 0)")
        if write:
            connection.execute("BEGIN IMMEDIATE")
        yield connection
        if write:
            connection.execute("COMMIT")
    except BoardError:
        if connection is not None and connection.in_transaction:
            connection.execute("ROLLBACK")
        raise
    except (sqlite3.Error, OSError, ValueError, TypeError, OverflowError, json.JSONDecodeError):
        if connection is not None and connection.in_transaction:
            connection.execute("ROLLBACK")
        raise BoardError("board_unavailable", 503) from None
    finally:
        if connection is not None:
            connection.close()


def _decode_public(row, now):
    listing = validate_listing(json.loads(row["payload"]), now, creating=False)
    reservation = None
    if row["reservation"] is not None and row["reserved_until"] > now:
        reservation = json.loads(row["reservation"])
        _object(reservation, {"id", "listingId", "createdAt", "expiresAt", "taker"})
        reservation["id"] = _hex(reservation["id"], 32)
        if reservation["listingId"] != listing["id"] or type(reservation["createdAt"]) is not int or type(reservation["expiresAt"]) is not int or reservation["expiresAt"] != row["reserved_until"] or not reservation["createdAt"] < reservation["expiresAt"] <= reservation["createdAt"] + RESERVATION_SECONDS:
            raise BoardError("board_unavailable", 503)
        reservation["taker"] = _parties(reservation["taker"])
        if reservation["createdAt"] > now + CLOCK_SKEW or reservation["expiresAt"] > listing["expiresAt"] or any(reservation["taker"][chain] == listing["maker"][chain] for chain in ("nodus", "bsc")):
            raise BoardError("board_unavailable", 503)
    listing["reservation"] = reservation
    return listing


def _public(row, now):
    try:
        return _decode_public(row, now)
    except (BoardError, TypeError, ValueError, KeyError, OverflowError):
        # A malformed stored row is a storage failure, not an empty catalog or
        # a validation complaint about the caller's otherwise valid request.
        raise BoardError("board_unavailable", 503) from None


def board(config):
    now = _now()
    with _connection(config) as connection:
        rows = connection.execute("SELECT payload, reservation, reserved_until FROM listings WHERE cancelled=0 AND expires_at>? ORDER BY expires_at,id LIMIT ?", (now, MAX_ACTIVE + 1)).fetchall()
        if len(rows) > MAX_ACTIVE:
            raise BoardError("board_unavailable", 503)
        listings = [_public(row, now) for row in rows]
    return {"schema": "nodus-trade/board-v1", "listings": listings, "serverTime": now, "trust": "unverified_advertisements"}


def create(config, payload):
    now = _now()
    listing = validate_listing(payload, now)
    encoded = _bounded(listing)
    token = secrets.token_hex(32)
    digest = hashlib.sha256(token.encode("ascii")).hexdigest()
    with _connection(config, write=True) as connection:
        # Expired rows no longer have a reservation or an active advertisement.
        # Reusing freed pages bounds growth rather than retaining public history.
        connection.execute("DELETE FROM listings WHERE expires_at<=?", (now,))
        if connection.execute("SELECT 1 FROM listings WHERE id=?", (listing["id"],)).fetchone():
            raise BoardError("listing_exists", 409)
        # Cancelled rows retain their id until its original expiry. Bound those
        # tombstones too, so repeated create/cancel cannot grow storage forever.
        count = connection.execute("SELECT COUNT(*) FROM listings").fetchone()[0]
        active = connection.execute("SELECT COUNT(*) FROM listings WHERE cancelled=0").fetchone()[0]
        if active >= MAX_ACTIVE or count >= MAX_ACTIVE * 10:
            raise BoardError("board_full", 409)
        connection.execute("INSERT INTO listings(id,payload,management_hash,expires_at) VALUES(?,?,?,?)", (listing["id"], encoded, digest, listing["expiresAt"]))
    return {"schema": "nodus-trade/listing-result-v1", "listing": {**listing, "reservation": None}, "managementToken": token}


def reserve(config, payload):
    _bounded(payload)
    _object(payload, {"id", "taker"})
    identifier, taker, now = _hex(payload["id"], 32), _parties(payload["taker"]), _now()
    with _connection(config, write=True) as connection:
        row = connection.execute("SELECT * FROM listings WHERE id=?", (identifier,)).fetchone()
        if row is None or row["cancelled"] or row["expires_at"] <= now:
            raise BoardError("listing_unavailable", 404)
        if row["reserved_until"] > now:
            raise BoardError("already_reserved", 409)
        listing = _public(row, now)
        if any(taker[chain] == listing["maker"][chain] for chain in ("nodus", "bsc")):
            raise BoardError("same_party")
        reservation = {"id": "0x" + secrets.token_hex(32), "listingId": identifier, "createdAt": now, "expiresAt": min(now + RESERVATION_SECONDS, listing["expiresAt"]), "taker": taker}
        connection.execute("UPDATE listings SET reservation=?, reserved_until=? WHERE id=?", (_bounded(reservation), reservation["expiresAt"], identifier))
    listing["reservation"] = reservation
    return {"schema": "nodus-trade/reservation-result-v1", "listing": listing, "reservation": reservation}


def cancel(config, payload):
    _bounded(payload)
    _object(payload, {"id", "managementToken"})
    identifier, token, now = _hex(payload["id"], 32), payload["managementToken"], _now()
    if not isinstance(token, str) or not re.fullmatch(r"[0-9a-f]{64}", token):
        raise BoardError("invalid_management_token", 403)
    digest = hashlib.sha256(token.encode("ascii")).hexdigest()
    with _connection(config, write=True) as connection:
        row = connection.execute("SELECT * FROM listings WHERE id=?", (identifier,)).fetchone()
        if row is None or not hmac.compare_digest(digest, row["management_hash"]):
            raise BoardError("invalid_management_token", 403)
        if row["reserved_until"] > now and not row["cancelled"] and row["expires_at"] > now:
            raise BoardError("already_reserved", 409)
        connection.execute("UPDATE listings SET cancelled=1, reservation=NULL, reserved_until=0 WHERE id=?", (identifier,))
    return {"schema": "nodus-trade/cancel-result-v1", "id": identifier, "cancelled": True}
