/** Export ABI/creation files for manual wallet review. No automatic deployment.
 * Existing output directories are refused, so a previous trial is never replaced.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--output' || !args[1]) throw Error('Usage: node test_defi/tools/export-wallet-kit.mjs --output NEW_DIRECTORY');
const output = path.resolve(args[1]), parent = path.dirname(output);
if (fs.existsSync(output) || fs.realpathSync(parent) !== parent || !fs.statSync(parent).isDirectory()) throw Error('Choose a new output directory beneath an existing directory with no symlink ancestors.');
const artifactBytes = fs.readFileSync(path.join(root,'artifacts','wallet-kit.json'));
// This tracked release pin detects changed ABI/bytecode as well as metadata.
// It is an integrity check, not authentication of an untrusted repository copy.
const expectedPin = fs.readFileSync(path.join(root,'artifacts','wallet-kit.sha256'),'utf8');
if (expectedPin !== createHash('sha256').update(artifactBytes).digest('hex')+'  wallet-kit.json\n') throw Error('Wallet-kit artifact integrity mismatch. Verify the repository and rebuild/check with the pinned compiler.');
const artifact = JSON.parse(artifactBytes);
if (artifact.schema !== 'nodus-test-defi/wallet-kit-v1' || artifact.mode !== 'manual-testnet-sandbox'
    || artifact.nativeTusdtCompatible !== false || artifact.transactionsSent !== false || artifact.addressBytes !== 32
    || artifact.chainId !== 'a48d1a785500a1cdecd739ecd53ef0e95b1dc4a7a300f49176a7fa25ae176114'
    || artifact.compiler !== '0.8.30+nodus.addr256.commit.73712a01.Linux.g++'
    || artifact.loanAsset?.symbol !== 'OSD6' || artifact.loanAsset?.name !== 'Observatory Sandbox Dollar'
    || artifact.loanAsset?.kind !== 'separate-evm-test-token' || artifact.loanAsset?.decimals !== 6 || artifact.loanAsset?.redeemable !== false
    || Object.keys(artifact.contracts).sort().join(',') !== 'LendingReference,SandboxDollar6') throw Error('Unexpected wallet-kit identity or scope.');
const files = {};
for (const name of ['SandboxDollar6','LendingReference']) {
  const contract = artifact.contracts[name];
  const source = fs.readFileSync(path.join(root,'contracts',name+'.sol'),'utf8');
  if (contract.source !== name+'.sol' || contract.sourceSha256 !== createHash('sha256').update(source).digest('hex') || !Array.isArray(contract.abi)
      || !/^0x(?:[0-9a-f]{2})+$/.test(contract.creation) || !/^0x(?:[0-9a-f]{2})+$/.test(contract.runtime)) throw Error('Stale or invalid contract artifact. Rebuild and verify it.');
  files[name+'.abi.json'] = JSON.stringify(contract.abi,null,2)+'\n';
  files[name+'.creation.hex'] = contract.creation+'\n';
  files[name+'.runtime.hex'] = contract.runtime+'\n';
  files[name+'.sol'] = source;
}
files['manifest.json'] = JSON.stringify({schema:artifact.schema,mode:artifact.mode,chainId:artifact.chainId,addressBytes:32,
  nativeTusdtCompatible:false,transactionsSent:false,loanAsset:artifact.loanAsset,compiler:artifact.compiler,
  deployedAddresses:{SandboxDollar6:null,LendingReference:null},
  steps:[
    'Use dedicated testnet identities with native NODUS for fees. All OSD6 has no value or redemption.',
    'Deploy SandboxDollar6 with its ABI and creation bytecode, no constructor arguments or payable value.',
    'Check the successful receipt, resulting 32-byte address and exact runtime. Keep the receipt; do not automatically redeploy an uncertain transaction.',
    'Deploy LendingReference with tokenAddress equal to the confirmed SandboxDollar6 address, not a native token ID. Send no payable value.',
    'Check the successful receipt, runtime, token() and SUPPORTED_CHAIN_ID() before transferring or approving any test asset.',
    'Use the documented manual loan flow. Generic uint arguments use integer raw units; accept payable value uses human NODUS in the wallet field.'
  ],files:Object.fromEntries(Object.entries(files).map(([name,text])=>[name,createHash('sha256').update(text).digest('hex')]))},null,2)+'\n';
// mkdir without recursive creation is the exclusive reservation. If any write
// fails, remove only files created by this invocation, never pre-existing data.
fs.mkdirSync(output,{mode:0o700});
const created = [];
try {
  for (const [name,text] of Object.entries(files)) {
    const file=path.join(output,name),fd=fs.openSync(file,'wx',0o600);
    created.push(file);
    try {fs.writeFileSync(fd,text);} finally {fs.closeSync(fd);}
  }
} catch (error) {
  for (const file of created) fs.unlinkSync(file);
  // An unexpected concurrent file is not ours to delete.
  try {fs.rmdirSync(output);} catch { /* Preserve any file we did not create. */ }
  throw error;
}
console.log(`Exported ${Object.keys(files).length} files to ${output}. No signing, connection or deployment occurred. Native tUSDT is unsupported.`);
