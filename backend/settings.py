"""Validated, unprivileged Observatory preferences, separate from trusted install paths.

The web process may write only the settings subdirectory. The root collector
accepts this strict allowlist; executable, data, listener and database paths
always come from the administrator-owned installation configuration.
"""
from __future__ import annotations

import copy
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import tempfile
import threading


EDITABLE_FIELDS = (
    "node_name", "default_view", "roles", "history_days", "network_interface",
    "disk_device", "network_enabled", "rewards_enabled", "rewards_scan_enabled",
)
READONLY_FIELDS = ("cli_path", "data_path", "mount_path", "rewards_source_db")
MAX_SETTINGS_BYTES = 16_384
SETTINGS_LOCK = threading.RLock()
READ_ONLY_NOTE = (
    "Installation paths are managed in /etc/nodus-monitor/config.json by the "
    "server administrator. Browser settings change only Observatory preferences."
)


class RevisionConflict(ValueError):
    """A second editor has changed the settings since they were opened."""


def decode_json(raw):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("duplicate JSON key: " + key)
            result[key] = value
        return result

    def invalid_constant(value):
        raise ValueError("invalid JSON constant: " + value)

    return json.loads(raw, object_pairs_hook=unique, parse_constant=invalid_constant)


def validate_patch(value):
    if not isinstance(value, dict):
        raise ValueError("settings must be an object")
    unknown = set(value) - set(EDITABLE_FIELDS)
    if unknown:
        raise ValueError("setting is not editable: " + sorted(unknown)[0])
    result = copy.deepcopy(value)
    for key, item in result.items():
        if key == "node_name":
            if not isinstance(item, str) or len(item) > 80 or any(ord(c) < 32 or ord(c) == 127 for c in item):
                raise ValueError("node_name must be at most 80 characters without control characters")
            result[key] = item.strip()
        elif key == "default_view":
            if item not in ("overview", "storage", "witness"):
                raise ValueError("default_view must be overview, storage or witness")
        elif key == "roles":
            if not isinstance(item, dict) or set(item) != {"storage", "witness"} or any(type(v) is not bool for v in item.values()) or not any(item.values()):
                raise ValueError("roles must contain storage and witness booleans, with at least one enabled")
        elif key == "history_days":
            if type(item) is not int or not 1 <= item <= 366:
                raise ValueError("history_days must be an integer between 1 and 366")
        elif key in ("network_enabled", "rewards_enabled", "rewards_scan_enabled"):
            if type(item) is not bool:
                raise ValueError(key + " must be a boolean")
        elif key in ("network_interface", "disk_device"):
            pattern = r"[a-zA-Z0-9_.:-]{1,80}" if key == "network_interface" else r"[a-zA-Z0-9_.-]{1,80}"
            if item is not None and (not isinstance(item, str) or not re.fullmatch(pattern, item) or item in (".", "..")):
                raise ValueError(key + " must be null or a valid device identifier")
    return result


def settings_path(config):
    directory = Path(config["state_dir"]) / "settings"
    if directory.is_symlink():
        raise ValueError("settings directory must not be a symbolic link")
    return directory / "settings.json"


def _read_raw(config):
    path = settings_path(config)
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    try:
        descriptor = os.open(path, flags)
    except FileNotFoundError:
        return None
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > MAX_SETTINGS_BYTES:
            raise ValueError("settings file must be a regular file within the size limit")
        with os.fdopen(descriptor, "rb", closefd=False) as source:
            raw = source.read(MAX_SETTINGS_BYTES + 1)
        if len(raw) > MAX_SETTINGS_BYTES:
            raise ValueError("settings file exceeds the size limit")
        return raw
    finally:
        os.close(descriptor)


def _read(config):
    raw = _read_raw(config)
    return (validate_patch(decode_json(raw)) if raw is not None else {}), raw or b""


def load_overrides(config):
    """Return only validated safe preferences; never expand the trusted config."""
    return _read(config)[0]


def effective_config(base, overrides=None):
    result = copy.deepcopy(base)
    result.update(load_overrides(base) if overrides is None else validate_patch(overrides))
    view = result.get("default_view", "overview")
    if view in ("storage", "witness") and not result.get("roles", {}).get(view, True):
        result["default_view"] = "overview"
    return result


def public_values(config):
    return {key: copy.deepcopy(config.get(key)) for key in EDITABLE_FIELDS + READONLY_FIELDS}


def _revision(base, raw):
    trusted = json.dumps(public_values(base), sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()
    return hashlib.sha256(trusted + b"\x00" + raw).hexdigest()


def document(base, csrf_token):
    saved = _read_raw(base)
    raw = saved or b""
    error = None
    try:
        overrides = validate_patch(decode_json(raw)) if saved is not None else {}
    except (ValueError, UnicodeError) as problem:
        overrides = {}
        error = "Saved browser settings could not be loaded: " + str(problem)
    result = {
        "settings": public_values(effective_config(base, overrides)),
        "editable_fields": list(EDITABLE_FIELDS),
        "revision": _revision(base, raw),
        "csrf_token": csrf_token,
        "read_only_note": READ_ONLY_NOTE,
    }
    if error:
        result["settings_error"] = error
    return result


def prepare(base, payload):
    if not isinstance(payload, dict) or set(payload) != {"settings", "revision"}:
        raise ValueError("request must contain settings and revision")
    if not isinstance(payload["revision"], str):
        raise ValueError("revision must be a string")
    saved = _read_raw(base)
    raw = saved or b""
    if payload["revision"] != _revision(base, raw):
        raise RevisionConflict("Settings changed in another session. Reload settings before saving.")
    try:
        overrides = validate_patch(decode_json(raw)) if saved is not None else {}
    except (ValueError, UnicodeError):
        # The GET document explicitly flags corrupt preferences and shows the
        # trusted installation defaults. A versioned save can repair the file;
        # the original bytes are preserved in settings.previous.json.
        overrides = {}
    overrides.update(validate_patch(payload["settings"]))
    effective = effective_config(base, overrides)
    # Store the normalized view as well, so enabling a role later cannot revive
    # a previously invalid default behind the user's back.
    if "default_view" in overrides or effective.get("default_view") != base.get("default_view", "overview"):
        overrides["default_view"] = effective.get("default_view", "overview")
    return effective, overrides, raw


def _atomic_write(path, raw):
    descriptor, temporary = tempfile.mkstemp(prefix=".settings-", suffix=".tmp", dir=path.parent)
    try:
        os.fchmod(descriptor, 0o640)
        with os.fdopen(descriptor, "wb") as destination:
            destination.write(raw)
            destination.flush()
            os.fsync(destination.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def save(base, payload, csrf_token):
    with SETTINGS_LOCK:
        _, overrides, previous = prepare(base, payload)
        path = settings_path(base)
        path.parent.mkdir(mode=0o750, exist_ok=True)
        if path.parent.is_symlink():
            raise ValueError("settings directory must not be a symbolic link")
        if previous:
            _atomic_write(path.with_name("settings.previous.json"), previous)
        raw = (json.dumps(overrides, indent=2, ensure_ascii=False, allow_nan=False) + "\n").encode()
        _atomic_write(path, raw)
        directory = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
        return {**document(base, csrf_token), "saved": True, "applies": "next_collection"}


def check(base, payload):
    with SETTINGS_LOCK:
        config, _, _ = prepare(base, payload)
    checks = [{"name": "settings", "status": "ok", "message": "Settings are valid. Checking does not change files or services."}]
    cli = Path(config["cli_path"])
    checks.append({"name": "cli", "status": "ok" if cli.is_file() and os.access(cli, os.X_OK) else "warning", "message": "Configured CLI is executable." if cli.is_file() and os.access(cli, os.X_OK) else "Configured CLI cannot be verified as executable from the dashboard service."})
    try:
        snapshot = decode_json((Path(base["state_dir"]) / "snapshot.json").read_bytes())
    except (OSError, ValueError):
        snapshot = {}
    if not isinstance(snapshot, dict):
        snapshot = {}
    try:
        stamp = dt.datetime.fromisoformat(snapshot["generated_at"])
        age = max(0, (dt.datetime.now(dt.timezone.utc) - stamp).total_seconds())
        fresh = age <= snapshot.get("stale_after_seconds", 180)
    except (KeyError, ValueError, TypeError):
        fresh = False
    observations = snapshot.get("services", [])
    services = {entry.get("name"): entry for entry in observations if isinstance(entry, dict)} if isinstance(observations, list) else {}
    for role, enabled in config.get("roles", {}).items():
        if enabled:
            observed = services.get("nodus-" + role, {})
            active = observed.get("active")
            if not fresh:
                checks.append({"name": role, "status": "unknown", "message": "Service observations are missing or stale. The collector checks this role on the next sample."})
            else:
                checks.append({"name": role, "status": "ok" if active == "active" else "warning" if active in ("failed", "inactive") else "unknown", "message": "Latest observed service state: " + str(active) + "." if active else "No service observation is available yet. The collector checks this role on the next sample."})
    checks.append({"name": "paths", "status": "unknown", "message": "Installation paths are administrator-managed. The collector reports filesystem health; the dashboard sandbox does not inspect Nodus data."})
    return {"valid": True, "settings": public_values(config), "checks": checks}
