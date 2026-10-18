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
const scripts = ['i18n.js', 'app-translations.js', 'app.js'];
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
    querySelectorAll() { return []; }, appendChild() {}, remove() {},
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
  for (const script of scripts.slice(0, withApp ? 3 : 2)) {
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
  fi: ['Yleiskuva', 'Tallennustila', 'Verkko', 'Palkkiot', 'Tapahtumat'],
  en: ['Overview', 'Storage', 'Network', 'Rewards', 'Events'],
};
const routeNames = ['overview', 'storage', 'network', 'rewards', 'events'];
const untranslated = {
  overview: ['Kaikki olennainen.', 'Ketjun korkeus', 'Epäonnistumisputki', 'Palvelimen voimavarat', 'Viimeisimmät tapahtumat'],
  storage: ['Tilaa verkon muistille.', 'Arkiston tämänhetkinen tilanne', 'Valmiit segmentit', 'Levyn toimintakunto', 'Peräkkäiset epäonnistumiset'],
  network: ['Verkon rytmi.', 'Verkon korkeus', 'Transaktioita sekunnissa', 'Ketjun eheys', 'Validaattorikomitea'],
  rewards: ['Lompakon kaikki palkkiot.', 'Lataa CSV', 'Maksettu kerätyllä ajalla', 'Euroarvostukset', 'Kerätyt maksut', 'Maksuhistorian lähteet'],
  events: ['Jäljet kertovat', 'Kaikki tapahtumat', 'Huomiot &amp; virheet', 'Mitä seuranta kertoo?', 'Lohkoero tarvitsee myös kontekstin.'],
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

console.log('Frontend i18n: FIN/ENG shell and 5 routes, persistence, unavailable storage, locale precision, retained view state and errors PASS.');
