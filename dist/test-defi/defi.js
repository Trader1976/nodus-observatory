/* Test DeFi workbench. Only the pure model changes: no wallet, RPC or keys.
 * Drafts may be shared as JSON. Simulated funding and repayment never leave
 * memory and are deliberately not exported as evidence of on-chain activity.
 */
(() => {
  'use strict';
  const messages = {
    'LOCAL SIMULATION':'PAIKALLINEN SIMULAATIO',
    'Local simulation · no chain transactions':'Paikallinen simulaatio · ei ketjutapahtumia',
    'Lend tUSDT. Borrow against NODUS.':'Lainaa tUSDT:tä NODUS-vakuudella.',
    'Explore fixed-rate offers and rehearse a loan from funding to repayment.':'Kokeile kiinteäkorkoisia tarjouksia ja käy laina läpi rahoituksesta takaisinmaksuun.',
    'All amounts below are simulated. Your wallet and its tUSDT balance are not connected.':'Kaikki alla olevat summat ovat simuloituja. Lompakkoasi ja sen tUSDT-saldoa ei ole yhdistetty.',
    'Simulated amounts':'Simulaation määrät','Available to borrow':'Tarjolla lainattavaksi','Active test loans':'Aktiiviset testilainat','NODUS locked':'NODUS-vakuutta lukittu',
    'Credit score':'Luottopisteet','Planned':'Tulossa','Not used in this version':'Ei käytössä tässä versiossa',
    'Loan offers':'Lainatarjoukset','My test loans':'Omat testilainat','Create an offer':'Luo tarjous',
    'Session only':'Vain tässä istunnossa','Drafts and simulations disappear when this page is reloaded. Export drafts to keep their terms.':'Luonnokset ja simulaatiot katoavat, kun sivu ladataan uudelleen. Vie luonnokset, jos haluat säilyttää niiden ehdot.',
    'Load example offers':'Lataa esimerkkitarjoukset','Export offer drafts':'Vie tarjousluonnokset','Import drafts':'Tuo luonnokset',
    'No offers yet':'Ei vielä tarjouksia','Load the 8% and 10% examples or create your own simulated offer.':'Lataa 8 %:n ja 10 %:n esimerkit tai luo oma simuloitu tarjous.',
    'Annual interest':'Vuosikorko','Principal':'Lainapääoma','Collateral':'Vakuus','Term':'Laina-aika','Grace period':'Lisäaika','days':'päivää',
    'Fixed for the term':'Kiinteä koko laina-ajalle','Interest for the full term':'Koko laina-ajan korko','Total repayment':'Takaisinmaksettava yhteensä',
    'View offer':'Katso tarjous','View loan':'Katso laina','Selected':'Valittu','Simulated offer':'Simuloitu tarjous',
    'Open':'Avoin','Active':'Aktiivinen','Repaid':'Maksettu','Cancelled':'Peruttu','Defaulted':'Vakuus lunastettu','Expired':'Vanhentunut',
    'Offer details':'Tarjouksen tiedot','Loan details':'Lainan tiedot','Choose an offer to inspect its terms.':'Valitse tarjous nähdäksesi sen ehdot.',
    'This offer is accepted in full by one borrower.':'Yksi lainaaja hyväksyy tarjouksen kokonaisuudessaan.',
    'The full fixed-term interest is due even if you repay early.':'Koko sovitun laina-ajan korko maksetaan myös ennenaikaisessa takaisinmaksussa.',
    'Collateral is a fixed NODUS amount. There is no price feed or price-based liquidation in this version.':'Vakuus on kiinteä NODUS-määrä. Hintasyötettä tai hintaan perustuvaa likvidointia ei ole tässä versiossa.',
    'If the loan remains unpaid at the end of the grace period, the lender can claim the entire collateral. This can exceed the debt value.':'Jos laina on maksamatta lisäajan päättyessä, rahoittaja voi lunastaa koko vakuuden. Sen arvo voi ylittää velan määrän.',
    'Simulate borrowing':'Simuloi lainanotto','Simulate cancellation':'Simuloi peruutus','Simulate repayment':'Simuloi takaisinmaksu','Simulate collateral claim':'Simuloi vakuuden lunastus',
    'Advance to due date':'Siirry eräpäivään','Advance to grace deadline':'Siirry lisäajan loppuun','Reset this simulation':'Aloita tämä simulaatio alusta',
    'Simulated time':'Simuloitu aika','Offer expires':'Tarjous vanhenee','Loan accepted':'Laina otettu','Due date':'Eräpäivä','Grace deadline':'Lisäaika päättyy',
    'Repayment is possible before the grace deadline. At that deadline it closes and the collateral claim opens.':'Takaisinmaksu onnistuu ennen lisäajan päättymistä. Rajalla takaisinmaksu sulkeutuu ja vakuuden lunastus avautuu.',
    'Collateral returned to borrower':'Vakuus palautettu lainaajalle','Principal and interest returned to lender':'Pääoma ja korko maksettu rahoittajalle',
    'Unused funding returned to lender':'Käyttämätön rahoitus palautettu rahoittajalle','Collateral transferred to lender':'Vakuus siirretty rahoittajalle',
    'No active test loans':'Ei aktiivisia testilainoja','Take a simulated loan from the offers to try repayment and the overdue path.':'Ota simuloitu laina tarjouksista kokeillaksesi takaisinmaksua ja maksamatta jäävää lainaa.',
    'Name':'Nimi','Example: 30-day loan':'Esimerkiksi: 30 päivän laina','Amount to lend (tUSDT)':'Lainattava määrä (tUSDT)','Required collateral (NODUS)':'Vaadittu vakuus (NODUS)',
    'Annual interest (%)':'Vuosikorko (%)','Term (days)':'Laina-aika (päivää)','Grace period (days)':'Lisäaika (päivää)',
    'Use a decimal point. tUSDT has 6 decimals and NODUS has 8.':'Käytä desimaalipistettä. tUSDT:n tarkkuus on 6 ja NODUSin 8 desimaalia.',
    'Create a simulated funded offer':'Luo simuloitu rahoitettu tarjous',
    'Offers remain open for 7 simulated days. Principal is reserved when the offer is created.':'Tarjous on avoin 7 simuloitua päivää. Pääoma varataan tarjouksen luomisen yhteydessä.',
    'No price valuation is implied by the collateral amount. Network fees are outside this simulation.':'Vakuuden määrä ei sisällä hinta-arviota. Verkkokulut eivät sisälly simulaatioon.',
    'Next building blocks':'Seuraavat peruspalikat','Wallet execution':'Tapahtumat lompakossa','Shared offer book':'Yhteinen tarjouskirja','Verified credit history':'Todennettava maksuhistoria','Connect reminders':'Connect-muistutukset',
    'Examples loaded. These are simulated offers.':'Esimerkit ladattu. Tarjoukset ovat simuloituja.',
    'Simulated offer created. No funds were transferred.':'Simuloitu tarjous luotu. Varoja ei siirretty.',
    'Loan simulated. No funds were transferred.':'Laina simuloitu. Varoja ei siirretty.',
    'Repayment simulated.':'Takaisinmaksu simuloitu.','Cancellation simulated.':'Peruutus simuloitu.','Collateral claim simulated.':'Vakuuden lunastus simuloitu.',
    'Simulation time advanced.':'Simulaation aikaa siirretty.','Simulation reset.':'Simulaatio aloitettu alusta.',
    'Drafts imported. Imported files do not prove funding.':'Luonnokset tuotu. Tuodut tiedostot eivät todista rahoitusta.',
    'Drafts exported. Funding and loan states are not included.':'Luonnokset viety. Rahoitus ja lainojen tilat eivät sisälly tiedostoon.',
    'Check the amounts and terms. The action could not be completed.':'Tarkista määrät ja ehdot. Toimintoa ei voitu suorittaa.',
    'Give the offer a name (1–80 characters).':'Anna tarjoukselle nimi (1–80 merkkiä).',
    'Annual interest must be 0.01–50%.':'Vuosikoron pitää olla 0.01–50 %.',
    'The term must be 1–365 whole days.':'Laina-ajan pitää olla 1–365 kokonaista päivää.',
    'The grace period must be 1–30 whole days.':'Lisäajan pitää olla 1–30 kokonaista päivää.',
    'The offer list is full (50).':'Tarjouslista on täynnä (50).','The imported draft conflicts with an existing offer.':'Tuotu luonnos on ristiriidassa olemassa olevan tarjouksen kanssa.',
    'The file is too large or invalid. No drafts were imported.':'Tiedosto on liian suuri tai virheellinen. Luonnoksia ei tuotu.',
    'A download could not be created.':'Tiedostoa ei voitu ladata.','Simulation history':'Simulaation tapahtumat',
    'Funding reserved':'Rahoitus varattu','Borrowed':'Laina otettu','Repaid in full':'Laina maksettu','Offer cancelled':'Tarjous peruttu','Collateral claimed':'Vakuus lunastettu','Time advanced':'Aikaa siirretty',
    'Reset clears the loan state and returns this offer to the start of its local simulation.':'Aloita alusta tyhjentää lainan tilan ja palauttaa tarjouksen paikallisen simulaation alkuun.',
    'Example 8%':'Esimerkki 8 %','Example 10%':'Esimerkki 10 %',
  };
  const C = () => globalThis.NodusDefiCore;
  const T = key => globalThis.NodusI18n?.language?.() === 'en' ? key : (messages[key] ?? key);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const copy = value => JSON.parse(JSON.stringify(value));
  const LIMIT = 50, IMPORT_BYTES = 65536;
  let root = null, states = [], selectedId = null, tab = 'offers', message = '', failed = false, importVersion = 0;
  let form = {name:'',principal:'100',collateral:'10000',apr:'8',termDays:'30',graceDays:'3'};
  const selected = () => states.find(s => s.offer.id === selectedId) ?? null;
  const amount = (raw, digits) => esc(C().formatAmount(raw, digits));
  // A sum can exceed an individual loan's cap. Its component terms have already
  // been validated, so format this bounded total without reapplying that cap.
  const aggregateAmount = (raw, digits) => {
    const padded=raw.padStart(digits+1,'0'),fraction=padded.slice(-digits).replace(/0+$/,'');
    return esc(padded.slice(0,-digits)+(fraction?'.'+fraction:''));
  };
  const offerName = o => ['example-8','example-10'].includes(o.id) && ['Example 8%','Example 10%'].includes(o.name) ? T(o.name) : o.name;
  const apr = bps => C().formatAmount(String(bps), 2) + ' %';
  const stamp = seconds => new Date(seconds * 1000).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
  const button = (label, action, disabled = false, extra = '') => `<button type="button" class="button ${extra}" data-defi-action="${action}"${disabled ? ' disabled' : ''}>${esc(T(label))}</button>`;
  const status = s => s.status === 'open' && s.now >= s.offer.expiresAt ? 'Expired' : ({open:'Open',active:'Active',repaid:'Repaid',cancelled:'Cancelled',defaulted:'Defaulted'}[s.status]);
  const deadline = s => s.dueAt + s.offer.graceDays * 86400;
  function capture() {
    if (!root) return;
    for (const key of Object.keys(form)) {
      const el = root.querySelector('#defi-' + key);
      if (el) form[key] = el.value;
    }
  }
  function summary() {
    const open = states.filter(s => s.status === 'open' && s.now < s.offer.expiresAt);
    const active = states.filter(s => s.status === 'active');
    const sum = (list, key) => list.reduce((total, s) => total + BigInt(s.offer[key]), 0n).toString();
    return `<section class="defi-stats" aria-label="${esc(T('Simulated amounts'))}">
      <div class="panel defi-stat"><span>${T('Available to borrow')}</span><strong>${aggregateAmount(sum(open, 'principalRaw'), 6)} <small>tUSDT</small></strong></div>
      <div class="panel defi-stat"><span>${T('Active test loans')}</span><strong>${active.length}</strong></div>
      <div class="panel defi-stat"><span>${T('NODUS locked')}</span><strong>${aggregateAmount(sum(active, 'collateralRaw'), 8)} <small>NODUS</small></strong></div>
      <div class="panel defi-stat defi-planned"><span>${T('Credit score')}</span><strong>${T('Planned')}</strong><small>${T('Not used in this version')}</small></div>
    </section>`;
  }
  function offerCard(s) {
    const o = s.offer, q = C().quote(o);
    return `<article class="panel defi-offer${selectedId === o.id ? ' defi-selected' : ''}">
      <div class="defi-card-head"><span class="defi-status defi-status-${s.status}">${esc(T(status(s)))}</span><span class="defi-muted">${T('Simulated offer')}</span></div>
      <h3>${esc(offerName(o))}</h3><div class="defi-rate">${esc(apr(o.aprBps))}<span>${T('Annual interest')}</span></div>
      <dl class="defi-terms"><div><dt>${T('Principal')}</dt><dd>${amount(o.principalRaw,6)} tUSDT</dd></div><div><dt>${T('Collateral')}</dt><dd>${amount(o.collateralRaw,8)} NODUS</dd></div><div><dt>${T('Term')}</dt><dd>${o.termDays} ${T('days')}</dd></div><div><dt>${T('Total repayment')}</dt><dd>${amount(q.repayRaw,6)} tUSDT</dd></div></dl>
      <button type="button" class="button defi-card-button" data-defi-select="${esc(o.id)}" aria-pressed="${selectedId === o.id}">${T(s.status === 'open' ? 'View offer' : 'View loan')}<span aria-hidden="true"> →</span></button>
    </article>`;
  }
  function book() {
    const list = tab === 'loans' ? states.filter(s => ['active','repaid','defaulted'].includes(s.status)) : states;
    const empty = tab === 'loans' ? ['No active test loans','Take a simulated loan from the offers to try repayment and the overdue path.'] : ['No offers yet','Load the 8% and 10% examples or create your own simulated offer.'];
    return `<section class="defi-market"><div class="defi-section-head"><h2>${T(tab === 'loans' ? 'My test loans' : 'Loan offers')}</h2>${button('Load example offers','examples',states.length > LIMIT - 2 || ['example-8','example-10'].every(id=>states.some(s=>s.offer.id===id)))}</div>
      ${list.length ? `<div class="defi-offers">${list.map(offerCard).join('')}</div>` : `<div class="panel defi-empty"><span class="defi-empty-icon" aria-hidden="true">↔</span><h3>${T(empty[0])}</h3><p>${T(empty[1])}</p></div>`}</section>`;
  }
  function detail() {
    const s = selected();
    if (!s) return `<section class="panel defi-details"><h2>${T('Offer details')}</h2><p>${T('Choose an offer to inspect its terms.')}</p></section>`;
    const o=s.offer,q=C().quote(o),active=s.status==='active',open=s.status==='open';
    const labels={accept:'Borrowed',repay:'Repaid in full',cancel:'Offer cancelled',default:'Collateral claimed',advance:'Time advanced'};
    const actions = open ? button('Simulate borrowing','accept',s.now>=o.expiresAt,'defi-primary')+button('Simulate cancellation','cancel') : active ? button('Simulate repayment','repay',s.now>=deadline(s),'defi-primary')+button('Advance to due date','due',s.now>=s.dueAt)+button('Advance to grace deadline','deadline',s.now>=deadline(s))+button('Simulate collateral claim','default',s.now<deadline(s),'defi-danger') : '';
    return `<section class="panel defi-details" id="defi-details"><div class="defi-section-head"><div><span class="eyebrow">${T(s.acceptedAt!==null?'Loan details':'Offer details')}</span><h2>${esc(offerName(o))}</h2></div><span class="defi-status defi-status-${s.status}">${T(status(s))}</span></div>
      <div class="defi-settlement"><div><span>${T('Principal')}</span><strong>${amount(o.principalRaw,6)} <small>tUSDT</small></strong></div><span aria-hidden="true">+</span><div><span>${T('Interest for the full term')}</span><strong>${amount(q.interestRaw,6)} <small>tUSDT</small></strong></div><span aria-hidden="true">=</span><div class="defi-total"><span>${T('Total repayment')}</span><strong>${amount(q.repayRaw,6)} <small>tUSDT</small></strong></div></div>
      <p class="defi-fixed-note">${T('The full fixed-term interest is due even if you repay early.')}</p>
      <dl class="defi-detail-meta"><div><dt>${T('Annual interest')}</dt><dd>${esc(apr(o.aprBps))} · ${T('Fixed for the term')}</dd></div><div><dt>${T('Collateral')}</dt><dd>${amount(o.collateralRaw,8)} NODUS</dd></div><div><dt>${T('Term')}</dt><dd>${o.termDays} ${T('days')} + ${o.graceDays} ${T('days')} (${T('Grace period')})</dd></div><div><dt>${T('Simulated time')}</dt><dd><time>${stamp(s.now)}</time></dd></div>${s.acceptedAt !== null ? `<div><dt>${T('Loan accepted')}</dt><dd><time>${stamp(s.acceptedAt)}</time></dd></div><div><dt>${T('Due date')}</dt><dd><time>${stamp(s.dueAt)}</time></dd></div><div><dt>${T('Grace deadline')}</dt><dd><time>${stamp(deadline(s))}</time></dd></div>`:`<div><dt>${T('Offer expires')}</dt><dd><time>${stamp(o.expiresAt)}</time></dd></div>`}</dl>
      <p>${T('This offer is accepted in full by one borrower.')}</p><p>${T('Collateral is a fixed NODUS amount. There is no price feed or price-based liquidation in this version.')}</p>
      <div class="defi-economic-warning"><strong>${T('If the loan remains unpaid at the end of the grace period, the lender can claim the entire collateral. This can exceed the debt value.')}</strong><p>${T('Repayment is possible before the grace deadline. At that deadline it closes and the collateral claim opens.')}</p></div>
      ${s.status === 'repaid' ? `<div class="defi-result"><strong>${T('Principal and interest returned to lender')}</strong><span>${T('Collateral returned to borrower')}: ${amount(o.collateralRaw,8)} NODUS</span></div>` : s.status === 'cancelled' ? `<div class="defi-result">${T('Unused funding returned to lender')}: ${amount(o.principalRaw,6)} tUSDT</div>` : s.status === 'defaulted' ? `<div class="defi-result defi-economic-warning">${T('Collateral transferred to lender')}: ${amount(o.collateralRaw,8)} NODUS</div>`:''}
      <div class="defi-buttons">${actions}</div>${s.status!=='open'?`<div class="defi-reset">${button('Reset this simulation','reset')}<small>${T('Reset clears the loan state and returns this offer to the start of its local simulation.')}</small></div>`:''}
      <details class="defi-history"><summary>${T('Simulation history')}</summary><ol><li>${T('Funding reserved')} · ${stamp(o.createdAt)}</li>${s.events.map(e=>`<li>${esc(T(labels[e.action]??'Time advanced'))} · ${stamp(e.now)}</li>`).join('')}</ol></details>
    </section>`;
  }
  function field(key,label,type='text',extra='') {
    return `<label class="defi-field" for="defi-${key}"><span>${T(label)}</span><input id="defi-${key}" name="${key}" type="${type}" value="${esc(form[key])}" autocomplete="off" maxlength="80" ${extra}></label>`;
  }
  function createForm() {
    return `<section class="panel defi-create"><div class="defi-section-head"><h2>${T('Create an offer')}</h2><span class="defi-status">${T('LOCAL SIMULATION')}</span></div><form id="defi-form" novalidate><div class="defi-form-grid">
      ${field('name','Name','text','required')}${field('principal','Amount to lend (tUSDT)','text','inputmode="decimal" required')}${field('collateral','Required collateral (NODUS)','text','inputmode="decimal" required')}${field('apr','Annual interest (%)','text','inputmode="decimal" required')}${field('termDays','Term (days)','text','inputmode="numeric" required')}${field('graceDays','Grace period (days)','text','inputmode="numeric" required')}
      </div><p>${T('Use a decimal point. tUSDT has 6 decimals and NODUS has 8.')}</p><p>${T('Offers remain open for 7 simulated days. Principal is reserved when the offer is created.')}</p><p>${T('No price valuation is implied by the collateral amount. Network fees are outside this simulation.')}</p><button type="submit" class="button defi-primary">${T('Create a simulated funded offer')}</button></form></section>`;
  }
  function render() {
    if (!root) return;
    root.innerHTML=`<div class="defi-workbench"><header class="defi-hero"><div><span class="eyebrow">NODUS / tUSDT</span><h1>${T('Lend tUSDT. Borrow against NODUS.')}</h1><p>${T('Explore fixed-rate offers and rehearse a loan from funding to repayment.')}</p></div><span class="defi-network">NODUS TESTNET</span></header>
      <div class="defi-simulation-banner"><span class="defi-simulation-dot" aria-hidden="true"></span><div><strong>${T('Local simulation · no chain transactions')}</strong><p>${T('All amounts below are simulated. Your wallet and its tUSDT balance are not connected.')}</p></div></div>
      ${summary()}<p id="defi-message" class="defi-message${failed?' defi-error':''}" role="status" aria-live="polite">${esc(T(message))}</p>
      <div class="defi-toolbar"><nav class="defi-tabs" aria-label="Test DeFi">${[['offers','Loan offers'],['loans','My test loans'],['create','Create an offer']].map(([key,label])=>`<button type="button" data-defi-tab="${key}" aria-pressed="${tab===key}">${T(label)}</button>`).join('')}</nav><div class="defi-buttons">${button('Export offer drafts','export',!states.length)}<label class="button defi-import" for="defi-import">${T('Import drafts')}<input id="defi-import" type="file" accept=".json,application/json"></label></div></div>
      ${tab==='create'?createForm():`<div class="defi-main-grid"><div>${book()}</div>${detail()}</div>`}
      <footer class="defi-footer"><div><strong>${T('Session only')}</strong><p>${T('Drafts and simulations disappear when this page is reloaded. Export drafts to keep their terms.')}</p></div><div><strong>${T('Next building blocks')}</strong><p>${['Wallet execution','Shared offer book','Verified credit history','Connect reminders'].map(x=>T(x)).join(' · ')}</p></div></footer></div>`;
    bind();
  }
  function addOffers(offers) {
    // Validate the entire import before mutating anything; duplicate IDs cannot
    // overwrite a loan in progress or resurrect cancelled funding silently.
    const next=offers.map(C().validateOffer), ids=new Set();
    for (const o of next) {
      if(ids.has(o.id)) throw Error('The imported draft conflicts with an existing offer.');
      ids.add(o.id);
      const existing=states.find(s=>s.offer.id===o.id);
      if(existing && JSON.stringify(existing.offer)!==JSON.stringify(o)) throw Error('The imported draft conflicts with an existing offer.');
    }
    const fresh=next.filter(o=>!states.some(s=>s.offer.id===o.id));
    if(states.length+fresh.length>LIMIT) throw Error('The offer list is full (50).');
    states.push(...fresh.map(C().start));
    if(!selectedId && states.length) selectedId=states[0].offer.id;
  }
  function download(text) {
    let url;
    try {url=URL.createObjectURL(new Blob([text],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='nodus-test-defi-drafts.json';document.body.appendChild(a);a.click();a.remove();}
    catch {throw Error('A download could not be created.');}
    finally {if(url) URL.revokeObjectURL(url);}
  }
  function act(action) {
    capture();failed=false;message='';
    try {
      const s=selected();
      if(action==='examples') {addOffers(C().sampleOffers(Math.floor(Date.now()/1000)).filter(o=>!states.some(s=>s.offer.id===o.id)));message='Examples loaded. These are simulated offers.';}
      else if(action==='create') {
        if(!/^\d+$/.test(form.termDays)||!/^\d+$/.test(form.graceDays)) throw Error('input');
        const offer=C().createOffer({name:form.name.trim(),principal:form.principal,collateral:form.collateral,aprBps:Number(C().parseAmount(form.apr,2)),termDays:Number(form.termDays),graceDays:Number(form.graceDays),offerDays:7},Math.floor(Date.now()/1000));
        addOffers([offer]);selectedId=offer.id;tab='offers';message='Simulated offer created. No funds were transferred.';
      } else if(action==='export') {download(C().exportOffers(states.map(x=>x.offer)));message='Drafts exported. Funding and loan states are not included.';}
      else if(action==='reset') {states=states.map(x=>x===s?C().start(x.offer):x);message='Simulation reset.';}
      else if(s) {
        // Time is explicit and local. The model enforces the same deadline
        // boundary as the contract; the UI never uses a browser clock to claim
        // that real collateral can be seized.
        const advance=action==='due'||action==='deadline';
        const next=C().step(s,advance?'advance':action,{actor:action==='accept'||action==='repay'?'borrower':'lender',now:advance?(action==='due'?s.dueAt:deadline(s)):s.now});
        states=states.map(x=>x===s?next:x);
        message=advance?'Simulation time advanced.':({accept:'Loan simulated. No funds were transferred.',repay:'Repayment simulated.',cancel:'Cancellation simulated.',default:'Collateral claim simulated.'}[action]??'');
      }
    } catch(error) {
      failed=true;
      const validation=error.code==='invalid_name'?'Give the offer a name (1–80 characters).':error.field==='aprBps'?'Annual interest must be 0.01–50%.':error.field==='termDays'?'The term must be 1–365 whole days.':error.field==='graceDays'?'The grace period must be 1–30 whole days.':null;
      message=validation??(Object.hasOwn(messages,error.message)?error.message:'Check the amounts and terms. The action could not be completed.');
    }
    render();
  }
  function bind() {
    root.querySelectorAll('[data-defi-action]').forEach(el=>el.onclick=()=>act(el.dataset.defiAction));
    root.querySelectorAll('[data-defi-select]').forEach(el=>el.onclick=()=>{capture();selectedId=el.dataset.defiSelect;message='';failed=false;render();root.querySelector('#defi-details')?.scrollIntoView({block:'nearest',behavior:'smooth'});});
    root.querySelectorAll('[data-defi-tab]').forEach(el=>el.onclick=()=>{capture();tab=el.dataset.defiTab;message='';failed=false;render();});
    const create=root.querySelector('#defi-form');if(create)create.onsubmit=event=>{event.preventDefault();act('create');};
    root.querySelector('#defi-import').onchange=async event=>{
      const file=event.target.files?.[0],version=++importVersion;if(!file)return;capture();
      try {if(file.size>IMPORT_BYTES)throw Error('size');const text=await file.text();if(version!==importVersion||!root)return;addOffers(C().importOffers(text));failed=false;message='Drafts imported. Imported files do not prove funding.';tab='offers';}
      catch(error){if(version!==importVersion||!root)return;failed=true;message=Object.hasOwn(messages,error.message)?error.message:'The file is too large or invalid. No drafts were imported.';}
      render();
    };
  }
  globalThis.NodusDefi=Object.freeze({
    mount(target){capture();root=target;render();},capture,
    unmount(){capture();root=null;++importVersion;},
    getState:()=>copy({states,selectedId,tab,form,message,failed}),
  });
})();
