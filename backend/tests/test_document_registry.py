import datetime as dt
from functools import partial
import http.client
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.parse import urlencode

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from collector import DEFAULTS, utc_now
from document_registry import lookup_record, parse_record_output, validate_query, InvalidQuery
from server import Handler


CONTRACT = "0x" + "12" * 32
PUBLISHER = "0x" + "34" * 32
DIGEST = "56" * 32
CHAIN = "78" * 32
SECRET_OUTPUT = "private=/var/lib/nodus/identity secret=must-not-be-exposed"


def query(**changes):
    values = {"contract": CONTRACT, "publisher": PUBLISHER, "digest": DIGEST}
    values.update(changes)
    return {key: [value] for key, value in values.items()}


def output(exists=1, block=90, timestamp=1_792_396_800, revoked=0, height=101):
    words = "".join(f"{value:064x}" for value in (exists, block, timestamp, revoked))
    return f"Using random identity\n{SECRET_OUTPUT}\nok at height {height}, gas 2234\n  output: 0x{words}\n"


class DocumentLookupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.state = Path(self.temp.name)
        self.config = dict(DEFAULTS, state_dir=str(self.state))
        self.snapshot = {"generated_at": utc_now(), "chain": {"chain_id": CHAIN, "height": 100, "sync_ok": True}}
        self.write_snapshot()

    def tearDown(self):
        self.temp.cleanup()

    def write_snapshot(self):
        (self.state / "snapshot.json").write_text(json.dumps(self.snapshot))

    def lookup(self, text=None, request=None, result=None):
        result = result if result is not None else {"output": text or output(), "returncode": 0, "error": None}
        with patch("document_registry.run_command", return_value=result) as command:
            response, status = lookup_record(self.config, request or query())
        return response, status, command

    def test_registered_record_exact_read_command_and_no_private_identity(self):
        response, status, command = self.lookup(request=query(chain=CHAIN))
        self.assertEqual(status, 200)
        self.assertEqual(response["status"], "registered")
        self.assertEqual(response["record"], {"exists": True, "block_number": "90", "timestamp": "1792396800", "revoked": False})
        self.assertEqual(response["chain"]["height"], "101")
        self.assertEqual(response["chain"]["chain_id"], CHAIN)
        self.assertEqual(response["chain"]["chain_id_source"], "local_collector_snapshot")
        self.assertFalse(response["chain"]["chain_id_verified"])
        self.assertFalse(response["provenance"]["contract_code_verified"])
        self.assertFalse(response["provenance"]["independent_verification"])
        args = command.call_args.args[0]
        self.assertEqual(args, [self.config["cli_path"], "-s", "127.0.0.1", "-p", "4001", "evm", "call", CONTRACT,
                                "record(address,bytes32)", PUBLISHER, "0x" + DIGEST])
        self.assertEqual(command.call_args.kwargs, {"timeout": 15, "max_bytes": 32768})
        self.assertNotIn("-i", args)
        self.assertNotIn(SECRET_OUTPUT, json.dumps(response))

    def test_revoked_and_absent_are_distinct_successful_queries(self):
        revoked, status, _ = self.lookup(output(revoked=1))
        self.assertEqual((status, revoked["status"]), (200, "revoked"))
        missing, status, _ = self.lookup(output(exists=0, block=0, timestamp=0))
        self.assertEqual((status, missing["status"]), (200, "not_found"))
        self.assertEqual(missing["record"], {"exists": False, "block_number": None, "timestamp": None, "revoked": False})

    def test_query_identifiers_normalize_case_and_optional_digest_prefix(self):
        parsed = validate_query(query(contract=CONTRACT.upper().replace("0X", "0x"), digest="0x" + DIGEST, chain="0x" + CHAIN))
        self.assertEqual(parsed["contract"], CONTRACT)
        self.assertEqual(parsed["digest"], "0x" + DIGEST)
        self.assertEqual(parsed["chain"], CHAIN)

    def test_injection_extra_fields_duplicates_empty_and_wrong_address_sizes_rejected(self):
        bad = [
            query(contract=CONTRACT + "; rm -rf /"), query(contract="--identity-init"),
            query(contract="0x" + "1" * 40), query(contract="0x" + "1" * 128), query(contract="0x" + "0" * 64),
            query(publisher="0x" + "0" * 64), query(publisher=PUBLISHER + "\n"),
            query(digest=DIGEST + "\n"), query(digest="0x" + DIGEST + "00"), query(digest=""),
            query(chain="broken"), {**query(), "server": ["attacker.example"]},
            {**query(), "digest": [DIGEST, DIGEST]}, {**query(), "digest": DIGEST},
            {"contract": [CONTRACT], "publisher": [PUBLISHER]},
        ]
        for request in bad:
            with self.subTest(request=request):
                response, status, command = self.lookup(request=request)
                self.assertEqual(status, 400)
                self.assertEqual(response["error"]["code"], "invalid_query")
                command.assert_not_called()

    def test_chain_mismatch_does_not_start_cli(self):
        response, status, command = self.lookup(request=query(chain="ab" * 32))
        self.assertEqual(status, 409)
        self.assertEqual(response["error"]["code"], "chain_mismatch")
        command.assert_not_called()

    def test_old_future_unsynchronized_unknown_and_missing_chain_context_fail_closed(self):
        cases = [
            {"generated_at": "2020-01-01T00:00:00+00:00"},
            {"generated_at": (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=1)).isoformat()},
            {"generated_at": "2026-10-19T12:00:00"},
            {"chain": {"chain_id": CHAIN, "height": 100, "sync_ok": None}},
            {"chain": {"chain_id": CHAIN, "height": 100, "sync_ok": False}},
            {"chain": {"chain_id": CHAIN, "height": 0, "sync_ok": True}},
            {"chain": {"chain_id": CHAIN, "height": True, "sync_ok": True}},
            {"chain": {"chain_id": "?", "height": 100, "sync_ok": True}},
            {"chain": {"chain_id": CHAIN, "height": 100}},
        ]
        for changes in cases:
            with self.subTest(changes=changes):
                self.snapshot = {"generated_at": utc_now(), "chain": {"chain_id": CHAIN, "height": 100, "sync_ok": True}, **changes}
                self.write_snapshot()
                response, status, command = self.lookup()
                self.assertEqual(status, 503)
                self.assertEqual(response["error"]["code"], "stale_chain_context")
                command.assert_not_called()
        (self.state / "snapshot.json").unlink()
        self.assertEqual(self.lookup()[1], 503)

    def test_invalid_node_outputs_are_never_not_found(self):
        examples = [
            "", "REVERTED", "ok at height 101, gas 1\n  [0] false\n  [1] 0\n  [2] 0\n  [3] false",
            output(exists=2), output(revoked=2), output(block=102), output(timestamp=0),
            output(exists=0, block=0, timestamp=0, revoked=1), output(exists=0),
            output(height=99), output(height=2 ** 64), output(timestamp=2 ** 64),
            output() + "ok at height 101, gas 1\n", output() + "  output: 0x" + "0" * 256 + "\n",
            output().replace("  output: 0x", "  output: 0x00"), output().replace("  output: 0x", "  output: 0x" + "0" * 64),
        ]
        for example in examples:
            with self.subTest(example=example):
                response, status, _ = self.lookup(result={"output": example, "returncode": 0, "error": None})
                self.assertEqual(status, 503)
                self.assertFalse(response["available"])
                self.assertEqual(response["error"]["code"], "invalid_node_response")
                self.assertNotIn(SECRET_OUTPUT, json.dumps(response))

    def test_cli_failures_timeouts_oversized_output_and_os_errors_are_sanitized(self):
        for result in (
            {"output": SECRET_OUTPUT, "returncode": 3, "error": None},
            {"output": SECRET_OUTPUT, "returncode": 0, "error": "command timed out"},
            {"output": SECRET_OUTPUT, "returncode": -9, "error": "command output exceeded limit"},
            None,
        ):
            with self.subTest(result=result), patch("document_registry.run_command", return_value=result):
                response, status = lookup_record(self.config, query())
                self.assertEqual(status, 503)
                self.assertEqual(response["error"]["code"], "node_unavailable")
                self.assertNotIn(SECRET_OUTPUT, json.dumps(response))
        with patch("document_registry.run_command", side_effect=PermissionError(SECRET_OUTPUT)):
            self.assertEqual(lookup_record(self.config, query())[0]["error"]["code"], "node_unavailable")

    def test_busy_probe_limit_does_not_spawn_another_process(self):
        with patch("document_registry._PROBES") as probes, patch("document_registry.run_command") as command:
            probes.acquire.return_value = False
            response, status = lookup_record(self.config, query())
            self.assertEqual(status, 503)
            self.assertEqual(response["error"]["code"], "busy")
            probes.release.assert_not_called()
            command.assert_not_called()

    def test_semaphore_released_after_invalid_response(self):
        with patch("document_registry._PROBES") as probes, patch("document_registry.run_command", return_value={"output": "", "returncode": 0, "error": None}):
            probes.acquire.return_value = True
            lookup_record(self.config, query())
            probes.release.assert_called_once_with()

    def test_uint64_values_are_returned_as_exact_decimal_strings(self):
        maximum = (1 << 64) - 1
        height, record = parse_record_output(output(block=maximum, height=maximum, timestamp=maximum), 100)
        self.assertEqual(height, maximum)
        self.assertEqual(record["block_number"], str(maximum))
        self.assertEqual(record["timestamp"], str(maximum))


class DocumentHttpTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        config = dict(DEFAULTS, state_dir=self.temp.name, frontend_dir=self.temp.name)
        snapshot = {"generated_at": utc_now(), "chain": {"chain_id": CHAIN, "height": 100, "sync_ok": True}}
        (Path(self.temp.name) / "snapshot.json").write_text(json.dumps(snapshot))
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, config=config))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def request(self, path, method="GET", host=None):
        client = http.client.HTTPConnection("127.0.0.1", self.server.server_address[1], timeout=3)
        client.request(method, path, headers={"Host": host} if host else {})
        response = client.getresponse()
        status, body, headers = response.status, response.read(), response.headers
        client.close()
        return status, body, headers

    def test_http_success_no_cache_and_fixed_route(self):
        path = "/api/documents/record?" + urlencode({key: values[0] for key, values in query().items()})
        with patch("document_registry.run_command", return_value={"output": output(), "returncode": 0, "error": None}):
            status, body, headers = self.request(path)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["status"], "registered")
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertEqual(self.request("/api/documents/unknown")[0], 404)

    def test_duplicates_blank_values_foreign_host_and_writes_rejected_without_cli(self):
        valid = "/api/documents/record?" + urlencode({key: values[0] for key, values in query().items()})
        with patch("document_registry.run_command") as command:
            for suffix in ("&digest=" + DIGEST, "&digest=", "&url=https://example.com"):
                self.assertEqual(self.request(valid + suffix)[0], 400)
            self.assertEqual(self.request(valid, host="attacker.example")[0], 403)
            for method in ("POST", "PUT", "PATCH", "DELETE", "OPTIONS"):
                self.assertEqual(self.request(valid, method)[0], 405)
            command.assert_not_called()


if __name__ == "__main__":
    unittest.main()
