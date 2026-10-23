#!/usr/bin/env python3
"""Bounded, read-only Nodus probes and an atomic local monitoring store.

The collector never reads private keys or writes to Nodus' configuration/data.
It invokes only fixed read-only commands and owns its own monitoring directory.
"""
from __future__ import annotations

import argparse
import datetime as dt
import grp
import importlib
import json
import math
import os
from pathlib import Path
import re
import select
import signal
import sqlite3
import subprocess
import sys
import time

# The feature is a sibling package in a source checkout and a sibling directory
# of collector.py after installation. Keep its source in its own repository area.
_source_root = Path(__file__).resolve().parent.parent
if (_source_root / "network_statistics" / "__init__.py").is_file():
    sys.path.insert(0, str(_source_root))

DEFAULTS = {
    "state_dir": "/var/lib/nodus-monitor",
    "data_path": "/var/lib/nodus/data",
    "mount_path": "/var/lib/nodus",
    "fingerprint": None,
    "cli_path": "/usr/local/bin/nodus-cli",
    "disk_device": None,
    "network_interface": None,
    "history_days": 30,
    "bind_host": "127.0.0.1",
    "bind_port": 8890,
    "frontend_dir": "/opt/nodus-monitor/frontend",
    "network_enabled": True,
    "rewards_enabled": True,
    "rewards_scan_enabled": True,
    "rewards_source_db": "/var/lib/nodus/data/witness_a48d1a785500a1cdecd739ecd53ef0e9.db",
    "roles": {"storage": True, "witness": True},
    "node_name": "",
    "default_view": "overview",
    "statistics_enabled": True,
    "statistics_collection_seconds": 20,
    "statistics_max_blocks": 32,
    "statistics_backfill_blocks": 16,
    "statistics_geoip_file": None,
    "statistics_history_days": 366,
}
SERVICES = ("nodus-core", "nodus-storage", "nodus-witness", "pqnas", "cloudflared")


def utc_now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def load_config(path, *, include_overrides=True):
    config = dict(DEFAULTS)
    config["roles"] = dict(DEFAULTS["roles"])
    supplied = json.loads(Path(path).read_text()) if path and Path(path).exists() else {}
    if not isinstance(supplied, dict):
        raise ValueError("configuration must be an object")
    config.update(supplied)
    # The HTTP server may write only this validated, allowlisted monitor overlay.
    # Trusted executable/data paths remain in the administrator-owned base file.
    if include_overrides:
        from settings import load_overrides
        config.update(load_overrides(config))
    roles = config["roles"]
    if (not isinstance(roles, dict) or set(roles) != {"storage", "witness"}
            or any(type(value) is not bool for value in roles.values()) or not any(roles.values())):
        raise ValueError("roles must enable storage, witness or both")
    config["roles"] = dict(roles)
    if (not isinstance(config["node_name"], str) or len(config["node_name"]) > 80
            or any(ord(char) < 32 or ord(char) == 127 for char in config["node_name"])):
        raise ValueError("node_name must be at most 80 printable characters")
    config["node_name"] = config["node_name"].strip()
    if config["default_view"] not in ("overview", "storage", "witness"):
        raise ValueError("default_view must be overview, storage or witness")
    if config["default_view"] in roles and not roles[config["default_view"]]:
        config["default_view"] = "overview"
    for key in ("network_enabled", "rewards_enabled", "rewards_scan_enabled", "statistics_enabled"):
        if type(config[key]) is not bool:
            raise ValueError(f"{key} must be a boolean")
    for key, minimum, maximum in (
        ("statistics_collection_seconds", 2, 60),
        ("statistics_max_blocks", 1, 256),
        ("statistics_backfill_blocks", 0, 256),
        ("statistics_history_days", 1, 3660),
    ):
        if type(config[key]) is not int or not minimum <= config[key] <= maximum:
            raise ValueError(f"{key} must be an integer between {minimum} and {maximum}")
    geoip = config["statistics_geoip_file"]
    if geoip is not None and (not isinstance(geoip, str) or not geoip.startswith("/")
            or any(ord(char) < 32 for char in geoip)):
        raise ValueError("statistics_geoip_file must be null or an absolute path")
    if config["fingerprint"] is not None and not re.fullmatch(r"[a-fA-F0-9]{128}", config["fingerprint"]):
        raise ValueError("fingerprint must contain 128 hexadecimal characters")
    if config["disk_device"] is not None and not re.fullmatch(r"[a-zA-Z0-9_.-]+", config["disk_device"]):
        raise ValueError("invalid disk_device")
    if config["network_interface"] and not re.fullmatch(r"[a-zA-Z0-9_.:-]+", config["network_interface"]):
        raise ValueError("invalid network_interface")
    if not str(config["cli_path"]).startswith("/"):
        raise ValueError("cli_path must be absolute")
    for key in ("state_dir", "data_path", "mount_path", "frontend_dir"):
        if not str(config[key]).startswith("/"):
            raise ValueError(f"{key} must be absolute")
    config["history_days"] = max(1, min(366, int(config["history_days"])))
    return config


def run_command(args, timeout=12, max_bytes=512_000):
    """No shell; enforce both a wall-clock deadline and an output byte limit."""
    env = dict(os.environ, LC_ALL="C", LANG="C", LANGUAGE="C", SYSTEMD_COLORS="0", SYSTEMD_PAGER="cat")
    process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                               stdin=subprocess.DEVNULL, env=env, start_new_session=True)
    out = bytearray()
    deadline = time.monotonic() + timeout
    error = None
    try:
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                error = "command timed out"
                break
            ready, _, _ = select.select([process.stdout], [], [], remaining)
            if not ready:
                error = "command timed out"
                break
            block = os.read(process.stdout.fileno(), min(65_536, max_bytes + 1 - len(out)))
            if not block:
                break
            out.extend(block)
            if len(out) > max_bytes:
                error = "command output exceeded limit"
                break
        if error:
            os.killpg(process.pid, signal.SIGKILL)
        try:
            returncode = process.wait(timeout=max(0.1, deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
            error, returncode = "command timed out", -9
    finally:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
        process.stdout.close()
    return {"output": out[:max_bytes].decode("utf-8", "replace"), "returncode": returncode, "error": error}


def number(text):
    return int(text.replace(",", ""))


def quantity_bytes(text):
    match = re.search(r"([0-9]+(?:\.[0-9]+)?)\s*(bytes?|[KMGTPE]i?B)", text, re.I)
    if not match:
        return None
    unit = match.group(2).upper()
    power = "KMGTPE".find(unit[0]) + 1 if unit[0] in "KMGTPE" else 0
    base = 1024 if "I" in unit else 1000
    return round(float(match.group(1)) * base ** power)


def parse_status(text):
    """Version-tolerant parser. Unknown or unavailable fields remain null."""
    node = {key: None for key in ("fingerprint", "p2p_id", "version", "commit", "owner", "external_ip", "uptime_seconds")}
    chain = {key: None for key in ("height", "network_height", "behind", "generation", "chain_id", "sync_ok")}
    storage = {key: None for key in ("registered", "status", "bond_raw", "registered_height", "fail_streak", "grace_until", "in_grace", "grace_epochs_left", "epoch_start", "epoch_end", "members", "is_member", "eligible_segments", "eligible_blocks", "complete_segments", "segment_bytes")}
    resources = {key: None for key in ("chain_db_bytes", "cpu_percent", "cpu_count", "load1", "memory_total_bytes", "memory_available_bytes", "memory_used_percent", "network_interface", "network_rx_bytes", "network_tx_bytes", "network_rx_bps", "network_tx_bps", "disk_read_bps", "disk_write_bps", "disk_util_percent")}
    clock = {"ntp_synchronized": None}
    mappings = {
        "nodus-cli version": (node, "version", str), "installed commit": (node, "commit", str),
        "fingerprint": (node, "fingerprint", str), "P2P ID": (node, "p2p_id", str),
        "owner": (node, "owner", str), "external_ip": (node, "external_ip", str),
        "chain id": (chain, "chain_id", str),
    }
    for line in text.splitlines():
        match = re.match(r"\s*([^:]+):\s*(.*?)\s*$", line)
        if not match:
            continue
        key, value = match.groups()
        if key in mappings:
            dest, field, convert = mappings[key]
            dest[field] = convert(value)
        elif key == "this node's height":
            m = re.match(r"([\d,]+)(?:.*generation\s+(\d+))?", value)
            if m:
                chain["height"] = number(m.group(1))
                gm = re.search(r"generation\s+(\d+)", value)
                chain["generation"] = int(gm.group(1)) if gm else None
        elif key == "network height":
            m = re.match(r"([\d,]+)", value)
            if m:
                chain["network_height"] = number(m.group(1))
        elif key == "nodus-core uptime":
            m = re.match(r"(\d+)d\s+(\d+)h\s+(\d+)m", value)
            if m:
                node["uptime_seconds"] = int(m.group(1)) * 86400 + int(m.group(2)) * 3600 + int(m.group(3)) * 60
        elif key == "behind by":
            m = re.match(r"([\d,]+)", value)
            if m:
                chain["behind"] = number(m.group(1))
        elif key == "storage node":
            if value.startswith("not registered"):
                storage.update(registered=False, status="not_registered")
            else:
                sm = re.match(r"([A-Z_]+), bond\s+([\d,]+) raw, registered at\s+([\d,]+)", value)
                if sm:
                    storage.update(registered=True, status=sm.group(1), bond_raw=sm.group(2).replace(",", ""), registered_height=number(sm.group(3)))
        elif key == "fail_streak":
            m = re.match(r"([\d,]+)", value)
            storage["fail_streak"] = number(m.group(1)) if m else None
        elif key == "grace_until":
            m = re.match(r"([\d,]+)", value)
            storage["grace_until"] = number(m.group(1)) if m else None
            if "IN GRACE" in value:
                storage["in_grace"] = True
        elif key == "storage set":
            m = re.search(r"epoch\s*\(([\d,]+),\s*([\d,]+)\]:\s*([\d,]+) member", value)
            if m:
                storage.update(epoch_start=number(m.group(1)), epoch_end=number(m.group(2)), members=number(m.group(3)))
                if "this node IS a member" in value:
                    storage["is_member"] = True
                elif "this node is NOT a member" in value:
                    storage["is_member"] = False
        elif key == "eligible segments":
            m = re.match(r"([\d,]+)\s*\(([\d,]+) blocks?\)", value)
            if m:
                storage.update(eligible_segments=number(m.group(1)), eligible_blocks=number(m.group(2)))
        elif key == "segments":
            m = re.match(r"([\d,]+) complete", value)
            if m:
                storage["complete_segments"] = number(m.group(1))
                size = value.split(",", 1)
                storage["segment_bytes"] = quantity_bytes(size[1]) if len(size) > 1 else None
            elif value.startswith("none"):
                storage.update(complete_segments=0, segment_bytes=0)
        elif key == "chain database":
            resources["chain_db_bytes"] = quantity_bytes(value)
        elif key == "NTP synchronized":
            if value.startswith("yes"):
                clock["ntp_synchronized"] = True
            elif value.startswith("no"):
                clock["ntp_synchronized"] = False
    if chain["behind"] is not None and chain["network_height"] is not None and chain["height"] is not None:
        chain["sync_ok"] = chain["behind"] <= 2
    finish_grace(storage)
    return {"node": node, "chain": chain, "storage": storage, "resources": resources, "clock": clock}


def finish_grace(storage):
    start, end, until = (storage.get(k) for k in ("epoch_start", "epoch_end", "grace_until"))
    if start is not None and until is not None:
        storage["in_grace"] = start < until
        if end is not None and end > start:
            storage["grace_epochs_left"] = max(0, math.ceil((until - start) / (end - start)))


def parse_storage(text, data):
    storage = data["storage"]
    patterns = {
        "fail_streak": r"fail_streak\s+(\d+)",
        "grace_until": r"grace_until:\s*(\d+)",
        "grace_epochs_left": r"(\d+) grace epoch\(s\) left",
        "eligible_segments": r"eligible segments this epoch:\s*(\d+)",
        "eligible_blocks": r"eligible segments this epoch:\s*\d+\s*\((\d+) blocks?\)",
    }
    for key, pattern in patterns.items():
        m = re.search(pattern, text)
        if m:
            storage[key] = int(m.group(1))
    m = re.search(r"registry:\s*([A-Z_]+), bond\s+(\d+) raw, fail_streak\s+\d+, registered at\s+(\d+)", text)
    if m:
        storage.update(registered=True, status=m.group(1), bond_raw=m.group(2), registered_height=int(m.group(3)))
    owner = re.search(r"^\s*owner:\s*([a-fA-F0-9]{128})\s*$", text, re.M)
    if owner:
        data["node"]["owner"] = owner.group(1)
    finish_grace(storage)


def read_counters(config):
    counters = {"monotonic": time.monotonic(), "boot_id": Path("/proc/sys/kernel/random/boot_id").read_text().strip()}
    cpu = Path("/proc/stat").read_text().splitlines()[0].split()[1:]
    ticks = [int(value) for value in cpu]
    # guest/guest_nice are already included in user/nice.
    counters["cpu_total"] = sum(ticks[:8])
    counters["cpu_idle"] = ticks[3] + ticks[4]
    mem = {}
    for line in Path("/proc/meminfo").read_text().splitlines():
        key, value = line.split(":", 1)
        mem[key] = int(value.strip().split()[0]) * 1024
    resources = {"memory_total_bytes": mem.get("MemTotal"), "memory_available_bytes": mem.get("MemAvailable"),
                 "load1": os.getloadavg()[0], "cpu_count": os.cpu_count(), "hostname": os.uname().nodename,
                 "hardware_model": None}
    try:
        resources["hardware_model"] = Path("/sys/class/dmi/id/product_name").read_text().strip() or None
    except OSError:
        pass
    total, available = resources["memory_total_bytes"], resources["memory_available_bytes"]
    resources["memory_used_percent"] = round(100 * (total - available) / total, 2) if total and available is not None else None
    interface = config.get("network_interface")
    if not interface:
        for line in Path("/proc/net/route").read_text().splitlines()[1:]:
            parts = line.split()
            if len(parts) >= 4 and parts[1] == "00000000" and int(parts[3], 16) & 2:
                interface = parts[0]
                break
    resources["network_interface"] = interface
    resources["network_rx_bytes"] = resources["network_tx_bytes"] = None
    for line in Path("/proc/net/dev").read_text().splitlines()[2:]:
        name, values = line.split(":", 1)
        if name.strip() == interface:
            values = values.split()
            counters["network_rx"] = resources["network_rx_bytes"] = int(values[0])
            counters["network_tx"] = resources["network_tx_bytes"] = int(values[8])
    try:
        if not config.get("disk_device"):
            return resources, counters
        stat = [int(value) for value in (Path("/sys/class/block") / config["disk_device"] / "stat").read_text().split()]
        counters.update(disk_read=stat[2] * 512, disk_write=stat[6] * 512, disk_io_ms=stat[9])
    except (FileNotFoundError, IndexError, ValueError):
        pass
    return resources, counters


def rates(resources, current, previous):
    resources.update(cpu_percent=None, network_rx_bps=None, network_tx_bps=None, disk_read_bps=None, disk_write_bps=None, disk_util_percent=None)
    if not previous or previous.get("boot_id") != current.get("boot_id"):
        return
    elapsed = current["monotonic"] - previous.get("monotonic", current["monotonic"])
    if elapsed <= 0 or elapsed > 3600:
        return
    for source, target in (("network_rx", "network_rx_bps"), ("network_tx", "network_tx_bps"), ("disk_read", "disk_read_bps"), ("disk_write", "disk_write_bps")):
        if source in current and source in previous and current[source] >= previous[source]:
            resources[target] = round((current[source] - previous[source]) / elapsed, 2)
    if "disk_io_ms" in current and "disk_io_ms" in previous and current["disk_io_ms"] >= previous["disk_io_ms"]:
        resources["disk_util_percent"] = round(min(100, (current["disk_io_ms"] - previous["disk_io_ms"]) / elapsed / 10), 2)
    total = current["cpu_total"] - previous.get("cpu_total", current["cpu_total"])
    idle = current["cpu_idle"] - previous.get("cpu_idle", current["cpu_idle"])
    if total > 0 and idle >= 0:
        resources["cpu_percent"] = round(100 * (1 - idle / total), 2)


def parse_services(output, names=SERVICES):
    result = []
    for block in output.strip().split("\n\n"):
        fields = dict(line.split("=", 1) for line in block.splitlines() if "=" in line)
        if fields.get("Id"):
            result.append({"name": fields["Id"].removesuffix(".service"),
                           "active": fields.get("ActiveState"), "enabled": fields.get("UnitFileState"),
                           "load_state": fields.get("LoadState")})
    indexed = {entry["name"]: entry for entry in result}
    return [indexed.get(name, {"name": name, "active": None, "enabled": None, "load_state": None}) for name in names]


def role_service_status(service):
    """Do not confuse an unavailable observation with an active role."""
    if service.get("load_state") == "not-found" or service.get("active") is None:
        return "unavailable"
    if service["active"] == "active":
        return "active"
    if service["active"] == "failed":
        return "failed"
    return "inactive"


def witness_committee(text, node):
    """A public committee seat is an observation, not proof of block production."""
    from network import parse_committee
    committee = parse_committee(text)
    result = {"height": committee["height"], "count": committee["count"],
              "is_member": None, "stake_raw": None, "power": None, "commission_bps": None}
    identity = node.get("p2p_id")
    if committee["height"] is not None and identity:
        seat = next((seat for seat in committee["seats"] if seat.get("id") == identity), None)
        result["is_member"] = seat is not None
        if seat:
            for key in ("stake_raw", "power", "commission_bps"):
                result[key] = seat.get(key)
    return result


def parse_events(output):
    """Keep categorized summaries, never raw arbitrary journal messages."""
    definitions = (
        (r"Time to switch to consensus|block sync done at height", "sync_transition", "info", "Lohkolataus siirtyi konsensustilaan"),
        (r"SendTimeout|timeout 15000", "peer_timeout", "warning", "Vertaisyhteyden aikakatkaisu"),
        (r"block pool error|Failed to add block|error 438|filter 3", "block_response_error", "warning", "Lohkovastauksen käsittelyvirhe"),
        (r"Started Nodus|Starting Nodus|witness.*starting|Starting.*witness", "service_started", "info", "Witness-palvelu käynnistyi"),
        (r"Stopped Nodus|Stopping Nodus|Stopping.*witness", "service_stopped", "warning", "Witness-palvelu pysähtyi"),
        (r"seg.*(?:complete|finished)|(?:complete|finished).*seg", "segment_complete", "info", "Arkistosegmentin valmistuminen havaittu lokissa"),
    )
    events = []
    for line in output.splitlines():
        try:
            item = json.loads(line)
        except json.JSONDecodeError:
            continue
        msg = item.get("MESSAGE", "")
        if not isinstance(msg, str):
            continue
        for pattern, kind, level, summary in definitions:
            if re.search(pattern, msg, re.I):
                micros = item.get("__REALTIME_TIMESTAMP")
                try:
                    timestamp = dt.datetime.fromtimestamp(int(micros) / 1_000_000, dt.timezone.utc).isoformat(timespec="seconds")
                except (TypeError, ValueError, OverflowError):
                    continue
                events.append({"id": item.get("__CURSOR") or f"{micros}:{kind}", "timestamp": timestamp,
                               "kind": kind, "level": level, "message": summary})
                break
    return events


def read_json(path, default=None):
    try:
        return json.loads(Path(path).read_text())
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return default


def share_file(path):
    os.chmod(path, 0o640)
    try:
        os.chown(path, -1, grp.getgrnam("nodus-monitor").gr_gid)
    except (KeyError, PermissionError):
        pass


def atomic_json(path, data):
    path = Path(path)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    with temporary.open("x", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
        handle.flush()
        os.fsync(handle.fileno())
    share_file(temporary)
    os.replace(temporary, path)


def init_database(connection):
    connection.executescript("""
        CREATE TABLE IF NOT EXISTS samples (
            timestamp TEXT PRIMARY KEY, payload TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS events (
            id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, kind TEXT NOT NULL,
            level TEXT NOT NULL, message TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS events_timestamp ON events(timestamp);
    """)


def store_sample(path, snapshot, history_days):
    connection = sqlite3.connect(path, timeout=10)
    try:
        init_database(connection)
        point = {"timestamp": snapshot["generated_at"]}
        point.update({key: snapshot["chain"].get(key) for key in ("height", "network_height", "behind")})
        point.update({key: snapshot["resources"].get(key) for key in ("cpu_percent", "memory_used_percent", "disk_used_bytes", "network_rx_bps", "network_tx_bps", "disk_read_bps", "disk_write_bps", "disk_util_percent", "temperature_c")})
        point.update({key: snapshot["storage"].get(key) for key in ("segment_bytes", "complete_segments", "fail_streak")})
        cutoff = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=history_days)).isoformat(timespec="seconds")
        with connection:
            connection.execute("INSERT OR REPLACE INTO samples VALUES (?, ?)", (point["timestamp"], json.dumps(point, allow_nan=False)))
            for event in snapshot["events"]:
                connection.execute("INSERT OR IGNORE INTO events VALUES (:id,:timestamp,:kind,:level,:message)", event)
            connection.execute("DELETE FROM samples WHERE timestamp < ?", (cutoff,))
            connection.execute("DELETE FROM events WHERE timestamp < ?", (cutoff,))
            connection.execute("DELETE FROM events WHERE id IN (SELECT id FROM events ORDER BY timestamp DESC LIMIT -1 OFFSET 5000)")
    finally:
        connection.close()
    share_file(path)


def collect(config):
    os.umask(0o027)
    state = Path(config["state_dir"])
    state.mkdir(mode=0o750, parents=True, exist_ok=True)
    previous = read_json(state / "collection-state.json", {})
    errors = []

    def probe(source, args, timeout=12, max_bytes=512_000, accept_smart=False, accept_service_output=False):
        try:
            result = run_command(args, timeout, max_bytes)
            # smartctl uses a bitmask: device health flags are data, bits 0-2 are probe errors.
            failure = result["error"] or (result["returncode"] & 7 if accept_smart else result["returncode"])
            # systemctl show can return 1 for an absent optional unit while
            # still reporting all units. LoadState identifies missing required
            # roles below; optional applications are never required for health.
            if accept_service_output and not result["error"] and "Id=" in result["output"]:
                failure = False
            if failure:
                errors.append({"source": source, "message": result["error"] or f"probe exited with code {result['returncode']}"})
                return None
            return result["output"]
        except (OSError, ValueError) as exc:
            errors.append({"source": source, "message": type(exc).__name__})
            return None

    status = probe("nodus-status", [config["cli_path"], "status"], 35)
    snapshot = parse_status(status or "")
    snapshot.update(schema_version=1, generated_at=utc_now(), stale_after_seconds=180, events=[])
    roles = dict(config.get("roles", DEFAULTS["roles"]))
    snapshot["roles"] = roles
    snapshot["node"]["display_name"] = config.get("node_name", "")
    if not roles["storage"]:
        snapshot["storage"] = {key: None for key in snapshot["storage"]}
    snapshot["storage"]["enabled"] = roles["storage"]
    if not snapshot["node"]["fingerprint"]:
        snapshot["node"]["fingerprint"] = config["fingerprint"]
    if status is not None and snapshot["chain"]["height"] is None:
        errors.append({"source": "nodus-status", "message": "status output did not contain a parseable height"})
    local_fp = snapshot["node"]["fingerprint"]
    configured_fp = config.get("fingerprint")
    identity_matches = not configured_fp or not local_fp or configured_fp.lower() == local_fp.lower()
    extra = None
    if roles["storage"] and not identity_matches:
        errors.append({"source": "storage-status", "message": "configured fingerprint differs from the local node"})
    elif roles["storage"] and isinstance(local_fp, str) and re.fullmatch(r"[a-fA-F0-9]{128}", local_fp):
        extra = probe("storage-status", [config["cli_path"], "-s", "127.0.0.1", "storage", "status", "--fp", local_fp], 15)
    elif roles["storage"]:
        errors.append({"source": "storage-status", "message": "local node fingerprint unavailable"})
    if extra:
        parse_storage(extra, snapshot)
    monitored_services = [name for name in SERVICES
                          if name not in ("nodus-storage", "nodus-witness") or roles[name.removeprefix("nodus-")]]
    services = probe("services", ["/usr/bin/systemctl", "show", *[name + ".service" for name in monitored_services],
                     "--property=Id,ActiveState,UnitFileState,LoadState", "--no-pager"], accept_service_output=True)
    snapshot["services"] = parse_services(services or "", monitored_services)
    indexed_services = {service["name"]: service for service in snapshot["services"]}
    snapshot["witness"] = {"enabled": roles["witness"], "status": "disabled", "service": None,
                           "committee": witness_committee("", snapshot["node"]),
                           "source": "local nodus-cli witness"}
    for role in ("storage", "witness"):
        if not roles[role]:
            continue
        service = indexed_services["nodus-" + role]
        service_status = role_service_status(service)
        snapshot[role]["service"] = service
        snapshot[role]["service_status"] = service_status
        if role == "witness":
            snapshot[role]["status"] = service_status
        if service_status != "active":
            errors.append({"source": role + "-service", "message": "configured role service is " + service_status})
    if roles["witness"]:
        committee = probe("witness-committee", [config["cli_path"], "-s", "127.0.0.1", "witness"], 12, 1_000_000)
        if committee is not None:
            snapshot["witness"]["committee"] = witness_committee(committee, snapshot["node"])
            if snapshot["witness"]["committee"]["height"] is None:
                errors.append({"source": "witness-committee", "message": "committee output did not contain a parseable height"})
    ntp = probe("clock", ["/usr/bin/timedatectl", "show", "-p", "NTPSynchronized", "--value"], 5)
    if ntp and ntp.strip() in ("yes", "no"):
        snapshot["clock"]["ntp_synchronized"] = ntp.strip() == "yes"
    try:
        resources, counters = read_counters(config)
        rates(resources, counters, previous.get("counters"))
        snapshot["resources"].update(resources)
    except (OSError, ValueError, IndexError) as exc:
        counters = None
        errors.append({"source": "host-metrics", "message": type(exc).__name__})
    snapshot["resources"].update(disk_total_bytes=None, disk_free_bytes=None, disk_used_bytes=None, disk_mount_ok=None,
                                 temperature_c=None, smart_passed=None, smart_checked_at=None)
    if os.path.ismount(config["mount_path"]):
        snapshot["resources"]["disk_mount_ok"] = True
        try:
            stats = os.statvfs(config["data_path"] if Path(config["data_path"]).is_dir() else config["mount_path"])
            snapshot["resources"].update(disk_total_bytes=stats.f_blocks * stats.f_frsize,
                disk_free_bytes=stats.f_bavail * stats.f_frsize, disk_used_bytes=(stats.f_blocks - stats.f_bfree) * stats.f_frsize)
        except OSError as exc:
            errors.append({"source": "data-disk", "message": type(exc).__name__})
    else:
        snapshot["resources"]["disk_mount_ok"] = False
        errors.append({"source": "data-disk", "message": "expected Nodus data mount is absent"})
    smart = previous.get("smart", {})
    now = time.time()
    if config.get("disk_device") and now - smart.get("sample_epoch", 0) >= 900:
        output = probe("smart", ["/usr/sbin/smartctl", "-j", "-H", "-A", "/dev/" + config["disk_device"]], 10, accept_smart=True)
        if output:
            try:
                info = json.loads(output)
                smart = {"sample_epoch": now, "checked_at": utc_now(), "passed": info.get("smart_status", {}).get("passed"),
                         "temperature": info.get("temperature", {}).get("current")}
            except (json.JSONDecodeError, AttributeError):
                errors.append({"source": "smart", "message": "invalid SMART JSON"})
    if now - smart.get("sample_epoch", 0) < 3600:
        snapshot["resources"].update(temperature_c=smart.get("temperature"), smart_passed=smart.get("passed"), smart_checked_at=smart.get("checked_at"))
    since = previous.get("journal_until")
    try:
        if since:
            start = dt.datetime.fromisoformat(since) - dt.timedelta(seconds=2)
        else:
            start = dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=5)
        # Guard accidental future or ancient state files; bounded collection is intentional.
        start = max(start, dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=10))
        journal_until = utc_now()
        journal_units = ["nodus-core"] + ["nodus-" + role for role in ("storage", "witness") if roles[role]]
        journal_args = [argument for unit in journal_units for argument in ("-u", unit)]
        journal = probe("journal", ["/usr/bin/journalctl", "--system", *journal_args, "--since", start.isoformat(), "--until", journal_until, "--no-pager", "-o", "json", "-n", "300"], 8, 1_000_000)
        if journal:
            snapshot["events"] = parse_events(journal)
    except (ValueError, TypeError):
        journal_until = None
        errors.append({"source": "journal", "message": "invalid previous journal timestamp"})
    snapshot["quality"] = {"partial": bool(errors), "errors": errors}
    snapshot["monitor"] = {"history_days": config["history_days"], "collection_interval_seconds": 60,
                           "event_sampling_limit": 300, "event_window_seconds": 600,
                           "data_path": config["data_path"], "mount_path": config["mount_path"],
                           "node_name": config.get("node_name", ""), "default_view": config.get("default_view", "overview"),
                           "roles": roles}
    if config.get("network_enabled", True):
        try:
            network = importlib.import_module("network")
            snapshot["network"] = network.collect_network(state, config)
        except (ImportError, OSError, ValueError) as exc:
            snapshot["network"] = {"available": False, "errors": [type(exc).__name__]}
    else:
        snapshot["network"] = {"available": False, "errors": ["Network polling disabled"]}
    snapshot["reward_collection"] = {"available": False, "status": "disabled", "reason": "Reward-history index is not enabled in the monitor configuration"}
    if config.get("rewards_enabled"):
        try:
            if not all(snapshot["node"].get(key) for key in ("owner", "fingerprint")) or not snapshot["chain"].get("chain_id"):
                raise ValueError("owner or chain identity unavailable")
            rewards = importlib.import_module("rewards")
            reporting_db = state / "reporting.sqlite3"
            snapshot["reward_collection"] = rewards.collect_rewards(
                config["rewards_source_db"], str(reporting_db), snapshot["chain"]["chain_id"],
                snapshot["node"]["owner"], snapshot["node"]["fingerprint"], network="testnet", max_rows=5000)
            # Backfill from Scan only in the root collector, never in an HTTP
            # request. The importer caches attempts and shares the exact event
            # identity with the local index, so overlap cannot duplicate income.
            try:
                snapshot["reward_collection"]["scan"] = rewards.collect_scan_rewards(
                    str(reporting_db), snapshot["chain"]["chain_id"],
                    snapshot["node"]["owner"], snapshot["node"]["fingerprint"],
                    network="testnet", enabled=(config.get("network_enabled", True)
                        and config.get("rewards_scan_enabled", True)))
            except (OSError, ValueError, sqlite3.Error) as exc:
                snapshot["reward_collection"]["scan"] = {
                    "status": "error", "reason": type(exc).__name__}
            if reporting_db.exists():
                share_file(reporting_db)
        except (ImportError, OSError, ValueError, sqlite3.Error) as exc:
            snapshot["reward_collection"] = {"available": False, "status": "unavailable", "reason": type(exc).__name__}
    try:
        from network_statistics.collector import collect_statistics
        snapshot["statistics_collection"] = collect_statistics(state, config, snapshot)
        for filename in ("statistics.sqlite3", "statistics.json"):
            if (state / filename).is_file():
                share_file(state / filename)
    except (ImportError, OSError, ValueError, sqlite3.Error) as exc:
        # Network analytics must never stop the node's existing monitoring.
        snapshot["statistics_collection"] = {"available": False, "status": "unavailable", "reason": type(exc).__name__}
    store_sample(state / "metrics.sqlite3", snapshot, config["history_days"])
    atomic_json(state / "snapshot.json", snapshot)
    atomic_json(state / "collection-state.json", {"counters": counters, "smart": smart, "journal_until": journal_until})
    return snapshot


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default="/etc/nodus-monitor/config.json")
    args = parser.parse_args()
    snapshot = collect(load_config(args.config))
    print(json.dumps({"generated_at": snapshot["generated_at"], "partial": snapshot["quality"]["partial"],
                      "error_sources": [error["source"] for error in snapshot["quality"]["errors"]]}))


if __name__ == "__main__":
    main()
