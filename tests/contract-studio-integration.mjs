/** Contract Studio integration without a browser engine.
 * Exercises the shipped shell/scripts and actual registered DOM handlers.
 * These checks do not claim visual layout or Nodus EVM execution coverage.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const dist = path.resolve(process.argv[2] || path.join(import.meta.dirname, '../dist'));
const shell = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const scripts = [...shell.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(match => match[1]);
const fixtures = {'/api/dashboard':'snapshot.json','/api/history':'history.json',
  '/api/network':'network.json','/api/rewards':'rewards.json','/api/events':'events.json'};
const decode = value => value.replace(/&quot;/g,'"').replace(/&#39;/g,"'")
  .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');

// A small tree implements only the browser APIs used by this application. It
// deliberately retains disabled controls and user-supplied text as real values.
function node(tag = 'div', attributes = {}, parent = null) {
  const attrs = {...attributes};
  const listeners = new Map();
  let markup = '';
  let classes = new Set((attrs.class || '').split(/\s+/).filter(Boolean));
  const el = {
    tagName:tag.toUpperCase(), parentElement:parent, children:[], style:{}, dataset:{},
    value:attrs.value || '', name:attrs.name || '', checked:Object.hasOwn(attrs,'checked'),
    disabled:Object.hasOwn(attrs,'disabled'), hidden:Object.hasOwn(attrs,'hidden'),
    textContent:'', scrollLeft:0,
    setAttribute(key,value) {attrs[key]=String(value); if(key==='disabled')this.disabled=true;},
    getAttribute(key) {return attrs[key]??null;},
    removeAttribute(key) {delete attrs[key];if(key==='disabled')this.disabled=false;},
    classList:{add(name){classes.add(name);},remove(name){classes.delete(name);},contains(name){return classes.has(name);},
      toggle(name,force){const yes=force===undefined?!classes.has(name):force;if(yes)classes.add(name);else classes.delete(name);return yes;}},
    addEventListener(type,handler){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(handler);},
    removeEventListener(type,handler){listeners.set(type,(listeners.get(type)||[]).filter(item=>item!==handler));},
    dispatchEvent(event){for(const handler of listeners.get(event.type)||[])handler.call(this,event);return true;},
    async fire(type,extra={}) {
      const event={type,target:this,currentTarget:this,key:'',clientX:0,clientY:0,
        preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...extra};
      if(this.disabled&&type==='click')return event;
      for(const handler of listeners.get(type)||[])await handler.call(this,event);
      await this[`on${type}`]?.(event);
      return event;
    },
    click(){return this.fire('click');},focus(){this.focused=true;},
    appendChild(child){child.parentElement=this;this.children.push(child);return child;},
    remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);},
    querySelectorAll(selector){return descendants(this).filter(child=>matches(child,selector));},
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;},
    closest(selector){let cursor=this;while(cursor){if(matches(cursor,selector))return cursor;cursor=cursor.parentElement;}return null;},
    contains(other){return this===other||descendants(this).includes(other);},
    getBoundingClientRect(){return {left:0,top:0,right:1000,bottom:600,width:1000,height:600};},
    setPointerCapture(){},releasePointerCapture(){},scrollIntoView(){},showModal(){this.open=true;},close(){this.open=false;},
  };
  for(const [key,value]of Object.entries(attrs))if(key.startsWith('data-'))el.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value;
  Object.defineProperty(el,'innerHTML',{get(){return markup;},set(value){markup=String(value);this.children=parse(markup,this);}});
  return el;
}
function descendants(root){return root.children.flatMap(child=>[child,...descendants(child)]);}
function matches(el, selector){
  if(selector.includes(','))return selector.split(',').some(part=>matches(el,part.trim()));
  if(selector==='nav a')return el.tagName==='A'&&!!el.dataset.page;
  if(selector.startsWith('#'))return el.getAttribute('id')===selector.slice(1);
  if(selector.startsWith('.'))return el.classList.contains(selector.slice(1));
  const attr=selector.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);
  if(attr)return attr[2]===undefined?el.getAttribute(attr[1])!==null:el.getAttribute(attr[1])===attr[2];
  return el.tagName===selector.toUpperCase();
}
function parse(html,parent){
  const children=[];const stack=[{children,tagName:'ROOT',el:parent}];
  const tokens=/<\/?([a-z][\w-]*)\b([^>]*)>|([^<]+)/gi;let token;
  const voidTags=new Set(['INPUT','BR','HR','IMG','META','LINK','SOURCE','AREA','BASE','EMBED','WBR']);
  while((token=tokens.exec(html))){
    if(token[3]){stack.at(-1).el.textContent+=decode(token[3]);continue;}
    const tag=token[1].toUpperCase();
    if(token[0][1]==='/'){const index=stack.findLastIndex(item=>item.tagName===tag);if(index>0)stack.splice(index);continue;}
    const attributes={};
    for(const attribute of token[2].matchAll(/([\w-]+)(?:="([^"]*)"|'([^']*)')?/g))attributes[attribute[1]]=decode(attribute[2]??attribute[3]??'');
    const current=stack.at(-1);const el=node(tag,attributes,current.el);current.children.push(el);
    if(!voidTags.has(tag)&&!token[0].endsWith('/>'))stack.push({children:el.children,tagName:tag,el});
  }
  return children;
}
const flush = async()=>{await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));};
async function boot({offline=false,storageThrows=false,saved={}}={}){
  const root=node('document');root.children=parse(shell,root);
  const document={body:root.querySelector('body'),documentElement:root.querySelector('html'),title:'',
    querySelector:root.querySelector.bind(root),querySelectorAll:root.querySelectorAll.bind(root),
    addEventListener(){},createElement:tag=>node(tag),createElementNS:(_,tag)=>node(tag)};
  const preferences=new Map(Object.entries(saved));const downloads=[];const requests=[];
  const events=new EventTarget();
  const context={document,location:{hash:'#contracts'},Event,CustomEvent,AbortController,Date,Intl,Number,BigInt,JSON,console,Blob,
    navigator:{clipboard:{writeText:async()=>{}}},
    localStorage:{getItem(key){if(storageThrows)throw Error('Storage blocked');return preferences.get(key)??null;},
      setItem(key,value){if(storageThrows)throw Error('Storage blocked');preferences.set(key,String(value));},
      removeItem(key){if(storageThrows)throw Error('Storage blocked');preferences.delete(key);}},
    addEventListener:events.addEventListener.bind(events),dispatchEvent:events.dispatchEvent.bind(events),scrollTo(){},
    setTimeout(){return 1;},clearTimeout(){},requestAnimationFrame(callback){callback();return 1;},cancelAnimationFrame(){},
    URL:{createObjectURL(blob){downloads.push(blob);return 'blob:test';},revokeObjectURL(){}},
    fetch:async(request,options)=>{requests.push({request,options});if(offline)throw Error('Network unavailable');return {ok:true,
      json:async()=>JSON.parse(fs.readFileSync(path.join(dist,fixtures[request.split('?')[0]]||request),'utf8'))};},
  };
  context.window=context;vm.createContext(context);
  for(const script of scripts)vm.runInContext(fs.readFileSync(path.join(dist,script),'utf8'),context,{filename:script});
  await flush();
  return {context,document,preferences,downloads,requests,root,run:source=>vm.runInContext(source,context)};
}

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
assert.equal(offline.document.title,'Contract Studio — Nodus Observatory');
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
offline.context.location.hash='#contracts';offline.run('render()');
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
  assert(target.requests.every(({request})=>request.startsWith('/api/')||Object.values(fixtures).includes(request)),
    'studio never initiates compiler, wallet, RPC or external requests');
}
console.log('Contract Studio integration: offline route, FIN/ENG, persistence, exact exports, graph/drag/keyboard handlers, simulation and hostile input PASS.');
