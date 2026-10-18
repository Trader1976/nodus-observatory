'use strict';

// Source strings are Finnish. Keep translations separate from measured data.
// This module is deliberately dependency-free and also works without storage.
window.NodusI18n = (() => {
  const storageKey = 'nodus-observatory-language';
  const messages = Object.create(null);
  let current = 'fi';
  try {
    const saved = window.localStorage.getItem(storageKey);
    if (saved === 'fi' || saved === 'en') current = saved;
  } catch { /* A private browser may disallow persistent storage. */ }

  function t(source, params = {}) {
    const text = current === 'en' && Object.hasOwn(messages, source) ? messages[source] : source;
    return String(text).replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g,
      (match, key) => Object.hasOwn(params, key) ? String(params[key]) : match);
  }

  function applyDocument(root = document) {
    document.documentElement.lang = current;
    root.querySelectorAll('[data-i18n]').forEach(el => {
      el.textContent = t(el.dataset.i18n);
    });
    for (const attribute of ['aria-label', 'title']) {
      root.querySelectorAll(`[data-i18n-${attribute}]`).forEach(el => {
        el.setAttribute(attribute, t(el.getAttribute(`data-i18n-${attribute}`)));
      });
    }
    root.querySelectorAll('[data-language]').forEach(el => {
      el.setAttribute('aria-pressed', String(el.dataset.language === current));
    });
  }

  function setLanguage(next) {
    if (next !== 'fi' && next !== 'en') return;
    const changed = next !== current;
    current = next;
    try { window.localStorage.setItem(storageKey, current); } catch { /* Still switch this session. */ }
    applyDocument();
    if (changed) window.dispatchEvent(new Event('languagechange'));
  }

  Object.assign(messages, {
    'Siirry sisältöön': 'Skip to content',
    'Päävalikko': 'Main navigation',
    'Nodus Observatory, yleiskuva': 'Nodus Observatory, overview',
    'OMA PALVELIN': 'MY SERVER',
    'Oma node': 'My node',
    'Storage node': 'Storage node',
    'Yleiskuva': 'Overview',
    'Tallennustila': 'Storage',
    'Verkko': 'Network',
    'Palkkiot': 'Rewards',
    'Tapahtumat': 'Events',
    'Yksi näkymä.': 'One view.',
    'Koko noden tilanne.': 'Your whole node.',
    'Tietoa seurannasta': 'About this monitor',
    'Avaa valikko': 'Open menu',
    'Vain luku': 'Read only',
    'Päivitä tiedot': 'Refresh data',
    'Kielivalinta': 'Language',
    'Haetaan seurannan tietoja…': 'Loading monitoring data…',
    'Mittaukset ja ketjutiedot lähteineen.': 'Measurements and chain data, with sources.',
    'Miten tiedot kerätään?': 'How is the data collected?',
    'Sulje': 'Close',
    'LÄHTEET & LUOTETTAVUUS': 'SOURCES & RELIABILITY',
    'Tieto ensin. Tulkinta sen jälkeen.': 'Data first. Interpretation follows.',
    'Paikallinen kerääjä lukee Nodus CLI:n tilan, palveluiden tiedot ja palvelimen mittarit. Selain näyttää kerätyt tulokset. Sivulta ei hallita nodea eikä käsitellä lompakon yksityisiä avaimia.': 'A local collector reads the Nodus CLI status, service information and server metrics. Your browser displays the collected results. This page does not control the node or handle private wallet keys.',
    'Demossa näkyvät synteettiset esimerkit, eivät oikean palvelimen mittaukset. Tuotantokäytön historiakuvaajat yhdistävät vain tallennetut havaintopisteet. Puuttuva mittaus näkyy puuttuvana tietona.': 'The demo shows synthetic examples, not measurements from a real server. In live monitoring, history charts connect only recorded observations. Missing measurements remain missing.',
    'Palkkioiden euroarvot perustuvat erikseen kirjattuihin arvostuksiin. Puuttuvaa hintaa ei korvata nollalla. CSV on yhteenveto omaa kirjanpitoa varten.': 'Reward values in euros are based on separately recorded valuations. A missing price is never replaced with zero. The CSV provides a summary for your own accounting.',
    'Selvä': 'Got it',
  });

  const api = {
    t,
    locale: () => current === 'en' ? 'en-GB' : 'fi-FI',
    language: () => current,
    addMessages: values => Object.assign(messages, values),
    applyDocument,
    setLanguage,
  };
  applyDocument();
  document.querySelectorAll('[data-language]').forEach(button => {
    button.addEventListener('click', () => setLanguage(button.dataset.language));
  });
  return api;
})();
// Classic scripts share this alias; keeping it explicit also supports test VMs.
const NodusI18n = window.NodusI18n;
