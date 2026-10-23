"""Bounded, read-only observations for the Nodus/BSC testnet trade workbench.

The local Nodus CLI currently cannot read deployed runtime code. Its parsed
state is therefore explicitly unverified and cannot authorize settlement.
BSC observations use one fixed testnet RPC provider and finalized state. Neither
path is a light-client proof; RPC/node answers remain a trust assumption.
"""
from __future__ import annotations

import json
import re
import threading
import time
from urllib import error as urlerror
from urllib import request as urlrequest

from collector import run_command
from document_registry import _chain_context

NODUS_CHAIN = "a48d1a785500a1cdecd739ecd53ef0e95b1dc4a7a300f49176a7fa25ae176114"
BSC_ENDPOINTS = (
    "https://bsc-testnet-dataseed.bnbchain.org",
    "https://bsc-testnet.bnbchain.org",
)
MAX_RUNTIME_BYTES = 24_576
MAX_RPC_BYTES = 128_000
CLI_MAX_BYTES = 52_000
CLI_TIMEOUT_SECONDS = 10
LOOKUP_SECONDS = 15
UINT64_MAX = (1 << 64) - 1
_PROBES = threading.BoundedSemaphore(2)
_SUCCESS = re.compile(r"ok at height ([0-9]{1,20}), gas ([0-9]{1,20})")
_OUTPUT = re.compile(r"  output: 0x([a-fA-F0-9]+)")
_STATES = ("empty", "locked", "claimed", "refunded")


class ObservationError(ValueError):
    """An unavailable or inconsistent source; never expose its raw response."""


class NoRedirect(urlrequest.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ObservationError("redirect refused")


def _unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ObservationError("duplicate JSON field")
        result[key] = value
    return result


def _hex(value, digits, *, nonzero=False):
    if not isinstance(value, str) or re.fullmatch(r"0x[a-fA-F0-9]{" + str(digits) + r"}", value) is None:
        raise ObservationError("invalid identifier")
    if nonzero and int(value[2:], 16) == 0:
        raise ObservationError("zero identifier")
    return value.lower()


def validate_query(query):
    if not isinstance(query, dict) or set(query) not in (
        {"chain", "contract", "funder", "trade_id"},
        {"chain", "contract", "funder", "trade_id", "token"},
    ):
        raise ObservationError("invalid fields")
    if any(not isinstance(values, list) or len(values) != 1 or not isinstance(values[0], str) for values in query.values()):
        raise ObservationError("invalid parameters")
    chain = query["chain"][0]
    if chain not in ("nodus", "bsc") or ("token" in query) != (chain == "bsc"):
        raise ObservationError("invalid chain")
    size = 64 if chain == "nodus" else 40
    result = {"chain": chain, "contract": _hex(query["contract"][0], size, nonzero=True),
              "funder": _hex(query["funder"][0], size, nonzero=True),
              "tradeId": _hex(query["trade_id"][0], 64, nonzero=True)}
    if chain == "bsc":
        result["token"] = _hex(query["token"][0], 40, nonzero=True)
    return result


def _unavailable(code, status=503):
    messages = {
        "invalid_query": "Use one supported testnet, contract, funder, trade ID and BSC token address.",
        "busy": "Trade observations are busy; retry shortly.",
        "stale_chain_context": "A fresh synchronized local Nodus node measurement is required.",
        "wrong_network": "The source does not report the expected testnet.",
        "source_unavailable": "The source did not return a consistent finalized observation. Retry later.",
    }
    return {"schema": "nodus-trade/observation-v1", "available": False,
            "status": "unavailable", "error": {"code": code, "message": messages[code]}}, status


def parse_swap(raw, chain):
    if chain not in ("nodus", "bsc"):
        raise ObservationError("unsupported chain")
    raw = _hex(raw, 320)
    words = [raw[2 + i * 64:2 + (i + 1) * 64] for i in range(5)]
    if chain == "bsc" and int(words[0][:24], 16) != 0:
        raise ObservationError("noncanonical address")
    recipient = "0x" + (words[0] if chain == "nodus" else words[0][24:])
    amount, refund_at, state = int(words[1], 16), int(words[3], 16), int(words[4], 16)
    if refund_at > UINT64_MAX or state >= len(_STATES):
        raise ObservationError("noncanonical word")
    if state == 0:
        if any(int(word, 16) for word in words):
            raise ObservationError("inconsistent empty record")
    elif not amount or not int(words[0], 16) or not int(words[2], 16) or not refund_at:
        raise ObservationError("inconsistent funded record")
    return {"recipient": recipient, "amountUnits": str(amount), "hashlock": "0x" + words[2],
            "refundAt": str(refund_at), "status": _STATES[state]}


def parse_cli_call(output, words, minimum_height):
    if not isinstance(output, str):
        raise ObservationError("invalid CLI output")
    lines = output.splitlines()
    successes = [m for line in lines if (m := _SUCCESS.fullmatch(line))]
    results = [m for line in lines if (m := _OUTPUT.fullmatch(line))]
    if len(successes) != 1 or len(results) != 1 or len(results[0].group(1)) != 64 * words:
        raise ObservationError("ambiguous CLI answer")
    height = int(successes[0].group(1))
    if not minimum_height <= height <= UINT64_MAX or height - minimum_height > 100:
        raise ObservationError("inconsistent CLI height")
    return height, "0x" + results[0].group(1).lower()


def _clock(timestamp, now):
    if not isinstance(timestamp, int) or timestamp <= 0 or timestamp > UINT64_MAX or not -30 <= now - timestamp <= 180:
        raise ObservationError("stale chain clock")
    return timestamp


def _cli(config, args, deadline):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise ObservationError("lookup timed out")
    result = run_command([config["cli_path"], "-s", "127.0.0.1", "-p", "4001", "evm", *args, "--gas", "100000"],
                         timeout=min(CLI_TIMEOUT_SECONDS, remaining), max_bytes=CLI_MAX_BYTES)
    if not isinstance(result, dict) or result.get("returncode") != 0 or result.get("error"):
        raise ObservationError("CLI read failed")
    return result.get("output")


def _nodus(config, request, context, deadline, now):
    # nodus-cli 0.26.24 has no evm code/codehash read. Never invent one or
    # trust a contract's own claim about its runtime. State alone stays blocked.
    getter = ["call", request["contract"], "getSwap(address,bytes32)", request["funder"], request["tradeId"]]
    height, raw = parse_cli_call(_cli(config, getter, deadline), 5, context["height"])
    clock_height, clock_raw = parse_cli_call(_cli(config, ["call", request["contract"], "currentBlockTime()"], deadline), 1, height)
    end_height, raw_again = parse_cli_call(_cli(config, getter, deadline), 5, clock_height)
    if raw_again != raw or end_height - height > 3:
        raise ObservationError("record changed while reading")
    timestamp = _clock(int(clock_raw, 16), now)
    return {**request, **parse_swap(raw, "nodus"), "chainId": NODUS_CHAIN,
            "height": str(height), "latestHeight": str(end_height), "timestamp": str(timestamp),
            "runtime": None, "runtimeVerified": False, "confirmed": False,
            "blocker": "nodus_runtime_unavailable", "source": "local_node",
            "chainIdSource": "local_collector_snapshot", "chainIdVerified": False,
            "snapshotGeneratedAt": context["generated_at"]}


def _rpc(endpoint, method, params, deadline):
    if endpoint not in BSC_ENDPOINTS:
        raise ObservationError("unsupported RPC endpoint")
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise ObservationError("lookup timed out")
    data = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}, separators=(",", ":")).encode("ascii")
    req = urlrequest.Request(endpoint, data=data, headers={"Content-Type": "application/json", "Accept": "application/json"}, method="POST")
    opener = urlrequest.build_opener(NoRedirect())
    with opener.open(req, timeout=min(3, remaining)) as response:
        if response.status != 200 or response.geturl() != endpoint:
            raise ObservationError("invalid RPC response")
        raw = bytearray()
        while True:
            if time.monotonic() >= deadline:
                raise ObservationError("lookup timed out")
            chunk = response.read1(min(16_384, MAX_RPC_BYTES + 1 - len(raw)))
            if not chunk:
                break
            raw.extend(chunk)
            if len(raw) > MAX_RPC_BYTES:
                raise ObservationError("RPC response too large")
    result = json.loads(raw.decode("utf-8"), object_pairs_hook=_unique,
                        parse_constant=lambda _: (_ for _ in ()).throw(ObservationError("non-finite JSON")))
    if not isinstance(result, dict) or set(result) != {"jsonrpc", "id", "result"} or result["jsonrpc"] != "2.0" or type(result["id"]) is not int or result["id"] != 1:
        raise ObservationError("unsupported RPC answer")
    return result["result"]


def _quantity(value):
    if not isinstance(value, str) or re.fullmatch(r"0x(?:0|[1-9a-fA-F][a-fA-F0-9]*)", value) is None or len(value) > 66:
        raise ObservationError("invalid RPC quantity")
    return int(value, 16)


def _runtime(value):
    if not isinstance(value, str) or re.fullmatch(r"0x(?:[a-fA-F0-9]{2})+", value) is None or len(value) > 2 + MAX_RUNTIME_BYTES * 2:
        raise ObservationError("missing or invalid runtime")
    return value.lower()


def _block(value, now):
    if not isinstance(value, dict):
        raise ObservationError("missing block")
    number = _quantity(value.get("number"))
    if not 0 < number <= UINT64_MAX:
        raise ObservationError("invalid block height")
    block_hash = _hex(value.get("hash"), 64, nonzero=True)
    timestamp = _clock(_quantity(value.get("timestamp")), now)
    return number, block_hash, timestamp


def _bsc_at(endpoint, request, deadline, now):
    rpc = lambda method, params: _rpc(endpoint, method, params, deadline)
    if _quantity(rpc("eth_chainId", [])) != 97:
        raise ObservationError("wrong BSC network")
    height, block_hash, finalized_time = _block(rpc("eth_getBlockByNumber", ["finalized", False]), now)
    block = hex(height)
    runtime = _runtime(rpc("eth_getCode", [request["contract"], block]))
    token_word = _hex(rpc("eth_call", [{"to": request["contract"], "data": "0xfc0c546a"}, block]), 64)
    if int(token_word[2:26], 16) or "0x" + token_word[-40:] != request["token"]:
        raise ObservationError("wrong fixed token")
    token_runtime = _runtime(rpc("eth_getCode", [request["token"], block]))
    decimals_word = _hex(rpc("eth_call", [{"to": request["token"], "data": "0x313ce567"}, block]), 64)
    if int(decimals_word, 16) != 18:
        raise ObservationError("wrong token precision")
    call = {"to": request["contract"], "data": "0xed86b78c" + request["funder"][2:].rjust(64, "0") + request["tradeId"][2:]}
    raw = _hex(rpc("eth_call", [call, block]), 320)
    record = parse_swap(raw, "bsc")
    latest_height, _, latest_time = _block(rpc("eth_getBlockByNumber", ["latest", False]), now)
    if latest_height < height or latest_time < finalized_time:
        raise ObservationError("inconsistent latest block")
    latest_raw = _hex(rpc("eth_call", [call, hex(latest_height)]), 320)
    if latest_raw != raw:
        raise ObservationError("swap changed after finalized state")
    repeated_height, repeated_hash, repeated_time = _block(rpc("eth_getBlockByNumber", [block, False]), now)
    if (repeated_height, repeated_hash, repeated_time) != (height, block_hash, finalized_time):
        raise ObservationError("finalized block changed while reading")
    return {**request, **record, "chainId": "97", "runtime": runtime, "tokenRuntime": token_runtime,
            "decimals": 18, "height": str(height), "latestHeight": str(latest_height),
            "timestamp": str(latest_time), "finalizedBlockHash": block_hash,
            "confirmed": True, "source": "bsc_rpc"}


def lookup(config, query):
    """Return an observation and HTTP status; accept no signing or RPC input."""
    try:
        request = validate_query(query)
    except (ObservationError, TypeError, ValueError):
        return _unavailable("invalid_query", 400)
    if not _PROBES.acquire(blocking=False):
        return _unavailable("busy", 429)
    now, deadline = int(time.time()), time.monotonic() + LOOKUP_SECONDS
    try:
        if request["chain"] == "nodus":
            try:
                context = _chain_context(config)
            except (KeyError, TypeError, ValueError, OSError):
                return _unavailable("stale_chain_context")
            if context["chain_id"] != NODUS_CHAIN:
                return _unavailable("wrong_network", 409)
            observation = _nodus(config, request, context, deadline, now)
        else:
            observation = None
            for endpoint in BSC_ENDPOINTS:
                try:
                    observation = _bsc_at(endpoint, request, deadline, now)
                    break
                except (ObservationError, OSError, ValueError, UnicodeError, urlerror.URLError):
                    continue
            if observation is None:
                return _unavailable("source_unavailable")
        return {"schema": "nodus-trade/observation-v1", "available": True, **observation,
                "independentVerification": False, "checkedAt": now}, 200
    except (ObservationError, OSError, ValueError, KeyError, TypeError, UnicodeError):
        return _unavailable("source_unavailable")
    finally:
        _PROBES.release()
