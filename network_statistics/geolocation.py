"""Optional local IP-location mapping. Never send node addresses to a third party."""
from __future__ import annotations

import csv
import ipaddress
import math
from pathlib import Path
import re

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
    if value is None or len(value) > limit or any(ord(c) < 32 or ord(c) == 127 for c in value):
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
    for network, location in mappings:
        if ip.version == network.version and ip in network:
            return dict(location)
    return None
