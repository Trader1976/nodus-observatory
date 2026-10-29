/* Exercise Statistics' shipped UI and failure/preview boundaries with synthetic data. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {boot,flush} from '../../tests/frontend-harness.mjs';

const dist=path.resolve(process.argv[2]||path.join(import.meta.dirname,'../../dist'));
const fixture=JSON.parse(fs.readFileSync(path.join(import.meta.dirname,'../frontend/preview.json'),'utf8'));
const clone=x=>JSON.parse(JSON.stringify(x));
const reply=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>clone(data)});
const fixtureIps=['192.0.2.10:4001','198.51.100.20:4001'];
const live=()=>{const d=clone(fixture);delete d.preview;if(d.nodes[0])d.nodes[0].address=fixtureIps[0];if(d.peer_endpoints[0])d.peer_endpoints[0].address=fixtureIps[1];return d;};
const assertPrivateIpsHidden=markup=>{for(const address of fixtureIps)assert(!markup.includes(address),`IP address must stay hidden: ${address}`);};
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
assertPrivateIpsHidden(html());
payload.peer_endpoints[0].location={country:'Example Country',country_code:'EX',city:'Example Endpoint City',latitude:66,longitude:25,source:'dbip_city_lite'};
payload.nodes[0].local=true;
payload.peer_endpoints[0].id='e'.repeat(64);
payload.geolocation={configured:true,available:true,status:'ready',provider:'DB-IP',database_date:'2026-10-01',auto_update:true,database_stale:false};
await control('#statistics-refresh').click();await flush();
assert.equal(app.document.querySelectorAll('.stats-map-endpoint').length,1,'located peer endpoints appear on the map');
assert.match(html(),/Identiteettiä ei vahvistettu/);
assert.match(html(),/Oma node/);
assertPrivateIpsHidden(html());
assert.match(html(),/Päätepiste eeeeeeee…eeeeeee/,'an anonymous endpoint label replaces its IP');
assert(!app.document.querySelector('.stats-map-endpoint').getAttribute('aria-label').includes(payload.peer_endpoints[0].address),'map accessibility labels hide IP addresses');
assert.match(html(),/1 verkkopäätepistettä kartalla/,'endpoint map counts remain separate from node counts');
assert.equal(app.document.querySelector('.stats-map-endpoint').getAttribute('data-select-node'),null,'endpoint markers never impersonate node identities');
assert.match(html(),/href="https:\/\/db-ip\.com"[^>]*>IP Geolocation by DB-IP<\/a>/,'DB-IP data receives linked attribution');
assert.match(html(),/creativecommons\.org\/licenses\/by\/4\.0\//);
assert.match(html(),/2026-10-01/);assert.match(html(),/Automaattinen kuukausipäivitys/);
const search=control('#statistics-node-search');search.value='192.0.2.';await search.fire('input');
assert.equal(app.document.querySelectorAll('.stats-map-marker').length,0,'hidden node IPs cannot be used as a search side channel');
assert.equal(app.document.querySelectorAll('.stats-map-endpoint').length,0,'hidden endpoint IPs cannot be searched');
control('#statistics-node-search').value='Finland';await control('#statistics-node-search').fire('input');
assert.match(html(),/Helsinki/);assert(!html().includes('Frankfurt'),'search filters results');
control('#statistics-node-search').value='';await control('#statistics-node-search').fire('input');
const role=control('#statistics-role-filter');role.value='storage';await role.fire('change');
assert.equal(app.document.querySelectorAll('.stats-map-endpoint').length,0,'a storage-role filter excludes unconfirmed endpoints');
assert(!html().includes('Helsinki, Finland'),'role filter excludes witness-only nodes');assert.match(html(),/Singapore/);
const select=app.document.querySelector('[data-select-node]');assert(select);await select.click();
assert(control('#statistics-node-details'),'selecting a marker or table row opens node details');
assertPrivateIpsHidden(html());
assert(!control('#statistics-node-details').innerHTML.includes('Verkko-osoite'),'node details contain no IP-address field');
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

// A partial six-day history is still useful at every longer selected range.
await control('#statistics-tab-overview').click();
for(const key of ['30d','1y','all','24h','7d']){
  payload=live();payload.range=key;payload.coverage.range_complete=false;
  await app.document.querySelectorAll('[data-stat-range]').find(el=>el.dataset.statRange===key).click();await flush();
  assert.match(html(),/Transaction history is still partial/);
  assert(app.document.querySelector('[data-chart-readout]'),'available partial data still has chart points');
  assert(!html().includes('Statistics data is not available yet'));
}
// A failed SQL/read budget is not an empty store or an old observation.
payload={schema_version:1,available:false,stale:true,reason:'Statistics data is temporarily unavailable',
  summary:{},coverage:{},series:{activity:[],network:[],tps:[]}};
await control('#statistics-refresh').click();await flush();
assert.match(html(),/Stored statistics could not be read/);
assert(!html().includes('first successful collection'));
assert(!html().includes('latest collection is stale'));
assert(control('#statistics-retry'));
app.context.NodusI18n.setLanguage('fi');
assert.match(html(),/Tallennettuja tilastoja ei voitu lukea/);
assert.match(html(),/ei tarkoita, että historiaa olisi liian vähän/);
payload.reason='No statistics have been collected yet';
await control('#statistics-refresh').click();await flush();
assert.match(html(),/Kerääjän ensimmäinen onnistunut havainto/);
assert(!html().includes('Tallennettuja tilastoja ei voitu lukea'));
app.context.NodusI18n.setLanguage('en');

payload=live();payload.nodes[0].id='<img src=x onerror=alert(1)>';payload.nodes[0].address='<script>evil()</script>';
payload.peer_endpoints[0].id='[2001:db8::8]:4001';
payload.peer_endpoints[0].address='[2001:db8::8]:4001';
payload.peer_endpoints[0].location={country:'Example Country',city:'Example City',latitude:66,longitude:25};
await control('#statistics-refresh').click();await flush();await control('#statistics-tab-nodes').click();
control('#statistics-role-filter').value='all';await control('#statistics-role-filter').fire('change');
assert(!html().includes('evil()'),'legacy network address fields are ignored entirely');
assert(!html().includes('2001:db8::8'),'an endpoint ID cannot fall back to an IP address');
assert.match(html(),/&lt;img src=x onerror=alert\(1\)&gt;/,'untrusted node IDs remain escaped');
assertPrivateIpsHidden(html());

// Witness details use exact amounts, reconcile stake types and expose all wallets.
const delegationFixture=(count=28)=>{
  const rows=Array.from({length:count},(_,i)=>({owner_fp:(i+1).toString(16).padStart(128,'0'),amount_raw:String(900719925474099312345678900n-BigInt(i)*100000000n),is_owner:i===0}));
  const delegated=rows.reduce((sum,row)=>sum+BigInt(row.amount_raw),0n),self=123456789012345678900n,owner=BigInt(rows[0]?.amount_raw||'0');
  return {available:true,at_height:321000,observed_at:'2026-10-24T09:00:00Z',source:'local_committed_delegations',validator_id:'a'.repeat(64),owner_fp:rows[0]?.owner_fp||'a'.repeat(128),self_stake_raw:String(self),delegated_raw:String(delegated),owner_delegated_raw:String(owner),external_delegated_raw:String(delegated-owner),total_stake_raw:String(self+delegated),delegator_count:rows.length,commission_bps:500,status:'active',delegations:rows};
};
payload=live();delete payload.nodes[0].delegation;
await control('#statistics-refresh').click();await flush();await control('[data-select-node="0"]').click();
assert.match(html(),/Delegation data is unavailable/);
assert.equal(app.document.querySelector('.stats-delegation-table'),null,'unavailable data has no zero-filled delegation table');
const delegation=delegationFixture();payload.nodes[0].delegation=delegation;
await control('#statistics-refresh').click();await flush();
assert.match(html(),/Witness stake and delegations/);assert.match(html(),/Wallet fingerprints are shown, not people’s names/);
assert.match(html(),/Block 321,000/);assert.match(html(),/Source: local committed chain state/);
payload.nodes[0].delegation.stale=true;payload.nodes[0].delegation.lag_blocks=42;
await control('#statistics-refresh').click();await flush();
assert.match(html(),/The delegation snapshot is stale/);assert.match(html(),/trails the observed network tip/);
payload.nodes[0].delegation.stale=false;payload.nodes[0].delegation.lag_blocks=0;
const amount=app.context.NodusStatistics.helpers.rawAmount;
assert(html().includes(amount(delegation.total_stake_raw)),'total bonded retains all integer precision');
const composition=app.document.querySelector('.stats-stake-stack');assert(composition);
assert(composition.getAttribute('aria-label').includes('Owner delegation'));
assert(composition.getAttribute('aria-label').includes('< 0.01 %'),'a tiny positive self-stake is not reported as zero percent');
for(const segment of composition.querySelectorAll('span'))assert(!/NaN|Infinity/.test(segment.getAttribute('style')),'large raw integers produce bounded chart widths');
const expectedOthers=delegation.delegations.slice(10).reduce((sum,row)=>sum+BigInt(row.amount_raw),0n);
const leaders=app.document.querySelector('.stats-delegation-leaders');
assert.equal(leaders.querySelectorAll('.stats-bar-row').length,11,'chart shows top ten and a combined remainder');
assert(leaders.querySelector('.stats-delegator-others').querySelector('strong').textContent.includes(amount(String(expectedOthers))),'remainder is the exact sum of every omitted wallet');
const tableRows=()=>app.document.querySelector('.stats-delegation-table').querySelector('tbody').querySelectorAll('tr');
assert.equal(tableRows().length,25);
assert.equal(tableRows()[0].querySelector('.stats-wallet').getAttribute('title'),delegation.delegations[0].owner_fp,'full wallet fingerprint is available as a tooltip');
assert(tableRows()[0].querySelector('.stats-wallet').getAttribute('aria-label').includes(delegation.delegations[0].owner_fp),'assistive technology receives the full wallet fingerprint');
assert.equal(tableRows()[0].querySelectorAll('td')[1].textContent,amount(delegation.delegations[0].amount_raw));
assertPrivateIpsHidden(html());
await control('#statistics-delegation-next').click();
assert.equal(tableRows().length,3,'pagination reaches every delegator');
assert.equal(tableRows()[0].querySelector('.stats-wallet').getAttribute('title'),delegation.delegations[25].owner_fp);
assert.equal(control('#statistics-delegation-next').disabled,true);
await control('[data-select-node="1"]').click();
assert.match(html(),/Delegation data is unavailable/);
await control('[data-select-node="0"]').click();
assert.equal(tableRows().length,25,'changing selected node resets delegation pagination');
assert.equal(control('#statistics-delegation-prev').disabled,true);
app.context.NodusI18n.setLanguage('fi');assert.match(html(),/Witnessin panokset ja delegoinnit/);assert.match(html(),/Omistajan delegointi/);app.context.NodusI18n.setLanguage('en');
// Zero delegations is a verified state, unlike unavailable or inconsistent data.
payload.nodes[0].delegation=delegationFixture(0);await control('#statistics-refresh').click();await flush();assert.match(html(),/No current delegations/);
payload.nodes[0].delegation={...delegation,delegated_raw:'1'};await control('#statistics-refresh').click();await flush();assert.match(html(),/Delegation data is unavailable/,'inconsistent totals are not plotted');
const hostile=clone(delegation);hostile.owner_fp='<img src=x onerror=alert(2)>';hostile.delegations[0].owner_fp=hostile.owner_fp;
payload.nodes[0].delegation=hostile;await control('#statistics-refresh').click();await flush();
assert(!html().includes('<img src=x onerror=alert(2)>'),'wallet fingerprints never become executable HTML');
assert.match(html(),/&lt;img src=x onerror=alert\(2\)&gt;/);
assertPrivateIpsHidden(html());
await control('#statistics-close-node').click();

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
