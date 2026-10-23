#!/usr/bin/env python3
"""Loopback monitoring server with a narrowly scoped local preferences API."""
from __future__ import annotations

import argparse
import datetime as dt
from functools import partial
import importlib
import hmac
import json
import math
import mimetypes
from pathlib import Path
import sqlite3
import secrets
import socket
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlsplit

from collector import load_config, read_json, utc_now
from document_registry import lookup_record
import settings as monitor_settings


CSRF_TOKEN = secrets.token_urlsafe(32)


def allowed_settings_origins(config):
    values = config.get("settings_allowed_origins", [])
    if not isinstance(values, list):
        raise ValueError("settings_allowed_origins must be a list of exact HTTP(S) origins")
    result = set()
    for value in values:
        if not isinstance(value, str):
            raise ValueError("settings_allowed_origins entries must be HTTP(S) origins")
        parsed = urlsplit(value)
        if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username is not None or parsed.password is not None or parsed.path or parsed.query or parsed.fragment or any(ord(c) < 32 or ord(c) == 127 for c in value):
            raise ValueError("settings_allowed_origins entries must be exact HTTP(S) origins without a path")
        try:
            parsed.port
        except ValueError:
            raise ValueError("settings_allowed_origins contains an invalid port") from None
        result.add(value)
    return result


def readonly_connection(path):
    # mode=ro cannot create missing databases or modify data, even if FS permissions change.
    path = Path(path).resolve()
    connection = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=1)
    connection.execute("PRAGMA query_only=ON")
    connection.execute("PRAGMA trusted_schema=OFF")
    connection.row_factory = sqlite3.Row
    return connection


def freshness(snapshot):
    try:
        stamp = dt.datetime.fromisoformat(snapshot["generated_at"])
        age = max(0, (dt.datetime.now(dt.timezone.utc) - stamp).total_seconds())
        return {"stale": age > snapshot.get("stale_after_seconds", 180), "age_seconds": round(age), "available": True}
    except (KeyError, TypeError, ValueError):
        return {"stale": True, "age_seconds": None, "available": False}


def history(path, hours):
    cutoff = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=hours)).isoformat(timespec="seconds")
    connection = readonly_connection(path)
    try:
        rows = connection.execute("SELECT payload FROM samples WHERE timestamp >= ? ORDER BY timestamp LIMIT 528000", (cutoff,)).fetchall()
    finally:
        connection.close()
    points = [json.loads(row["payload"]) for row in rows]
    # Bound browser payload without averaging away error/null samples.
    stride = max(1, math.ceil(len(points) / 1500))
    selected = points[::stride]
    if points and (not selected or selected[-1]["timestamp"] != points[-1]["timestamp"]):
        selected.append(points[-1])
    return {"hours": hours, "points": selected, "total_samples": len(points),
            "sample_stride": stride, "generated_at": utc_now()}


def events(path, limit):
    connection = readonly_connection(path)
    try:
        rows = connection.execute("SELECT timestamp,kind,level,message FROM events ORDER BY timestamp DESC LIMIT ?", (limit,)).fetchall()
    finally:
        connection.close()
    return {"events": [dict(row) for row in rows], "limit": limit,
            "coverage": "categorized observations, at most 300 journal messages per collection; not a complete audit log"}


def rewards_unavailable(reason="Reward index has not been enabled; no monetary values inferred"):
    return {"available": False, "status": "unavailable", "reason": reason, "network": "testnet", "items": [], "summary": None}


class Handler(BaseHTTPRequestHandler):
    server_version = "NodusMonitor/1"

    def __init__(self, *args, config, **kwargs):
        self.base_config = config
        self.config = config
        self.state = Path(config["state_dir"])
        self.frontend = Path(config["frontend_dir"]).resolve()
        super().__init__(*args, **kwargs)

    def log_message(self, format, *args):
        # Do not write arbitrary client input or query strings into service logs.
        print(f"monitor-http {self.client_address[0]} {self.command}", flush=True)

    def send_content(self, data, content_type="application/json; charset=utf-8", status=200, attachment=None):
        if not isinstance(data, bytes):
            data = json.dumps(data, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store" if self.path.startswith("/api/") else "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
        if attachment:
            self.send_header("Content-Disposition", f'attachment; filename="{attachment}"')
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def fail(self, status, message):
        self.send_content({"error": message}, status=status)

    def host_allowed(self):
        host = self.headers.get("Host", "")
        try:
            hostname = urlsplit("//" + host).hostname
        except ValueError:
            return False
        allowed = self.config.get("allowed_hosts", ["127.0.0.1", "localhost", "::1"])
        return hostname in allowed

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        if not self.host_allowed():
            return self.fail(403, "host is not allowed")
        parsed = urlsplit(self.path)
        if len(self.path) > 4096:
            return self.fail(414, "request target too long")
        try:
            query = parse_qs(parsed.query, max_num_fields=10,
                             keep_blank_values=parsed.path in ("/api/documents/record", "/api/statistics", "/api/statistics/export.csv"))
            if parsed.path.startswith("/api/"):
                return self.api(parsed.path, query)
            return self.static(parsed.path)
        except (ValueError, TypeError):
            return self.fail(400, "invalid query")
        except (sqlite3.Error, OSError, json.JSONDecodeError):
            return self.fail(503, "monitoring data is temporarily unavailable")

    def api(self, route, query):
        if route in ("/api/statistics", "/api/statistics/export.csv"):
            if set(query) - {"range"} or len(query.get("range", [])) > 1:
                return self.fail(400, "statistics accepts one range parameter")
            range_key = query.get("range", ["24h"])[0]
            if range_key not in ("24h", "7d", "30d", "1y", "all"):
                return self.fail(400, "range must be 24h, 7d, 30d, 1y or all")
            from network_statistics import api as statistics_api
            database = self.state / "statistics.sqlite3"
            if route.endswith(".csv"):
                try:
                    content = statistics_api.export_csv(database, range_key)
                except ValueError:
                    return self.fail(503, "Statistics export is temporarily unavailable")
                return self.send_content(content.encode("utf-8"), "text/csv; charset=utf-8",
                                         attachment=f"nodus-statistics-{range_key}.csv")
            return self.send_content(statistics_api.report(database, range_key))
        if route == "/api/settings":
            return self.send_content(monitor_settings.document(self.base_config, CSRF_TOKEN))
        if route == "/api/documents/record":
            payload, status = lookup_record(self.config, query)
            return self.send_content(payload, status=status)
        if route in ("/api/dashboard", "/api/health"):
            snapshot = read_json(self.state / "snapshot.json")
            state = freshness(snapshot or {})
            if route == "/api/health":
                return self.send_content({**state, "generated_at": (snapshot or {}).get("generated_at")}, status=200 if state["available"] and not state["stale"] else 503)
            if not snapshot:
                return self.fail(503, "No measurements yet; the collector has not completed")
            snapshot["freshness"] = state
            try:
                effective = monitor_settings.effective_config(self.base_config)
                snapshot["monitor"] = {**snapshot.get("monitor", {}), **{key: effective[key] for key in ("node_name", "default_view", "roles")}}
                snapshot.setdefault("node", {})["display_name"] = effective.get("node_name") or snapshot.get("node", {}).get("hostname") or snapshot.get("resources", {}).get("hostname")
            except (ValueError, OSError) as error:
                # Last recorded monitoring data stays readable while the
                # settings screen explains and repairs malformed preferences.
                snapshot["settings_error"] = "Saved browser settings could not be loaded: " + str(error)
            # Recent events stay visible between collection ticks, without accessing system journals.
            try:
                snapshot["events"] = events(self.state / "metrics.sqlite3", 12)["events"]
            except sqlite3.Error:
                pass
            return self.send_content(snapshot)
        if route == "/api/history":
            hours = float(query.get("hours", ["24"])[0])
            if not math.isfinite(hours) or not 0.1 <= hours <= 24 * 366:
                return self.fail(400, "hours must be between 0.1 and 8784")
            return self.send_content(history(self.state / "metrics.sqlite3", hours))
        if route == "/api/events":
            limit = int(query.get("limit", ["100"])[0])
            if not 1 <= limit <= 500:
                return self.fail(400, "limit must be between 1 and 500")
            return self.send_content(events(self.state / "metrics.sqlite3", limit))
        if route == "/api/network":
            snapshot = read_json(self.state / "snapshot.json", {})
            return self.send_content(snapshot.get("network", {"available": False, "errors": ["Network collector unavailable"]}))
        if route in ("/api/rewards", "/api/rewards/export.csv"):
            year_text = query.get("year", [None])[0]
            year = int(year_text) if year_text else None
            if year is not None and not 2000 <= year <= 2200:
                return self.fail(400, "invalid year")
            database = self.state / "reporting.sqlite3"
            if not database.is_file():
                if route.endswith(".csv"):
                    return self.fail(503, "Rewards reporting is not available yet")
                return self.send_content(rewards_unavailable())
            try:
                rewards = importlib.import_module("rewards")
            except ImportError:
                return self.send_content(rewards_unavailable("Rewards module not installed"), status=503)
            if route.endswith(".csv"):
                content = rewards.export_csv(str(database), year)
                return self.send_content(content, "text/csv; charset=utf-8", attachment=f"nodus-rewards-{year or 'all'}.csv")
            return self.send_content(rewards.report(str(database), year))
        return self.fail(404, "API endpoint not found")

    def static(self, route):
        path_text = unquote(route)
        if "\x00" in path_text or "\\" in path_text or any(part == ".." for part in path_text.split("/")):
            return self.fail(404, "not found")
        path = (self.frontend / path_text.lstrip("/")).resolve()
        if not path.is_relative_to(self.frontend):
            return self.fail(404, "not found")
        if path.is_dir():
            path /= "index.html"
        if not path.is_file():
            if "." in Path(path_text).name:
                return self.fail(404, "not found")
            path = self.frontend / "index.html"
        # Re-resolve index candidates as they too may be symlinks.
        path = path.resolve()
        if not path.is_relative_to(self.frontend) or not path.is_file():
            return self.fail(404, "not found")
        if path.stat().st_size > 20_000_000:
            return self.fail(413, "static file exceeds serving limit")
        content_type = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
        if content_type.startswith("text/") or content_type in ("application/javascript", "application/json"):
            content_type += "; charset=utf-8"
        self.send_content(path.read_bytes(), content_type)

    def do_POST(self):
        route = urlsplit(self.path)
        if route.path not in ("/api/settings", "/api/settings/check") or route.query:
            return self.fail(405, "Only Observatory settings can be changed")
        if not self.host_allowed():
            return self.fail(403, "host is not allowed")
        if self.headers.get("Transfer-Encoding"):
            return self.fail(400, "transfer encoding is not supported")
        try:
            origins = allowed_settings_origins(self.base_config)
        except ValueError as error:
            return self.fail(503, str(error))
        host = self.headers.get("Host", "")
        origins.update(("http://" + host, "https://" + host))
        if self.headers.get("Origin") not in origins:
            return self.fail(403, "Settings origin is not allowed. The administrator can configure settings_allowed_origins for an authenticated reverse proxy.")
        token = self.headers.get("X-CSRF-Token", "")
        if not hmac.compare_digest(token.encode("utf-8"), CSRF_TOKEN.encode("ascii")):
            return self.fail(403, "invalid settings token; reload settings")
        if self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json":
            return self.fail(415, "settings requests require application/json")
        try:
            length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            return self.fail(411, "a valid content length is required")
        if not 0 < length <= monitor_settings.MAX_SETTINGS_BYTES:
            return self.fail(413, "settings request exceeds size limit")
        try:
            self.connection.settimeout(5)
            raw = self.rfile.read(length)
            if len(raw) != length:
                return self.fail(400, "incomplete settings request")
            payload = monitor_settings.decode_json(raw)
            result = monitor_settings.check(self.base_config, payload) if route.path.endswith("/check") else monitor_settings.save(self.base_config, payload, CSRF_TOKEN)
            return self.send_content(result)
        except monitor_settings.RevisionConflict as error:
            return self.fail(409, str(error))
        except (ValueError, TypeError, UnicodeError) as error:
            return self.fail(400, str(error))
        except (OSError, socket.timeout):
            return self.fail(503, "Settings are temporarily unavailable. Check the monitor installation and permissions.")

    def unsupported_write(self):
        self.fail(405, "Only Observatory settings can be changed with POST")

    do_PUT = unsupported_write
    do_PATCH = unsupported_write
    do_DELETE = unsupported_write
    do_OPTIONS = unsupported_write


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default="/etc/nodus-monitor/config.json")
    args = parser.parse_args()
    config = load_config(args.config, include_overrides=False)
    allowed_settings_origins(config)
    if config["bind_host"] not in ("127.0.0.1", "::1", "localhost"):
        raise ValueError("web server must bind to loopback; use SSH forwarding or an authenticated proxy")
    server = ThreadingHTTPServer((config["bind_host"], int(config["bind_port"])), partial(Handler, config=config))
    server.daemon_threads = True
    print(f"Nodus monitor listening on {config['bind_host']}:{config['bind_port']}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
