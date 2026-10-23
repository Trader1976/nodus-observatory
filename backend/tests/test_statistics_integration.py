"""Exercise the installed feature boundary through the real HTTP handler."""
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
from collector import DEFAULTS, load_config
from server import Handler


class StatisticsIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        config = dict(DEFAULTS, state_dir=str(self.root), frontend_dir=str(self.root))
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, config=config))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def request(self, route, method="GET"):
        client = http.client.HTTPConnection("127.0.0.1", self.server.server_address[1], timeout=3)
        client.request(method, route)
        response = client.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        client.close()
        return result

    def test_report_and_export_are_local_reads_with_explicit_range(self):
        with patch("network_statistics.api.report", return_value={"available": True}) as report, \
                patch("collector.run_command", side_effect=AssertionError("HTTP must not query Nodus")):
            status, headers, body = self.request("/api/statistics?range=7d")
            self.assertEqual(status, 200)
            self.assertTrue(json.loads(body)["available"])
            self.assertEqual(headers["Cache-Control"], "no-store")
            report.assert_called_once_with(self.root / "statistics.sqlite3", "7d")
        with patch("network_statistics.api.export_csv", return_value="timestamp,transactions\n") as export:
            status, headers, body = self.request("/api/statistics/export.csv?range=all")
            self.assertEqual(status, 200)
            self.assertIn("nodus-statistics-all.csv", headers["Content-Disposition"])
            self.assertEqual(body, b"timestamp,transactions\n")
            export.assert_called_once_with(self.root / "statistics.sqlite3", "all")

    def test_statistics_rejects_unknown_or_duplicate_ranges_and_writes(self):
        for query in ("range=forever", "range=24h&range=all", "url=https://example.com", "range="):
            with self.subTest(query=query):
                self.assertEqual(self.request("/api/statistics?" + query)[0], 400)
        for method in ("POST", "PUT", "PATCH", "DELETE"):
            self.assertEqual(self.request("/api/statistics", method)[0], 405)

    def test_statistics_configuration_rejects_invalid_budgets_and_paths(self):
        invalid = ({"statistics_max_blocks": True}, {"statistics_max_blocks": 257},
                   {"statistics_backfill_blocks": -1}, {"statistics_collection_seconds": 61},
                   {"statistics_history_days": 0}, {"statistics_enabled": "true"},
                   {"statistics_geoip_enabled": "true"}, {"statistics_geoip_auto_update": 1},
                   {"statistics_geoip_file": "relative.csv"})
        config_path = self.root / "config.json"
        for values in invalid:
            with self.subTest(values=values):
                config_path.write_text(json.dumps(values))
                with self.assertRaises(ValueError):
                    load_config(config_path, include_overrides=False)
        config_path.write_text("{}")
        self.assertTrue(load_config(config_path, include_overrides=False)["statistics_enabled"])
        self.assertTrue(load_config(config_path, include_overrides=False)["statistics_geoip_enabled"])
        self.assertFalse(load_config(config_path, include_overrides=False)["statistics_geoip_auto_update"])


if __name__ == "__main__":
    unittest.main()
