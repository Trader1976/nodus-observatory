#!/usr/bin/env python3
"""Exact owner-level Nodus payout ledger; only collector reads the live DB.

Source schema checked against nocdem/dna commit
24f93e6b709119a3013efacf3a374930c97871b7, nodus_witness_addr_index.h.
No wallet secrets or privileged CLI are needed. No tax category is inferred.
"""
from __future__ import annotations

import argparse
import csv
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, localcontext
import hashlib
from http.client import HTTPException
import io
import json
import os
from pathlib import Path
import re
import sqlite3
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
from zoneinfo import ZoneInfo

SCALE = 100_000_000
BOUNDARY = 0xFFFFFFFF
MAX_INT = (1 << 63) - 1
MAX_REPORT_ROWS = 100_000
HELSINKI = ZoneInfo("Europe/Helsinki")
NATIVE = bytes(64)
SCHEMA = """
CREATE TABLE IF NOT EXISTS reward_events (
  event_id TEXT PRIMARY KEY, chain_id TEXT NOT NULL, owner_fp TEXT NOT NULL,
  node_fp TEXT NOT NULL, network TEXT NOT NULL, kind TEXT NOT NULL,
  height INTEGER NOT NULL, item_pos INTEGER NOT NULL, sequence INTEGER NOT NULL,
  block_ts INTEGER NOT NULL, amount_raw TEXT NOT NULL,
  source TEXT NOT NULL, observed_at TEXT NOT NULL,
  UNIQUE(chain_id, owner_fp, height, item_pos, sequence)
);
CREATE INDEX IF NOT EXISTS reward_events_time ON reward_events(block_ts);
CREATE TABLE IF NOT EXISTS reward_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reward_coverage (
  chain_id TEXT NOT NULL, owner_fp TEXT NOT NULL, from_height INTEGER NOT NULL,
  at_height INTEGER NOT NULL, observed_at TEXT NOT NULL,
  PRIMARY KEY(chain_id, owner_fp, from_height)
);
CREATE TABLE IF NOT EXISTS reward_scan_coverage (
  chain_id TEXT NOT NULL, owner_fp TEXT NOT NULL, from_height INTEGER NOT NULL,
  at_height INTEGER NOT NULL, observed_at TEXT NOT NULL,
  PRIMARY KEY(chain_id, owner_fp, from_height)
);
CREATE TABLE IF NOT EXISTS reward_valuations (
  event_id TEXT PRIMARY KEY REFERENCES reward_events(event_id),
  eur_value TEXT NOT NULL, price_eur TEXT NOT NULL, source TEXT NOT NULL,
  valuation_at TEXT NOT NULL, recorded_at TEXT NOT NULL, note TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reward_valuation_audit (
  revision INTEGER PRIMARY KEY, event_id TEXT NOT NULL,
  eur_value TEXT NOT NULL, price_eur TEXT NOT NULL, source TEXT NOT NULL,
  valuation_at TEXT NOT NULL, recorded_at TEXT NOT NULL, note TEXT NOT NULL
);
"""


def utcnow():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _uint(value, maximum=MAX_INT):
    if type(value) is not int or not 0 <= value <= maximum:
        raise ValueError("Source contains an invalid integer")
    return value


def _hex(value, length):
    if not isinstance(value, str) or not re.fullmatch("[0-9a-f]{%d}" % length, value):
        raise ValueError("Expected a lowercase hexadecimal identifier")
    return value


def _amount(raw):
    n = int(raw)
    if n < 0:
        raise ValueError("Negative amount")
    return "%d.%08d" % divmod(n, SCALE)


def _decimal(value):
    # Strings are mandatory: callers must never pass binary floating point.
    if not isinstance(value, str) or not re.fullmatch(r"(?:0|[1-9][0-9]{0,30})(?:\.[0-9]{1,24})?", value):
        raise ValueError("A nonnegative decimal string is required")
    try:
        n = Decimal(value)
    except InvalidOperation as exc:
        raise ValueError("Invalid decimal") from exc
    if not n.is_finite():
        raise ValueError("Invalid decimal")
    return n


def _ro(path, seconds=2.0):
    path = Path(path).resolve(strict=True)
    if not path.is_file():
        raise ValueError("Source is not a regular file")
    # No immutable=1: it would ignore committed transactions still in WAL.
    db = sqlite3.connect("file:" + quote(str(path), safe="/") + "?mode=ro", uri=True, timeout=0.2)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA query_only=ON")
    db.execute("PRAGMA trusted_schema=OFF")
    deadline = time.monotonic() + seconds
    db.set_progress_handler(lambda: int(time.monotonic() > deadline), 1000)
    db.execute("BEGIN")
    return db


def _writer(path):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=2.0)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    db.executescript(SCHEMA)
    return db


def _put_meta(db, values):
    db.executemany("INSERT OR REPLACE INTO reward_meta(key,value) VALUES (?,?)",
                   [(k, json.dumps(v, ensure_ascii=False)) for k, v in values.items()])


def _event_id(chain, owner, height, pos, seq):
    return hashlib.sha256(f"{chain}:{owner}:{height}:{pos}:{seq}".encode("ascii")).hexdigest()


def collect_rewards(source_db, reporting_db, chain_id, owner_fp, node_fp,
                    network="testnet", max_rows=5000):
    """Root collector: bounded readonly live snapshot -> independent ledger.

    Repeated collection cannot duplicate rows. Immutable source events are
    checked on every replay; an inconsistent duplicate aborts the collection.
    An index gap is recorded as a new run, never silently treated as coverage.
    """
    chain = _hex(chain_id, 64)
    owner = _hex(owner_fp, 128)
    node = _hex(node_fp, 128)
    if network not in ("testnet", "mainnet", "unknown"):
        raise ValueError("Unknown network label")
    if not 1 <= max_rows <= MAX_REPORT_ROWS:
        raise ValueError("Invalid row budget")
    if Path(source_db).resolve() == Path(reporting_db).resolve():
        raise ValueError("Reporting ledger must be a separate database")
    snapshot = dict(status="unavailable", reason="Osoitehistorian indeksi ei ole käytössä tai sen kattavuutta ei voida vahvistaa.",
                    from_height=None, at_height=None, pending_raw=None, collected_at=utcnow(),
                    source="local_nodus_addr_history", source_path=str(source_db),
                    chain_id=chain, owner_fp=owner, node_fp=node, network=network,
                    truncated=False, complete_year=False)
    events = []
    db = None
    try:
        # Nodus uses the first 16 bytes of its chain ID in the DB basename.
        # Binding an unverified database to an unrelated configured chain is
        # refused. The collector also derives chain_id from nodus-cli status.
        if Path(source_db).name != "witness_" + chain[:32] + ".db":
            raise ValueError("Source database filename does not match the observed chain")
        db = _ro(source_db)
        tip = db.execute("SELECT global_height FROM v2_blocks ORDER BY global_height DESC LIMIT 1").fetchone()
        if tip is None:
            raise ValueError("Chain height is unavailable")
        snapshot["at_height"] = _uint(tip[0])
        pending = db.execute("SELECT amount FROM v2_reward_accrual WHERE owner_fp=?", (bytes.fromhex(owner),)).fetchall()
        if len(pending) > 1:
            raise ValueError("Ambiguous pending reward")
        snapshot["pending_raw"] = str(_uint(pending[0][0])) if pending else "0"
        mark = db.execute("SELECT from_height,last_height FROM addr_history_mark WHERE id=1").fetchone()
        if mark is not None:
            first, last = _uint(mark[0]), _uint(mark[1])
            if first < 1 or first > last or last != snapshot["at_height"]:
                raise ValueError("Address-history coverage is stale or inconsistent")
            snapshot["from_height"] = first
            rows = db.execute(
                "SELECT h,i,seq,owner,kind,amount,token,ts FROM addr_history "
                "INDEXED BY idx_addr_history_owner "
                "WHERE owner=? AND h>=? AND h<=? AND i=? AND kind IN ('payout','release') "
                "ORDER BY h,i,seq LIMIT ?",
                (bytes.fromhex(owner), first, last, BOUNDARY, max_rows + 1)).fetchall()
            if len(rows) > max_rows:
                snapshot["truncated"] = True
                raise ValueError("Reward row budget exceeded; collection was not marked complete")
            for row in rows:
                h, pos, seq = _uint(row["h"]), _uint(row["i"], BOUNDARY), _uint(row["seq"], BOUNDARY)
                ts = _uint(row["ts"])
                if pos != BOUNDARY or row["token"] != NATIVE or row["owner"] != bytes.fromhex(owner):
                    raise ValueError("Malformed native boundary reward row")
                # Datetime support is bounded; a bad time never vanishes into
                # a different reporting year and never becomes machine time.
                datetime.fromtimestamp(ts, timezone.utc)
                events.append(dict(event_id=_event_id(chain, owner, h, pos, seq),
                    chain_id=chain, owner_fp=owner, node_fp=node, network=network,
                    kind=row["kind"], height=h, item_pos=pos, sequence=seq,
                    block_ts=ts, amount_raw=str(_uint(row["amount"])),
                    source="local_nodus_addr_history", observed_at=snapshot["collected_at"]))
            snapshot.update(status="ok", reason="Paikallisen osoitehistorian nykyinen yhtenäinen lohkojakso luettu.")
    except (sqlite3.Error, OSError, ValueError, OverflowError) as exc:
        events = []
        snapshot.update(status="error", reason=str(exc), pending_raw=None)
    finally:
        if db is not None:
            db.close()
    out = _writer(reporting_db)
    try:
        with out:
            previous = out.execute("SELECT value FROM reward_meta WHERE key='chain_id'").fetchone()
            if previous is not None and json.loads(previous[0]) != chain:
                raise ValueError("A different chain requires a separate reporting ledger")
            previous_owner = out.execute("SELECT value FROM reward_meta WHERE key='owner_fp'").fetchone()
            if previous_owner is not None and json.loads(previous_owner[0]) != owner:
                raise ValueError("A different owner requires a separate reporting ledger")
            for event in events:
                old = out.execute("SELECT amount_raw,kind,block_ts FROM reward_events WHERE event_id=?", (event["event_id"],)).fetchone()
                if old is not None and tuple(old) != (event["amount_raw"], event["kind"], event["block_ts"]):
                    raise ValueError("An existing payout changed; refusing to overwrite accounting history")
                keys = tuple(event)
                out.execute("INSERT OR IGNORE INTO reward_events(" + ",".join(keys) + ") VALUES (" + ",".join("?" for _ in keys) + ")", tuple(event.values()))
            if snapshot["status"] == "ok":
                out.execute("INSERT INTO reward_coverage VALUES (?,?,?,?,?) "
                            "ON CONFLICT(chain_id,owner_fp,from_height) DO UPDATE SET "
                            "at_height=max(at_height,excluded.at_height),observed_at=excluded.observed_at",
                            (chain, owner, snapshot["from_height"], snapshot["at_height"], snapshot["collected_at"]))
            _put_meta(out, snapshot)
    finally:
        out.close()
    return {"status": snapshot["status"], "reason": snapshot["reason"], "rows": len(events),
            "from_height": snapshot["from_height"], "at_height": snapshot["at_height"]}


# This public explorer is the upstream testnet source, never a configurable URL.
SCAN_ROOT = "https://scan.nodusnetwork.io/api/"
SCAN_CHAIN_ID = "a48d1a785500a1cdecd739ecd53ef0e95b1dc4a7a300f49176a7fa25ae176114"
SCAN_SOURCE = "nodus_scan_addr_history"
LOCAL_SOURCE = "local_nodus_addr_history"
SCAN_MAX_BYTES = 2 * 1024 * 1024


def _scan_url_allowed(url):
    parts = urlsplit(url)
    return (parts.scheme == "https" and parts.hostname == "scan.nodusnetwork.io"
            and parts.port in (None, 443) and parts.username is None
            and parts.password is None and parts.path.startswith("/api/"))


class _ScanRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not _scan_url_allowed(newurl):
            raise ValueError("Scan redirected outside its official HTTPS API")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _json_unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Scan returned a duplicate JSON key")
        result[key] = value
    return result


def _scan_json(path, timeout):
    url = SCAN_ROOT + path
    if not _scan_url_allowed(url):
        raise ValueError("Invalid official Scan API URL")
    request = Request(url, headers={"User-Agent": "Nodus-Observatory/1.0",
                                   "Accept": "application/json"})
    deadline = time.monotonic() + timeout
    with build_opener(_ScanRedirect()).open(request, timeout=timeout) as response:
        if not _scan_url_allowed(response.geturl()):
            raise ValueError("Scan response is outside its official HTTPS API")
        chunks, size = [], 0
        # read1 performs at most one buffered socket read. Check wall time
        # between chunks so a trickling response cannot extend the import
        # indefinitely by repeatedly resetting the socket inactivity timeout.
        while True:
            if time.monotonic() >= deadline:
                raise TimeoutError("Scan response exceeded its request time budget")
            part = response.read1(min(65536, SCAN_MAX_BYTES + 1 - size))
            if time.monotonic() >= deadline:
                raise TimeoutError("Scan response exceeded its request time budget")
            if not part:
                break
            chunks.append(part)
            size += len(part)
            if size > SCAN_MAX_BYTES:
                raise ValueError("Scan JSON exceeds the response byte budget")
        raw = b"".join(chunks)
    data = json.loads(raw.decode("utf-8"), object_pairs_hook=_json_unique,
                      parse_constant=lambda x: (_ for _ in ()).throw(ValueError("Invalid Scan JSON number")))
    if not isinstance(data, dict):
        raise ValueError("Scan response must be a JSON object")
    return data


def _raw_amount(value):
    if not isinstance(value, str) or not re.fullmatch(r"0|[1-9][0-9]{0,18}", value):
        raise ValueError("Scan amount must be a canonical integer string")
    if int(value) > MAX_INT:
        raise ValueError("Scan amount exceeds int64")
    return value


def _scan_cursor(value):
    if value is None:
        return None
    if not isinstance(value, str) or not re.fullmatch(r"[1-9][0-9]{0,18}:(?:0|[1-9][0-9]{0,9})", value):
        raise ValueError("Invalid Scan pagination cursor")
    height, seq = (int(n) for n in value.split(":"))
    return (_uint(height), _uint(seq, BOUNDARY))


def _ledger_binding(db, chain, owner, node, network):
    meta = {r["key"]: json.loads(r["value"]) for r in db.execute("SELECT key,value FROM reward_meta")}
    if meta.get("chain_id", chain) != chain or meta.get("owner_fp", owner) != owner:
        raise ValueError("A different chain or owner requires a separate reporting ledger")
    _put_meta(db, {k: v for k, v in dict(chain_id=chain, owner_fp=owner,
              node_fp=node, network=network).items() if k not in meta})
    return meta


def collect_scan_rewards(reporting_db, chain_id, owner_fp, node_fp,
                         network="testnet", timeout=6, max_pages=20,
                         max_rows=5000, cache_seconds=300, deadline_seconds=25, enabled=True):
    """Collector-only public history backfill; validate a complete batch first.

    Scan evidence has its own coverage and freshness. It cannot replace local
    pending accrual, index coverage, existing events, or administrator valuations.
    Requests disclose only the owner's public fingerprint to the fixed API.
    """
    chain, owner, node = _hex(chain_id, 64), _hex(owner_fp, 128), _hex(node_fp, 128)
    if network not in ("testnet", "mainnet", "unknown"):
        raise ValueError("Unknown network label")
    if (type(enabled) is not bool or type(max_pages) is not int or type(max_rows) is not int
            or type(cache_seconds) is not int or type(timeout) not in (int, float)
            or type(deadline_seconds) not in (int, float)):
        raise ValueError("Invalid Scan request budget")
    if not (1 <= max_pages <= 100 and 1 <= max_rows <= MAX_REPORT_ROWS
            and 0 < timeout <= 10 and 0 < deadline_seconds <= 60
            and 0 <= cache_seconds <= 86400):
        raise ValueError("Invalid Scan request budget")
    out = _writer(reporting_db)
    attempted = utcnow()
    now = time.time()
    try:
        with out:
            meta = _ledger_binding(out, chain, owner, node, network)
        previous = meta.get("scan", {})
        if not isinstance(previous, dict):
            previous = {}
        if not enabled:
            scan = dict(previous, status="disabled", reason="Public Scan history collection is disabled.", rows=0)
            with out:
                _put_meta(out, {"scan": scan})
            return {k: scan.get(k) for k in ("status", "reason", "rows", "from_height", "at_height")} | {"cached": False}
        # Failed attempts are cached too, to avoid retry storms on every tick.
        last_attempt = previous.get("last_attempt_unix")
        if previous.get("status") != "disabled" and type(last_attempt) in (int, float) and 0 <= now - last_attempt < cache_seconds:
            return {k: previous.get(k) for k in ("status", "reason", "rows", "from_height", "at_height")} | {"cached": True}
        scan = dict(previous, status="error", reason="Scan collection has not completed.",
                    last_attempt_at=attempted, last_attempt_unix=now, rows=0)
        events = []
        try:
            if network != "testnet" or chain != SCAN_CHAIN_ID:
                raise ValueError("The official Scan source supports only its pinned testnet chain")
            deadline = time.monotonic() + deadline_seconds

            def fetch(path):
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise ValueError("Scan collection exceeded the total request time budget")
                result = _scan_json(path, min(timeout, remaining))
                if time.monotonic() >= deadline:
                    raise ValueError("Scan collection exceeded the total request time budget")
                return result

            before = fetch("stats")
            if _hex(before.get("chain_id"), 64) != chain:
                raise ValueError("Scan chain ID differs from the locally observed chain")
            index_before = _uint(before["indexed_height"]) if "indexed_height" in before else None
            cursors = {"payout": None, "release": None}
            finished = {"payout": False, "release": False}
            seen = set()
            coverage = None
            sums = {"payout": 0, "release": 0}
            first = None
            for _ in range(max_pages):
                query = {"limit": 50}
                if cursors["payout"] is not None:
                    query["before"] = "%d:%d" % cursors["payout"]
                if cursors["release"] is not None:
                    query["release_before"] = "%d:%d" % cursors["release"]
                # The upstream parser expects a literal H:Q cursor and does
                # not URL-decode query values. Cursor components are already
                # validated integers; preserve their colon on the wire.
                page = fetch("rewards/" + owner + "?" + urlencode(query, safe=":"))
                if page.get("address") != owner:
                    raise ValueError("Scan reward address differs from the requested owner")
                low, high = _uint(page.get("from_height")), _uint(page.get("at_height"))
                if low < 1 or low > high:
                    raise ValueError("Scan history coverage is unavailable or invalid")
                totals = {"payout": _raw_amount(page.get("paid_total")),
                          "release": _raw_amount(page.get("released_total"))}
                pending = _raw_amount(page.get("pending"))
                if first is None:
                    first = dict(from_height=low, at_height=high, paid_total_raw=totals["payout"],
                                 released_total_raw=totals["release"], pending_raw=pending)
                    coverage = (low, high)
                elif low != coverage[0] or high < coverage[1] or totals != {
                        "payout": first["paid_total_raw"], "release": first["released_total_raw"]}:
                    raise ValueError("Scan history changed while paging; retry a complete snapshot")
                for kind, key, next_key in (("payout", "items", "next_before"),
                                             ("release", "releases", "next_release_before")):
                    items = page.get(key)
                    if not isinstance(items, list) or len(items) > 50 or next_key not in page:
                        raise ValueError("Scan returned an invalid or truncated reward page")
                    # The API repeats the initial list for a stream without a
                    # cursor. Once exhausted, that list must not be recounted.
                    if finished[kind]:
                        continue
                    previous_pos = cursors[kind]
                    last_pos = None
                    for item in items:
                        if not isinstance(item, dict):
                            raise ValueError("Invalid Scan reward item")
                        height = _uint(item.get("height"))
                        seq = _uint(item.get("sequence"), BOUNDARY)
                        pos = (height, seq)
                        if not low <= height <= coverage[1] or (previous_pos is not None and pos >= previous_pos):
                            raise ValueError("Scan reward ordering or coverage is inconsistent")
                        previous_pos = last_pos = pos
                        millis = _uint(item.get("time"))
                        if millis % 1000:
                            raise ValueError("Scan history timestamp is not a whole number of seconds")
                        ts = millis // 1000
                        datetime.fromtimestamp(ts, timezone.utc)
                        amount = _raw_amount(item.get("amount"))
                        eid = _event_id(chain, owner, height, BOUNDARY, seq)
                        if eid in seen:
                            raise ValueError("Scan returned a duplicate reward event")
                        seen.add(eid)
                        events.append(dict(event_id=eid, chain_id=chain, owner_fp=owner,
                            node_fp=node, network=network, kind=kind, height=height,
                            item_pos=BOUNDARY, sequence=seq, block_ts=ts, amount_raw=amount,
                            source=SCAN_SOURCE, observed_at=attempted))
                        sums[kind] += int(amount)
                        if len(events) > max_rows:
                            raise ValueError("Scan reward row budget exceeded; nothing imported")
                    next_cursor = _scan_cursor(page[next_key])
                    if next_cursor is not None and (last_pos is None or next_cursor != last_pos):
                        raise ValueError("Scan pagination cursor made no verifiable progress")
                    cursors[kind] = next_cursor
                    finished[kind] = next_cursor is None
                if all(finished.values()):
                    break
            else:
                raise ValueError("Scan page budget exceeded; nothing imported")
            if any(sums[kind] != int(first[key]) for kind, key in
                   (("payout", "paid_total_raw"), ("release", "released_total_raw"))):
                raise ValueError("Scan complete history does not match its declared totals")
            after = fetch("stats")
            if _hex(after.get("chain_id"), 64) != chain:
                raise ValueError("Scan chain changed during collection")
            index_after = _uint(after["indexed_height"]) if "indexed_height" in after else None
            # Stats describes the explorer index, while rewards is served
            # from the node's witness database and may legitimately be ahead.
            # Only compare the explorer index with its own earlier snapshot.
            if index_before is not None and index_after is not None and index_after < index_before:
                raise ValueError("Scan indexed height regressed during collection")
            # All data is validated before the first event is written. A
            # conflicting duplicate also rolls the entire new batch back.
            with out:
                for event in events:
                    old = out.execute("SELECT amount_raw,kind,block_ts FROM reward_events WHERE event_id=?",
                                      (event["event_id"],)).fetchone()
                    if old is not None and tuple(old) != (event["amount_raw"], event["kind"], event["block_ts"]):
                        raise ValueError("An existing payout changed; refusing to overwrite accounting history")
                    keys = tuple(event)
                    out.execute("INSERT OR IGNORE INTO reward_events(" + ",".join(keys) + ") VALUES (" +
                                ",".join("?" for _ in keys) + ")", tuple(event.values()))
                out.execute("INSERT INTO reward_scan_coverage VALUES (?,?,?,?,?) "
                            "ON CONFLICT(chain_id,owner_fp,from_height) DO UPDATE SET "
                            "at_height=max(at_height,excluded.at_height),observed_at=excluded.observed_at",
                            (chain, owner, first["from_height"], first["at_height"], attempted))
                scan.update(first, status="ok", reason="Official Scan history imported; source coverage is shown separately.",
                            rows=len(events), collected_at=attempted, last_success_at=attempted)
                _put_meta(out, {"scan": scan})
        except (HTTPError, URLError, HTTPException, TimeoutError, sqlite3.Error, OSError, ValueError, OverflowError) as exc:
            scan.update(status="error", reason=str(exc), rows=0)
            with out:
                _put_meta(out, {"scan": scan})
        return {k: scan.get(k) for k in ("status", "reason", "rows", "from_height", "at_height")} | {"cached": False}
    finally:
        out.close()


def _base_report(year):
    year = datetime.now(HELSINKI).year if year is None else int(year)
    if not 1970 <= year <= 9998:
        raise ValueError("Year must be 1970..9998")
    return {"schema_version": 1, "network": "unknown", "scope": "owner_aggregate",
            "owner_fp": None, "node_fp": None, "chain_id": None, "year": year,
            "timezone": "Europe/Helsinki", "source": {"status": "unavailable",
                "reason": "Palkkiolähdettä ei ole vielä kerätty.", "from_height": None,
                "at_height": None, "collected_at": None, "complete_year": False,
                "runs": [], "truncated": False,
                "local": {"status": "unavailable", "from_height": None, "at_height": None},
                "scan": {"status": "unavailable", "reason": "Scan history has not been collected.",
                         "from_height": None, "at_height": None, "last_success_at": None}},
            "summary": {"payout_count": 0, "paid_raw": None, "paid_nodus": None,
                "pending_raw": None, "pending_nodus": None, "released_raw": None,
                "released_nodus": None, "eur_total": None, "valued_count": 0,
                "unvalued_count": 0, "undated_count": 0},
            "monthly": [], "items": [], "releases": [],
            "notes": [
                "Palkkiot ovat omistajalompakon yhteissummia. Lähde ei erittele tämän storage-noden osuutta.",
                "Odottava kertymä on nykyhetken tilatieto, eikä sisälly maksettujen palkkioiden yhteenvetoon.",
                "Stake-palautukset esitetään erillään palkkioista.",
                "Vuosijako käyttää Europe/Helsinki-aikaa; CSV sisältää myös alkuperäisen lohkoajan UTC-muodossa.",
                "Puuttuva euromääräinen arvostus ei tarkoita nolla-arvoa. Raportti ei ratkaise veroluokkaa.",
                "Kattavuus koskee vain kerättyjä lohkojaksoja, ei koko lompakkohistoriaa."
            ]}


def _render_event(row):
    event = dict(row)
    ts = datetime.fromtimestamp(event.pop("block_ts"), timezone.utc)
    event["block_time_utc"] = ts.isoformat().replace("+00:00", "Z")
    event["block_time_local"] = ts.astimezone(HELSINKI).isoformat()
    event["amount_nodus"] = _amount(event["amount_raw"])
    event["attribution"] = "owner_aggregate"
    return event


def report(reporting_db, year=None):
    """Web server: read the independent monitor ledger, never the Nodus DB."""
    result = _base_report(year)
    year = result["year"]
    start = int(datetime(year, 1, 1, tzinfo=HELSINKI).timestamp())
    end = int(datetime(year + 1, 1, 1, tzinfo=HELSINKI).timestamp())
    db = None
    try:
        db = _ro(reporting_db)
        meta = {r["key"]: json.loads(r["value"]) for r in db.execute("SELECT key,value FROM reward_meta")}
        for k in ("network", "owner_fp", "node_fp", "chain_id"):
            result[k] = meta.get(k, result[k])
        result["source"].update({k: meta[k] for k in ("status", "reason", "from_height", "at_height", "collected_at", "truncated") if k in meta})
        local = {k: meta.get(k) for k in ("status", "reason", "from_height", "at_height", "collected_at", "truncated")}
        local["status"] = local["status"] or "unavailable"
        result["source"]["local"] = local
        scan = meta.get("scan")
        if isinstance(scan, dict):
            result["source"]["scan"].update({k: v for k, v in scan.items() if k != "last_attempt_unix"})
        runs = [dict(row, source=LOCAL_SOURCE) for row in db.execute(
            "SELECT from_height,at_height,observed_at FROM reward_coverage ORDER BY from_height")]
        # Read old ledgers without requiring schema migrations in the web process.
        if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='reward_scan_coverage'").fetchone():
            runs += [dict(row, source=SCAN_SOURCE) for row in db.execute(
                "SELECT from_height,at_height,observed_at FROM reward_scan_coverage ORDER BY from_height")]
        runs.sort(key=lambda row: (row["from_height"], row["at_height"], row["source"]))
        result["source"]["runs"] = runs
        if runs:
            result["source"]["from_height"] = min(r["from_height"] for r in runs)
            result["source"]["at_height"] = max(r["at_height"] for r in runs)
            if local["status"] != "ok":
                result["source"]["status"] = "partial"
                result["source"]["reason"] = "Stored rewards are available; local history is unavailable or incomplete."
            elif isinstance(scan, dict) and scan.get("status") == "error":
                result["source"]["status"] = "partial"
                result["source"]["reason"] = "Local history is available; the last Scan history refresh failed."
            if not result["source"].get("collected_at"):
                result["source"]["collected_at"] = result["source"]["scan"].get("collected_at")
        rows = db.execute("SELECT e.*,v.eur_value,v.price_eur,v.source AS valuation_source,"
                          "v.valuation_at,v.note AS valuation_note FROM reward_events e "
                          "LEFT JOIN reward_valuations v ON v.event_id=e.event_id "
                          "WHERE block_ts>=? AND block_ts<? ORDER BY height DESC,item_pos DESC,sequence DESC LIMIT ?",
                          (start, end, MAX_REPORT_ROWS + 1)).fetchall()
        if len(rows) > MAX_REPORT_ROWS:
            raise ValueError("Annual report exceeds the row budget")
        events = [_render_event(row) for row in rows]
        result["items"] = [e for e in events if e["kind"] == "payout"]
        result["releases"] = [e for e in events if e["kind"] == "release"]
        # Existing observed events remain available even if the source is
        # temporarily offline, clearly labeled by current source status.
        observed = bool(runs)
        summary = result["summary"]
        payouts, releases = result["items"], result["releases"]
        total = sum(int(e["amount_raw"]) for e in payouts)
        release_total = sum(int(e["amount_raw"]) for e in releases)
        summary.update(payout_count=len(payouts), paid_raw=str(total) if observed else None,
                       paid_nodus=_amount(total) if observed else None,
                       released_raw=str(release_total) if observed else None,
                       released_nodus=_amount(release_total) if observed else None,
                       pending_raw=meta.get("pending_raw"),
                       pending_nodus=_amount(meta["pending_raw"]) if meta.get("pending_raw") is not None else None)
        with localcontext() as ctx:
            ctx.prec = 90
            values = [Decimal(e["eur_value"]) for e in payouts if e["eur_value"] is not None]
            summary["valued_count"] = len(values)
            summary["unvalued_count"] = len(payouts) - len(values)
            summary["eur_total"] = format(sum(values, Decimal(0)), "f") if values else None
            # The EUR sum deliberately excludes unvalued events; expose that
            # rather than implying the sum covers all received rewards.
            summary["eur_complete"] = observed and bool(payouts) and len(values) == len(payouts)
            for month in range(1, 13):
                key = f"{year:04}-{month:02}"
                selected = [e for e in payouts if e["block_time_local"].startswith(key)]
                raw = sum(int(e["amount_raw"]) for e in selected)
                eur = [Decimal(e["eur_value"]) for e in selected if e["eur_value"] is not None]
                result["monthly"].append(dict(month=key, payout_count=len(selected),
                    paid_raw=str(raw) if observed else None, paid_nodus=_amount(raw) if observed else None,
                    eur_total=format(sum(eur, Decimal(0)), "f") if eur else None,
                    valued_count=len(eur), unvalued_count=len(selected)-len(eur)))
        if result["network"] == "testnet":
            result["notes"].insert(0, "Testnet: tokenimäärät ja mahdolliset annetut arvostukset eivät osoita markkina-arvoa.")
    except (sqlite3.Error, OSError, ValueError, OverflowError) as exc:
        result["source"].update(status="unavailable", reason=str(exc))
    finally:
        if db is not None:
            db.close()
    return result


CSV_FIELDS = ["event_id", "network", "chain_id", "owner_fp", "node_fp", "kind",
    "height", "item_pos", "sequence", "block_time_utc", "block_time_local",
    "amount_raw", "amount_nodus", "attribution", "eur_value", "price_eur",
    "valuation_source", "valuation_at", "valuation_note", "source", "observed_at",
    "report_year", "report_timezone", "source_from_height", "source_at_height",
    "source_status", "source_coverage_runs", "year_coverage_complete"]


def _csv_safe(value):
    # Source notes may be provided by an administrator. Prevent spreadsheet
    # formula evaluation even when CSV quoting would otherwise preserve it.
    if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@", "\t", "\r")):
        return "'" + value
    return value


def export_csv(reporting_db, year=None):
    data = report(reporting_db, year)
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=CSV_FIELDS, extrasaction="ignore", lineterminator="\r\n")
    writer.writeheader()
    # A metadata row preserves unavailable/empty-source status when there is
    # no observed payout. It is never an invented zero-amount transaction.
    rows = data["items"] + data["releases"]
    if not rows:
        rows = [{"kind": "coverage_metadata", "network": data["network"],
                 "chain_id": data["chain_id"], "owner_fp": data["owner_fp"], "node_fp": data["node_fp"]}]
    for event in sorted(rows, key=lambda e: (e.get("height", 0), e.get("sequence", 0))):
        # An older observed payout can precede the current contiguous index
        # run. Bind its evidence to the run in which it was observed.
        matches = [r for r in data["source"]["runs"]
                   if event.get("height") is not None and
                   r["from_height"] <= event["height"] <= r["at_height"]
                   and r.get("source", LOCAL_SOURCE) == event.get("source", LOCAL_SOURCE)]
        coverage = max(matches, key=lambda r: (r["at_height"], r["from_height"])) if matches else data["source"]
        row = dict(event, report_year=data["year"], report_timezone=data["timezone"],
            source_from_height=coverage["from_height"], source_at_height=coverage["at_height"],
            source_status=data["source"]["status"],
            source_coverage_runs=json.dumps(data["source"]["runs"], separators=(",", ":")),
            year_coverage_complete="false")
        writer.writerow({k: _csv_safe(v) for k, v in row.items()})
    return ("\ufeff" + output.getvalue()).encode("utf-8")


def import_valuations(reporting_db, valuation_file):
    """Admin-only file import: exact per-payout price, source, observation time.

    File: {"schema_version":1,"valuations":[{"event_id":"...",
      "price_eur":"0.0123","source":"exchange/reference URL or evidence",
      "valuation_at":"2026-10-19T12:00:00Z","note":"..."}]}
    Replacements keep prior revisions in a separate audit table.
    """
    path = Path(valuation_file)
    if path.stat().st_size > 4 * 1024 * 1024:
        raise ValueError("Valuation file is too large")
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("schema_version") != 1 or not isinstance(data.get("valuations"), list) or len(data["valuations"]) > 10_000:
        raise ValueError("Unsupported valuation file")
    db = _writer(reporting_db)
    count = 0
    seen = set()
    try:
        with db, localcontext() as ctx:
            ctx.prec = 90
            for value in data["valuations"]:
                eid = _hex(value.get("event_id"), 64)
                if eid in seen:
                    raise ValueError("Duplicate event_id in valuation file")
                seen.add(eid)
                price = _decimal(value.get("price_eur"))
                source = value.get("source")
                note = value.get("note", "")
                if not isinstance(source, str) or not source.strip() or len(source) > 2048 or not isinstance(note, str) or len(note) > 2048:
                    raise ValueError("Valuation source and note must be bounded text")
                at = datetime.fromisoformat(str(value.get("valuation_at", "")).replace("Z", "+00:00"))
                if at.tzinfo is None:
                    raise ValueError("Valuation time needs an explicit timezone")
                row = db.execute("SELECT amount_raw,kind FROM reward_events WHERE event_id=?", (eid,)).fetchone()
                if row is None or row["kind"] != "payout":
                    raise ValueError("Valuation must name an observed payout event")
                eur = Decimal(row["amount_raw"]) / SCALE * price
                vals = (eid, format(eur, "f"), format(price, "f"), source.strip(),
                        at.astimezone(timezone.utc).isoformat(), utcnow(), note)
                db.execute("INSERT OR REPLACE INTO reward_valuations VALUES (?,?,?,?,?,?,?)", vals)
                db.execute("INSERT INTO reward_valuation_audit(event_id,eur_value,price_eur,source,valuation_at,recorded_at,note) VALUES (?,?,?,?,?,?,?)", vals)
                count += 1
    finally:
        db.close()
    return count


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("report", "export", "value"))
    parser.add_argument("--database", required=True, help="Independent reporting.sqlite3, never a live Nodus DB")
    parser.add_argument("--year", type=int)
    parser.add_argument("--file", help="Admin-provided valuations JSON file (value command)")
    args = parser.parse_args()
    if args.command == "value":
        if not args.file:
            parser.error("value requires --file")
        print(json.dumps({"imported": import_valuations(args.database, args.file)}))
    elif args.command == "report":
        print(json.dumps(report(args.database, args.year), ensure_ascii=False, indent=2))
    else:
        import sys
        sys.stdout.buffer.write(export_csv(args.database, args.year))


if __name__ == "__main__":
    main()
