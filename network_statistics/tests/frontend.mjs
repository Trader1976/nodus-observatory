/* Exercise Statistics' shipped UI and failure/preview boundaries with synthetic data. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {boot,flush} from '../../tests/frontend-harness.mjs';

const dist=path.resolve(process.argv[2]||path.join(import.meta.dirname,'../../dist'));
const fixture=JSON.parse(fs.readFileSync(path.join(import.meta.dirname,'../frontend/preview.json'),'utf8'));
const clone=x=>JSON.parse(JSON.stringify(x));
const reply=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>clone(data)});
const live=()=>{const d=clone(fixture);delete d.preview;return d;};
let fail=false;let payload=live();let defer=null;
const app=await boot(dist,{route:'#statistics',fetchHandler:async(url)=>{
  if(url.startsWith('/api/statistics/export.csv'))return {ok:true,status:200,blob:async()=>new Blob(['network,range\r\ntestnet,24h\r\n'])};
  if(url.startsWith('/api/statistics')){
    if(defer)return new Promise(resolve=>{defer.resolve=resolve;});
    return fail?reply({error:'Unavailable'},503):reply(payload);
  }
  if(url==='statistics/preview.json')return reply(fixture);
  if(url==='/api/dashboard'){const d=JSON.parse(fs.readFileSync(path.join(dist,'snapshot.json'),'utf8'));d.preview=false;return reply(d);}
}});
await flush();
const control=id=>{const el=app.document.querySelector(id);assert(el,`Expected control ${id}`);return el;};
const html=()=>control('#page-content').innerHTML;
assert(app.context.NodusStatistics,'Statistics module is exposed');
assert.match(html(),/Verkko numeroina/);
assert(!html().includes('Synteettinen esikatselu'),'live reports are not labelled demo');
assert.match(html(),/Tapahtumat \/ 24 h/);
assert.match(html(),/Tapahtumahistoria on vielä osittainen/,'caught-up recent history remains labelled partial for the requested range');
assert.equal(app.context.NodusStatistics.helpers.rawAmount('90071992547409931234567890'),'900 719 925 474 099 312,3456789','financial display preserves precision above 2^53');
assert.equal(app.context.NodusStatistics.helpers.rawAmount(null),'—','missing money stays unknown');
assert.equal(app.context.NodusStatistics.helpers.locationOf({location:{latitude:91,longitude:1}}),null,'out-of-range latitude is not mapped');
assert.equal(app.context.NodusStatistics.helpers.locationOf({location:{latitude:'60',longitude:'24'}}),null,'ambiguous string coordinates are not mapped');

await control('#statistics-tab-nodes').click();
assert.match(html(),/world-map\.svg/,'map uses bundled land outlines');
assert.match(html(),/ilman sijaintia/,'unlocated nodes are reported');
assert.match(html(),/Helsinki/);
payload.peer_endpoints[0].location={country:'Example Country',country_code:'EX',city:'Example Endpoint City',latitude:66,longitude:25,source:'dbip_city_lite'};
payload.nodes[0].local=true;
payload.geolocation={configured:true,available:true,status:'ready',provider:'DB-IP',database_date:'2026-10-01',auto_update:true,database_stale:false};
await control('#statistics-refresh').click();await flush();
assert.equal(app.document.querySelectorAll('.stats-map-endpoint').length,1,'located peer endpoints appear on the map');
assert.match(html(),/Identiteettiä ei vahvistettu/);
assert.match(html(),/Oma node/);
assert.match(html(),/1 verkkopäätepistettä kartalla/,'endpoint map counts remain separate from node counts');
assert.equal(app.document.querySelector('.stats-map-endpoint').getAttribute('data-select-node'),null,'endpoint markers never impersonate node identities');
assert.match(html(),/href="https:\/\/db-ip\.com"[^>]*>IP Geolocation by DB-IP<\/a>/,'DB-IP data receives linked attribution');
assert.match(html(),/creativecommons\.org\/licenses\/by\/4\.0\//);
assert.match(html(),/2026-10-01/);assert.match(html(),/Automaattinen kuukausipäivitys/);
const search=control('#statistics-node-search');search.value='Finland';await search.fire('input');
assert.match(html(),/Helsinki/);assert(!html().includes('Frankfurt'),'search filters results');
control('#statistics-node-search').value='';await control('#statistics-node-search').fire('input');
const role=control('#statistics-role-filter');role.value='storage';await role.fire('change');
assert.equal(app.document.querySelectorAll('.stats-map-endpoint').length,0,'a storage-role filter excludes unconfirmed endpoints');
assert(!html().includes('Helsinki, Finland'),'role filter excludes witness-only nodes');assert.match(html(),/Singapore/);
const select=app.document.querySelector('[data-select-node]');assert(select);await select.click();
assert(control('#statistics-node-details'),'selecting a marker or table row opens node details');
await control('#statistics-close-node').click();assert.equal(app.document.querySelector('#statistics-node-details'),null);
app.context.NodusI18n.setLanguage('en');
assert.match(html(),/The network, in numbers/);assert.match(html(),/without location/);assert.match(html(),/All roles/);
assert.equal(app.context.NodusStatistics.getState().tab,'nodes','language change preserves tab');
assert.equal(control('#statistics-role-filter').value,'storage','language change preserves filters');
assert.match(html(),/Database date/);assert.match(html(),/Automatic monthly updates/);
payload.geolocation.database_date='<img src=x onerror=alert(1)>';
payload.geolocation.update_status='error';payload.geolocation.database_stale=true;
await control('#statistics-refresh').click();await flush();
assert.match(html(),/The local database remains in use/);assert.match(html(),/over 62 days old/);
assert(!html().includes('<img src=x onerror=alert(1)>'),'database metadata is escaped');
payload.geolocation={configured:true,available:false,status:'awaiting_download',update_status:'error',auto_update:true};
await control('#statistics-refresh').click();await flush();
assert.match(html(),/The location database download failed/);
assert(!html().includes('The local database remains in use'),'missing data is not described as retained');
payload.geolocation={configured:true,available:true,status:'ready',provider:'DB-IP',database_date:'2026-10-01'};

await control('#statistics-tab-activity').click();
assert.match(html(),/First-observed addresses/);assert.match(html(),/An old address may be first observed/);
const point=app.document.querySelector('[data-chart-readout]');assert(point);await point.fire('focus');
assert(app.document.querySelector('#'+point.dataset.chartReadout+'-readout').textContent.includes('·'),'keyboard focus exposes exact chart readout');
await control('#statistics-tab-staking').click();assert.match(html(),/Validator self-stake/);
const exported=app.downloads.length;await control('#statistics-export').click();await flush();assert.equal(app.downloads.length,exported+1,'CSV export downloads the read-only report');
assert(app.requests.some(r=>r.request==='/api/statistics/export.csv?range=24h'));
assert(!app.requests.some(r=>r.options?.method==='POST'),'Statistics performs no mutations');
await control('#statistics-tab-contracts').click();assert.match(html(),/Contract activity/);assert.match(html(),/Gas used/);
const ranges=app.document.querySelectorAll('[data-stat-range]');await ranges.find(el=>el.dataset.statRange==='7d').click();await flush();
assert(app.requests.some(r=>r.request==='/api/statistics?range=7d'),'range changes request bounded API data');
assert.equal(app.context.NodusStatistics.getState().range,'7d');

payload=live();payload.nodes[0].id='<img src=x onerror=alert(1)>';payload.nodes[0].address='<script>evil()</script>';
await control('#statistics-refresh').click();await flush();await control('#statistics-tab-nodes').click();
control('#statistics-role-filter').value='all';await control('#statistics-role-filter').fire('change');
assert(!html().includes('<script>evil()'),'untrusted node identifiers and addresses never become HTML');
assert.match(html(),/&lt;script&gt;evil\(\)&lt;\/script&gt;/);

const before=app.requests.length;fail=true;await control('#statistics-refresh').click();await flush();
assert.match(html(),/Statistics could not be loaded/);assert.match(html(),/Previously loaded data has been retained/);
assert(!app.requests.slice(before).some(r=>r.request==='statistics/preview.json'),'live API failures never load synthetic data');
fail=false;payload=live();await control('#statistics-retry').click();await flush();assert(!html().includes('Statistics could not be loaded'));

// Explicit preview is separate and requires a preview marker.
app.context.NodusStatistics.mount(control('#page-content'),{demo:true});await flush();
assert.match(html(),/Synthetic preview/);assert(app.requests.some(r=>r.request==='statistics/preview.json'));
assert.equal(app.context.NodusStatistics.getState().demo,true);
assert.equal(control('#statistics-export').disabled,true,'synthetic preview cannot export as a live report');
app.context.NodusStatistics.mount(control('#page-content'),{demo:false});await flush();
assert(!html().includes('Synthetic preview'),'changing mode discards preview data before loading live');

// Failed collection intervals remain genuine gaps in observation charts.
payload=live();payload.coverage.network_sample_stride=1;payload.series.network=[{timestamp:'2026-10-23T00:00:00Z',self_stake_raw:'100000000',delegated_raw:'200000000'},{timestamp:'2026-10-23T00:05:00Z',self_stake_raw:'100000000',delegated_raw:'200000000'},{timestamp:'2026-10-23T01:00:00Z',self_stake_raw:'100000000',delegated_raw:'200000000'}];
await control('#statistics-refresh').click();await flush();await control('#statistics-tab-staking').click();
const pathData=html().match(/<path class="stats-line" d="([^"]+)"/)[1];assert.equal((pathData.match(/M/g)||[]).length,2,'outage breaks the line rather than interpolating it');

// A peer with a location must remain visible even without a known node identity.
payload=live();payload.nodes=[];payload.peer_endpoints[0].location={country:'Example Country',city:'Example City',latitude:66,longitude:25};
await control('#statistics-refresh').click();await flush();await control('#statistics-tab-nodes').click();
assert.equal(app.document.querySelectorAll('.stats-map-endpoint').length,1);
assert(!html().includes('No location data yet'),'a mapped endpoint is not hidden by the no-node empty state');
assert.match(html(),/network endpoints on map/);

// No-node report preserves the map and honest empty states.
payload=live();payload.nodes=[];payload.summary.observed_nodes=0;payload.series={activity:[],network:[],tps:[]};
await control('#statistics-refresh').click();await flush();await control('#statistics-tab-nodes').click();
assert.match(html(),/No location data yet/);assert.match(html(),/No nodes found/);
await control('#statistics-tab-overview').click();assert.match(html(),/No history yet/);

// An older response must not overwrite a later request or render after unmount.
defer={};const old=app.context.NodusStatistics.refresh();await flush();const wait=defer;defer=null;
await app.context.NodusStatistics.refresh();const final=html();
wait.resolve(reply({...live(),chain_id:'stale-response'}));await old;await flush();assert(!html().includes('stale-response'));
app.context.NodusStatistics.unmount();assert.equal(app.context.NodusStatistics.getState().loading,false);
assert(final.includes('network'),'Statistics remains a complete view');
console.log('Statistics frontend: rendering, charts, filtering, details, i18n, range, exact money, errors, preview and request ordering passed.');
