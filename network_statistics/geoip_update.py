"""Download the fixed DB-IP City Lite monthly database; never look up node IPs online."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
from http.client import HTTPException
import os
from pathlib import Path
import re
import sys
import tempfile
import time
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, Request, build_opener
import zlib

from .geoip_common import (DATABASE_NAME, MAX_DATABASE_BYTES, atomic_json,
                           database_metadata, geoip_directory, open_database, read_json, utcnow)
from .geolocation import location_record

DOWNLOAD_ROOT = "https://download.db-ip.com/free/"
MAX_DOWNLOAD_BYTES = 256 * 1024 * 1024


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("GeoIP download redirects are refused")


def release_url(release):
    if not isinstance(release, str) or re.fullmatch(r"20[0-9]{2}-(?:0[1-9]|1[0-2])", release) is None:
        raise ValueError("Invalid GeoIP release")
    return DOWNLOAD_ROOT + "dbip-city-lite-" + release + ".mmdb.gz"


def validate_database(path, now=None):
    reader = open_database(path)
    try:
        info = database_metadata(reader, now)
        if info["database_age_days"] > 93:
            raise ValueError("Downloaded GeoIP database is unexpectedly old")
        # Exercise real record decoding as well as its MMDB metadata. The
        # bounded iteration handles databases whose first ranges lack a city.
        for i, (_, record) in enumerate(reader):
            if location_record(record, info) is not None:
                return info
            if i >= 1023:
                break
        raise ValueError("GeoIP database has no usable sampled location records")
    finally:
        reader.close()


def download_database(url, destination, deadline, opener=None):
    """Stream bounded gzip data into an unpublished temporary file."""
    if not isinstance(url, str) or not re.fullmatch(
            re.escape(DOWNLOAD_ROOT) + r"dbip-city-lite-20[0-9]{2}-(?:0[1-9]|1[0-2])\.mmdb\.gz", url):
        raise ValueError("Unsupported GeoIP download URL")
    if deadline <= time.monotonic():
        raise TimeoutError("GeoIP update deadline reached")
    opener = build_opener(NoRedirect()) if opener is None else opener
    request = Request(url, headers={"User-Agent": "Nodus-Observatory-GeoIP/1.0", "Accept": "application/octet-stream"})
    digest, packed, unpacked = hashlib.sha256(), 0, 0
    decoder = zlib.decompressobj(zlib.MAX_WBITS | 16)
    with opener.open(request, timeout=min(20, deadline - time.monotonic())) as response:
        if response.status != 200 or response.geturl() != url:
            raise ValueError("Unexpected GeoIP download response")
        with Path(destination).open("wb") as output:
            while True:
                if time.monotonic() >= deadline:
                    raise TimeoutError("GeoIP update deadline reached")
                block = response.read1(65_536)
                if time.monotonic() >= deadline:
                    raise TimeoutError("GeoIP update deadline reached")
                if not block:
                    break
                packed += len(block)
                if packed > MAX_DOWNLOAD_BYTES:
                    raise ValueError("Compressed GeoIP download exceeds limit")
                pending = block
                while pending:
                    if time.monotonic() >= deadline:
                        raise TimeoutError("GeoIP update deadline reached")
                    decoded = decoder.decompress(pending, min(1_048_576, MAX_DATABASE_BYTES + 1 - unpacked))
                    pending = decoder.unconsumed_tail
                    unpacked += len(decoded)
                    if unpacked > MAX_DATABASE_BYTES:
                        raise ValueError("Uncompressed GeoIP database exceeds limit")
                    digest.update(decoded)
                    output.write(decoded)
                    if decoder.unused_data:
                        raise ValueError("Unexpected trailing GeoIP gzip data")
            if not decoder.eof or not unpacked:
                raise ValueError("GeoIP download is empty or truncated")
            output.flush()
            os.fsync(output.fileno())
    return {"sha256": digest.hexdigest(), "size_bytes": unpacked, "download_bytes": packed}


def update_database(state_dir, *, force=False, now=None, downloader=download_database, validator=validate_database):
    """Publish a validated file atomically; failed updates keep the active file."""
    now = datetime.now(timezone.utc) if now is None else now
    release = now.strftime("%Y-%m")
    directory = geoip_directory(state_dir)
    if directory.is_symlink():
        raise ValueError("GeoIP directory must not be a symbolic link")
    directory.mkdir(parents=True, exist_ok=True, mode=0o750)
    target = directory / DATABASE_NAME
    metadata_path, status_path = target.with_suffix(".json"), directory / "update-status.json"
    lock_path = directory / "update.lock"
    for path in (target, metadata_path, status_path, lock_path):
        if path.is_symlink():
            raise ValueError("GeoIP files must not be symbolic links")
    descriptor = os.open(lock_path, os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o640)
    temporary, published = None, False
    with os.fdopen(descriptor, "r+b") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {"status": "busy", "checked_at": utcnow()}
        try:
            old = read_json(metadata_path, limit=16_384)
            if not force and old.get("release") == release and target.is_file() and target.stat().st_size == old.get("size_bytes"):
                try:
                    info = validator(target, now)
                except (OSError, ValueError, RuntimeError):
                    pass  # Repair a damaged current-month file with a new download.
                else:
                    result = {"status": "current", "release": release, "checked_at": utcnow(), **info}
                    atomic_json(status_path, result)
                    return result
            fd, temporary = tempfile.mkstemp(prefix=".download-", suffix=".mmdb", dir=directory)
            os.fchmod(fd, 0o640)
            os.close(fd)
            deadline = time.monotonic() + 600
            integrity = downloader(release_url(release), Path(temporary), deadline)
            info = validator(Path(temporary), now)
            if time.monotonic() > deadline:
                raise TimeoutError("GeoIP update deadline reached")
            old_build = old.get("build_epoch")
            if type(old_build) is int and info["build_epoch"] < old_build:
                raise ValueError("GeoIP update would replace a newer database")
            metadata = {**integrity, **info, "release": release, "downloaded_at": utcnow(),
                        "download_url": release_url(release)}
            # No active file is removed before the complete replacement exists.
            os.replace(temporary, target)
            temporary = None
            published = True
            atomic_json(metadata_path, metadata)
            directory_fd = os.open(directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
            result = {"status": "updated", "checked_at": utcnow(), **metadata}
            atomic_json(status_path, result)
            return result
        except (OSError, ValueError, RuntimeError, HTTPException, zlib.error) as exc:
            result = {"status": "error", "checked_at": utcnow(), "release": release,
                      "error": type(exc).__name__ + ": " + str(exc)[:180],
                      "database_available": target.is_file(), "previous_database_retained": target.is_file() and not published}
            atomic_json(status_path, result)
            return result
        finally:
            if temporary is not None:
                os.unlink(temporary)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="/etc/nodus-monitor/config.json")
    parser.add_argument("--force", action="store_true", help="Download again even if this month's release is installed")
    args = parser.parse_args()
    # The installed collector owns config validation and the browser preference
    # allowlist. Use its same effective network-enabled setting.
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    source_backend = Path(__file__).resolve().parent.parent / "backend"
    if (source_backend / "collector.py").is_file():
        sys.path.insert(0, str(source_backend))
    from collector import load_config
    config = load_config(args.config)
    if not all(config.get(key, False) for key in ("network_enabled", "statistics_enabled", "statistics_geoip_enabled", "statistics_geoip_auto_update")):
        print('{"status":"disabled"}')
        return 0
    result = update_database(config["state_dir"], force=args.force)
    import json
    print(json.dumps(result, ensure_ascii=False))
    return 1 if result["status"] == "error" else 0


if __name__ == "__main__":
    raise SystemExit(main())
