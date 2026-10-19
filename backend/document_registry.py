"""Bounded read-only document-registry queries to the local Nodus node.

Only the fixed ``record(address,bytes32)`` getter is exposed.  No signing key,
identity directory, arbitrary ABI, remote endpoint, or transaction command is
accepted.  Registry code and node replies are deliberately not presented as
independently verified proofs.
"""
from __future__ import annotations

import datetime as dt
from pathlib import Path
import re
import threading

from collector import read_json, run_command, utc_now


MAX_CHAIN_AGE_SECONDS = 180
CLI_TIMEOUT_SECONDS = 15
CLI_MAX_BYTES = 32_768
UINT64_MAX = (1 << 64) - 1
RECORD_SIGNATURE = "record(address,bytes32)"
_PROBES = threading.BoundedSemaphore(2)
_HEX64 = re.compile(r"[a-fA-F0-9]{64}")
_SUCCESS = re.compile(r"ok at height ([0-9]{1,20}), gas ([0-9]{1,20})")
_OUTPUT = re.compile(r"  output: 0x([a-fA-F0-9]{256})")


class InvalidQuery(ValueError):
    """Malformed or unsupported public request."""


def _hex64(value, *, prefix):
    if not isinstance(value, str):
        raise InvalidQuery("invalid identifier")
    raw = value[2:] if value.startswith("0x") else value
    if not _HEX64.fullmatch(raw) or (prefix and not value.startswith("0x")):
        raise InvalidQuery("invalid identifier")
    if prefix and int(raw, 16) == 0:
        raise InvalidQuery("zero address is not allowed")
    return ("0x" if prefix else "") + raw.lower()


def validate_query(query):
    """Normalize a strict parse_qs result; reject duplicate and extra fields."""
    required = {"contract", "publisher", "digest"}
    if not isinstance(query, dict) or not required <= set(query) or set(query) - required - {"chain"}:
        raise InvalidQuery("contract, publisher and digest are required")
    if any(not isinstance(values, list) or len(values) != 1 for values in query.values()):
        raise InvalidQuery("each parameter must occur once")
    result = {
        "contract": _hex64(query["contract"][0], prefix=True),
        "publisher": _hex64(query["publisher"][0], prefix=True),
        "digest": "0x" + _hex64(query["digest"][0], prefix=False),
    }
    if "chain" in query:
        result["chain"] = _hex64(query["chain"][0], prefix=False)
    return result


def _unavailable(code, message, http_status=503):
    return {
        "available": False,
        "status": "unavailable",
        "error": {"code": code, "message": message},
    }, http_status


def _chain_context(config):
    snapshot = read_json(Path(config["state_dir"]) / "snapshot.json", {})
    if not isinstance(snapshot, dict):
        raise ValueError("missing snapshot")
    stamp = dt.datetime.fromisoformat(snapshot["generated_at"])
    if stamp.tzinfo is None:
        raise ValueError("missing snapshot timezone")
    age = (dt.datetime.now(dt.timezone.utc) - stamp).total_seconds()
    if not 0 <= age <= MAX_CHAIN_AGE_SECONDS:
        raise ValueError("stale snapshot")
    chain = snapshot["chain"]
    chain_id = _hex64(chain["chain_id"], prefix=False)
    height = chain["height"]
    if type(height) is not int or not 0 < height <= UINT64_MAX:
        raise ValueError("missing height")
    # A node still catching up cannot make reliable negative statements about
    # the latest registry state.  Unknown sync state is not treated as healthy.
    if chain.get("sync_ok") is not True:
        raise ValueError("node sync state unavailable")
    return {"chain_id": chain_id, "height": height, "generated_at": snapshot["generated_at"]}


def parse_record_output(output, snapshot_height):
    """Decode exactly four static ABI words, never partial/typed CLI output."""
    if not isinstance(output, str):
        raise ValueError("invalid output")
    successes = [_SUCCESS.fullmatch(line) for line in output.splitlines()]
    successes = [match for match in successes if match]
    outputs = [_OUTPUT.fullmatch(line) for line in output.splitlines()]
    outputs = [match for match in outputs if match]
    # Duplicate successful-looking answers are ambiguous and are rejected.
    if len(successes) != 1 or len(outputs) != 1:
        raise ValueError("missing or ambiguous result")
    height = int(successes[0].group(1))
    if not snapshot_height <= height <= UINT64_MAX:
        raise ValueError("node is behind chain context")
    raw = outputs[0].group(1)
    exists, block_number, timestamp, revoked = [int(raw[index:index + 64], 16) for index in range(0, 256, 64)]
    if exists not in (0, 1) or revoked not in (0, 1):
        raise ValueError("invalid ABI boolean")
    if not exists:
        if block_number or timestamp or revoked:
            raise ValueError("inconsistent missing record")
    elif not (0 < block_number <= height and 0 < timestamp <= UINT64_MAX):
        raise ValueError("inconsistent record height or timestamp")
    return height, {
        "exists": bool(exists),
        "block_number": str(block_number) if exists else None,
        "timestamp": str(timestamp) if exists else None,
        "revoked": bool(revoked),
    }


def lookup_record(config, query):
    """Return ``(public JSON, HTTP status)`` for one local, read-only lookup."""
    try:
        request = validate_query(query)
    except InvalidQuery:
        return _unavailable("invalid_query", "Use one contract address, publisher address and SHA-256 digest; optional chain pin.", 400)
    try:
        context = _chain_context(config)
    except (KeyError, TypeError, ValueError, OSError):
        return _unavailable("stale_chain_context", "A fresh synchronized local-node measurement is required.")
    if request.get("chain") not in (None, context["chain_id"]):
        return _unavailable("chain_mismatch", "The requested chain differs from the local node's reported chain.", 409)
    if not _PROBES.acquire(blocking=False):
        return _unavailable("busy", "Document lookups are busy; retry shortly.")
    try:
        try:
            result = run_command([
                config["cli_path"], "-s", "127.0.0.1", "-p", "4001", "evm", "call",
                request["contract"], RECORD_SIGNATURE, request["publisher"], request["digest"],
            ], timeout=CLI_TIMEOUT_SECONDS, max_bytes=CLI_MAX_BYTES)
        except (OSError, ValueError):
            return _unavailable("node_unavailable", "The local node could not be queried.")
        if not isinstance(result, dict) or result.get("error") or result.get("returncode") != 0:
            return _unavailable("node_unavailable", "The local node did not complete the read-only query.")
        try:
            height, record = parse_record_output(result.get("output"), context["height"])
        except (TypeError, ValueError):
            return _unavailable("invalid_node_response", "The local node returned an unsupported or inconsistent registry response.")
    finally:
        _PROBES.release()
    return {
        "available": True,
        "status": "not_found" if not record["exists"] else "revoked" if record["revoked"] else "registered",
        "contract": request["contract"],
        "publisher": request["publisher"],
        "digest": request["digest"],
        "record": record,
        "chain": {
            "chain_id": context["chain_id"],
            "height": str(height),
            "snapshot_height": str(context["height"]),
            "snapshot_generated_at": context["generated_at"],
            "chain_id_source": "local_collector_snapshot",
            "chain_id_verified": False,
        },
        "provenance": {
            "source": "local_node",
            "endpoint": "127.0.0.1:4001",
            "independent_verification": False,
            "contract_code_verified": False,
        },
        "checked_at": utc_now(),
    }, 200
