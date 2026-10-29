"""Bounded, derived Scan index. This module never opens the Nodus database.

The source is an observation, not a cryptographic light client. A local chain
identity and the supported testnet pin must both match Scan before importing.
Only fully read, validated blocks enter the index. The contiguous covered range
can grow forward and backward; a recent-first start is explicitly partial.
"""
from __future__ import annotations

from datetime import datetime, timezone
import json
import re
import sqlite3
import time


SCAN_CHAIN_ID = "a48d1a785500a1cdecd739ecd53ef0e95b1dc4a7a300f49176a7fa25ae176114"
MAX_ITEMS = 10_000
MAX_PAGES = 100
MAX_IO = 512
MAX_PENDING_BYTES = 64 * 1024 * 1024
MAX_INT = 2**63 - 1
RANGES = {"24h": 24 * 3600_000, "7d": 7 * 24 * 3600_000,
          "30d": 30 * 24 * 3600_000, "1y": 366 * 24 * 3600_000, "all": None}


class IndexError(ValueError):
    """The source does not satisfy the observation contract."""


class BudgetExpired(IndexError):
    pass


def _integer(value, name, maximum=MAX_INT):
    if type(value) is not int or not 0 <= value <= maximum:
        raise IndexError("invalid " + name)
    return value


def _hex(value, size, name, nullable=False):
    if value is None and nullable:
        return None
    if not isinstance(value, str) or re.fullmatch("[0-9a-f]{%d}" % size, value) is None:
        raise IndexError("invalid " + name)
    return value


def _raw(value, name, nullable=True, bits=64):
    if value is None and nullable:
        return None
    if not isinstance(value, str) or re.fullmatch(r"0|[1-9][0-9]{0,77}", value) is None:
        raise IndexError("invalid " + name)
    if int(value) >= 2**bits:
        raise IndexError("out of range " + name)
    return value


def _stamp(milliseconds):
    return datetime.fromtimestamp(milliseconds / 1000, timezone.utc).isoformat(timespec="seconds")


def init_index(connection):
    """Create only this module's tables; safe on a shared statistics DB."""
    connection.executescript("""
        CREATE TABLE IF NOT EXISTS index_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS index_blocks (
          height INTEGER PRIMARY KEY, block_id TEXT NOT NULL UNIQUE,
          prev_id TEXT NOT NULL, global_root TEXT NOT NULL, time_ms INTEGER NOT NULL, proposer TEXT NOT NULL,
          applied_count INTEGER NOT NULL, n_items INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS index_blocks_time ON index_blocks(time_ms);
        CREATE TABLE IF NOT EXISTS index_items (
          height INTEGER NOT NULL, idx INTEGER NOT NULL, time_ms INTEGER NOT NULL,
          kind TEXT NOT NULL, op TEXT, code INTEGER NOT NULL, fee_raw TEXT,
          unknown_inputs INTEGER NOT NULL, transfer_raw TEXT,
          evm_status TEXT, gas_used TEXT, evm_from TEXT, evm_to TEXT, evm_created TEXT,
          PRIMARY KEY(height,idx));
        CREATE INDEX IF NOT EXISTS index_items_time ON index_items(time_ms);
        CREATE TABLE IF NOT EXISTS index_touches (
          height INTEGER NOT NULL, idx INTEGER NOT NULL, time_ms INTEGER NOT NULL,
          space TEXT NOT NULL, address TEXT NOT NULL, role TEXT NOT NULL,
          PRIMARY KEY(height,idx,space,address,role));
        CREATE INDEX IF NOT EXISTS index_touches_time ON index_touches(time_ms,space,address);
        CREATE TABLE IF NOT EXISTS index_first_seen (
          space TEXT NOT NULL,address TEXT NOT NULL,time_ms INTEGER NOT NULL,
          PRIMARY KEY(space,address));
        CREATE INDEX IF NOT EXISTS index_first_seen_time ON index_first_seen(time_ms,space);
        CREATE TABLE IF NOT EXISTS index_pending (
          height INTEGER NOT NULL,block_id TEXT NOT NULL,part TEXT NOT NULL,idx INTEGER NOT NULL,
          payload TEXT NOT NULL,PRIMARY KEY(height,part,idx));
    """)


def _meta(connection, key):
    row = connection.execute("SELECT value FROM index_meta WHERE key=?", (key,)).fetchone()
    return row[0] if row else None


def _set_meta(connection, key, value):
    connection.execute("INSERT INTO index_meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                       (key, str(value)))


def _header(page, height):
    if not isinstance(page, dict) or not isinstance(page.get("block"), dict):
        raise IndexError("block response missing header")
    b = page["block"]
    if _integer(b.get("height"), "height") != height:
        raise IndexError("wrong block height")
    proposer = b.get("proposer")
    if not isinstance(proposer, str) or re.fullmatch(r"[0-9a-f]{2,128}", proposer) is None or len(proposer) % 2:
        raise IndexError("invalid proposer")
    result = {"height": height, "block_id": _hex(b.get("block_id"), 128, "block id"),
              "prev_id": _hex(b.get("prev_id"), 128, "previous block id"),
              "global_root": _hex(b.get("global_root"), 128, "global root"),
              "time_ms": _integer(b.get("time"), "block time", 253402300799000),
              "proposer": proposer, "applied_count": _integer(b.get("applied_count"), "applied count", MAX_ITEMS),
              "n_items": _integer(b.get("n_items"), "item count", MAX_ITEMS)}
    if result["time_ms"] == 0 or result["applied_count"] > result["n_items"]:
        raise IndexError("invalid block counts/time")
    return result


def _item(item, header, index):
    if not isinstance(item, dict):
        raise IndexError("invalid item")
    if (_integer(item.get("height"), "item height") != header["height"] or
            _integer(item.get("index"), "item index", MAX_ITEMS) != index or
            item.get("position") != "%d:%d" % (header["height"], index) or
            _integer(item.get("time"), "item time") != header["time_ms"]):
        raise IndexError("inconsistent item position/time")
    kind = item.get("kind")
    if kind not in ("envelope", "claim", "empty"):
        raise IndexError("unknown item kind")
    op = item.get("op")
    if op is not None and (not isinstance(op, str) or re.fullmatch(r"[a-z][a-z0-9_]{0,63}", op) is None):
        raise IndexError("invalid operation")
    code = _integer(item.get("code"), "item code", 2**32 - 1)
    if type(item.get("refused")) is not bool or item["refused"] != (code != 0):
        raise IndexError("inconsistent item refusal")
    return {"height": header["height"], "idx": index, "time_ms": header["time_ms"],
            "kind": kind, "op": op, "code": code,
            "wire_id": _hex(item.get("wire_id"), 128, "wire id", True),
            "intent_id": _hex(item.get("intent_id"), 128, "intent id", True),
            "fee_raw": _raw(item.get("fee"), "fee"), "unknown_inputs": 0,
            "transfer_raw": None, "evm_status": None, "gas_used": None,
            "evm_from": None, "evm_to": None, "evm_created": None}


def _details(payload, item, header):
    if not isinstance(payload, dict):
        raise IndexError("invalid transaction response")
    detail = _item(payload.get("tx"), header, item["idx"])
    if any(detail[key] != item[key] for key in ("kind", "op", "code", "wire_id", "intent_id", "fee_raw")):
        raise IndexError("transaction differs from block summary")
    touches = set()
    senders = set()
    outputs = []
    for field, role in (("inputs", "sender"), ("outputs", "receiver")):
        rows = payload.get(field)
        if not isinstance(rows, list) or len(rows) > MAX_IO:
            raise IndexError("invalid transaction " + field)
        for row in rows:
            if not isinstance(row, dict):
                raise IndexError("invalid IO row")
            _hex(row.get("coin_id"), 128, "coin id")
            address = _hex(row.get("address"), 128, "native address", field == "inputs")
            token = _hex(row.get("token_id"), 128, "token id", field == "inputs")
            amount = _raw(row.get("amount"), "IO amount", field == "inputs")
            if address is None:
                if token is not None or amount is not None:
                    raise IndexError("partial unknown input")
                item["unknown_inputs"] += 1
                continue
            if token is None or amount is None:
                raise IndexError("partial known IO")
            touches.add(("native", address, role))
            if role == "sender":
                senders.add(address)
            else:
                outputs.append((address, token, int(amount)))
    record = payload["tx"].get("record")
    if record is not None:
        if not isinstance(record, dict):
            raise IndexError("invalid record")
        # HF-6's validator identifier names a role, not an owner wallet.
        # It must not inflate the native-address/user activity figures.
        for key in ("delegator", "destination"):
            address = _hex(record.get(key), 128, "record address", True)
            if address:
                touches.add(("native", address, "participant"))
    if item["op"] == "spend" and not item["unknown_inputs"] and senders:
        # A precisely defined external-output total, excluding change to any
        # known sender. This is not gross output value or economic activity.
        item["transfer_raw"] = str(sum(amount for address, token, amount in outputs
                                       if token == "0" * 128 and address not in senders))
    evm = payload.get("evm")
    if evm is not None:
        if not isinstance(evm, dict) or not (item["op"] or "").startswith("evm_"):
            raise IndexError("unexpected EVM receipt")
        if evm.get("status") not in ("success", "failed"):
            raise IndexError("invalid EVM status")
        item["evm_status"] = evm["status"]
        item["gas_used"] = str(_integer(evm.get("gas_used"), "gas used", 2**64 - 1))
        for source, target, role in (("from", "evm_from", "sender"), ("to", "evm_to", "contract"),
                                     ("created", "evm_created", "contract")):
            address = _hex(evm.get(source), 64, "EVM address", source != "from")
            item[target] = address
            if address:
                touches.add(("evm", address, role))
    elif (item["op"] or "").startswith("evm_"):
        # An older/incomplete Scan index can legitimately lack EVM facts.
        # Keep counts, but do not invent a successful execution or addresses.
        item["evm_status"] = None
    return touches


class _Reader:
    def __init__(self, read_api, deadline, max_requests):
        self.read_api = read_api
        self.deadline = deadline
        self.left = max_requests

    def check_deadline(self):
        if self.deadline is not None and time.monotonic() >= self.deadline:
            raise BudgetExpired("index collection budget reached")

    def __call__(self, endpoint):
        self.check_deadline()
        if self.left <= 0:
            raise BudgetExpired("index collection budget reached")
        self.left -= 1
        return self.read_api(endpoint)


def _cache_get(connection, height, block_id, part, index):
    row = connection.execute("SELECT payload FROM index_pending WHERE height=? AND block_id=? AND part=? AND idx=?",
                             (height, block_id, part, index)).fetchone()
    return json.loads(row[0]) if row else None


def _cache_put(connection, height, block_id, part, index, value, cache_bytes):
    payload = json.dumps(value, allow_nan=False, separators=(",", ":"))
    old = connection.execute("SELECT length(payload) FROM index_pending WHERE height=? AND part=? AND idx=?",
                             (height, part, index)).fetchone()
    total = cache_bytes + len(payload) - (old[0] if old else 0)
    if total > MAX_PENDING_BYTES:
        raise IndexError("pending block exceeds bounded cache size")
    with connection:
        connection.execute("INSERT OR REPLACE INTO index_pending VALUES (?,?,?,?,?)",
                           (height, block_id, part, index, payload))
    return total


def _clean_summary(item):
    # Exclude unused source fields from the bounded resumable cache.
    return {key: item.get(key) for key in ("position", "height", "index", "time", "kind", "op",
                                         "code", "refused", "wire_id", "intent_id", "fee")}


def _clean_details(payload):
    result = {"tx": _clean_summary(payload["tx"])}
    record = payload["tx"].get("record")
    result["tx"]["record"] = ({key: record.get(key) for key in ("delegator", "destination")}
                              if record is not None else None)
    for field in ("inputs", "outputs"):
        result[field] = [{key: row.get(key) for key in ("coin_id", "address", "token_id", "amount")}
                         for row in payload[field]]
    evm = payload.get("evm")
    result["evm"] = ({key: evm.get(key) for key in ("status", "gas_used", "from", "to", "created")}
                     if evm is not None else None)
    return result


def _read_block(connection, reader, height):
    header, items, touches = None, [], []
    index = 0
    cache_bytes = 0
    for _ in range(MAX_PAGES):
        reader.check_deadline()
        page_start = index
        # A fresh first page anchors each resumed attempt; later immutable pages
        # and verified tx details can be reused without redoing every request.
        page = (_cache_get(connection, height, header["block_id"], "page", index)
                if header is not None else None)
        cached_page = page is not None
        if page is None:
            page = reader("block/%d?from=%d&limit=100" % (height, index))
        current = _header(page, height)
        if header is None:
            header = current
            with connection:
                connection.execute("DELETE FROM index_pending WHERE height=? AND block_id<>?", (height, header["block_id"]))
            cache_bytes = connection.execute("SELECT COALESCE(SUM(length(payload)),0) FROM index_pending WHERE height=?", (height,)).fetchone()[0]
        elif current != header:
            raise IndexError("header changed between pages")
        rows = page.get("items")
        if not isinstance(rows, list) or len(rows) > 100:
            raise IndexError("invalid item page")
        if not rows and index < header["n_items"]:
            raise IndexError("empty nonterminal item page")
        for row in rows:
            item = _item(row, header, index)
            if index >= header["n_items"]:
                raise IndexError("too many block items")
            items.append(item)
            index += 1
        next_from = page.get("next_from")
        if next_from is None:
            if index != header["n_items"]:
                raise IndexError("truncated block page")
        elif type(next_from) is not int or next_from != index or index >= header["n_items"]:
            raise IndexError("invalid block cursor")
        if not cached_page:
            clean = {"block": page["block"], "items": [_clean_summary(row) for row in rows], "next_from": next_from}
            # Header has a fixed documented shape, so unused source fields do
            # not consume cache space either.
            clean["block"] = {key: page["block"][key] for key in
                              ("height", "block_id", "prev_id", "global_root", "time", "proposer", "applied_count", "n_items")}
            cache_bytes = _cache_put(connection, height, header["block_id"], "page", page_start, clean, cache_bytes)
        if next_from is None:
            break
    else:
        raise IndexError("block page limit reached")
    if sum(row["kind"] == "envelope" and row["code"] == 0 for row in items) != header["applied_count"]:
        raise IndexError("applied count differs from items")
    for item in items:
        reader.check_deadline()
        if item["code"] == 0 and item["kind"] != "empty":
            payload = _cache_get(connection, height, header["block_id"], "tx", item["idx"])
            cached_detail = payload is not None
            if payload is None:
                payload = reader("tx/%d:%d" % (height, item["idx"]))
            addresses = _details(payload, item, header)
            if not cached_detail:
                cache_bytes = _cache_put(connection, height, header["block_id"], "tx", item["idx"],
                                         _clean_details(payload), cache_bytes)
            touches.extend((height, item["idx"], header["time_ms"], *touch) for touch in addresses)
    return header, items, touches


def _write_block(connection, header, items, touches):
    height = header["height"]
    previous = connection.execute("SELECT block_id,time_ms FROM index_blocks WHERE height=?", (height - 1,)).fetchone()
    following = connection.execute("SELECT prev_id,time_ms FROM index_blocks WHERE height=?", (height + 1,)).fetchone()
    if previous and (header["prev_id"] != previous[0] or header["time_ms"] < previous[1]):
        raise IndexError("previous block link/time mismatch")
    if following and (following[0] != header["block_id"] or header["time_ms"] > following[1]):
        raise IndexError("next block link/time mismatch")
    with connection:
        connection.execute("INSERT INTO index_blocks VALUES (:height,:block_id,:prev_id,:global_root,:time_ms,:proposer,:applied_count,:n_items)", header)
        connection.executemany("""INSERT INTO index_items VALUES
          (:height,:idx,:time_ms,:kind,:op,:code,:fee_raw,:unknown_inputs,:transfer_raw,
           :evm_status,:gas_used,:evm_from,:evm_to,:evm_created)""", items)
        connection.executemany("INSERT INTO index_touches VALUES (?,?,?,?,?,?)", touches)
        for _, _, milliseconds, space, address, _ in touches:
            connection.execute("""INSERT INTO index_first_seen VALUES (?,?,?)
              ON CONFLICT(space,address) DO UPDATE SET time_ms=MIN(time_ms,excluded.time_ms)""",
                               (space, address, milliseconds))
        connection.execute("DELETE FROM index_pending WHERE height=?", (height,))
        connection.execute("DELETE FROM index_meta WHERE key='seed_height'")


def _coverage(connection):
    row = connection.execute("SELECT MIN(height),MAX(height),MIN(time_ms),MAX(time_ms),COUNT(*) FROM index_blocks").fetchone()
    first, last, start, end, count = row
    tip = _meta(connection, "tip_height")
    tip = int(tip) if tip is not None else None
    if count and count != last - first + 1:
        raise IndexError("noncontiguous stored index")
    source_indexed = _meta(connection, "source_indexed_height")
    return {"indexed_from_height": first, "indexed_to_height": last, "tip_height": tip,
            "source_indexed_height": int(source_indexed) if source_indexed is not None else None,
            "from_time": _stamp(start) if start else None, "to_time": _stamp(end) if end else None,
            "complete_from_genesis": first == 1, "caught_up": last is not None and tip is not None and last >= tip,
            "indexed_blocks": count, "chain_id": _meta(connection, "chain_id")}


def sync_index(connection, read_api, chain_id, tip_height, *, max_blocks=32,
               deadline=None, start_height=None, backfill_blocks=16, max_requests=512):
    """Import complete blocks within request/time budgets, retaining last good data.

    ``read_api`` accepts a relative fixed-Scan endpoint (``block/1?...``).
    ``deadline`` is an absolute ``time.monotonic()`` deadline. A recent initial
    start can be supplied by the collector; the default starts from genesis.
    Forward work runs first, then older blocks extend the same contiguous range.
    No network I/O happens inside a SQLite write transaction.
    """
    init_index(connection)
    result = {"status": "ok", "blocks_added": 0, "error": None}
    try:
        if chain_id != SCAN_CHAIN_ID:
            raise IndexError("local chain does not match supported testnet")
        _integer(tip_height, "tip height")
        _integer(max_blocks, "max blocks", 4096)
        _integer(backfill_blocks, "backfill blocks", 4096)
        _integer(max_requests, "request limit", 20_000)
        if start_height is not None:
            _integer(start_height, "start height")
            if start_height < 1:
                raise IndexError("start height must be positive")
        reader = _Reader(read_api, deadline, max_requests)
        stats = reader("stats")
        if not isinstance(stats, dict) or stats.get("chain_id") != chain_id:
            raise IndexError("Scan chain does not match local chain")
        source_indexed = _integer(stats.get("indexed_height"), "Scan indexed height")
        source_tip = (_integer(stats["tip_height"], "Scan chain tip") if stats.get("tip_height") is not None
                      else max(tip_height, source_indexed))
        if source_tip < source_indexed:
            raise IndexError("Scan indexed height exceeds its chain tip")
        desired_tip = max(tip_height, source_tip)
        target = min(desired_tip, source_indexed)
        existing_chain = _meta(connection, "chain_id")
        if existing_chain is not None and existing_chain != chain_id:
            raise IndexError("stored index has a different chain identity")
        coverage = _coverage(connection)
        last = coverage["indexed_to_height"]
        if last is not None:
            if target < last:
                raise IndexError("source/local tip behind stored index")
            # Recheck one immutable anchor before trusting a new observation.
            observed = _header(reader("block/%d?from=0&limit=100" % last), last)
            stored = connection.execute("SELECT block_id,prev_id,global_root,time_ms,proposer,applied_count,n_items FROM index_blocks WHERE height=?", (last,)).fetchone()
            if tuple(observed[key] for key in ("block_id", "prev_id", "global_root", "time_ms", "proposer", "applied_count", "n_items")) != tuple(stored):
                raise IndexError("Scan changed an indexed block")
        with connection:
            _set_meta(connection, "chain_id", chain_id)
            _set_meta(connection, "tip_height", desired_tip)
            _set_meta(connection, "source_indexed_height", source_indexed)
            if last is None and target > 0:
                # A moving recent-first suggestion must not abandon a busy
                # initial block between ticks while the chain tip advances.
                seed = _meta(connection, "seed_height")
                if seed is None:
                    pending = connection.execute("SELECT MIN(height) FROM index_pending").fetchone()[0]
                    seed = pending if pending is not None else min(start_height or 1, target)
                    _set_meta(connection, "seed_height", seed)
                seed = _integer(int(seed), "initial seed")
                connection.execute("DELETE FROM index_pending WHERE height<>?", (seed,))
            else:
                seed = 1
        next_height = last + 1 if last is not None else seed
        for height in range(next_height, min(target + 1, next_height + max_blocks)):
            header, items, touches = _read_block(connection, reader, height)
            _write_block(connection, header, items, touches)
            result["blocks_added"] += 1
        coverage = _coverage(connection)
        if coverage["indexed_to_height"] == target and coverage["indexed_from_height"]:
            first = coverage["indexed_from_height"]
            for height in range(first - 1, max(0, first - 1 - backfill_blocks), -1):
                header, items, touches = _read_block(connection, reader, height)
                _write_block(connection, header, items, touches)
                result["blocks_added"] += 1
    except BudgetExpired as exc:
        result.update(status="budget", error=str(exc))
    except (ValueError, OSError, TimeoutError, sqlite3.Error, TypeError, KeyError) as exc:
        result.update(status="error", error=str(exc)[:200])
    result["coverage"] = _coverage(connection)
    result["caught_up"] = result["coverage"]["caught_up"]
    return result


class _RawSum:
    def __init__(self):
        self.total = 0

    def step(self, value):
        if value is not None:
            self.total += int(value)

    def finalize(self):
        return str(self.total)


def _empty_metrics():
    return {"transactions": 0, "spends": 0, "claims": 0, "refused": 0,
            "evm_calls": 0, "evm_creates": 0, "evm_failed": 0,
            "fee_raw": "0", "known_fee_raw": "0", "fees_complete": True,
            "active_native_addresses": 0, "active_evm_addresses": 0,
            "native_senders": 0, "native_receivers": 0,
            "first_seen_native_addresses": 0, "first_seen_evm_addresses": 0,
            "blocks": 0, "empty_blocks": 0, "avg_block_ms": None,
            "transfer_raw": "0", "known_transfer_raw": "0",
            "transfers_with_unknown_sender": 0, "unknown_native_inputs": 0,
            "evm_receipts_missing": 0, "gas_used": "0", "known_gas_used": "0"}


def _metrics(connection, start, end, bucket_ms=None):
    """Use grouped queries and decimal-string sums, avoiding float money."""
    group = "(time_ms / %d) * %d" % (bucket_ms, bucket_ms) if bucket_ms else "0"
    # A grand total is a single aggregate, not a sort/group of every row under
    # the constant 0. Only chart buckets need GROUP BY. HAVING preserves the
    # old no-rows behavior instead of inventing an empty aggregate bucket.
    grouping = "GROUP BY 1" if bucket_ms else "HAVING COUNT(*)>0"
    groups = {}
    sql = """SELECT %s,COUNT(*),SUM(applied_count),SUM(n_items=0),MIN(time_ms),MAX(time_ms)
             FROM index_blocks WHERE time_ms>=? AND time_ms<=? %s""" % (group, grouping)
    for key, count, applied, empty, low, high in connection.execute(sql, (start, end)):
        values = groups.setdefault(key, _empty_metrics())
        values.update(blocks=count, transactions=applied, empty_blocks=empty,
                      avg_block_ms=(high - low) // (count - 1) if count > 1 else None)
    sql = """SELECT %s,SUM(code=0 AND op='spend'),SUM(code=0 AND kind='claim'),SUM(code<>0),
          SUM(code=0 AND op='evm_call'),SUM(code=0 AND op='evm_create'),SUM(evm_status='failed'),
          raw_sum(CASE WHEN code=0 AND kind='envelope' THEN fee_raw END),
          SUM(code=0 AND kind='envelope' AND fee_raw IS NULL),
          raw_sum(CASE WHEN code=0 AND op='spend' THEN transfer_raw END),
          SUM(code=0 AND op='spend' AND transfer_raw IS NULL),SUM(unknown_inputs),
          SUM(code=0 AND op LIKE 'evm_%%' AND evm_status IS NULL),raw_sum(gas_used)
          FROM index_items WHERE time_ms>=? AND time_ms<=? %s""" % (group, grouping)
    for row in connection.execute(sql, (start, end)):
        key, spends, claims, refused, calls, creates, failed, fees, missing_fees, volume, missing_volume, unknown, missing_evm, gas = row
        values = groups.setdefault(key, _empty_metrics())
        values.update(spends=spends or 0, claims=claims or 0, refused=refused or 0,
                      evm_calls=calls or 0, evm_creates=creates or 0, evm_failed=failed or 0,
                      fee_raw=None if missing_fees else fees or "0", known_fee_raw=fees or "0",
                      fees_complete=not missing_fees, transfer_raw=None if missing_volume else volume or "0",
                      known_transfer_raw=volume or "0", transfers_with_unknown_sender=missing_volume or 0,
                      unknown_native_inputs=unknown or 0, evm_receipts_missing=missing_evm or 0,
                      gas_used=None if missing_evm else gas or "0", known_gas_used=gas or "0")
    sql = """SELECT %s,
          COUNT(DISTINCT CASE WHEN space='native' THEN address END),
          COUNT(DISTINCT CASE WHEN space='evm' THEN address END),
          COUNT(DISTINCT CASE WHEN space='native' AND role='sender' THEN address END),
          COUNT(DISTINCT CASE WHEN space='native' AND role='receiver' THEN address END)
          FROM index_touches WHERE time_ms>=? AND time_ms<=? %s""" % (group, grouping)
    for key, native, evm, senders, receivers in connection.execute(sql, (start, end)):
        values = groups.setdefault(key, _empty_metrics())
        values.update(active_native_addresses=native, active_evm_addresses=evm,
                      native_senders=senders, native_receivers=receivers)
    sql = """SELECT %s,SUM(space='native'),SUM(space='evm') FROM index_first_seen
          WHERE time_ms>=? AND time_ms<=? %s""" % (group, grouping)
    for key, native, evm in connection.execute(sql, (start, end)):
        values = groups.setdefault(key, _empty_metrics())
        values.update(first_seen_native_addresses=native or 0, first_seen_evm_addresses=evm or 0)
    return groups


def _summary_from_buckets(connection, start, end, metrics):
    """Reuse additive chart metrics; unique wallets still need a range query."""
    total = _empty_metrics()
    counts = ("transactions", "spends", "claims", "refused", "evm_calls", "evm_creates", "evm_failed",
              "first_seen_native_addresses", "first_seen_evm_addresses", "blocks", "empty_blocks",
              "transfers_with_unknown_sender", "unknown_native_inputs", "evm_receipts_missing")
    for values in metrics.values():
        for key in counts:
            total[key] += values[key]
        for key in ("known_fee_raw", "known_transfer_raw", "known_gas_used"):
            total[key] = str(int(total[key]) + int(values[key]))
    total["fees_complete"] = all(v["fees_complete"] for v in metrics.values())
    total["fee_raw"] = total["known_fee_raw"] if total["fees_complete"] else None
    total["transfer_raw"] = None if total["transfers_with_unknown_sender"] else total["known_transfer_raw"]
    total["gas_used"] = None if total["evm_receipts_missing"] else total["known_gas_used"]
    # Per-bucket distinct counts cannot be added: a wallet can occur in many.
    row = connection.execute("""SELECT
        COUNT(DISTINCT CASE WHEN space='native' THEN address END),
        COUNT(DISTINCT CASE WHEN space='evm' THEN address END),
        COUNT(DISTINCT CASE WHEN space='native' AND role='sender' THEN address END),
        COUNT(DISTINCT CASE WHEN space='native' AND role='receiver' THEN address END)
        FROM index_touches WHERE time_ms>=? AND time_ms<=?""", (start, end)).fetchone()
    total.update(zip(("active_native_addresses", "active_evm_addresses", "native_senders", "native_receivers"), row))
    if total["blocks"] > 1:
        low, high = connection.execute("SELECT MIN(time_ms),MAX(time_ms) FROM index_blocks WHERE time_ms>=? AND time_ms<=?", (start, end)).fetchone()
        total["avg_block_ms"] = (high - low) // (total["blocks"] - 1)
    return total


def activity_report(connection, range_key, now_ms=None, *, transactions_only=False):
    """Report covered observations; missing history never becomes zero activity.

    First seen means first seen inside this index, not wallet creation. Native
    and EVM addresses are distinct namespaces and are never summed as people.
    Reward payouts/releases at block boundaries are outside the item index.
    """
    if range_key not in RANGES:
        raise ValueError("unsupported statistics range")
    connection.create_aggregate("raw_sum", 1, _RawSum)
    coverage = _coverage(connection)
    row = connection.execute("SELECT MIN(time_ms),MAX(time_ms) FROM index_blocks").fetchone()
    first_ms, last_ms = row
    now_ms = int(time.time() * 1000) if now_ms is None else _integer(now_ms, "report time", 253402300799000)
    duration = RANGES[range_key]
    cutoff = max(0, now_ms - duration) if duration is not None else 0
    coverage.update(range=range_key, range_from=_stamp(cutoff) if cutoff else None,
                    range_to=_stamp(now_ms),
                    range_complete=bool(first_ms is not None and coverage["caught_up"] and
                                        (coverage["complete_from_genesis"] or first_ms <= cutoff)),
                    addresses_complete=False,
                    first_seen_scope="first observed inside this indexed range; not wallet creation",
                    volume_scope="native spend outputs to addresses other than all known input owners; change excluded",
                    excluded="block-boundary payouts and stake releases; shielded activity; off-chain wallets")
    empty = {key: None for key in _empty_metrics()}
    report = {"coverage": coverage, "summary": empty, "activity": [], "operations": [], "proposers": [], "contracts": []}
    if first_ms is None or last_ms < cutoff or first_ms > now_ms:
        return report
    if transactions_only:
        # The separate rolling-day KPI needs only applied envelopes, not all
        # charts, wallet counts, fee sums or breakdowns for another full report.
        count = connection.execute("SELECT SUM(applied_count) FROM index_blocks WHERE time_ms>=? AND time_ms<=?", (cutoff, now_ms)).fetchone()[0]
        report["summary"]["transactions"] = count
        return report
    bucket_ms = {"24h": 3600_000, "7d": 6 * 3600_000,
                 "30d": 24 * 3600_000, "1y": 7 * 24 * 3600_000}.get(range_key)
    if bucket_ms is None:
        bucket_ms = max(24 * 3600_000, ((last_ms - first_ms) // (400 * 24 * 3600_000) + 1) * 24 * 3600_000)
    metrics = _metrics(connection, cutoff, now_ms, bucket_ms)
    if not metrics:
        return report
    summary = _summary_from_buckets(connection, cutoff, now_ms, metrics)
    report["summary"] = summary
    coverage["addresses_complete"] = summary["unknown_native_inputs"] == 0 and summary["evm_receipts_missing"] == 0
    # Only actual covered buckets appear. No leading/trailing fake zero bins.
    report["activity"] = [{"timestamp": _stamp(key), **values} for key, values in sorted(metrics.items())]
    report["operations"] = [{"name": name or "unknown", "count": count}
                            for name, count in connection.execute("""SELECT op,COUNT(*) FROM index_items
                              WHERE time_ms>=? AND time_ms<=? AND code=0 AND kind<>'empty'
                              GROUP BY op ORDER BY COUNT(*) DESC,op LIMIT 64""", (cutoff, now_ms))]
    report["proposers"] = [{"id": proposer, "blocks": count}
                           for proposer, count in connection.execute("""SELECT proposer,COUNT(*) FROM index_blocks
                             WHERE time_ms>=? AND time_ms<=? GROUP BY proposer ORDER BY COUNT(*) DESC,proposer LIMIT 256""",
                                                                    (cutoff, now_ms))]
    report["contracts"] = [{"address": address, "calls": calls or 0, "creates": creates or 0,
                            "failed": failed or 0, "gas_used": gas or "0"}
                           for address, calls, creates, failed, gas in connection.execute("""
          SELECT COALESCE(evm_to,evm_created),SUM(op='evm_call'),SUM(op='evm_create'),
                 SUM(evm_status='failed'),raw_sum(gas_used)
          FROM index_items WHERE time_ms>=? AND time_ms<=? AND code=0
          AND (evm_to IS NOT NULL OR evm_created IS NOT NULL)
          GROUP BY COALESCE(evm_to,evm_created)
          ORDER BY SUM(op='evm_call') DESC,SUM(op='evm_create') DESC,COALESCE(evm_to,evm_created)
          LIMIT 100""", (cutoff, now_ms))]
    return report
