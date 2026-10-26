/** Offline memory-only execution in the pinned real Nodus32-byte engine.
 * This proves reference-contract behavior with a MOCK ERC20, never native tUSDT.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const upstream=process.env.NODUS_EVM_ROOT,revision='2e881cc6e6d7a5050cc10400afc2b883f8fb712a';
if(!upstream)throw Error('Set NODUS_EVM_ROOT to nocdem/dna@'+revision);
const head=spawnSync('git',['-C',upstream,'rev-parse','HEAD'],{encoding:'utf8'}).stdout?.trim();
if(head!==revision)throw Error('Wrong pinned Nodus engine revision.');
function run(cmd,args,options={}){const r=spawnSync(cmd,args,{stdio:'inherit',...options});if(r.status!==0)throw Error(cmd+' failed.');}
const engine=path.join(upstream,'shared','evm');
// A rootless container cannot chown upstream tarball ownership during GMP build.
run('make',['-C',engine,'-j4','test_addr32'],{env:{...process.env,TAR_OPTIONS:'--no-same-owner'}});
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-defi-reference-'));
try{
    const artifact=JSON.parse(fs.readFileSync(path.join(root,'artifacts','reference.json'),'utf8'));
    if(artifact.nativeTusdtCompatible!==false||artifact.mode!=='offline-mock-token-only')throw Error('Unexpected artifact scope.');
    fs.mkdirSync(path.join(dir,'actual'));
    for(const [name,a] of Object.entries(artifact.contracts))for(const key of ['creation','runtime'])
        fs.writeFileSync(path.join(dir,'actual',name+'.'+key+'.hex'),a[key].slice(2)+'\n');
    const support=['evm_membackend','evm_mpt','evm_rlp','evm_test_qgp_shim','keccak256','qgp_sha3'].map(x=>path.join(engine,'build','t',x+'.o'));
    const executable=path.join(dir,'defi-reference');
    run('cc',['-std=c11','-O2','-Wno-unused-function','-I'+engine,'-I'+path.join(engine,'tests'),'-I'+path.join(upstream,'shared'),path.join(root,'tests','nodus-reference.c'),...support,path.join(engine,'build','libevm.a'),path.join(engine,'build','libevm_deps.a'),path.join(engine,'build','gmp','install','lib','libgmp.a'),'-lcrypto','-lstdc++','-lpthread','-o',executable]);
    run(executable,[dir]);
}finally{fs.rmSync(dir,{recursive:true,force:true});}
