"""Bounded collector for public chain data and local committed storage metadata.

Only this collector touches the Nodus database. HTTP reports read the independent
feature database, never the node, CLI, private identities or arbitrary URLs.
"""
from __future__ import annotations

from datetime import datetime, timezone
import grp
import hashlib
from http.client import HTTPException
import ipaddress
import json
import os
from pathlib import Path
import re
import sqlite3
import time
from urllib.error import URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from . import SCAN_CHAIN_ID
from .geolocation import GeoLocator, locate, address_ip
from .store import writer, set_meta, get_meta, save_observation, timestamp, utcnow

API = "https://scan.nodusnetwork.io/api/"
MAX_SOURCE_BYTES = 2_000_000
MAX_STORAGE_ROWS = 4096


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("Statistics source redirects are refused")


def _unique_json(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate statistics JSON key")
        result[key] = value
    return result


def api_reader(deadline):
    opener = build_opener(NoRedirect())

    def read(endpoint):
        if not isinstance(endpoint, str) or not re.fullmatch(
                r"(?:stats|tps|blocks(?:\?before=[0-9]+&limit=[0-9]+)?|block/[0-9]+(?:\?from=[0-9]+&limit=[0-9]+)?|tx/[0-9]+:[0-9]+)", endpoint):
            raise ValueError("Unsupported statistics endpoint")
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("Statistics collection budget exhausted")
        request = Request(API + endpoint, headers={"User-Agent": "Nodus-Observatory-Statistics/1.0", "Accept": "application/json"})
        with opener.open(request, timeout=min(4.0, remaining)) as response:
            if response.status != 200 or response.geturl() != API + endpoint:
                raise ValueError("Unexpected statistics source response")
            data = bytearray()
            while len(data) <= MAX_SOURCE_BYTES:
                if time.monotonic() >= deadline:
                    raise TimeoutError("Statistics collection budget exhausted")
                block = response.read1(min(65_536, MAX_SOURCE_BYTES + 1 - len(data)))
                if time.monotonic() >= deadline:
                    raise TimeoutError("Statistics collection budget exhausted")
                if not block:
                    break
                data.extend(block)
            if len(data) > MAX_SOURCE_BYTES:
                raise ValueError("Statistics source response exceeds limit")
        payload = json.loads(data.decode("utf-8"), object_pairs_hook=_unique_json,
                             parse_constant=lambda value: (_ for _ in ()).throw(ValueError("Invalid JSON number")))
        if not isinstance(payload, dict):
            raise ValueError("Statistics source is not a JSON object")
        return payload
    return read


def _uint(value, maximum=(1 << 63) - 1):
    if type(value) is not int or not 0 <= value <= maximum:
        raise ValueError("Invalid source integer")
    return value


def _raw(value):
    if not isinstance(value, str) or not re.fullmatch(r"(?:0|[1-9][0-9]{0,79})", value):
        return None
    return value


def _fresh(stamp, max_age=900):
    try:
        parsed = datetime.fromisoformat(timestamp(stamp))
        age = (datetime.now(timezone.utc) - parsed).total_seconds()
        return -60 <= age <= max_age
    except (ValueError, TypeError, OverflowError):
        return False


def _schema(db, table, columns):
    row = db.execute("SELECT type FROM sqlite_master WHERE name=?", (table,)).fetchone()
    if row is None or row[0] != "table":
        raise ValueError("Storage source table is unavailable")
    actual = {row[1]: row[2].upper() for row in db.execute("PRAGMA table_info(" + table + ")")}
    if any(actual.get(name) != kind for name, kind in columns.items()):
        raise ValueError("Storage source schema is not supported")


def read_local_storage(config, snapshot, anchor=None):
    """Read one committed SQLite snapshot with a common-height chain anchor.

    The filename and CLI chain ID bind the configured source to the local node;
    a supplied Scan block anchor additionally compares an immutable block ID.
    Public node keys are hashed to validate registry identities, never returned.
    """
    chain = snapshot.get("chain", {}).get("chain_id")
    if chain != SCAN_CHAIN_ID:
        raise ValueError("Local storage chain is not supported")
    path = Path(config.get("rewards_source_db", ""))
    if not path.is_absolute() or path.name != "witness_" + chain[:32] + ".db":
        raise ValueError("Storage database filename differs from the observed chain")
    path = path.resolve(strict=True)
    db = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=0.1)
    db.row_factory = sqlite3.Row
    try:
        db.execute("PRAGMA query_only=ON")
        db.execute("PRAGMA trusted_schema=OFF")
        deadline, operations = time.monotonic() + 1.5, [0]
        def progress():
            operations[0] += 1000
            return int(operations[0] > 500_000 or time.monotonic() > deadline)
        db.set_progress_handler(progress, 1000)
        db.execute("BEGIN")
        _schema(db, "v2_blocks", {"global_height": "INTEGER", "block_id": "BLOB"})
        _schema(db, "v2_storage_nodes", {"node_fp": "BLOB", "node_pk": "BLOB", "payee_fp": "BLOB", "bond": "INTEGER", "status": "INTEGER", "registered_height": "INTEGER", "exit_height": "INTEGER", "fail_streak": "INTEGER", "grace_until": "INTEGER"})
        _schema(db, "v2_storage_sets", {"epoch_start": "INTEGER", "member_count": "INTEGER"})
        _schema(db, "v2_storage_set_members", {"epoch_start": "INTEGER", "node_fp": "BLOB", "fail_streak": "INTEGER", "grace_until": "INTEGER"})
        tip = db.execute("SELECT global_height FROM v2_blocks ORDER BY global_height DESC LIMIT 1").fetchone()
        if tip is None:
            raise ValueError("Local chain has no committed block")
        tip = _uint(tip[0])
        observed = snapshot.get("chain", {}).get("height")
        if type(observed) is not int or tip < observed:
            raise ValueError("Storage source trails the observed local node")
        anchor_verified = False
        if anchor is not None:
            height, block_id = anchor
            expected = bytes.fromhex(block_id) if isinstance(block_id, str) and re.fullmatch(r"[0-9a-f]{128}", block_id) else None
            if expected is None or _uint(height) > tip:
                raise ValueError("Invalid common-height storage anchor")
            row = db.execute("SELECT block_id FROM v2_blocks WHERE global_height=?", (height,)).fetchone()
            if row is None or row[0] != expected:
                raise ValueError("Storage source block differs from Scan")
            anchor_verified = True
        counts = {row[0]: row[1] for row in db.execute("SELECT status,COUNT(*) FROM v2_storage_nodes GROUP BY status")}
        if any(key not in (1, 2, 3) for key in counts):
            raise ValueError("Unknown storage registry status")
        rows = db.execute("SELECT node_fp,node_pk,payee_fp,bond,status,registered_height,exit_height,fail_streak,grace_until FROM v2_storage_nodes ORDER BY status,node_fp LIMIT ?", (MAX_STORAGE_ROWS + 1,)).fetchall()
        truncated = len(rows) > MAX_STORAGE_ROWS
        rows = rows[:MAX_STORAGE_ROWS]
        frozen = db.execute("SELECT epoch_start,member_count FROM v2_storage_sets WHERE epoch_start<=? ORDER BY epoch_start DESC LIMIT 1", (tip,)).fetchone()
        epoch, member_count, members = None, None, set()
        if frozen:
            epoch, member_count = _uint(frozen[0]), _uint(frozen[1], 256)
            for row in db.execute("SELECT node_fp FROM v2_storage_set_members WHERE epoch_start=? ORDER BY node_fp LIMIT 257", (epoch,)):
                if not isinstance(row[0], bytes) or len(row[0]) != 64:
                    raise ValueError("Invalid frozen storage member")
                members.add(row[0].hex())
            if len(members) != member_count:
                raise ValueError("Frozen storage set count differs from its members")
        nodes = []
        for row in rows:
            fp, pk, payee = row["node_fp"], row["node_pk"], row["payee_fp"]
            if not isinstance(fp, bytes) or len(fp) != 64 or not isinstance(pk, bytes) or len(pk) != 2592 or hashlib.sha3_512(pk).digest() != fp or not isinstance(payee, bytes) or len(payee) != 64:
                raise ValueError("Invalid storage registry public identity")
            node_fp = fp.hex()
            storage = {"status": {1: "active", 2: "exiting", 3: "released"}[row["status"]],
                       "bond_raw": str(_uint(row["bond"])), "registered_height": _uint(row["registered_height"]),
                       "exit_height": _uint(row["exit_height"]), "fail_streak": _uint(row["fail_streak"], (1 << 32) - 1),
                       "grace_until": _uint(row["grace_until"]), "epoch_start": epoch,
                       "member": node_fp in members if frozen else None,
                       "in_grace": epoch < row["grace_until"] if frozen else None,
                       "owner": payee.hex()}
            # cmt_p2p_pubkey_to_id = hex(SHA3-512(pk)[0..31]); full fp
            # equality above makes this join an explicit cryptographic relation.
            nodes.append({"id": node_fp[:64], "fingerprint": node_fp, "roles": ["storage"],
                          "address": None, "status": storage["status"], "storage": storage,
                          "source": "local_committed_storage_registry"})
        return {"available": True, "at_height": tip, "anchor_verified": anchor_verified,
                "anchor_height": anchor[0] if anchor else None, "epoch_start": epoch,
                "members": member_count, "active": counts.get(1, 0), "exiting": counts.get(2, 0),
                "released": counts.get(3, 0), "registered": sum(counts.values()), "truncated": truncated,
                "nodes": nodes, "source": "local_committed_storage_registry"}
    finally:
        db.close()


def _nodes(committee, storage, stamp, locations):
    nodes = {}
    for seat in committee.get("seats", [])[:256]:
        if not isinstance(seat, dict):
            continue
        node_id = seat.get("id")
        if not isinstance(node_id, str) or not re.fullmatch(r"[0-9a-f]{64}", node_id):
            continue
        if node_id in nodes:
            raise ValueError("Duplicate committee node identity")
        address = seat.get("address")
        if address_ip(address) is None:
            address = None
        nodes[node_id] = {"id": node_id, "roles": ["witness"], "address": address,
                          "status": "committee", "stake_raw": _raw(seat.get("stake_raw")),
                          "power": seat.get("power") if type(seat.get("power")) is int and seat["power"] >= 0 else None,
                          "commission_bps": seat.get("commission_bps") if type(seat.get("commission_bps")) is int and 0 <= seat["commission_bps"] <= 10000 else None,
                          "source": "local_committee_query"}
    for item in (storage or {}).get("nodes", []):
        node_id = item["id"]
        if node_id in nodes:
            old = nodes[node_id]
            if old.get("fingerprint") not in (None, item["fingerprint"]):
                raise ValueError("Ambiguous node identity prefix")
            old.update(storage=item["storage"], fingerprint=item["fingerprint"])
            old["roles"].append("storage")
        else:
            nodes[node_id] = dict(item)
    for item in nodes.values():
        item.update(last_seen=stamp, location=locate(item.get("address"), locations))
    return list(nodes.values())


def read_peer_endpoints(config, deadline, locations):
    """Ask only the configured LOCAL node for its own current peer list.

    This CLI response has endpoints, not full identities. It therefore stays
    separate from identity-based node counts and never implies a network census.
    """
    cli = config.get("cli_path")
    if not isinstance(cli, str) or not cli.startswith("/"):
        return {"available": False, "observed_at": None, "items": []}
    remaining = deadline - time.monotonic()
    if remaining <= 0.1:
        return {"available": False, "observed_at": None, "items": []}
    from collector import run_command
    result = run_command([cli, "-s", "127.0.0.1", "servers"], timeout=min(6, remaining), max_bytes=65_536)
    if result.get("error") or result.get("returncode"):
        raise ValueError("Local peer endpoint query failed")
    output = result.get("output", "")
    head = re.search(r"Cluster servers \(([0-9]+)\):", output)
    if not head:
        raise ValueError("Local peer endpoint response is not supported")
    declared = int(head[1])
    if declared > 512:
        raise ValueError("Local peer endpoint response exceeds limit")
    stamp, items, seen = utcnow(), [], set()
    for line in output.splitlines():
        # The current CLI prints IPv6 without brackets ("ip:port"). Split
        # from the right, validate both fields and normalize for display.
        if not line[:1].isspace():
            continue
        text = line.strip()
        try:
            host, port = text.rsplit(":", 1)
            ip = ipaddress.ip_address(host.strip("[]"))
            if not re.fullmatch(r"[0-9]{1,5}", port) or not 1 <= int(port) <= 65535:
                continue
        except ValueError:
            continue
        address = ("[%s]:%d" if ip.version == 6 else "%s:%d") % (ip, int(port))
        if address in seen:
            continue
        seen.add(address)
        items.append({"address": address, "last_seen": stamp, "source": "local_cluster_servers",
                      "location": locate(address, locations), "identity": None})
    if len(items) > declared:
        raise ValueError("Local peer endpoint count differs from response")
    return {"available": True, "observed_at": stamp, "items": items,
            "declared_count": declared, "truncated": len(items) != declared}


def _share(path):
    os.chmod(path, 0o640)
    try:
        os.chown(path, -1, grp.getgrnam("nodus-monitor").gr_gid)
    except (KeyError, PermissionError):
        pass


def collect_statistics(state_dir, config, snapshot):
    """Collect within a wall-clock budget; failures preserve all prior data."""
    stamp = utcnow()
    enabled = config.get("statistics_enabled", True) and config.get("network_enabled", True)
    path = Path(state_dir) / "statistics.sqlite3"
    if not enabled and not path.exists():
        return {"available": False, "status": "disabled", "collected_at": stamp}
    db = writer(path)
    status = {"available": False, "status": "disabled" if not enabled else "unavailable", "collected_at": stamp, "errors": []}
    locations = None
    try:
        if not enabled:
            with db:
                set_meta(db, "collection", status)
            return status
        chain = snapshot.get("chain", {}).get("chain_id")
        if chain != SCAN_CHAIN_ID:
            raise ValueError("Observed local chain does not match the supported Scan network")
        prior_chain = get_meta(db, "chain_id")
        if prior_chain not in (None, chain):
            raise ValueError("Existing statistics belong to another chain")
        seconds = config.get("statistics_collection_seconds", 20)
        if type(seconds) is not int or not 2 <= seconds <= 60:
            raise ValueError("Invalid statistics collection budget")
        deadline = time.monotonic() + seconds
        from .indexer import init_index
        init_index(db)
        read_api = api_reader(deadline)
        network = snapshot.get("network", {})
        source_stamp = network.get("generated_at")
        if not _fresh(source_stamp):
            raise ValueError("No fresh network observation is available")
        errors = network.get("errors", [])
        failed_sources = {item.get("source") for item in errors if isinstance(item, dict)}
        stats = network.get("stats")
        stats_fresh = isinstance(stats, dict) and "scan/stats" not in failed_sources and "stats" not in network.get("last_good", {})
        tps = network.get("tps")
        tps_fresh = isinstance(tps, dict) and "scan/tps" not in failed_sources and "tps" not in network.get("last_good", {})
        if network.get("stale") and not failed_sources:
            stats_fresh = tps_fresh = False
        if stats_fresh and stats.get("chain_id") != chain:
            raise ValueError("Scan chain differs from the observed local node")
        if not stats_fresh:
            stats = None
        if not tps_fresh or stats is None:
            tps = None
        committee = network.get("committee", {})
        if not isinstance(committee, dict) or type(committee.get("height")) is not int or "committee" in failed_sources:
            committee = {"height": None, "count": None, "seats": []}
        if stats is None and committee.get("height") is None:
            raise ValueError("No fresh chain statistics or committee observation")
        storage = None
        locations = GeoLocator(state_dir, config)
        source_db = Path(config.get("rewards_source_db", ""))
        if source_db.is_file():
            try:
                anchor = None
                if stats is not None:
                    local_height = _uint(snapshot.get("chain", {}).get("height"))
                    indexed_height = _uint(stats.get("indexed_height"))
                    h = min(local_height, indexed_height)
                    if h > 0:
                        block = read_api("block/%d?from=0&limit=1" % h).get("block", {})
                        if block.get("height") != h:
                            raise ValueError("Storage anchor height differs")
                        anchor = (h, block.get("block_id"))
                storage = read_local_storage(config, snapshot, anchor)
            except (OSError, ValueError, TypeError, sqlite3.Error, URLError, TimeoutError, HTTPException) as exc:
                status["errors"].append({"source": "storage_registry", "message": type(exc).__name__})
        nodes = _nodes(committee, storage, source_stamp, locations)
        peers = {"available": False, "observed_at": None, "items": []}
        try:
            peers = read_peer_endpoints(config, deadline, locations)
        except (OSError, ValueError, TypeError) as exc:
            status["errors"].append({"source": "peer_endpoints", "message": type(exc).__name__})
        with db:
            set_meta(db, "peer_observation", peers)
            set_meta(db, "geolocation", {**locations.info, "resolved_at": utcnow(),
                     "locations": [{"id": node["id"], "address": node.get("address"),
                                    "location": node.get("location")} for node in nodes]})
        status["errors"].extend(locations.errors)
        observation = {"timestamp": timestamp(source_stamp), "chain_id": chain,
                       "local_height": snapshot.get("chain", {}).get("height"),
                       "stats": stats, "tps": tps, "committee": committee,
                       "storage": storage, "nodes": nodes,
                       "peers_available": peers["available"], "peer_endpoints": peers["items"],
                       "source": "Nodus Scan + local committed observations",
                       "geo_configured": locations.info["configured"],
                       "errors": status["errors"] + errors}
        history_days = config.get("statistics_history_days", 366)
        if type(history_days) is not int or not 1 <= history_days <= 3660:
            raise ValueError("Invalid statistics history retention")
        with db:
            status["new_observation"] = save_observation(db, observation, history_days)
        if stats is not None:
            from .indexer import init_index, sync_index
            init_index(db)
            max_blocks, backfill = config.get("statistics_max_blocks", 32), config.get("statistics_backfill_blocks", 16)
            if type(max_blocks) is not int or not 1 <= max_blocks <= 256 or type(backfill) is not int or not 0 <= backfill <= 256:
                raise ValueError("Invalid statistics indexing budget")
            tip = _uint(stats.get("tip_height"))
            if type(snapshot.get("chain", {}).get("height")) is int:
                tip = max(tip, _uint(snapshot["chain"]["height"]))
            status["index"] = sync_index(db, read_api, chain, tip, max_blocks=max_blocks,
                                         deadline=deadline, start_height=max(1, min(tip, _uint(stats.get("indexed_height"))) - 32),
                                         backfill_blocks=backfill)
        index_error = status.get("index", {}).get("status") not in (None, "ok") or bool(status.get("index", {}).get("error"))
        status.update(available=True, status="partial" if status["errors"] or stats is None or index_error else "ok")
    except (OSError, ValueError, TypeError, sqlite3.Error, URLError, TimeoutError, HTTPException, json.JSONDecodeError) as exc:
        status.update(status="error", errors=status["errors"] + [{"source": "statistics", "message": str(exc)[:200]}])
    finally:
        try:
            if locations is not None:
                previous_errors = len(locations.errors)
                locations.close()
                status["errors"].extend(locations.errors[previous_errors:])
                if status["status"] == "ok" and status["errors"]:
                    status["status"] = "partial"
            with db:
                set_meta(db, "collection", status)
        finally:
            db.close()
            _share(path)
    return status
