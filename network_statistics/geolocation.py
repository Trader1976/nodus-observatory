"""Optional local IP-location mapping. Never send node addresses to a third party."""
from __future__ import annotations

import csv
import ipaddress
import math
from pathlib import Path
import re

from .geoip_common import (DATABASE_NAME, atomic_json, database_metadata,
                           geoip_directory, open_database, read_json, utcnow)

MAX_ROWS = 100_000
MAX_BYTES = 16_000_000
FIELDS = {"network", "country", "country_code", "city", "latitude", "longitude"}


def address_ip(address):
    """Accept literal IP[:port] endpoints; never resolve arbitrary DNS names."""
    if not isinstance(address, str):
        return None
    text = address.strip()
    try:
        if text.startswith("["):
            end = text.index("]")
            ip = ipaddress.ip_address(text[1:end])
            suffix = text[end + 1:]
            if suffix and (not re.fullmatch(r":[0-9]{1,5}", suffix) or not 1 <= int(suffix[1:]) <= 65535):
                return None
            return ip
        try:
            return ipaddress.ip_address(text)
        except ValueError:
            host, port = text.rsplit(":", 1)
            if not re.fullmatch(r"[0-9]{1,5}", port) or not 1 <= int(port) <= 65535:
                return None
            return ipaddress.ip_address(host)
    except (ValueError, IndexError):
        return None


def _label(value, limit):
    if not isinstance(value, str) or len(value) > limit or any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise ValueError("Invalid location label")
    return value.strip()


def load_locations(path):
    if path is None:
        return []
    source = Path(path)
    if not source.is_absolute() or not source.is_file() or source.stat().st_size > MAX_BYTES:
        raise ValueError("Location file is missing or exceeds the size limit")
    mappings, seen = [], set()
    with source.open(newline="", encoding="utf-8-sig") as stream:
        rows = csv.DictReader(stream)
        if set(rows.fieldnames or ()) != FIELDS:
            raise ValueError("Location CSV headers must be network,country,country_code,city,latitude,longitude")
        for i, row in enumerate(rows):
            if i >= MAX_ROWS:
                raise ValueError("Location row limit exceeded")
            prefix = ipaddress.ip_network(row["network"], strict=False)
            if str(prefix) in seen:
                raise ValueError("Duplicate location network")
            seen.add(str(prefix))
            country = _label(row["country"], 100)
            code = _label(row["country_code"], 2).upper()
            city = _label(row["city"], 100)
            if code and not re.fullmatch(r"[A-Z]{2}", code):
                raise ValueError("Invalid country code")
            latitude, longitude = float(row["latitude"]), float(row["longitude"])
            if not math.isfinite(latitude) or not math.isfinite(longitude) or not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
                raise ValueError("Invalid location coordinates")
            mappings.append((prefix, {"country": country, "country_code": code, "city": city,
                                      "latitude": latitude, "longitude": longitude,
                                      "source": "operator_local_csv", "approximate": True}))
    # Most specific configured network wins; exact IP rows become /32 or /128.
    return sorted(mappings, key=lambda pair: pair[0].prefixlen, reverse=True)


def locate(address, mappings):
    ip = address_ip(address)
    if ip is None or not ip.is_global:
        return None
    if isinstance(mappings, GeoLocator):
        return mappings.lookup(ip)
    for network, location in mappings:
        if ip.version == network.version and ip in network:
            return dict(location)
    return None


def location_record(record, metadata):
    """Normalize the DB-IP City schema; missing coordinates never become 0,0."""
    if not isinstance(record, dict):
        return None
    country, city, position = record.get("country"), record.get("city"), record.get("location")
    if not isinstance(country, dict) or not isinstance(position, dict):
        return None
    code = country.get("iso_code", "")
    latitude, longitude = position.get("latitude"), position.get("longitude")
    if (not isinstance(code, str) or re.fullmatch(r"[A-Z]{2}", code) is None
            or type(latitude) not in (int, float) or type(longitude) not in (int, float)
            or not math.isfinite(latitude) or not math.isfinite(longitude)
            or not -90 <= latitude <= 90 or not -180 <= longitude <= 180):
        return None
    names = country.get("names", {})
    city_names = city.get("names", {}) if isinstance(city, dict) else {}
    name = names.get("en", code) if isinstance(names, dict) else code
    city_name = city_names.get("en", "") if isinstance(city_names, dict) else ""
    return {"country": _label(name, 100), "country_code": code,
            "city": _label(city_name, 100), "latitude": latitude, "longitude": longitude,
            "source": "dbip_city_lite", "approximate": True,
            "database_date": metadata["database_date"], "resolved_at": utcnow()}


class GeoLocator:
    """One memory-mapped database per collection, plus a bounded persistent cache."""
    def __init__(self, state_dir, config):
        self.reader = None
        self.mappings = []
        self.errors = []
        self.cache = {}
        self.enabled = config.get("statistics_geoip_enabled", True)
        self.path = geoip_directory(state_dir) / DATABASE_NAME
        self.cache_path = Path(state_dir) / "geoip-cache.json"
        self.info = {"configured": False, "available": False, "status": "disabled" if not self.enabled else "not_configured",
                     "provider": None, "database_date": None, "database_stale": False,
                     "auto_update": config.get("statistics_geoip_auto_update", False), "cache_hits": 0, "lookups": 0}
        self.fingerprint = None
        if not self.enabled:
            return
        update_status = read_json(self.path.parent / "update-status.json", limit=16_384)
        self.info.update(update_status=update_status.get("status"), last_checked_at=update_status.get("checked_at"))
        csv_path = config.get("statistics_geoip_file")
        if csv_path is not None:
            self.info["configured"] = True
            try:
                self.mappings = load_locations(csv_path)
                self.info.update(available=True, status="ready", csv_override=True)
            except (OSError, ValueError, TypeError, csv.Error) as exc:
                self.info["status"] = "error"
                self.errors.append({"source": "geolocation_csv", "message": type(exc).__name__})
        if self.path.exists() or self.path.is_symlink():
            self.info["configured"] = True
            try:
                before = self.path.stat()
                self.reader = open_database(self.path)
                self.info.update(database_metadata(self.reader))
                info = self.path.stat()
                if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns):
                    raise ValueError("GeoIP database changed during opening; retry on next collection")
                self.fingerprint = "%s:%s:%s:%s" % (info.st_ino, info.st_size, info.st_mtime_ns, self.info["build_epoch"])
                saved = read_json(self.cache_path)
                if saved.get("database") == self.fingerprint and isinstance(saved.get("items"), dict):
                    self.cache = dict(list(saved["items"].items())[-4096:])
                update = read_json(self.path.with_suffix(".json"), limit=16_384)
                self.info.update(available=True, status="ready", downloaded_at=update.get("downloaded_at"),
                                 release=update.get("release"))
            except (OSError, ValueError, TypeError, RuntimeError) as exc:
                if self.reader is not None:
                    self.reader.close()
                    self.reader = None
                self.info["status"] = "error"
                self.errors.append({"source": "geolocation_database", "message": str(exc)[:160]})
        elif self.info["auto_update"]:
            self.info.update(configured=True, status="awaiting_download")

    def lookup(self, ip):
        if not self.enabled or not ip.is_global:
            return None
        override = locate(str(ip), self.mappings)
        if override is not None:
            return override
        if self.reader is None:
            return None
        key = str(ip)
        if key in self.cache:
            cached = self.cache[key]
            # Validate cached results just like database records before display.
            if cached is None:
                self.info["cache_hits"] += 1
                return None
            if isinstance(cached, dict):
                record = {"country": {"iso_code": cached.get("country_code"), "names": {"en": cached.get("country")}},
                          "city": {"names": {"en": cached.get("city")}},
                          "location": {"latitude": cached.get("latitude"), "longitude": cached.get("longitude")}}
                try:
                    result = location_record(record, self.info)
                except (ValueError, TypeError):
                    result = None
                if result is not None:
                    self.info["cache_hits"] += 1
                    stamp = cached.get("resolved_at")
                    if isinstance(stamp, str) and len(stamp) <= 40:
                        result["resolved_at"] = stamp
                    return result
        try:
            result = location_record(self.reader.get(key), self.info)
            self.info["lookups"] += 1
            self.cache[key] = result
            while len(self.cache) > 4096:
                self.cache.pop(next(iter(self.cache)))
            return dict(result) if result is not None else None
        except (OSError, ValueError, TypeError, RuntimeError) as exc:
            self.errors.append({"source": "geolocation_lookup", "message": type(exc).__name__})
            return None

    def close(self):
        try:
            if self.reader is not None and self.fingerprint is not None:
                atomic_json(self.cache_path, {"database": self.fingerprint, "items": self.cache})
        except OSError as exc:
            self.errors.append({"source": "geolocation_cache", "message": type(exc).__name__})
        finally:
            if self.reader is not None:
                self.reader.close()
                self.reader = None
