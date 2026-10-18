#!/usr/bin/env python3
"""Prepare a machine-local monitor config from public CLI status and mount metadata.

Reads no identity keys, wallet files or Nodus configuration; changes no services.
"""
import argparse
import json
from pathlib import Path
import re
import shutil

from collector import load_config, parse_status, run_command


def command(args):
    result = run_command(args, timeout=40)
    if result["returncode"] or result["error"]:
        raise ValueError("discovery command failed: " + args[0])
    return result["output"]


def discover(config):
    config = dict(config)
    cli = shutil.which("nodus-cli") or config["cli_path"]
    text = command([cli, "status"])
    status = parse_status(text)
    fp = status["node"].get("fingerprint")
    if not isinstance(fp, str) or not re.fullmatch(r"[a-fA-F0-9]{128}", fp):
        raise ValueError("local nodus-cli status did not return a fingerprint; start Nodus or supply --config")
    config.update(cli_path=cli, fingerprint=fp)
    data = re.search(r"^\s*data_path:\s*(/[^\r\n]+?)\s*$", text, re.M)
    data_path = Path(data.group(1) if data else config["data_path"]).resolve()
    if not data_path.is_dir():
        raise ValueError("Nodus data directory is missing; supply --config with the correct data_path")
    # findmnt is from util-linux on the supported Debian/Ubuntu hosts. JSON
    # preserves spaces in mount paths; / is valid for nodes without a data partition.
    mounts = json.loads(command(["findmnt", "--json", "--target", str(data_path), "--output", "TARGET,SOURCE"]))
    filesystems = mounts.get("filesystems", [])
    if len(filesystems) != 1 or not Path(filesystems[0]["target"]).is_absolute():
        raise ValueError("could not identify the data filesystem")
    config.update(data_path=str(data_path), mount_path=filesystems[0]["target"])
    source = filesystems[0].get("source", "").split("[", 1)[0]
    config["disk_device"] = None
    if source.startswith("/dev/"):
        # Use the physical parent for a plain partition. Keep SMART unknown for
        # multi-device/LVM/RAID stacks instead of attributing it to an arbitrary disk.
        rows = command(["lsblk", "--json", "--paths", "--output", "NAME,TYPE,PKNAME", source])
        devices = json.loads(rows).get("blockdevices", [])
        if len(devices) == 1 and devices[0].get("type") in ("disk", "part"):
            device = devices[0]
            name = device.get("pkname") if device["type"] == "part" else device.get("name")
            if name and re.fullmatch(r"[a-zA-Z0-9_.-]+", Path(name).name):
                config["disk_device"] = Path(name).name
    chain_id = status["chain"].get("chain_id")
    if not isinstance(chain_id, str) or not re.fullmatch(r"[a-fA-F0-9]{64}", chain_id):
        raise ValueError("local node did not report a valid chain id; supply --config")
    config["rewards_source_db"] = str(data_path / ("witness_" + chain_id[:32] + ".db"))
    config["network_interface"] = None  # Collector follows the default route.
    return config


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--template", default=str(Path(__file__).with_name("config.example.json")))
    parser.add_argument("--output", required=True, help="new configuration file (must not exist)")
    args = parser.parse_args()
    config = discover(load_config(args.template))
    with Path(args.output).open("x") as output:
        output.write(json.dumps(config, indent=2) + "\n")


if __name__ == "__main__":
    main()
