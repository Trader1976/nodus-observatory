/** Browser-independent language integration checks.
 * Usage: node tests/frontend-i18n.mjs /path/to/dist
 * A deliberately small DOM exercises actual scripts, saved preferences, shell
 * labels, rendering and interaction state without needing third-party packages.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const dist = path.resolve(process.argv[2] || path.join(import.meta.dirname, '../dist'));
const shell = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const scripts = ['i18n.js', 'app-translations.js', 'contract-studio-core.js',
  'contract-studio-i18n.js', 'contract-studio.js', 'app.js'];
assert.deepEqual([...shell.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(match => match[1]), scripts,
  'language messages load before the app, with no external script dependency');

const apiFiles = {
  '/api/dashboard': 'snapshot.json', '/api/history': 'history.json',
  '/api/network': 'network.json', '/api/rewards': 'rewards.json', '/api/events': 'events.json',
};
const decode = text => text.replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function createElement(attributes = {}) {
  const listeners = new EventTarget();
  const attrs = { ...attributes };
  const classes = new Set((attrs.class || '').split(/\s+/).filter(Boolean));
  const element = {
    dataset: {}, style: {}, innerHTML: '', textContent: '', value: '2026',
    setAttribute(name, value) { attrs[name] = String(value); if (name === 'lang') this.lang = String(value); },
    getAttribute(name) { return attrs[name] ?? null; },
    removeAttribute(name) { delete attrs[name]; },
    addEventListener: listeners.addEventListener.bind(listeners),
    dispatchEvent: listeners.dispatchEvent.bind(listeners),
    classList: {
      add(name) { classes.add(name); }, remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); },
      toggle(name, force) {
        const active = force === undefined ? !classes.has(name) : force;
        if (active) classes.add(name); else classes.delete(name);
        return active;
      },
    },
    click() { this.dispatchEvent(new Event('click')); this.onclick?.({ target: this, currentTarget: this }); },
    querySelectorAll() { return []; }, querySelector() { return null; }, appendChild() {}, remove() {},
    showModal() { this.open = true; }, close() { this.open = false; },
  };
  for (const [name, value] of Object.entries(attrs)) {
    if (name.startsWith('data-')) element.dataset[name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = value;
  }
  return element;
}

async function boot({ saved = null, storageThrows = false, withApp = true } = {}) {
  const elements = new Map();
  const nodes = [];
  const savedValues = new Map(saved === null ? [] : [['nodus-observatory-language', saved]]);
  const downloads = [];
  let storageWrites = 0;
  const localStorage = {
    getItem(key) { if (storageThrows) throw Error('Storage blocked'); return savedValues.get(key) ?? null; },
    setItem(key, value) { if (storageThrows) throw Error('Storage blocked'); storageWrites += 1; savedValues.set(key, value); },
  };
  for (const match of shell.matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)) {
    const attributes = {};
    for (const attribute of match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) attributes[attribute[1]] = decode(attribute[2] || '');
    const element = createElement(attributes);
    element.tagName = match[1].toUpperCase();
    if (attributes.id) elements.set(`#${attributes.id}`, element);
    const closing = shell.indexOf(`</${match[1]}>`, match.index + match[0].length);
    if (closing !== -1) element.textContent = decode(shell.slice(match.index + match[0].length, closing).replace(/<[^>]*>/g, ''));
    nodes.push(element);
  }
  function querySelectorAll(selector) {
    if (selector === 'nav a') return nodes.filter(node => node.tagName === 'A' && node.dataset.page);
    if (selector.startsWith('[data-')) {
      const name = selector.slice(1, -1).split('=')[0];
      return nodes.filter(node => node.getAttribute(name) !== null);
    }
    if (selector.startsWith('.')) return nodes.filter(node => node.classList.contains(selector.slice(1)));
    return [];
  }
  const document = {
    title: '', documentElement: nodes.find(node => node.tagName === 'HTML'), body: createElement(),
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, createElement());
      return elements.get(selector);
    },
    querySelectorAll, addEventListener() {}, createElement,
  };
  const events = new EventTarget();
  const context = {
    document, location: { hash: '#overview' }, navigator: { clipboard: { writeText: async () => {} } },
    Event, CustomEvent, AbortController, Date, Intl, Number, BigInt, console, Blob,
    addEventListener: events.addEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events),
    scrollTo() {}, localStorage,
    fetch: async request => ({
      ok: true,
      json: async () => JSON.parse(fs.readFileSync(path.join(dist, apiFiles[request.split('?')[0]] || request), 'utf8')),
    }),
    setTimeout() { return 1; }, clearTimeout() {}, URL: {
      createObjectURL(blob) { downloads.push(blob); return 'blob:test'; }, revokeObjectURL() {},
    },
  };
  // Browser globals and window name the same object, as they do in a real page.
  context.window = context;
  vm.createContext(context);
  for (const script of withApp ? scripts : scripts.filter(script => script !== 'app.js')) {
    vm.runInContext(fs.readFileSync(path.join(dist, script), 'utf8'), context, { filename: script });
  }
  await new Promise(resolve => setImmediate(resolve));
  return { context, document, elements, nodes, savedValues, downloads, storageWrites: () => storageWrites,
    run: source => vm.runInContext(source, context) };
}

const app = await boot();
const { context, document, elements, nodes, run } = app;
const language = context.NodusI18n;
assert(language, 'language API is available');
assert.equal(language.language(), 'fi', 'first visit defaults to Finnish');
assert.equal(document.documentElement.lang, 'fi');
assert.equal(language.t('A source without a translation'), 'A source without a translation', 'unknown text is retained');
language.addMessages({ 'Tarkistus: {height}': 'Check: {height}' });
assert.equal(language.t('Tarkistus: {height}', { height: 42 }), 'Tarkistus: 42');
assert.equal(run('number(null)'), '—', 'unknown measurements remain absent');

// Catch a newly added UI string that has been wrapped for translation but was
// accidentally omitted from the English message catalog. The small allow-list
// contains meaningful technical labels that are identical in both languages.
const invariantLabels = new Set(['NODUS TESTNET', 'STORAGE TESTNET', 'TESTNET', 'Storage node', 'Epoch & grace', '24 h', 'TPS', 'PASSED', 'NTP']);
const sources = new Set();
const sourceCode = fs.readFileSync(path.join(dist, 'app.js'), 'utf8');
for (const match of sourceCode.matchAll(/\b(?:t|toast)\(\s*((?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'))/g)) {
  sources.add(vm.runInNewContext(match[1]));
}
for (const node of nodes) {
  for (const attribute of ['data-i18n', 'data-i18n-aria-label', 'data-i18n-title']) {
    const source = node.getAttribute(attribute);
    if (source !== null) sources.add(source);
  }
}
for (const source of run('[...Object.values(PAGES),...Object.values(SOURCE_NAMES),...Object.values(BACKEND_TEXT_KEYS)]')) sources.add(source);
const previewEvents = JSON.parse(fs.readFileSync(path.join(dist, 'events.json'), 'utf8'));
for (const event of previewEvents.events || previewEvents.items || []) if (event.message) sources.add(event.message);
const previewRewards = JSON.parse(fs.readFileSync(path.join(dist, 'rewards.json'), 'utf8'));
if (previewRewards.source?.reason) sources.add(previewRewards.source.reason);
language.setLanguage('en');
const missing = [...sources].filter(source => source && !invariantLabels.has(source) && language.t(source) === source);
assert.deepEqual(missing, [], 'all literal UI messages and known dynamic labels have an English translation');
for (const source of sources) {
  const original = [...source.matchAll(/\{([A-Za-z_][\w]*)\}/g)].map(match => match[1]).sort();
  const translated = [...language.t(source).matchAll(/\{([A-Za-z_][\w]*)\}/g)].map(match => match[1]).sort();
  assert.deepEqual(translated, original, `translation retains dynamic values: ${source}`);
}
assert.equal(run("dataText('Unrecognised diagnostic: peer 12 disconnected')"), 'Unrecognised diagnostic: peer 12 disconnected');
language.setLanguage('fi');
for (const [status, fi, en] of [
  ['ACTIVE', 'Aktiivinen', 'ACTIVE'],
  ['SUSPENDED', 'Keskeytetty', 'SUSPENDED'],
  ['UNREGISTERED', 'Ei rekisteröity', 'UNREGISTERED'],
]) {
  language.setLanguage('fi'); assert.equal(run(`dataText('${status}')`), fi);
  language.setLanguage('en'); assert.equal(run(`dataText('${status}')`), en);
}
language.setLanguage('fi');

const navTitles = {
  fi: ['Yleiskuva', 'Tallennustila', 'Verkko', 'Palkkiot', 'Tapahtumat', 'Sopimusstudio'],
  en: ['Overview', 'Storage', 'Network', 'Rewards', 'Events', 'Contract Studio'],
};
const routeNames = ['overview', 'storage', 'network', 'rewards', 'events', 'contracts'];
const untranslated = {
  overview: ['Kaikki olennainen.', 'Ketjun korkeus', 'Epäonnistumisputki', 'Palvelimen voimavarat', 'Viimeisimmät tapahtumat'],
  storage: ['Tilaa verkon muistille.', 'Arkiston tämänhetkinen tilanne', 'Valmiit segmentit', 'Levyn toimintakunto', 'Peräkkäiset epäonnistumiset'],
  network: ['Verkon rytmi.', 'Verkon korkeus', 'Transaktioita sekunnissa', 'Ketjun eheys', 'Validaattorikomitea'],
  rewards: ['Lompakon kaikki palkkiot.', 'Lataa CSV', 'Maksettu kerätyllä ajalla', 'Euroarvostukset', 'Kerätyt maksut', 'Maksuhistorian lähteet'],
  events: ['Jäljet kertovat', 'Kaikki tapahtumat', 'Huomiot &amp; virheet', 'Mitä seuranta kertoo?', 'Lohkoero tarvitsee myös kontekstin.'],
  contracts: ['Paikallinen simulaatio', 'Sopimusstudio'],
};
const fiMarkup = new Map();
for (const lang of ['fi', 'en']) {
  language.setLanguage(lang);
  assert.equal(document.documentElement.lang, lang);
  const buttons = nodes.filter(node => node.dataset.language);
  assert.deepEqual(buttons.map(button => button.dataset.language).sort(), ['en', 'fi'], 'both language controls are present');
  for (const button of buttons) {
    assert.equal(button.tagName, 'BUTTON', 'language choice is keyboard-accessible');
    assert.equal(button.textContent.trim(), button.dataset.language === 'fi' ? 'FIN' : 'ENG');
    assert.equal(button.getAttribute('aria-pressed'), String(button.dataset.language === lang));
  }
  assert.equal(app.savedValues.get('nodus-observatory-language'), lang, 'preference is persisted');
  const titles = navTitles[lang];
  for (const [index, page] of routeNames.entries()) {
    context.location.hash = `#${page}`;
    run('render()');
    const markup = elements.get('#page-content').innerHTML;
    assert(markup.length > 500, `${lang}/${page} renders`);
    assert(!/undefined|NaN|Infinity/.test(markup), `${lang}/${page} has no invalid values`);
    assert.equal(elements.get('#breadcrumb-page').textContent, titles[index]);
    assert.equal(document.title, `${titles[index]} — Nodus Observatory`);
    if (lang === 'fi') fiMarkup.set(page, markup);
    else {
      assert.notEqual(markup, fiMarkup.get(page), `${page} translates its content, not only navigation`);
      for (const label of untranslated[page]) assert(!markup.includes(label), `${page}: fixed UI label is translated: ${label}`);
    }
  }
  context.location.hash = '#overview';
  run('render()');
  assert.match(elements.get('#source-label').textContent, lang === 'fi' ? /Synteettinen demo/ : /Synthetic demo/);
  assert.match(elements.get('#source-label').textContent, lang === 'fi' ? /ei palvelinmittauksia/ : /no server measurements/);
  assert.match(elements.get('#source-detail').textContent, lang === 'fi' ? /EI LIVE-DATAA/ : /NO LIVE DATA/);
  const shellText = nodes.filter(node => node.dataset.i18n).map(node => node.textContent).join('\n');
  assert.match(shellText, lang === 'fi' ? /Vain luku/ : /Read.only/);
  assert.match(shellText, lang === 'fi' ? /Tieto ensin/ : /Data first/);
  assert.equal(elements.get('#refresh').getAttribute('aria-label'), lang === 'fi' ? 'Päivitä tiedot' : 'Refresh data');
  assert.equal(elements.get('#menu').getAttribute('aria-label'), lang === 'fi' ? 'Avaa valikko' : 'Open menu');
  assert.equal(run('number(1234.5, 1)'), new Intl.NumberFormat(language.locale(), {
    maximumFractionDigits: 1, minimumFractionDigits: 1,
  }).format(1234.5));
  const moment = '2026-10-18T06:14:43Z';
  assert.equal(run(`dateTime('${moment}')`), new Intl.DateTimeFormat(language.locale(), {
    timeZone: 'Europe/Helsinki', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(moment)), 'dates keep Helsinki time and use the selected display locale');
}
assert.equal(language.t('Tarkistus: {height}', { height: 42 }), 'Check: 42', 'parameters are interpolated after translation');

// Switching through the actual header control updates the loaded view immediately
// without a data reload or resetting filters the user has already selected.
context.location.hash = '#events';
run("state.year=2027; state.eventFilter='warning'; state.hours=168; render()");
const snapshot = run('state.dashboard');
const fiButton = nodes.find(node => node.dataset.language === 'fi');
fiButton.click();
assert.equal(language.language(), 'fi');
assert.equal(document.title, 'Tapahtumat — Nodus Observatory');
assert.equal(run('state.year'), 2027);
assert.equal(run('state.eventFilter'), 'warning');
assert.equal(run('state.hours'), 168);
assert.equal(run('state.dashboard'), snapshot, 'language switching uses already collected data');

// Exact token decimals must not be rounded through Number during localization.
assert.equal(run("decimalFi('12345678901234567.89012345')").replace(/\s/g, ''), '12345678901234567,89012345');
language.setLanguage('en');
assert.equal(run("decimalFi('12345678901234567.89012345')").replace(/[\s,]/g, ''), '12345678901234567.89012345');
assert.equal(run("rawNodus('1234567890123456789012345')").replace(/[\s,]/g, ''), '12345678901234567.89012345');

// A failed CLI probe must remain unknown, even though the collector and
// services are running. Freshness does not imply a successful node query.
const healthyDashboard = run('JSON.stringify(state.dashboard)');
for (const lang of ['fi', 'en']) {
  language.setLanguage(lang);
  run(`state.mode='live'; state.dashboard=JSON.parse(${JSON.stringify(healthyDashboard)});
    state.dashboard.generated_at=new Date().toISOString();
    state.dashboard.freshness={available:true,stale:false};
    state.dashboard.chain={height:null,network_height:null,behind:null,sync_ok:null};
    state.dashboard.storage={registered:null,status:null,is_member:null,
      epoch_start:100,epoch_end:200};
    state.dashboard.quality={partial:true,errors:[
      {source:'nodus-status',message:'probe exited with code 1'},
      {source:'storage-status',message:'command timed out'}]};`);
  for (const registration of ['null', 'undefined']) {
    run(`state.dashboard.storage.registered=${registration}`);
    const card = run('graceCard()');
    assert.match(card, lang === 'fi' ? /Tila ei saatavilla/ : /Status unavailable/);
    assert(!card.includes(language.t('ei rekisteröity')), 'unknown is not unregistered');
    assert(!card.includes('✓'), 'unknown is not registered');
  }
  assert.match(run('syncPill()'), lang === 'fi' ? /Tila ei saatavilla/ : /Status unavailable/);
  const overviewMarkup = run('overview()');
  assert(!overviewMarkup.includes(language.t('Synkronoidaan')), 'unknown is not synchronizing');
  assert(!overviewMarkup.includes(language.t('Oma node jäljessä verkosta')), 'missing difference is not a known lag');
  const storageMarkup = run('storage()');
  assert.match(storageMarkup, lang === 'fi' ? /Epoch-jäsenyys ei saatavilla/ : /Epoch membership unavailable/);
  assert(!storageMarkup.includes(language.t('Ei epochin jäsen')), 'unknown membership is not negative');
  assert(!storageMarkup.includes(language.t('Oma node ei ole mukana')));
  assert.match(storageMarkup, /— %/, 'missing height cannot produce a zero epoch progress');
  assert.match(run('network()'), lang === 'fi' ? /Tila ei saatavilla/ : /Status unavailable/);
  for (const page of routeNames.filter(page => page !== 'contracts')) {
    context.location.hash = `#${page}`;
    run('render()');
    const markup = elements.get('#page-content').innerHTML;
    assert.match(markup, lang === 'fi' ? /Osa seurantatiedoista puuttuu/ : /Some monitoring data is unavailable/);
    assert.match(markup, /nodus-status/);
    assert.match(markup, lang === 'fi' ? /virhekoodiin 1/ : /exited with code 1/);
    assert.match(markup, lang === 'fi' ? /aikaraja ylittyi/ : /query timed out/);
    assert.match(markup, /nodus-cli/, 'show the CLI diagnostic hint on every monitoring route');
    assert.match(markup, /role="status"/, 'collection failures are announced accessibly');
  }
  assert.match(elements.get('#source-label').textContent, lang === 'fi' ? /OSITTAINEN TILANNE/ : /PARTIAL SNAPSHOT/);
  assert(!elements.get('#source-banner').classList.contains('live'), 'partial collection is not marked healthy');
  assert.match(elements.get('#source-detail').textContent, lang === 'fi' ? /OSITTAINEN MITTAUS/ : /PARTIAL COLLECTION/);

  run(`state.dashboard.quality={partial:false,errors:[
    {source:'<img src=x onerror=alert(1)>',message:'<script>alert(1)</script>'}]}`);
  const escapedNotice = run('collectionNotice()');
  assert(escapedNotice.includes('&lt;img'), 'diagnostic source is escaped');
  assert(escapedNotice.includes('&lt;script&gt;'), 'diagnostic message is escaped');
  assert(!escapedNotice.includes('<script>'));
  assert(run('collectionPartial()'), 'errors imply a partial result even if the flag is false');
  run('state.dashboard.quality={partial:true,errors:[]}');
  assert(run('collectionNotice()').length > 0, 'partial without details remains visible');

  run(`state.dashboard.storage={registered:false,status:'not_registered',is_member:false}`);
  assert(run('graceCard()').includes(language.t('ei rekisteröity')), 'known negative remains negative');
  assert(run('graceCard()').includes(language.t('Ketjutiedon mukaan tätä nodea ei ole rekisteröity storage-rooliin.')));
  assert(run('membershipPill()').includes(language.t('Ei epochin jäsen')));
  run(`state.dashboard.storage={registered:true,status:'ACTIVE',is_member:true};
    state.dashboard.chain={behind:17,sync_ok:true};`);
  assert(run('graceCard()').includes('✓'), 'known positive remains registered');
  assert(run('membershipPill()').includes(language.t('Epochin jäsen')));
  assert(run('syncPill()').includes(language.t('Synkronoidaan')), 'matching chain IDs do not prove catch-up');
  run('state.dashboard.chain.behind=0');
  assert(run('syncPill()').includes(language.t('Synkronissa')));

  run('state.dashboard.quality={partial:false,errors:[]}; sourceBanner()');
  assert.equal(run('collectionNotice()'), '', 'recovery removes the diagnostic notice');
  assert(elements.get('#source-banner').classList.contains('live'), 'successful fresh collection recovers');
  assert.match(elements.get('#source-label').textContent, lang === 'fi' ? /Paikallinen kerääjä/ : /Local collector/);
  run('delete state.dashboard.quality');
  assert.equal(run('collectionNotice()'), '', 'older snapshots without quality remain supported');
}
run(`state.dashboard=JSON.parse(${JSON.stringify(healthyDashboard)}); state.mode='snapshot';`);

// Earlier imported payments belong to the whole wallet and remain visible,
// including their monthly bars, while the storage role is still in grace.
run(`state.year=2026; state.dashboard.storage.in_grace=true;
  state.rewards={year:2026,network:'testnet',timezone:'Europe/Helsinki',
    source:{status:'ok',complete_year:false,from_height:0,at_height:1100,
      local:{status:'ok',from_height:800,at_height:1100,collected_at:'2026-01-15T12:00:00Z'},
      scan:{status:'ok',from_height:0,at_height:1000,last_attempt_at:'2026-01-15T11:00:00Z',
        last_success_at:'2026-01-15T11:00:00Z'},
      runs:[{source:'nodus_scan_addr_history',from_height:0,at_height:1000},
        {source:'local_nodus_addr_history',from_height:800,at_height:1100}]},
    summary:{payout_count:2,paid_nodus:'7.75000000',pending_nodus:'11.25000000',
      released_nodus:'100.00000000',eur_total:null,valued_count:0,unvalued_count:2},
    items:[{event_id:'historical',kind:'payout',height:300,source:'nodus_scan_addr_history',
      block_time_utc:'2026-01-10T00:00:00Z',amount_raw:'250000000',amount_nodus:'2.50000000',eur_value:null},
      {event_id:'local',kind:'payout',height:900,source:'local_nodus_addr_history',
      block_time_utc:'2026-01-15T00:00:00Z',amount_raw:'525000000',amount_nodus:'5.25000000',eur_value:null}],
    monthly:[{month:'2026-01',payout_count:2,paid_nodus:'7.75000000'}]};`);
for (const lang of ['fi', 'en']) {
  language.setLanguage(lang);
  const markup = run('rewards()');
  assert.match(markup, lang === 'fi' ? /Lompakon kaikki palkkiot/ : /All wallet rewards/);
  assert.match(markup, lang === 'fi' ? /staking-palkkiot voivat silti jatkua/i : /staking rewards can still continue/i);
  assert.match(markup, lang === 'fi' ? /Nodus Scan · tuotu historia/ : /Nodus Scan · imported history/);
  assert.match(markup, lang === 'fi' ? /Paikallinen indeksi/ : /Local index/);
  assert.match(markup, lang === 'fi' ? /Lohkot 800–1[\s,]?100/ : /Blocks 800–1,100/);
  assert.match(markup, lang === 'fi' ? /kryptografisesti varmennettu/ : /cryptographically verified/);
  assert.match(markup, lang === 'fi' ? /Viimeisin onnistunut haku/ : /Last successful fetch/);
  assert.match(markup, /reward-month-chart/, 'imported historical payouts form a graph during storage grace');
  assert.match(markup, lang === 'fi' ? /7,75/ : /7\.75/);
  assert.match(markup, lang === 'fi' ? /11,25/ : /11\.25/, 'pending remains separate from paid');
  assert.match(markup, lang === 'fi' ? /Puuttuu/ : /Missing/, 'unvalued EUR amounts remain unknown');
  assert(!/NO REWARD ACCRUAL|EI PALKKIOKERTYMÄÄ|Grace-jakso · ei kertymää/.test(markup));
}
run("state.rewards.source.status='unavailable'; state.rewards.source.local.status='error'; state.rewards.source.scan.status='error'");
language.setLanguage('en');
const outage = run('rewards()');
assert.match(outage, /Fetch failed/);
assert.match(outage, /Nodus Scan · imported history/);
assert.match(outage, /reward-month-chart/);
assert.match(outage, /7\.75/, 'an outage preserves stored amounts, rather than hiding them');
assert.match(outage, /Stored payments remain visible/);
for (const lang of ['fi', 'en']) {
  language.setLanguage(lang);
  assert.match(run('graceCard()'), lang === 'fi' ? /storage-palkkioita kerry/ : /no storage rewards/);
  assert.match(run('storage()'), lang === 'fi' ? /staking-palkkiot voivat jatkua/ : /continue earning staking rewards/);
}

// Monthly reward values, axes and interactions must refer to the selected
// month, rather than a root SVG title for January's empty column.
const rewardFixture = {
  year:2026,
  monthly:Array.from({length:12},(_,i)=>({month:`2026-${String(i+1).padStart(2,'0')}`,
    payout_count:i===9?3:0,paid_nodus:i===9?'1234.56789012':'0.00000000'})),
};
const previousRewards = run('JSON.stringify(state.rewards)');
for (const lang of ['fi','en']) {
  language.setLanguage(lang);
  run(`state.year=2026; state.rewardMonth=null; state.rewards=${JSON.stringify(rewardFixture)}`);
  const markup = run('rewardMonthlyChart(state.rewards,true,false)');
  assert.match(markup, /class="reward-axis-unit"[^>]*>NODUS/);
  const ticks = [...markup.matchAll(/class="reward-axis-label"[^>]*>([^<]+)<\/text>/g)].map(match=>decode(match[1]));
  assert.deepEqual(ticks,[0,500,1000,1500].map(value=>new Intl.NumberFormat(language.locale()).format(value)));
  const groups = [...markup.matchAll(/<g class="reward-month-bar"([^>]*)>([\s\S]*?)<\/g>/g)];
  assert.equal(groups.length,12);
  assert.equal((markup.match(/<title>/g)||[]).length,12,'one title per month');
  assert(!markup.slice(0,markup.indexOf('<g ')).includes('<title>'),'no root SVG title overriding month titles');
  const october = groups.find(group=>group[1].includes('data-month="2026-10"'));
  assert.match(october[2],new RegExp(lang==='fi'?'1[\\s]?234,56789012':'1,234\\.56789012'));
  assert(october[1].includes('aria-pressed="true"'),'last paid month is selected initially');
  assert.match(markup,lang==='fi'?/lokakuu 2026/:/October 2026/);
  assert.match(markup,/id="reward-chart-tooltip" role="status" aria-live="polite"/);
  assert.match(markup,lang==='fi'?/3 maksua/:/3 payments/);
  assert.match(markup,lang==='fi'?/1[\s]?234,57<\/text>/:/1,234.57<\/text>/,'a visible rounded value labels the bar');

  const bars = groups.map(group=>{
    const attrs={};
    for(const match of group[1].matchAll(/([\w-]+)="([^"]*)"/g))attrs[match[1]]=decode(match[2]);
    return createElement(attrs);
  });
  const originalQuery = document.querySelectorAll;
  document.querySelectorAll=selector=>selector==='.reward-month-bar'?bars:originalQuery(selector);
  run('bindPage()');
  const readout = document.querySelector('#reward-chart-tooltip');
  bars[9].onmouseenter();
  assert.equal(readout.textContent,bars[9].dataset.tooltip,'hover reads the actual October value');
  assert.equal(run('state.rewardMonth'),'2026-10');
  bars[0].onfocus();
  assert.equal(readout.textContent,bars[0].dataset.tooltip,'keyboard focus reads January');
  assert.equal(bars[0].getAttribute('aria-pressed'),'true');
  assert.equal(bars[9].getAttribute('aria-pressed'),'false');
  let prevented=false;
  bars[9].onkeydown({key:' ',preventDefault(){prevented=true;}});
  assert(prevented,'Space selects without scrolling');
  assert.equal(readout.textContent,bars[9].dataset.tooltip);
  bars[0].onclick();
  assert.equal(run('state.rewardMonth'),'2026-01','click/touch selection is retained');
  bars[9].onkeydown({key:'Enter',preventDefault(){}});
  assert.equal(run('state.rewardMonth'),'2026-10');
  language.setLanguage(lang==='fi'?'en':'fi');
  assert.match(run('rewardMonthlyChart(state.rewards,true,false)'),/data-month="2026-10"/);
  assert(run('rewardMonthlyChart(state.rewards,true,false)').includes('aria-pressed="true" data-month="2026-10"'),'language changes retain selection');
  document.querySelectorAll=originalQuery;
}
language.setLanguage('en');
for (const [amount,expectedTop] of [['0.00000001',1e-8],['0.00000007',8e-8],['0.12',.15],['7.24238585',8],['1234.56789012',1500],['1250000',1500000]]) {
  const scale=run(`rewardChartScale(${amount})`);
  assert(Math.abs(scale.top-expectedTop)<=expectedTop*1e-12,`axis adapts to ${amount}`);
  assert(scale.top>=Number(amount));
  run(`state.rewards={monthly:[{month:'2026-10',payout_count:1,paid_nodus:'${amount}'}]}; state.rewardMonth=null`);
  const markup=run('rewardMonthlyChart(state.rewards,true,false)');
  assert(!/NaN|Infinity/.test(markup));
  assert(markup.includes(`${run(`decimalFi('${amount}')`)} NODUS`),'tooltip retains every token decimal');
  assert(!markup.includes('January 2026: 0 NODUS'),'a missing month is unavailable, not invented zero');
  assert.match(markup,/amount unavailable/);
}
run(`state.rewards={monthly:[{month:'2026-10',payout_count:1,paid_nodus:'12345678901234567.89012345'}]}`);
assert(run('rewardMonthlyChart(state.rewards,true,false)').includes('12,345,678,901,234,567.89012345 NODUS'),'large exact values bypass floating-point tooltip formatting');
assert(!/NaN|Infinity/.test(run('rewardMonthlyChart(state.rewards,true,false)')));
assert(!run('rewardMonthlyChart(state.rewards,false,true)').includes('reward-month-chart'),'wrong-year data produces no bars');
assert(!run('rewardMonthlyChart({monthly:[]},true,true)').includes('reward-month-chart'),'missing source produces no invented rewards');
run(`state.rewards=JSON.parse(${JSON.stringify(previousRewards)}); state.rewardMonth=null`);

// Daily charts use the same collected wallet payouts, preserving exact raw
// amounts and Helsinki calendar days independently of browser display locale.
const dailyRewardFixture = {
  year:2026, timezone:'Europe/Helsinki', source:{status:'partial',complete_year:false},
  items:[
    {kind:'payout',block_time_utc:'2026-10-17T21:30:00Z',amount_raw:'10000000'},
    {kind:'payout',block_time_local:'2026-10-18T00:05:00+03:00',amount_raw:'20000000'},
    {kind:'payout',block_time_utc:'2026-10-19T09:00:00Z',amount_raw:'1234567890123456789012345'},
    {kind:'payout',block_time_utc:'2026-10-20T09:00:00Z',amount_raw:'1'},
    // A principal release can never become earned income, even if a source
    // incorrectly includes it in items rather than the separate release list.
    {kind:'release',block_time_utc:'2026-10-17T21:30:00Z',amount_raw:'90000000000'},
  ],
  releases:[{kind:'release',block_time_utc:'2026-10-17T21:30:00Z',amount_raw:'80000000000'}],
  summary:{payout_count:4,pending_nodus:'99.00000000'},
};
const dailyRows = (fixture,month='2026-10',matches=true) => JSON.parse(run(
  `JSON.stringify(rewardDailyRows(${JSON.stringify(fixture)},${matches},${JSON.stringify(month)}))`));
for (const lang of ['fi','en']) {
  language.setLanguage(lang);
  run('state.year=2026');
  const rows=dailyRows(dailyRewardFixture);
  assert.equal(rows.length,31,'daily view includes each real calendar day in the selected month');
  assert.deepEqual(rows.find(row=>row.day==='2026-10-18'),
    {day:'2026-10-18',paid_nodus:'0.30000000',payout_count:2},'same-day payments sum exactly, excluding release and pending amounts');
  assert.equal(rows.find(row=>row.day==='2026-10-19').paid_nodus,'12345678901234567.89012345','huge token totals stay exact');
  assert.equal(rows.find(row=>row.day==='2026-10-20').paid_nodus,'0.00000001','smallest raw unit remains visible');
  assert.deepEqual(rows.find(row=>row.day==='2026-10-17'),
    {day:'2026-10-17',paid_nodus:'0.00000000',payout_count:0},'UTC previous-day payments belong to their Helsinki day');
  const january=dailyRows(dailyRewardFixture,'2026-01');
  assert(january.every(row=>row.paid_nodus==='0.00000000'&&row.payout_count===0),
    'another month can show collected-data zeros while retaining the partial-history warning');
}

const dayBoundaryFixture={year:2026,items:[
  {kind:'payout',block_time_utc:'2025-12-31T22:30:00Z',amount_raw:'1'},
  {kind:'payout',block_time_utc:'2026-03-29T00:30:00Z',amount_raw:'2'},
  {kind:'payout',block_time_utc:'2026-03-29T01:30:00Z',amount_raw:'3'},
  {kind:'payout',block_time_utc:'2026-10-25T00:30:00Z',amount_raw:'4'},
  {kind:'payout',block_time_utc:'2026-10-25T01:30:00Z',amount_raw:'5'},
  {kind:'payout',block_time_utc:'2026-12-31T22:30:00Z',amount_raw:'90000000'},
]};
assert.equal(dailyRows(dayBoundaryFixture,'2026-01')[0].paid_nodus,'0.00000001','Helsinki new year includes a previous-UTC-year payment');
assert.equal(dailyRows(dayBoundaryFixture,'2026-03').find(row=>row.day==='2026-03-29').paid_nodus,'0.00000005','spring DST transition uses Helsinki calendar day');
assert.equal(dailyRows(dayBoundaryFixture).find(row=>row.day==='2026-10-25').paid_nodus,'0.00000009','repeated autumn hour is not dropped or duplicated');
assert(dailyRows(dayBoundaryFixture,'2026-12').every(row=>row.paid_nodus==='0.00000000'),'a payment already in Helsinki next year is excluded');
run('state.year=2028');
const leapRows=dailyRows({year:2028,items:[{kind:'payout',block_time_utc:'2028-02-29T10:00:00Z',amount_raw:'7'}]},'2028-02');
assert.equal(leapRows.length,29,'leap February includes exactly 29 days');
assert.deepEqual(leapRows.at(-1),{day:'2028-02-29',paid_nodus:'0.00000007',payout_count:1});
run('state.year=2026');
assert.equal(dailyRows(dailyRewardFixture,'2026-10',false),null,'wrong report year cannot leak into daily bars');
for (const fixture of [
  {}, {items:[]}, {items:[{kind:'release',amount_raw:'10'}]},
  {monthly:[{month:'2026-10',payout_count:2,paid_nodus:'5.00000000'}]},
  {items:[{kind:'payout',block_time_utc:'2027-01-01T00:00:00Z',amount_raw:'1'}]},
  {items:[{kind:'payout',block_time_utc:'not-a-date',amount_raw:'1'}]},
  {items:[{kind:'payout',block_time_utc:'2026-10-18T12:00:00',amount_raw:'1'}]},
  {items:[{kind:'payout',block_time_utc:'2026-10-18T12:00:00Z',amount_raw:'0.1'}]},
  {items:[{kind:'payout',block_time_utc:'2026-10-18T12:00:00Z',amount_raw:'-1'}]},
  {items:[{kind:'payout',block_time_utc:'2026-10-18T12:00:00Z'}]},
]) assert.equal(dailyRows(fixture),null,'missing or malformed dated payouts never invent daily zero income');
const incompleteDay={...dailyRewardFixture,items:[...dailyRewardFixture.items,
  {kind:'payout',block_time_utc:'2026-10-18T12:00:00Z',amount_raw:'broken'}]};
assert.equal(dailyRows(incompleteDay),null,'a malformed payout cannot silently understate a daily total');

for (const lang of ['fi','en']) {
  language.setLanguage(lang);
  run(`state.year=2026; state.rewards=${JSON.stringify(dailyRewardFixture)};
    state.rewardPeriod='daily';state.rewardDailyMonth='2026-10';state.rewardDay='2026-10-18'`);
  const markup=run('rewardDailyChart(state.rewards,true,false)');
  assert.match(markup,/class="reward-axis-unit"[^>]*>NODUS/);
  assert.match(markup,/class="reward-axis-label"/,'daily chart retains an automatically scaled value axis');
  assert(!/NaN|Infinity/.test(markup));
  const groups=[...markup.matchAll(/<g class="reward-month-bar"([^>]*)>([\s\S]*?)<\/g>/g)];
  assert.equal(groups.length,31,'one interactive bar per October day');
  assert.equal(groups.filter(group=>group[1].includes('aria-pressed="true"')).length,1,
    'exactly one day is selected, rather than every bar in the same month');
  const selected=groups.find(group=>group[1].includes('data-day="2026-10-18"'));
  assert(selected&&selected[1].includes('aria-pressed="true"'),'selected day is retained in chart state');
  assert(selected[1].includes('data-month="2026-10"'),'day controls retain their selected month');
  assert(selected[2].includes(`${run("decimalFi('0.30000000')")} NODUS`),'daily tooltip uses an exact localized sum');
  assert(selected[2].includes(new Intl.DateTimeFormat(language.locale(),{
    day:'numeric',month:'long',year:'numeric',timeZone:'UTC',
  }).format(new Date('2026-10-18T00:00:00Z'))),'daily tooltip localizes its calendar date');
  assert(markup.includes(`${run("decimalFi('0.00000001')")} NODUS`),'tiny daily payout never becomes zero in the readout');
  assert(markup.includes(`${run("decimalFi('12345678901234567.89012345')")} NODUS`),'large daily payout stays exact in readout');
  assert.match(markup,/id="reward-chart-tooltip" role="status" aria-live="polite"/);

  const bars=groups.map(group=>{
    const attrs={};
    for(const match of group[1].matchAll(/([\w-]+)="([^"]*)"/g))attrs[match[1]]=decode(match[2]);
    return createElement(attrs);
  });
  const periodButtons=['monthly','daily'].map(period=>createElement({'data-reward-period':period}));
  const originalQuery=document.querySelectorAll;
  document.querySelectorAll=selector=>selector==='.reward-month-bar'?bars:
    selector==='[data-reward-period]'?periodButtons:originalQuery(selector);
  run('bindPage()');
  const readout=document.querySelector('#reward-chart-tooltip');
  bars[19].onfocus();
  assert.equal(run('state.rewardDay'),'2026-10-20','keyboard focus selects the actual day');
  assert.equal(readout.textContent,bars[19].dataset.tooltip);
  bars[17].onclick();
  assert.equal(run('state.rewardDay'),'2026-10-18','click or touch selects the day');
  let prevented=false;
  bars[18].onkeydown({key:' ',preventDefault(){prevented=true;}});
  assert(prevented,'daily keyboard selection does not scroll the page');
  assert.equal(run('state.rewardDay'),'2026-10-19');
  language.setLanguage(lang==='fi'?'en':'fi');
  assert(run('rewardDailyChart(state.rewards,true,false)').includes('aria-pressed="true" data-month="2026-10" data-day="2026-10-19"'),
    'changing language keeps the selected day');
  assert.equal(run('state.rewardPeriod'),'daily','changing language keeps daily mode');
  language.setLanguage(lang);

  const savedItems=run('JSON.stringify(state.rewards.items)');
  periodButtons[0].onclick();
  assert.equal(run('state.rewardPeriod'),'monthly','period selector changes to monthly');
  periodButtons[1].onclick();
  assert.equal(run('state.rewardPeriod'),'daily','period selector changes back to daily');
  assert.equal(run('JSON.stringify(state.rewards.items)'),savedItems,'view changes never mutate underlying accounting rows');
  const monthSelect=document.querySelector('#reward-chart-month');
  monthSelect.value='2026-02';
  monthSelect.onchange();
  assert.equal(run('state.rewardDailyMonth'),'2026-02','daily month selector changes the displayed calendar month');
  assert.equal((run('rewardDailyChart(state.rewards,true,false)').match(/data-day="/g)||[]).length,28);
  document.querySelectorAll=originalQuery;
}
run(`state.rewards=${JSON.stringify(dailyRewardFixture)};state.rewardDailyMonth='2026-10';state.rewardDay=null;
  state.rewards.source.status='unavailable'`);
assert.equal((run('rewardDailyChart(state.rewards,true,false)').match(/data-day="/g)||[]).length,31,
  'a temporary source outage preserves collected daily payments');
assert(!run("rewardDailyChart({monthly:[{month:'2026-10',payout_count:1,paid_nodus:'9.00000000'}]},true,false)").includes('data-day="'),
  'monthly totals without dated items do not become invented daily payouts');
const savedRewardSnapshot=run('JSON.stringify(state.rewardsSnapshot)');
run('state.mode="snapshot";state.rewardsSnapshot=null;state.rewardDailyMonth="2026-10";state.rewardDay="2026-10-19";bindPage()');
elements.get('#reward-year').value='2027';
await elements.get('#reward-year').onchange();
assert.equal(run('state.rewardDailyMonth'),null,'changing tax year clears the previous calendar month');
assert.equal(run('state.rewardDay'),null,'changing tax year clears the selected day');
assert.match(run('rewardSelectedMonth(state.rewards,true)'),/^2027-\d\d$/,'daily month resolves within the new tax year');
assert(!run('rewardDailyChart(state.rewards,true,true)').includes('data-day="'),'previous-year payouts do not remain in daily bars');
run(`state.year=2026;state.rewardsSnapshot=JSON.parse(${JSON.stringify(savedRewardSnapshot)})`);
run(`state.rewards=JSON.parse(${JSON.stringify(previousRewards)});state.rewardPeriod='monthly';state.rewardDailyMonth=null;state.rewardDay=null`);

// CSV is a stable accounting interchange format in either display language.
run(`state.mode='snapshot'; state.rewards={year:2027,network:'testnet',timezone:'Europe/Helsinki',
  source:{status:'partial',runs:[]},items:[{event_id:'receipt-1',kind:'payout',height:123,
    amount_raw:'1234567890123456789012345',amount_nodus:'12345678901234567.89012345',eur_value:null}]};`);
const exports = [];
for (const lang of ['fi', 'en']) {
  language.setLanguage(lang);
  await run('exportRewards()');
  exports.push(await app.downloads.at(-1).text());
}
assert.equal(exports[0], exports[1], 'language switching cannot alter accounting rows or source metadata');
assert(exports[1].startsWith('"event_id","network","chain_id"'));
assert(exports[1].includes('"12345678901234567.89012345"'));
assert(exports[1].includes('"1234567890123456789012345"'));

// Preserve diagnostic details verbatim while translating application-owned errors.
run("state.dashboard.services=[{name:'nodus-core',active:null,enabled:null}]");
assert.match(run('servicesPanel()'), /Unknown|No data|Not available/);
run("state.mode='live'");
context.fetch = async () => ({ ok: false });
await run('exportRewards()');
assert.match(elements.get('#toast').textContent, /CSV export failed/i);
await run('loadData(true)');
assert.match(elements.get('#page-content').innerHTML, /could not|unable to|failed to/i);
assert(!elements.get('#page-content').innerHTML.includes('Seurantatietoja ei voitu ladata.'));
assert(elements.get('#page-content').innerHTML.includes('snapshot.json'), 'failed source filename is preserved as diagnostic detail');
language.setLanguage('fi');
assert(elements.get('#page-content').innerHTML.includes('Seurantatietoja ei voitu ladata.'));
assert.match(elements.get('#toast').textContent, /CSV-vienti epäonnistui/, 'visible notification switches language too');
language.setLanguage('en');
assert.match(elements.get('#page-content').innerHTML, /Monitoring data could not be loaded/,
  'language switching preserves and translates the current failure state');

// A remembered choice survives a new page load, and unusable localStorage never
// prevents the dashboard from loading or changing languages.
for (const saved of ['fi', 'en']) {
  const restored = await boot({ saved });
  assert.equal(restored.context.NodusI18n.language(), saved);
  assert.equal(restored.document.documentElement.lang, saved);
  assert(restored.elements.get('#page-content').innerHTML.length > 500);
}
const invalid = await boot({ saved: 'xx' });
assert.equal(invalid.context.NodusI18n.language(), 'fi');
invalid.context.NodusI18n.setLanguage('xx');
assert.equal(invalid.context.NodusI18n.language(), 'fi', 'unsupported choice is ignored safely');
const blocked = await boot({ storageThrows: true });
assert.equal(blocked.context.NodusI18n.language(), 'fi');
blocked.context.NodusI18n.setLanguage('en');
assert.equal(blocked.context.NodusI18n.language(), 'en');
assert.match(blocked.elements.get('#breadcrumb-page').textContent, /Overview/);

console.log('Frontend i18n: FIN/ENG shell and 6 routes, persistence, unavailable storage, locale precision, retained view state and errors PASS.');
