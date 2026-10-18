"""Bounded read-only network observations. No credentials or node keys."""
import json
import os
from pathlib import Path
import re
import time
import urllib.request
from datetime import datetime, timezone

API = "https://scan.nodusnetwork.io/api/"


def committee_text(cli):
    from collector import run_command
    result = run_command([cli, "-s", "127.0.0.1", "witness"], timeout=12, max_bytes=1_000_000)
    if result["error"] or result["returncode"]:
        raise ValueError(result["error"] or "Committee query failed")
    return result["output"]


def read_api(endpoint):
    req = urllib.request.Request(API + endpoint, headers={"User-Agent": "Nodus-Observatory/1.0", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=6) as response:
        if response.status != 200:
            raise ValueError("HTTP %d" % response.status)
        raw = response.read(2_000_001)
        if len(raw) > 2_000_000:
            raise ValueError("Response exceeds limit")
        result = json.loads(raw)
        if not isinstance(result, dict):
            raise ValueError("Expected a JSON object")
        return result


def parse_committee(text):
    result = {"height": None, "count": None, "seats": []}
    head = re.search(r"Committee for block (\d+)", text)
    if head:
        result["height"] = int(head[1])
    row = None
    for line in text.splitlines():
        if re.fullmatch(r"\[\d+\]", line.strip()):
            row = {}
            result["seats"].append(row)
        if row is None:
            continue
        match = re.match(r"\s*(p2p id|address|stake|power|commission):\s*(.*)", line)
        if not match:
            continue
        key, value = match.groups()
        if key == "p2p id":
            row["id"] = value
        elif key == "address":
            row["address"] = value
        elif key in ("stake", "power", "commission"):
            number = re.match(r"\d+", value)
            if number:
                row[{"stake": "stake_raw", "power": "power", "commission": "commission_bps"}[key]] = number[0] if key == "stake" else int(number[0])
    if head:
        result["count"] = len(result["seats"])
    return result


def collect_network(state_dir, config):
    state_dir = Path(state_dir)
    cache = state_dir / "network.json"
    previous = None
    try:
        previous = json.loads(cache.read_text())
        if time.time() - cache.stat().st_mtime < 300:
            return previous
    except (OSError, ValueError):
        pass
    now = datetime.now(timezone.utc).isoformat()
    result = {"generated_at": now, "available": False, "stale": False,
              "source": "Nodus Scan + paikallinen komiteakysely", "stats": None,
              "tps": None, "committee": {"height": None, "count": None, "seats": []}, "errors": []}
    for endpoint in ("stats", "tps"):
        try:
            result[endpoint] = read_api(endpoint)
        except Exception as exc:
            result["errors"].append({"source": "scan/" + endpoint, "message": str(exc)[:250]})
    try:
        cli = config.get("cli_path", "/usr/local/bin/nodus-cli")
        result["committee"] = parse_committee(committee_text(cli))
    except Exception as exc:
        result["errors"].append({"source": "committee", "message": str(exc)[:250]})
    result["available"] = result["stats"] is not None or result["committee"]["height"] is not None
    # Retain separate last-good observations, clearly stamped stale, never fabricate 0.
    if previous:
        for key in ("stats", "tps"):
            if result[key] is None and previous.get(key) is not None:
                result[key] = previous[key]
                result["stale"] = True
                result.setdefault("last_good", {})[key] = previous.get("last_good", {}).get(key, previous.get("generated_at"))
    temporary = cache.with_suffix(".tmp")
    temporary.write_text(json.dumps(result, ensure_ascii=False))
    os.chmod(temporary, 0o640)
    os.replace(temporary, cache)
    return result
