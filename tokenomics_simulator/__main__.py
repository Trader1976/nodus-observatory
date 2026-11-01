"""Run a local economic scenario without Observatory or a Nodus node."""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
import sys

from . import ParameterError, simulate


def _unique_object(pairs):
    values = {}
    for key, value in pairs:
        if key in values:
            raise ParameterError("duplicate parameter key")
        values[key] = value
    return values


def main(argv=None):
    parser = argparse.ArgumentParser(description="Hypothetical Nodus stock-flow scenario; no chain operations")
    parser.add_argument("--parameters", type=Path, help="JSON object containing scenario parameter overrides")
    parser.add_argument("--output", type=Path, help="Write full JSON result to this file instead of stdout")
    parser.add_argument("--csv", type=Path, help="Also export monthly series to CSV")
    args = parser.parse_args(argv)
    if args.output and args.csv and args.output.resolve() == args.csv.resolve():
        parser.error("JSON output and CSV output must be different files")
    if args.parameters and any(path and path.resolve() == args.parameters.resolve() for path in (args.output, args.csv)):
        parser.error("an output must not overwrite the parameter input file")
    try:
        if args.parameters:
            if args.parameters.stat().st_size > 32_768:
                raise ParameterError("parameter file is larger than 32 KiB")
            values = json.loads(args.parameters.read_text(encoding="utf-8"), object_pairs_hook=_unique_object)
        else:
            values = None
        result = simulate(values)
        content = json.dumps(result, ensure_ascii=False, allow_nan=False, indent=2) + "\n"
        if args.output:
            args.output.write_text(content, encoding="utf-8")
        else:
            sys.stdout.write(content)
        if args.csv:
            with args.csv.open("w", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=list(result["series"][0]))
                writer.writeheader()
                writer.writerows(result["series"])
    except (OSError, ValueError, TypeError) as error:
        parser.error(str(error))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
