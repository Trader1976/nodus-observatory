"""Read-only reports from the feature database. No network or node probes."""
from __future__ import annotations

import csv
import hashlib
import hmac
from datetime import datetime, timezone
import io
import json
from pathlib import Path
import re
import sqlite3

from . import RANGES, SCAN_CHAIN_ID, SCHEMA_VERSION
from .store import reader, get_meta, latest_observation, observations, utcnow, timestamp

SUMMARY_FIELDS = (
    "tx_24h", "tps_1m", "tps_1h", "active_validators", "bonded_validators", "storage_nodes", "observed_nodes",
    "active_native_addresses", "active_evm_addresses", "self_stake_raw", "delegated_raw", "circulating_raw", "reward_pool_raw",
    "transactions", "spends", "claims", "refused", "evm_calls", "evm_creates", "evm_failed", "fee_raw", "known_fee_raw",
    "native_senders", "native_receivers", "first_seen_native_addresses", "first_seen_evm_addresses", "blocks", "empty_blocks",
    "avg_block_ms", "transfer_raw", "known_transfer_raw", "transfers_with_unknown_sender", "gas_used"
)


def _public_node(node):
    # Only public statistics fields cross this boundary. IPs remain private
    # collector inputs, including addresses in observations made before upgrade.
    fields = ("id", "fingerprint", "roles", "status", "stake_raw", "power", "commission_bps",
              "source", "last_seen", "location", "storage", "local", "delegation")
    result = {key: node[key] for key in fields if key in node}
    if isinstance(result.get("storage"), dict):
        public_storage = ("status", "bond_raw", "registered_height", "exit_height", "fail_streak",
                          "grace_until", "epoch_start", "member", "in_grace", "owner")
        result["storage"] = {key: result["storage"][key] for key in public_storage if key in result["storage"]}
    if "location" in result:
        result["location"] = _public_location(result["location"])
    return result


def _public_location(location):
    fields = ("country", "country_code", "city", "latitude", "longitude", "source",
              "approximate", "database_date", "resolved_at")
    return {key: location[key] for key in fields if key in location} if isinstance(location, dict) else None


def _public_endpoint(item, secret):
    fields = ("last_seen", "source", "location", "identity")
    result = {key: item[key] for key in fields if key in item}
    result["identity"] = None
    result["location"] = _public_location(result.get("location"))
    # A plain hash of an IPv4 address can be reversed by enumeration. A
    # collector-owned random installation key keeps the display ID opaque.
    address = item.get("address")
    if isinstance(secret, str) and len(secret) == 64 and isinstance(address, str):
        try:
            key = bytes.fromhex(secret)
            result["id"] = hmac.new(key, address.encode(), hashlib.sha256).hexdigest()
        except ValueError:
            pass
    return result


def _public_diagnostic(item):
    # Exception text may contain connection addresses or machine-local paths.
    # Public reports keep the source and safe exception class, not raw text.
    source = item.get("source") if isinstance(item, dict) else None
    message = item.get("message") if isinstance(item, dict) else None
    return {"source": source if isinstance(source, str) and re.fullmatch(r"[a-z_/-]{1,64}", source) else "statistics",
            "message": message if isinstance(message, str) and re.fullmatch(r"[A-Za-z_]{1,64}", message) else "Source diagnostic"}


def _delegation_for(node, snapshot):
    metadata = {key: snapshot[key] for key in ("at_height", "observed_at", "source", "anchor_verified", "anchor_height", "stale", "lag_blocks") if key in snapshot}
    record = snapshot.get("validators", {}).get(node.get("id")) if snapshot.get("available") else None
    fingerprint = record.get("consensus_fingerprint") if isinstance(record, dict) else None
    if (not isinstance(fingerprint, str) or re.fullmatch(r"[0-9a-f]{128}", fingerprint) is None
            or fingerprint[:64] != node.get("id") or node.get("fingerprint") not in (None, fingerprint)):
        return {**metadata, "available": False}
    fields = ("validator_id", "owner_fp", "self_stake_raw", "delegated_raw", "owner_delegated_raw",
              "external_delegated_raw", "total_stake_raw", "delegator_count", "commission_bps", "status")
    return {**metadata, "available": True, **{key: record[key] for key in fields if key in record},
            "delegations": [{key: row[key] for key in ("owner_fp", "amount_raw", "is_owner") if key in row}
                            for row in record.get("delegations", [])]}


def unavailable(reason="No statistics have been collected yet", range_key="24h"):
    return {"schema_version": SCHEMA_VERSION, "generated_at": utcnow(), "available": False, "stale": True,
            "network": "testnet", "chain_id": None, "range": range_key, "source": "recorded observations",
            "coverage": {"observations_from": None, "observations_to": None, "indexed_from_height": None,
                         "indexed_to_height": None, "tip_height": None, "range_complete": False,
                         "addresses_complete": False, "complete_from_genesis": False, "caught_up": False},
            "summary": {field: None for field in SUMMARY_FIELDS},
            "series": {"activity": [], "network": [], "tps": []}, "nodes": [],
            "breakdown": {"operations": [], "proposers": [], "treasury": []}, "contracts": [],
            "errors": [{"source": "statistics", "message": reason}], "reason": reason,
            "geolocation": {"configured": False, "located_nodes": 0, "unlocated_nodes": 0}}


def _raw(value):
    if isinstance(value, str) and value.isascii() and value.isdecimal() and len(value) <= 80:
        return value
    return None


def _count(value):
    return value if type(value) is int and value >= 0 else None


def _tps(value):
    if isinstance(value, str):
        try:
            number = float(value)
            if 0 <= number < float("inf"):
                return value
        except ValueError:
            pass
    return None


def _summary(observation):
    stats = observation.get("stats") or {}
    tps = observation.get("tps") or {}
    staking = stats.get("staking") or {}
    committee = observation.get("committee") or {}
    storage = observation.get("storage") or {}
    nodes = observation.get("nodes") or []
    return {"tx_24h": None,
            "tps_1m": _tps((tps.get("last_minute") or {}).get("tps")),
            "tps_1h": _tps((tps.get("last_hour") or {}).get("tps")),
            "active_validators": _count(committee.get("count")) if committee.get("height") is not None else _count(staking.get("active_validators")),
            "bonded_validators": _count(staking.get("validators")),
            "storage_nodes": _count(storage.get("members")),
            "storage_registered": _count(storage.get("registered")),
            "storage_active": _count(storage.get("active")),
            "storage_exiting": _count(storage.get("exiting")),
            "storage_released": _count(storage.get("released")),
            "storage_in_grace": sum(1 for node in storage.get("nodes", []) if node.get("storage", {}).get("member") and node["storage"].get("in_grace")) if storage.get("members") is not None and not storage.get("truncated") else None,
            "storage_failing": sum(1 for node in storage.get("nodes", []) if node.get("storage", {}).get("member") and node["storage"].get("fail_streak", 0) >= 3) if storage.get("members") is not None and not storage.get("truncated") else None,
            "observed_nodes": len([node for node in nodes if node.get("status") != "released"]) if committee.get("height") is not None or storage.get("available") else None,
            "observed_endpoints": len(observation.get("peer_endpoints", [])) if observation.get("peers_available") else None,
            "self_stake_raw": _raw(staking.get("self_stake")), "delegated_raw": _raw(staking.get("delegated")),
            "delegations": _count(staking.get("delegations")),
            "circulating_raw": _raw(stats.get("circulating")), "reward_pool_raw": _raw(stats.get("reward_pool")),
            "supply_current_raw": _raw(stats.get("supply_current")), "supply_genesis_raw": _raw(stats.get("supply_genesis")),
            "unclaimed_raw": _raw(stats.get("unclaimed"))}


def report(path, range_key="24h"):
    if range_key not in RANGES:
        raise ValueError("Unknown statistics range")
    db = None
    try:
        if not Path(path).is_file():
            return unavailable(range_key=range_key)
        # Multi-day reports group blocks, items and address touches, then also
        # calculate the separate rolling-day KPI. The generic reader's 20M VM
        # instructions can be exhausted in <1 second on six days of history.
        # Keep a deadline below the browser timeout and a finite work cap.
        db = reader(path, seconds=6, max_operations=500_000_000)
        chain = get_meta(db, "chain_id")
        if chain != SCAN_CHAIN_ID:
            return unavailable("Statistics chain binding is unavailable or unsupported", range_key)
        latest = latest_observation(db)
        if not latest:
            return unavailable(range_key=range_key)
        if latest.get("chain_id") != chain:
            return unavailable("Statistics observation chain mismatch", range_key)
        latest_stamp = timestamp(latest["timestamp"])
        age = max(0, (datetime.now(timezone.utc) - datetime.fromisoformat(latest_stamp)).total_seconds())
        collection = get_meta(db, "collection", {})
        from .indexer import activity_report
        indexed = activity_report(db, range_key)
        network, total, stride = observations(db, RANGES[range_key])
        first = db.execute("SELECT MIN(timestamp),MAX(timestamp) FROM observations WHERE chain_id=?", (chain,)).fetchone()
        summary = {field: None for field in SUMMARY_FIELDS}
        summary.update(_summary(latest))
        summary.update(indexed.get("summary", {}))
        coverage = {"observations_from": first[0], "observations_to": first[1],
                    "network_samples": total, "network_sample_stride": stride,
                    **indexed.get("coverage", {})}
        latest_tip = _count((latest.get("stats") or {}).get("tip_height"))
        local_tip = _count(latest.get("local_height"))
        known_tips = [value for value in (coverage.get("tip_height"), latest_tip, local_tip) if type(value) is int]
        if known_tips:
            coverage["tip_height"] = max(known_tips)
        known_lag = (type(coverage.get("indexed_to_height")) is not int or
                     (known_tips and coverage["indexed_to_height"] < max(known_tips)))
        index_failed = collection.get("index", {}).get("status") == "error"
        if known_lag or index_failed or age > 900 or collection.get("status") == "disabled":
            coverage.update(caught_up=False, range_complete=False)
        # A true rolling-day count is available only when the indexed range
        # covers the complete day. Scan's 24 UTC hour buckets are not 24h.
        day = indexed if range_key == "24h" else activity_report(db, "24h", transactions_only=True)
        if day.get("coverage", {}).get("range_complete") and not known_lag and not index_failed and age <= 900 and collection.get("status") != "disabled":
            summary["tx_24h"] = day.get("summary", {}).get("transactions")
        tps_history = (latest.get("tps") or {}).get("history", [])
        tps_series = []
        for point in tps_history[:24]:
            if not isinstance(point, dict) or type(point.get("start_ms")) is not int:
                continue
            try:
                stamp = datetime.fromtimestamp(point["start_ms"] / 1000, timezone.utc).isoformat(timespec="seconds")
            except (ValueError, OverflowError, OSError):
                continue
            tps_series.append({"timestamp": stamp, "transactions": _count(point.get("tx")),
                               "blocks": _count(point.get("blocks")), "tps": _tps(point.get("tps")),
                               "seconds": _count(point.get("seconds")), "source": "scan_utc_hour_buckets"})
        points = [{"timestamp": item["timestamp"], **_summary(item)} for item in network]
        peers = get_meta(db, "peer_observation", {"available": False, "items": []})
        summary["observed_endpoints"] = len(peers.get("items", [])) if peers.get("available") else None
        nodes = [dict(node) for node in (latest.get("nodes") or [])]
        geo = get_meta(db, "geolocation", {})
        resolved = {(item.get("id"), item.get("address")): item.get("location")
                    for item in geo.get("locations", []) if isinstance(item, dict)}
        local = {item.get("id"): item for item in geo.get("locations", [])
                 if isinstance(item, dict) and item.get("local") is True}
        delegations = get_meta(db, "delegations", {})
        try:
            delegation_age = (datetime.now(timezone.utc) - datetime.fromisoformat(timestamp(delegations.get("observed_at")))).total_seconds()
        except (ValueError, TypeError):
            delegation_age = float("inf")
        delegations["stale"] = delegation_age > 900 or delegation_age < -60 or collection.get("status") in ("disabled", "error")
        source_height = _count(delegations.get("at_height"))
        delegations["lag_blocks"] = max(0, max(known_tips) - source_height) if known_tips and source_height is not None else None
        for node in nodes:
            node["delegation"] = _delegation_for(node, delegations)
            own = local.get(node.get("id"))
            if (own and own.get("fingerprint") is not None
                    and own["fingerprint"] == node.get("fingerprint")
                    and (node.get("address") is None or node.get("address_source") == "local_status_external_ip")):
                node.update(address=own.get("address"), address_source=own.get("address_source"), local=True)
            identity = node.get("id"), node.get("address")
            if identity in resolved:
                node["location"] = resolved[identity]
                if own:
                    node["local"] = True
        located = sum(1 for node in nodes if node.get("location") is not None)
        stats = latest.get("stats") or {}
        endpoint_privacy_key = get_meta(db, "endpoint_privacy_key")
        treasury = stats.get("treasury")
        treasury = [{"pool": i + 1, "amount_raw": _raw(value)} for i, value in enumerate(treasury[:9])] if isinstance(treasury, list) else []
        errors = list(latest.get("errors") or [])
        if collection.get("status") in ("error", "disabled", "partial"):
            errors.extend(collection.get("errors") or [{"source": "collection", "message": collection["status"]}])
        if collection.get("index", {}).get("status") == "error" and collection.get("index", {}).get("error"):
            errors.append({"source": "block_index", "message": collection["index"]["error"]})
        public_geo_fields = ("configured", "available", "status", "provider", "database_date", "database_stale",
                             "auto_update", "cache_hits", "lookups", "update_status", "last_checked_at",
                             "database_type", "build_epoch", "database_age_days", "attribution_url", "license_url",
                             "downloaded_at", "release", "resolved_at", "csv_override")
        return {"schema_version": SCHEMA_VERSION, "generated_at": utcnow(), "observed_at": latest_stamp,
                "age_seconds": round(age), "available": True,
                "stale": age > 900 or collection.get("status") == "disabled",
                "network": "testnet", "chain_id": chain, "range": range_key,
                "source": "Nodus Scan + local committed observations", "coverage": coverage, "summary": summary,
                "series": {"activity": indexed.get("activity", []), "network": points, "tps": tps_series},
                "nodes": [_public_node(node) for node in nodes],
                "peer_endpoints": [_public_endpoint(item, endpoint_privacy_key)
                                   for item in peers.get("items", [])],
                "privacy": {"ip_addresses": "omitted", "geolocation": "approximate"},
                "breakdown": {"operations": indexed.get("operations", []),
                                              "proposers": indexed.get("proposers", []), "treasury": treasury},
                "contracts": indexed.get("contracts", []), "errors": [_public_diagnostic(item) for item in errors],
                "geolocation": {**{key: geo[key] for key in public_geo_fields if key in geo},
                                "configured": geo.get("configured", latest.get("geo_configured", False)),
                                "located_nodes": located, "unlocated_nodes": len(nodes) - located},
                "collection": {"status": collection.get("status"), "collected_at": collection.get("collected_at")},
                "index_progress": {key: collection.get("index", {}).get(key) for key in ("status", "blocks_added")},
                "peer_observation": {"available": peers.get("available", False), "observed_at": peers.get("observed_at"),
                                     "truncated": peers.get("truncated", False)},
                "definitions": {"nodes": "Known committee and storage identities, not a complete network census or an online count",
                                "addresses": "Observed native and EVM addresses are separate; they are not unique people or all created wallets",
                                "first_seen": "First occurrence within the indexed block range",
                                "delegations": "Current committed local-chain delegator wallet fingerprints, not people's names; source height may trail Scan",
                                "map": "Approximate local DB-IP City Lite or operator CSV IP locations; missing locations stay unknown",
                                "transfer_raw": "Native spend outputs to known non-sender addresses, excluding change; unresolved senders stay unknown",
                                "tps": "Applied envelopes; claims and refused items excluded; UTC hour buckets include a partial current hour"}}
    except (OSError, ValueError, TypeError, sqlite3.Error, json.JSONDecodeError, ImportError):
        return unavailable("Statistics data is temporarily unavailable", range_key)
    finally:
        if db is not None:
            db.close()


def export_csv(path, range_key="24h"):
    data = report(path, range_key)
    if not data["available"]:
        raise ValueError("Statistics export is unavailable")
    output = io.StringIO(newline="")
    fields = ["timestamp", "transactions", "spends", "claims", "refused", "blocks", "empty_blocks",
              "active_native_addresses", "active_evm_addresses", "first_seen_native_addresses", "first_seen_evm_addresses",
              "evm_calls", "evm_creates", "evm_failed", "avg_block_ms", "fee_raw", "known_fee_raw", "transfer_raw", "known_transfer_raw"]
    csv_writer = csv.writer(output, lineterminator="\r\n")
    csv_writer.writerow(["network", "chain_id", "range", "indexed_from_height", "indexed_to_height", "range_complete", *fields])
    prefix = [data["network"], data["chain_id"], range_key, data["coverage"].get("indexed_from_height"),
              data["coverage"].get("indexed_to_height"), data["coverage"].get("range_complete")]
    for point in data["series"]["activity"]:
        csv_writer.writerow(prefix + [point.get(field) for field in fields])
    return output.getvalue()
