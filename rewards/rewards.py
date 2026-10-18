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
import io
import json
import os
from pathlib import Path
import re
import sqlite3
import time
from urllib.parse import quote
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


def _base_report(year):
    year = datetime.now(HELSINKI).year if year is None else int(year)
    if not 1970 <= year <= 9998:
        raise ValueError("Year must be 1970..9998")
    return {"schema_version": 1, "network": "unknown", "scope": "owner_aggregate",
            "owner_fp": None, "node_fp": None, "chain_id": None, "year": year,
            "timezone": "Europe/Helsinki", "source": {"status": "unavailable",
                "reason": "Palkkiolähdettä ei ole vielä kerätty.", "from_height": None,
                "at_height": None, "collected_at": None, "complete_year": False,
                "runs": [], "truncated": False},
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
        runs = [dict(row) for row in db.execute("SELECT from_height,at_height,observed_at FROM reward_coverage ORDER BY from_height")]
        result["source"]["runs"] = runs
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
                   r["from_height"] <= event["height"] <= r["at_height"]]
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
