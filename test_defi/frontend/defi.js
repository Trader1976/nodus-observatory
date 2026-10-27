/* The adapter owns signatures and durable transaction records. This view never
 * owns keys. The local rehearsal has its own mount and never enters live data. */
(() => {
  'use strict';
  const fi = {
    'Your DeFi test lab.':'DeFi-testilaboratorio.',
    'Connect your wallet, explore the tested loan contract and prepare for lending across Nodus and TRON.':'Yhdistä lompakkosi, tutki testattua lainasopimusta ja valmistaudu Nodusin ja TRONin välisiin lainoihin.',
    'TEST NETWORKS ONLY':'VAIN TESTIVERKOT','Wallet & test assets':'Lompakko ja testivarat','Nodus loans':'Nodus-lainat','Practice':'Harjoittelu',
    'Your test wallet':'Testilompakkosi','Connect TronLink':'Yhdistä TronLink','Disconnect':'Katkaise yhteys','Refresh balances':'Päivitä saldot',
    'Not connected':'Ei yhdistetty','Connected':'Yhdistetty','Selected test network':'Valittu testiverkko','Wallet network':'Lompakon verkko',
    'Connect TronLink to see your balances and send test USDT. Your keys stay in your wallet.':'Yhdistä TronLink nähdäksesi saldosi ja lähettääksesi testi-USDT:tä. Avaimesi pysyvät lompakossasi.',
    'Wallet address':'Lompakon osoite','Waiting for wallet':'Odottaa lompakkoa','Test tokens have no monetary value.':'Testitokeneilla ei ole rahallista arvoa.',
    'Network fee balance':'Verkkokulujen saldo','Test token balance':'Testitokenin saldo','Paid in test TRX':'Maksetaan testi-TRX:llä','Balance unknown':'Saldo ei tiedossa',
    'Send test USDT':'Lähetä testi-USDT:tä','Recipient TRON address':'Vastaanottajan TRON-osoite','Amount (test USDT)':'Määrä (testi-USDT)',
    'Example: 10.25':'Esimerkiksi: 10.25','Review transfer':'Tarkista siirto','Use up to six decimal places.':'Käytä enintään kuutta desimaalia.',
    'Transfers are available on Nile. Shasta needs a verified test-token deployment before token actions can be enabled.':'Siirrot ovat käytössä Nilessä. Shasta tarvitsee vahvistetun testitokenin ennen tokenitoimintojen käyttöönottoa.',
    'Transfer review':'Siirron tarkistus','From':'Lähettäjä','To':'Vastaanottaja','Token contract':'Tokenin sopimus','Amount':'Määrä',
    'Energy fee limit':'Energiamaksun yläraja','Up to 100 test TRX for Energy. Bandwidth and other network charges may add TRX. Check the final request in TronLink.':'Energiaan enintään 100 testi-TRX:ää. Kaistanleveys ja muut verkkokulut voivat lisätä TRX-maksuja. Tarkista lopullinen pyyntö TronLinkissä.',
    'Confirm in TronLink':'Vahvista TronLinkissä','Back':'Takaisin','Transfer submitted. Use Refresh transactions to check confirmation.':'Siirto lähetetty. Tarkista vahvistus painikkeesta Päivitä tapahtumat.',
    'Recent transactions':'Viimeisimmät tapahtumat','Refresh transactions':'Päivitä tapahtumat','No transactions from this page yet.':'Tältä sivulta ei ole vielä lähetetty tapahtumia.',
    'Pending':'Odottaa vahvistusta','Confirmed':'Vahvistettu','Failed':'Epäonnistui','Unknown':'Tila epävarma','Signed':'Allekirjoitettu',
    'View transaction':'Katso tapahtuma','Transaction records are stored in this browser so a page reload does not invite a duplicate transfer.':'Tapahtumatiedot säilyvät tässä selaimessa, jotta sivun uudelleenlataus ei johda siirron toistamiseen.',
    'A loan across two networks':'Laina kahden verkon välillä','Test USDT on TRON':'Testi-USDT TRONissa','NODUS on Nodus':'NODUS Nodusissa',
    'Wallet connection ready':'Lompakkoyhteys valmis','Wallet connection pending':'Lompakkoyhteys odottaa',
    'Connect a wallet':'Yhdistä lompakko','Choose an offer':'Valitse tarjous','Lock collateral':'Lukitse vakuus','Repay & withdraw':'Maksa ja nosta',
    'Cross-chain lending is not enabled yet. The settlement pattern and the Nodus wallet connection must be integrated first.':'Ketjujen välinen lainaaminen ei ole vielä käytössä. Ensin liitetään selvitysmalli ja Nodus-lompakon selainyhteys.',
    'Lend test USDT':'Anna testi-USDT:tä lainaksi','Borrow with NODUS':'Lainaa NODUS-vakuudella','Try the loan flow':'Kokeile lainan kulkua',
    'Practice the full loan lifecycle with clearly marked local examples.':'Harjoittele lainan koko elinkaari selvästi merkityillä paikallisilla esimerkeillä.',
    'On-chain OSD6 loan book':'OSD6-lainat ketjussa','Read the deployed Nodus test contract. These records are separate from TRON test USDT and the practice examples.':'Lue Nodus-testiverkkoon julkaistua sopimusta. Nämä tiedot ovat erillään TRONin testi-USDT:stä ja harjoittelun esimerkeistä.',
    'Read loan contract':'Lue lainasopimus','Refresh loan book':'Päivitä lainat','Loading loan contract…':'Luetaan lainasopimusta…','Loan data unavailable':'Lainatiedot eivät ole saatavilla',
    'Read the contract to see its offers and loans.':'Lue sopimus nähdäksesi sen tarjoukset ja lainat.','No offers returned by the contract.':'Sopimus ei palauttanut tarjouksia.',
    'Offer':'Tarjous','Open':'Avoin','Active':'Aktiivinen','Repaid':'Maksettu','Cancelled':'Peruttu','Defaulted':'Vakuus lunastettu',
    'Principal':'Lainapääoma','Collateral':'Vakuus','Annual interest':'Vuosikorko','Term':'Laina-aika','days':'päivää','View details':'Katso tiedot',
    'Loan details':'Lainan tiedot','Interest for the full term':'Koko laina-ajan korko','Total repayment':'Takaisinmaksettava yhteensä',
    'Lender':'Rahoittaja','Borrower':'Lainaaja','Due date':'Eräpäivä','Grace deadline':'Lisäaika päättyy','Offer expires':'Tarjous vanhenee','Grace period':'Lisäaika',
    'Direct Nodus signing awaits a supported browser wallet connection. The completed manual OSD6 test does not provide that connection.':'Nodus-tapahtumien allekirjoitus odottaa tuettua selainyhteyttä lompakkoon. Tehty OSD6-testi ei vielä tarjoa tätä liitäntää.',
    'Accept offer':'Hyväksy tarjous','Repay loan':'Maksa laina','Withdraw funds':'Nosta varat','Read-only contract view':'Sopimuksen lukunäkymä',
    'Reported by the connected Nodus node; not independently proven against the chain.':'Yhdistetyn Nodus-noden ilmoittama tieto; ei itsenäisesti todennettu ketjusta.',
    'Observed at':'Havaittu','Token':'Token','Loan contract':'Lainasopimus','The loan book could not be loaded. Try again.':'Lainoja ei voitu ladata. Yritä uudelleen.',
    'This action is not available.':'Tämä toiminto ei ole käytettävissä.','TronLink integration is unavailable. Reload the page.':'TronLink-liitäntä ei ole saatavilla. Lataa sivu uudelleen.',
    'The wallet or network changed. Review the transfer again.':'Lompakko tai verkko vaihtui. Tarkista siirto uudelleen.','Working…':'Käsitellään…',
    'Install TronLink and reload this page.':'Asenna TronLink ja lataa sivu uudelleen.',
    'Unlock TronLink and connect this site.':'Avaa TronLinkin lukitus ja yhdistä tämä sivu.',
    'Connect TronLink first.':'Yhdistä ensin TronLink.',
    'Select a supported test network.':'Valitse tuettu testiverkko.',
    'Select TRON Nile in TronLink. Mainnet and custom RPCs are disabled.':'Valitse TronLinkistä TRON Nile. Pääverkko ja omat RPC-palvelimet eivät ole käytössä.',
    'Select TRON Shasta in TronLink. Mainnet and custom RPCs are disabled.':'Valitse TronLinkistä TRON Shasta. Pääverkko ja omat RPC-palvelimet eivät ole käytössä.',
    'Select TRON Nile in TronLink, then connect again.':'Valitse TronLinkistä TRON Nile ja yhdistä uudelleen.',
    'Select TRON Shasta in TronLink, then connect again.':'Valitse TronLinkistä TRON Shasta ja yhdistä uudelleen.',
    'The wallet request was declined.':'Lompakon pyyntö hylättiin.',
    'The wallet request was rejected.':'Lompakon pyyntö hylättiin.',
    'Confirmation declined by user':'Hylkäsit vahvistuksen lompakossa.',
    'User rejected the request.':'Hylkäsit pyynnön lompakossa.',
    'A wallet request is already in progress.':'Lompakossa on jo pyyntö käsiteltävänä.',
    'Enter a positive amount with at most 6 decimals.':'Anna positiivinen määrä enintään kuudella desimaalilla.',
    'Enter a valid TRON recipient address.':'Anna kelvollinen vastaanottajan TRON-osoite.',
    'The test token balance is too low.':'Testitokenin saldo ei riitä.',
    'No reviewed test token is configured for this network.':'Tälle verkolle ei ole vielä vahvistettu testitokenia.',
    'Browser storage is unavailable. Nothing was broadcast.':'Selaimen tallennustila ei ole käytettävissä. Tapahtumaa ei lähetetty.',
    'Secure browser locking is unavailable. Use HTTPS or localhost before sending.':'Selaimen lukitus ei ole käytettävissä. Käytä HTTPS-yhteyttä tai localhost-osoitetta ennen lähettämistä.',
    'The saved transaction journal cannot be read. Sending is disabled.':'Tallennettuja tapahtumatietoja ei voida lukea. Lähettäminen on estetty.',
    'The pending transaction journal is full. Reconcile it before sending.':'Odottavien tapahtumien lista on täynnä. Päivitä tapahtumien tilat ennen lähettämistä.',
    'The wallet account or network changed. Connect again.':'Lompakon tili tai verkko vaihtui. Yhdistä uudelleen.',
    'The connected node has the wrong genesis block.':'Yhdistetty node kuuluu väärään verkkoon.',
    'This review is no longer current. Prepare the transfer again.':'Tarkistus ei ole enää voimassa. Valmistele siirto uudelleen.',
    'The wallet account changed. Prepare the transfer again.':'Lompakon tili vaihtui. Valmistele siirto uudelleen.',
    'The signed transaction differs from the reviewed transfer. Nothing was broadcast.':'Allekirjoitettu tapahtuma eroaa tarkistetusta siirrosta. Tapahtumaa ei lähetetty.',
    'The wallet account or network changed. Nothing was broadcast.':'Lompakon tili tai verkko vaihtui. Tapahtumaa ei lähetetty.',
    'Submission is uncertain. Refresh transactions before doing anything again.':'Lähetyksen tila on epävarma. Päivitä tapahtumat ennen kuin yrität mitään uudelleen.',
    'The node rejected the transfer. Check the transaction record.':'Node hylkäsi siirron. Tarkista tapahtumatieto.',
    'Broadcast status is uncertain. Check this transaction before sending again.':'Lähetyksen tila on epävarma. Tarkista tämä tapahtuma ennen kuin lähetät uudelleen.',
    'The wallet request could not be completed.':'Lompakon pyyntöä ei voitu suorittaa.',
    'Offers shown':'Näytetyt tarjoukset','of':'/','This is a partial loan history.':'Tämä on osa lainahistoriasta.',
  };
  const T = key => globalThis.NodusI18n?.language?.() === 'en' ? key : (fi[key] ?? key);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const copy = value => JSON.parse(JSON.stringify(value));
  const emptyWallet = () => ({connected:false,address:null,selectedNetwork:'nile',network:null,chainId:null,balances:{trxRaw:null,tokenRaw:null},token:null,busy:false,error:null,pending:[]});
  let root=null,view='wallet',wallet=null,walletState=emptyWallet(),review=null,form={to:'',amount:''},message='',failed=false,busy=false;
  let loanData=null,loanLoading=false,loanId=null,loadVersion=0,controller=null;
  const profiles = () => globalThis.NodusDefiNetworks?.profiles ?? {};
  const format = (raw,digits=6) => {
    if(!/^[0-9]+$/.test(String(raw??'')))return '—';
    const s=BigInt(raw).toString().padStart(digits+1,'0'),f=digits?s.slice(-digits).replace(/0+$/,''):'';
    return (digits?s.slice(0,-digits):s)+(f?'.'+f:'');
  };
  const button=(label,action,disabled=false,extra='')=>`<button type="button" class="button ${extra}" data-defi-live-action="${action}"${disabled?' disabled':''}>${esc(T(label))}</button>`;
  const address=value=>`<code class="defi-address">${esc(value??'—')}</code>`;
  const time=value=>{const ms=Number(value)*1000;return Number.isSafeInteger(ms)&&ms>0&&ms<=8640000000000000?new Date(ms).toISOString().replace('T',' ').replace('.000Z',' UTC'):'—';};
  const row=(label,value)=>`<div><dt>${esc(T(label))}</dt><dd>${value}</dd></div>`;
  const statuses={open:'Open',active:'Active',repaid:'Repaid',cancelled:'Cancelled',defaulted:'Defaulted',pending:'Pending',confirmed:'Confirmed',failed:'Failed',unknown:'Unknown',signed:'Signed'};
  const statusName=value=>statuses[value]??'Unknown';
  function capture(){
    if(view==='practice'){globalThis.NodusDefiPractice?.capture();return;}
    if(!root)return;
    for(const key of ['to','amount']){const input=root.querySelector('#defi-live-'+key);if(input)form[key]=input.value;}
  }
  function focusFeedback(selector='#defi-live-feedback'){
    const el=root?.querySelector(selector);el?.focus?.({preventScroll:true});el?.scrollIntoView?.({block:'nearest',behavior:'smooth'});
  }
  function ensureWallet(){
    if(wallet)return wallet;
    if(!globalThis.NodusDefiTron?.create)throw Error('TronLink integration is unavailable. Reload the page.');
    wallet=globalThis.NodusDefiTron.create({onChange:()=>{
      capture();walletState=wallet?.getState()??emptyWallet();
      if(review&&(review.from!==walletState.address||review.network!==walletState.network||review.chainId!==walletState.chainId)){
        review=null;message='The wallet or network changed. Review the transfer again.';failed=true;
      }
      render();
    }});
    walletState=wallet.getState();return wallet;
  }
  function feedback(includeWallet=true){
    const text=(includeWallet?walletState.error:null)||message||'';
    return `<div id="defi-live-feedback" class="defi-live-feedback${failed||(includeWallet&&walletState.error)?' defi-error':''}" role="status" aria-live="polite" tabindex="-1">${esc(T(text))}</div>`;
  }
  function walletCard(){
    const s=walletState,locked=busy||s.busy;
    return `<section class="panel defi-wallet-card"><div class="defi-section-head"><div><span class="eyebrow">TRON / TRONLINK</span><h2>${T('Your test wallet')}</h2></div><span class="defi-status ${s.connected?'':'defi-status-cancelled'}">${T(s.connected?'Connected':'Not connected')}</span></div>
      <div class="defi-wallet-controls"><label class="defi-field" for="defi-live-network"><span>${T('Selected test network')}</span><select id="defi-live-network" class="select"${locked?' disabled':''}><option value="nile"${s.selectedNetwork==='nile'?' selected':''}>TRON Nile</option><option value="shasta"${s.selectedNetwork==='shasta'?' selected':''}>TRON Shasta</option></select></label><div class="defi-buttons">${s.connected?button('Refresh balances','refresh',locked)+button('Disconnect','disconnect',locked):button('Connect TronLink','connect',locked,'defi-primary')}</div></div>
      ${s.connected?`<dl class="defi-detail-meta">${row('Wallet address',address(s.address))}${row('Wallet network',esc(profiles()[s.network]?.name??T('Unknown')))}</dl>`:`<p>${T('Connect TronLink to see your balances and send test USDT. Your keys stay in your wallet.')}</p>`}
      <div class="defi-live-balances"><div><span>${T('Network fee balance')}</span><strong>${esc(format(s.balances?.trxRaw))}<small>TRX</small></strong><span>${T('Paid in test TRX')}</span></div><div><span>${T('Test token balance')}</span><strong>${esc(format(s.balances?.tokenRaw))}<small>${esc(s.token?.symbol??'test USDT')}</small></strong><span>${s.token?address(s.token.address):T('Balance unknown')}</span></div></div><p class="defi-test-note">${T('Test tokens have no monetary value.')}</p></section>`;
  }
  function transferCard(){
    const s=walletState,locked=busy||s.busy,enabled=s.connected&&s.network==='nile'&&!!s.token;
    return `<section class="panel defi-transfer-card"><div class="defi-section-head"><h2>${T('Send test USDT')}</h2><span class="defi-mini-label">TRC20</span></div><form id="defi-live-transfer" novalidate><label class="defi-field" for="defi-live-to"><span>${T('Recipient TRON address')}</span><input id="defi-live-to" value="${esc(form.to)}" placeholder="T…" autocomplete="off" spellcheck="false" maxlength="80"${locked?' disabled':''}></label><label class="defi-field" for="defi-live-amount"><span>${T('Amount (test USDT)')}</span><input id="defi-live-amount" value="${esc(form.amount)}" placeholder="${esc(T('Example: 10.25'))}" inputmode="decimal" autocomplete="off" maxlength="40"${locked?' disabled':''}></label><p>${T('Use up to six decimal places.')}</p>${feedback()}<button type="submit" class="button defi-primary"${!enabled||locked||review?' disabled':''}>${T(locked?'Working…':'Review transfer')}</button></form>${review?reviewPanel():''}${s.selectedNetwork==='shasta'?`<p>${T('Transfers are available on Nile. Shasta needs a verified test-token deployment before token actions can be enabled.')}</p>`:''}</section>`;
  }
  function reviewPanel(){
    return `<section id="defi-live-review" class="defi-transfer-review" tabindex="-1" aria-labelledby="defi-review-title"><div class="defi-section-head"><h3 id="defi-review-title">${T('Transfer review')}</h3><span class="defi-status">${esc(profiles()[review.network]?.name??review.network)}</span></div><dl class="defi-detail-meta">${row('From',address(review.from))}${row('To',address(review.to))}${row('Amount',`<strong>${esc(format(review.amountRaw))} ${esc(review.symbol)}</strong>`)}${row('Token contract',address(review.tokenAddress))}${row('Energy fee limit',`${esc(format(review.feeLimitSun))} test TRX`)}</dl><p>${T('Up to 100 test TRX for Energy. Bandwidth and other network charges may add TRX. Check the final request in TronLink.')}</p><div class="defi-buttons">${button('Confirm in TronLink','confirm-transfer',busy||walletState.busy,'defi-primary')}${button('Back','cancel-review',busy||walletState.busy)}</div></section>`;
  }
  function transactions(){
    const list=(walletState.pending??[]).filter(x=>x.network===walletState.selectedNetwork).slice(-20).reverse();
    return `<section class="panel defi-transactions"><div class="defi-section-head"><h2>${T('Recent transactions')}</h2>${button('Refresh transactions','reconcile',busy||walletState.busy||!walletState.connected)}</div>${list.length?`<div class="defi-transaction-list">${list.map(item=>{
      const txID=String(item.txID??''),explorer=profiles()[item.network]?.explorer;
      const link=/^[a-fA-F0-9]{64}$/.test(txID)&&/^https:\/\/(nile|shasta)\.tronscan\.org$/.test(explorer??'')?`${explorer}/#/transaction/${txID}`:null;
      return `<article><div><span class="defi-status">${esc(T(statusName(item.status)))}</span><strong>${esc(format(item.amountRaw))} test USDT</strong></div><p>${address(item.to)}${link?`<a href="${link}" target="_blank" rel="noopener noreferrer">${T('View transaction')} ↗</a>`:address(txID)}</p></article>`;
    }).join('')}</div>`:`<p>${T('No transactions from this page yet.')}</p>`}<p class="defi-small-note">${T('Transaction records are stored in this browser so a page reload does not invite a duplicate transfer.')}</p></section>`;
  }
  function crossChainCard(){
    return `<section class="panel defi-crosschain"><div class="defi-section-head"><h2>${T('A loan across two networks')}</h2><span class="defi-mini-label">NODUS × TRON</span></div><div class="defi-chain-grid"><div><span class="defi-chain-symbol">N</span><strong>${T('NODUS on Nodus')}</strong><span>${T('Wallet connection pending')}</span></div><div><span class="defi-chain-symbol defi-tron-symbol">T</span><strong>${T('Test USDT on TRON')}</strong><span>${T(walletState.connected?'Wallet connection ready':'Waiting for wallet')}</span></div></div><ol class="defi-loan-steps">${['Connect a wallet','Choose an offer','Lock collateral','Repay & withdraw'].map((x,i)=>`<li${i===0&&walletState.connected?' class="defi-step-ready"':''}><span>${i+1}</span>${T(x)}</li>`).join('')}</ol><p>${T('Cross-chain lending is not enabled yet. The settlement pattern and the Nodus wallet connection must be integrated first.')}</p><div class="defi-buttons">${button('Lend test USDT','unavailable',true)}${button('Borrow with NODUS','unavailable',true)}</div><div class="defi-next-action"><p>${T('Practice the full loan lifecycle with clearly marked local examples.')}</p>${button('Try the loan flow','practice')}</div></section>`;
  }
  function loanCard(o){
    const status=['open','active','repaid','cancelled','defaulted'].includes(o.status)?o.status:'cancelled';
    return `<article class="panel defi-offer${String(loanId)===String(o.id)?' defi-selected':''}"><div class="defi-card-head"><span class="defi-status defi-status-${status}">${esc(T(statusName(o.status)))}</span><span class="defi-muted">NODUS / OSD6</span></div><h3>${T('Offer')} #${esc(o.id)}</h3><div class="defi-rate">${esc(format(o.aprBps,2))}%<span>${T('Annual interest')}</span></div><dl class="defi-terms">${row('Principal',`${esc(format(o.principalRaw))} OSD6`)}${row('Collateral',`${esc(format(o.collateralWei,18))} NODUS`)}${row('Term',`${esc(o.termDays)} ${T('days')}`)}</dl><button type="button" class="button defi-card-button" data-defi-live-loan="${esc(o.id)}" aria-pressed="${String(loanId)===String(o.id)}">${T('View details')} <span aria-hidden="true">→</span></button></article>`;
  }
  function loanDetail(){
    const o=loanData?.offers?.find(x=>String(x.id)===String(loanId));if(!o)return '';
    const total=/^\d+$/.test(String(o.principalRaw))&&/^\d+$/.test(String(o.interestRaw))?(BigInt(o.principalRaw)+BigInt(o.interestRaw)).toString():null;
    return `<section id="defi-live-loan-detail" class="panel defi-details" tabindex="-1"><div class="defi-section-head"><div><span class="eyebrow">${T('Loan details')}</span><h2>${T('Offer')} #${esc(o.id)}</h2></div><span class="defi-status">${esc(T(statusName(o.status)))}</span></div><div class="defi-settlement"><div><span>${T('Principal')}</span><strong>${esc(format(o.principalRaw))}<small>OSD6</small></strong></div><span>+</span><div><span>${T('Interest for the full term')}</span><strong>${esc(format(o.interestRaw))}<small>OSD6</small></strong></div><span>=</span><div class="defi-total"><span>${T('Total repayment')}</span><strong>${esc(format(total))}<small>OSD6</small></strong></div></div><dl class="defi-detail-meta">${row('Lender',address(o.lender))}${row('Borrower',address(o.borrower))}${row('Collateral',`${esc(format(o.collateralWei,18))} NODUS`)}${row('Term',`${esc(o.termDays)} ${T('days')}`)}${row('Grace period',`${esc(o.graceDays)} ${T('days')}`)}${row('Offer expires',esc(time(o.expiresAt)))}${Number(o.dueAt)>0?row('Due date',esc(time(o.dueAt)))+row('Grace deadline',esc(time(o.deadline))):''}</dl><p>${T('Direct Nodus signing awaits a supported browser wallet connection. The completed manual OSD6 test does not provide that connection.')}</p><div class="defi-buttons">${button('Accept offer','unavailable',true)}${button('Repay loan','unavailable',true)}${button('Withdraw funds','unavailable',true)}</div></section>`;
  }
  function loans(){
    const data=loanData;
    return `<section class="defi-live-loans"><div class="defi-section-head"><div><span class="eyebrow">NODUS TESTNET · OSD6</span><h2>${T('On-chain OSD6 loan book')}</h2></div>${button(data?'Refresh loan book':'Read loan contract','load-loans',loanLoading)}</div><p>${T('Read the deployed Nodus test contract. These records are separate from TRON test USDT and the practice examples.')}</p><div class="defi-contract-banner"><span class="defi-status">${T('Read-only contract view')}</span><p>${T('Reported by the connected Nodus node; not independently proven against the chain.')}</p></div>${data?.available?`<p class="defi-loan-coverage">${T('Offers shown')}: ${esc(data.coverage?.returnedOffers??data.offers?.length??0)} ${T('of')} ${esc(data.coverage?.totalOffers??'—')}${data.coverage?.complete===false?` · ${T('This is a partial loan history.')}`:''} · ${T('Observed at')}: ${esc(data.observedAt??'—')}</p>`:''}${loanLoading?`<p role="status">${T('Loading loan contract…')}</p>`:data?.available?`<div class="defi-main-grid"><div><div class="defi-offers">${data.offers?.length?data.offers.map(loanCard).join(''):`<p>${T('No offers returned by the contract.')}</p>`}</div></div>${loanDetail()}</div><details class="defi-history"><summary>${T('Loan contract')}</summary><dl class="defi-detail-meta">${row('Token',address(data.tokenAddress))}${row('Loan contract',address(data.lendingAddress))}${row('Observed at',esc(data.observedAt??'—'))}</dl></details>`:`<div class="panel defi-empty"><h3>${T(data?'Loan data unavailable':'On-chain OSD6 loan book')}</h3><p>${esc(T(data?.reason??'Read the contract to see its offers and loans.'))}</p></div>`}${feedback(false)}</section>`;
  }
  function render(){
    if(!root)return;globalThis.NodusDefiPractice?.unmount();
    root.innerHTML=`<div class="defi-workbench defi-browser"><header class="defi-hero"><div><span class="eyebrow">NODUS / DEFI LAB</span><h1>${T('Your DeFi test lab.')}</h1><p>${T('Connect your wallet, explore the tested loan contract and prepare for lending across Nodus and TRON.')}</p></div><span class="defi-network">${T('TEST NETWORKS ONLY')}</span></header><nav class="defi-browser-tabs" aria-label="Test DeFi">${[['wallet','Wallet & test assets'],['loans','Nodus loans'],['practice','Practice']].map(([key,label])=>`<button type="button" data-defi-live-view="${key}" aria-pressed="${view===key}">${T(label)}</button>`).join('')}</nav>${view==='wallet'?`<div class="defi-wallet-layout"><div>${walletCard()}${transactions()}</div><div>${transferCard()}${crossChainCard()}</div></div>`:view==='loans'?loans():'<div id="defi-practice"></div>'}</div>`;
    bind();if(view==='practice')globalThis.NodusDefiPractice?.mount(root.querySelector('#defi-practice'));
  }
  async function loadLoans(){
    const version=++loadVersion;controller?.abort();controller=typeof AbortController==='function'?new AbortController():null;
    loanLoading=true;message='';failed=false;render();
    try{
      const response=await fetch('/api/test-defi',{cache:'no-store',signal:controller?.signal}),data=await response.json();
      if(version!==loadVersion)return;
      if(!data||typeof data!=='object'||!Array.isArray(data.offers))throw Error('invalid');
      loanData=data;if(data.available&&data.offers.length&&!data.offers.some(x=>String(x.id)===String(loanId)))loanId=data.offers[0].id;
    }catch(error){if(version!==loadVersion)return;loanData={available:false,offers:[],reason:'The loan book could not be loaded. Try again.'};failed=true;}
    finally{if(version===loadVersion){loanLoading=false;render();}}
  }
  async function act(action){
    capture();message='';failed=false;
    if(action==='practice'){view='practice';render();return;}
    if(action==='load-loans'){await loadLoans();return;}
    if(action==='cancel-review'){review=null;render();return;}
    if(busy)return;busy=true;render();
    try{
      const w=ensureWallet();
      if(action==='connect')await w.connect(walletState.selectedNetwork);
      else if(action==='disconnect'){w.disconnect();review=null;}
      else if(action==='refresh')await w.refresh();
      else if(action==='reconcile')await w.reconcile();
      else if(action==='network'){review=null;await w.setNetwork(form.network);}
      else if(action==='review-transfer')review=await w.prepareTransfer(form.to,form.amount);
      else if(action==='confirm-transfer'){
        if(!review)throw Error('The wallet or network changed. Review the transfer again.');
        const id=review.id;review=null;const result=await w.submitTransfer(id);
        walletState=w.getState();
        failed=['unknown','signed','failed'].includes(result?.status)||!!walletState.error;
        message=failed?(walletState.error||'Submission is uncertain. Refresh transactions before doing anything again.'):'Transfer submitted. Use Refresh transactions to check confirmation.';
        form={to:'',amount:''};
      }else throw Error('This action is not available.');
      walletState=w.getState();
    }catch(error){failed=true;message=typeof error==='string'?error:error?.message??'This action is not available.';walletState=wallet?.getState()??walletState;}
    finally{busy=false;render();if(review)focusFeedback('#defi-live-review');else if(failed)focusFeedback();}
  }
  function bind(){
    root.querySelectorAll('[data-defi-live-view]').forEach(el=>el.onclick=()=>{capture();view=el.dataset.defiLiveView;message='';failed=false;render();});
    root.querySelectorAll('[data-defi-live-action]').forEach(el=>el.onclick=()=>act(el.dataset.defiLiveAction));
    root.querySelectorAll('[data-defi-live-loan]').forEach(el=>el.onclick=()=>{loanId=el.dataset.defiLiveLoan;render();focusFeedback('#defi-live-loan-detail');});
    const network=root.querySelector('#defi-live-network');if(network)network.onchange=()=>{capture();form.network=network.value;act('network');};
    const transfer=root.querySelector('#defi-live-transfer');if(transfer)transfer.onsubmit=event=>{event.preventDefault();act('review-transfer');};
  }
  globalThis.NodusDefi=Object.freeze({mount(target){capture();root=target;render();},capture,unmount(){capture();globalThis.NodusDefiPractice?.unmount();root=null;},getState:()=>copy({view,wallet:walletState,review,form,message,failed,busy,loanData,loanLoading,loanId,practice:globalThis.NodusDefiPractice?.getState()})});
})();
