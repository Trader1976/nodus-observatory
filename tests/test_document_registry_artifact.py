"""Pinned document registry artifact integrity and optional official recompile."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[1]


class DocumentRegistryArtifactTests(unittest.TestCase):
    def setUp(self):
        self.artifact = json.loads((ROOT / "dist/document-registry.json").read_text())
        self.source = (ROOT / "contracts/ObservatoryDocuments.sol").read_text()

    def test_pinned_runtime_source_and_nonpayable_interface(self):
        artifact = self.artifact
        self.assertEqual(artifact["schema"], "nodus-document-registry-artifact/v1")
        self.assertEqual(artifact["contractName"], "ObservatoryDocuments")
        self.assertEqual(artifact["sourceSha256"], hashlib.sha256(self.source.encode()).hexdigest())
        self.assertEqual(artifact["runtimeSha256"], hashlib.sha256(bytes.fromhex(artifact["runtimeBytecode"][2:])).hexdigest())
        for key in ("creationBytecode", "runtimeBytecode"):
            self.assertRegex(artifact[key], re.compile(r"\A0x(?:[0-9a-f]{2})+\Z"))
        functions = {item["name"]: item for item in artifact["abi"] if item["type"] == "function"}
        self.assertEqual(set(functions), {"record", "register", "revoke"})
        self.assertEqual([item["type"] for item in functions["record"]["outputs"]], ["bool", "uint256", "uint256", "bool"])
        self.assertEqual(functions["record"]["stateMutability"], "view")
        self.assertTrue(all(functions[name]["stateMutability"] == "nonpayable" for name in ("register", "revoke")))
        self.assertFalse(any(item["type"] in ("constructor", "receive", "fallback") for item in artifact["abi"]))

    @unittest.skipUnless(os.environ.get("NODUS_STUDIO_SOLC"), "set NODUS_STUDIO_SOLC to recompile with official Nodus solc")
    def test_recompile_with_official_address256_compiler(self):
        compiler = Path(os.environ["NODUS_STUDIO_SOLC"])
        self.assertEqual(hashlib.sha256(compiler.read_bytes()).hexdigest(), self.artifact["compiler"]["binarySha256"])
        request = {
            "language": "Solidity",
            "sources": {"ObservatoryDocuments.sol": {"content": self.source}},
            "settings": {
                "evmVersion": "prague", "optimizer": {"enabled": True, "runs": 200},
                "metadata": {"bytecodeHash": "none"},
                "outputSelection": {"*": {"*": ["abi", "evm.methodIdentifiers", "evm.bytecode.object", "evm.deployedBytecode.object"]}},
            },
        }
        result = subprocess.run([str(compiler), "--standard-json", "--no-import-callback"], input=json.dumps(request), text=True, capture_output=True, timeout=60, check=True)
        output = json.loads(result.stdout)
        self.assertEqual(output.get("errors", []), [])
        contract = output["contracts"]["ObservatoryDocuments.sol"]["ObservatoryDocuments"]
        self.assertEqual(contract["abi"], self.artifact["abi"])
        self.assertEqual("0x" + contract["evm"]["bytecode"]["object"], self.artifact["creationBytecode"])
        self.assertEqual("0x" + contract["evm"]["deployedBytecode"]["object"], self.artifact["runtimeBytecode"])
        self.assertEqual(contract["evm"]["methodIdentifiers"], {"record(address,bytes32)": "170c6999", "register(bytes32)": "e1fa8e84", "revoke(bytes32)": "b75c7dc6"})


if __name__ == "__main__":
    unittest.main()
