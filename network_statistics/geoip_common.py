"""Local GeoIP file contracts shared by the collector and update service."""
from __future__ import annotations

from datetime import datetime, timezone
import importlib
import json
import os
from pathlib import Path
import stat
import tempfile

DATABASE_NAME = "dbip-city-lite.mmdb"
DATABASE_TYPE = "DBIP-City-Lite"
MAX_DATABASE_BYTES = 512 * 1024 * 1024
PROVIDER_URL = "https://db-ip.com"
LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/"


def utcnow():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def geoip_directory(state_dir):
    return Path(state_dir) / "geoip"


def read_json(path, limit=4_000_000):
    path = Path(path)
    try:
        if path.is_symlink() or not path.is_file() or path.stat().st_size > limit:
            return {}
        with path.open("rb") as source:
            raw = source.read(limit + 1)
        if len(raw) > limit:
            return {}
        result = json.loads(raw, parse_constant=lambda value: (_ for _ in ()).throw(ValueError("invalid JSON number")))
        return result if isinstance(result, dict) else {}
    except (OSError, ValueError, UnicodeError):
        return {}


def atomic_json(path, value):
    path = Path(path)
    raw = (json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n").encode()
    descriptor, name = tempfile.mkstemp(prefix=".geoip-", suffix=".tmp", dir=path.parent)
    try:
        os.fchmod(descriptor, 0o640)
        with os.fdopen(descriptor, "wb") as output:
            output.write(raw)
            output.flush()
            os.fsync(output.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def open_database(path):
    path = Path(path)
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= MAX_DATABASE_BYTES:
        raise ValueError("GeoIP database is not a supported regular file")
    try:
        module = importlib.import_module("maxminddb")
    except ImportError as exc:
        raise ValueError("Install python3-maxminddb to enable the GeoIP database") from exc
    # MODE_MMAP is supported by both Ubuntu's reader and newer upstream releases;
    # it does not copy the whole world database into Python heap memory.
    return module.open_database(str(path), mode=module.MODE_MMAP)


def database_metadata(reader, now=None):
    meta = reader.metadata()
    epoch = meta.build_epoch
    now = datetime.now(timezone.utc) if now is None else now
    if (meta.database_type != DATABASE_TYPE or meta.binary_format_major_version != 2
            or meta.ip_version not in (4, 6) or type(meta.node_count) is not int or meta.node_count < 1
            or type(epoch) is not int or epoch < 1_577_836_800
            or epoch > now.timestamp() + 86400):
        raise ValueError("GeoIP database metadata is unsupported")
    built = datetime.fromtimestamp(epoch, timezone.utc)
    return {"provider": "DB-IP", "database_type": DATABASE_TYPE,
            "database_date": built.date().isoformat(), "build_epoch": epoch,
            "database_age_days": max(0, int((now - built).total_seconds() // 86400)),
            "database_stale": (now - built).total_seconds() > 62 * 86400,
            "attribution_url": PROVIDER_URL, "license_url": LICENSE_URL}
