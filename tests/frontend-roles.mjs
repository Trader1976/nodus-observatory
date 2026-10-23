/** Real frontend route/role integration in the offline DOM harness. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {boot,flush} from './frontend-harness.mjs';
const dist=path.resolve(process.argv[2]||path.join(import.meta.dirname,'../dist'));
const source=JSON.parse(fs.readFileSync(path.join(dist,'snapshot.json'),'utf8'));
const baseSettings={node_name:'',roles:{storage:true,witness:true},default_view:'overview',history_days:30,network_interface:null,disk_device:null,network_enabled:true,rewards_enabled:true,rewards_scan_enabled:true};
const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>structuredClone(data)});
async function start({roles={storage:true,witness:true},settings={},route='#overview',dashboard=true,failed=false,savedLanguage='fi'}={}){
  const saved={...baseSettings,...settings,roles};
  const live={...source,preview:false,demo:false,roles,monitor:{...source.monitor,roles,node_name:saved.node_name,default_view:saved.default_view},quality:{partial:failed,errors:failed?[{source:'witness-status',message:'command timed out'}]:[]},witness:{enabled:roles.witness,service:{name:'nodus-witness',active:failed?'failed':'active',enabled:'enabled'},committee:{height:120000,count:3,is_member:null,power:null,stake_raw:null}}};
  const app=await boot(dist,{route,saved:{'nodus-observatory-language':savedLanguage},fetchHandler:(url)=>{
    if(url==='/api/settings')return response({settings:saved,editable_fields:Object.keys(baseSettings),revision:'r1',csrf_token:'token'});
    if(url==='/api/dashboard')return dashboard?response(live):response({error:'unavailable'},503);
    if(!dashboard&&url==='snapshot.json')return response({error:'unavailable'},503);
  }});
  await flush();return app;
}
function markup(app){return app.document.querySelector('#page-content').innerHTML;}
const both=await start();
const englishReload=await start({savedLanguage:'en'});
assert.equal(englishReload.document.querySelector('[data-i18n="Asetukset"]').textContent,'Settings','remembered English translates shell labels after all dictionaries load');
assert.equal(englishReload.document.querySelector('[data-i18n="Todistaja"]').textContent,'Witness');
assert.equal(englishReload.document.querySelector('[data-i18n="Tarkastelunäkymä"]').textContent,'View');
assert.equal(both.document.querySelector('[data-role="storage"]').hidden,false);
assert.equal(both.document.querySelector('[data-role="witness"]').hidden,false);
assert.match(markup(both),/STORAGE-ROOLI|VALMISTAUTUMISJAKSO/);
assert.match(markup(both),/Todistajarooli/);
const onlyWitness=await start({roles:{storage:false,witness:true},settings:{node_name:'Witness one'}});
assert.equal(onlyWitness.document.querySelector('[data-role="storage"]').hidden,true);
assert.equal(onlyWitness.document.querySelector('[data-role="witness"]').hidden,false);
assert.match(onlyWitness.document.querySelector('[data-hostname]').textContent,/Witness one/);
assert(!markup(onlyWitness).includes('Valmiit segmentit'),'witness-only overview omits archive metrics');
assert(!markup(onlyWitness).includes('Epäonnistumisputki'),'witness-only overview omits storage failures');
assert(!markup(onlyWitness).includes('STORAGE-ROOLI'),'witness-only overview omits storage registration/grace');
assert(markup(onlyWitness).includes('Noduksen tallennustila'),'shared filesystem measurements stay available');
onlyWitness.context.location.hash='#storage';onlyWitness.run('render()');
assert.equal(onlyWitness.run('state.page'),'overview','disabled role deep link resolves to overview');
onlyWitness.context.location.hash='#witness';onlyWitness.run('render()');
assert.match(markup(onlyWitness),/Todistajan tilanne/);
assert.match(markup(onlyWitness),/Jäsenyys ei saatavilla/,'unknown membership is not marked negative');
assert(!markup(onlyWitness).includes('Ei mukana komiteassa'));
assert(!/undefined|NaN|Infinity/.test(markup(onlyWitness)));
const savedRoles=onlyWitness.run('JSON.stringify(configuredRoles())');
onlyWitness.context.location.hash='#network';onlyWitness.run('render()');
assert.equal(onlyWitness.run('JSON.stringify(configuredRoles())'),savedRoles,'view selection never changes monitored roles');
assert(!markup(onlyWitness).includes('Storage-joukko'),'network view avoids disabled own storage state');
onlyWitness.context.location.hash='#events';onlyWitness.run('render()');
assert(!markup(onlyWitness).includes('STORAGE-TARKISTUKSET'));
onlyWitness.context.NodusI18n.setLanguage('en');
onlyWitness.context.location.hash='#witness';onlyWitness.run('render()');
assert.match(markup(onlyWitness),/Your witness at a glance/);
assert.match(onlyWitness.document.querySelector('#view-mode').innerHTML,/Overview/);

const onlyStorage=await start({roles:{storage:true,witness:false}});
assert.equal(onlyStorage.document.querySelector('[data-role="witness"]').hidden,true);
assert.match(markup(onlyStorage),/Valmiit segmentit/);
assert(!markup(onlyStorage).includes('Todistajarooli'));
onlyStorage.run("state.dashboard.quality={partial:true,errors:[{source:'witness-status',message:'command timed out'}]};render()");
assert(!markup(onlyStorage).includes('Osa seurantatiedoista puuttuu.'),'disabled role old errors do not become current failures');
onlyStorage.context.location.hash='#contracts-editor';onlyStorage.run('render()');
assert.match(markup(onlyStorage),/workflow-builder/);
assert.match(markup(onlyStorage),/href="#contracts"/);
assert.match(markup(onlyStorage),/href="#contracts-escrow"/);
assert.equal(onlyStorage.document.querySelector('[data-area="studio"]').getAttribute('aria-current'),'page');
assert.equal(onlyStorage.document.querySelector('#view-switch').hidden,true);

const failure=await start({roles:{storage:false,witness:true},failed:true,route:'#witness'});
assert.equal(failure.document.querySelector('[data-role="witness"]').hidden,false);
assert.match(markup(failure),/Virhe/);
assert.match(markup(failure),/rooli säilyy seurannassa/);
assert.match(markup(failure),/witness-status/);

const defaultView=await start({roles:{storage:false,witness:true},settings:{default_view:'witness'},route:''});
assert.equal(defaultView.run('state.page'),'witness');
const explicit=await start({roles:{storage:false,witness:true},settings:{default_view:'witness'},route:'#overview'});
assert.equal(explicit.run('state.page'),'overview','explicit links override default view');
// Effective config overrides a snapshot from before the next collection.
explicit.run("state.dashboard.roles={storage:true,witness:false};state.dashboard.monitor.roles={storage:false,witness:true};state.monitorSettings={roles:{storage:true,witness:false},node_name:'Old name'};state.dashboard.monitor.node_name='';render()");
assert.equal(explicit.document.querySelector('[data-role="storage"]').hidden,true);
assert.equal(explicit.document.querySelector('[data-role="witness"]').hidden,false);
assert.equal(explicit.document.querySelector('[data-hostname]').textContent,source.resources.hostname,'fresh cleared name overrides cached settings');
explicit.run("applyMonitorSettings({...state.monitorSettings,roles:{storage:true,witness:false},node_name:'Saved now',default_view:'overview'},true)");
assert.equal(explicit.document.querySelector('[data-role="witness"]').hidden,true,'local save applies immediately before next collection');
assert.equal(explicit.document.querySelector('[data-hostname]').textContent,'Saved now');

const noData=await start({roles:{storage:false,witness:true},dashboard:false,route:'#settings'});
assert.match(markup(noData),/observatory-settings/,'settings independent of collector data');
assert(noData.document.querySelector('#setting-node_name'),'live settings remain usable while collector fails');
noData.context.location.hash='#contracts-editor';noData.run('render()');
assert.match(markup(noData),/workflow-builder/,'Studio independent of collector data');
console.log('Frontend roles: storage/witness/both, disabled and failed roles, defaults, languages and independent Settings/Studio PASS.');
