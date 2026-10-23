/** Actual document-notary frontend handlers in an offline DOM harness.
 * No browser layout, wallet signing, or on-chain EVM execution is claimed.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {boot,flush} from './frontend-harness.mjs';
const dist=path.resolve(process.argv[2]||path.join(import.meta.dirname,'../dist'));
const plain=value=>JSON.parse(JSON.stringify(value));
const hash=value=>'0x'+createHash('sha256').update(value).digest('hex');
const contract='0x'+'34'.repeat(32),publisher='0x'+'ab'.repeat(32),otherPublisher='0x'+'cd'.repeat(32);
const chain='a48d1a785500a1cdecd739ecd53ef0e95b1dc4a7a300f49176a7fa25ae176114';
const expectedArtifact=JSON.parse(fs.readFileSync(path.join(dist,'document-registry.json'),'utf8'));
const docFile=(name,contents)=>{const bytes=Buffer.from(contents);return {name,size:bytes.length,
  arrayBuffer:async()=>Uint8Array.from(bytes).buffer};};
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const page=app=>app.document.querySelector('#page-content');
const state=app=>app.context.NodusDocumentNotary.getState();
const find=(app,selector)=>{const found=app.document.querySelector(selector);assert(found,`control exists: ${selector}`);return found;};
const click=async(app,selector)=>{await find(app,selector).click();await flush();};
const action=(app,name)=>click(app,`[data-document-action="${name}"]`);
const tab=(app,name)=>click(app,`[data-document-tab="${name}"]`);
async function input(app,name,value){const field=find(app,`#document-${name}`);field.value=value;await field.fire('input');await field.fire('change');await flush();}
async function chooseFile(app,file){const input=find(app,'#document-file');input.files=[file];await input.fire('change');await flush();}
async function reference(app,proof){const text=typeof proof==='string'?proof:JSON.stringify(proof);const input=find(app,'#document-reference');input.files=[{size:Buffer.byteLength(text),text:async()=>text}];await input.fire('change');await flush();}
const response=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>plain(body)});
function recordReply(digest,status='registered',overrides={}){
  const exists=status!=='not_found';
  return {available:true,status,contract,publisher,digest,
    record:{exists,block_number:exists?'90':null,timestamp:exists?'1792396800':null,revoked:status==='revoked'},
    chain:{chain_id:chain,height:'101',snapshot_height:'100',snapshot_generated_at:new Date().toISOString(),
      chain_id_source:'local_collector_snapshot',chain_id_verified:false},
    provenance:{source:'local_node',endpoint:'127.0.0.1:4001',independent_verification:false,
      contract_code_verified:false},
    checked_at:new Date().toISOString(),...overrides};
}
const untrustedErrorMessage='<img src=x onerror=alert(1)> /root/private-test-message';
let status='registered',replyTransform=value=>value,queryError=null,pendingQuery=null;
const fetchHandler=async(request,options)=>{
  if(!request.startsWith('/api/documents/record?'))return undefined;
  if(pendingQuery)return pendingQuery.promise;
  if(queryError)return response({available:false,status:'unavailable',error:{code:queryError,message:untrustedErrorMessage}},queryError==='chain_mismatch'?409:503);
  const params=new URLSearchParams(request.split('?')[1]);
  return response(replyTransform(recordReply(params.get('digest'),status)));
};
const app=await boot(dist,{route:'#contracts',fetchHandler});
assert(app.context.NodusDocumentNotary,'document notary module is loaded by the shipped shell');
assert.match(page(app).innerHTML,/SHA-256/);
assert.equal(state(app).result,null);
const catalog=find(app,'.document-catalog');
const catalogLink=catalog.querySelector('a');
assert.equal(catalogLink.getAttribute('href'),'#contracts');
assert.equal(catalogLink.getAttribute('aria-current'),'page');
app.run('render()');
assert.equal(catalogLink.getAttribute('aria-current'),'page',
  'periodic monitor rendering must preserve the document catalog current-page marker');
const notarySource=fs.readFileSync(path.join(dist,'document-notary.js'),'utf8');
const labels=new Set(['Record a document','Check a document','Set up a registry','Publisher','Registry',
  'Document digest','Chain ID','Record block','Record time · UTC','Node query height','Collector snapshot height','Checked at']);
for(const match of notarySource.matchAll(/\b(?:t|button)\(\s*((?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'))/g))labels.add(vm.runInNewContext(match[1]));
for(const label of labels)assert.notEqual(app.context.NodusDocumentText(label),label,`notary label has a Finnish translation: ${label}`);
app.context.NodusI18n.setLanguage('en');
await input(app,'contract',contract);await input(app,'publisher',publisher);

// Hash content locally. Filenames never act as evidence, and private file bytes
// must not appear in a request, saved preference, export or copied calldata.
const secret='Private document: alpha 123';
await chooseFile(app,docFile('same.pdf',secret));
assert.equal(state(app).digest,hash(secret));
assert.equal(state(app).fileName,'same.pdf');
assert.equal(state(app).hashing,false);
await action(app,'copy-digest');assert.equal(app.clipboard.at(-1),hash(secret));
await action(app,'copy-register');assert.equal(app.clipboard.at(-1),app.context.NodusDocumentCore.encodeRegister(hash(secret)));
await tab(app,'verify');
await action(app,'copy-revoke');assert.equal(app.clipboard.at(-1),app.context.NodusDocumentCore.encodeRevoke(hash(secret)));
await tab(app,'record');
await chooseFile(app,docFile('same.pdf',secret+'!'));
assert.equal(state(app).digest,hash(secret+'!'));
assert.notEqual(state(app).digest,hash(secret),'same name, different bytes is a different document');
const checkedDigest=state(app).digest;
await action(app,'export-reference');
const uncheckedReference=JSON.parse(await app.downloads.at(-1).text());
assert.equal(uncheckedReference.claim,null,'copy/export is not a confirmed registration');
assert.equal(uncheckedReference.networkGenesisPin,null);
assert.equal('fileName' in uncheckedReference,false,'reference contains no private filename');
await action(app,'check-record');
assert.equal(state(app).result?.status,'registered');
const request=app.requests.find(({request})=>request.startsWith('/api/documents/record?'));
const params=new URLSearchParams(request.request.split('?')[1]);
assert.deepEqual([...params.keys()].sort(),['contract','digest','publisher']);
assert.equal(params.get('contract'),contract);assert.equal(params.get('publisher'),publisher);assert.equal(params.get('digest'),checkedDigest);
assert.match(page(app).innerHTML,/90/);
assert.match(page(app).innerHTML,/not an independent on-chain inclusion proof/);
assert.match(page(app).innerHTML,/code has not been verified/,'unknown registry code is disclosed next to its record');

// Fresh chain outcomes remain distinct from a missing query or transport error.
status='revoked';await action(app,'check-record');assert.equal(state(app).result?.status,'revoked');
status='not_found';await action(app,'check-record');assert.equal(state(app).result?.status,'not_found');
for(const error of ['node_unavailable','stale_chain_context','invalid_node_response','chain_mismatch','invalid_query','busy']){
  queryError=error;await action(app,'check-record');
  assert.equal(state(app).result,null,`${error} cannot retain a successful or negative result`);
  assert.equal(state(app).error,`backend_${error}`,`${error} has a useful allowlisted error`);
  assert(!page(app).innerHTML.includes('private-test-message'),'raw node/backend error messages are not rendered');
  assert(!page(app).innerHTML.includes('<img src=x'));
}
queryError='unrecognized_private_error';await action(app,'check-record');
assert.equal(state(app).error,'query','unknown backend codes use a safe generic error');
assert(!page(app).innerHTML.includes('private-test-message'));
queryError=null;status='registered';

// A reply must refer to the exact request and honestly disclose its source. Changed
// inputs invalidate a result immediately, and late responses cannot restore it.
replyTransform=value=>({...value,publisher:otherPublisher});await action(app,'check-record');
assert.equal(state(app).result,null,'mismatched publisher is not evidence');
for(const corrupt of [
  value=>({...value,available:false}),
  value=>({...value,status:'unknown'}),
  value=>({...value,digest:hash('different')}),
  value=>({...value,record:{...value.record,exists:1}}),
  value=>({...value,record:{...value.record,revoked:true}}),
  value=>({...value,record:{...value.record,block_number:'102'}}),
  value=>({...value,chain:{...value.chain,chain_id:'x'.repeat(64)}}),
  value=>({...value,provenance:{...value.provenance,contract_code_verified:true}}),
  value=>({...value,checked_at:'not a timestamp'}),
  value=>({...value,checked_at:'2026-02-30T00:00:00Z'}),
  value=>({...value,chain:{...value.chain,height:'0'}}),
  value=>({...value,chain:{...value.chain,snapshot_height:'0'}}),
  value=>({...value,chain:{...value.chain,height:'99'}}),
  value=>({...value,chain:{...value.chain,height:(1n<<64n).toString(),snapshot_height:(1n<<64n).toString()}}),
  value=>({...value,record:{...value.record,block_number:'0'}}),
  value=>({...value,record:{...value.record,timestamp:'0'}}),
  value=>({...value,record:{...value.record,timestamp:(1n<<64n).toString()}}),
]){
  replyTransform=corrupt;await action(app,'check-record');
  assert.equal(state(app).result,null,'malformed or overclaimed replies are rejected');
  assert(state(app).error);
}
const u64max=((1n<<64n)-1n).toString();
replyTransform=value=>({...value,chain:{...value.chain,height:u64max,snapshot_height:u64max},
  record:{...value.record,block_number:u64max,timestamp:u64max}});
await action(app,'check-record');assert.equal(state(app).result?.status,'registered');
assert.equal(state(app).result.record.block_number,u64max,'uint64 boundary values remain exact strings');
assert.equal(state(app).result.record.timestamp,u64max);
assert.match(page(app).innerHTML,/Outside supported calendar range/);
replyTransform=value=>value;
await action(app,'check-record');assert.equal(state(app).result?.status,'registered');
await input(app,'publisher',otherPublisher);assert.equal(state(app).result,null);
await input(app,'publisher',publisher);
pendingQuery=deferred();
const oldQuery=action(app,'check-record');await flush();
await input(app,'publisher',otherPublisher);
pendingQuery.resolve(response(recordReply(checkedDigest)));await oldQuery;pendingQuery=null;
assert.equal(state(app).publisher,otherPublisher);assert.equal(state(app).result,null,'late response cannot verify changed inputs');
await input(app,'publisher',publisher);

// A slow earlier hash must not overwrite a later file choice.
const slow=deferred();let field=find(app,'#document-file');
field.files=[{name:'old.pdf',size:3,arrayBuffer:()=>slow.promise}];
const oldHash=field.fire('change');await flush();
await chooseFile(app,docFile('new.pdf','new'));
slow.resolve(Uint8Array.from(Buffer.from('old')).buffer);await oldHash;await flush();
assert.equal(state(app).fileName,'new.pdf');assert.equal(state(app).digest,hash('new'));
assert.equal(state(app).result,null);

// A rejected replacement file clears previous evidence rather than leaving a
// valid-looking digest from a different file. Oversize files are not read.
let oversizedRead=false;
await chooseFile(app,{name:'too-large.pdf',size:app.context.NodusDocumentCore.MAX_FILE_BYTES+1,
  arrayBuffer:async()=>{oversizedRead=true;return new ArrayBuffer(0);}});
assert.equal(oversizedRead,false);assert.equal(state(app).digest,null);
assert.equal(state(app).result,null);assert(state(app).error);
await chooseFile(app,docFile('new.pdf','new'));

// Imported references contain user claims. They set an expected digest and
// network, but never a "verified" result until a file and fresh chain read agree.
const proof=app.context.NodusDocumentCore.createProof({digest:hash('new'),registryAddress:contract,publisher,
  networkGenesisPin:chain,claim:{blockNumber:'1',timestamp:'0',revoked:false}});
await reference(app,proof);
assert.equal(state(app).referenceLoaded,true);assert.equal(state(app).result,null);
assert.equal(state(app).expectedDigest,hash('new'));assert.equal(state(app).expectedChain,chain);
await chooseFile(app,docFile('wrong.pdf','wrong'));
assert.equal(state(app).result,null);
const beforeMismatch=app.requests.length;await action(app,'check-record');
assert.equal(app.requests.length,beforeMismatch,'a file differing from the reference is rejected before querying');
await chooseFile(app,docFile('new.pdf','new'));await action(app,'check-record');
assert.equal(state(app).result?.status,'registered');
assert.equal(new URLSearchParams(app.requests.at(-1).request.split('?')[1]).get('chain'),chain);
await action(app,'export-reference');
const exported=JSON.parse(await app.downloads.at(-1).text());
assert.equal(exported.schema,'nodus-document-proof/v1');assert.equal(exported.digest,hash('new'));
assert.equal(exported.claim.blockNumber,'90','export records the fresh query rather than the imported claim');
assert.equal('verified' in exported,false);
const preserved=plain(state(app));
await reference(app,{...plain(proof),verified:true});
assert.equal(state(app).expectedDigest,preserved.expectedDigest,'untrusted proof extensions are rejected');
assert.equal(state(app).digest,preserved.digest);

// Language changes preserve the local file and verification state. The old
// escrow remains reachable as a separate example rather than being overwritten.
await tab(app,'verify');
const beforeLanguage=plain(state(app));
app.context.NodusI18n.setLanguage('fi');
assert.equal(state(app).tab,'verify');assert.equal(state(app).digest,beforeLanguage.digest);
assert.equal(state(app).publisher,publisher);
assert.match(page(app).innerHTML,/asiakirj/i);
app.context.NodusI18n.setLanguage('en');
await tab(app,'registry');
await action(app,'download-source');assert.equal(await app.downloads.at(-1).text(),app.context.NodusDocumentCore.SOURCE);
await action(app,'download-abi');assert.deepEqual(JSON.parse(await app.downloads.at(-1).text()),expectedArtifact.abi);
await action(app,'download-bytecode');assert.equal((await app.downloads.at(-1).text()).trim(),expectedArtifact.creationBytecode);
app.context.location.hash='#contracts-escrow';app.run('render()');
assert(app.document.querySelector('#contract-studio'),'escrow example is accessible on its own route');
app.context.location.hash='#contracts';app.run('render()');assert.equal(state(app).digest,hash('new'));

const reloaded=await boot(dist,{route:'#contracts',saved:Object.fromEntries(app.preferences)});
assert.equal(state(reloaded).contract,contract);assert.equal(state(reloaded).publisher,publisher);
assert.equal(state(reloaded).digest,null,'local document bytes/digest are not silently restored from settings');
assert.equal(state(reloaded).result,null,'a past chain result is never restored as current verification');
assert.equal(state(reloaded).referenceLoaded,false);

// A corrupted compiler artifact cannot silently become downloadable ABI or
// executable bytecode, even though the bundled Solidity source is still local.
const corruptArtifact=plain(expectedArtifact);
corruptArtifact.creationBytecode=corruptArtifact.creationBytecode.slice(0,-2)+'ff';
const corrupt=await boot(dist,{route:'#contracts',fetchHandler:async request=>
  request==='/document-registry.json'?response(corruptArtifact):undefined});
await tab(corrupt,'registry');await action(corrupt,'download-bytecode');
assert.equal(corrupt.downloads.length,0);assert.equal(state(corrupt).error,'artifact');

// Failure modes remain honest without monitoring, browser storage or Web Crypto.
const offline=await boot(dist,{route:'#contracts',offline:true,storageThrows:true});
assert(offline.document.querySelector('#document-file'));
assert.equal(offline.run('state.dashboard'),null);
await chooseFile(offline,docFile('local.txt','offline document'));
assert.equal(state(offline).digest,hash('offline document'),'hashing is independent of monitoring and network');
const noCrypto=await boot(dist,{route:'#contracts',crypto:{}});
await chooseFile(noCrypto,docFile('local.txt','abc'));
assert.equal(state(noCrypto).digest,null);assert(state(noCrypto).error);

for(const target of [app,reloaded,corrupt,offline,noCrypto]){
  assert(target.requests.every(({options})=>!options?.method||options.method==='GET'),'there are no transaction or upload requests');
  assert(target.requests.every(({request})=>!String(request).includes(secret)), 'private document contents stay in the browser');
  assert([...target.preferences.values()].every(value=>!value.includes(secret)), 'file contents are never persisted');
  assert(target.requests.every(({request})=>request.startsWith('/api/')||/\.json$/.test(request)), 'no wallet, external RPC or signing endpoint is contacted');
}
console.log('Document notary integration: local hashing, exact ABI/actions, chain outcomes, invalidation/races, untrusted references, FIN/ENG and artifact exports PASS.');
