/** Reproducible Nodus-address256 artifacts for the OPTIONAL sandbox wallet trial.
 * This compiles files only. It never loads an identity, connects or deploys.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executable = process.env.NODUS_SOLC;
if (!executable) throw Error('Set NODUS_SOLC to the pinned Nodus addr256 compiler.');
const identity = spawnSync(executable, ['--version'], {encoding:'utf8'});
const version = identity.stdout?.match(/Version: (.+)/)?.[1];
if (identity.status !== 0 || version !== '0.8.30+nodus.addr256.commit.73712a01.Linux.g++') throw Error('Wrong Nodus compiler.');
const names = ['SandboxDollar6', 'LendingReference'];
const sources = Object.fromEntries(names.map(name => [name+'.sol', {content:fs.readFileSync(path.join(root,'contracts',name+'.sol'),'utf8')}]));
const input = {language:'Solidity',sources,settings:{evmVersion:'prague',optimizer:{enabled:true,runs:200},metadata:{bytecodeHash:'none'},outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}}};
const processResult = spawnSync(executable, ['--standard-json','--no-import-callback'], {input:JSON.stringify(input),encoding:'utf8',maxBuffer:8*1024*1024});
if (processResult.status !== 0) throw Error(processResult.stderr);
const output = JSON.parse(processResult.stdout);
if (output.errors?.length) throw Error(output.errors.map(error=>error.formattedMessage).join('\n'));
const artifact = {schema:'nodus-test-defi/wallet-kit-v1',mode:'manual-testnet-sandbox',nativeTusdtCompatible:false,transactionsSent:false,
  chainId:'a48d1a785500a1cdecd739ecd53ef0e95b1dc4a7a300f49176a7fa25ae176114',
  loanAsset:{name:'Observatory Sandbox Dollar',symbol:'OSD6',decimals:6,kind:'separate-evm-test-token',redeemable:false},
  compiler:version,addressBytes:32,contracts:{}};
for (const name of names) {
  const file = name+'.sol', compiled = output.contracts[file][name];
  artifact.contracts[name] = {source:file,sourceSha256:createHash('sha256').update(sources[file].content).digest('hex'),abi:compiled.abi,
    creation:'0x'+compiled.evm.bytecode.object,runtime:'0x'+compiled.evm.deployedBytecode.object};
}
const text = JSON.stringify(artifact,null,2)+'\n', destination = path.join(root,'artifacts','wallet-kit.json');
const pin = createHash('sha256').update(text).digest('hex')+'  wallet-kit.json\n';
const pinFile = path.join(root,'artifacts','wallet-kit.sha256');
if (process.argv.includes('--check')) {
  if (fs.readFileSync(destination,'utf8') !== text || fs.readFileSync(pinFile,'utf8') !== pin) throw Error('Wallet-kit artifacts or integrity pin are stale. Rebuild with the pinned compiler.');
  console.log('Wallet-kit compiler outputs match their source. No chain transaction performed.');
} else {
  fs.writeFileSync(destination,text);
  fs.writeFileSync(pinFile,pin);
  console.log('Optional OSD6 sandbox wallet kit compiled. It does not support native tUSDT.');
}
