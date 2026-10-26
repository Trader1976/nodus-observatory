/** Execute exported OSD6/lending bytecode offline in the pinned Nodus engine. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const upstream=process.env.NODUS_EVM_ROOT,revision='2e881cc6e6d7a5050cc10400afc2b883f8fb712a';
if(!upstream)throw Error('Set NODUS_EVM_ROOT to nocdem/dna@'+revision);
if(spawnSync('git',['-C',upstream,'rev-parse','HEAD'],{encoding:'utf8'}).stdout?.trim()!==revision)throw Error('Wrong pinned Nodus engine revision.');
function run(cmd,args,options={}){if(spawnSync(cmd,args,{stdio:'inherit',...options}).status!==0)throw Error(cmd+' failed.');}
const engine=path.join(upstream,'shared','evm');
run('make',['-C',engine,'-j4','test_addr32'],{env:{...process.env,TAR_OPTIONS:'--no-same-owner'}});
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-wallet-kit-vm-'));
try {
  const artifact=JSON.parse(fs.readFileSync(path.join(root,'artifacts','wallet-kit.json'),'utf8'));
  if(artifact.nativeTusdtCompatible!==false||artifact.mode!=='manual-testnet-sandbox')throw Error('Unexpected wallet kit scope.');
  fs.mkdirSync(path.join(dir,'actual'));
  for(const [name,data]of Object.entries(artifact.contracts))for(const key of ['creation','runtime'])fs.writeFileSync(path.join(dir,'actual',name+'.'+key+'.hex'),data[key].slice(2)+'\n');
  const support=['evm_membackend','evm_mpt','evm_rlp','evm_test_qgp_shim','keccak256','qgp_sha3'].map(name=>path.join(engine,'build/t',name+'.o'));
  const executable=path.join(dir,'wallet-kit');
  run('cc',['-std=c11','-O2','-Wno-unused-function','-I'+engine,'-I'+path.join(engine,'tests'),'-I'+path.join(upstream,'shared'),path.join(root,'tests','nodus-wallet-kit.c'),...support,path.join(engine,'build/libevm.a'),path.join(engine,'build/libevm_deps.a'),path.join(engine,'build/gmp/install/lib/libgmp.a'),'-lcrypto','-lstdc++','-lpthread','-o',executable]);
  run(executable,[dir]);
} finally {fs.rmSync(dir,{recursive:true,force:true});}
