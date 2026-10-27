"""Real HTTP boundary: fixed read endpoint and narrowly scoped testnet CSP."""
from functools import partial
from http.server import ThreadingHTTPServer
import http.client
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from collector import DEFAULTS
from server import Handler


class DefiHttpTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        config = dict(DEFAULTS, state_dir=self.temp.name, frontend_dir=self.temp.name)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, config=config))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def request(self, route, method="GET", host="127.0.0.1"):
        client = http.client.HTTPConnection("127.0.0.1", self.server.server_address[1], timeout=3)
        client.request(method, route, headers={"Host": host})
        response = client.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        client.close()
        return result

    def test_read_endpoint_returns_source_status_and_testnet_only_csp(self):
        payload = {"available": True, "offers": [], "signingAvailable": False}
        with patch("test_defi.read_api.lookup", return_value=(payload, 200)) as lookup:
            status, headers, body = self.request("/api/test-defi")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), payload)
        self.assertEqual(lookup.call_args.args[1], {})
        self.assertEqual(headers["Cache-Control"], "no-store")
        policy = headers["Content-Security-Policy"]
        self.assertIn("script-src 'self';", policy)
        self.assertIn("https://nile.trongrid.io", policy)
        self.assertIn("https://api.shasta.trongrid.io", policy)
        self.assertNotIn("https://api.trongrid.io", policy)
        self.assertNotIn("https:", policy.replace("https://nile.trongrid.io", "").replace("https://api.nileex.io", "").replace("https://api.shasta.trongrid.io", ""))
        with patch("test_defi.read_api.lookup", return_value=({"available": False}, 503)):
            self.assertEqual(self.request("/api/test-defi")[0], 503)

    def test_no_parameters_writes_or_foreign_hosts_can_trigger_cli(self):
        with patch("test_defi.read_api.run_command") as command:
            for query in ("url=", "contract=0x12", "id=1", "id=1&id=2", "rpc=https://example.com"):
                self.assertEqual(self.request("/api/test-defi?" + query)[0], 400)
            for method in ("POST", "PUT", "PATCH", "DELETE", "OPTIONS"):
                self.assertEqual(self.request("/api/test-defi", method)[0], 405)
            self.assertEqual(self.request("/api/test-defi", host="attacker.example")[0], 403)
            command.assert_not_called()


if __name__ == "__main__":
    unittest.main()
