/* Settings exercise actual shipped forms and HTTP contracts, without a live node. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {boot,flush} from './frontend-harness.mjs';

const dist=path.resolve(process.argv[2]||path.join(import.meta.dirname,'../dist'));
const original={node_name:'Test node',roles:{storage:true,witness:true},default_view:'overview',history_days:30,network_interface:null,disk_device:'sda',network_enabled:true,rewards_enabled:true,rewards_scan_enabled:true,cli_path:'/usr/local/bin/nodus-cli',data_path:'/var/lib/nodus/data',mount_path:'/var/lib/nodus',rewards_source_db:'/var/lib/nodus/data/witness_test.db'};
const fields=['node_name','roles','default_view','history_days','network_interface','disk_device','network_enabled','rewards_enabled','rewards_scan_enabled'];
const clone=value=>JSON.parse(JSON.stringify(value));
const reply=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>clone(data)});
function fixture({settingsError='',failMonitoring=false}={}){
  let saved=clone(original),revision='revision-1',conflict=false,failSave=false;
  const requests=[];
  const document=()=>({settings:clone(saved),editable_fields:fields,revision,csrf_token:'test-csrf',...(settingsError?{settings_error:settingsError}:{})});
  const fetchHandler=async(request,options)=>{
    if(request==='/api/dashboard'){
      if(failMonitoring)return reply({error:'No measurements'},503);
      const snapshot=JSON.parse(fs.readFileSync(path.join(dist,'snapshot.json'),'utf8'));snapshot.preview=false;snapshot.roles=clone(saved.roles);return reply(snapshot);
    }
    if(failMonitoring&&request==='snapshot.json')return reply({},404);
    if(request==='/api/settings'&&options?.method!=='POST')return reply(document());
    if(request==='/api/settings'||request==='/api/settings/check'){
      const body=JSON.parse(options.body);requests.push({request,options,body});
      assert.equal(options.headers['X-CSRF-Token'],'test-csrf');assert.equal(options.headers['Content-Type'],'application/json');
      assert.deepEqual(Object.keys(body.settings).sort(),fields.slice().sort(),'only explicitly editable fields are sent');
      if(conflict)return reply({error:'Settings changed'},409);
      if(failSave)throw Error('connection lost');
      if(request.endsWith('/check'))return reply({valid:true,settings:{...saved,...body.settings},checks:[{name:'settings',status:'ok',message:'Settings are valid. Checking does not change files or services.'},{name:'witness',status:'warning',message:'Latest observed service state: failed.'}]});
      assert.equal(body.revision,revision);saved={...saved,...body.settings};revision='revision-2';return reply({...document(),saved:true,applies:'next_collection'});
    }
  };
  return {fetchHandler,requests,get saved(){return saved;},set conflict(value){conflict=value;},set failSave(value){failSave=value;}};
}
const control=(app,id)=>{const el=app.document.querySelector(id);assert(el,`control ${id}`);return el;};
async function input(app,id,value){const el=control(app,id);el.value=value;await el.fire('input');}
async function checked(app,id,value){const el=control(app,id);el.checked=value;await el.fire('change');}
async function save(app){await control(app,'#settings-form').fire('submit');await flush();}
async function navigate(app,hash){app.context.location.hash=hash;app.context.dispatchEvent(new app.context.Event('hashchange'));await flush();}

const data=fixture();const app=await boot(dist,{route:'#settings',fetchHandler:data.fetchHandler});await flush();
assert.equal(control(app,'#setting-node_name').value,'Test node');
assert.equal(control(app,'#setting-cli_path').disabled,true,'trusted executable is displayed read-only');
assert.equal(control(app,'#settings-save').disabled,true,'unchanged settings do not save');
await input(app,'#setting-node_name','A <script> node');await input(app,'#setting-history_days','45');
assert.equal(app.context.NodusObservatorySettings.isDirty(),true);
assert.equal(control(app,'#settings-save').disabled,false);
app.context.NodusI18n.setLanguage('en');
assert.equal(control(app,'#setting-node_name').value,'A <script> node','language switch retains typed draft');
assert.match(control(app,'#page-content').innerHTML,/Monitoring that fits your node/);
await navigate(app,'#contracts-editor');await navigate(app,'#settings');
assert.equal(control(app,'#setting-node_name').value,'A <script> node','Studio navigation retains Settings draft');
await control(app,'#settings-check').click();await flush();
assert.equal(data.requests.length,1);assert.equal(data.requests[0].request,'/api/settings/check');
assert.equal(data.saved.node_name,'Test node','checking does not save');
assert.match(control(app,'#page-content').innerHTML,/Latest observed service state: Error/);
assert.equal(app.context.NodusObservatorySettings.isDirty(),true,'checking retains unsaved draft');
await save(app);
assert.equal(data.saved.node_name,'A <script> node');assert.equal(data.saved.history_days,45);
assert.equal(app.context.NodusObservatorySettings.isDirty(),false);assert.equal(control(app,'#settings-save').disabled,true);
assert.equal(data.requests[1].body.revision,'revision-1');
assert(!Object.hasOwn(data.requests[1].body.settings,'cli_path'),'browser never submits executable path');
assert.equal(control(app,'#setting-node_name').value,'A <script> node','hostile display label remains text');

await checked(app,'#setting-roles-storage',false);await checked(app,'#setting-roles-witness',false);
await save(app);
assert.equal(data.requests.length,2,'invalid role selection never reaches the API');
assert.equal(control(app,'#setting-roles-error').textContent,'Select at least one role to monitor.');
assert.equal(control(app,'#setting-roles-error').parentElement.getAttribute('aria-invalid'),'true');
await checked(app,'#setting-roles-witness',true);
await input(app,'#setting-history_days','367');await save(app);
assert.equal(control(app,'#setting-history_days').getAttribute('aria-invalid'),'true');
assert.match(control(app,'#setting-history_days-error').textContent,/1 and 366/);
await input(app,'#setting-history_days','30');await input(app,'#setting-network_interface','../../etc');await save(app);
assert.match(control(app,'#setting-network_interface-error').textContent,/without a path/);
await input(app,'#setting-network_interface','');await checked(app,'#setting-roles-storage',true);

data.conflict=true;await input(app,'#setting-node_name','Conflicting draft');await save(app);
assert.equal(control(app,'#setting-node_name').value,'Conflicting draft');
assert.equal(control(app,'#settings-save').disabled,true,'concurrent revisions must reload before save');
assert.match(control(app,'#page-content').innerHTML,/another window/);
data.conflict=false;await control(app,'#settings-discard').click();await flush();
assert.equal(control(app,'#setting-node_name').value,'A <script> node');assert.equal(app.context.NodusObservatorySettings.isDirty(),false);

data.failSave=true;await input(app,'#setting-node_name','Request failed draft');await save(app);
assert.equal(control(app,'#setting-node_name').value,'Request failed draft');assert.equal(app.context.NodusObservatorySettings.isDirty(),true);
assert.match(control(app,'#page-content').innerHTML,/request failed/i);

const offlineData=fixture({failMonitoring:true});const noMeasurements=await boot(dist,{route:'#settings',fetchHandler:offlineData.fetchHandler});await flush();
assert.equal(control(noMeasurements,'#setting-node_name').value,'Test node','Settings works before the first node measurement');
await input(noMeasurements,'#setting-node_name','New witness');await save(noMeasurements);
assert.equal(offlineData.saved.node_name,'New witness');

const corruptData=fixture({settingsError:'Invalid JSON <unsafe>'});const corrupt=await boot(dist,{route:'#settings',fetchHandler:corruptData.fetchHandler});await flush();
assert.match(control(corrupt,'#page-content').innerHTML,/Invalid JSON &lt;unsafe&gt;/,'malformed overlay warning is safely escaped');
assert.match(control(corrupt,'#page-content').innerHTML,/perusasetukset/);
assert.equal(control(corrupt,'#settings-save').disabled,false,'operator can repair an invalid overlay without inventing an edit');
await save(corrupt);assert.equal(corruptData.requests.length,1);
assert(!control(corrupt,'#page-content').innerHTML.includes('Invalid JSON &lt;unsafe&gt;'),'successful repair clears malformed-overlay warning');

const demo=await boot(dist,{route:'#settings'});await flush();
assert.equal(control(demo,'#settings-save').disabled,true);assert.equal(control(demo,'#settings-check').disabled,true);
assert.match(control(demo,'#page-content').innerHTML,/Demo näyttää/);
assert(demo.requests.every(({options})=>options?.method!=='POST'),'static demo never posts settings');
console.log('Observatory Settings: persisted editable values, check-only requests, drafts across language/navigation, concurrent saves, field validation, unavailable measurements, malformed overlays and read-only demo PASS.');
