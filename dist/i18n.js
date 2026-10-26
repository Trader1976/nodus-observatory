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
    'Sopimusstudio': 'Contract Studio',
    'Escrow-esimerkki': 'Escrow example',
    'Visuaalinen sopimuseditori': 'Visual contract editor',
    'Selaimessa toimiva sopimuseditori': 'Browser-local contract editor',
    'Asiakirjan tiiviste selaimessa, rekisteritieto omalta nodelta': 'File hash in your browser, registry data from your node',
    'LEIMAUS LOMPAKOSSA · TARKISTUS VAIN LUKU': 'RECORD IN WALLET · READ-ONLY LOOKUP',
    'KOKEILU': 'LAB',
    'Test DeFi': 'Test DeFi',
    'Test DeFi · lainamarkkinan harjoittelu': 'Test DeFi · lending market rehearsal',
    'PAIKALLINEN SIMULAATIO · EI KETJUTAPAHTUMIA': 'LOCAL SIMULATION · NO CHAIN TRANSACTIONS',
    'Test DeFi -tiedostot puuttuvat. Päivitä asennus.': 'Test DeFi assets are missing. Update the installation.',
    'Selaimessa toimiva escrow-prototyyppi': 'Browser-local escrow prototype',
    'PAIKALLINEN LUONNOS · EI KETJUKUTSUJA': 'LOCAL DRAFT · NO CHAIN CALLS',
    'Sopimusstudion tiedostot puuttuvat. Päivitä sivu tai asennus.': 'Contract Studio assets are missing. Reload the page or update the installation.',
    'Yksi näkymä.': 'One view.',
    'Koko noden tilanne.': 'Your whole node.',
    'Tietoa projektista': 'About the project',
    'Avaa valikko': 'Open menu',
    'Vain luku': 'Read only',
    'Päivitä tiedot': 'Refresh data',
    'Kielivalinta': 'Language',
    'Haetaan seurannan tietoja…': 'Loading monitoring data…',
    'Mittaukset ja ketjutiedot lähteineen.': 'Measurements and chain data, with sources.',
    'Sulje': 'Close',
    'YHTEISÖN RAKENTAMA': 'COMMUNITY BUILT',
    'Tieto ensin. Tulkinta sen jälkeen.': 'Data first. Interpretation follows.',
    "Yksityisyys on oikeus. Sananvapaus tarvitsee tilaa hengittää. Ja jokaisella on oltava reilu mahdollisuus osallistua rakentamiimme verkkoihin.": "Privacy is a right. Free speech deserves room to breathe. And everyone deserves a fair chance to participate in the networks we build.",
    "Nodus Observatory on yhteisöprojekti ihmisille, jotka kyseenalaistavat oletukset, pyörittävät omaa infrastruktuuriaan ja haluavat pitää digitaalisen elämänsä ohjat omissa käsissään.": "Nodus Observatory is a community project for people who question the defaults, run their own infrastructure and believe that control over their digital lives belongs in their own hands.",
    "Seuraa nodeasi. Pysy ketjun mukana. Tarkkaile tallennustilaa, verkon kuntoa ja palkkioita. Paikalliset havainnot muuttuvat selkeiksi graafeiksi, hyödylliseksi historiaksi ja ladattaviksi raporteiksi. Yksityisiin avaimiisi ei kosketa.": "Watch your node. Follow the chain. Track storage, network health and rewards. Turn local observations into clear graphs, useful history and exportable records. Your private keys stay out of it.",
    "Rakennettu uteliaisuudesta, pienestä jääräpäisyydestä ja terveestä epäluulosta lausetta ”luota nyt vain meihin” kohtaan.": "Built with curiosity, a little stubbornness and a healthy distrust of “just trust us.”",
    "Pyöritä omaa nodeasi. Lue dataa. Ajattele itse.": "Run your node. Read the data. Think for yourself.",
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
