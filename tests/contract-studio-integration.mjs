/** Contract Studio integration without a browser engine.
 * Exercises the shipped shell/scripts and actual registered DOM handlers.
 * These checks do not claim visual layout or Nodus EVM execution coverage.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const dist = path.resolve(process.argv[2] || path.join(import.meta.dirname, '../dist'));
import {boot as bootFrontend,flush} from './frontend-harness.mjs';
const boot=options=>bootFrontend(dist,options);

const page = app => app.document.querySelector('#page-content');
const getDraft = app => app.context.NodusContractStudio.getDraft();
const getState = app => app.context.NodusContractStudio.getState();
const select = (app,selector) => {
  const result=app.document.querySelector(selector);
  assert(result, `control exists: ${selector}`);
  return result;
};
const click = async(app,selector) => {await select(app,selector).click();await flush();};
const action = (app,value) => click(app,`[data-studio-action="${value}"]`);
async function input(app,key,value){
  const field=select(app,`#studio-${key}`);field.value=value;
  await field.fire('input');await field.fire('change');await flush();
}
const buyer=`0x${'12'.repeat(32)}`, seller=`0x${'ab'.repeat(32)}`;
const deadline='2030-01-01T00:00:00Z';
async function importDraft(app,project){
  const text=typeof project==='string'?project:JSON.stringify(project);
  const file=select(app,'#studio-import');file.files=[{size:Buffer.byteLength(text),text:async()=>text}];
  await file.fire('change');await flush();
  if(app.document.querySelector('[data-studio-action="replace-draft"]'))await action(app,'replace-draft');
}

// Authoring must remain available when no monitoring API or preview fixture can
// be fetched, and must also survive blocked browser storage.
const offline=await boot({offline:true,storageThrows:true});
assert.equal(offline.run('state.dashboard'),null);
assert.match(page(offline).innerHTML,/SOPIMUSSTUDIO \/ KOKEELLINEN/);
assert.match(page(offline).innerHTML,/selaimen tallennustila ei ole käytettävissä/);
assert(!page(offline).innerHTML.includes('Seurantatietoja ei voitu ladata.'));
assert.equal(getDraft(offline).config.buyer,'');
assert.equal(getDraft(offline).config.seller,'');
offline.context.NodusI18n.setLanguage('en');
assert.match(page(offline).innerHTML,/CONTRACT STUDIO \/ EXPERIMENTAL/);
assert.equal(offline.document.title,'Escrow example — Nodus Observatory');
const unedited=JSON.stringify(getDraft(offline));
await click(offline,'[data-studio-tab="simulation"]');
assert(select(offline,'[data-studio-action="start-simulation"]').disabled);
await action(offline,'simulate-examples');
assert.equal(getState(offline).simulation.stage,'created');
assert.equal(getState(offline).simulationUsesExamples,true);
assert.equal(JSON.stringify(getDraft(offline)),unedited,'example identities never fill the real agreement');
assert.match(page(offline).innerHTML,/actual agreement is unchanged/);
await click(offline,'[data-studio-tab="source"]');
assert(select(offline,'[data-studio-action="download-source"]').disabled);
const initialDownloads=offline.downloads.length;
await select(offline,'[data-studio-action="download-source"]').onclick();
assert.equal(offline.downloads.length,initialDownloads,'even a direct handler call cannot bypass invalid-source validation');
await action(offline,'export-project');
assert.equal(JSON.parse(await offline.downloads.at(-1).text()).config.buyer,'');
await offline.run('loadData(true)');
assert.match(page(offline).innerHTML,/CONTRACT STUDIO \/ EXPERIMENTAL/,'later monitoring refresh failures leave the studio open');
offline.context.location.hash='#overview';offline.run('render()');
assert.match(page(offline).innerHTML,/Monitoring data could not be loaded/,'monitoring failures are still honest on monitoring routes');
offline.context.location.hash='#contracts-escrow';offline.run('render()');
assert.equal(getState(offline).activeTab,'source','navigation retains local editor state');

// Use only public synthetic addresses and exercise actual input/tab/export
// handlers. Exact amounts must reach the source, manifest and saved project.
const app=await boot();
const studioSource=fs.readFileSync(path.join(dist,'contract-studio.js'),'utf8');
const studioLabels=new Set(['Created','Funded','Approved','Paid','Refunded','Cancelled',
  'Await the buyer’s deposit.','Hold exactly the agreed amount.','The buyer authorises payment.',
  'The seller withdraws payment.','The buyer recovers funds after the deadline.','The buyer closes an unfunded escrow.',
  'Deposit','Approve delivery','Withdraw','Refund','Cancel escrow','Time']);
for(const match of studioSource.matchAll(/\b(?:s|button)\(\s*((?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'))/g)){
  studioLabels.add(vm.runInNewContext(match[1]));
}
for(const label of studioLabels){
  assert.notEqual(app.context.NodusStudioText(label),label,`studio label has a Finnish translation: ${label}`);
}
app.context.NodusI18n.setLanguage('en');
await input(app,'buyer',buyer);await input(app,'seller',seller);
await input(app,'amountNodus','123456789012.34567890');await input(app,'deadline',deadline);
assert.equal(app.context.NodusStudioCore.validate(getDraft(app)).valid,true);
await click(app,'[data-studio-tab="source"]');
assert.equal(select(app,'[data-studio-action="download-source"]').disabled,false);
await action(app,'download-source');
const source=await app.downloads.at(-1).text();
assert.match(source,/pragma solidity =0\.8\.30;/);
assert.match(source,/amountWei = 123456789012345678900000000000;/);
assert.match(source,new RegExp(`uint256\\(${buyer}\\)`));
await action(app,'download-manifest');
const manifest=JSON.parse(await app.downloads.at(-1).text());
assert.equal(manifest.config.amountNodus,'123456789012.34567890');
assert.equal(manifest.artifacts.abi,false);assert.equal(manifest.artifacts.bytecode,false);
assert.equal(manifest.deployment.performed,false,'export never implies deployment');
assert.equal(manifest.compiler.addressBytes,32);
const restored=await boot({saved:Object.fromEntries(app.preferences)});
assert.equal(JSON.stringify(getDraft(restored)),JSON.stringify(getDraft(app)),'saved model is restored exactly');
const unreadable=await boot({saved:{'nodus-observatory-contract-draft-v1':'not valid JSON'}});
assert.equal(getState(unreadable).storageStatus,'unreadable');
assert.equal(unreadable.preferences.get('nodus-observatory-contract-draft-v1'),'not valid JSON',
  'a corrupt stored record is retained until the user edits or replaces it');
assert.match(page(unreadable).innerHTML,/Tallennettua luonnosta ei voitu lukea/);
assert.equal(getDraft(unreadable).config.buyer,'');

// A missing or unsupported connection blocks executable output. Reconnect using
// the click ports: drag operations are never the only editing path.
const goodSource=source;
await click(app,'[data-studio-remove-edge="4"]');
assert.equal(app.context.NodusStudioCore.validate(getDraft(app)).valid,false);
assert(select(app,'[data-studio-action="download-source"]').disabled);
await click(app,'[data-studio-output="approved"]');await click(app,'[data-studio-input="paid"]');
assert.equal(app.context.NodusStudioCore.generate(getDraft(app)),goodSource);
await click(app,'[data-studio-output="funded"]');await click(app,'[data-studio-input="paid"]');
assert.equal(app.context.NodusStudioCore.validate(getDraft(app)).valid,false,'unsupported bypass is not merely a cosmetic line');
assert(select(app,'[data-studio-action="download-source"]').disabled);
await click(app,'[data-studio-remove-edge="5"]');
assert.equal(app.context.NodusStudioCore.validate(getDraft(app)).valid,true);

// Palette controls explain and select a state already present. They must not
// silently no-op or insert duplicate states into the executable graph.
const beforeShow=JSON.stringify(getDraft(app));
const show=select(app,'[data-studio-add="created"]');
assert.match(show.textContent,/Show block/);
await show.click();await flush();
assert.equal(getState(app).selected,'created');
assert.equal(JSON.stringify(getDraft(app)),beforeShow,'Show selects without mutating contract semantics or layout');
assert.match(select(app,'#studio-message').textContent,/Created/);

// Pointer movement and keyboard alternatives modify layout, not contract
// semantics. Deletion removes incident edges; palette Add and drop both work.
let handle=select(app,'[data-studio-handle="created"]');
const beforeMove=getDraft(app).nodes.find(node=>node.id==='created');
await handle.fire('pointerdown',{button:0,pointerId:7,clientX:10,clientY:10});
await handle.fire('pointermove',{pointerId:7,clientX:55,clientY:40});
await handle.fire('pointerup',{pointerId:7});
let afterMove=getDraft(app).nodes.find(node=>node.id==='created');
assert.equal(afterMove.x,beforeMove.x+45);assert.equal(afterMove.y,beforeMove.y+30);
handle=select(app,'[data-studio-handle="created"]');
await handle.fire('keydown',{key:'ArrowRight',shiftKey:true});
afterMove=getDraft(app).nodes.find(node=>node.id==='created');
assert.equal(afterMove.x,beforeMove.x+85);
assert.equal(app.context.NodusStudioCore.generate(getDraft(app)),goodSource);
let zoom=select(app,'#studio-zoom');zoom.value='0.5';await zoom.fire('change');
assert.equal(getState(app).zoomScale,0.5);
const scaledStart=getDraft(app).nodes.find(node=>node.id==='created');
handle=select(app,'[data-studio-handle="created"]');
await handle.fire('pointerdown',{button:0,pointerId:8,clientX:10,clientY:10});
await handle.fire('pointermove',{pointerId:8,clientX:30,clientY:25});
await handle.fire('pointerup',{pointerId:8});
const scaledEnd=getDraft(app).nodes.find(node=>node.id==='created');
assert.equal(scaledEnd.x,scaledStart.x+40,'50% zoom converts screen drag into logical coordinates');
assert.equal(scaledEnd.y,scaledStart.y+30);
assert.equal(app.context.NodusStudioCore.generate(getDraft(app)),goodSource);
await select(app,'[data-studio-handle="paid"]').fire('keydown',{key:'Delete'});
assert(!getDraft(app).nodes.some(node=>node.type==='paid'));
assert(!getDraft(app).edges.some(edge=>edge.from==='paid'||edge.to==='paid'));
assert.match(select(app,'[data-studio-add="paid"]').textContent,/Add/);
await click(app,'[data-studio-add="paid"]');
assert(getDraft(app).nodes.some(node=>node.type==='paid'),'Add button is a keyboard/touch fallback');
const added=getDraft(app).nodes.find(node=>node.type==='paid');
await select(app,`[data-studio-handle="${added.id}"]`).fire('keydown',{key:'Delete'});
const data=new Map();const transfer={types:['application/x-nodus-state'],setData:(key,value)=>data.set(key,value),getData:key=>data.get(key)||''};
await select(app,'[data-studio-palette="paid"]').fire('dragstart',{dataTransfer:transfer});
await select(app,'#studio-canvas').fire('drop',{dataTransfer:transfer,clientX:300,clientY:200});
const dropped=getDraft(app).nodes.find(node=>node.type==='paid');
assert(dropped,'palette drag/drop adds the missing state');
assert.equal(dropped.x,515,'drop at 50% zoom uses logical canvas coordinates');
assert.equal(dropped.y,365);
zoom=select(app,'#studio-zoom');zoom.value='1';await zoom.fire('change');
assert.equal(getState(app).zoomScale,1);
await select(app,'[data-studio-handle="created"]').click();await action(app,'restore-flow');
assert.equal(app.context.NodusStudioCore.validate(getDraft(app)).valid,true);

// Simulation reflects the configured agreement, enforces roles and resets after
// a semantic edit. No action contacts a wallet, node, external site or backend.
await click(app,'[data-studio-tab="simulation"]');await action(app,'start-simulation');
let role=select(app,'#studio-actor');role.value='outsider';await role.fire('change');
await action(app,'sim-deposit');
assert.equal(getState(app).simulation.stage,'created');
assert.equal(getState(app).trace.at(-1).code,'unauthorized');
role=select(app,'#studio-actor');role.value='buyer';await role.fire('change');
await action(app,'sim-deposit');await action(app,'sim-approve');
role=select(app,'#studio-actor');role.value='seller';await role.fire('change');
let fail=select(app,'#studio-fail-transfer');fail.checked=true;await fail.fire('change');
const beforeFailedTransfer=JSON.stringify(getState(app).simulation);
await action(app,'sim-withdraw');
assert.equal(JSON.stringify(getState(app).simulation),beforeFailedTransfer,'failed recipient transfer rolls back');
fail=select(app,'#studio-fail-transfer');fail.checked=false;await fail.fire('change');
await action(app,'sim-withdraw');
assert.equal(getState(app).simulation.stage,'paid');
assert.equal(getState(app).simulation.payouts.sellerWei,'123456789012345678900000000000');
await action(app,'sim-withdraw');assert.equal(getState(app).trace.at(-1).code,'invalid_state');
const simulationBeforeLanguageSwitch=JSON.stringify(getState(app).simulation);
app.context.NodusI18n.setLanguage('fi');
assert.equal(JSON.stringify(getState(app).simulation),simulationBeforeLanguageSwitch);
assert.match(page(app).innerHTML,/PAIKALLINEN SIMULAATIO/);
await input(app,'amountNodus','0.00000001');
assert.equal(getState(app).simulation,null,'editing the agreement invalidates the previous simulation');

// Treat project files and form fields as untrusted. Rejected imports leave the
// current model intact; values never become HTML or injected Solidity snippets.
const beforeMalicious=JSON.stringify(getDraft(app));
const malicious=JSON.parse(beforeMalicious);malicious.nodes[0].id='"><img src=x onerror=alert(1)>';
await importDraft(app,malicious);
assert.equal(JSON.stringify(getDraft(app)),beforeMalicious);
assert(!page(app).innerHTML.includes('<img src=x'));
await importDraft(app,'{"__proto__":{"polluted":true},"schema":"evil"}');
assert.equal(JSON.stringify(getDraft(app)),beforeMalicious);
assert.equal({}.polluted,undefined);
await input(app,'buyer','"><img src=x onerror=alert(1)>');
app.context.NodusI18n.setLanguage('en');
assert(!page(app).innerHTML.includes('<img src=x'));
assert(page(app).innerHTML.includes('&lt;img'));
await click(app,'[data-studio-tab="source"]');
assert(select(app,'[data-studio-action="download-source"]').disabled);
await input(app,'buyer',buyer);

// Imported IDs need not match type names. Adding missing blocks must never
// collide with a valid existing ID, even when the name resembles generated IDs.
const partial=app.context.NodusStudioCore.defaultDraft();
partial.nodes=[{id:'created-1',type:'funded',x:100,y:100}];partial.edges=[];
await importDraft(app,partial);await click(app,'[data-studio-add="created"]');
const ids=getDraft(app).nodes.map(node=>node.id);
assert.equal(new Set(ids).size,ids.length,'generated IDs remain unique after imports');

// An editor shortcut must never replace a different active page after leaving
// a partially connected graph in memory.
await click(app,`[data-studio-output="${ids[0]}"]`);
app.context.location.hash='#overview';app.run('render()');
const overviewMarkup=page(app).innerHTML;
const escapeEvent=new Event('keydown');Object.defineProperty(escapeEvent,'key',{value:'Escape'});
app.context.dispatchEvent(escapeEvent);
assert.equal(page(app).innerHTML,overviewMarkup,'Escape outside the studio cannot overwrite the active route');

for(const target of [offline,app]){
  assert(target.requests.every(({options})=>!options?.method||options.method==='GET'),'all network operations remain read-only monitoring queries');
  assert(target.requests.every(({request})=>request.startsWith('/api/')||['snapshot.json','history.json','network.json','rewards.json','events.json'].includes(request)),
    'studio never initiates compiler, wallet, RPC or external requests');
}
console.log('Contract Studio integration: offline route, FIN/ENG, persistence, exact exports, graph/drag/keyboard handlers, simulation and hostile input PASS.');
