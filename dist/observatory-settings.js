/* Observatory settings: validated server persistence; drafts stay in this tab. */
(() => {
  'use strict';
  const t=(key,params)=>globalThis.NodusI18n?.t(key,params)??key;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clone=value=>JSON.parse(JSON.stringify(value));
  const fields=['node_name','default_view','roles','history_days','network_interface','disk_device','network_enabled','rewards_enabled','rewards_scan_enabled'];
  const defaults={node_name:'',roles:{storage:true,witness:true},default_view:'overview',history_days:30,network_interface:null,disk_device:null,network_enabled:true,rewards_enabled:true,rewards_scan_enabled:true,cli_path:'',data_path:'',mount_path:'',rewards_source_db:''};
  const state={saved:null,draft:null,editable:[],revision:null,token:null,loading:false,busy:false,error:null,conflict:false,notice:null,checks:[],validation:{},readOnlyNote:'',settingsError:''};
  let root=null,options={},pending=null;
  const active=()=>globalThis.location?.hash==='#settings';
  const isDirty=()=>Boolean(state.saved&&state.draft&&fields.some(key=>JSON.stringify(state.saved[key])!==JSON.stringify(state.draft[key])));
  const editable=key=>state.editable.includes(key);
  const enabled=key=>Boolean(state.saved&&editable(key)&&!state.busy&&!state.loading&&!options.demo);
  function capture(){
    if(!root||!active()||!state.draft)return;
    root.querySelectorAll('[data-setting]').forEach(el=>{
      const key=el.dataset.setting;if(!enabled(key.split('.')[0]))return;
      if(key.startsWith('roles.'))state.draft.roles[key.slice(6)]=el.checked;
      else if(el.type==='checkbox'||['network_enabled','rewards_enabled','rewards_scan_enabled'].includes(key))state.draft[key]=el.checked;
      else if(key==='history_days')state.draft[key]=el.value===''?'':Number(el.value);
      else state.draft[key]=['network_interface','disk_device'].includes(key)?el.value.trim()||null:el.value;
    });
  }
  function normalize(value){return {...defaults,...value,roles:{...defaults.roles,...value?.roles}};}
  function editablePayload(){const payload={};for(const key of fields)if(editable(key))payload[key]=clone(state.draft[key]);return payload;}
  function updateControls(){
    if(!root||!active())return;
    const save=root.querySelector('#settings-save'),check=root.querySelector('#settings-check'),discard=root.querySelector('#settings-discard');
    if(save)save.disabled=!state.saved||(!isDirty()&&!state.settingsError)||state.busy||state.loading||Boolean(options.demo)||!state.editable.length||state.conflict;
    if(check)check.disabled=!state.saved||state.busy||state.loading||Boolean(options.demo)||state.conflict;
    if(discard)discard.disabled=!isDirty()&&!state.conflict||state.busy||state.loading;
    const dirty=root.querySelector('#settings-draft-status');if(dirty)dirty.textContent=t(state.settingsError?'Asetustiedosto korjattava':isDirty()?'Tallentamattomia muutoksia':'Asetukset ajan tasalla');
  }
  async function load({discardDraft=false}={}){
    if(pending)return pending;
    if(state.saved&&!discardDraft)return clone(state.saved);
    state.loading=true;state.error=null;render();
    pending=(async()=>{
      try{
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),6000);
        let response;try{response=await fetch('/api/settings',{cache:'no-store',signal:controller.signal});}finally{clearTimeout(timer);}
        if(!response.ok)throw Object.assign(new Error('settings_unavailable'),{status:response.status});
        const data=await response.json();
        if(!data||typeof data.settings!=='object'||!Array.isArray(data.editable_fields)||typeof data.revision!=='string'||typeof data.csrf_token!=='string')throw new Error('settings_unavailable');
        const preserve=isDirty()&&!discardDraft;
        state.saved=normalize(data.settings);if(!preserve)state.draft=clone(state.saved);
        state.editable=data.editable_fields.filter(key=>fields.includes(key));state.revision=data.revision;state.token=data.csrf_token;
        state.readOnlyNote=typeof data.read_only_note==='string'?data.read_only_note:'';state.settingsError=typeof data.settings_error==='string'?data.settings_error:'';
        state.conflict=false;state.checks=[];state.validation={};if(discardDraft)state.notice='Tallentamattomat muutokset hylättiin.';
        options.onLoaded?.(clone(state.saved));return clone(state.saved);
      }catch{state.error='unavailable';return state.saved?clone(state.saved):null;}
      finally{state.loading=false;pending=null;render();}
    })();
    return pending;
  }
  async function submit(save){
    capture();if(!state.saved||state.busy||options.demo||!state.editable.length||state.conflict||(save&&!isDirty()&&!state.settingsError))return;
    if(!validateDraft()){render();root.querySelector('[aria-invalid="true"]')?.focus();return;}
    state.busy=true;state.error=null;state.notice=null;state.checks=[];render();
    try{
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
      let response;try{response=await fetch(save?'/api/settings':'/api/settings/check',{method:'POST',cache:'no-store',signal:controller.signal,headers:{'Content-Type':'application/json','X-CSRF-Token':state.token},body:JSON.stringify({settings:editablePayload(),revision:state.revision})});}finally{clearTimeout(timer);}
      let data;try{data=await response.json();}catch{throw new Error('unavailable');}
      if(response.status===409){state.conflict=true;state.error='conflict';return;}
      if(!response.ok){state.error='invalid';state.diagnostic=typeof data?.error==='string'?data.error:'';return;}
      if(save){
        if(data.saved!==true||typeof data.settings!=='object'||typeof data.revision!=='string'||typeof data.csrf_token!=='string')throw new Error('unavailable');
        state.saved=normalize(data.settings);state.draft=clone(state.saved);state.revision=data.revision;state.token=data.csrf_token;
        state.editable=(data.editable_fields||state.editable).filter(key=>fields.includes(key));state.conflict=false;state.validation={};
        state.settingsError='';state.notice='Asetukset tallennettu. Seuranta käyttää niitä seuraavalla keruukerralla.';options.onSaved?.(clone(state.saved));
      }else{
        if(typeof data.valid!=='boolean'||!Array.isArray(data.checks))throw new Error('unavailable');
        state.checks=data.checks.filter(item=>item&&typeof item==='object');
        state.notice=data.valid?'Asetusten tarkistus valmis. Asetuksia ei tallennettu.':'Tarkista asetukset ennen tallennusta.';
      }
    }catch{state.error='request';}
    finally{state.busy=false;render();}
  }
  function fieldError(key){return state.validation[key]?`<small class="settings-field-error" id="setting-${key}-error">${esc(t(state.validation[key]))}</small>`:'';}
  function validateDraft(){
    const d=state.draft;state.validation={};
    if(editable('roles')&&!d.roles.storage&&!d.roles.witness)state.validation.roles='Valitse vähintään yksi seurattava rooli.';
    if(editable('node_name')&&([...String(d.node_name)].length>80||/[\x00-\x1f\x7f]/.test(d.node_name)))state.validation.node_name='Nimessä saa olla enintään 80 merkkiä ilman ohjausmerkkejä.';
    if(editable('default_view')&&!['overview','storage','witness'].includes(d.default_view))state.validation.default_view='Valitse kelvollinen oletusnäkymä.';
    if(editable('history_days')&&(!Number.isInteger(d.history_days)||d.history_days<1||d.history_days>366))state.validation.history_days='Anna kokonaisluku väliltä 1–366.';
    for(const key of ['network_interface','disk_device']){const pattern=key==='network_interface'?/^[a-zA-Z0-9_.:-]{1,80}$/:/^[a-zA-Z0-9_.-]{1,80}$/;if(editable(key)&&d[key]!==null&&(!pattern.test(d[key])||['.','..'].includes(d[key])))state.validation[key]='Anna pelkkä laitteen nimi ilman polkua tai välilyöntejä.';}
    return !Object.keys(state.validation).length;
  }
  function field(key,label,help='',type='text',readOnly=false){
    const value=state.draft?.[key]??'',disabled=readOnly||!enabled(key);
    return `<label class="settings-field" for="setting-${key}"><span>${esc(t(label))}</span><input id="setting-${key}" data-setting="${key}" type="${type}" value="${esc(value)}"${type==='number'?' min="1" max="366" step="1"':''}${key==='node_name'?' maxlength="80"':''}${disabled?' disabled':''}${readOnly?' readonly':''}${state.validation[key]?` aria-invalid="true" aria-errormessage="setting-${key}-error"`:''} autocomplete="off" spellcheck="false"${help?` aria-describedby="setting-${key}-help"`:''}>${help?`<small id="setting-${key}-help">${esc(t(help))}</small>`:''}${fieldError(key)}</label>`;
  }
  function checkbox(key,label,help=''){
    const value=key.startsWith('roles.')?state.draft?.roles?.[key.slice(6)]:state.draft?.[key],parent=key.split('.')[0];
    return `<label class="settings-choice" for="setting-${key.replace('.','-')}"><input id="setting-${key.replace('.','-')}" data-setting="${key}" type="checkbox"${value?' checked':''}${!enabled(parent)?' disabled':''}><span><strong>${esc(t(label))}</strong>${help?`<small>${esc(t(help))}</small>`:''}</span></label>`;
  }
  function errorPanel(){
    if(!state.error)return '';
    const text={unavailable:'Asetuspalvelua ei tavoitettu. Avaa live-asennus tai yritä uudelleen.',request:'Pyyntö epäonnistui. Luonnos säilyi. Tarkista palvelimen asetukset ennen uutta tallennusta.',conflict:'Asetuksia muutettiin toisessa ikkunassa. Luonnos säilyi. Hylkää muutokset ja hae tallennetut asetukset ennen uutta tallennusta.',invalid:'Asetuksia ei hyväksytty. Korjaa arvot ja yritä uudelleen.'}[state.error];
    return `<div class="settings-message error" role="alert"><strong>${esc(t(text))}</strong>${state.error==='invalid'&&state.diagnostic?`<p>${esc(diagnostic(state.diagnostic))}</p>`:''}${state.error==='unavailable'?`<button type="button" class="button" id="settings-retry">${esc(t('Yritä uudelleen'))}</button>`:''}</div>`;
  }
  function diagnostic(message){
    const service=String(message).match(/^Latest observed service state: (active|inactive|failed|unknown)\.$/);
    if(service)return t('Viimeisin havaittu palvelun tila: {state}.',{state:t({active:'Käynnissä',inactive:'Ei käynnissä',failed:'Virhe',unknown:'Ei tietoa'}[service[1]])});
    const known={'Service observations are missing or stale. The collector checks this role on the next sample.':'Palveluhavainnot puuttuvat tai ovat vanhentuneet. Kerääjä tarkistaa roolin seuraavalla keruukerralla.','default_view must be overview, storage or witness':'Valitse kelvollinen oletusnäkymä.','Settings are valid. Checking does not change files or services.':'Asetukset ovat kelvolliset. Tarkistus ei muuta tiedostoja tai palveluita.','Configured CLI is executable.':'Määritetty CLI on suoritettavissa.','Configured CLI cannot be verified as executable from the dashboard service.':'CLI:n suoritusoikeutta ei voitu vahvistaa seurantapalvelusta.','No service observation is available yet. The collector checks this role on the next sample.':'Palveluhavaintoa ei vielä ole. Kerääjä tarkistaa roolin seuraavalla keruukerralla.','Installation paths are administrator-managed. The collector reports filesystem health; the dashboard sandbox does not inspect Nodus data.':'Palvelimen ylläpitäjä määrittää polut. Kerääjä raportoi tiedostojärjestelmän tilan; selaimen palvelu ei tutki Noduksen dataa.','node_name must be at most 80 characters without control characters':'Nimessä saa olla enintään 80 merkkiä ilman ohjausmerkkejä.','roles must contain storage and witness booleans, with at least one enabled':'Valitse vähintään yksi seurattava rooli.','history_days must be an integer between 1 and 366':'Anna kokonaisluku väliltä 1–366.','network_interface must be null or a valid device identifier':'Anna pelkkä laitteen nimi ilman polkua tai välilyöntejä.','disk_device must be null or a valid device identifier':'Anna pelkkä laitteen nimi ilman polkua tai välilyöntejä.','roles must enable storage, witness, or both':'Valitse vähintään yksi seurattava rooli.','At least one role must be enabled':'Valitse vähintään yksi seurattava rooli.','node_name must be a string of at most 80 characters':'Noden nimessä saa olla enintään 80 merkkiä.'};
    return known[message]?t(known[message]):message;
  }
  function render(){
    if(!root||!active())return;
    const draft=state.draft||defaults;
    root.innerHTML=`<section class="observatory-settings" id="observatory-settings"><div class="page-heading"><div><span class="eyebrow">${esc(t('OMA NODE / ASETUKSET'))}</span><h1>${esc(t('Oman noden näköinen seuranta.'))}</h1><p>${esc(t('Valitse seurattavat roolit ja Observatoryn asetukset.'))}</p></div><span class="settings-state" id="settings-draft-status" role="status">${esc(t(state.settingsError?'Asetustiedosto korjattava':isDirty()?'Tallentamattomia muutoksia':'Asetukset ajan tasalla'))}</span></div>
      <div class="notice cyan"><div><strong>${esc(t('Nämä ovat Observatoryn asetuksia.'))}</strong> ${esc(t('Roolivalinta määrittää seurannan. Nodus-palvelujen käyttöönotto ja käynnistys tehdään palvelimella.'))}</div></div>
      ${options.demo?`<div class="settings-message" role="status">${esc(t('Demo näyttää esimerkkitietoja. Palvelimen asetuksia ei voi tallentaa tässä näkymässä.'))}</div>`:''}${state.settingsError?`<div class="settings-message error" role="alert"><strong>${esc(t('Tallennettua asetustiedostoa ei voitu lukea. Näytetään palvelimen perusasetukset. Tarkista arvot ja tallenna korjaus.'))}</strong><p>${esc(state.settingsError)}</p></div>`:''}${errorPanel()}${state.loading?`<p class="settings-loading" role="status">${esc(t('Haetaan asetuksia…'))}</p>`:''}
      <form id="settings-form"><section class="panel settings-panel"><h2>${esc(t('Node ja seurattavat roolit'))}</h2><p>${esc(t('Palvelun sammuminen ei poista valittua roolia seurannasta.'))}</p><div class="settings-fields">${field('node_name','Noden näyttönimi','Tyhjä nimi käyttää palvelimen nimeä.')}<label class="settings-field" for="setting-default_view"><span>${esc(t('Oletusnäkymä'))}</span><select id="setting-default_view" data-setting="default_view"${!enabled('default_view')?' disabled':''}${state.validation.default_view?' aria-invalid="true" aria-errormessage="setting-default_view-error"':''}>${[['overview','Yleiskuva'],['storage','Tallennustila'],['witness','Witness']].map(([value,label])=>`<option value="${value}"${draft.default_view===value?' selected':''}${value!=='overview'&&!draft.roles?.[value]?' disabled':''}>${esc(t(label))}</option>`).join('')}</select><small>${esc(t('Näkymä avautuu, kun osoitteessa ei ole sivuvalintaa.'))}</small>${fieldError('default_view')}</label></div><fieldset class="settings-roles"${state.validation.roles?' aria-invalid="true" aria-errormessage="setting-roles-error"':''}><legend>${esc(t('Seurattavat roolit'))}</legend>${checkbox('roles.storage','Storage','Arkistosegmentit ja storage-roolin tila.')}${checkbox('roles.witness','Witness','Witness-palvelu ja saatavilla olevat komiteatiedot.')}<small>${esc(t('Valitse vähintään yksi seurattava rooli.'))}</small>${fieldError('roles')}</fieldset></section>
      <section class="panel settings-panel"><h2>${esc(t('Historia ja tietolähteet'))}</h2><div class="settings-fields">${field('history_days','Mittaushistorian säilytysaika (päivää)','1–366 päivää. Palkkiokirjanpito säilytetään erikseen.','number')}${field('network_interface','Verkkoliitäntä','Tyhjä valinta seuraa oletusreittiä.')}${field('disk_device','Levylaitteen nimi','Esimerkiksi sda tai nvme0n1. Tyhjä valinta jättää laitekohtaiset mittarit tuntemattomiksi.')}</div><div class="settings-toggles">${checkbox('network_enabled','Ulkoiset verkkokyselyt','Hae julkisia verkkotilastoja ja sallitut Scan-historiatiedot.')}${checkbox('rewards_enabled','Palkkioiden keruu','Kerää omistajalompakon palkkiot samaan kirjanpitoon.')}${checkbox('rewards_scan_enabled','Scan-palkkiohistorian tuonti','Edellyttää ulkoisia verkkokyselyjä ja palkkioiden keruuta.')}</div><p class="settings-footnote">${esc(t('Roolivalinta ei erittele lompakon yhteisiä palkkioita storage- tai witness-tuotoiksi.'))}</p></section>
      <details class="panel settings-panel settings-advanced"><summary>${esc(t('Palvelimen polut ja lisätiedot'))}</summary><p>${esc(t('Nämä polut määritetään palvelimen asetustiedostossa. Selain ei voi muuttaa kerääjän suorittamaa ohjelmaa tai sen lukemia hakemistoja.'))}</p><div class="settings-fields">${field('cli_path','Nodus CLI',null,'text',true)}${field('data_path','Noduksen datahakemisto',null,'text',true)}${field('mount_path','Datahakemiston liitoskohta',null,'text',true)}${field('rewards_source_db','Palkkioiden lähdetietokanta',null,'text',true)}</div></details>
      <div class="settings-actions"><button type="button" class="button" id="settings-check">${esc(t(state.busy?'Käsitellään…':'Tarkista asetukset'))}</button><button type="submit" class="button primary" id="settings-save">${esc(t('Tallenna asetukset'))}</button><button type="button" class="button settings-discard" id="settings-discard">${esc(t('Hylkää muutokset'))}</button></div><p class="settings-footnote">${esc(t('Tallennus tulee voimaan seuraavalla keruukerralla. Kerätty historia säilyy.'))} ${esc(t('Luonnos säilyy tässä välilehdessä näkymää tai kieltä vaihtaessa.'))}</p></form>
      <div id="settings-result" aria-live="polite">${state.notice?`<p class="settings-message ${state.checks.length?'':'success'}">${esc(t(state.notice))}</p>`:''}${state.checks.length?`<ul class="settings-checks">${state.checks.map(check=>`<li class="${esc(['ok','unknown','warning'].includes(check.status)?check.status:'unknown')}"><strong>${esc(t({settings:'Asetukset',cli:'Nodus CLI',paths:'Polut'}[check.name]||check.name))}</strong><span>${esc(diagnostic(check.message||''))}</span><small>${esc(t(check.status==='ok'?'Kunnossa':check.status==='warning'?'Tarkista':'Ei voitu vahvistaa'))}</small></li>`).join('')}</ul>`:''}</div></section>`;
    bind();updateControls();
  }
  function bind(){
    const view=root.querySelector('#setting-default_view');if(view&&state.draft)view.value=state.draft.default_view;
    root.querySelectorAll('[data-setting]').forEach(el=>{
      const change=()=>{capture();state.notice=null;state.checks=[];delete state.validation[el.dataset.setting.split('.')[0]];updateControls();};
      el.addEventListener('input',change);el.addEventListener('change',()=>{change();if(el.dataset.setting.startsWith('roles.')){
        if(state.draft.default_view!=='overview'&&!state.draft.roles[state.draft.default_view])state.draft.default_view='overview';render();
      }});
    });
    const form=root.querySelector('#settings-form');if(form)form.onsubmit=event=>{event.preventDefault();return submit(true);};
    const check=root.querySelector('#settings-check');if(check)check.onclick=()=>submit(false);
    const discard=root.querySelector('#settings-discard');if(discard)discard.onclick=()=>load({discardDraft:true});
    const retry=root.querySelector('#settings-retry');if(retry)retry.onclick=()=>load();
  }
  function mount(target,nextOptions={}){capture();root=target;options=nextOptions;render();if(!state.saved&&!state.loading&&!state.error)void load();}
  globalThis.NodusObservatorySettings={mount,load,capture,isDirty,getSettings:()=>state.saved?clone(state.saved):null};
})();
