// Use a checkout of exactly the reviewed engine revision. All state stays in memory.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),up=process.env.NODUS_EVM_ROOT;
if(!up)throw Error('Set NODUS_EVM_ROOT to nocdem/dna@2e881cc6e6d7a5050cc10400afc2b883f8fb712a.');
function run(cmd,args,options={}){const r=spawnSync(cmd,args,{encoding:'utf8',stdio:'inherit',...options});if(r.status!==0)throw Error(cmd+' failed');return r;}
const revision=spawnSync('git',['-C',up,'rev-parse','HEAD'],{encoding:'utf8'}).stdout?.trim();if(revision!=='2e881cc6e6d7a5050cc10400afc2b883f8fb712a')throw Error('Wrong engine revision.');
const engine=path.join(up,'shared/evm');run('make',['-C',engine,'-j4','test_addr32']);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-swap-vm-'));
try{const context={};vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(root,'dist/trade-contracts.js'),'utf8'),context);const a=context.NodusTradeContracts.contracts.nodus;fs.mkdirSync(path.join(dir,'actual'));
for(const [kind,hex]of [['creation',a.creation],['runtime',a.runtime]])fs.writeFileSync(path.join(dir,'actual',a.name+'.'+kind+'.hex'),hex.slice(2)+'\n');
const support=['evm_membackend','evm_mpt','evm_rlp','evm_test_qgp_shim','keccak256','qgp_sha3'].map(x=>path.join(engine,'build/t',x+'.o'));
run('cc',['-std=c11','-O2','-Wno-unused-function','-I'+engine,'-I'+path.join(engine,'tests'),'-I'+path.join(up,'shared'),path.join(root,'tests/trade/nodus-vm.c'),...support,path.join(engine,'build/libevm.a'),path.join(engine,'build/libevm_deps.a'),path.join(engine,'build/gmp/install/lib/libgmp.a'),'-lcrypto','-lstdc++','-lpthread','-o',path.join(dir,'swap-test')]);run(path.join(dir,'swap-test'),[dir]);
}finally{fs.rmSync(dir,{recursive:true,force:true});}
