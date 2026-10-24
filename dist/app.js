'use strict';

const t = (...args) => NodusI18n.t(...args);
const locale = () => NodusI18n.locale();

const ICONS = {
  settings:'<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm-2-5h4l1 3 3 1 3-1 2 4-2 2v3l2 2-2 4-3-1-3 1-1 3h-4l-1-3-3-1-3 1-2-4 2-2v-3L1 10l2-4 3 1 3-1z"/>',
  grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  database:'<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 4 16 4 16 0V5M4 12v7c0 4 16 4 16 0v-7"/>',
  network:'<circle cx="12" cy="5" r="3"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/><path d="m10.5 7.5-4 9m7-9 4 9M8 19h8"/>',
  wallet:'<path d="M20 7H5a2 2 0 0 1 0-4h13v4M3 5v14a2 2 0 0 0 2 2h15V7M20 12h-5v5h5"/><path d="M17 14.5h.1"/>',
  activity:'<path d="M2 12h5l3-8 4 16 3-8h5"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 10v7m0-10v.1"/>',
  lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  refresh:'<path d="M20 8a8 8 0 0 0-14-3L3 8m0-6v6h6M4 16a8 8 0 0 0 14 3l3-3m0 6v-6h-6"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  menu:'<path d="M3 6h18M3 12h18M3 18h18"/>',
  check:'<path d="m5 12 4 4 10-10"/>',
  cpu:'<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 3v3m6-3v3m-6 12v3m6-3v3M3 9h3m-3 6h3m12-6h3m-3 6h3"/>',
  memory:'<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 18v3m5-3v3m5-3v3M7 3v3m5-3v3m5-3v3M7 10h3v4H7zm7 0h3v4h-3z"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  download:'<path d="M12 3v12m-4-4 4 4 4-4M4 15v6h16v-6"/>',
  copy:'<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  layers:'<path d="m3 8 9-5 9 5-9 5-9-5zm0 5 9 5 9-5m-18 5 9 5 9-5"/>',
  arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>',
  shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3z"/><path d="m8 12 3 3 5-6"/>',
  globe:'<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  receipt:'<path d="M5 3v18l3-2 4 2 4-2 3 2V3l-3 2-4-2-4 2-3-2zm4 6h6m-6 4h6m-6 4h3"/>',
  temperature:'<path d="M9 14V5a3 3 0 0 1 6 0v9a5 5 0 1 1-6 0zm3-7v10"/>',
  file:'<path d="M14 3H5v18h14V8l-5-5zm0 0v5h5M8 12h8m-8 4h6"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.activity}</svg>`;
function hydrateIcons(root=document){root.querySelectorAll('[data-icon]').forEach(el=>{el.innerHTML=icon(el.dataset.icon);});}
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const finite = value => value!==null && value!==undefined && value!=='' && Number.isFinite(Number(value));
const number = (value,digits=0) => finite(value) ? Number(value).toLocaleString(locale(),{maximumFractionDigits:digits,minimumFractionDigits:digits}) : '—';
const int = value => number(value);
const shortFp = value => value ? `${value.slice(0,16)}…${value.slice(-8)}` : t('Ei saatavilla');
const bytes = (value,digits=1) => {if(!finite(value))return '—'; const n=Number(value); const units=['B','KiB','MiB','GiB','TiB'];const e=n>0?Math.min(4,Math.floor(Math.log(n)/Math.log(1024))):0;return `${number(n/(1024**e),e===0?0:digits)} ${units[e]}`;};
const dateTime = value => {const d=new Date(value);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat(locale(),{timeZone:'Europe/Helsinki',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(d):t('Ajankohta puuttuu');};
const compactDate = value => {const d=new Date(value);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat(locale(),{timeZone:'Europe/Helsinki',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(d):'—';};
const rawNodus = value => {if(value===null||value===undefined)return '—';try{const n=BigInt(value),abs=n<0n?-n:n;return decimalFi(`${n<0n?'-':''}${abs/100000000n}.${(abs%100000000n).toString().padStart(8,'0')}`);}catch{return '—';}};
const state = {dashboard:null,history:{points:[]},network:null,rewards:null,events:null,mode:'loading',page:'overview',hours:24,year:2026,eventFilter:'all',rewardsYear:null,rewardsSnapshot:null,rewardMonth:null,rewardDay:null,rewardDailyMonth:null,rewardPeriod:'monthly',loading:false,loadedAt:null,failedSources:[],loadError:null,monitorSettings:null};
const PAGES = {statistics:'Tilastot',trade:'Kaupankäynti',overview:'Yleiskuva',storage:'Tallennustila',network:'Verkko',rewards:'Palkkiot',events:'Tapahtumat',witness:'Todistaja',settings:'Asetukset',contracts:'Sopimusstudio','contracts-escrow':'Escrow-esimerkki','contracts-editor':'Visuaalinen sopimuseditori'};
let toastTimer,refreshTimer;
const SOURCE_NAMES = {dashboard:'Seurantatiedot',history:'Historia',network:'Verkko',rewards:'Palkkiot',events:'Tapahtumat'};
const BACKEND_TEXT_KEYS = {
  "ACTIVE": "Aktiivinen",
  "INACTIVE": "Ei aktiivinen",
  "SUSPENDED": "Keskeytetty",
  "RETIRED": "Poistunut",
  "UNREGISTERED": "Ei rekisteröity",
  "not_registered": "Ei rekisteröity",
  "Source contains an invalid integer": "Lähteessä on virheellinen kokonaisluku",
  "Expected a lowercase hexadecimal identifier": "Odotettiin pienillä kirjaimilla kirjoitettua heksatunnistetta",
  "Negative amount": "Negatiivinen määrä",
  "A nonnegative decimal string is required": "Arvon on oltava ei-negatiivinen desimaaliluku",
  "Invalid decimal": "Virheellinen desimaaliluku",
  "Source is not a regular file": "Lähde ei ole tavallinen tiedosto",
  "Unknown network label": "Tuntematon verkon nimi",
  "Invalid row budget": "Virheellinen riviraja",
  "Reporting ledger must be a separate database": "Raportoinnin kirjanpidon on oltava erillinen tietokanta",
  "Source database filename does not match the observed chain": "Lähdetietokannan nimi ei vastaa havaittua ketjua",
  "Chain height is unavailable": "Ketjun korkeus ei ole saatavilla",
  "Ambiguous pending reward": "Odottava palkkio on epäselvä",
  "Address-history coverage is stale or inconsistent": "Osoitehistorian kattavuus on vanhentunut tai ristiriitainen",
  "Reward row budget exceeded; collection was not marked complete": "Palkkioiden riviraja ylitettiin; keruuta ei merkitty kattavaksi",
  "Malformed native boundary reward row": "Virheellinen natiivin maksupäiväpalkkion rivi",
  "Official Scan history imported; source coverage is shown separately.": "Virallisen Scan-palvelun historia on tuotu. Lähteiden kattavuus näytetään erikseen.",
  "Public Scan history collection is disabled.": "Julkisen Scan-historian keruu ei ole käytössä.",
  "Scan history has not been collected.": "Scan-historiaa ei ole vielä kerätty.",
  "Stored rewards are available; local history is unavailable or incomplete.": "Tallennetut palkkiot ovat saatavilla. Paikallinen historia puuttuu tai on osittainen.",
  "Local history is available; the last Scan history refresh failed.": "Paikallinen historia on saatavilla. Viimeisin Scan-historian päivitys epäonnistui.",
  "The official Scan source supports only its pinned testnet chain": "Virallinen Scan-lähde tukee vain siihen määritettyä testnet-ketjua",
  "A different chain requires a separate reporting ledger": "Toinen ketju edellyttää erillistä raportointikirjanpitoa",
  "A different owner requires a separate reporting ledger": "Toinen omistaja edellyttää erillistä raportointikirjanpitoa",
  "An existing payout changed; refusing to overwrite accounting history": "Tallennettu maksu muuttui; kirjanpitohistorian korvaaminen estettiin",
  "Annual report exceeds the row budget": "Vuosiraportti ylittää rivirajan",
  "Year must be 1970..9998": "Vuoden on oltava väliltä 1970–9998",
  "Failed to fetch": "Tietolähdettä ei tavoitettu",
  "NetworkError when attempting to fetch resource.": "Verkkovirhe tietolähdettä haettaessa"
};
function dataText(value){return value===null||value===undefined?'':t(BACKEND_TEXT_KEYS[value]||value);}
function renderLoadError(){
  if(['#contracts','#contracts-escrow','#contracts-editor','#trade','#settings','#statistics'].includes(location.hash)){render();return;}
  const banner=document.querySelector('#source-banner');banner.classList.remove('live');banner.style.color='var(--amber)';
  document.querySelector('#source-label').textContent=t('Tietojen lataus epäonnistui');
  document.querySelector('#source-detail').textContent=t('TIETOLÄHDE PUUTTUU');
  const error=state.loadError;
  const detail=error?.sourceFile?t('Tietolähdettä {file} ei voitu lukea.',{file:error.sourceFile}):dataText(error?.message||'');
  document.querySelector('#page-content').innerHTML=`<div class="panel page-error"><span class="eyebrow">${t('TIETOLÄHDE PUUTTUU')}</span><h1>${t('Seurantatietoja ei voitu ladata.')}</h1><p class="muted">${t('Yritä päivittää tiedot uudelleen.')}</p><pre>${esc(detail)}</pre><button class="button" id="retry">${t('Yritä uudelleen')}</button></div>`;
  document.querySelector('#retry').onclick=()=>loadData(true);
}


async function getData(api,file){
  const controller=new AbortController(); const timeout=setTimeout(()=>controller.abort(),4500);
  try{const response=await fetch(api,{cache:'no-store',signal:controller.signal});if(!response.ok)throw Error(response.status);const data=await response.json();if(data.error&&!data.node&&!data.source&&!data.stats)throw Error('no data');return {data,mode:data.preview===true?'snapshot':'live'};}catch(error){const response=await fetch(file,{cache:'no-store'});if(!response.ok)throw Object.assign(new Error('Data source unavailable'),{sourceFile:file});return {data:await response.json(),mode:'snapshot'};}finally{clearTimeout(timeout);}
}
async function loadData(userRefresh=false){
  if(state.loading)return;state.loading=true;document.querySelector('#refresh').classList.add('spin');
  try{
    const results=await Promise.allSettled([
      getData('/api/dashboard','snapshot.json'), getData(`/api/history?hours=${state.hours}`,'history.json'), getData('/api/network','network.json'),getData(`/api/rewards?year=${state.year}`,'rewards.json'),getData('/api/events','events.json')
    ]);
    const keys=['dashboard','history','network','rewards','events'];
    state.failedSources=[];
    results.forEach((result,i)=>{if(result.status==='fulfilled'){state[keys[i]]=result.value.data;if(i===0)state.mode=result.value.mode;if(i===3&&result.value.mode==='snapshot')state.rewardsSnapshot=result.value.data;}else if(i===0)throw result.reason;else state.failedSources.push(keys[i]);});
    state.loadedAt=new Date().toISOString();state.rewardsYear=state.year;state.loadError=null;render();
    clearTimeout(refreshTimer);if(state.mode==='live')refreshTimer=setTimeout(()=>loadData(false),60000);
    if(userRefresh)toast(state.mode==='snapshot'?'Synteettinen demo ladattu. Nämä eivät ole palvelinmittauksia.':'Seurantatiedot päivitetty.');
  }catch(error){state.loadError=error;renderLoadError();}
  finally{state.loading=false;document.querySelector('#refresh').classList.remove('spin');}
}
function collectionErrors(){const errors=state.dashboard?.quality?.errors;const roles=configuredRoles();return Array.isArray(errors)?errors.filter(error=>error&&typeof error==='object'&&(roles.storage||!/^storage(?:-|$)/.test(error.source||''))&&(roles.witness||!/^witness(?:-|$)/.test(error.source||''))):[];}
function collectionPartial(){return collectionErrors().length>0||(state.dashboard?.quality?.partial===true&&!(state.dashboard?.quality?.errors||[]).length);}
function collectionErrorText(message){
  const text=String(message||'');
  const exit=text.match(/^probe exited with code (-?\d+)$/);
  if(exit)return t('Kysely päättyi virhekoodiin {code}.',{code:exit[1]});
  if(text==='command timed out')return t('Kyselyn aikaraja ylittyi.');
  if(text==='status output did not contain a parseable height')return t('Tilavastauksesta puuttuu luettava lohkokorkeus.');
  return dataText(text);
}
function collectionNotice(){
  if(!collectionPartial())return '';
  const errors=collectionErrors(),nodeQueryFailed=errors.some(error=>['nodus-status','storage-status'].includes(error.source));
  return `<div class="notice" role="status"><span data-icon="info"></span><div><strong>${t('Osa seurantatiedoista puuttuu.')}</strong> ${t('Puuttuva tilatieto ei tarkoita, että node olisi menettänyt rekisteröintinsä.')}${nodeQueryFailed?`<br>${t('Noduksen tilakysely epäonnistui. Tarkista nodus-cli-ohjelman versio ja yhteys nodeen.')}`:''}${errors.length?`<ul>${errors.map(error=>`<li><code>${esc(error.source||t('Kerääjä'))}</code>: ${esc(collectionErrorText(error.message))}</li>`).join('')}</ul>`:''}</div></div>`;
}
function syncPill(){
  const behind=state.dashboard.chain?.behind;
  if(!finite(behind))return pill(t('Tila ei saatavilla'),'muted');
  return pill(Number(behind)===0?t('Synkronissa'):t('Synkronoidaan'),Number(behind)===0?'':'amber');
}
function membershipPill(){
  const member=state.dashboard.storage?.is_member;
  return pill(member===true?t('Epochin jäsen'):member===false?t('Ei epochin jäsen'):t('Epoch-jäsenyys ei saatavilla'),member===true?'':member===false?'amber':'muted');
}
function sourceBanner(){
  const d=state.dashboard||{},savedAt=d.generated_at||d.timestamp;
  const banner=document.querySelector('#source-banner');banner.classList.toggle('live',state.mode==='live');
  const stale=state.mode==='live'&&(d.freshness?.stale===true||d.freshness?.available===false||Date.now()-new Date(savedAt).getTime()>(d.stale_after_seconds||180)*1000);
  document.querySelector('#source-label').textContent=state.mode==='live'?`${t('{source} · päivitetty {time}',{source:stale?t('VANHENTUNUT TILANNE'):collectionPartial()?t('OSITTAINEN TILANNE'):t('Paikallinen kerääjä'),time:dateTime(savedAt)})}${state.failedSources.length?' · '+t('Osa lähteistä ei vastaa: {sources}',{sources:state.failedSources.map(key=>t(SOURCE_NAMES[key]||key)).join(', ')}):''}`:t('Synteettinen demo · {time} · ei palvelinmittauksia',{time:dateTime(savedAt)});
  if(stale||state.failedSources.length||collectionPartial()){banner.classList.remove('live');banner.style.color='var(--amber)';}else banner.style.color='';
  document.querySelector('#source-detail').textContent=state.mode==='live'?(collectionPartial()?t('OSITTAINEN MITTAUS'):t('PÄIVITYSVÄLI 60 S')):t('DEMO / EI LIVE-DATAA');
}
function heading(kicker,title,description,extra=''){return `<div class="page-heading"><div><span class="eyebrow">${kicker}</span><h1>${title}</h1><p>${description}</p></div>${extra||`<div class="heading-meta">${esc(nodeDisplayName())} <strong> / </strong> ${esc(roleLabel())}</div>`}</div>`;}
function pill(text,type='',dot=true){return `<span class="pill ${type}">${dot?`<span class="tiny-dot"></span>`:''}${text}</span>`;}
function metric(label,value,note,ico,cls=''){return `<div class="panel metric ${cls}"><div class="metric-label">${label}<span data-icon="${ico}"></span></div><div class="metric-value">${value}</div><div class="metric-note">${note}</div></div>`;}
function panelHead(title,sub,extra=''){return `<div class="panel-head"><div><h2 class="panel-title">${title}</h2>${sub?`<p class="panel-subtitle">${sub}</p>`:''}</div>${extra}</div>`;}
function empty(title,text,ico='activity',small=false){return `<div class="empty ${small?'small':''}"><span class="empty-icon" data-icon="${ico}"></span><h3>${title}</h3><p>${text}</p></div>`;}
function rangeTabs(){return `<div class="range-tabs" aria-label="${esc(t("Kuvaajan aikaväli"))}">${[[24,'24 h'],[168,'7 pv'],[720,'30 pv']].map(([h,l])=>`<button class="${state.hours===h?'active':''}" data-range="${h}" aria-pressed="${state.hours===h}">${t(l)}</button>`).join('')}</div>`;}
function dataPoints(){const all=state.history?.points||state.history?.history||[];const sorted=all.filter(p=>p.timestamp&&Number.isFinite(new Date(p.timestamp).getTime())).sort((a,b)=>new Date(a.timestamp)-new Date(b.timestamp));if(!sorted.length)return[];const end=state.mode==='snapshot'?new Date(sorted.at(-1).timestamp).getTime():Date.now();return sorted.filter(p=>new Date(p.timestamp).getTime()>=end-state.hours*3600000);}
function lineChart(series,{height=210,yType='number',emptyTitle=t('Historia kertyy ensimmäisistä mittauksista'),emptyText=t('Kuvaaja näyttää vain tallennetut havaintopisteet. Mittausten puuttuessa arvoja ei arvioida.')}={}){
  const all=dataPoints(),valid=all.filter(p=>series.some(s=>finite(p[s.key])));
  if(valid.length<2)return empty(emptyTitle,emptyText,'activity');
  const w=750,h=height,l=56,r=15,yTop=22,b=37,xMin=new Date(valid[0].timestamp).getTime(),xMax=new Date(valid.at(-1).timestamp).getTime();
  const values=valid.flatMap(p=>series.filter(s=>finite(p[s.key])).map(s=>Number(p[s.key])));let yMax=Math.max(...values),yMin=Math.min(0,...values);if(yMax===yMin)yMax=yMin+1;
  if(yType==='percent'){yMin=0;yMax=Math.max(100,yMax);}
  const x=p=>l+(new Date(p.timestamp).getTime()-xMin)/(xMax-xMin||1)*(w-l-r);const y=v=>yTop+(1-(Number(v)-yMin)/(yMax-yMin))*(h-yTop-b);const format=v=>yType==='bytes'?bytes(v,0):yType==='percent'?`${int(v)} %`:Math.abs(v)>=1000?`${number(v/1000,Math.abs(v)%1000===0?0:1)}k`:int(v);
  let result=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(t('{series}, {count} tallennettua havaintoa',{series:series.map(s=>s.name).join(t(' ja ')),count:int(valid.length)}))}"><defs><linearGradient id="chart-fill-${state.page}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#5de0df" stop-opacity=".13"/><stop offset="100%" stop-color="#5de0df" stop-opacity="0"/></linearGradient></defs>`;
  for(let i=0;i<4;i++){const value=yMin+(yMax-yMin)*i/3;const pos=y(value);result+=`<line class="grid-line" x1="${l}" y1="${pos}" x2="${w-r}" y2="${pos}"/><text x="${l-10}" y="${pos+3}" text-anchor="end">${esc(format(value))}</text>`;}
  [0,.25,.5,.75,1].forEach((ratio,i)=>{const ts=xMin+(xMax-xMin)*ratio;const label=new Intl.DateTimeFormat(locale(),{timeZone:'Europe/Helsinki',hour:'2-digit',minute:'2-digit',...(state.hours>24?{day:'2-digit',month:'2-digit'}:{})}).format(new Date(ts));result+=`<text x="${l+(w-l-r)*ratio}" y="${h-10}" text-anchor="${i===0?'start':i===4?'end':'middle'}">${esc(label)}</text>`;});
  series.forEach((s,index)=>{
    const pts=all.filter(p=>finite(p[s.key]));if(!pts.length)return;
    const segments=[];let segment=[];
    all.forEach(p=>{if(finite(p[s.key]))segment.push(p);else if(segment.length){segments.push(segment);segment=[];}});
    if(segment.length)segments.push(segment);
    const path=segments.map(points=>points.map((p,i)=>`${i?'L':'M'}${x(p).toFixed(2)},${y(p[s.key]).toFixed(2)}`).join(' ')).join(' ');
    if(index===0)segments.filter(points=>points.length>1).forEach(points=>{const area=points.map((p,i)=>`${i?'L':'M'}${x(p).toFixed(2)},${y(p[s.key]).toFixed(2)}`).join(' ');result+=`<path d="${area} L${x(points.at(-1)).toFixed(2)},${h-b} L${x(points[0]).toFixed(2)},${h-b}Z" fill="url(#chart-fill-${state.page})"/>`;});
    result+=`<path data-series="${esc(s.key)}" d="${path}" fill="none" stroke="${s.color}" stroke-width="2" ${index===1?'stroke-dasharray="5 5"':''} stroke-linejoin="round"/>`;
    pts.forEach(p=>{const tooltip=`${s.name}: ${yType==='bytes'?bytes(p[s.key]):number(p[s.key],yType==='percent'?1:0)} · ${compactDate(p.timestamp)}`;result+=`<circle class="chart-point" cx="${x(p)}" cy="${y(p[s.key])}" r="3.5" fill="#111a27" stroke="${s.color}" stroke-width="2" tabindex="0" data-tooltip="${esc(tooltip)}"><title>${esc(tooltip)}</title></circle>`;});
  });
  return result+`</svg>`;
}
function syncChart(){const pts=dataPoints().filter(p=>finite(p.height));return `<section class="panel">${panelHead(t('Ketjun synkronointi'),t('Oman noden ja verkon korkeus havaintohetkellä'),rangeTabs())}<div class="chart-legend"><span><i class="legend-key"></i>${t("Oma node")}</span><span><i class="legend-key network"></i>${t("Verkko")}</span><span class="chart-tooltip" id="chart-tooltip"></span></div><div class="chart-box">${lineChart([{key:'height',name:t('Oma node'),color:'#5de0df'},{key:'network_height',name:t('Verkko'),color:'#e9ba72'}])}</div><div class="chart-foot"><span>${t('{count} tallennettua havaintoa · viivat yhdistävät havaintopisteet',{count:int(pts.length)})}</span><strong>${state.mode==='snapshot'?t('DEMOHISTORIA'):t('PAIKALLINEN HISTORIA')}</strong></div></section>`;}
function diskRing(){const r=state.dashboard.resources||{};const used=finite(r.disk_used_bytes)?Number(r.disk_used_bytes):finite(r.disk_total_bytes)&&finite(r.disk_free_bytes)?Number(r.disk_total_bytes)-Number(r.disk_free_bytes):null;const percent=finite(used)&&r.disk_total_bytes?used/Number(r.disk_total_bytes)*100:null;const circumference=2*Math.PI*55;return `<div class="disk-content"><div class="disk-ring"><svg viewBox="0 0 130 130" role="img" aria-label="${esc(finite(percent)?t('Nodus-osion käyttöaste {percent} prosenttia',{percent:number(percent,1)}):t('Nodus-osion käyttöaste ei saatavilla'))}"><circle class="ring-track" cx="65" cy="65" r="55"/><circle class="ring-value" cx="65" cy="65" r="55" stroke-dasharray="${circumference}" stroke-dashoffset="${circumference*(1-Math.max(0,Math.min(100,percent||0))/100)}"/></svg><div class="ring-center"><strong>${finite(percent)?number(percent,1)+`<small style="font-size:13px">%</small>`:'—'}</strong><span>${t("käytössä")}</span></div></div><div class="disk-stats"><div class="stat-row"><span><i class="square"></i>${t("Käytetty")}</span><strong>${bytes(used)}</strong></div><div class="stat-row"><span><i class="square dark"></i>${t("Vapaa")}</span><strong>${bytes(r.disk_free_bytes)}</strong></div><div class="stat-row"><span>${t("Osion koko")}</span><strong>${bytes(r.disk_total_bytes)}</strong></div></div></div>`;}
function diskPanel(){const r=state.dashboard.resources||{};return `<section class="panel">${panelHead(t('Noduksen tallennustila'),esc(state.dashboard.monitor?.data_path||t('Datahakemiston tiedostojärjestelmä')),pill(bytes(r.disk_total_bytes),'muted',false))}${diskRing()}<p class="disk-note">${t("Tiedostojärjestelmän koko ja Noduksen käyttämä tila ovat eri mittareita. Levyn koko ei yksin määrää palkkioita.")}</p></section>`;}
function graceCard(){
  const s=state.dashboard.storage||{},registered=s.registered===true,unregistered=s.registered===false,inGrace=registered&&s.in_grace===true;
  const remaining=finite(s.grace_until)&&finite(state.dashboard.chain?.height)?Math.max(0,Number(s.grace_until)-Number(state.dashboard.chain.height)):null;
  const label=inGrace?t('epochia jäljellä'):registered?t('rekisteröity'):unregistered?t('ei rekisteröity'):t('Tila ei saatavilla');
  const description=inGrace?t('Node hakee arkistosegmenttejä. Storage-roolia ei tarkisteta eikä storage-palkkioita kerry grace-jaksolla. Staking-palkkiot voivat silti jatkua.'):registered?t('Storage-rooli on rekisteröity. Aktiivisuus ja osoitetut segmentit näkyvät tallennustilan seurannassa.'):unregistered?t('Ketjutiedon mukaan tätä nodea ei ole rekisteröity storage-rooliin.'):t('Rekisteröintitietoa ei ole saatavilla.');
  return `<section class="panel grace-panel"><div class="section-overline"><span data-icon="clock"></span>${inGrace?t('VALMISTAUTUMISJAKSO'):t('STORAGE-ROOLI')}</div><div class="grace-value"><strong>${inGrace?int(s.grace_epochs_left):registered?'✓':'—'}</strong><span>${label}</span></div><p>${description}</p><div class="epoch-bars" aria-hidden="true">${Array.from({length:inGrace?Math.min(20,Math.max(0,Number(s.grace_epochs_left)||0)):0},()=>`<span class="done"></span>`).join('')}</div><div class="grace-foot"><span>${inGrace?`${t('LOPPURAJA')} <strong>${int(s.grace_until)}</strong>`:t('STORAGE TESTNET')}</span><span>${inGrace?t('{count} lohkoa',{count:int(remaining)}):registered||unregistered?t('Ketjutieto'):t('Tila ei saatavilla')}</span></div></section>`;
}
function resourcesPanel(){const r=state.dashboard.resources||{},c=state.dashboard.clock||{};const memUsed=finite(r.memory_total_bytes)&&finite(r.memory_available_bytes)?Number(r.memory_total_bytes)-Number(r.memory_available_bytes):null;const memPercent=finite(memUsed)&&r.memory_total_bytes?memUsed/r.memory_total_bytes*100:null;return `<section class="panel">${panelHead(t('Palvelimen voimavarat'),esc(r.hardware_model||t('Palvelin'))+' · '+(finite(r.cpu_count)?t('{count} loogista prosessoria',{count:int(r.cpu_count)}):t('CPU-määrä puuttuu')),pill(esc(r.hostname||t('Oma node')),'muted',false))}<div class="resource-grid"><div class="resource"><div class="resource-name"><span data-icon="cpu"></span>${t("Kuormitus")}</div><div class="resource-value">${number(r.load1,2)}</div><div class="resource-detail">${t("1 minuutin keskiarvo")}<br>CPU-% ${finite(r.cpu_percent)?number(r.cpu_percent,1)+' %':t('ei mitattu')}</div><div class="resource-bar"><span style="width:${finite(r.load1)&&finite(r.cpu_count)&&Number(r.cpu_count)>0?Math.min(100,Number(r.load1)/Number(r.cpu_count)*100):0}%"></span></div></div><div class="resource"><div class="resource-name"><span data-icon="memory"></span>${t("Muisti")}</div><div class="resource-value">${bytes(memUsed)}</div><div class="resource-detail">${t('{size} yhteensä',{size:bytes(r.memory_total_bytes)})}<br>${t('{size} saatavilla',{size:bytes(r.memory_available_bytes)})}</div><div class="resource-bar"><span style="width:${memPercent||0}%"></span></div></div><div class="resource"><div class="resource-name"><span data-icon="clock"></span>${t("Verkkokello")}</div><div class="resource-value" style="color:${c.ntp_synchronized?'var(--lime)':'var(--amber)'}">${c.ntp_synchronized?'NTP':c.ntp_synchronized===false?'!':'—'}</div><div class="resource-detail">${c.ntp_synchronized?t('Synkronoitu verkkoon'):t('Synkronointi ei varmistettu')}<br>${c.ntp_synchronized?t('Kellotarkistus OK'):t('Tarkista kellopalvelu')}</div><div class="resource-bar"><span style="width:${c.ntp_synchronized?100:0}%;background:var(--lime)"></span></div></div></div></section>`;}
function servicesPanel(){const roles=configuredRoles();const services=(state.dashboard.services||[]).filter(service=>(roles.storage||!/^nodus-storage(?:\.service)?$/.test(service.name||''))&&(roles.witness||!/^nodus-witness(?:\.service)?$/.test(service.name||'')));const allEnabled=services.length>0&&services.every(s=>s.enabled===true||s.enabled==='enabled');return `<section class="panel">${panelHead(t('Palvelut'),t('Järjestelmän taustapalvelut'))}<div class="service-list">${services.map(s=>{const active=s.active===true||s.active==='active',known=s.active!==null&&s.active!==undefined;return `<div class="service-row"><span>${esc(s.name.replace(/\.service$/,''))}</span><span class="status" style="color:${active?'var(--lime)':known?'var(--amber)':'var(--muted)'}"><span class="tiny-dot" style="background:currentColor"></span>${active?t('Käynnissä'):known?t('Ei käynnissä'):t('Ei tietoa')}</span></div>`;}).join('')}</div><div class="service-caption">${esc(state.dashboard.node?.version||'—')} <span class="muted">/</span> ${esc((state.dashboard.node?.commit||'').slice(0,12))}<br>${allEnabled?t('Palvelut käynnistyvät automaattisesti palvelimen mukana.'):t('Palveluiden automaattinen käynnistys ei ole kaikilta osin vahvistettu.')}</div></section>`;}

function configuredRoles(){
  const roles=state.dashboard?.monitor?.roles||state.monitorSettings?.roles||state.dashboard?.roles;
  return {storage:roles?roles.storage===true:state.dashboard?.storage?.enabled!==false,witness:roles?roles.witness===true:state.dashboard?.witness?.enabled!==false};
}
function roleLabel(){const roles=configuredRoles();return roles.storage&&roles.witness?t('Tallennus ja todistaja'):roles.storage?t('Tallennusnode'):roles.witness?t('Todistajanode'):t('Nodus-node');}
function nodeDisplayName(){const name=state.dashboard?.monitor?.node_name??state.monitorSettings?.node_name;return name||state.dashboard?.resources?.hostname||t('Oma node');}
function witnessService(){return state.dashboard?.witness?.service||(state.dashboard?.services||[]).find(service=>/^nodus-witness(?:\.service)?$/.test(service.name||''))||{};}
function serviceStatus(service){return service.active===true||service.active==='active'?t('Käynnissä'):service.active==='failed'?t('Virhe'):service.active===false||typeof service.active==='string'?t('Ei käynnissä'):t('Ei tietoa');}
function witnessMembership(){const member=state.dashboard?.witness?.committee?.is_member;return member===true?t('Mukana komiteassa'):member===false?t('Ei mukana komiteassa'):t('Jäsenyys ei saatavilla');}
function witnessSummary(){
  const w=state.dashboard?.witness||{},service=witnessService(),active=service.active===true||service.active==='active';
  return `<section class="panel witness-summary">${panelHead(t('Todistajarooli'),t('Palvelun tila ja nykyinen komitea'),pill(serviceStatus(service),active?'':service.active===undefined||service.active===null?'muted':'amber'))}<div class="detail-list">${detail(t('Todistajapalvelu'),esc(service.name||'nodus-witness'))}${detail(t('Komitean jäsenyys'),witnessMembership())}${detail(t('Komitean korkeus'),int(w.committee?.height))}</div><div class="role-summary-foot"><a class="inline-link" href="#witness">${t('Avaa todistajanäkymä →')}</a></div></section>`;
}
function overview(){
  const d=state.dashboard,s=d.storage||{},c=d.chain||{},n=d.node||{},roles=configuredRoles();
  const sharedMetrics=metric(t('Ketjun korkeus'),int(c.height),`${t('Verkko')} <span class="number">${int(c.network_height)}</span>`,'layers','accent')+metric(t('Lohkoero'),`${int(c.behind)}<span class="unit">${t('lohkoa')}</span>`,c.behind===0?`<span class="positive">●</span> ${t('Samassa korkeudessa verkon kanssa')}`:finite(c.behind)?t('Oma node jäljessä verkosta'):t('Lohkoero ei saatavilla'),'activity');
  const roleMetrics=roles.storage?metric(t('Valmiit segmentit'),`${int(s.complete_segments)}<span class="unit">${t('kpl')}</span>`,t('{size} segmenttihakemistossa',{size:bytes(s.segment_bytes)}),'database')+metric(t('Epäonnistumisputki'),int(s.fail_streak),s.fail_streak===0?`<span class="positive">●</span> ${t('Ei peräkkäisiä epäonnistumisia')}`:t('Ketjun tallentama fail_streak-arvo'),'shield'):metric(t('Todistajapalvelu'),serviceStatus(witnessService()),t('Palvelun käyntitila on paikallinen havainto'),'shield')+metric(t('Komitean jäsenyys'),witnessMembership(),t('Viimeisin paikallinen komiteakysely'),'network');
  return `${heading(t('OMA NODE / TILANNEKESKUS'),t('Kaikki olennainen. Yhdellä silmäyksellä.'),t('Valitut roolit, verkon rytmi ja palvelimen toimintakunto.'))}<section class="panel hero-panel node-hero"><div class="hero-top"><span class="hero-label"><span data-icon="network"></span>${esc(nodeDisplayName())} / ${esc(roleLabel())}</span>${syncPill()}</div><h2 class="hero-title">${t('Noden tilannekuva.')}</h2><p class="hero-description">${t('Seuraa käytössä olevia rooleja ja yhteisiä ketju- ja palvelinmittauksia.')}</p><div class="hero-bottom"><div class="identity"><span>${esc(shortFp(n.fingerprint))}</span><button class="icon-button copy-fp" aria-label="${esc(t('Kopioi noden sormenjälki'))}"><span data-icon="copy"></span></button></div><span class="hero-caption">${t('NODUS TESTNET')}</span></div></section><div class="equal-cols role-overview-grid ${roles.storage&&roles.witness?'':'single-role'}">${roles.storage?graceCard():''}${roles.witness?witnessSummary():''}</div><div class="metrics">${sharedMetrics}${roleMetrics}</div><div class="two-col">${syncChart()}${diskPanel()}</div><div class="two-col">${resourcesPanel()}${servicesPanel()}</div><div class="section-heading"><h2>${t('Viimeisimmät tapahtumat')}</h2><a href="#events">${t('Kaikki tapahtumat →')}</a></div><section class="panel">${eventsTable(eventItems().slice(0,3))}</section>`;
}
function witness(){
  const d=state.dashboard,w=d.witness||{},committee=w.committee||{},service=witnessService(),active=service.active===true||service.active==='active';
  return `${heading(t('WITNESS / TODISTAJA'),t('Todistajan tilanne.'),t('Paikallinen palvelu, ketjun synkronointi ja komitean julkiset tiedot.'))}<div class="metrics">${metric(t('Todistajapalvelu'),serviceStatus(service),esc(service.name||'nodus-witness'),'shield','accent')}${metric(t('Ketjun korkeus'),int(d.chain?.height),t('Oman noden paikallinen korkeus'),'layers')}${metric(t('Lohkoero'),int(d.chain?.behind),t('Oman noden ero verkon korkeuteen'),'activity')}${metric(t('Komitean jäsenyys'),witnessMembership(),t('Viimeisin paikallinen komiteakysely'),'network')}</div>${!active?`<div class="notice" role="status"><span data-icon="info"></span><div><strong>${t('Todistajarooli on valittu seurantaan.')}</strong> ${t('Palvelu ei ole vahvistetusti käynnissä. Tarkista palvelun tila; rooli säilyy seurannassa myös häiriön aikana.')}</div></div>`:''}<div class="equal-cols"><section class="panel">${panelHead(t('Nykyinen komitea'),t('Paikallisen CLI-kyselyn palauttamat tiedot'))}<div class="detail-list">${detail(t('Komitean korkeus'),int(committee.height))}${detail(t('Jäseniä'),int(committee.count))}${detail(t('Oma jäsenyys'),witnessMembership())}${detail(t('Äänivalta'),finite(committee.power)?number(committee.power):'—')}${detail(t('Panostus'),committee.stake_raw!==null&&committee.stake_raw!==undefined?`${rawNodus(committee.stake_raw)} NODUS`:'—')}</div><div class="data-note">${t('Puuttuvia komiteatietoja ei päätellä palvelun käyntitilasta tai palkkioista.')}</div></section><section class="panel">${panelHead(t('Noden julkinen identiteetti'),t('Seuranta käyttää vain julkisia tunnisteita'))}<div class="detail-list">${detail(t('Noden sormenjälki'),esc(shortFp(d.node?.fingerprint)),true)}${detail('P2P ID',esc(shortFp(d.node?.p2p_id)),true)}${detail(t('Omistajalompakko'),esc(shortFp(d.node?.owner)),true)}${detail(t('Palvelun automaattinen käynnistys'),service.enabled===true||service.enabled==='enabled'?t('Käytössä'):service.enabled===false||typeof service.enabled==='string'?t('Ei vahvistettu'):t('Ei tietoa'))}</div></section></div><div class="two-col">${syncChart()}${servicesPanel()}</div><div class="notice cyan"><span data-icon="wallet"></span><div>${t('Palkkiosivu näyttää omistajalompakon kaikkien roolien maksut. Witness-roolin osuutta ei arvioida yhteissummasta.')} <a class="inline-link" href="#rewards">${t('Avaa palkkiot →')}</a></div></div>`;
}
function storage(){const d=state.dashboard,s=d.storage||{},c=d.chain||{};const progress=finite(c.height)&&finite(s.epoch_start)&&finite(s.epoch_end)&&s.epoch_end>s.epoch_start?Math.max(0,Math.min(100,(c.height-s.epoch_start)/(s.epoch_end-s.epoch_start)*100)):null;return `${heading(t('ARKISTO / KAPASITEETTI'),t('Tilaa verkon muistille.'),t('Osoitetut segmentit, valmistautuminen ja Nodukselle varattu levytila.'))}<section class="panel storage-hero"><div><span class="section-overline">${t("NODUKSEN TALLENNUSTILA")}</span><h2>${t('{size} tallennustilaa.',{size:bytes(d.resources?.disk_total_bytes)})}</h2><p>${t("Näytetään datahakemiston tiedostojärjestelmän koko ja käyttö. Sama tiedostojärjestelmä voi sisältää myös muiden palveluiden dataa.")}</p><div class="role-status">${pill(esc(dataText(s.status)||t('Ei tietoa')))}${membershipPill()}${s.in_grace?pill(t('Grace-jakso'),'amber'):''}</div></div>${diskRing()}</section><div class="section-heading"><h2>${t("Arkiston tämänhetkinen tilanne")}</h2><span class="year-label">${t("PAIKALLINEN HAKEMISTO + KETJU")}</span></div><div class="metrics">${metric(t('Valmiit segmentit'),int(s.complete_segments),t('Varmistettu seg-*.ok-tiedostoista'),'database','accent')}${metric(t('Segmenttihakemisto'),bytes(s.segment_bytes),t('Sisältää myös keskeneräiset tiedostot'),'layers')}${metric(t('Kelvolliset segmentit'),int(s.eligible_segments),t('{count} lohkoa nykyisessä epochissa',{count:int(s.eligible_blocks)}),'shield')}${metric(t('Storage-joukon koko'),`${int(s.members)}<span class="unit">${t("nodea")}</span>`,s.is_member===true?t('Oma node on mukana'):s.is_member===false?t('Oma node ei ole mukana'):t('Noden jäsenyystieto ei saatavilla.'),'network')}</div><div class="notice cyan"><span data-icon="info"></span><div><strong>${t("Hakemiston koko ei yksin todista latauksen etenemistä.")}</strong> ${t('Valmiit segmentit, hakemiston koon muutos ja lokit kertovat yhdessä arkiston tilanteesta.')} ${s.in_grace?t('Grace-jaksolla storage-palkkioita ei vielä kerry. Lompakon staking-palkkiot voivat jatkua.'):''}</div></div><div class="equal-cols"><section class="panel">${panelHead(t('Epoch & grace'),t('Verkosta vahvistettu storage-tila'))}<div class="detail-list">${detail(t('Nykyinen epoch'),`(${int(s.epoch_start)}, ${int(s.epoch_end)}]`)}${detail(t('Epochin eteneminen'),`${number(progress,1)} %`)}<div class="progress-track"><span style="width:${progress||0}%"></span></div>${detail(t('Grace-raja'),int(s.grace_until))}${detail(t('Grace-epocheja jäljellä'),int(s.grace_epochs_left))}${detail(t('Storage-palkkiot'),s.in_grace?t('Grace-jakso · ei storage-kertymää'):t('Katso Palkkiot-sivu'))}${detail(t('Peräkkäiset epäonnistumiset'),int(s.fail_streak))}</div></section><section class="panel">${panelHead(t('Identiteetti & rekisteröinti'),t('Julkisia ketjutietoja'))}<div class="detail-list">${detail(t('Rekisteröity lohkossa'),int(s.registered_height))}${detail(t('Bondi'),`${rawNodus(s.bond_raw)} NODUS`)}${detail(t('Omistajalompakko'),esc(shortFp(d.node?.owner||s.owner)),true)}${detail(t('Noden sormenjälki'),esc(shortFp(d.node?.fingerprint)),true)}${detail(t('Datahakemisto'),esc(d.monitor?.data_path||t('Ei mitattu')),true)}</div></section></div><section class="panel">${panelHead(t('Arkiston kasvu'),t('Segmenttihakemiston koko todellisissa mittauspisteissä'),rangeTabs())}<div class="chart-box">${lineChart([{key:'segment_bytes',name:t('Segmenttihakemisto'),color:'#5de0df'}],{yType:'bytes',emptyTitle:t('Arkiston historia alkaa tästä'),emptyText:t('Nykyinen koko tunnetaan. Kasvunopeus näkyy, kun kerääjä on tallentanut vähintään kaksi mittausta.')})}</div><div class="chart-foot"><span>${t("Osion käyttö ja segmenttihakemisto ovat eri mittareita.")}</span><strong>${t('{count} HAVAINTOA',{count:int(dataPoints().filter(p=>finite(p.segment_bytes)).length)})}</strong></div></section><div class="section-heading"><h2>${t("Levyn toimintakunto")}</h2></div><div class="equal-cols"><section class="panel">${panelHead(t('SMART & lämpötila'),t('Viimeisimmän kerätyn levymittauksen tiedot'))}<div class="detail-list">${detail('SMART',d.resources?.smart_passed===true?t('PASSED'):d.resources?.smart_passed===false?t('VAROITUS'):t('Ei tuoretta mittausta'))}${detail(t('Lämpötila'),finite(d.resources?.temperature_c)?number(d.resources.temperature_c)+' °C':t('Ei tuoretta mittausta'))}${detail(t('Levykuormitus'),finite(d.resources?.disk_util_percent)?number(d.resources.disk_util_percent,1)+' %':t('Ei vielä mitattu'))}</div></section><section class="panel">${panelHead(t('Luku- ja kirjoitusnopeus'),t('Paikallisen levyn yhteinen liikenne'))}<div class="detail-list">${detail(t('Luku'),finite(d.resources?.disk_read_bps)?bytes(d.resources.disk_read_bps)+'/s':t('Ei vielä mitattu'))}${detail(t('Kirjoitus'),finite(d.resources?.disk_write_bps)?bytes(d.resources.disk_write_bps)+'/s':t('Ei vielä mitattu'))}</div><div class="data-note">${t("Mittari koskee asetuksissa valittua levylaitetta ja sisältää myös muiden palveluiden liikenteen.")}</div></section></div>`;}
function detail(label,value,mono=false){return `<div class="detail-row"><span>${label}</span><strong class="${mono?'mono':''}">${value}</strong></div>`;}
function network(){const d=state.dashboard,c=d.chain||{},s=d.storage||{},n=state.network||{},stats=n.stats||{},tps=n.tps||{},committee=n.committee||{};const available=n.available===true;const tx=tps.last_minute?.tps;return `${heading(t('VERKKO / NODUS TESTNET'),t('Verkon rytmi. Oman noden paikka.'),t('Paikallinen ketjutila ja erikseen haettavat verkon tilastot.'))}<div class="network-facts">${metric(t('Verkon korkeus'),int(c.network_height),t('CLI:n kysely verkon todistajille'),'layers','accent')}${configuredRoles().storage?metric(t('Storage-joukko'),`${int(s.members)}<span class="unit">${t("jäsentä")}</span>`,s.is_member?t('Oma node mukana nykyisessä epochissa'):t('Nykyisen epochin tallennusjoukko'),'network'):metric(t('Komitean jäsenyys'),witnessMembership(),t('Viimeisin paikallinen komiteakysely'),'network')}${metric(t('Transaktioita sekunnissa'),finite(tx)?number(tx,2):'—',finite(tx)?t('Toteutunut TPS · viimeinen minuutti'):t('Odottaa explorerin rajapintaa'),'activity')}</div>${!available?`<div class="notice"><span data-icon="info"></span><div><strong>${t("Verkkotilastojen lähde odottaa yhteyttä.")}</strong> ${configuredRoles().storage?t('Yllä näkyvät lohkokorkeus ja storage-joukko ovat paikallisesta tilakyselystä. TPS-, token- ja validaattoritietoja ei ole täydennetty arvioilla.'):t('Paikallinen ketjutila säilyy näkyvissä. Puuttuvia verkkotilastoja ei täydennetä arvioilla.')}</div></div>`:''}<div class="equal-cols"><section class="panel">${panelHead(t('Ketjun eheys'),t('Sama ketju nodella ja verkon vastaajilla'),pill(c.sync_ok===true?t('Vahvistettu'):c.sync_ok===false?t('Tarkista'):t('Tila ei saatavilla'),c.sync_ok===true?'':c.sync_ok===false?'amber':'muted'))}<div class="detail-list">${detail(t('Oma korkeus'),int(c.height))}${detail(t('Verkon korkeus'),int(c.network_height))}${detail(t('Lohkoero'),int(c.behind))}${detail(t('Säännöstön sukupolvi'),int(c.generation))}${detail(t('NTP-synkronointi'),d.clock?.ntp_synchronized?t('Kunnossa'):t('Ei vahvistettu'))}</div><div class="chain-id"><span>${t("Ketjun tunniste")}</span>${esc(c.chain_id||t('Ei saatavilla'))}</div></section><section class="panel">${panelHead(t('Validaattorikomitea'),t('Explorer / komiteakysely'))}${Array.isArray(committee.seats)&&committee.seats.length?`<div class="detail-list">${detail(t('Komitean korkeus'),int(committee.height))}${detail(t('Jäseniä'),int(committee.count||committee.seats.length))}${committee.seats.slice(0,5).map(seat=>detail(esc(shortFp(seat.address||seat.id)),finite(seat.power)?t('{power} äänivalta',{power:number(seat.power)}):'—',true)).join('')}</div>`:empty(t('Komiteatiedot odottavat lähdettä'),t('Jäsenet ja äänivalta näytetään, kun komitean rajapinta vastaa.'),'network',true)}</section></div><section class="panel">${panelHead(t('Verkon transaktioaktiivisuus'),t('Toteutunut TPS eri havaintohetkinä'))}${networkTpsChart(tps.history)}<div class="data-note">${t('Lähde:')} ${esc(dataText(n.source)||t('Nodus Scan · yhteyttä ei vielä ole'))}${n.stale?t(' · Välimuistissa oleva tieto'):''}. ${t('Paikallinen synkronointi ja explorerin indeksointi voivat olla eri korkeudessa.')}</div></section><div class="section-heading"><h2>${t("Tokenit & seuraava maksupäivä")}</h2></div><div class="metrics">${metric(t('Kokonaismäärä'),stats.supply_current!==null&&stats.supply_current!==undefined?rawNodus(stats.supply_current):'—',t('NODUS · explorerin ilmoittama määrä'),'globe')}${metric(t('Palkkiopooli'),stats.reward_pool!==null&&stats.reward_pool!==undefined?rawNodus(stats.reward_pool):'—',t('NODUS · verkon yhteinen pooli'),'wallet')}${metric(t('Poltetut tokenit'),stats.supply_burned!==null&&stats.supply_burned!==undefined?rawNodus(stats.supply_burned):'—',t('NODUS · vahvistettu ketjutieto'),'layers')}${metric(t('Seuraava maksulohko'),int(tps.next_payday?.height),finite(tps.next_payday?.blocks_left)?t('{count} lohkoa jäljellä',{count:int(tps.next_payday.blocks_left)}):t('Maksulohkon lähde ei vielä vastaa'),'clock')}</div>`;}
function networkTpsChart(history){if(!Array.isArray(history)||history.filter(p=>finite(p.tps)).length<2)return empty(t('Verkon historia odottaa havaintoja'),t('TPS-kuvaaja piirtyy rajapinnan todellisista aikaväleistä. Verkon tapahtumamäärää ei arvioida paikallisen lohkokorkeuden perusteella.'),'activity');const saved=state.history;state.history={points:history.map(p=>({timestamp:new Date(p.start_ms).toISOString(),tps:p.tps}))};const chart=`<div class="chart-box">${lineChart([{key:'tps',name:'TPS',color:'#5de0df'}])}</div>`;state.history=saved;return chart;}
function rewardSourceName(source){
  if(source==='local_nodus_addr_history')return t('Paikallinen indeksi');
  if(source==='nodus_scan_addr_history')return t('Nodus Scan · tuotu historia');
  return source||t('Lähde puuttuu');
}
function rewardSourceStatus(status){
  if(status==='ok')return t('Haku onnistui');
  if(status==='partial')return t('Osittainen aineisto');
  if(status==='error')return t('Haku epäonnistui');
  if(status==='disabled')return t('Ei käytössä');
  if(status==='unsupported')return t('Ei tuettu');
  return t('Ei saatavilla');
}
function rewardCoverageCard(label,info,remote=false){
  const status=info.status||'unavailable';
  const range=finite(info.from_height)&&finite(info.at_height)?t('Lohkot {from}–{to}',{from:int(info.from_height),to:int(info.at_height)}):t('Lohkoaluetta ei ole saatu');
  const attempt=info.last_attempt_at||info.collected_at;
  return `<section class="panel">${panelHead(label,remote?t('Kolmannen osapuolen havaintoja aiemmasta maksuhistoriasta'):t('Tämän noden osoitehistoriaindeksin kattavuus'),pill(rewardSourceStatus(status),status==='ok'?'':'amber',false))}<div class="detail-list">${detail(t('Kerätty lohkoalue'),range)}${detail(t('Viimeisin haku · Helsinki'),attempt?esc(dateTime(attempt)):t('Ajankohta puuttuu'))}${info.last_success_at?detail(t('Viimeisin onnistunut haku'),esc(dateTime(info.last_success_at))):''}</div><div class="data-note">${remote?t('Scan-tiedot säilyttävät lähdemerkinnän. Niitä ei ole kryptografisesti varmennettu paikallisesta ketjusta.'):t('Indeksin alkua vanhemmat maksut vaativat toisen historialähteen.')}${info.reason?`<br>${esc(dataText(info.reason))}`:''}</div></section>`;
}
function rewardCoverage(source){
  // Older monitor responses have only the local source at the top level.
  const local=source.local||(!source.scan?source:{}),scan=source.scan||{};
  return `<div class="section-heading"><h2>${t('Maksuhistorian lähteet')}</h2><span class="year-label">${t('KATTAVUUS JA HAKUJEN AJANKOHDAT')}</span></div><div class="equal-cols">${rewardCoverageCard(t('Paikallinen indeksi'),local)}${rewardCoverageCard(t('Nodus Scan · aiempi historia'),scan,true)}</div>`;
}
function rewards(){
  const r=state.rewards||{},source=r.source||{},yearMatch=Number(r.year||state.year)===state.year;
  const summary=yearMatch?r.summary||{}:{},items=yearMatch&&Array.isArray(r.items)?r.items:[];
  // A failed refresh must not erase already collected payouts or their graph.
  const hasHistory=items.length>0||(yearMatch&&Array.isArray(r.monthly)&&r.monthly.some(row=>Number(row.payout_count)>0))||summary.paid_nodus!==null&&summary.paid_nodus!==undefined||['ok','partial'].includes(source.status);
  const pendingSource=!hasHistory,count=finite(summary.payout_count)&&hasHistory?int(summary.payout_count):'—';
  const years=[2026,2027,2028].map(y=>`<option value="${y}" ${y===state.year?'selected':''}>${y}</option>`).join('');
  const extra=`<div class="toolbar"><label class="year-label" for="reward-year">${t('VEROVUOSI')}</label><select class="select" id="reward-year" aria-label="${esc(t('Palkkioiden verovuosi'))}">${years}</select><button class="button primary" id="export-rewards"><span data-icon="download"></span>${t('Lataa CSV')}</button></div>`;
  return `${heading(t('LOMPAKKO / PALKKIOT'),t('Lompakon kaikki palkkiot.'),t('Staking-, storage- ja witness-palkkiot samalla sivulla, lompakon yhteissummana.'),extra)}
    <div class="notice ${pendingSource?'':'cyan'}"><span data-icon="wallet"></span><div><strong>${t('Omistajalompakon yhteenveto.')}</strong> ${t('Maksut sisältävät lompakon kaikkien palkkioroolien tuotot. Lähde ei erittele roolien tai yksittäisten nodejen osuuksia.')} ${t('Odottava kertymä ja vakuuksien palautukset pidetään erillään maksetuista palkkioista.')} ${source.complete_year?t('Koko verovuoden kattavuus on vahvistettu.'):t('Koko verovuoden kattavuutta ei ole vahvistettu.')}${configuredRoles().storage&&state.dashboard.storage?.in_grace?`<br>${t('Storage-rooli on grace-jaksolla: storage-palkkioita ei vielä kerry. Staking-palkkiot voivat silti jatkua.')}`:''}</div></div>
    <div class="metrics">${metric(t('Maksettu kerätyllä ajalla'),summary.paid_nodus!==null&&summary.paid_nodus!==undefined?`${esc(decimalFi(summary.paid_nodus))}<span class="unit">NODUS</span>`:'—',t('Valittu vuosi · kerätyt maksut · kaikki palkkioroolit'),'wallet','accent')}${metric(t('Euromääräinen yhteensä'),summary.eur_total!==null&&summary.eur_total!==undefined?`${esc(decimalFi(summary.eur_total))}<span class="unit">€</span>`:'—',`${summary.eur_complete===false?t('Osasumma · '):''}${t('{count} tapahtumaa arvostettu euroissa',{count:int(summary.valued_count||0)})}`,'receipt')}${metric(t('Odottava kertymä'),summary.pending_nodus!==null&&summary.pending_nodus!==undefined?`${esc(decimalFi(summary.pending_nodus))}<span class="unit">NODUS</span>`:'—',t('Erillinen tieto · ei lisätty maksettuihin'),'clock')}${metric(t('Maksutapahtumat'),count,pendingSource?t('Maksuhistoriaa ei ole vielä saatu'):t('{count} ilman euroarvostusta',{count:int(summary.unvalued_count||0)}),'layers')}</div>
    ${rewardCoverage(source)}
    <div class="two-col">${rewardChartPanel(r,yearMatch,pendingSource)}
    <section class="panel">${panelHead(t('Yhteenvetoa varten'),t('Tietojen kattavuus ja puuttuvat arvostukset'))}<div class="tax-checks"><div class="check-row"><span data-icon="info"></span><div><strong>${t('Maksuhistorian kattavuus')}</strong><span>${source.complete_year?t('Koko vuoden lähdeaineisto vahvistettu'):pendingSource?t('Tyhjä aineisto ei tarkoita lompakon nollatuottoa.'):t('Osittainen aineisto · ei koko vuoden vahvistusta')} ${t('Lähteiden lohkoalueet voivat sisältää aukkoja. CSV säilyttää erilliset kattavuusjaksot.')}</span></div></div><div class="check-row"><span data-icon="receipt"></span><div><strong>${t('Euroarvostukset')}</strong><span>${t('{valued} valmis · {missing} puuttuu. Puuttuva arvo säilyy tyhjänä.',{valued:int(summary.valued_count||0),missing:int(summary.unvalued_count||0)})}</span></div></div><div class="check-row"><span data-icon="wallet"></span><div><strong>${t('Vakuuksien palautukset')}</strong><span>${summary.released_nodus!==null&&summary.released_nodus!==undefined?`${esc(decimalFi(summary.released_nodus))} NODUS · `:''}${t('Erilliset palautusrivit CSV:ssä. Ei lisätty palkkiotuottoihin.')}</span></div></div><div class="check-row"><span data-icon="clock"></span><div><strong>${t('Aikavyöhyke Europe/Helsinki')}</strong><span>${t('CSV sisältää UTC-ajan ja paikallisen ajan sekä lohkon tunnisteen.')}</span></div></div><div class="check-row"><span data-icon="shield"></span><div><strong>${t('Testnet merkitään vientiin')}</strong><span>${t('Tapahtumat ja lähdetiedot mukaan. Verokäsittelyä ei päätellä automaattisesti.')}</span></div></div></div></section></div>
    <div class="section-heading"><h2>${t('Kerätyt maksut')}</h2><span class="year-label">${state.year} / ${pendingSource?t('LÄHDE ODOTTAA'):t('{count} TAPAHTUMAA',{count:int(items.length)})}</span></div><section class="panel">${items.length?`<div class="reward-summary">${t('Omistajalompakon maksut. Euroarvojen summassa ovat vain arvostetut tapahtumat.')}</div><div class="table-wrap"><table class="data-table"><thead><tr><th>${t('Aika · Helsinki')}</th><th>${t('Lohko')}</th><th>${t('Palkkio / NODUS')}</th><th>${t('Maksutiedon lähde')}</th><th>${t('Euroarvo')}</th><th>${t('Arvostuslähde')}</th></tr></thead><tbody>${items.map(item=>`<tr><td>${esc(dateTime(item.block_time_utc||item.block_time_local))}</td><td class="mono">${int(item.height)}</td><td class="mono">${esc(decimalFi(item.amount_nodus))}</td><td>${esc(rewardSourceName(item.source))}</td><td>${item.eur_value===null||item.eur_value===undefined?`<span class="pill amber">${t('Puuttuu')}</span>`:esc(decimalFi(item.eur_value))+' €'}</td><td>${esc(item.valuation_source||'—')}</td></tr>`).join('')}</tbody></table></div>`:empty(pendingSource?t('Ei vielä haettua maksuhistoriaa'):t('Ei maksuja kerätyssä aineistossa'),pendingSource?t('Vanhemmat maksut näkyvät, kun historialähteen haku onnistuu. Tyhjä näkymä ei tarkoita nollatuottoa.'):t('Tulos koskee lähteen ilmoittamaa lohkoaluetta. Se ei yksin vahvista koko vuoden nollatuottoa.'),'wallet')}<div class="data-note">${esc(dataText(source.reason)||t('Lähteen ajankohta ja lohkoalue tulevat mukaan, kun tiedonkeruu on käytössä.'))} ${t('Tallennetut maksut säilyvät näkyvissä myös lähteen tilapäisen häiriön aikana.')}</div></section>`;
}
function decimalSeparator(){return new Intl.NumberFormat(locale()).formatToParts(1.1).find(part=>part.type==='decimal').value;}
function decimalFi(value){
  if(value===null||value===undefined)return '—';
  const match=String(value).match(/^([+-]?)([0-9]+)(?:\.([0-9]+))?$/);
  if(!match)return '—';
  const integer=BigInt(match[2]).toLocaleString(locale()),fraction=(match[3]||'').replace(/0+$/,'');
  return `${match[1]}${integer}${fraction?decimalSeparator()+fraction:''}`;
}
function rewardChartScale(max){
  // Only chart geometry uses Number. Exact amounts remain decimal strings.
  if(!(max>0))return {top:1,step:.25,digits:2,count:4};
  const rough=max/4,power=10**Math.floor(Math.log10(rough)),fraction=rough/power;
  const step=Math.max(1e-8,(fraction<=1?1:fraction<=2?2:fraction<=5?5:10)*power);
  const count=Math.ceil(max/step),top=count*step;
  return {top,step,count,digits:Math.min(8,Math.max(0,-Math.floor(Math.log10(step))))};
}
function rewardChartNumber(value,digits=2){
  return new Intl.NumberFormat(locale(),{notation:Math.abs(value)>=1e6?'compact':'standard',maximumFractionDigits:digits}).format(value);
}
function rewardDayKey(item){
  const value=item.block_time_utc||item.block_time_local;
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value))return null;
  const date=new Date(value);
  if(!Number.isFinite(date.getTime()))return null;
  const parts=rewardDayKey.formatter.formatToParts(date),part=name=>parts.find(part=>part.type===name).value;
  return `${part('year').padStart(4,'0')}-${part('month')}-${part('day')}`;
}
rewardDayKey.formatter=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Helsinki',year:'numeric',month:'2-digit',day:'2-digit'});
function rewardDailyRows(r,yearMatch,monthKey){
  if(!yearMatch||!Array.isArray(r.items)||!new RegExp(`^${state.year}-(0[1-9]|1[0-2])$`).test(monthKey))return null;
  const totals=new Map();let observed=false;
  for(const item of r.items){
    if(item?.kind!=='payout')continue;
    const day=rewardDayKey(item);
    if(!day)return null;
    if(Number(day.slice(0,4))!==state.year)continue;
    if(typeof item.amount_raw!=='string'||!/^\d+$/.test(item.amount_raw))return null;
    const previous=totals.get(day)||{raw:0n,count:0};
    totals.set(day,{raw:previous.raw+BigInt(item.amount_raw),count:previous.count+1});observed=true;
  }
  if(!observed)return null;
  const month=Number(monthKey.slice(5)),days=new Date(Date.UTC(state.year,month,0)).getUTCDate();
  return Array.from({length:days},(_,i)=>{
    const day=`${monthKey}-${String(i+1).padStart(2,'0')}`,value=totals.get(day)||{raw:0n,count:0};
    return {day,paid_nodus:`${value.raw/100000000n}.${(value.raw%100000000n).toString().padStart(8,'0')}`,payout_count:value.count};
  });
}
function rewardSelectedMonth(r,yearMatch){
  const valid=value=>typeof value==='string'&&new RegExp(`^${state.year}-(0[1-9]|1[0-2])$`).test(value);
  if(valid(state.rewardDailyMonth))return state.rewardDailyMonth;
  if(valid(state.rewardMonth))return state.rewardMonth;
  const paid=yearMatch&&Array.isArray(r.monthly)?r.monthly.filter(row=>valid(row.month)&&Number(row.payout_count)>0).map(row=>row.month).sort():[];
  if(paid.length)return paid.at(-1);
  const dated=yearMatch&&Array.isArray(r.items)?r.items.filter(item=>item?.kind==='payout').map(item=>rewardDayKey(item)?.slice(0,7)).filter(valid).sort():[];
  if(dated.length)return dated.at(-1);
  const today=rewardDayKey({block_time_utc:new Date().toISOString()});
  return today?.startsWith(`${state.year}-`)?today.slice(0,7):`${state.year}-01`;
}
function rewardChartControls(r,yearMatch){
  const daily=state.rewardPeriod==='daily',month=rewardSelectedMonth(r,yearMatch);
  const choices=Array.from({length:12},(_,i)=>{
    const key=`${state.year}-${String(i+1).padStart(2,'0')}`,name=new Intl.DateTimeFormat(locale(),{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(Date.UTC(state.year,i,1)));
    return `<option value="${key}" ${key===month?'selected':''}>${esc(name)}</option>`;
  }).join('');
  return `<div class="reward-chart-controls"><div class="range-tabs" role="group" aria-label="${esc(t('Palkkiokuvaajan aikajako'))}">${[['daily','Päivittäin'],['monthly','Kuukausittain']].map(([period,label])=>`<button data-reward-period="${period}" class="${daily===(period==='daily')?'active':''}" aria-pressed="${daily===(period==='daily')}">${t(label)}</button>`).join('')}</div>${daily?`<label class="reward-chart-month">${t('Kuukausi')}<select class="select" id="reward-chart-month" aria-label="${esc(t('Päiväkuvaajan kuukausi'))}">${choices}</select></label>`:''}</div>`;
}
function rewardChartPanel(r,yearMatch,pendingSource){
  const daily=state.rewardPeriod==='daily';
  return `<section class="panel">${panelHead(daily?t('Maksetut palkkiot päivittäin'):t('Maksetut palkkiot kuukausittain'),t('{year} · lompakon kerätyt maksut, kaikki palkkioroolit',{year:state.year}),pill('TESTNET','amber',false))}${rewardChartControls(r,yearMatch)}${daily?rewardDailyChart(r,yearMatch,pendingSource):rewardMonthlyChart(r,yearMatch,pendingSource)}<div class="chart-foot"><span>${t('Kuvaajan nollat koskevat vain kerättyä aineistoa.')}${daily?' '+t('Päiväjako: Europe/Helsinki.'):''}</span><strong>${r.source?.complete_year?t('VUOSI KATTAVA'):t('OSITTAINEN HISTORIA')}</strong></div></section>`;
}
function rewardDailyChart(r,yearMatch,pendingSource){
  const month=rewardSelectedMonth(r,yearMatch),rows=rewardDailyRows(r,yearMatch,month);
  if(!rows)return empty(pendingSource?t('Maksuhistoriaa odotetaan'):t('Päiväkuvaaja odottaa päivättyjä maksuja'),t('Päiväsummat lasketaan kerättyjen maksujen aikaleimoista. Kuukausisummaa ei jaeta arvioiduiksi päivätuotoiksi.'),'wallet');
  const points=rows.map(row=>{
    const name=new Intl.DateTimeFormat(locale(),{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${row.day}T00:00:00Z`));
    const tooltip=t(row.payout_count===1?'{month}: {amount} NODUS · {count} maksu':'{month}: {amount} NODUS · {count} maksua',{month:name,amount:decimalFi(row.paid_nodus),count:int(row.payout_count)});
    return {month,day:row.day,amount:Number(row.paid_nodus),known:true,tooltip,count:row.payout_count};
  });
  return rewardBarsChart(points,true);
}
function rewardMonthlyChart(r,yearMatch,pendingSource){
  const rows=yearMatch&&Array.isArray(r.monthly)?r.monthly:[];
  if(!rows.some(row=>Number(row.payout_count)>0))return `<div class="empty reward-empty"><span class="empty-icon" data-icon="wallet"></span><h3>${pendingSource?t('Maksuhistoriaa odotetaan'):t('Ei maksuja kerätyllä ajalla')}</h3><p>${t('Kuukausikuvaaja muodostuu todellisista maksutapahtumista. Arvioituja tuottoja ei näytetä kirjanpitotietoina.')}</p><small>${t('EI MAKSUJA TÄSSÄ AINEISTOSSA · EI TIETOA KOKO HISTORIASTA')}</small></div>`;
  const months=Array.from({length:12},(_,i)=>{
    const month=`${state.year}-${String(i+1).padStart(2,'0')}`,row=rows.find(row=>row.month===month);
    const known=typeof row?.paid_nodus==='string'&&/^\d+(?:\.\d{1,8})?$/.test(row.paid_nodus)&&Number.isFinite(Number(row.paid_nodus));
    const amount=known?Number(row.paid_nodus):null;
    const name=new Intl.DateTimeFormat(locale(),{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(Date.UTC(state.year,i,1)));
    const tooltip=known?t(row.payout_count===1?'{month}: {amount} NODUS · {count} maksu':'{month}: {amount} NODUS · {count} maksua',{month:name,amount:decimalFi(row.paid_nodus),count:int(row.payout_count)}):t('{month}: määrätieto ei saatavilla',{month:name});
    return {month,amount,known,tooltip,count:row?.payout_count};
  });
  return rewardBarsChart(months);
}
function rewardBarsChart(points,daily=false){
  const selection=daily?state.rewardDay:state.rewardMonth;
  const selected=points.find(row=>(daily?row.day:row.month)===selection)||points.filter(row=>row.known&&Number(row.count)>0).at(-1)||points[0];
  const scale=rewardChartScale(Math.max(0,...points.filter(row=>row.known).map(row=>row.amount)));
  const width=daily?points.length*42+22:710,left=daily?0:82,right=width-22,top=34,bottom=202,slot=(right-left)/points.length,y=value=>bottom-value/scale.top*(bottom-top);
  let axis='<text class="reward-axis-unit" x="70" y="15" text-anchor="end">NODUS</text>';
  let svg=`<svg viewBox="0 0 ${width} 248" ${daily?`style="min-width:${width}px"`:''} role="group" aria-label="${esc(daily?t('Päivittäiset palkkiot NODUS-tokenina'):t('Kuukausittaiset palkkiot NODUS-tokenina'))}">${daily?'':axis}`;
  for(let i=0;i<=scale.count;i++){
    const value=i*scale.step,pos=y(value);
    svg+=`<line class="grid-line" x1="${left}" y1="${pos}" x2="${right}" y2="${pos}"/>`;
    const tick=`<text class="reward-axis-label" x="70" y="${pos+3}" text-anchor="end">${esc(rewardChartNumber(value,scale.digits))}</text>`;
    if(daily)axis+=tick;else svg+=tick;
  }
  points.forEach((row,i)=>{
    const x=left+slot*(i+.5),bar=row.known?row.amount/scale.top*(bottom-top):0,active=daily?row.day===selected.day:row.month===selected.month;
    const digits=row.amount>0?Math.min(8,Math.max(2,1-Math.floor(Math.log10(row.amount)))):0;
    svg+=`<g class="reward-month-bar" role="button" tabindex="0" aria-label="${esc(row.tooltip)}" aria-pressed="${active}" data-month="${row.month}" ${daily?`data-day="${row.day}"`:''} data-tooltip="${esc(row.tooltip)}"><title>${esc(row.tooltip)}</title><rect class="reward-month-hit" x="${left+i*slot}" y="${top-20}" width="${slot}" height="${bottom-top+52}" fill="transparent"/>${row.known?`<rect class="reward-bar" x="${x-13}" y="${bottom-bar}" width="26" height="${bar}" rx="3" fill="#5de0df"/><text class="reward-bar-value" x="${x}" y="${bottom-bar-9}" text-anchor="middle">${esc(rewardChartNumber(row.amount,digits))}</text>`:`<text class="reward-bar-value" x="${x}" y="${bottom-9}" text-anchor="middle">—</text>`}<text class="reward-month-label" x="${x}" y="${bottom+24}" text-anchor="middle">${i+1}</text></g>`;
  });
  const plot=daily?`<div class="reward-daily-layout"><svg class="reward-day-axis" viewBox="0 0 82 248" aria-hidden="true">${axis}</svg><div class="reward-chart-scroll">${svg}</svg></div></div>`:`<div class="reward-chart-scroll">${svg}</svg></div>`;
  return `<div class="chart-box reward-month-chart">${plot}<div class="reward-chart-readout" id="reward-chart-tooltip" role="status" aria-live="polite">${esc(selected.tooltip)}</div><p class="reward-chart-help">${daily?t('Valitse päivä hiirellä, koskettamalla tai näppäimistöllä. Voit vierittää kuvaajaa sivusuunnassa.'):t('Valitse kuukausi hiirellä, koskettamalla tai näppäimistöllä. Summat koskevat kerättyjä maksuja.')}</p></div>`;
}
function eventItems(){const e=state.events;const rows=Array.isArray(e)?e:Array.isArray(e?.items)?e.items:Array.isArray(e?.events)?e.events:[];return rows.slice().sort((a,b)=>new Date(b.timestamp||b.time||0)-new Date(a.timestamp||a.time||0));}
function eventsTable(rows){if(!rows.length)return empty(t('Tapahtumaloki odottaa kerääjää'),t('Uudet yhteysvirheet, synkronointitapahtumat ja palveluiden tilamuutokset tallentuvat tänne.'),'activity',true);return `<div class="table-wrap"><table class="data-table"><thead><tr><th>${t("Aika · Helsinki")}</th><th>${t("Tapahtuma")}</th><th>${t("Lähde")}</th><th>${t("Taso")}</th></tr></thead><tbody>${rows.map(event=>{const severity=String(event.level||event.severity||'info').toLowerCase();const cls=/error|err|critical/.test(severity)?'error':/warn/.test(severity)?'warning':'info';const title=event.title||event.type||event.message||t('Tapahtuma');return `<tr><td class="mono">${esc(compactDate(event.timestamp||event.time))}</td><td><strong><i class="event-indicator ${cls}"></i>${esc(dataText(title))}</strong>${event.message&&event.message!==title?`<br><span>${esc(dataText(event.message))}</span>`:''}</td><td class="mono">${esc(event.source||event.service||t('Kerääjä'))}</td><td>${pill(cls==='error'?t('Virhe'):cls==='warning'?t('Huomio'):t('Tieto'),cls==='error'?'red':cls==='warning'?'amber':'muted',false)}</td></tr>`;}).join('')}</tbody></table></div>`;}
function events(){const all=eventItems(),filtered=state.eventFilter==='all'?all:all.filter(event=>{const sev=String(event.level||event.severity||'info').toLowerCase();return state.eventFilter==='warning'?/warn|error|err|critical/.test(sev):!(/warn|error|err|critical/.test(sev));});return `${heading(t('TAPAHTUMAT / DIAGNOSTIIKKA'),t('Jäljet kertovat, mitä tapahtui.'),t('Synkronointi, yhteydet ja palvelut samalla aikajanalla.'))}<div class="notice cyan"><span data-icon="info"></span><div><strong>${state.mode==='snapshot'?t('Synteettinen esimerkkiaikajana.'):t('Kerääjän tallentamat lokihavainnot.')}</strong> ${state.mode==='snapshot'?t('Nämä tapahtumat on luotu käyttöliittymän esittelyä varten. Ne eivät ole palvelimen lokihavaintoja.'):t('Loki on seurantaa varten poimittu tapahtumajoukko. Täydet palvelulokit säilyvät palvelimella.')}</div></div><div class="event-filters" aria-label="${esc(t("Suodata tapahtumia"))}">${[['all','Kaikki tapahtumat'],['warning','Huomiot & virheet'],['info','Tilamuutokset']].map(([filter,label])=>`<button class="filter ${filter===state.eventFilter?'active':''}" data-filter="${filter}" aria-pressed="${filter===state.eventFilter}">${t(label)}</button>`).join('')}<span class="year-label" style="margin-left:auto">${t('{count} TAPAHTUMAA',{count:int(filtered.length)})}</span></div><section class="panel">${eventsTable(filtered)}</section><div class="section-heading"><h2>${t("Mitä seuranta kertoo?")}</h2></div><div class="equal-cols"><section class="panel panel-pad"><span class="eyebrow">${t("SYNKRONOINTI")}</span><h2 class="panel-title">${t("Lohkoero tarvitsee myös kontekstin.")}</h2><p class="panel-subtitle" style="font-size:11px;line-height:1.9;margin-top:14px">${t("Palvelu voi olla käynnissä, vaikka ketju jäisi jälkeen. Seuranta yhdistää lohkoeron, etenemisnopeuden ja lokihavainnot. Epäonnistunutta mittausta ei merkitä terveeksi tilaksi.")}</p></section>${configuredRoles().storage?`<section class="panel panel-pad"><span class="eyebrow">${t("STORAGE-TARKISTUKSET")}</span><h2 class="panel-title">${t("Fail streak on ketjun jälki.")}</h2><p class="panel-subtitle" style="font-size:11px;line-height:1.9;margin-top:14px">${t("Ketju ei säilytä yksittäisen noden jokaista tarkistusratkaisua. Näytämme vahvistetun fail_streak-arvon ja paikalliset havainnot. Täydellistä tarkistusten onnistumisprosenttia ei muodosteta puuttuvasta aineistosta.")}</p></section>`:''}</div>`;}

function render(){
  globalThis.NodusObservatorySettings?.capture();
  globalThis.NodusTrade?.capture();
  const roles=configuredRoles(),requested=location.hash.slice(1)||state.dashboard?.monitor?.default_view||state.monitorSettings?.default_view||'overview';
  state.page=PAGES[requested]?requested:'overview';
  if(state.page==='storage'&&!roles.storage||state.page==='witness'&&!roles.witness)state.page='overview';
  const studio=['contracts','contracts-escrow','contracts-editor'].includes(state.page),settings=state.page==='settings',trade=state.page==='trade',statistics=state.page==='statistics';
  if(!statistics)globalThis.NodusStatistics?.unmount();
  document.title=`${t(PAGES[state.page])} — Nodus Observatory`;
  document.querySelector('#breadcrumb-page').textContent=t(PAGES[state.page]);
  document.querySelectorAll('[data-hostname]').forEach(el=>el.textContent=nodeDisplayName());
  document.querySelector('#server-model').textContent=roleLabel();
  document.querySelectorAll('[data-page]').forEach(a=>{const active=a.dataset.page===state.page;a.classList.toggle('active',active);if(active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');if(a.dataset.role)a.hidden=!roles[a.dataset.role];});
  document.querySelectorAll('[data-area]').forEach(a=>{const active=a.dataset.area===(studio?'studio':trade?'trade':settings?'settings':statistics?'statistics':'observatory');a.classList.toggle('active',active);if(active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
  const views=document.querySelector('#view-mode');
  if(views){const roleViews=[['overview','Yleiskuva'],...(roles.storage?[['storage','Tallennustila']]:[]),...(roles.witness?[['witness','Todistaja']]:[])];views.innerHTML=roleViews.map(([value,label])=>`<option value="${value}"${value===state.page?' selected':''}>${t(label)}</option>`).join('')+(!studio&&!settings&&!trade&&!roleViews.some(([value])=>value===state.page)?`<option value="${state.page}" selected disabled>${t(PAGES[state.page])}</option>`:'');views.value=state.page;views.onchange=()=>{location.hash='#'+views.value;};}
  document.querySelector('.topbar-context')?.classList.toggle('is-observatory',!studio&&!settings&&!trade&&!statistics);
  const viewSwitch=document.querySelector('#view-switch');if(viewSwitch)viewSwitch.hidden=studio||settings||trade||statistics;
  const access=document.querySelector('#access-mode');if(access)access.hidden=settings||studio||trade;
  if(statistics){
    const banner=document.querySelector('#source-banner');banner.classList.remove('live');banner.style.color='';
    document.querySelector('#source-label').textContent=t('Verkon tilastot ja havaintohistoria');
    document.querySelector('#source-detail').textContent=t('NODUS TESTNET · VAIN LUKU');
    const target=document.querySelector('#page-content');
    if(globalThis.NodusStatistics)globalThis.NodusStatistics.mount(target,{demo:state.mode==='snapshot'&&state.dashboard?.preview===true});
    else target.innerHTML=`<section class="panel panel-pad"><h1>${t('Tilastot')}</h1><p>${t('Tilastojen tiedostot puuttuvat. Päivitä asennus.')}</p></section>`;
    return;
  }
  if(trade){
    const banner=document.querySelector('#source-banner');banner.classList.remove('live');banner.style.color='';
    document.querySelector('#source-label').textContent=t('Selaimessa valmisteltava NODUS / BNB -kauppa');
    document.querySelector('#source-detail').textContent=t('TESTIVERKOT · PAIKALLINEN SIMULAATIO');
    const target=document.querySelector('#page-content');
    if(globalThis.NodusTrade)globalThis.NodusTrade.mount(target);
    else target.innerHTML=`<section class="panel panel-pad"><h1>Trade / Swap</h1><p>${t('Trade / Swap -tiedostot puuttuvat. Päivitä asennus.')}</p></section>`;
    return;
  }
  if(studio){
    const escrow=state.page==='contracts-escrow',builder=state.page==='contracts-editor';
    document.querySelector('#source-banner').classList.remove('live');
    document.querySelector('#source-banner').style.color='';
    document.querySelector('#source-label').textContent=t(builder?'Selaimessa toimiva sopimuseditori':escrow?'Selaimessa toimiva escrow-prototyyppi':'Asiakirjan tiiviste selaimessa, rekisteritieto omalta nodelta');
    document.querySelector('#source-detail').textContent=t(escrow||builder?'PAIKALLINEN LUONNOS · EI KETJUKUTSUJA':'LEIMAUS LOMPAKOSSA · TARKISTUS VAIN LUKU');
    const target=document.querySelector('#page-content'),module=builder?globalThis.NodusWorkflowStudio:escrow?globalThis.NodusContractStudio:globalThis.NodusDocumentNotary;
    if(module)module.mount(target,builder?{route:'#contracts-editor'}:escrow?{route:'#contracts-escrow'}:undefined);
    else target.innerHTML=`<section class="panel panel-pad"><h1>${t('Sopimusstudio')}</h1><p>${t('Sopimusstudion tiedostot puuttuvat. Päivitä sivu tai asennus.')}</p></section>`;
    return;
  }
  if(settings){
    const banner=document.querySelector('#source-banner');banner.classList.remove('live');banner.style.color='';
    document.querySelector('#source-label').textContent=t('Observatoryn omat asetukset');
    document.querySelector('#source-detail').textContent=t('NODEN SEURANTA');
    const target=document.querySelector('#page-content'),module=globalThis.NodusObservatorySettings;
    if(module)module.mount(target,{demo:state.mode==='snapshot',onSaved:settings=>applyMonitorSettings(settings,true),onLoaded:applyMonitorSettings});
    else target.innerHTML=`<section class="panel panel-pad"><h1>${t('Asetukset')}</h1><p>${t('Asetussivun tiedostot puuttuvat. Päivitä asennus.')}</p></section>`;
    return;
  }
  if(state.loadError){renderLoadError();return;}
  if(!state.dashboard){document.querySelector('#source-label').textContent=t('Haetaan seurannan tietoja…');return;}
  sourceBanner();
  const page={overview,storage,witness,network,rewards,events}[state.page];
  document.querySelector('#page-content').innerHTML=collectionNotice()+page();hydrateIcons();bindPage();
}
function applyMonitorSettings(settings,saved=false){if(!settings)return;const changed=JSON.stringify(state.monitorSettings)!==JSON.stringify(settings);state.monitorSettings=settings;if(saved&&state.dashboard)state.dashboard.monitor={...state.dashboard.monitor,node_name:settings.node_name,roles:settings.roles,default_view:settings.default_view};if(changed||saved)render();}
function bindPage(){
  document.querySelectorAll('[data-range]').forEach(button=>button.onclick=async()=>{state.hours=Number(button.dataset.range);if(state.mode==='live'){try{const response=await getData(`/api/history?hours=${state.hours}`,'history.json');state.history=response.data;}catch{toast('Historiatietoja ei voitu hakea.');}}render();});
  document.querySelectorAll('.copy-fp').forEach(button=>button.onclick=async()=>{try{await navigator.clipboard.writeText(state.dashboard.node?.fingerprint||'');toast('Noden sormenjälki kopioitu.');}catch{toast('Kopiointi ei onnistunut tässä selaimessa.');}});
  document.querySelectorAll('.chart-point').forEach(point=>{const target=document.querySelector('#chart-tooltip');const show=()=>{if(target)target.textContent=point.dataset.tooltip;};point.onmouseenter=show;point.onfocus=show;point.onmouseleave=()=>{if(target)target.textContent='';};point.onblur=point.onmouseleave;});
  const monthBars=document.querySelectorAll('.reward-month-bar');
  monthBars.forEach(point=>{
    const select=()=>{
      if(point.dataset.day)state.rewardDay=point.dataset.day;else state.rewardMonth=point.dataset.month;
      const target=document.querySelector('#reward-chart-tooltip');
      if(target)target.textContent=point.dataset.tooltip;
      monthBars.forEach(bar=>bar.setAttribute('aria-pressed',String(bar===point)));
    };
    point.onmouseenter=select;point.onfocus=select;point.onclick=select;
    point.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();select();}};
  });
  document.querySelectorAll('[data-filter]').forEach(button=>button.onclick=()=>{state.eventFilter=button.dataset.filter;render();});
  if(state.rewardPeriod==='daily'){
    const selected=[...monthBars].find(bar=>bar.dataset.day&&bar.getAttribute('aria-pressed')==='true');
    const viewport=document.querySelector('.reward-month-chart .reward-chart-scroll');
    if(selected&&typeof selected.getBoundingClientRect==='function'&&typeof viewport?.getBoundingClientRect==='function'){
      const bar=selected.getBoundingClientRect(),view=viewport.getBoundingClientRect();
      if(bar.left<view.left||bar.right>view.right)viewport.scrollLeft+=bar.left-view.left+(bar.width-view.width)/2;
    }
  }
  document.querySelectorAll('[data-reward-period]').forEach(button=>button.onclick=()=>{
    if(['daily','monthly'].includes(button.dataset.rewardPeriod)){state.rewardPeriod=button.dataset.rewardPeriod;render();}
  });
  const chartMonth=document.querySelector('#reward-chart-month');
  if(chartMonth)chartMonth.onchange=()=>{
    if(new RegExp(`^${state.year}-(0[1-9]|1[0-2])$`).test(chartMonth.value)){
      state.rewardDailyMonth=chartMonth.value;state.rewardMonth=chartMonth.value;state.rewardDay=null;render();
    }
  };
  const year=document.querySelector('#reward-year');if(year)year.onchange=async()=>{state.year=Number(year.value);state.rewardMonth=null;state.rewardDailyMonth=null;state.rewardDay=null;if(state.mode==='live'){try{const result=await getData(`/api/rewards?year=${state.year}`,'rewards.json');state.rewards=result.data;}catch{toast('Palkkiotietoja ei voitu hakea.');}}else {const saved=state.rewardsSnapshot||state.rewards;state.rewards=Number(saved?.year)===state.year?saved:{...saved,year:state.year,items:[],releases:[],monthly:[],summary:{},source:{status:'unavailable',reason:'Tälle vuodelle ei ole tallennettua aineistoa.',complete_year:false}};}render();};
  const exportButton=document.querySelector('#export-rewards');if(exportButton)exportButton.onclick=exportRewards;
}
async function exportRewards(){
  if(state.mode==='live'){try{const response=await fetch(`/api/rewards/export.csv?year=${state.year}`,{cache:'no-store'});if(!response.ok)throw Error();const blob=await response.blob();downloadBlob(blob,`nodus-rewards-${state.year}.csv`);toast('Palkkioiden CSV ladattu. Tarkista lähdekattavuus ja puuttuvat arvostukset.');return;}catch{toast('CSV-vienti epäonnistui. Vientiä ei luotu; yritä uudelleen.');return;}}
  const r=state.rewards||{},items=[...(Array.isArray(r.items)?r.items:[]),...(Array.isArray(r.releases)?r.releases:[])],source=r.source||{},runs=source.runs||[];
  const header=['event_id','network','chain_id','owner_fp','node_fp','kind','height','item_pos','sequence','block_time_utc','block_time_local','amount_raw','amount_nodus','attribution','eur_value','price_eur','valuation_source','valuation_at','valuation_note','source','observed_at','report_year','report_timezone','source_from_height','source_at_height','source_status','source_coverage_runs','year_coverage_complete'];
  const data=items.length?items:[{kind:'coverage_metadata',network:r.network||'testnet',chain_id:r.chain_id,owner_fp:r.owner_fp,node_fp:r.node_fp}];
  const rows=data.map(item=>{const matches=runs.filter(run=>finite(item.height)&&run.source===item.source&&run.from_height<=item.height&&run.at_height>=item.height).sort((a,b)=>b.at_height-a.at_height||b.from_height-a.from_height);const coverage=matches[0]||source;const row={...item,report_year:state.year,report_timezone:r.timezone||'Europe/Helsinki',source_from_height:coverage.from_height,source_at_height:coverage.at_height,source_status:source.status||'unavailable',source_coverage_runs:JSON.stringify(runs),year_coverage_complete:'false'};return header.map(key=>row[key]);});
  const csv=[header,...rows].map(row=>row.map(v=>{let text=String(v??'');if(/^[\s]*[=+@\t\r-]/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"';}).join(',')).join('\r\n');downloadBlob(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}),`nodus-rewards-${state.year}.csv`);toast(items.length?'CSV ladattu näkyvästä aineistosta.':'CSV ladattu kattavuustiedoilla. Maksutietoja ei ole tässä aineistossa.');
}
function downloadBlob(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
let toastSource='';
function toast(message){toastSource=message;const el=document.querySelector('#toast');el.textContent=dataText(message);el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),4500);}
// Deferred translation modules load after i18n's first document pass. Apply
// their shell labels before the first render, including a remembered language.
NodusI18n.applyDocument();
hydrateIcons();
document.querySelector('#refresh').onclick=()=>state.page==='statistics'?globalThis.NodusStatistics?.mount(document.querySelector('#page-content'),{demo:state.mode==='snapshot'&&state.dashboard?.preview===true,refresh:true}):loadData(true);
document.querySelectorAll('.about-trigger').forEach(button=>button.onclick=()=>document.querySelector('#about-dialog').showModal());
document.querySelectorAll('.dialog-close').forEach(button=>button.onclick=()=>document.querySelector('#about-dialog').close());
document.querySelector('#about-dialog').onclick=event=>{if(event.target===event.currentTarget){const rect=event.currentTarget.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)event.currentTarget.close();}};
const menu=document.querySelector('#menu');menu.onclick=()=>{const open=document.querySelector('#sidebar').classList.toggle('open');menu.setAttribute('aria-expanded',String(open));};
document.addEventListener('keydown',event=>{if(event.key==='Escape'){document.querySelector('#sidebar').classList.remove('open');menu.setAttribute('aria-expanded','false');}});
window.addEventListener('beforeunload',event=>{if(globalThis.NodusObservatorySettings?.isDirty()){event.preventDefault();event.returnValue='';}});
window.addEventListener('hashchange',()=>{document.querySelector('#sidebar').classList.remove('open');menu.setAttribute('aria-expanded','false');render();window.scrollTo({top:0});});
window.addEventListener('languagechange',()=>{render();const el=document.querySelector('#toast');if(el.classList.contains('show')&&toastSource)el.textContent=dataText(toastSource);});
render();
globalThis.NodusObservatorySettings?.load().then(applyMonitorSettings);
loadData();
