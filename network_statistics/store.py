"""Feature-owned storage. The web process only opens this database read-only."""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
import json
from pathlib import Path
import sqlite3
import time

SCHEMA = """
CREATE TABLE IF NOT EXISTS observations (
    timestamp TEXT PRIMARY KEY, chain_id TEXT NOT NULL, payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS statistics_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""


def utcnow():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def timestamp(value):
    if not isinstance(value, str):
        raise ValueError("Observation timestamp is missing")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError("Observation timestamp must include a timezone")
    return parsed.astimezone(timezone.utc).isoformat(timespec="seconds")


def writer(path):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=0.5)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA trusted_schema=OFF")
    db.execute("PRAGMA journal_mode=DELETE")
    db.executescript(SCHEMA)
    return db


def reader(path, seconds=2):
    path = Path(path).resolve(strict=True)
    db = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=0.2)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA query_only=ON")
    db.execute("PRAGMA trusted_schema=OFF")
    deadline, operations = time.monotonic() + seconds, [0]
    def progress():
        operations[0] += 1000
        return int(operations[0] > 20_000_000 or time.monotonic() > deadline)
    db.set_progress_handler(progress, 1000)
    db.execute("BEGIN")
    return db


def set_meta(db, key, value):
    db.execute("INSERT OR REPLACE INTO statistics_meta(key,value) VALUES (?,?)",
               (key, json.dumps(value, ensure_ascii=False, allow_nan=False)))


def get_meta(db, key, default=None):
    row = db.execute("SELECT value FROM statistics_meta WHERE key=?", (key,)).fetchone()
    return json.loads(row[0]) if row else default


def save_observation(db, observation, history_days=366):
    stamp = timestamp(observation["timestamp"])
    chain = observation["chain_id"]
    previous_chain = get_meta(db, "chain_id")
    if previous_chain is not None and previous_chain != chain:
        raise ValueError("Statistics belong to a different chain")
    observation = {**observation, "timestamp": stamp}
    payload = json.dumps(observation, ensure_ascii=False, allow_nan=False)
    # A cached observation is the same observation, never a new minute sample.
    prior = db.execute("SELECT chain_id FROM observations WHERE timestamp=?", (stamp,)).fetchone()
    if prior and prior[0] != chain:
        raise ValueError("Conflicting observation identity")
    if not prior:
        db.execute("INSERT INTO observations VALUES (?,?,?)", (stamp, chain, payload))
    set_meta(db, "chain_id", chain)
    cutoff = (datetime.now(timezone.utc) - timedelta(days=history_days)).isoformat(timespec="seconds")
    db.execute("DELETE FROM observations WHERE timestamp<?", (cutoff,))
    return not bool(prior)


def observations(db, hours=None, limit=1500):
    params = []
    where = ""
    if hours is not None:
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat(timespec="seconds")
        where = " WHERE timestamp>=?"
        params.append(cutoff)
    total = db.execute("SELECT COUNT(*) FROM observations" + where, params).fetchone()[0]
    # Preserve first/last real samples. No interpolation across failed probes.
    stride = max(1, (total + limit - 1) // limit)
    # Rank the small timestamp index, then fetch payloads for selected rows
    # only. Parsing a year's worth of node lists just to discard most rows
    # would turn yearly charts into a multi-gigabyte JSON workload.
    rows = db.execute("SELECT payload FROM observations WHERE timestamp IN ("
                      "SELECT timestamp FROM (SELECT timestamp,ROW_NUMBER() OVER (ORDER BY timestamp) AS rn "
                      "FROM observations" + where + ") WHERE (rn-1)%?=0 OR rn=?) ORDER BY timestamp",
                      [*params, stride, total])
    result = [json.loads(row[0]) for row in rows]
    return result, total, stride


def latest_observation(db):
    row = db.execute("SELECT payload FROM observations ORDER BY timestamp DESC LIMIT 1").fetchone()
    return json.loads(row[0]) if row else None
