#!/usr/bin/env python3
"""Read-only loopback HTTP server for the Nodus monitor."""
from __future__ import annotations

import argparse
import datetime as dt
from functools import partial
import importlib
import json
import math
import mimetypes
from pathlib import Path
import sqlite3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlsplit

from collector import load_config, read_json, utc_now
from document_registry import lookup_record


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
                             keep_blank_values=parsed.path == "/api/documents/record")
            if parsed.path.startswith("/api/"):
                return self.api(parsed.path, query)
            return self.static(parsed.path)
        except (ValueError, TypeError):
            return self.fail(400, "invalid query")
        except (sqlite3.Error, OSError, json.JSONDecodeError):
            return self.fail(503, "monitoring data is temporarily unavailable")

    def api(self, route, query):
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
        self.fail(405, "This monitoring server is read-only")

    do_PUT = do_POST
    do_PATCH = do_POST
    do_DELETE = do_POST
    do_OPTIONS = do_POST


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default="/etc/nodus-monitor/config.json")
    args = parser.parse_args()
    config = load_config(args.config)
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
