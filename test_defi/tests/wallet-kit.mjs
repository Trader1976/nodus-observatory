/** Export is offline and deterministic; it must not masquerade as native tUSDT. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const run=(file,args=[],options={})=>spawnSync(process.execPath,[file,...args],{encoding:'utf8',...options});
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-wallet-kit-export-'));
try {
  const script=path.join(root,'tools/export-wallet-kit.mjs'),first=path.join(dir,'first'),second=path.join(dir,'second');
  assert.equal(run(script,[]).status,1,'output is explicit, never an implicit repository write');
  for(const output of [first,second])assert.equal(run(script,['--output',output]).status,0);
  const manifest=JSON.parse(fs.readFileSync(path.join(first,'manifest.json'),'utf8'));
  assert.equal(manifest.nativeTusdtCompatible,false);assert.equal(manifest.transactionsSent,false);
  assert.equal(manifest.loanAsset.symbol,'OSD6');assert.equal(manifest.loanAsset.redeemable,false);
  assert.equal(manifest.addressBytes,32);
  assert.deepEqual(manifest.deployedAddresses,{SandboxDollar6:null,LendingReference:null});
  for(const name of fs.readdirSync(first))assert.equal(fs.readFileSync(path.join(first,name),'utf8'),fs.readFileSync(path.join(second,name),'utf8'),'export reproducibility: '+name);
  for(const [name,sha] of Object.entries(manifest.files))assert.equal(createHash('sha256').update(fs.readFileSync(path.join(first,name))).digest('hex'),sha,'manifest binds '+name);
  assert.equal(run(script,['--output',first]).status,1,'existing trial must not be overwritten');
  // Reject aliases anywhere in the parent path, including an ancestor symlink.
  fs.mkdirSync(path.join(dir,'actual'));fs.mkdirSync(path.join(dir,'actual','nested'));
  fs.symlinkSync(path.join(dir,'actual'),path.join(dir,'alias'));
  assert.equal(run(script,['--output',path.join(dir,'alias','nested','kit')]).status,1);
  assert(!fs.existsSync(path.join(dir,'actual','nested','kit')));
  const tokenAbi=JSON.parse(fs.readFileSync(path.join(first,'SandboxDollar6.abi.json'),'utf8'));
  const functions=tokenAbi.filter(item=>item.type==='function').map(item=>item.name);
  for(const forbidden of ['mint','setMode','setDecimals','setHook','transferOwnership','owner'])assert(!functions.includes(forbidden),'no configurable mock behavior '+forbidden);
  for(const fn of ['approve','transfer','transferFrom','balanceOf','allowance','totalSupply','decimals','name','symbol'])assert(functions.includes(fn));

  // Corrupted scope or stale sources fail before the output directory is created.
  const fixture=path.join(dir,'fixture');fs.mkdirSync(fixture);
  for(const name of ['tools','contracts','artifacts'])fs.mkdirSync(path.join(fixture,name));
  fs.copyFileSync(script,path.join(fixture,'tools/export-wallet-kit.mjs'));
  for(const name of ['SandboxDollar6.sol','LendingReference.sol'])fs.copyFileSync(path.join(root,'contracts',name),path.join(fixture,'contracts',name));
  const original=JSON.parse(fs.readFileSync(path.join(root,'artifacts/wallet-kit.json'),'utf8'));
  const target=path.join(dir,'bad-output');
  const artifactFile=path.join(fixture,'artifacts/wallet-kit.json'),pinFile=path.join(fixture,'artifacts/wallet-kit.sha256');
  function saveArtifact(value,updatePin=true) {
    const text=JSON.stringify(value);fs.writeFileSync(artifactFile,text);
    if(updatePin)fs.writeFileSync(pinFile,createHash('sha256').update(text).digest('hex')+'  wallet-kit.json\n');
  }
  for(const patch of [{nativeTusdtCompatible:true},{mode:'native-token'},{loanAsset:{...original.loanAsset,symbol:'tUSDT'}},
      {loanAsset:{...original.loanAsset,redeemable:true}},{addressBytes:20},{chainId:'mainnet'},{compiler:'stock-solidity'}]){
    saveArtifact({...original,...patch});
    assert.equal(run(path.join(fixture,'tools/export-wallet-kit.mjs'),['--output',target]).status,1);assert(!fs.existsSync(target));
  }
  for(const patch of [{abi:[]},{creation:'0x00'},{runtime:'0x00'}]) {
    saveArtifact(original);
    const changed=structuredClone(original);Object.assign(changed.contracts.LendingReference,patch);
    saveArtifact(changed,false);
    const result=run(path.join(fixture,'tools/export-wallet-kit.mjs'),['--output',target]);
    assert.equal(result.status,1);assert.match(result.stderr,/integrity mismatch/);assert(!fs.existsSync(target));
  }
  saveArtifact(original);
  fs.appendFileSync(path.join(fixture,'contracts/SandboxDollar6.sol'),'\n// drift\n');
  assert.equal(run(path.join(fixture,'tools/export-wallet-kit.mjs'),['--output',target]).status,1);assert(!fs.existsSync(target));
  if(process.env.NODUS_SOLC) {
    const checked=run(path.join(root,'tools/build-wallet-kit.mjs'),['--check']);
    assert.equal(checked.status,0,checked.stderr||checked.stdout);
  }
  console.log('Wallet kit: deterministic exports, source/file hashes, fixed token ABI, no overwrite, invalid scope and source drift PASS.');
} finally {fs.rmSync(dir,{recursive:true,force:true});}
