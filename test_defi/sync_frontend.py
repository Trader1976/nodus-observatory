#!/usr/bin/env python3
"""Publish canonical Test DeFi sources; --check verifies the installer payload.

Only this directory contains authored feature code. dist/test-defi is generated,
so static previews and installed Observatory instances run the same frontend.
"""
from __future__ import annotations

import argparse
from pathlib import Path
import shutil


def sync(check=False):
    feature = Path(__file__).resolve().parent
    source = feature / "frontend"
    destination = feature.parent / "dist" / "test-defi"
    expected = {name: source / name for name in
                ("core.js", "networks.js", "tron.js", "practice.js", "defi.js", "defi.css")}
    if any(not path.is_file() or path.is_symlink() for path in expected.values()):
        raise ValueError("Test DeFi frontend sources are missing or symbolic links")
    if destination.is_symlink():
        raise ValueError("Test DeFi output must not be a symbolic link")
    actual = set(destination.iterdir()) if destination.is_dir() else set()
    extra = sorted(path.name for path in actual if path.name not in expected)
    different = sorted(name for name, path in expected.items()
                       if (destination / name).is_symlink()
                       or not (destination / name).is_file()
                       or (destination / name).read_bytes() != path.read_bytes())
    if check:
        if different or extra:
            raise ValueError("Run python3 test_defi/sync_frontend.py; mismatches: "
                             + ", ".join(different + extra))
        return
    destination.mkdir(parents=True, exist_ok=True)
    for name in extra:
        path = destination / name
        if path.is_file() or path.is_symlink():
            path.unlink()
        else:
            raise ValueError("Unexpected directory in generated Test DeFi output")
    for name in different:
        path = destination / name
        if path.is_symlink():
            path.unlink()
        shutil.copyfile(expected[name], path)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    sync(parser.parse_args().check)
