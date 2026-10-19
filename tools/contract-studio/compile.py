#!/usr/bin/env python3
"""Compile a Contract Studio source offline with an explicitly chosen Nodus solc.

This helper never downloads a compiler, loads keys, or submits transactions.
Only the Solidity source is compiled. An optional project is an archival copy;
its relationship to the source is deliberately not asserted by this helper.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

try:
    import resource
except ImportError:  # Non-POSIX hosts still enforce time and acceptance limits.
    resource = None


UPSTREAM_COMMIT = "908f76102ac3ded448f2c87ac72772e0c02642c0"
COMPILER_VERSION = "0.8.30+nodus.addr256.commit.73712a01"
OFFICIAL_COMPILER_SHA256 = "6c981f36ee790a46fa2310c4eb925e35909b020a58a19654a063517947ceffb4"
OFFICIAL_ARCHIVE_SHA256 = "a09d6486c944a795009f08dbc8210ce2eee2785248f9f5f7edc2aaa9c6934649"
SOURCE_NAME = "ObservatoryEscrow.sol"
CONTRACT_NAME = "ObservatoryEscrow"
CONTRACT_NAMES = (CONTRACT_NAME, "ObservatoryDocuments")
MAX_INPUT_BYTES = 1024 * 1024
MAX_OUTPUT_BYTES = 16 * 1024 * 1024
SETTINGS = {
    "optimizer": {"enabled": True, "runs": 200},
    "evmVersion": "prague",
    "metadata": {"bytecodeHash": "none"},
    "outputSelection": {"*": {"*": [
        "abi", "evm.bytecode.object", "evm.bytecode.linkReferences",
        "evm.deployedBytecode.object", "evm.deployedBytecode.linkReferences",
        "metadata", "storageLayout",
    ]}},
}


class CompileError(Exception):
    """An input or compiler result cannot be used as an export."""


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_input(path):
    path = Path(path)
    if not path.is_file() or path.stat().st_size > MAX_INPUT_BYTES:
        raise CompileError(f"Input must be a regular file of at most {MAX_INPUT_BYTES} bytes: {path}")
    data = path.read_bytes()
    try:
        data.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise CompileError(f"Input is not UTF-8: {path}") from exc
    return data


def compiler_run(compiler, args, data=None, timeout=60):
    """No shell or import directory; bounded time and on-disk captured output."""
    def limit_output_files():
        resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_OUTPUT_BYTES, MAX_OUTPUT_BYTES))

    with tempfile.TemporaryDirectory(prefix="nodus-solc-run-") as cwd:
        with tempfile.TemporaryFile() as stdout, tempfile.TemporaryFile() as stderr:
            try:
                completed = subprocess.run(
                    [str(compiler), *args], input=data, stdout=stdout, stderr=stderr,
                    cwd=cwd, timeout=timeout, check=False,
                    preexec_fn=limit_output_files if resource is not None else None,
                )
            except subprocess.TimeoutExpired as exc:
                raise CompileError(f"Compiler timed out after {timeout} seconds.") from exc
            except OSError as exc:
                raise CompileError(f"Could not execute the selected compiler: {exc}") from exc
            if stdout.tell() > MAX_OUTPUT_BYTES or stderr.tell() > MAX_OUTPUT_BYTES:
                raise CompileError("Compiler output exceeded the 16 MiB limit.")
            stdout.seek(0)
            stderr.seek(0)
            try:
                out, err = stdout.read().decode("utf-8"), stderr.read().decode("utf-8")
            except UnicodeDecodeError as exc:
                raise CompileError("Compiler output is not UTF-8.") from exc
    if completed.returncode != 0:
        detail = (err or out or "no diagnostic")[:4000].strip()
        raise CompileError(f"Compiler exited with code {completed.returncode}: {detail}")
    if err.strip():
        raise CompileError(f"Unexpected compiler stderr: {err[:4000].strip()}")
    return out


def compiler_identity(compiler, timeout):
    version = compiler_run(compiler, ["--version"], timeout=timeout)
    match = re.search(r"^Version: (\S+)\s*$", version, re.MULTILINE)
    if not match or not re.fullmatch(re.escape(COMPILER_VERSION) + r"(?:\.[A-Za-z0-9+_-]+)*", match[1]):
        raise CompileError(
            "Wrong compiler. Need Solidity 0.8.30 with nodus.addr256 and commit.73712a01; "
            "stock Ethereum solc truncates Nodus addresses."
        )
    return match[1]


def check_hex(value, label, limit):
    if not isinstance(value, str) or not re.fullmatch(r"(?:[0-9a-fA-F]{2})+", value):
        raise CompileError(f"{label} is empty, malformed, or contains unresolved library references.")
    if len(value) // 2 > limit:
        raise CompileError(f"{label} exceeds the Prague size limit ({limit} bytes).")
    return value.lower()


def compile_bundle(source_path, compiler_path, output_path, project_path=None, timeout=60,
                   contract_name=CONTRACT_NAME):
    if not isinstance(contract_name, str) or contract_name not in CONTRACT_NAMES:
        raise CompileError("Unsupported contract. Choose ObservatoryEscrow or ObservatoryDocuments.")
    source_name = f"{contract_name}.sol"
    source = read_input(source_path)
    # The editor emits self-contained code. Even an import inside a comment is
    # refused here rather than trying to resolve user-supplied paths or URLs.
    if re.search(r"\bimport\b", source.decode("utf-8")):
        raise CompileError("Contract Studio exports must be self-contained: imports are not allowed.")
    project = read_input(project_path) if project_path else None
    if project is not None:
        try:
            if not isinstance(json.loads(project), dict):
                raise ValueError("not an object")
        except (ValueError, UnicodeDecodeError) as exc:
            raise CompileError("The optional archived project must be a JSON object.") from exc
    compiler = Path(compiler_path).expanduser().resolve()
    if not compiler.is_file() or not os.access(compiler, os.X_OK):
        raise CompileError("--solc must name an executable compiler file.")
    output = Path(output_path).expanduser().absolute()
    if output.exists() or output.is_symlink():
        raise CompileError("Output already exists. Choose a new directory; existing files are never overwritten.")
    version = compiler_identity(compiler, timeout)
    compiler_hash = digest(compiler.read_bytes())
    standard_input = {
        "language": "Solidity", "sources": {source_name: {"content": source.decode("utf-8")}},
        "settings": SETTINGS,
    }
    try:
        result = json.loads(compiler_run(
            compiler, ["--standard-json", "--no-import-callback"],
            json.dumps(standard_input, sort_keys=True).encode("utf-8"), timeout,
        ))
    except json.JSONDecodeError as exc:
        raise CompileError("Compiler did not return valid Standard JSON.") from exc
    if not isinstance(result, dict):
        raise CompileError("Compiler did not return a Standard JSON object.")
    diagnostics = result.get("errors", [])
    if not isinstance(diagnostics, list) or any(not isinstance(d, dict) for d in diagnostics):
        raise CompileError("Malformed compiler diagnostics.")
    failures = [d for d in diagnostics if d.get("severity") == "error"]
    if failures:
        raise CompileError("Compilation failed:\n" + "\n".join(
            str(d.get("formattedMessage", d.get("message", "compiler error")))[:4000]
            for d in failures[:10]
        ))
    try:
        compiled = result["contracts"][source_name][contract_name]
        abi = compiled["abi"]
        creation = compiled["evm"]["bytecode"]
        runtime = compiled["evm"]["deployedBytecode"]
        metadata = json.loads(compiled["metadata"])
        layout = compiled["storageLayout"]
    except (KeyError, TypeError, json.JSONDecodeError) as exc:
        raise CompileError(f"Missing or malformed {contract_name} compiler output.") from exc
    if not isinstance(abi, list) or any(not isinstance(item, dict) for item in abi):
        raise CompileError("Contract ABI is not an array of objects.")
    if any(item.get("type") == "constructor" and item.get("inputs") for item in abi):
        raise CompileError("This export workflow supports a constructor without arguments only.")
    if not isinstance(creation, dict) or not isinstance(runtime, dict) or not isinstance(layout, dict):
        raise CompileError("Malformed bytecode or storage-layout output.")
    if creation.get("linkReferences") or runtime.get("linkReferences"):
        raise CompileError("Linked libraries are not supported by the Nodus address32 workflow.")
    if (not isinstance(metadata, dict) or not isinstance(metadata.get("compiler"), dict)
            or metadata["compiler"].get("version") != COMPILER_VERSION):
        raise CompileError("Metadata does not identify the required Nodus address32 compiler.")
    creation_hex = check_hex(creation.get("object"), "Creation bytecode", 49152)
    runtime_hex = check_hex(runtime.get("object"), "Runtime bytecode", 24576)
    if compiler_hash != digest(compiler.read_bytes()):
        raise CompileError("Compiler changed during the compilation.")

    def json_bytes(value):
        return (json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode("utf-8")

    files = {
        source_name: source,
        f"{contract_name}.abi.json": json_bytes(abi),
        f"{contract_name}.creation.hex": ("0x" + creation_hex + "\n").encode("ascii"),
        f"{contract_name}.runtime.hex": ("0x" + runtime_hex + "\n").encode("ascii"),
        f"{contract_name}.metadata.json": json_bytes(metadata),
        f"{contract_name}.storage-layout.json": json_bytes(layout),
        "compiler-input.json": json_bytes(standard_input),
        "compiler-diagnostics.json": json_bytes(diagnostics),
    }
    if project is not None:
        files["project.json"] = project
    manifest = {
        "schema": "nodus-observatory-compiled-contract-v1", "contract": contract_name,
        "compiled": True, "deployed": False, "address_bytes": 32,
        "compiler": {"version": version, "sha256": compiler_hash,
                     "matches_documented_official_binary": compiler_hash == OFFICIAL_COMPILER_SHA256},
        "upstream_reference": f"https://github.com/nocdem/dna/tree/{UPSTREAM_COMMIT}",
        "settings": SETTINGS, "source_sha256": digest(source),
        "project_sha256": digest(project) if project is not None else None,
        "project_source_binding": "not_verified" if project is not None else "not_provided",
        "bytecode_bytes": {"creation": len(creation_hex) // 2, "runtime": len(runtime_hex) // 2},
        "files": {name: {"sha256": digest(data), "bytes": len(data)} for name, data in files.items()},
        "notes": [
            "Creation bytecode is for deployment; runtime bytecode is not a deployment input.",
            "Compilation is not a security audit or proof of equivalence to the visual project.",
            "No keys were read and no transaction was built, signed, or submitted.",
        ],
    }
    files["manifest.json"] = json_bytes(manifest)
    output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".nodus-compile-", dir=output.parent))
    try:
        for name, data in files.items():
            (staging / name).write_bytes(data)
        if output.exists() or output.is_symlink():
            raise CompileError("Output appeared during compilation; nothing was overwritten.")
        staging.rename(output)
    finally:
        if staging.exists():
            shutil.rmtree(staging)
    return manifest


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", help="Exported Solidity source (UTF-8, self-contained)")
    parser.add_argument("--contract", choices=CONTRACT_NAMES, default=CONTRACT_NAME,
                        help="Contract to export (default: ObservatoryEscrow)")
    parser.add_argument("--solc", required=True, help="Explicit path to trusted solc-nodus")
    parser.add_argument("--out", required=True, help="New output directory (must not exist)")
    parser.add_argument("--project", help="Optional JSON project to archive, without asserting it matches the source")
    parser.add_argument("--timeout", type=int, default=60, help="Compiler timeout per invocation, 1–300 seconds")
    args = parser.parse_args(argv)
    if not 1 <= args.timeout <= 300:
        parser.error("--timeout must be between 1 and 300 seconds")
    try:
        manifest = compile_bundle(args.source, args.solc, args.out, args.project, args.timeout,
                                  contract_name=args.contract)
    except (CompileError, OSError) as exc:
        print(f"Contract Studio: {exc}", file=sys.stderr)
        return 1
    print(f"Compiled {manifest['contract']} with {manifest['compiler']['version']}")
    print(f"Files: {Path(args.out).absolute()}")
    print("Not deployed. Review the source, ABI and manifest before using the Nodus wallet.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
