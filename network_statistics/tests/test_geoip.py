"""GeoIP updates and local lookup tested with a tiny synthetic MMDB, not real nodes."""
from __future__ import annotations

from datetime import datetime, timezone
import gzip
import hashlib
import importlib.util
import io
import ipaddress
from pathlib import Path
import sqlite3
import struct
import sys
import tempfile
import time
import unittest
from unittest.mock import patch, PropertyMock

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from network_statistics import geoip_update as update
from network_statistics.geoip_common import DATABASE_NAME, atomic_json, read_json
from network_statistics.geolocation import GeoLocator, locate, location_record
from network_statistics.collector import collect_statistics
from network_statistics.api import report
from network_statistics.tests.test_collection_api import snapshot

HAS_READER = importlib.util.find_spec("maxminddb") is not None


def encoded(value):
    """Minimal MMDB v2 fixture encoder. It is not used by the application."""
    if isinstance(value, dict):
        return bytes([0xe0 | len(value)]) + b"".join(encoded(k) + encoded(v) for k, v in value.items())
    if isinstance(value, list):
        return bytes([len(value), 4]) + b"".join(encoded(v) for v in value)
    if isinstance(value, str):
        data = value.encode()
        if len(data) < 29:
            return bytes([0x40 | len(data)]) + data
        return bytes([0x5d, len(data) - 29]) + data
    if type(value) is int:
        data = value.to_bytes(max(1, (value.bit_length() + 7) // 8), "big")
        return bytes([0xc0 | len(data)]) + data
    if type(value) is float:
        return b"\x68" + struct.pack("!d", value)
    raise TypeError(value)


def mmdb(city="Example City", epoch=None, database_type="DBIP-City-Lite"):
    record = {"country": {"iso_code": "EX", "names": {"en": "Example Country"}},
              "city": {"names": {"en": city}}, "location": {"latitude": 60.1, "longitude": 24.9}}
    metadata = {"binary_format_major_version": 2, "binary_format_minor_version": 0,
                "build_epoch": int(time.time()) if epoch is None else epoch, "database_type": database_type,
                "description": {"en": "Synthetic fixture"}, "ip_version": 6,
                "languages": ["en"], "node_count": 97, "record_size": 24}
    # Keep the IPv4 subtree at depth 96, as a real IPv6 MMDB does. Every
    # terminal branch uses the same synthetic location, including IPv6 ranges.
    pointer = (97 + 16).to_bytes(3, "big")
    tree = b"".join((i + 1).to_bytes(3, "big") + pointer for i in range(96)) + pointer * 2
    return tree + b"\x00" * 16 + encoded(record) + b"\xab\xcd\xefMaxMind.com" + encoded(metadata)


class Response(io.BytesIO):
    status = 200

    def __init__(self, data, url=None):
        super().__init__(data)
        self.url = update.release_url("2026-10") if url is None else url

    def geturl(self):
        return self.url

    def read1(self, size):
        return self.read(size)


class Opener:
    def __init__(self, data, url=None):
        self.data, self.url = data, url
        self.requests = []

    def open(self, request, timeout):
        self.requests.append(request.full_url)
        return Response(self.data, self.url)


class DownloadTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def download(self, payload, **options):
        target = self.root / "download.mmdb"
        result = update.download_database(update.release_url("2026-10"), target, time.monotonic() + 2,
                                          opener=Opener(payload, **options))
        return target, result

    def test_fixed_release_and_gzip_integrity(self):
        payload = mmdb()
        target, result = self.download(gzip.compress(payload))
        self.assertEqual(target.read_bytes(), payload)
        self.assertEqual(result["sha256"], hashlib.sha256(payload).hexdigest())
        self.assertEqual(result["size_bytes"], len(payload))
        for release in ("2026-13", "2026-1", "../../other", "https://example.com"):
            with self.assertRaises(ValueError):
                update.release_url(release)

    def test_truncated_invalid_and_concatenated_gzip_refused(self):
        packed = gzip.compress(mmdb())
        for payload in (packed[:-4], b"not gzip", packed + gzip.compress(b"another")):
            with self.subTest(payload=len(payload)), self.assertRaises((ValueError, update.zlib.error)):
                self.download(payload)

    def test_download_url_redirect_and_time_limits(self):
        with self.assertRaises(ValueError):
            self.download(gzip.compress(mmdb()), url="https://example.com/other")
        with self.assertRaises(ValueError):
            update.download_database("http://example.com/file", self.root / "file", time.monotonic() + 1)
        with self.assertRaises(TimeoutError):
            update.download_database(update.release_url("2026-10"), self.root / "file", time.monotonic() - 1)
        with self.assertRaises(ValueError):
            update.NoRedirect().redirect_request(None, None, 302, "move", {}, "https://example.com")

    def test_compressed_and_uncompressed_size_limits(self):
        with patch.object(update, "MAX_DOWNLOAD_BYTES", 5), self.assertRaises(ValueError):
            self.download(gzip.compress(mmdb()))
        with patch.object(update, "MAX_DATABASE_BYTES", 1024), self.assertRaises(ValueError):
            self.download(gzip.compress(b"x" * 100_000))

    def test_failed_validation_preserves_old_database_and_metadata(self):
        directory = self.root / "geoip"
        directory.mkdir()
        target = directory / DATABASE_NAME
        target.write_bytes(b"old database")
        atomic_json(target.with_suffix(".json"), {"release": "2026-09", "build_epoch": 1})
        def download(url, path, deadline):
            path.write_bytes(b"new but invalid")
            return {"size_bytes": 15}
        def invalid(path, now):
            raise ValueError("invalid candidate")
        result = update.update_database(self.root, downloader=download, validator=invalid)
        self.assertEqual(result["status"], "error")
        self.assertEqual(target.read_bytes(), b"old database")
        self.assertEqual(read_json(target.with_suffix(".json"))["release"], "2026-09")
        self.assertFalse(list(directory.glob(".download-*")))

    def test_symbolic_targets_are_refused(self):
        (self.root / "geoip").symlink_to(self.root)
        with self.assertRaises(ValueError):
            update.update_database(self.root)


@unittest.skipUnless(HAS_READER, "Optional maxminddb reader is not installed")
class RealDatabaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / "geoip").mkdir()
        self.path = self.root / "geoip" / DATABASE_NAME
        self.path.write_bytes(mmdb())

    def tearDown(self):
        self.temp.cleanup()

    def test_real_memory_mapped_ipv4_ipv6_and_no_private_lookup(self):
        locator = GeoLocator(self.root, {})
        self.assertTrue(locator.info["available"])
        self.assertEqual(locator.info["provider"], "DB-IP")
        with patch("ipaddress.IPv4Address.is_global", new_callable=PropertyMock, return_value=True), \
                patch("ipaddress.IPv6Address.is_global", new_callable=PropertyMock, return_value=True):
            self.assertEqual(locate("198.51.100.8:4004", locator)["city"], "Example City")
            self.assertEqual(locate("[2001:db8::8]:4004", locator)["country_code"], "EX")
        before = locator.info["lookups"]
        self.assertIsNone(locate("192.0.2.8", locator))
        self.assertIsNone(locate("not-an-ip:4004", locator))
        self.assertEqual(locator.info["lookups"], before)
        locator.close()

    def test_cache_hit_and_invalidation_after_atomic_database_change(self):
        with patch("ipaddress.IPv4Address.is_global", new_callable=PropertyMock, return_value=True):
            first = GeoLocator(self.root, {})
            self.assertEqual(locate("198.51.100.8", first)["city"], "Example City")
            first.close()
            second = GeoLocator(self.root, {})
            self.assertEqual(locate("198.51.100.8", second)["city"], "Example City")
            self.assertEqual(second.info["cache_hits"], 1)
            self.assertEqual(second.info["lookups"], 0)
            second.close()
            replacement = self.root / "replacement.mmdb"
            replacement.write_bytes(mmdb("New City"))
            replacement.replace(self.path)
            third = GeoLocator(self.root, {})
            self.assertEqual(locate("198.51.100.8", third)["city"], "New City")
            self.assertEqual(third.info["lookups"], 1)
            third.close()

    def test_csv_override_and_disabled_mode(self):
        csv = self.root / "override.csv"
        csv.write_text("network,country,country_code,city,latitude,longitude\n198.51.100.8,Override,EX,Local,10,20\n")
        locator = GeoLocator(self.root, {"statistics_geoip_file": str(csv)})
        with patch("ipaddress.IPv4Address.is_global", new_callable=PropertyMock, return_value=True):
            location = locate("198.51.100.8", locator)
        self.assertEqual(location["city"], "Local")
        self.assertEqual(location["source"], "operator_local_csv")
        locator.close()
        disabled = GeoLocator(self.root, {"statistics_geoip_enabled": False})
        self.assertEqual(disabled.info["status"], "disabled")
        self.assertIsNone(disabled.reader)

    def test_malformed_cache_is_a_miss_and_first_download_failure_is_visible(self):
        locator = GeoLocator(self.root, {})
        locator.cache["198.51.100.8"] = {"country_code": "EX", "country": None,
                                         "city": [], "latitude": 10, "longitude": 20}
        with patch("ipaddress.IPv4Address.is_global", new_callable=PropertyMock, return_value=True):
            self.assertEqual(locate("198.51.100.8", locator)["city"], "Example City")
        self.assertEqual(locator.info["lookups"], 1)
        self.assertEqual(locator.info["cache_hits"], 0)
        locator.close()
        self.path.unlink()
        atomic_json(self.path.parent / "update-status.json", {"status": "error", "checked_at": "2026-10-23T00:00:00Z"})
        pending = GeoLocator(self.root, {"statistics_geoip_auto_update": True})
        self.assertFalse(pending.info["available"])
        self.assertEqual(pending.info["update_status"], "error")
        self.assertEqual(pending.info["status"], "awaiting_download")

    def test_corrupt_wrong_type_and_missing_coordinates_never_make_fake_points(self):
        self.path.write_bytes(mmdb(database_type="Other-Database"))
        locator = GeoLocator(self.root, {})
        self.assertFalse(locator.info["available"])
        self.assertEqual(locator.info["status"], "error")
        locator.close()
        for latitude in (None, True, "60", float("nan"), 91):
            record = {"country": {"iso_code": "EX"}, "location": {"latitude": latitude, "longitude": 20}}
            self.assertIsNone(location_record(record, {"database_date": "2026-10-01"}))

    def test_update_and_current_month_skip_use_real_reader(self):
        payload = self.path.read_bytes()
        def download(url, path, deadline):
            path.write_bytes(payload)
            return {"size_bytes": len(payload), "sha256": hashlib.sha256(payload).hexdigest()}
        result = update.update_database(self.root, downloader=download)
        self.assertEqual(result["status"], "updated")
        self.assertEqual(result["provider"], "DB-IP")
        def no_download(*args):
            raise AssertionError("Current database must not be downloaded again")
        self.assertEqual(update.update_database(self.root, downloader=no_download)["status"], "current")
        self.path.write_bytes(b"x" * len(payload))
        self.assertEqual(update.update_database(self.root, downloader=download)["status"], "updated")
        self.assertEqual(self.path.read_bytes(), payload)

    def test_same_network_observation_gets_location_enrichment_without_fake_new_sample(self):
        data = snapshot(False)
        self.path.unlink()
        collect_statistics(self.root, {}, data)
        self.assertIsNone(report(self.root / "statistics.sqlite3")["nodes"][0]["location"])
        self.path.write_bytes(mmdb())
        with patch("ipaddress.IPv4Address.is_global", new_callable=PropertyMock, return_value=True):
            collect_statistics(self.root, {}, data)
        result = report(self.root / "statistics.sqlite3")
        self.assertEqual(result["nodes"][0]["location"]["city"], "Example City")
        self.assertEqual(result["geolocation"]["provider"], "DB-IP")
        with sqlite3.connect(self.root / "statistics.sqlite3") as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM observations").fetchone()[0], 1)
        with patch("network_statistics.geoip_common.open_database", side_effect=AssertionError("HTTP must not open MMDB")):
            self.assertTrue(report(self.root / "statistics.sqlite3")["available"])

    def test_local_storage_address_enrichment_survives_a_reused_network_observation(self):
        data = snapshot(False)
        data["node"] = {"fingerprint": "b" * 128, "p2p_id": "b" * 64, "external_ip": None}
        source = self.root / "source.db"
        source.touch()
        storage = {"nodes": [{"id": "b" * 64, "fingerprint": "b" * 128,
                             "address": None, "roles": ["storage"], "status": "active", "storage": {}}]}
        config = {"rewards_source_db": str(source)}
        with patch("network_statistics.collector.read_local_storage", return_value=storage):
            collect_statistics(self.root, config, data)
            data["node"]["external_ip"] = "198.51.100.99"
            with patch("ipaddress.IPv4Address.is_global", new_callable=PropertyMock, return_value=True):
                collect_statistics(self.root, config, data)
        result = report(self.root / "statistics.sqlite3")
        own = next(n for n in result["nodes"] if n["id"] == "b" * 64)
        self.assertTrue(own["local"])
        self.assertEqual(own["address"], "198.51.100.99")
        self.assertEqual(own["location"]["city"], "Example City")
        self.assertEqual(result["coverage"]["network_samples"], 1)


if __name__ == "__main__":
    unittest.main()
