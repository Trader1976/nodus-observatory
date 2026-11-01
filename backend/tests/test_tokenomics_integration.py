"""Real HTTP boundary: bounded, stateless scenario calculations."""
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
from urllib.parse import urlencode

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from collector import DEFAULTS
from server import Handler


class TokenomicsHttpTests(unittest.TestCase):
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

    def request(self, query="", method="GET", host="127.0.0.1"):
        client = http.client.HTTPConnection("127.0.0.1", self.server.server_address[1], timeout=5)
        client.request(method, "/api/tokenomics" + query, headers={"Host": host})
        response = client.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        client.close()
        return result

    def test_default_and_custom_calculations_without_live_node_or_data_store(self):
        with patch("collector.run_command", side_effect=AssertionError("no RPC")), \
                patch("server.readonly_connection", side_effect=AssertionError("no database")):
            status, headers, body = self.request()
            payload = json.loads(body)
            self.assertEqual(status, 200)
            self.assertEqual(payload["schema_version"], 1)
            self.assertEqual(len(payload["series"]), 121)
            self.assertEqual(headers["Cache-Control"], "no-store")
            self.assertIn("script-src 'self';", headers["Content-Security-Policy"])
            values = {"months": 24, "storage_entry_per_month": 0}
            status, _, body = self.request("?" + urlencode({"p": json.dumps(values)}))
            custom = json.loads(body)
            self.assertEqual(status, 200)
            self.assertEqual(len(custom["series"]), 25)
            self.assertLessEqual(custom["series"][-1]["storage_nodes"], custom["series"][0]["storage_nodes"])
        self.assertEqual(list(Path(self.temp.name).iterdir()), [])

    def test_invalid_parameters_and_unsupported_methods(self):
        queries = ["?url=https://example.com", "?p=", "?p={}&p={}"]
        values = ["[]", "null", '{"months":12,"months":24}', '{"months":true}',
                  '{"months":241}', '{"initial_price_usdt":NaN}', '{"unknown":1}',
                  '{"storage_cost_usdt_year":-1}', '{"initial_validators":33}',
                  '{"months":' + "9" * 900 + "}"]
        queries += ["?" + urlencode({"p": value}) for value in values]
        for query in queries:
            with self.subTest(query=query):
                status, _, body = self.request(query)
                self.assertEqual(status, 400)
                self.assertIn("error", json.loads(body))
        for method in ("POST", "PUT", "PATCH", "DELETE", "OPTIONS"):
            self.assertEqual(self.request(method=method)[0], 405)
        self.assertEqual(self.request(host="attacker.example")[0], 403)
        self.assertEqual(self.request("?p=" + "x" * 4096)[0], 414)

    def test_head_has_no_response_body(self):
        status, headers, body = self.request(method="HEAD")
        self.assertEqual(status, 200)
        self.assertEqual(body, b"")
        self.assertGreater(int(headers["Content-Length"]), 0)


if __name__ == "__main__":
    unittest.main()
