/* Scenario exploration only. All calculations come from the Python model. */
(function tokenomicsModule() {
  'use strict';
  const defaults = {months:120,block_seconds:5,validator_reserve_nod:200000000,storage_reserve_nod:100000000,other_locked_nod:200000000,validator_bond_nod:2000000,storage_bond_nod:1000000,initial_validators:8,initial_storage:4,lending_pool_nod:100000000,borrowed_share:0.4,validator_cost_usdt_year:360,storage_cost_usdt_year:1800,validator_entry_per_month:4,storage_entry_per_month:0.1,fees_nod_year:1000000,initial_price_usdt:0.1,demand_growth_pct:0,hoarding_strength:1,required_return_pct:6};
  const presets = {
    baseline:{},
    squeeze:{demand_growth_pct:15,hoarding_strength:3,lending_pool_nod:150000000},
    hardware:{storage_cost_usdt_year:3600,storage_entry_per_month:0.03},
    fees:{fees_nod_year:10000000,demand_growth_pct:0,hoarding_strength:0.5}
  };
  let root=null,parameters={...defaults},result=null,loading=false,error='',initialized=false,controller=null,sequence=0,renderedLanguage='',selected=0,dirty=false,observer=null,detailsOpen=false;
  const lang=()=>globalThis.NodusI18n?.language?.() || (globalThis.NodusI18n?.locale?.()||'fi').slice(0,2);
  const l=(fi,en)=>lang()==='en'?en:fi;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=(value,digits=0)=>Number.isFinite(Number(value))?Number(value).toLocaleString(lang()==='en'?'en-GB':'fi-FI',{maximumFractionDigits:digits}):'—';
  const fields=[
    ['months','Aikajakso','Time horizon','kk','months',12,240,12,1],
    ['lending_pool_nod','Lainapooli alussa','Initial lending pool','milj. NOD','million NOD',0,500,5,1000000],
    ['fees_nod_year','Maksut konsensuspooliin','Fees into consensus pool','milj. NOD/v','million NOD/year',0,100,0.5,1000000],
    ['borrowed_share','Lainalla rahoitettu osuus','Borrowed share of node capital','%','%',0,100,5,0.01],
    ['validator_cost_usdt_year','Validaattorin vuosikulut','Validator annual costs','USDT/v','USDT/year',0,1000000,10,1],
    ['storage_cost_usdt_year','Storagen vuosikulut, laitepoisto mukana','Storage annual costs, hardware included','USDT/v','USDT/year',0,1000000,100,1],
    ['validator_entry_per_month','Uusia validaattoreita enintään','Maximum new validators','nodea/kk','nodes/month',0,32,0.1,1],
    ['storage_entry_per_month','Uusia storage-nodeja enintään','Maximum new storage nodes','nodea/kk','nodes/month',0,256,0.01,1],
    ['demand_growth_pct','Ulkoinen hintakysynnän trendi','External price-demand trend','%/v','%/year',-15,25,1,1],
    ['hoarding_strength','Nousua seuraava jemmaus','Trend-following hoarding','×','×',0,3,0.1,1],
    ['initial_price_usdt','Hinta alussa','Initial price','USDT/NOD','USDT/NOD',0.000001,100,'any',1],
    ['initial_validators','Validaattoreita alussa','Initial validators','nodea','nodes',1,32,1,1],
    ['initial_storage','Storage-nodeja alussa','Initial storage nodes','nodea','nodes',0,256,1,1],
    ['validator_bond_nod','Validaattorin oma stake','Validator self-stake','milj. NOD','million NOD',0.1,100,0.1,1000000],
    ['storage_bond_nod','Storage-bondi','Storage bond','milj. NOD','million NOD',0.1,1,0.1,1000000],
    ['validator_reserve_nod','Validaattorien palkkiovaranto alussa','Initial validator reserve','milj. NOD','million NOD',0,800,10,1000000],
    ['storage_reserve_nod','Storagen palkkiovaranto alussa','Initial storage reserve','milj. NOD','million NOD',0,800,10,1000000],
    ['other_locked_nod','Muihin palveluihin sidotut tokenit','Other locked service reserves','milj. NOD','million NOD',0,800,10,1000000],
    ['block_seconds','Oletettu lohkoaika','Assumed block time','s','s',1,60,1,1],
    ['required_return_pct','Vaadittu nettotuotto','Required net return','%/v','%/year',0,100,0.5,1]
  ];
  const charts=[
    {id:'nodes',fi:'Nodejen määrä',en:'Node count',unit:()=>l('Nodea','Nodes'),series:[['validators','Validaattorit','Validators',1],['storage_nodes','Storage','Storage',2]]},
    {id:'rates',fi:'Palkkiot ja lainakorko',en:'Rewards and borrowing cost',unit:()=>l('% vuodessa','% per year'),series:[['validator_reward_pct','Validaattorin brutto','Validator gross',1],['storage_reward_pct','Storagen brutto','Storage gross',2],['borrow_apr_pct','Lainakorko','Borrow APR',3]]},
    {id:'price',fi:'Mallihinta',en:'Model price',unit:()=>l('Indeksi, alussa 100','Index, initially 100'),series:[['price_index','Hintaindeksi','Price index',4]]},
    {id:'pools',fi:'Palkkiovarannot ja vapaa lainapooli',en:'Reward reserves and available lending',unit:()=>l('Miljoonaa NOD','Million NOD'),scale:1000000,series:[['validator_reserve_nod','Validaattorivaranto','Validator reserve',1],['storage_reserve_nod','Storage-varanto','Storage reserve',2],['lending_cash_nod','Vapaa lainapooli','Available lending',3]]}
  ];
  function capture(){
    if(!root?.querySelector('#tokenomics-simulator'))return;
    for(const field of fields){const input=root.querySelector('#tk-'+field[0]);if(input&&input.value!==''){const n=Number(input.value);if(Number.isFinite(n))parameters[field[0]]=n*field[8];}}
    const details=root.querySelector('#tk-advanced');if(details)detailsOpen=details.open;
  }
  function input(field){const [key,fi,en,ufi,uen,min,max,step,scale]=field;return `<label class="tk-field" for="tk-${key}"><span>${esc(l(fi,en))}</span><span class="tk-input-row"><input id="tk-${key}" name="${key}" type="number" min="${min}" max="${max}" step="${step}" required value="${esc(Number((parameters[key]/scale).toPrecision(12)))}"><span>${esc(l(ufi,uen))}</span></span></label>`;}
  function card(label,value,note=''){return `<div class="tk-kpi"><span>${esc(label)}</span><strong>${esc(value)}</strong>${note?`<small>${esc(note)}</small>`:''}</div>`;}
  function render(){
    if(!root)return;
    renderedLanguage=lang();
    const end=result?.series?.at(-1);
    root.innerHTML=`<div class="tk-simulator" id="tokenomics-simulator"><header class="tk-heading"><div><span class="eyebrow">${esc(l('TOKENOMICS / SKENAARIOT','TOKENOMICS / SCENARIOS'))}</span><h1>${esc(l('Noduksen kristallipallo.','Nodus crystal ball.'))}</h1><p>${esc(l('Tutki nodejen, lainamarkkinan ja rajallisten palkkiovarantojen yhteispeliä.','Explore nodes, lending markets and finite reward reserves together.'))}</p></div><span class="tk-badge">${esc(l('OLETUSMALLI · EI LIVE-DATAA','ASSUMPTION MODEL · NOT LIVE DATA'))}</span></header>
      <form id="tk-form" class="panel tk-controls"><div class="tk-control-head"><label class="tk-preset" for="tk-preset">${esc(l('Skenaarion lähtökohta','Scenario starting point'))}<select id="tk-preset" class="select"><option value="custom">${esc(l('Omat oletukset','Custom assumptions'))}</option><option value="baseline">${esc(l('Perusskenaario','Baseline'))}</option><option value="squeeze">${esc(l('Nousu ja jemmaus','Rally and hoarding'))}</option><option value="hardware">${esc(l('Storagen korkea laitekynnys','High storage hardware barrier'))}</option><option value="fees">${esc(l('Suuremmat maksutulot','Higher fee revenue'))}</option></select></label><button class="button primary" type="submit" id="tk-run" ${loading?'disabled':''}>${esc(loading?l('Lasketaan…','Calculating…'):l('Simuloi','Simulate'))}</button></div>
      <div class="tk-fields">${fields.slice(0,8).map(input).join('')}</div><p class="tk-note">${esc(l('Storage käyttää oletuksena korkeampia vuosikuluja ja hitaampaa sisääntuloa. Molemmat ovat muokattavia oletuksia.','Storage assumes higher annual costs and slower entry. Both are editable assumptions.'))}</p>
      <details id="tk-advanced" ${detailsOpen?'open':''}><summary>${esc(l('Markkina- ja ketjuoletukset','Market and chain assumptions'))}</summary><div class="tk-fields">${fields.slice(8).map(input).join('')}</div></details><div id="tk-feedback" class="tk-feedback" role="status" aria-live="polite">${esc(error|| (loading?l('Python-malli laskee skenaariota.','The Python model is calculating this scenario.'):dirty?l('Oletuksia muutettu. Paina Simuloi.','Assumptions changed. Select Simulate.'):l('Skenaario lasketaan paikallisesti ilman ketjutapahtumia.','The scenario is calculated locally without chain transactions.')))}</div></form>
      ${result?`<div class="tk-results"><div class="tk-kpis">${card(l('Validaattoreita lopussa','Final validators'),num(end.validators,1),l('Aktiivijoukon katto 32','Active-set ceiling 32'))}${card(l('Storage-nodeja lopussa','Final storage nodes'),num(end.storage_nodes,1),l('Laitekynnys ja sisääntuloraja mukana','Hardware costs and entry limit included'))}${card(l('Mallihinta lopussa','Final model price'),num(end.price_usdt,5)+' USDT',l('Oletuksiin perustuva hintamalli','Assumption-based price model'))}${card(l('Lainapoolin käyttöaste lopussa','Final lending utilization'),num(end.utilization_pct,1)+' %',l('Lainasaatavat eivät luo tokeneita','Loan claims do not create tokens'))}</div><div class="tk-inspect"><label for="tk-month">${esc(l('Tarkastele kuukautta','Inspect month'))} <output id="tk-month-label">${selected}</output></label><input id="tk-month" type="range" min="0" max="${result.series.length-1}" step="1" value="${selected}" aria-label="${esc(l('Tarkasteltava kuukausi','Selected month'))}"></div><div class="tk-charts">${charts.map(c=>`<section class="panel tk-chart-panel"><h2>${esc(l(c.fi,c.en))}</h2><div class="tk-legend">${c.series.map(s=>`<span><i class="tk-color-${s[3]}"></i>${esc(l(s[1],s[2]))}</span>`).join('')}</div><div data-tk-chart="${c.id}"></div><div class="tk-chart-readout" id="tk-readout-${c.id}"></div></section>`).join('')}</div><details class="panel tk-assumptions" id="tk-result-details"><summary>${esc(l('Laskettu skenaario, oletukset ja tokenien jakauma','Calculated scenario, assumptions and token distribution'))}</summary><p>${esc(l('Luvut ovat skenaarioita, eivät testnetin tämänhetkisiä saldoja. Vaihdetut kentät vaikuttavat tuloksiin vasta Simuloi-painikkeella.','Values describe scenarios, not current testnet balances. Changed fields affect results only after selecting Simulate.'))}</p><div id="tk-supply"></div><p>${esc(l('Miljardi NOD säilyy fyysisissä saldoissa. Lainasaatavat ja maksamattomat korot ovat erillisiä vaateita. Nodejen määrät ovat jatkuvia keskiarvioita.','One billion NOD is conserved in physical balances. Loan claims and unpaid interest are separate claims. Node counts are continuous aggregate estimates.'))}</p><ul><li>${esc(l('Molempien palkkiobudjetti perustuu jäljellä olevaan pottiin / 65 536 per epoch. Maksut palautuvat vain konsensuspooliin.','Both reward budgets depend on the remaining pool / 65,536 each epoch. Fees replenish only the consensus pool.'))}</li><li>${esc(l('Storagen arkistopainot ja validaattorien panokset yksinkertaistetaan roolin keskimääräiseksi tuotoksi. Validaattorijonoa ei mallinneta.','Archive weights and validator stakes are simplified into average role returns. A waiting validator queue is not modeled.'))}</li><li>${esc(l('Hinta, jemmaus, lainakorko ja nodejen liittyminen ovat käyttäytymisoletuksia. Malli ei sisällä USDT-vakuuksien likvidointeja, luottotappioita, slashingia tai lukkojen vapautusviiveitä.','Price, hoarding, borrowing rates and node entry are behavioral assumptions. The model omits USDT collateral liquidation, defaults, slashing and unbonding delays.'))}</li></ul><div class="tk-exports"><button type="button" class="button" id="tk-export-json">${esc(l('Lataa laskettu skenaario JSON','Download calculated scenario JSON'))}</button><button type="button" class="button" id="tk-export-csv">${esc(l('Lataa tulokset CSV','Download results CSV'))}</button></div><pre class="tk-parameter-dump">${esc(JSON.stringify(result.parameters,null,2))}</pre></details></div>`:!loading?`<section class="panel tk-empty"><h2>${esc(l('Simulaatio odottaa Python-palvelinta','Simulation needs the Python server'))}</h2><p>${esc(l('Näytämme vain palvelimen laskemat tulokset. Tarkista Observatoryn asennus ja yritä uudelleen.','Only server-calculated results are shown. Check the Observatory installation and retry.'))}</p><button class="button" id="tk-retry">${esc(l('Yritä uudelleen','Try again'))}</button></section>`:''}
      <details class="panel tk-assumptions"><summary>${esc(l('Määritysten lähteet','Protocol sources'))}</summary><p>${esc(l('Nodus-lähdekoodin viiteversio, ei aktiivisten hallintaparametrien live-luku.','Reference version of Nodus source, not a live read of active governance parameters.'))}</p><ul>${[['nodus/tools/genesis/testnet_v3.conf.template',l('Genesis ja alkujako','Genesis and allocation')],['nodus/src/witness/nodus_witness_v2_econ.c',l('Validaattoripalkkiot','Validator rewards')],['nodus/src/witness/nodus_witness_v2_storage.c',l('Storage-palkkiot','Storage rewards')],['dnac/include/dnac/dnac.h',l('Panokset ja rajat','Bonds and limits')]].map(([p,title])=>`<li><a href="https://github.com/nocdem/dna/blob/d9cefb4fcf2e2e9ce073cedacaff45caa93c8e2c/${p}" target="_blank" rel="noopener noreferrer">${esc(title)}</a></li>`).join('')}</ul></details></div>`;
    bind();drawCharts();
    observer?.disconnect();
    if(typeof ResizeObserver!=='undefined'){observer=new ResizeObserver(()=>drawCharts());root.querySelectorAll('[data-tk-chart]').forEach(el=>observer.observe(el));}
  }
  function validPayload(payload){return payload?.schema_version===1&&payload.parameters&&Array.isArray(payload.series)&&payload.series.length>=2&&payload.series.length<=241&&payload.series.every(p=>charts.every(c=>c.series.every(s=>Number.isFinite(p[s[0]]))))&&payload.series.every(p=>Number.isFinite(p.month)&&Number.isFinite(p.price_usdt)&&Number.isFinite(p.utilization_pct));}
  async function run(useDefaults=false){
    capture();error='';loading=true;dirty=false;const requestParameters={...parameters};controller?.abort();controller=new AbortController();const current=++sequence;const activeController=controller,signal=activeController.signal;
    render();let timer=setTimeout(()=>activeController.abort(),20000);
    try{
      const response=await fetch('/api/tokenomics'+(useDefaults?'':'?p='+encodeURIComponent(JSON.stringify(requestParameters))),{cache:'no-store',signal});
      const payload=await response.json();if(!response.ok)throw Error(typeof payload.error==='string'?payload.error:l('Simulaation laskenta epäonnistui.','Simulation failed.'));
      if(!validPayload(payload))throw Error(l('Simulaation vastaus on virheellinen.','The simulation response is invalid.'));
      if(current!==sequence)return;
      capture();result=payload;selected=payload.series.length-1;if(!dirty)parameters={...payload.parameters};
    }catch(e){if(current===sequence)error=e?.name==='AbortError'?l('Laskennan aikaraja ylittyi. Yritä uudelleen.','Calculation timed out. Try again.'):String(e?.message||e);}
    finally{clearTimeout(timer);if(current===sequence){capture();loading=false;render();}}
  }
  function bind(){
    root.querySelector('#tk-form').onsubmit=e=>{e.preventDefault();run();};
    root.querySelectorAll('[name]').forEach(input=>input.addEventListener('input',()=>{dirty=true;capture();const status=root.querySelector('#tk-feedback');if(status)status.textContent=l('Oletuksia muutettu. Paina Simuloi.','Assumptions changed. Select Simulate.');}));
    root.querySelector('#tk-preset').onchange=e=>{if(e.target.value==='custom')return;parameters={...defaults,...presets[e.target.value]};dirty=false;render();run();};
    const month=root.querySelector('#tk-month');if(month)month.oninput=()=>selectMonth(+month.value);
    const retry=root.querySelector('#tk-retry');if(retry)retry.onclick=()=>run();
    const json=root.querySelector('#tk-export-json');if(json)json.onclick=()=>download(JSON.stringify(result,null,2)+'\n','application/json','nodus-tokenomics-scenario.json');
    const csv=root.querySelector('#tk-export-csv');if(csv)csv.onclick=()=>{const keys=Object.keys(result.series[0]);download(keys.join(',')+'\n'+result.series.map(row=>keys.map(k=>Number.isFinite(row[k])?row[k]:'').join(',')).join('\n')+'\n','text/csv','nodus-tokenomics-scenario.csv');};
  }
  function download(text,type,name){const blob=new Blob([text],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function selectMonth(index){if(!result)return;selected=Math.max(0,Math.min(result.series.length-1,index));const slider=root?.querySelector('#tk-month');if(slider)slider.value=selected;const label=root?.querySelector('#tk-month-label');if(label)label.textContent=num(result.series[selected].month);drawCharts();}
  function drawCharts(){
    if(!root||!result)return;
    const rows=result.series,chosen=rows[selected]||rows.at(-1);
    for(const chart of charts){
      const host=root.querySelector('[data-tk-chart="'+chart.id+'"]');if(!host)continue;
      const width=Math.max(220,Math.round(host.getBoundingClientRect().width)),height=232,left=62,right=width-16,top=28,bottom=184,scale=chart.scale||1;
      const maximum=Math.max(0,...rows.flatMap(row=>chart.series.map(s=>row[s[0]]/scale))),ceiling=maximum>0?maximum*1.08:1,last=rows.at(-1).month;
      const x=month=>left+(right-left)*month/last,y=value=>bottom-(bottom-top)*Math.max(0,value)/ceiling;
      const tick=value=>value>=1000000?num(value/1000000,1)+'M':value>=10000?num(value/1000,1)+'k':num(value,value>0&&value<1?2:0);
      let svg=`<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(l(chart.fi,chart.en))}"><title>${esc(l(chart.fi,chart.en))}</title><text x="${left}" y="15">${esc(chart.unit())}</text>`;
      for(let i=0;i<=4;i++){const value=ceiling*i/4,pos=y(value);svg+=`<line class="tk-grid-line" x1="${left}" x2="${right}" y1="${pos}" y2="${pos}"/><text x="${left-9}" y="${pos+4}" text-anchor="end">${esc(tick(value))}</text>`;}
      const ticks=width<400?3:4;for(let i=0;i<=ticks;i++){const month=last*i/ticks;svg+=`<text x="${x(month)}" y="${bottom+20}" text-anchor="${i===0?'start':i===ticks?'end':'middle'}">${esc(num(month/12,1))}</text>`;}
      svg+=`<text x="${(left+right)/2}" y="225" text-anchor="middle">${esc(l('Aika / vuotta','Time / years'))}</text>`;
      chart.series.forEach((s,i)=>{const d=rows.map((r,j)=>`${j?'L':'M'}${x(r.month).toFixed(2)},${y(r[s[0]]/scale).toFixed(2)}`).join(' ');svg+=`<path class="tk-line tk-stroke-${s[3]}" d="${d}" ${i?'stroke-dasharray="'+(i===1?'6 4':'2 4')+'"':''}/>`;});
      svg+=`<line class="tk-guide" x1="${x(chosen.month)}" x2="${x(chosen.month)}" y1="${top}" y2="${bottom}"/>`;
      chart.series.forEach(s=>{svg+=`<circle class="tk-fill-${s[3]}" cx="${x(chosen.month)}" cy="${y(chosen[s[0]]/scale)}" r="3"/>`;});
      svg+=`<rect data-tk-hit="${chart.id}" x="${left}" y="${top}" width="${right-left}" height="${bottom-top}" fill="transparent"/></svg>`;host.innerHTML=svg;
      const hit=host.querySelector('[data-tk-hit]');if(hit){const inspect=e=>{const box=host.getBoundingClientRect();const fraction=Math.max(0,Math.min(1,(e.clientX-box.left-left)/(right-left)));selectMonth(Math.round(fraction*(rows.length-1)));};hit.onpointerdown=inspect;hit.onclick=inspect;}
      const readout=root.querySelector('#tk-readout-'+chart.id);if(readout)readout.textContent=l('Kuukausi ','Month ')+num(chosen.month)+' · '+chart.series.map(s=>l(s[1],s[2])+': '+num(chosen[s[0]]/scale,chart.id==='nodes'?1:2)).join(' · ');
    }
    const supply=root.querySelector('#tk-supply');if(supply){const stocks=[['validator_reserve_nod','Validaattorivaranto','Validator reserve'],['storage_reserve_nod','Storage-varanto','Storage reserve'],['other_locked_nod','Muut sidotut varannot','Other locked reserves'],['validator_locked_nod','Validaattoreihin sidottu','Validator locks'],['storage_locked_nod','Storageen sidottu','Storage locks'],['lending_cash_nod','Vapaa lainapooli','Available lending'],['wallet_nod','Muut lompakot','Other wallets']];supply.innerHTML=`<table class="tk-table"><caption>${esc(l('Kuukausi ','Month ')+num(chosen.month))}</caption><tbody>${stocks.map(([key,fi,en])=>`<tr><th scope="row">${esc(l(fi,en))}</th><td>${esc(num(chosen[key]/1000000,3))} ${esc(l('milj. NOD','million NOD'))}</td></tr>`).join('')}<tr><th scope="row">${esc(l('Maksamattomat korot (erillinen vaade)','Unpaid interest (separate claim)'))}</th><td>${esc(num(chosen.arrears_nod,2))} NOD</td></tr></tbody></table>`;}
  }
  globalThis.NodusTokenomics=Object.freeze({mount(target){const same=root===target&&!!root?.querySelector('#tokenomics-simulator');capture();root=target;if(same&&renderedLanguage===lang())return;render();if(!initialized){initialized=true;run(true);}},capture,unmount(){capture();observer?.disconnect();observer=null;controller?.abort();sequence++;loading=false;root=null;},getState(){return {parameters:{...parameters},result,loading,error,dirty,selected};}});
})();
