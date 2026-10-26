/** Reproducible OFFLINE reference build. Never deploys or sends wallet requests.
 * The ERC20 mock is not the Nodus Wallet native UTXO tUSDT asset.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const executable=process.env.NODUS_SOLC;
if(!executable)throw Error('Set NODUS_SOLC to the pinned Nodus addr256 compiler.');
const version=spawnSync(executable,['--version'],{encoding:'utf8'}).stdout?.match(/Version: (.+)/)?.[1];
if(version!=='0.8.30+nodus.addr256.commit.73712a01.Linux.g++')throw Error('Wrong Nodus compiler.');
const sources=Object.fromEntries(['LendingReference.sol','MockUSDT6.sol'].map(name=>[name,{content:fs.readFileSync(path.join(root,'contracts',name),'utf8')} ]));
const input={language:'Solidity',sources,settings:{evmVersion:'prague',optimizer:{enabled:true,runs:200},metadata:{bytecodeHash:'none'},outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}}};
const result=spawnSync(executable,['--standard-json','--no-import-callback'],{input:JSON.stringify(input),encoding:'utf8',maxBuffer:8*1024*1024});
if(result.status!==0)throw Error(result.stderr);
const output=JSON.parse(result.stdout);
if(output.errors?.length)throw Error(output.errors.map(x=>x.formattedMessage).join('\n'));
const artifact={schema:'nodus-test-defi/offline-reference-v1',mode:'offline-mock-token-only',nativeTusdtCompatible:false,compiler:version,engineRevision:'2e881cc6e6d7a5050cc10400afc2b883f8fb712a',addressBytes:32,contracts:{}};
for(const [file,items] of Object.entries(output.contracts))for(const [name,data] of Object.entries(items)){
    artifact.contracts[name]={source:file,sourceSha256:createHash('sha256').update(sources[file].content).digest('hex'),abi:data.abi,creation:'0x'+data.evm.bytecode.object,runtime:'0x'+data.evm.deployedBytecode.object};
}
const text=JSON.stringify(artifact,null,2)+'\n',file=path.join(root,'artifacts','reference.json');
if(process.argv.includes('--check')){if(fs.readFileSync(file,'utf8')!==text)throw Error('Reference artifacts are stale.');console.log('DeFi offline reference compiler artifacts match.');}
else {fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);console.log('DeFi OFFLINE mock-token reference compiled; native tUSDT is not connected.');}
