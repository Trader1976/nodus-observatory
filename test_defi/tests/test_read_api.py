"""Exercise the real read-only facade using synthetic CLI replies, never keys/RPC."""
import datetime as dt
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
SPEC = importlib.util.spec_from_file_location("defi_read_api", ROOT / "test_defi" / "read_api.py")
api = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(api)

SECRET = "private-key must never reach the browser"
LENDER = int("08" * 32, 16)
BORROWER = int("2a" * 32, 16)


def reply(words, height=101, **result):
    encoded = "".join(f"{word:064x}" for word in words)
    return {"output": f"{SECRET}\nok at height {height}, gas 1234\n  output: 0x{encoded}\n",
            "returncode": 0, "error": None, **result}


def offer(status=1, **changes):
    row = {"lender": LENDER, "borrower": 0, "principal": 100_000_000,
           "collateral": 100 * 10 ** 18, "interest": 657_535,
           "expires": 1_793_615_102, "accepted": 0, "due": 0, "deadline": 0,
           "apr": 800, "term": 30, "grace": 3, "status": status}
    if status in (2, 3, 5):
        row.update(borrower=BORROWER, accepted=1_793_011_491,
                   due=1_795_603_491, deadline=1_795_862_691)
    row.update(changes)
    return list(row.values())


class LendingReadTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.state = Path(self.temp.name)
        self.config = {"state_dir": str(self.state), "cli_path": "/usr/local/bin/nodus-cli"}
        self.snapshot = {"generated_at": api.utc_now(),
                         "chain": {"chain_id": api.CHAIN_ID, "height": 100, "sync_ok": True}}
        self.save()
        api._CACHE = None

    def tearDown(self):
        api._CACHE = None
        self.temp.cleanup()

    def save(self):
        (self.state / "snapshot.json").write_text(json.dumps(self.snapshot))

    def invoke(self, *, count=2, rows=None, responses=None, query=None):
        responses = responses if responses is not None else [
            reply([int(api.CHAIN_ID, 16)]), reply([int(api.TOKEN_ADDRESS, 16)]),
            reply([count]), *[reply(row) for row in (rows if rows is not None else [offer(3)])],
        ]
        with patch.object(api, "run_command", side_effect=responses) as command:
            result, status = api.lookup(self.config, {} if query is None else query)
        return result, status, command

    def test_repaid_loan_has_exact_precision_and_only_fixed_local_getters(self):
        result, status, command = self.invoke()
        self.assertEqual(status, 200)
        self.assertTrue(result["available"])
        self.assertEqual(result["offers"][0], {
            "id": "1", "lender": f"0x{LENDER:064x}", "borrower": f"0x{BORROWER:064x}",
            "principalRaw": "100000000", "collateralWei": "100000000000000000000",
            "interestRaw": "657535", "expiresAt": "1793615102", "acceptedAt": "1793011491",
            "dueAt": "1795603491", "deadline": "1795862691", "aprBps": 800,
            "termDays": 30, "graceDays": 3, "status": "repaid",
        })
        self.assertEqual(result["nextOfferId"], "2")
        self.assertTrue(result["coverage"]["complete"])
        self.assertFalse(result["coverage"]["atomicSnapshot"])
        self.assertFalse(result["contractCodeVerified"])
        self.assertFalse(result["independentVerification"])
        self.assertFalse(result["signingAvailable"])
        self.assertNotIn(SECRET, json.dumps(result))
        prefix = [self.config["cli_path"], "-s", "127.0.0.1", "-p", "4001", "evm", "call", api.LENDING_ADDRESS]
        self.assertEqual([call.args[0] for call in command.call_args_list], [
            prefix + ["SUPPORTED_CHAIN_ID()"], prefix + ["token()"],
            prefix + ["nextOfferId()"], prefix + ["getOffer(uint256)", "1"],
        ])
        for call in command.call_args_list:
            self.assertGreater(call.kwargs["timeout"], 0)
            self.assertLessEqual(call.kwargs["timeout"], 4)
            self.assertEqual(call.kwargs["max_bytes"], api.CLI_MAX_BYTES)
            self.assertNotIn("--keys", call.args[0])
            self.assertNotIn("-i", call.args[0])

    def test_each_contract_state_and_nonexistent_offer_are_checked(self):
        for number, name in ((1, "open"), (2, "active"), (3, "repaid"), (4, "cancelled"), (5, "defaulted")):
            with self.subTest(status=number):
                api._CACHE = None
                self.assertEqual(self.invoke(rows=[offer(number)])[0]["offers"][0]["status"], name)
        for row in ([0] * 13, offer(0), offer(6), offer(256)):
            with self.subTest(row=row):
                api._CACHE = None
                result, status, _ = self.invoke(rows=[row])
                self.assertEqual(status, 503)
                self.assertEqual(result["error"]["code"], "invalid_node_response")
                self.assertEqual(result["offers"], [])

    def test_empty_contract_and_bounded_recent_coverage(self):
        empty, status, command = self.invoke(count=1, rows=[])
        self.assertEqual(status, 200)
        self.assertEqual(empty["offers"], [])
        self.assertTrue(empty["coverage"]["complete"])
        self.assertEqual(command.call_count, 3)
        api._CACHE = None
        recent, status, command = self.invoke(count=10 ** 30, rows=[offer()] * 20)
        self.assertEqual(status, 200)
        self.assertEqual(command.call_count, 23)
        self.assertEqual(len(recent["offers"]), 20)
        self.assertFalse(recent["coverage"]["complete"])
        self.assertEqual(recent["coverage"]["firstOfferId"], str(10 ** 30 - 20))
        self.assertEqual(recent["coverage"]["lastOfferId"], str(10 ** 30 - 1))

    def test_any_public_parameters_are_rejected_before_cache_or_cli(self):
        for query in ({"limit": ["20"]}, {"id": ["1"]}, {"contract": [api.LENDING_ADDRESS]},
                      {"rpc": ["http://attacker"]}, {"method": ["send"]}, {"id": ["1", "2"]}, None, []):
            with self.subTest(query=query), patch.object(api, "run_command") as command:
                result, status = api.lookup(self.config, query)
                self.assertEqual(status, 400)
                self.assertFalse(result["available"])
                command.assert_not_called()

    def test_chain_context_failures_do_not_spawn_cli(self):
        for change in (
            {"generated_at": "2020-01-01T00:00:00+00:00"},
            {"generated_at": (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=1)).isoformat()},
            {"generated_at": "2026-10-27T00:00:00"},
            {"chain": {"chain_id": api.CHAIN_ID, "height": 100, "sync_ok": False}},
            {"chain": {"chain_id": api.CHAIN_ID, "height": True, "sync_ok": True}},
            {"chain": {"chain_id": api.CHAIN_ID, "height": 0, "sync_ok": True}},
            {"chain": {"chain_id": api.CHAIN_ID, "height": 2 ** 64, "sync_ok": True}},
            {"chain": {"chain_id": None, "height": 100, "sync_ok": True}},
        ):
            with self.subTest(change=change), patch.object(api, "run_command") as command:
                original = self.snapshot
                self.snapshot = {**original, **change}
                self.save()
                result, status = api.lookup(self.config, {})
                self.assertEqual((status, result["error"]["code"]), (503, "stale_chain_context"))
                command.assert_not_called()
                self.snapshot = original
        self.snapshot["chain"]["chain_id"] = "ab" * 32
        self.save()
        with patch.object(api, "run_command") as command:
            result, status = api.lookup(self.config, {})
            self.assertEqual((status, result["error"]["code"]), (409, "chain_mismatch"))
            command.assert_not_called()

    def test_contract_chain_and_token_pins_are_checked_before_reading_offers(self):
        cases = [([reply([0])], "contract_chain_mismatch", 1),
                 ([reply([int(api.CHAIN_ID, 16)]), reply([1])], "token_mismatch", 2)]
        for responses, code, calls in cases:
            with self.subTest(code=code):
                api._CACHE = None
                result, status, command = self.invoke(responses=responses)
                self.assertEqual((status, result["error"]["code"]), (503, code))
                self.assertEqual(command.call_count, calls)

    def test_malformed_abi_chain_height_terms_and_ambiguous_results_fail_closed(self):
        invalid = [
            offer(lender=0), offer(principal=0), offer(principal=10 ** 24 + 1),
            offer(collateral=100 * 10 ** 18 + 1), offer(interest=657_534),
            offer(apr=0), offer(apr=5001), offer(term=0), offer(term=366),
            offer(grace=0), offer(grace=31), offer(expires=0), offer(expires=2 ** 64),
            offer(borrower=BORROWER), offer(accepted=1), offer(3, borrower=LENDER),
            offer(3, accepted=1_793_615_102), offer(3, deadline=1_795_862_692),
        ]
        invalid_replies = [reply(row) for row in invalid] + [
            reply(offer(), height=99), reply(offer(), height=2 ** 64),
            reply(offer()[:-1]), reply(offer() + [0]),
            reply(offer(), output=""), reply(offer(), output="REVERTED at height 101, gas 1\n"),
            reply(offer(), output=reply(offer())["output"] + "ok at height 101, gas 1\n"),
            reply(offer(), output=reply(offer())["output"] + "  output: 0x" + "0" * 832 + "\n"),
        ]
        for bad in invalid_replies:
            with self.subTest(bad=bad):
                api._CACHE = None
                result, status, _ = self.invoke(responses=[reply([int(api.CHAIN_ID, 16)]),
                    reply([int(api.TOKEN_ADDRESS, 16)]), reply([2]), bad])
                self.assertEqual((status, result["error"]["code"]), (503, "invalid_node_response"))
                self.assertNotIn(SECRET, json.dumps(result))

    def test_cli_failures_are_sanitized_and_error_cache_throttles_retries(self):
        for bad in (None, reply([1], returncode=3), reply([1], error=SECRET),
                    reply([1], returncode=-9, error="command output exceeded limit")):
            with self.subTest(bad=bad):
                api._CACHE = None
                result, status, _ = self.invoke(responses=[bad])
                self.assertEqual((status, result["error"]["code"]), (503, "node_unavailable"))
                self.assertNotIn(SECRET, json.dumps(result))
                with patch.object(api, "run_command") as command:
                    self.assertEqual(api.lookup(self.config, {}), (result, status))
                    command.assert_not_called()
        api._CACHE = None
        with patch.object(api, "run_command", side_effect=PermissionError(SECRET)):
            self.assertEqual(api.lookup(self.config, {})[0]["error"]["code"], "node_unavailable")

    def test_cache_is_scoped_copied_and_never_overrides_stale_chain_context(self):
        result, _, _ = self.invoke()
        result["offers"][0]["principalRaw"] = "tampered"
        with patch.object(api, "run_command") as command:
            cached, status = api.lookup(self.config, {})
            self.assertEqual(status, 200)
            self.assertEqual(cached["offers"][0]["principalRaw"], "100000000")
            command.assert_not_called()
        self.snapshot["generated_at"] = "2020-01-01T00:00:00+00:00"
        self.save()
        self.assertEqual(api.lookup(self.config, {})[0]["error"]["code"], "stale_chain_context")

    def test_busy_lock_and_collection_failure_release_without_extra_commands(self):
        with patch.object(api, "_PROBE") as lock, patch.object(api, "run_command") as command:
            lock.acquire.return_value = False
            self.assertEqual(api.lookup(self.config, {})[0]["error"]["code"], "busy")
            command.assert_not_called()
            lock.release.assert_not_called()
        with patch.object(api, "_PROBE") as lock, patch.object(api, "run_command", return_value=None):
            lock.acquire.return_value = True
            api.lookup(self.config, {})
            lock.release.assert_called_once_with()

    def test_collection_budget_is_shared_and_partial_coverage_is_explicit(self):
        # Three metadata getters, one offer, then stop before the next offer.
        with patch.object(api.time, "monotonic", side_effect=[0, 0, 0, 0, 0, 0, 21]), \
                patch.object(api, "run_command", side_effect=[reply([int(api.CHAIN_ID, 16)]),
                    reply([int(api.TOKEN_ADDRESS, 16)]), reply([3]), reply(offer())]) as command:
            result, status = api._collect(self.config, 100)
        self.assertEqual(status, 200)
        self.assertEqual(command.call_count, 4)
        self.assertEqual(result["offers"][0]["id"], "2")
        self.assertTrue(result["coverage"]["budgetLimited"])
        self.assertFalse(result["coverage"]["complete"])


if __name__ == "__main__":
    unittest.main()
