"""The offline export boundary: real process invocation, no network or wallet."""

import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("contract_studio_compile", ROOT / "tools/contract-studio/compile.py")
COMPILER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COMPILER)


class CompileBundleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "a source with spaces.sol"
        self.source.write_text("// SPDX-License-Identifier: MIT\npragma solidity =0.8.30;\ncontract ObservatoryEscrow {}\n")
        self.output = self.root / "result"

    def compiler(self, *, version=COMPILER.COMPILER_VERSION + ".Linux.g++", result=None, body=None,
                 contract_name=COMPILER.CONTRACT_NAME):
        if result is None:
            result = {"contracts": {f"{contract_name}.sol": {contract_name: {
                "abi": [{"type": "constructor", "inputs": [], "stateMutability": "nonpayable"}],
                "evm": {"bytecode": {"object": "60006000", "linkReferences": {}},
                        "deployedBytecode": {"object": "6000", "linkReferences": {}}},
                "metadata": json.dumps({"compiler": {"version": COMPILER.COMPILER_VERSION}}),
                "storageLayout": {"storage": [], "types": None},
            }}}}
        script = self.root / "selected compiler"
        script.write_text(f"#!{sys.executable}\nimport json,sys,time\n" + (body or (
            f"if '--version' in sys.argv:\n print('Version: {version}')\nelse:\n"
            " request=json.load(sys.stdin)\n"
            " assert request['settings']['evmVersion']=='prague'\n"
            " assert request['settings']['optimizer']=={'enabled':True,'runs':200}\n"
            " assert '--no-import-callback' in sys.argv\n"
            f" assert set(request['sources'])=={{{(contract_name + '.sol')!r}}}\n"
            f" print({json.dumps(json.dumps(result))})\n"
        )))
        script.chmod(0o755)
        return script

    def test_packages_actual_result_and_independent_project_provenance(self):
        compiler = self.compiler()
        project = self.root / "project.json"
        project.write_text('{"schema":"unverified-project"}\n')
        manifest = COMPILER.compile_bundle(self.source, compiler, self.output, project)
        self.assertTrue(manifest["compiled"])
        self.assertFalse(manifest["deployed"])
        self.assertEqual(manifest["address_bytes"], 32)
        self.assertEqual(manifest["project_source_binding"], "not_verified")
        self.assertNotEqual(manifest["source_sha256"], manifest["project_sha256"])
        self.assertEqual((self.output / "ObservatoryEscrow.creation.hex").read_text(), "0x60006000\n")
        self.assertEqual((self.output / "ObservatoryEscrow.runtime.hex").read_text(), "0x6000\n")
        self.assertEqual((self.output / COMPILER.SOURCE_NAME).read_bytes(), self.source.read_bytes())
        for name, details in manifest["files"].items():
            self.assertEqual(COMPILER.digest((self.output / name).read_bytes()), details["sha256"])
        self.assertFalse(manifest["compiler"]["matches_documented_official_binary"])

    def test_documents_contract_uses_explicit_source_and_artifact_names(self):
        self.source.write_text("pragma solidity =0.8.30; contract ObservatoryDocuments {}")
        manifest = COMPILER.compile_bundle(self.source, self.compiler(contract_name="ObservatoryDocuments"),
                                           self.output, contract_name="ObservatoryDocuments")
        self.assertEqual(manifest["contract"], "ObservatoryDocuments")
        self.assertEqual((self.output / "ObservatoryDocuments.sol").read_bytes(), self.source.read_bytes())
        self.assertEqual((self.output / "ObservatoryDocuments.creation.hex").read_text(), "0x60006000\n")
        self.assertTrue((self.output / "ObservatoryDocuments.abi.json").is_file())
        self.assertFalse(any("ObservatoryEscrow" in path.name for path in self.output.iterdir()))

    def test_unsupported_contract_names_fail_before_reading_source_or_running_compiler(self):
        for name in ("Other", "../ObservatoryDocuments", "ObservatoryDocuments.sol", "ObservatoryDocuments\n", "", None, []):
            with self.subTest(name=name), self.assertRaisesRegex(COMPILER.CompileError, "Unsupported contract"):
                COMPILER.compile_bundle("/missing/source", "/missing/compiler", self.output, contract_name=name)
        self.assertFalse(self.output.exists())

    def test_cli_rejects_arbitrary_contract_names(self):
        completed = subprocess.run(
            [sys.executable, str(ROOT / "tools/contract-studio/compile.py"), str(self.source),
             "--contract", "Other", "--solc", "/missing/compiler", "--out", str(self.output)],
            capture_output=True, text=True, timeout=10,
        )
        self.assertEqual(completed.returncode, 2)
        self.assertIn("invalid choice", completed.stderr)
        self.assertFalse(self.output.exists())

    def test_rejects_stock_solc_and_wrong_nodus_revision(self):
        for version in ["0.8.30+commit.73712a01.Linux.g++", "0.8.31+nodus.addr256.commit.73712a01", "0.8.30+nodus.addr256.commit.deadbeef"]:
            with self.subTest(version=version), self.assertRaisesRegex(COMPILER.CompileError, "Wrong compiler"):
                COMPILER.compile_bundle(self.source, self.compiler(version=version), self.output)
        self.assertFalse(self.output.exists())

    def test_errors_in_standard_json_are_fatal_even_when_process_exits_zero(self):
        result = {"errors": [{"severity": "error", "formattedMessage": "TypeError: broken contract"}]}
        with self.assertRaisesRegex(COMPILER.CompileError, "broken contract"):
            COMPILER.compile_bundle(self.source, self.compiler(result=result), self.output)
        self.assertFalse(self.output.exists())

    def test_cannot_overwrite_existing_directory(self):
        self.output.mkdir()
        marker = self.output / "keep.txt"
        marker.write_text("keep")
        with self.assertRaisesRegex(COMPILER.CompileError, "Output already exists"):
            COMPILER.compile_bundle(self.source, self.compiler(), self.output)
        self.assertEqual(marker.read_text(), "keep")

    def test_rejects_imports_before_invoking_compiler(self):
        self.source.write_text('import "/private/file.sol";\ncontract ObservatoryEscrow {}')
        with self.assertRaisesRegex(COMPILER.CompileError, "imports are not allowed"):
            COMPILER.compile_bundle(self.source, "/does/not/exist", self.output)

    def test_timeout_does_not_leave_a_bundle(self):
        compiler = self.compiler(body="time.sleep(5)\n")
        with self.assertRaisesRegex(COMPILER.CompileError, "timed out"):
            COMPILER.compile_bundle(self.source, compiler, self.output, timeout=0.05)
        self.assertFalse(self.output.exists())

    def test_malformed_json_and_missing_output_are_rejected(self):
        for result in [[], {}, {"contracts": {}}]:
            with self.subTest(result=result), self.assertRaises(COMPILER.CompileError):
                COMPILER.compile_bundle(self.source, self.compiler(result=result), self.output)
        self.assertFalse(self.output.exists())

    def test_constructor_arguments_and_unresolved_bytecode_are_rejected(self):
        compiler = self.compiler()
        fixture = {"abi": [{"type": "constructor", "inputs": [{"name": "buyer", "type": "address"}]}],
                   "evm": {"bytecode": {"object": "6000"}, "deployedBytecode": {"object": "6000"}},
                   "metadata": json.dumps({"compiler": {"version": COMPILER.COMPILER_VERSION}}),
                   "storageLayout": {}}
        for key in ["constructor", "hex"]:
            if key == "hex":
                fixture["abi"] = []
                fixture["evm"]["bytecode"]["object"] = "__$unresolved$__"
            with self.subTest(case=key), self.assertRaises(COMPILER.CompileError):
                COMPILER.compile_bundle(self.source, self.compiler(result={"contracts": {COMPILER.SOURCE_NAME: {COMPILER.CONTRACT_NAME: fixture}}}), self.output)

    def test_malformed_nested_compiler_outputs_fail_without_traceback(self):
        for case in ("bytecode", "runtime", "metadata", "layout"):
            fixture = {"abi": [], "evm": {"bytecode": {"object": "6000"},
                                          "deployedBytecode": {"object": "6000"}},
                       "metadata": json.dumps({"compiler": {"version": COMPILER.COMPILER_VERSION}}),
                       "storageLayout": {}}
            if case == "bytecode":
                fixture["evm"]["bytecode"] = []
            elif case == "runtime":
                fixture["evm"]["deployedBytecode"] = None
            elif case == "metadata":
                fixture["metadata"] = json.dumps({"compiler": []})
            else:
                fixture["storageLayout"] = []
            with self.subTest(case=case), self.assertRaises(COMPILER.CompileError):
                COMPILER.compile_bundle(self.source, self.compiler(result={"contracts": {COMPILER.SOURCE_NAME: {COMPILER.CONTRACT_NAME: fixture}}}), self.output)
        self.assertFalse(self.output.exists())

    def test_input_and_process_output_limits_leave_no_artifacts(self):
        self.source.write_bytes(b"a" * (COMPILER.MAX_INPUT_BYTES + 1))
        with self.assertRaisesRegex(COMPILER.CompileError, "at most"):
            COMPILER.compile_bundle(self.source, "/does/not/exist", self.output)
        self.source.write_text("contract ObservatoryEscrow {}")
        compiler = self.compiler(body=f"sys.stdout.write('x' * {COMPILER.MAX_OUTPUT_BYTES + 1})\n")
        with self.assertRaises(COMPILER.CompileError):
            COMPILER.compile_bundle(self.source, compiler, self.output)
        self.assertFalse(self.output.exists())

    @unittest.skipUnless(os.environ.get("NODUS_STUDIO_SOLC"), "Optional real Nodus compiler not provided")
    def test_real_nodus_compiler_address32_storage_and_reproducibility(self):
        self.source.write_text("// SPDX-License-Identifier: MIT\npragma solidity =0.8.30;\n"
                               "contract ObservatoryEscrow { address public buyer; uint8 public state; "
                               "constructor() { buyer = msg.sender; } }\n")
        one = COMPILER.compile_bundle(self.source, os.environ["NODUS_STUDIO_SOLC"], self.output)
        second = self.root / "result-two"
        two = COMPILER.compile_bundle(self.source, os.environ["NODUS_STUDIO_SOLC"], second)
        self.assertEqual(one, two)
        for name in one["files"]:
            self.assertEqual((self.output / name).read_bytes(), (second / name).read_bytes())
        layout = json.loads((self.output / "ObservatoryEscrow.storage-layout.json").read_text())
        self.assertEqual(layout["types"]["t_address"]["numberOfBytes"], "32")
        self.assertEqual(layout["storage"][1]["slot"], "1")
        self.assertEqual(one["project_source_binding"], "not_provided")

    @unittest.skipUnless(os.environ.get("NODUS_STUDIO_SOLC") and shutil.which("node"),
                         "Optional real compiler and development Node.js not provided")
    def test_real_editor_generated_escrow_compiles_with_full_width_constants(self):
        # Exercise the production generator, not a separately maintained Solidity fixture.
        script = """
        require('./dist/contract-studio-core.js');
        const project=NodusStudioCore.defaultDraft();
        project.config.buyer='0x'+'1'.repeat(64);
        project.config.seller='0x'+'2'.repeat(64);
        project.config.amountNodus='100.00000001';
        project.config.deadline='2030-01-02T12:00:00Z';
        process.stdout.write(NodusStudioCore.generate(project));
        """
        generated = subprocess.run([shutil.which("node"), "-e", script], cwd=ROOT,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   check=True, timeout=10)
        self.source.write_bytes(generated.stdout)
        manifest = COMPILER.compile_bundle(self.source, os.environ["NODUS_STUDIO_SOLC"], self.output)
        self.assertEqual(json.loads((self.output / "compiler-diagnostics.json").read_text()), [])
        abi = json.loads((self.output / "ObservatoryEscrow.abi.json").read_text())
        functions = {item["name"]: item for item in abi if item.get("type") == "function"}
        self.assertEqual(set(functions), {"amountWei", "approve", "buyer", "cancel", "deadline", "deposit", "refund", "seller", "stage", "withdraw"})
        self.assertEqual(functions["deposit"]["stateMutability"], "payable")
        for name in ("approve", "withdraw", "refund", "cancel"):
            self.assertEqual(functions[name]["stateMutability"], "nonpayable")
        for name in ("buyer", "seller"):
            self.assertEqual(functions[name]["outputs"][0]["type"], "address")
        self.assertFalse(any(item.get("type") == "constructor" and item.get("inputs") for item in abi))
        runtime = (self.output / "ObservatoryEscrow.runtime.hex").read_text()
        for digit in ("1", "2"):
            # The optimizer can load constants from its code data area rather
            # than PUSH32. Check the entire data word, without prescribing opcodes.
            self.assertIn(digit * 64, runtime, "The real compiler retains the complete 32-byte party constant")
        self.assertEqual(manifest["source_sha256"], COMPILER.digest(generated.stdout))
        second = self.root / "second-generated-bundle"
        repeated = COMPILER.compile_bundle(self.source, os.environ["NODUS_STUDIO_SOLC"], second)
        self.assertEqual(manifest, repeated)

    @unittest.skipUnless(os.environ.get("NODUS_STUDIO_SOLC"), "Optional real Nodus compiler not provided")
    def test_real_document_registry_matches_the_bundled_public_artifact(self):
        self.source.write_bytes((ROOT / "contracts/ObservatoryDocuments.sol").read_bytes())
        bundled = json.loads((ROOT / "dist/document-registry.json").read_text())
        manifest = COMPILER.compile_bundle(self.source, os.environ["NODUS_STUDIO_SOLC"], self.output,
                                           contract_name="ObservatoryDocuments")
        self.assertEqual(json.loads((self.output / "compiler-diagnostics.json").read_text()), [])
        self.assertEqual(manifest["contract"], "ObservatoryDocuments")
        self.assertEqual(manifest["source_sha256"], bundled["sourceSha256"])
        self.assertEqual(json.loads((self.output / "ObservatoryDocuments.abi.json").read_text()), bundled["abi"])
        self.assertEqual((self.output / "ObservatoryDocuments.creation.hex").read_text().strip(), bundled["creationBytecode"])
        self.assertEqual((self.output / "ObservatoryDocuments.runtime.hex").read_text().strip(), bundled["runtimeBytecode"])
        self.assertFalse(any("ObservatoryEscrow" in path.name for path in self.output.iterdir()))
        repeated = COMPILER.compile_bundle(self.source, os.environ["NODUS_STUDIO_SOLC"], self.root / "registry-two",
                                           contract_name="ObservatoryDocuments")
        self.assertEqual(manifest, repeated)

    @unittest.skipUnless(os.environ.get("NODUS_STUDIO_SOLC") and shutil.which("node"),
                         "Optional real compiler and development Node.js not provided")
    def test_real_workflow_templates_and_extended_actions_compile(self):
        # Compile the shipped generator's output, including quorum, evidence,
        # balance predicates and OR groups. No handwritten Solidity substitute.
        script = """
        require('./dist/contract-studio-core.js');
        require('./dist/contract-studio-workflow-core.js');
        const samples=[];
        for (const template of NodusWorkflowCore.templates) {
          const project=NodusWorkflowCore.defaultDraft(template);
          project.config.deadline='2030-01-02T12:00:00Z';
          project.roles.forEach((role,index)=>role.address='0x'+String(index+1).repeat(64));
          if (template==='blank') {
            project.states.push({id:'finished',label:'Finished',initial:false,terminal:true,x:400,y:100});
            project.transitions.push({id:'finish',label:'Finish',from:'start',to:'finished',
              caller:'owner',operation:'move',recipient:'',amountNodus:'',guard:{mode:'all',conditions:[]}});
          }
          if (template==='escrow') {
            project.transitions.push({id:'attest',label:'Record evidence',from:'created',to:'created',
              caller:'buyer',operation:'recordHash',recipient:'',amountNodus:'',
              guard:{mode:'any',conditions:[{type:'approvedBy',value:'buyer'},
                {type:'hashEquals',value:'0x'+'0'.repeat(64)}]}});
            project.transitions.push({id:'vote',label:'Record approval',from:'created',to:'created',
              caller:'buyer',operation:'approve',recipient:'',amountNodus:'',
              guard:{mode:'all',conditions:[]}});
            project.transitions.find(t=>t.id==='withdraw').guard.conditions.push({type:'balanceAtLeast',value:'100'});
          }
          samples.push({template,project,source:NodusWorkflowCore.generate(project),
            actions:NodusWorkflowCore.describeActions(project)});
        }
        process.stdout.write(JSON.stringify(samples));
        """
        generated = subprocess.run([shutil.which("node"), "-e", script], cwd=ROOT,
                                   capture_output=True, check=True, timeout=10)
        for sample in json.loads(generated.stdout):
            with self.subTest(template=sample["template"]):
                self.source.write_text(sample["source"], encoding="utf-8")
                output = self.root / ("workflow-" + sample["template"])
                manifest = COMPILER.compile_bundle(self.source, os.environ["NODUS_STUDIO_SOLC"], output,
                                                   contract_name="ObservatoryWorkflow")
                diagnostics = json.loads((output / "compiler-diagnostics.json").read_text())
                self.assertFalse(any(item.get("severity") == "error" for item in diagnostics))
                self.assertEqual(manifest["contract"], "ObservatoryWorkflow")
                self.assertEqual((output / "ObservatoryWorkflow.sol").read_bytes(), self.source.read_bytes())
                functions = {item["name"]: item for item in json.loads((output / "ObservatoryWorkflow.abi.json").read_text())
                             if item.get("type") == "function"}
                for action in sample["actions"]:
                    transition = next(item for item in sample["project"]["transitions"] if item["id"] == action["id"])
                    function = functions[action["functionName"]]
                    self.assertEqual(function["stateMutability"], "payable" if transition["operation"] == "deposit" else "nonpayable")
                    self.assertEqual([item["type"] for item in function["inputs"]],
                                     ["bytes32"] if transition["operation"] == "recordHash" else [])
                for index in range(len(sample["project"]["roles"])):
                    self.assertEqual(functions[f"role_{index}"]["outputs"][0]["type"], "address")
                self.assertFalse(any(item.get("type") == "constructor" and item.get("inputs")
                                     for item in json.loads((output / "ObservatoryWorkflow.abi.json").read_text())))


if __name__ == "__main__":
    unittest.main()
