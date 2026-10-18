/** DOM-free integration checks for the frontend's rendering and export contracts.
 * Usage: node tests/frontend-smoke.mjs /path/to/dist
 * This verifies generated markup and behavior, not browser visual layout.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const dist = path.resolve(process.argv[2] || path.join(import.meta.dirname, '../dist'));
const elements = new Map();
let csvBlob;
function element() {
  return {
    innerHTML: '', textContent: '', dataset: {}, style: {}, value: '2026',
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {}, querySelectorAll() { return []; },
    setAttribute() {}, removeAttribute() {}, showModal() {}, close() {},
    appendChild() {}, remove() {}, click() {},
  };
}
const document = {
  querySelector(selector) {
    if (!elements.has(selector)) elements.set(selector, element());
    return elements.get(selector);
  },
  querySelectorAll() { return []; },
  addEventListener() {}, body: element(), documentElement: element(), createElement: element,
};
const fallbackFor = request => request.startsWith('/api/') ? {
  '/api/dashboard': 'snapshot.json', '/api/history': 'history.json',
  '/api/network': 'network.json', '/api/rewards': 'rewards.json',
  '/api/events': 'events.json',
}[request.split('?')[0]] : request;
const events = new EventTarget();
const context = {
  document, window: {
    addEventListener: events.addEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events), scrollTo() {},
    localStorage: { getItem() { return null; }, setItem() {} },
  }, Event,
  location: { hash: '#overview' }, navigator: { clipboard: { writeText: async () => {} } },
  fetch: async request => ({
    ok: true,
    json: async () => JSON.parse(fs.readFileSync(path.join(dist, fallbackFor(request)), 'utf8')),
  }),
  setTimeout() { return 1; }, clearTimeout() {}, AbortController,
  Date, Intl, Number, BigInt, console, Blob,
  URL: { createObjectURL(blob) { csvBlob = blob; return 'blob:test'; }, revokeObjectURL() {} },
};
vm.createContext(context);
for (const script of ['i18n.js', 'app-translations.js', 'app.js']) {
  vm.runInContext(fs.readFileSync(path.join(dist, script), 'utf8'), context, { filename: script });
}
await new Promise(resolve => setImmediate(resolve));

for (const page of ['overview', 'storage', 'network', 'rewards', 'events']) {
  context.location.hash = `#${page}`;
  vm.runInContext('render()', context);
  const markup = elements.get('#page-content').innerHTML;
  assert(markup.length > 500, `${page} rendered content`);
  assert(!/undefined|NaN|Infinity/.test(markup), `${page} has no invalid numeric values`);
}
assert.match(elements.get('#source-label').textContent, /Synteettinen demo/);
assert.match(elements.get('#source-label').textContent, /ei palvelinmittauksia/);
assert.match(elements.get('#source-detail').textContent, /DEMO/);

// Selecting another year must not destroy the retained 2026 snapshot.
context.location.hash = '#rewards';
vm.runInContext('render()', context);
elements.get('#reward-year').value = '2027';
await elements.get('#reward-year').onchange();
elements.get('#reward-year').value = '2026';
await elements.get('#reward-year').onchange();
assert.equal(vm.runInContext('state.rewards.year', context), 2026);
assert.equal(vm.runInContext('state.rewards.source.status', context), 'unavailable');
await vm.runInContext('exportRewards()', context);
let csv = await csvBlob.text();
assert.match(csv, /coverage_metadata/);
assert.match(csv, /unavailable/);
assert.match(csv, /source_coverage_runs/);
assert(!csv.includes('"0.00000000"'), 'empty-source export has no invented zero payout');

// Token amounts remain exact strings above JavaScript's safe integer range.
vm.runInContext(`state.rewards = {year:2026, network:'testnet', timezone:'Europe/Helsinki',
  source:{status:'partial',from_height:1,at_height:15,runs:[
    {source:'local_nodus_addr_history',from_height:9,at_height:15},
    {source:'nodus_scan_addr_history',from_height:1,at_height:12}]},
  items:[{event_id:'a',kind:'payout',height:10,amount_raw:'1234567890123456789012345',
    amount_nodus:'12345678901234567.89012345',eur_value:null,valuation_source:'=FORMULA',source:'nodus_scan_addr_history'}],
  releases:[{event_id:'b',kind:'release',height:11,amount_raw:'987654321',
    amount_nodus:'9.87654321',source:'local_nodus_addr_history'}]};`, context);
await vm.runInContext('exportRewards()', context);
csv = await csvBlob.text();
assert(csv.includes('1234567890123456789012345'), 'raw amount is exact');
assert(csv.includes('12345678901234567.89012345'), 'token decimal is exact');
assert(csv.includes('"release"'), 'stake releases remain separate rows');
assert(csv.includes("'=FORMULA"), 'untrusted CSV formula strings are escaped');
const csvRows = csv.trim().split('\r\n').map(line =>
  [...line.matchAll(/"((?:""|[^"])*)"(?:,|$)/g)].map(match => match[1].replace(/""/g, '"')));
const csvRecords = csvRows.slice(1).map(row => Object.fromEntries(csvRows[0].map((key, i) => [key, row[i]])));
const imported = csvRecords.find(row => row.event_id === 'a');
assert.equal(imported.source_from_height, '1');
assert.equal(imported.source_at_height, '12', 'imported event evidence uses the Scan run, not a higher overlapping local run');
const returned = csvRecords.find(row => row.event_id === 'b');
assert.equal(returned.source_from_height, '9');
assert.equal(returned.source_at_height, '15');
assert.equal(JSON.parse(imported.source_coverage_runs)[0].source, 'local_nodus_addr_history');
assert.equal(JSON.parse(imported.source_coverage_runs)[1].source, 'nodus_scan_addr_history');

// Null samples must create real gaps, rather than fabricated continuous lines.
vm.runInContext(`state.history={points:[
  {timestamp:'2026-10-18T01:00:00Z',height:10,network_height:30},
  {timestamp:'2026-10-18T02:00:00Z',height:null,network_height:40},
  {timestamp:'2026-10-18T03:00:00Z',height:25,network_height:50}
]};state.hours=24;`, context);
const chart = vm.runInContext("lineChart([{key:'height',name:'Node',color:'#5de0df'},{key:'network_height',name:'Network',color:'#e9ba72'}])", context);
const nodePath = chart.match(/data-series="height" d="([^"]*)"/)[1];
assert.equal((nodePath.match(/M/g) || []).length, 2, 'two disjoint measured segments');
assert(!nodePath.includes('L'), 'null measurement is not connected through');
assert.equal((chart.match(/class="chart-point"/g) || []).length, 5, 'exactly five real points');
assert.equal(vm.runInContext('number(null)', context), '—');

// Unknown states cannot turn into a green OK indicator.
vm.runInContext("state.dashboard.services=[{name:'nodus-core',active:null,enabled:null}]", context);
assert.match(vm.runInContext('servicesPanel()', context), /Ei tietoa/);
vm.runInContext("state.dashboard.services=[{name:'nodus-core',active:'active',enabled:'enabled'}]", context);
assert.match(vm.runInContext('servicesPanel()', context), /Käynnissä/);

// A server CSV error must stop export; never silently replace it with a partial view.
vm.runInContext(`state.dashboard.resources={hostname:'box <test>',hardware_model:'Other server',cpu_count:16,
  load1:8,disk_total_bytes:2199023255552,disk_free_bytes:1099511627776};
  state.dashboard.monitor={data_path:'/srv/other-node/data'};`, context);
const resources = vm.runInContext('resourcesPanel()', context);
assert.match(resources, /Other server/);
assert.match(resources, /16 loogista prosessoria/);
assert.match(resources, /box &lt;test&gt;/);
assert.match(resources, /width:50%/);
assert(!resources.includes('demo-node'), 'live resources do not fall back to preview hardware');
const disk = vm.runInContext('diskPanel()', context);
assert.match(disk, /\/srv\/other-node\/data/);
assert(!/8 TB|ext4/.test(disk));

const oldBlob = csvBlob;
context.fetch = async () => ({ok:false});
vm.runInContext("state.mode='live'", context);
await vm.runInContext('exportRewards()', context);
assert.equal(csvBlob, oldBlob);
assert.match(elements.get('#toast').textContent, /CSV-vienti epäonnistui/);
console.log('Frontend smoke: 5 pages, static provenance, year restore, exact CSV, null gaps, unknown states, and export failures PASS.');
