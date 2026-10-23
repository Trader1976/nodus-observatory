import copy
import json
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from collector import DEFAULTS, utc_now
import trade_network as trade

NOW = 1_792_750_000
NCONTRACT = "0x" + "12" * 32
NFUNDER = "0x" + "34" * 32
NRECIPIENT = "0x" + "ab" * 32
BCONTRACT = "0x" + "12" * 20
BFUNDER = "0x" + "34" * 20
BRECIPIENT = "0x" + "ab" * 20
TOKEN = "0x" + "56" * 20
TRADE = "0x" + "78" * 32
HASH = "0x" + "9a" * 32
SECRET_OUTPUT = "private=/var/lib/nodus/identity secret=must-not-be-exposed"


def query(chain="nodus", **changes):
    values = {"chain": chain, "contract": NCONTRACT if chain == "nodus" else BCONTRACT,
              "funder": NFUNDER if chain == "nodus" else BFUNDER, "trade_id": TRADE}
    if chain == "bsc":
        values["token"] = TOKEN
    values.update(changes)
    return {key: [value] for key, value in values.items()}


def words(*values):
    return "0x" + "".join(f"{int(value, 16) if isinstance(value, str) else value:064x}" for value in values)


def swap(chain="nodus", state=1, amount=10**18, recipient=None, refund=NOW + 7200):
    if not state:
        return words(0, 0, 0, 0, 0)
    return words(recipient or (NRECIPIENT if chain == "nodus" else BRECIPIENT), amount, HASH, refund, state)


def output(raw, height=100):
    return {"output": f"Using random identity\n{SECRET_OUTPUT}\nok at height {height}, gas 2234\n  output: {raw}\n", "returncode": 0, "error": None}


def block(height=100, timestamp=NOW - 5, hash_value="0x" + "de" * 32):
    return {"number": hex(height), "hash": hash_value, "timestamp": hex(timestamp)}


class FakeResponse:
    status = 200
    def __init__(self, raw, url=trade.BSC_ENDPOINTS[0]):
        self.raw, self.url = raw, url
    def geturl(self):
        return self.url
    def read1(self, limit):
        chunk, self.raw = self.raw[:limit], self.raw[limit:]
        return chunk
    def __enter__(self):
        return self
    def __exit__(self, *args):
        pass


class TradeNetworkTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.config = dict(DEFAULTS, state_dir=self.temp.name)
        self.snapshot = {"generated_at": utc_now(), "chain": {"chain_id": trade.NODUS_CHAIN, "height": 100, "sync_ok": True}}
        self.save_snapshot()
    def tearDown(self):
        self.temp.cleanup()
    def save_snapshot(self):
        (Path(self.temp.name) / "snapshot.json").write_text(json.dumps(self.snapshot))
    def nodus(self, results=None, request=None):
        results = results if results is not None else [output(swap()), output(words(NOW)), output(swap())]
        with patch("trade_network.run_command", side_effect=results) as command, patch("trade_network.time.time", return_value=NOW):
            payload, status = trade.lookup(self.config, request or query())
        return payload, status, command
    def rpc_source(self, method, params):
        if method == "eth_chainId":
            return "0x61"
        if method == "eth_getBlockByNumber":
            return block(101, NOW) if params[0] == "latest" else block()
        if method == "eth_getCode":
            return "0x60006000"
        if method == "eth_call":
            data = params[0]["data"]
            if data == "0xfc0c546a":
                return words(TOKEN)
            if data == "0x313ce567":
                return words(18)
            self.assertEqual(data, "0xed86b78c" + BFUNDER[2:].rjust(64, "0") + TRADE[2:])
            return swap("bsc")
        self.fail(method)
    def bsc(self, source=None, request=None):
        source = source or self.rpc_source
        with patch("trade_network._rpc", side_effect=lambda endpoint, method, params, deadline: source(method, params)) as rpc, patch("trade_network.time.time", return_value=NOW):
            payload, status = trade.lookup(self.config, request or query("bsc"))
        return payload, status, rpc

    def test_nodus_high_bytes_are_retained_but_runtime_unavailable_blocks_verification(self):
        payload, status, command = self.nodus()
        self.assertEqual(status, 200)
        self.assertEqual(payload["recipient"], NRECIPIENT)
        self.assertEqual(payload["amountUnits"], str(10**18))
        self.assertTrue(payload["available"])
        self.assertFalse(payload["confirmed"])
        self.assertFalse(payload["runtimeVerified"])
        self.assertIsNone(payload["runtime"])
        self.assertEqual(payload["blocker"], "nodus_runtime_unavailable")
        self.assertFalse(payload["independentVerification"])
        self.assertFalse(payload["chainIdVerified"])
        self.assertNotIn(SECRET_OUTPUT, json.dumps(payload))
        calls = [call.args[0] for call in command.call_args_list]
        self.assertEqual(calls[0], [self.config["cli_path"], "-s", "127.0.0.1", "-p", "4001", "evm", "call", NCONTRACT, "getSwap(address,bytes32)", NFUNDER, TRADE, "--gas", "100000"])
        self.assertEqual(calls[1][7:9], [NCONTRACT, "currentBlockTime()"])
        self.assertEqual(calls[0], calls[2])
        for call in calls:
            self.assertNotIn("--keys", call)
            self.assertNotIn("code", call)
            self.assertNotIn("send", call)
        self.assertEqual(command.call_args.kwargs["max_bytes"], trade.CLI_MAX_BYTES)

    def test_nodus_stale_unsynchronized_or_foreign_context_refuses_before_cli(self):
        for modification in ({"sync_ok": False}, {"chain_id": "ab" * 32}):
            self.snapshot["chain"].update(modification)
            self.save_snapshot()
            payload, status, command = self.nodus()
            self.assertIn(status, (409, 503))
            self.assertFalse(payload["available"])
            command.assert_not_called()
            self.snapshot["chain"] = {"chain_id": trade.NODUS_CHAIN, "height": 100, "sync_ok": True}
        self.snapshot["generated_at"] = "2000-01-01T00:00:00+00:00"
        self.save_snapshot()
        payload, status, command = self.nodus()
        self.assertEqual(status, 503)
        command.assert_not_called()

    def test_nodus_errors_and_raw_output_are_sanitized(self):
        cases = [output(swap(), 99), output(swap(), 201),
                 output(swap() + "00"), {"returncode": 1, "error": None, "output": SECRET_OUTPUT},
                 {"returncode": 0, "error": SECRET_OUTPUT, "output": SECRET_OUTPUT}]
        for invalid in cases:
            payload, status, _ = self.nodus([invalid])
            self.assertEqual(status, 503)
            self.assertNotIn(SECRET_OUTPUT, json.dumps(payload))
        ambiguous = output(swap())
        ambiguous["output"] += "ok at height 101, gas 1\n"
        self.assertEqual(self.nodus([ambiguous])[1], 503)

    def test_nodus_clock_and_stable_record_bounds(self):
        for clock_value in (0, NOW - 181, NOW + 31, 1 << 64):
            payload, status, _ = self.nodus([output(swap()), output(words(clock_value)), output(swap())])
            self.assertEqual(status, 503)
        self.assertEqual(self.nodus([output(swap()), output(words(NOW)), output(swap(state=2))])[1], 503)
        self.assertEqual(self.nodus([output(swap()), output(words(NOW), 102), output(swap(), 104)])[1], 503)
        self.assertEqual(self.nodus([output(swap()), output(words(NOW), 101), output(swap(), 102)])[1], 200)

    def test_canonical_swap_decoding_and_empty_semantics(self):
        self.assertEqual(trade.parse_swap(swap(state=0), "nodus")["status"], "empty")
        self.assertEqual(trade.parse_swap(swap("bsc"), "bsc")["recipient"], BRECIPIENT)
        for invalid in (swap(recipient=0x123, amount=0), words(0, 1, HASH, NOW, 1), words(1, 1, 0, NOW, 1), words(1, 1, HASH, 1 << 64, 1), words(1, 1, HASH, NOW, 4), words(1, 0, 0, 0, 0), "0x" + "00" * 159):
            with self.assertRaises(ValueError):
                trade.parse_swap(invalid, "nodus")
        with self.assertRaises(ValueError):
            trade.parse_swap(swap(recipient=NRECIPIENT), "bsc")

    def test_query_rejects_duplicates_extra_empty_identifiers_and_wrong_chain(self):
        requests = [query(chain="bsc", token="0x" + "00" * 20), query(chain="arbitrary"), query(trade_id="--keys"), query(contract=BCONTRACT), query(endpoint="https://localhost"), query(token=TOKEN), query(trade_id="0x" + "00" * 32)]
        duplicate = query(); duplicate["contract"].append(NCONTRACT); requests.append(duplicate)
        missing = query("bsc"); del missing["token"]; requests.append(missing)
        for request in requests:
            payload, status, command = self.nodus(request=request)
            self.assertEqual(status, 400, request)
            command.assert_not_called()
        upper = query(contract=NCONTRACT.upper().replace("0X", "0x"))
        self.assertEqual(trade.validate_query(upper)["contract"], NCONTRACT)

    def test_bsc_finalized_observation_keeps_exact_amount_and_identity(self):
        payload, status, rpc = self.bsc()
        self.assertEqual(status, 200)
        self.assertTrue(payload["confirmed"])
        self.assertFalse(payload["independentVerification"])
        self.assertEqual(payload["chainId"], "97")
        self.assertEqual(payload["token"], TOKEN)
        self.assertEqual(payload["decimals"], 18)
        self.assertEqual(payload["runtime"], "0x60006000")
        self.assertEqual(payload["timestamp"], str(NOW))
        self.assertEqual(payload["height"], "100")
        self.assertEqual(payload["latestHeight"], "101")
        self.assertEqual(len(rpc.call_args_list), 10)
        for call in rpc.call_args_list:
            self.assertIn(call.args[0], trade.BSC_ENDPOINTS)
            self.assertNotIn(call.args[1], ("eth_sendRawTransaction", "eth_sendTransaction"))

    def test_bsc_wrong_chain_bad_token_precision_and_no_code_never_confirm(self):
        sources = [lambda method, params: "0x38" if method == "eth_chainId" else self.rpc_source(method, params),
                   lambda method, params: words(6) if method == "eth_call" and params[0]["data"] == "0x313ce567" else self.rpc_source(method, params),
                   lambda method, params: words(BRECIPIENT) if method == "eth_call" and params[0]["data"] == "0xfc0c546a" else self.rpc_source(method, params),
                   lambda method, params: "0x" if method == "eth_getCode" else self.rpc_source(method, params)]
        for source in sources:
            payload, status, _ = self.bsc(source)
            self.assertEqual(status, 503)
            self.assertFalse(payload["available"])

    def test_bsc_latest_changes_or_reorganization_refuse(self):
        def changed(method, params):
            if method == "eth_call" and params[1] == "0x65" and params[0]["data"].startswith("0xed86"):
                return swap("bsc", state=2)
            return self.rpc_source(method, params)
        def reorg(method, params):
            if method == "eth_getBlockByNumber" and params[0] == "0x64":
                return block(hash_value="0x" + "ff" * 32)
            return self.rpc_source(method, params)
        for source in (changed, reorg):
            self.assertEqual(self.bsc(source)[1], 503)

    def test_bsc_no_finalized_support_or_stale_clock_has_no_latest_fallback(self):
        def no_finality(method, params):
            if method == "eth_getBlockByNumber" and params[0] == "finalized":
                return None
            return self.rpc_source(method, params)
        payload, status, rpc = self.bsc(no_finality)
        self.assertEqual(status, 503)
        self.assertFalse(any(call.args[1:] and call.args[1] == "eth_getBlockByNumber" and call.args[2][0] == "latest" for call in rpc.call_args_list))
        self.assertEqual(self.bsc(lambda method, params: block(timestamp=NOW - 181) if method == "eth_getBlockByNumber" else self.rpc_source(method, params))[1], 503)

    def test_busy_and_cli_exception_are_safe(self):
        with patch.object(trade._PROBES, "acquire", return_value=False):
            self.assertEqual(trade.lookup(self.config, query())[1], 429)
        with patch("trade_network.run_command", side_effect=OSError(SECRET_OUTPUT)):
            payload, status = trade.lookup(self.config, query())
        self.assertEqual(status, 503)
        self.assertNotIn(SECRET_OUTPUT, json.dumps(payload))

    def test_http_transport_bounds_and_no_redirects_or_arbitrary_hosts(self):
        good = json.dumps({"jsonrpc": "2.0", "id": 1, "result": "0x61"}).encode()
        response = FakeResponse(good)
        with patch("trade_network.urlrequest.build_opener") as factory:
            factory.return_value.open.return_value = response
            self.assertEqual(trade._rpc(trade.BSC_ENDPOINTS[0], "eth_chainId", [], time.monotonic() + 15), "0x61")
            args, kwargs = factory.return_value.open.call_args
            self.assertEqual(args[0].full_url, trade.BSC_ENDPOINTS[0])
            self.assertEqual(json.loads(args[0].data)["method"], "eth_chainId")
            self.assertLessEqual(kwargs["timeout"], 3)
        with self.assertRaises(ValueError):
            trade._rpc("https://127.0.0.1", "eth_chainId", [], time.monotonic() + 15)
        with self.assertRaises(ValueError):
            trade.NoRedirect().redirect_request(None, None, 302, "", None, "https://localhost")
        malformed = [b'{"jsonrpc":"2.0","id":1,"result":"0x61","result":"0x38"}', b'{"jsonrpc":"2.0","id":true,"result":"0x61"}', b'{"jsonrpc":"2.0","id":1,"error":{"message":"private"}}', b'x' * (trade.MAX_RPC_BYTES + 1), b'{"jsonrpc":"2.0","id":1,"result":NaN}']
        for body in malformed:
            with patch("trade_network.urlrequest.build_opener") as factory:
                factory.return_value.open.return_value = FakeResponse(body)
                with self.assertRaises((ValueError, UnicodeError)):
                    trade._rpc(trade.BSC_ENDPOINTS[0], "eth_chainId", [], time.monotonic() + 15)


if __name__ == "__main__":
    unittest.main()
