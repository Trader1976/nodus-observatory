"""Read the deployed OSD6 lending experiment through the local Nodus CLI.

The HTTP boundary accepts no addresses, ABI, RPC endpoint, wallet identity or
transaction data.  Every command below is a fixed read-only getter.  In
particular, the SDK's recovery-phrase based signing API is not a browser wallet
connection and is deliberately not used here.

Answers are reports from one local node, not independently proven chain state.
The CLI cannot retrieve runtime bytecode, so this adapter never claims to have
verified the deployed contract's code.  The chain and token pins are additional
consistency checks, not a substitute for that verification.
"""
from __future__ import annotations

import copy
import datetime as dt
from pathlib import Path
import re
import threading
import time

from collector import read_json, run_command, utc_now


CHAIN_ID = "a48d1a785500a1cdecd739ecd53ef0e95b1dc4a7a300f49176a7fa25ae176114"
TOKEN_ADDRESS = "0x8b0a1c0b6ed36896cb60e0bb7f364eb95c4ef6ddf123c7265a76e6dd09a26769"
LENDING_ADDRESS = "0x94635afe032a90f0bd4a3a8c195f0732d208c01b58d7d80a03072dd128a6c4dc"
SOURCE = "connected Nodus node; not independently proven"
MAX_OFFERS = 20
MAX_CHAIN_AGE_SECONDS = 180
COLLECTION_SECONDS = 20
CLI_TIMEOUT_SECONDS = 4
CLI_MAX_BYTES = 16_384
CACHE_SECONDS = 30
ERROR_CACHE_SECONDS = 5
UINT64_MAX = (1 << 64) - 1
UINT256_MAX = (1 << 256) - 1

_SUCCESS = re.compile(r"ok at height ([0-9]{1,20}), gas ([0-9]{1,20})")
_OUTPUT = re.compile(r"  output: 0x([a-fA-F0-9]+)")
_CHAIN_HEX = re.compile(r"[a-fA-F0-9]{64}")
_STATUSES = {1: "open", 2: "active", 3: "repaid", 4: "cancelled", 5: "defaulted"}
_PROBE = threading.Lock()
_CACHE_LOCK = threading.Lock()
# One cache entry keeps resource use bounded even when an embedding application
# supplies different local configurations.  Entries never mix installations.
_CACHE = None


class NodeUnavailable(ValueError):
    """The fixed local getter could not be completed."""


def _base():
    return {
        "available": False,
        "network": "Nodus testnet",
        "chainId": CHAIN_ID,
        "tokenAddress": TOKEN_ADDRESS,
        "lendingAddress": LENDING_ADDRESS,
        "tokenSymbol": "OSD6",
        "tokenDecimals": 6,
        "offers": [],
        "nextOfferId": None,
        "coverage": None,
        "observedAt": None,
        "reason": None,
        "source": SOURCE,
        "contractCodeVerified": False,
        "independentVerification": False,
        "signingAvailable": False,
    }


def _unavailable(code, reason, status=503):
    result = _base()
    result.update(reason=reason, error={"code": code, "message": reason})
    return result, status


def _context(config):
    snapshot = read_json(Path(config["state_dir"]) / "snapshot.json", {})
    stamp = dt.datetime.fromisoformat(snapshot["generated_at"])
    if stamp.tzinfo is None:
        raise ValueError("missing timezone")
    age = (dt.datetime.now(dt.timezone.utc) - stamp).total_seconds()
    if not 0 <= age <= MAX_CHAIN_AGE_SECONDS:
        raise ValueError("stale chain context")
    chain = snapshot["chain"]
    chain_id = chain["chain_id"]
    height = chain["height"]
    if (not isinstance(chain_id, str) or not _CHAIN_HEX.fullmatch(chain_id)
            or type(height) is not int or not 0 < height <= UINT64_MAX
            or chain.get("sync_ok") is not True):
        raise ValueError("invalid chain context")
    return chain_id.lower(), height


def _words(output, count, minimum_height):
    """Decode exactly one successful CLI result and its fixed static ABI words."""
    if not isinstance(output, str):
        raise ValueError("missing output")
    successes = [match for line in output.splitlines()
                 if (match := _SUCCESS.fullmatch(line))]
    outputs = [match for line in output.splitlines()
               if (match := _OUTPUT.fullmatch(line))]
    if len(successes) != 1 or len(outputs) != 1:
        raise ValueError("ambiguous output")
    height = int(successes[0][1])
    gas = int(successes[0][2])
    encoded = outputs[0][1]
    if (not minimum_height <= height <= UINT64_MAX or gas > UINT64_MAX
            or len(encoded) != count * 64):
        raise ValueError("invalid output shape")
    return height, [int(encoded[index:index + 64], 16)
                    for index in range(0, len(encoded), 64)]


def _offer(offer_id, words):
    lender, borrower, principal, collateral, interest, expires, accepted, due, deadline, apr, term, grace, status = words
    if (not lender or status not in _STATUSES
            or not 0 < principal <= 10 ** 24
            or not 0 < collateral <= 10 ** 34 or collateral % 10 ** 10
            or not 1 <= apr <= 5000 or not 1 <= term <= 365 or not 1 <= grace <= 30
            or not 0 < expires <= UINT64_MAX
            or any(value > UINT64_MAX for value in (accepted, due, deadline))
            or interest != (principal * apr * term + 3_650_000 - 1) // 3_650_000):
        raise ValueError("invalid offer terms")
    if status in (1, 4):
        if any((borrower, accepted, due, deadline)):
            raise ValueError("invalid unfunded offer state")
    elif (not borrower or borrower == lender or not 0 < accepted < expires
          or due != accepted + term * 86400 or deadline != due + grace * 86400):
        raise ValueError("invalid loan state")
    return {
        "id": str(offer_id),
        "lender": f"0x{lender:064x}",
        "borrower": f"0x{borrower:064x}",
        "principalRaw": str(principal),
        "collateralWei": str(collateral),
        "interestRaw": str(interest),
        "expiresAt": str(expires),
        "acceptedAt": str(accepted),
        "dueAt": str(due),
        "deadline": str(deadline),
        "aprBps": apr,
        "termDays": term,
        "graceDays": grace,
        "status": _STATUSES[status],
    }


def _get(config, signature, arguments, word_count, context_height, deadline):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise NodeUnavailable("collection budget exhausted")
    try:
        result = run_command([
            config["cli_path"], "-s", "127.0.0.1", "-p", "4001", "evm", "call",
            LENDING_ADDRESS, signature, *arguments,
        ], timeout=min(CLI_TIMEOUT_SECONDS, remaining), max_bytes=CLI_MAX_BYTES)
    except (OSError, ValueError) as exc:
        raise NodeUnavailable("local getter failed") from exc
    if not isinstance(result, dict) or result.get("error") or result.get("returncode") != 0:
        raise NodeUnavailable("local getter failed")
    return _words(result.get("output"), word_count, context_height)


def _collect(config, context_height):
    deadline = time.monotonic() + COLLECTION_SECONDS
    heights = []

    def getter(signature, arguments=(), word_count=1):
        height, words = _get(config, signature, arguments, word_count, context_height, deadline)
        heights.append(height)
        return words

    if getter("SUPPORTED_CHAIN_ID()")[0] != int(CHAIN_ID, 16):
        return _unavailable("contract_chain_mismatch", "The lending contract reported an unexpected chain pin.")
    if getter("token()")[0] != int(TOKEN_ADDRESS, 16):
        return _unavailable("token_mismatch", "The lending contract reported an unexpected loan token.")
    next_id = getter("nextOfferId()")[0]
    if not 1 <= next_id <= UINT256_MAX:
        raise ValueError("invalid next offer id")
    offers = []
    budget_limited = False
    first_wanted = max(1, next_id - MAX_OFFERS)
    # Newest first gives the useful recent state even if the collection budget
    # is reached.  An HTTP client cannot choose a costly historical scan.
    for offer_id in range(next_id - 1, first_wanted - 1, -1):
        if time.monotonic() >= deadline:
            budget_limited = True
            break
        offers.append(_offer(offer_id, getter("getOffer(uint256)", (str(offer_id),), 13)))
    if next_id > 1 and not offers:
        raise NodeUnavailable("collection budget exhausted")
    first_returned = min((int(offer["id"]) for offer in offers), default=None)
    last_returned = max((int(offer["id"]) for offer in offers), default=None)
    complete = next_id - 1 == len(offers)
    result = _base()
    result.update(
        available=True,
        offers=offers,
        nextOfferId=str(next_id),
        observedAt=utc_now(),
        coverage={
            "totalOffers": str(next_id - 1),
            "returnedOffers": len(offers),
            "firstOfferId": str(first_returned) if first_returned is not None else None,
            "lastOfferId": str(last_returned) if last_returned is not None else None,
            "complete": complete,
            "limit": MAX_OFFERS,
            "budgetLimited": budget_limited,
            "fromHeight": str(min(heights)),
            "toHeight": str(max(heights)),
            "atomicSnapshot": False,
        },
    )
    return result, 200


def lookup(config, query):
    """Return ``(JSON payload, HTTP status)``; accept only an empty query map."""
    global _CACHE
    if not isinstance(query, dict) or query:
        return _unavailable("invalid_query", "This endpoint accepts no query parameters.", 400)
    try:
        chain_id, context_height = _context(config)
    except (KeyError, TypeError, ValueError, OSError, AttributeError):
        return _unavailable("stale_chain_context", "A fresh synchronized local-node measurement is required.")
    if chain_id != CHAIN_ID:
        return _unavailable("chain_mismatch", "The local node is not reporting the configured Nodus testnet.", 409)
    key = (str(config.get("state_dir")), str(config.get("cli_path")))

    def cached():
        with _CACHE_LOCK:
            if _CACHE is not None and _CACHE[0] == key and time.monotonic() < _CACHE[1]:
                return copy.deepcopy(_CACHE[2])
        return None

    if (result := cached()) is not None:
        return result
    if not _PROBE.acquire(blocking=False):
        return _unavailable("busy", "The lending read is in progress; retry shortly.")
    try:
        # A previous collector may have filled the cache between our first read
        # and lock acquisition.  Never spawn a second scan unnecessarily.
        if (result := cached()) is not None:
            return result
        try:
            result = _collect(config, context_height)
        except (NodeUnavailable, OSError, KeyError):
            result = _unavailable("node_unavailable", "The local node did not complete the read-only lending query.")
        except (TypeError, ValueError, OverflowError):
            result = _unavailable("invalid_node_response", "The local node returned unsupported or inconsistent lending data.")
        ttl = CACHE_SECONDS if result[1] == 200 else ERROR_CACHE_SECONDS
        with _CACHE_LOCK:
            _CACHE = key, time.monotonic() + ttl, copy.deepcopy(result)
        return result
    finally:
        _PROBE.release()
