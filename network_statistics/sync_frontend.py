#!/usr/bin/env python3
"""Copy canonical Statistics browser sources into the distributable frontend."""
from __future__ import annotations

import argparse
from pathlib import Path
import shutil


def sync(check=False):
    feature = Path(__file__).resolve().parent
    source = feature / "frontend"
    destination = feature.parent / "dist" / "statistics"
    expected = {p.name: p for p in source.iterdir() if p.is_file()
                and not p.is_symlink() and p.suffix in (".js", ".css", ".json", ".svg")}
    if not expected:
        raise ValueError("Statistics frontend sources are missing")
    if destination.is_symlink():
        raise ValueError("Statistics output must not be a symbolic link")
    actual = {p.name for p in destination.iterdir()} if destination.is_dir() else set()
    different = sorted(name for name, p in expected.items()
                       if not (destination / name).is_file()
                       or (destination / name).read_bytes() != p.read_bytes())
    extra = sorted(actual - set(expected))
    if check:
        if different or extra:
            raise ValueError("Run python3 network_statistics/sync_frontend.py; mismatches: "
                             + ", ".join(different + extra))
        return
    destination.mkdir(parents=True, exist_ok=True)
    for name in extra:
        p = destination / name
        if p.is_file() or p.is_symlink():
            p.unlink()
        else:
            raise ValueError("Unexpected directory in generated Statistics output")
    for name in different:
        p = destination / name
        if p.is_symlink():
            p.unlink()
        shutil.copyfile(expected[name], p)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    sync(parser.parse_args().check)
