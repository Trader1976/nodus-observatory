/* Local visual workflow authoring. No wallet, RPC, signing or backend writes. */
(() => {
  'use strict';
  const core = () => globalThis.NodusWorkflowCore;
  const t = (key, params = {}) => globalThis.NodusBuilderText?.(key, params) ?? key;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clone = value => JSON.parse(JSON.stringify(value));
  const WORKING_KEY = 'nodus-observatory-contract-builder-v2';
  const CATALOG_KEY = 'nodus-observatory-contract-projects-v1';
  const CATALOG_SCHEMA = 'nodus-contract-studio/projects-v1';
  const MAX_CATALOG_LENGTH = 4 * 1024 * 1024;
  const MAX_PROJECTS = 50, WIDTH = 1200, HEIGHT = 650, NODE_WIDTH = 172;
  const operations = {move:'Move to state',deposit:'Receive deposit',transfer:'Transfer funds',approve:'Record approval',recordHash:'Record document hash'};
  const predicates = {beforeDeadline:'Before deadline',afterDeadline:'At or after deadline',balanceAtLeast:'Balance at least',approvedBy:'Approved by role',approvalCountAtLeast:'Approval quorum',hashEquals:'Recorded hash matches'};
  let root, draft, route = '#contracts-editor', language, activeTab = 'summary';
  let selection = {kind:'state',id:''}, changed = false, status = '', storageStatus = 'saved';
  let projectName = '', activeProjectId = null, activeRevision = null, selectedProjectId = '';
  let projects = [], catalogStatus = 'ready', projectMessage = '', replacement = null, pendingConversion = null, deleteId = null;
  let simulation = null, simulationExamples = false, trace = [], simActor = '', simValue = '', simHash = '', failTransfer = false;
  let zoomMode = 'fit', zoomScale = 1, drag = null, serial = 0, importSerial = 0;

  function currentLanguage() { return globalThis.NodusI18n?.language?.() || 'fi'; }
  function errorText(error) {
    const code = error?.code || 'invalid_project';
    return globalThis.NodusBuilderText?.error?.(error) || globalThis.NodusStudioText?.error?.(error) || t('Check {field}: {code}.',{field:error?.field || t('Project'),code});
  }
  function button(label, action, options = {}) {
    return `<button type="button" class="studio-button ${esc(options.className || '')}" data-builder-action="${esc(action)}"${options.disabled?' disabled':''}${options.title?` title="${esc(t(options.title))}"`:''}>${esc(options.raw?label:t(label))}</button>`;
  }
  function field(id,label,value,options={}) {
    return `<div class="wb-field"><label for="${esc(id)}">${esc(t(label))}</label><input id="${esc(id)}" type="${options.checkbox?'checkbox':'text'}"${options.checkbox?(value?' checked':''):` value="${esc(value)}"`} ${options.attribute || ''}${options.max?` maxlength="${options.max}"`:''} autocomplete="off" spellcheck="false">${options.help?`<small>${esc(t(options.help))}</small>`:''}</div>`;
  }
  function selectField(id,label,value,items,attribute='') {
    return `<div class="wb-field"><label for="${esc(id)}">${esc(t(label))}</label><select id="${esc(id)}" ${attribute}>${items.map(([key,text])=>`<option value="${esc(key)}"${key===value?' selected':''}>${esc(text)}</option>`).join('')}</select></div>`;
  }
  function newId(prefix, collection) {
    let id;do{id=`${prefix}_${++serial}`;}while(collection.some(item=>item.id===id));return id;
  }
  function parseProject(json) {
    const schema = JSON.parse(json)?.schema;
    return schema === 'nodus-contract-studio/v2' ? core().importProject(json) : globalThis.NodusStudioCore.importProject(json);
  }
  function templateDraft(template) {
    const project=core().defaultDraft(template);
    for(const items of [project.states,project.roles,project.transitions])for(const item of items)item.label=t(item.label);
    return project;
  }
  function initialDraft() {
    let value = templateDraft('escrow');
    try {
      const saved = globalThis.localStorage.getItem(WORKING_KEY);
      if (saved) {
        try { value=core().importProject(saved);changed=true; }
        catch { storageStatus='unreadable';status='The working draft could not be read. Its stored data has been retained.'; }
      } else globalThis.localStorage.setItem(WORKING_KEY,core().exportProject(value));
    } catch { storageStatus='unavailable'; }
    return value;
  }
  function persist() {
    try { globalThis.localStorage.setItem(WORKING_KEY,core().exportProject(draft));storageStatus='saved'; }
    catch(error) { storageStatus=error?.code==='invalid_project'?'invalid':'unavailable'; }
  }
  function edit(semantic=true) {
    changed=true;status='';projectMessage='';
    if(semantic){simulation=null;simulationExamples=false;trace=[];}
    persist();refreshDerived();
  }
  function statusText() { return status&&typeof status==='object'&&status.error?errorText(status.error):t(status); }
  function notify(message) { status=message;const element=root?.querySelector('#builder-message');if(element)element.textContent=statusText(); }
  function readCatalog() {
    let saved;
    try { saved=globalThis.localStorage.getItem(CATALOG_KEY); }
    catch { projects=[];catalogStatus='unavailable';return false; }
    try {
      if(saved===null){projects=[];catalogStatus='ready';return true;}
      if(saved.length>MAX_CATALOG_LENGTH)throw Error('size');
      const catalog=JSON.parse(saved),ids=new Set();
      if(catalog?.schema!==CATALOG_SCHEMA||!Array.isArray(catalog.projects)||catalog.projects.length>MAX_PROJECTS)throw Error('schema');
      for(const entry of catalog.projects){
        if(!entry||typeof entry.id!=='string'||!/^p-[a-zA-Z0-9-]{1,80}$/.test(entry.id)||ids.has(entry.id)||!validName(entry.name))throw Error('record');
        for(const key of ['createdAt','updatedAt'])if(typeof entry[key]!=='string'||!Number.isFinite(Date.parse(entry[key]))||new Date(entry[key]).toISOString()!==entry[key])throw Error('date');
        parseProject(entry.json);ids.add(entry.id);
      }
      projects=catalog.projects;catalogStatus='ready';return true;
    } catch { projects=[];catalogStatus='unreadable';return false; }
  }
  function validName(value) { return typeof value==='string'&&value===value.trim()&&value.length>0&&value.length<=100&&!/[\u0000-\u001f\u007f]/.test(value); }
  function writeCatalog(next) {
    try {
      const serialized=JSON.stringify({schema:CATALOG_SCHEMA,projects:next});
      if(serialized.length>MAX_CATALOG_LENGTH){projectMessage='The saved project list is too large. Export your work to a file.';return false;}
      globalThis.localStorage.setItem(CATALOG_KEY,serialized);projects=next;return true;
    }
    catch { projectMessage='Saving failed. Previous saved projects are retained. Export your work to a file.';return false; }
  }
  function projectNotice() {
    if(catalogStatus==='unreadable')return 'Saved projects could not be read. The stored list has been retained.';
    if(catalogStatus==='unavailable')return 'Browser storage is unavailable. Use project export for a file copy.';
    return projectMessage||(activeProjectId&&changed?'Changes to this named project have not been saved.':'');
  }
  function saveProject(asNew) {
    const name=projectName.trim();
    if(!validName(name)){projectMessage='Enter a project name of 1–100 characters.';render();return;}
    let json;try{json=core().exportProject(draft);}catch{projectMessage='Correct invalid values before saving. Incomplete drafts can be saved.';render();return;}
    if(!readCatalog()){render();return;}
    const previous=asNew?null:projects.find(item=>item.id===activeProjectId);
    if(!asNew&&(!previous||JSON.stringify(previous)!==activeRevision)){projectMessage='The saved project changed in another tab. Reload it or save a new copy.';render();return;}
    if(projects.some(item=>item.id!==previous?.id&&item.name.toLowerCase()===name.toLowerCase())){projectMessage='That name is already in use. Choose another name or load that project.';render();return;}
    if(asNew&&projects.length>=MAX_PROJECTS){projectMessage='The 50-project limit is reached. Export and delete an older saved project.';render();return;}
    const now=new Date().toISOString();let id=previous?.id;
    if(!id)do{id=`p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,12)}`;}while(projects.some(item=>item.id===id));
    const entry={id,name,createdAt:previous?.createdAt||now,updatedAt:now,json};
    if(writeCatalog(previous?projects.map(item=>item.id===id?entry:item):[...projects,entry])){
      activeProjectId=id;activeRevision=JSON.stringify(entry);selectedProjectId=id;projectName=name;changed=false;replacement=null;deleteId=null;projectMessage='Project saved in this browser.';
    }
    render();
  }
  function replaceDraft(next,options={}) {
    draft=next;selection={kind:'state',id:next.states.find(item=>item.initial)?.id||next.states[0]?.id||''};
    simulation=null;simulationExamples=false;trace=[];replacement=null;pendingConversion=null;deleteId=null;
    activeProjectId=options.entry?.id||null;activeRevision=options.entry?JSON.stringify(options.entry):null;
    projectName=options.name||options.entry?.name||'';projectMessage='';changed=false;status=options.message||'Project opened.';persist();render();
  }
  function requestReplace(action) { if(changed){replacement=action;render();root.querySelector('[data-builder-action="keep-draft"]')?.focus();}else action(); }
  function openProject() {
    const id=selectedProjectId;if(!readCatalog()){render();return;}
    const entry=projects.find(item=>item.id===id);if(!entry){projectMessage='Choose a saved project first.';render();return;}
    const parsed=parseProject(entry.json);
    if(parsed.schema!=='nodus-contract-studio/v2'){pendingConversion={project:parsed,name:entry.name};render();return;}
    requestReplace(()=>{
      if(!readCatalog()){replacement=null;render();return;}
      const fresh=projects.find(item=>item.id===id);if(!fresh){replacement=null;projectMessage='The saved project is no longer available.';render();return;}
      const next=parseProject(fresh.json);
      if(next.schema!=='nodus-contract-studio/v2'){replacement=null;pendingConversion={project:next,name:fresh.name};render();return;}
      replaceDraft(next,{entry:fresh,message:'Saved project loaded.'});
    });
  }
  function convertPending() {
    if(!pendingConversion)return;
    try {
      const next=core().convertV1(pendingConversion.project),name=pendingConversion.name;
      pendingConversion=null;requestReplace(()=>replaceDraft(next,{name:name?`${name} (v2)`:'',message:'A separate v2 copy was created. The original escrow save is retained.'}));
    }catch(error){pendingConversion=null;notify({error});render();}
  }
  function deleteProject() {
    const id=deleteId;deleteId=null;if(!readCatalog()){render();return;}
    if(!projects.some(item=>item.id===id)){render();return;}
    if(writeCatalog(projects.filter(item=>item.id!==id))){
      if(activeProjectId===id){activeProjectId=null;activeRevision=null;changed=true;}
      selectedProjectId='';projectMessage='Saved project deleted. The open draft is retained.';
    }
    render();
  }
  function savedPanel() {
    readCatalog();const selected=projects.find(item=>item.id===selectedProjectId),deleting=projects.find(item=>item.id===deleteId);
    const choices=[['',t(projects.length?'Choose a project…':'No saved projects yet.')],...projects.slice().sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(item=>[item.id,`${item.name} · ${new Date(item.updatedAt).toLocaleString(currentLanguage()==='fi'?'fi-FI':'en-GB')}${JSON.parse(item.json).schema==='nodus-contract-studio/v1'?' · v1':''}`])];
    return `<details class="wb-saves wb-panel"><summary>${esc(t('Saved projects'))} <span>${projects.length} / ${MAX_PROJECTS}</span></summary><p>${esc(t('Named copies stay in this browser. Export a file for backup or another device.'))}</p>${activeProjectId?`<p>${esc(t('Open saved project: {name}',{name:JSON.parse(activeRevision).name}))}</p>`:''}<div class="wb-save-row">${field('builder-project-name','Project name',projectName,{max:100})}<div class="wb-inline">${button('Save as new project','save-new',{className:'primary',disabled:catalogStatus!=='ready'})}${button('Save changes','save-project',{disabled:!activeProjectId||catalogStatus!=='ready'})}</div></div><div class="wb-save-row">${selectField('builder-saved-project','Saved project',selectedProjectId,choices)}<div class="wb-inline">${button('Load project','load-project',{disabled:!selected})}${button('Delete saved project','delete-project',{className:'danger',disabled:!selected})}</div></div>${deleting?`<div class="wb-confirm"><p>${esc(t('Delete “{name}”? The open draft will be retained.',{name:deleting.name}))}</p><div class="wb-inline">${button('Keep saved project','keep-project')}${button('Confirm deletion','confirm-delete-project',{className:'danger'})}</div></div>`:''}<p id="builder-project-message" role="status" aria-live="polite">${esc(t(projectNotice()))}</p></details>`;
  }
  function palette() {
    return `<aside class="wb-palette wb-panel"><div class="wb-section-heading"><span class="eyebrow">${esc(t('BUILDING BLOCKS'))}</span><h2>${esc(t('Build your own rules'))}</h2></div><div class="wb-palette-group"><h3>${esc(t('STATES'))}</h3>${button('Add state','add-state',{disabled:draft.states.length>=24})}<p>${esc(t('Name the stages. Choose one initial state and any terminal states.'))}</p></div><div class="wb-palette-group"><h3>${esc(t('ACTIONS'))}</h3>${Object.entries(operations).map(([op,label])=>button(label,`add-${op}`,{disabled:draft.transitions.length>=48})).join('')}</div><div class="wb-palette-group"><h3>${esc(t('CONDITIONS'))}</h3>${Object.entries(predicates).map(([type,label])=>button(label,`add-condition-${type}`)).join('')}<p>${esc(t('Conditions are attached to the selected action. Combine them with ALL or ANY.'))}</p></div><div class="wb-palette-group"><h3>${esc(t('ROLES'))}</h3>${button('Add role','add-role',{disabled:draft.roles.length>=8})}<p>${esc(t('Assign a Nodus EVM address to each role.'))}</p></div></aside>`;
  }
  function selectedState(){return selection.kind==='state'?draft.states.find(item=>item.id===selection.id):null;}
  function selectedTransition(){return selection.kind==='transition'?draft.transitions.find(item=>item.id===selection.id):null;}
  function stateLabel(id){return draft.states.find(item=>item.id===id)?.label||t('Choose a state');}
  function roleLabel(id){return id==='anyone'?t('Anyone'):draft.roles.find(item=>item.id===id)?.label||t('Choose a role');}
  function actionMap() { try{return core().describeActions(draft);}catch{return [];} }
  function walletMappings() {
    const sorted=items=>items.slice().sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
    return {states:sorted(draft.states).map((item,index)=>({stageIndex:index,id:item.id,label:item.label,initial:item.initial,terminal:item.terminal})),roles:sorted(draft.roles).map((item,index)=>({constantName:`role_${index}`,id:item.id,label:item.label,address:item.address}))};
  }
  function boardGeometry() {
    const minX=Math.min(18,...draft.states.map(item=>Number.isFinite(item.x)?item.x:18));
    const minY=Math.min(18,...draft.states.map(item=>Number.isFinite(item.y)?item.y:18));
    const offsetX=18-minX,offsetY=18-minY;
    return {offsetX,offsetY,width:Math.max(WIDTH,...draft.states.map(item=>(Number.isFinite(item.x)?item.x:18)+offsetX+NODE_WIDTH+40)),height:Math.max(HEIGHT,...draft.states.map(item=>(Number.isFinite(item.y)?item.y:18)+offsetY+130))};
  }
  function stateHTML(state) {
    const selected=selection.kind==='state'&&selection.id===state.id;
    const geometry=boardGeometry();
    return `<div class="wb-state${selected?' selected':''}${simulation?.stage===state.id?' current':''}" data-builder-node="${esc(state.id)}" style="left:${state.x+geometry.offsetX}px;top:${state.y+geometry.offsetY}px"><button type="button" class="wb-state-title" data-builder-state="${esc(state.id)}" aria-pressed="${selected}">${esc(state.label||t('Unnamed state'))}</button><div class="wb-state-meta"><span>${esc(state.id)}</span><span>${esc(t(state.initial?'Initial':state.terminal?'Terminal':'State'))}</span></div></div>`;
  }
  function edgeHTML() {
    const geometry=boardGeometry();
    return draft.transitions.map((action,index)=>{
      const from=draft.states.find(item=>item.id===action.from),to=draft.states.find(item=>item.id===action.to);if(!from||!to)return '';
      const x1=from.x+geometry.offsetX+NODE_WIDTH,y1=from.y+geometry.offsetY+43,x2=to.x+geometry.offsetX,y2=to.y+geometry.offsetY+43;
      const loop=from.id===to.id,curve=Math.max(55,Math.abs(x2-x1)*.5),offset=(index%3-1)*8;
      const path=loop?`M${x1} ${y1}C${x1+85} ${y1-120},${x1-190} ${y1-120},${x1-NODE_WIDTH/2} ${y1-43}`:`M${x1} ${y1+offset}C${x1+curve} ${y1+offset},${x2-curve} ${y2+offset},${x2} ${y2+offset}`;
      return `<path d="${path}" class="${selection.kind==='transition'&&selection.id===action.id?'selected':''}" marker-end="url(#builder-arrow)"/>`;
    }).join('');
  }
  function canvasPanel() {
    const geometry=boardGeometry();
    return `<section class="wb-main"><div class="wb-panel"><div class="wb-canvas-controls"><div><span class="eyebrow">${esc(t('EXECUTABLE STATE GRAPH'))}</span><h2>${esc(t('States and paths'))}</h2></div>${selectField('builder-zoom','Zoom',zoomMode,[['fit',t('Fit')],['0.5','50%'],['0.75','75%'],['1','100%']])}</div><div class="wb-canvas-scroll"><div class="wb-canvas-space"><div class="wb-canvas" id="builder-canvas" role="group" aria-label="${esc(t('Workflow state graph'))}"><svg class="wb-edges" width="${geometry.width}" height="${geometry.height}" aria-hidden="true"><defs><marker id="builder-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0L8 4L0 8Z"/></marker></defs><g id="builder-edge-paths">${edgeHTML()}</g></svg>${draft.states.map(stateHTML).join('')}</div></div></div><p class="wb-canvas-help">${esc(t('Drag states to arrange the graph. Arrow keys move a selected state; Shift moves 40 px. Actions below define the paths.'))}</p></div><div class="wb-section-heading"><span class="eyebrow">${esc(t('ACTION CARDS'))}</span><h2>${esc(t('What moves the contract forward'))}</h2></div><div class="wb-action-list">${draft.transitions.length?draft.transitions.map(actionCard).join(''):`<div class="wb-card"><p>${esc(t('Add an action from the palette, then choose its source and destination states.'))}</p></div>`}</div></section>`;
  }
  function actionCard(action) {
    const fn=actionMap().find(item=>item.id===action.id)?.functionName||'—';
    const guards=action.guard.conditions.length
      ? `<span class="wb-badge">${esc(t(action.guard.mode==='all'?'ALL':'ANY'))}</span>${action.guard.conditions.map(condition=>`<span class="wb-badge">${esc(conditionLabel(condition))}</span>`).join('')}`
      : `<span class="wb-badge">${esc(t('No extra conditions'))}</span>`;
    return `<button type="button" class="wb-action-card${selection.kind==='transition'&&selection.id===action.id?' selected':''}" data-builder-transition="${esc(action.id)}" aria-pressed="${selection.kind==='transition'&&selection.id===action.id}"><span class="wb-action-card-heading"><strong>${esc(action.label||t('Unnamed action'))}</strong><code>${esc(fn)}</code></span><span class="wb-action-route">${esc(stateLabel(action.from))} → ${esc(stateLabel(action.to))}</span><span class="wb-action-effect">${esc(t(operations[action.operation]||'Unknown operation'))} · ${esc(roleLabel(action.caller))}${action.amountNodus?` · ${esc(action.amountNodus)} NODUS`:''}${action.operation==='transfer'?` → ${esc(roleLabel(action.recipient))}`:''}</span><span class="wb-badges">${guards}</span></button>`;
  }
  function conditionLabel(condition) {
    const value=condition.type==='approvedBy'?roleLabel(condition.value):condition.value;
    return `${t(predicates[condition.type]||'Unknown condition')}${value?`: ${value}`:''}`;
  }
  function stateInspector(state) {
    return `<div class="wb-inspector-heading"><span class="eyebrow">${esc(t('STATE'))}</span><h2>${esc(state.label||t('Unnamed state'))}</h2><code>${esc(state.id)}</code></div>${field('builder-state-label','State name',state.label,{max:80})}<div class="wb-checks">${field('builder-state-initial','Initial state',state.initial,{checkbox:true})}${field('builder-state-terminal','Terminal state',state.terminal,{checkbox:true})}</div><p>${esc(t('A terminal state cannot have outgoing actions. Changing state flags does not remove actions.'))}</p><div class="wb-inline">${button('←','move-left',{title:'Move left'})}${button('↑','move-up',{title:'Move up'})}${button('↓','move-down',{title:'Move down'})}${button('→','move-right',{title:'Move right'})}</div>${button('Remove state and its paths','remove-state',{className:'danger'})}`;
  }
  function transitionInspector(action) {
    const roleOptions=[['',t('Choose a role')],...draft.roles.map(role=>[role.id,role.label])];
    return `<div class="wb-inspector-heading"><span class="eyebrow">${esc(t('ACTION'))}</span><h2>${esc(action.label||t('Unnamed action'))}</h2><code>${esc(actionMap().find(item=>item.id===action.id)?.functionName||action.id)}</code></div>${field('builder-action-label','Action name',action.label,{max:80})}<div class="wb-form-grid">${selectField('builder-action-from','From state',action.from,[['',t('Choose a state')],...draft.states.map(item=>[item.id,item.label])])}${selectField('builder-action-to','To state',action.to,[['',t('Choose a state')],...draft.states.map(item=>[item.id,item.label])])}</div>${selectField('builder-action-caller','Allowed caller',action.caller,[...roleOptions,['anyone',t('Anyone')]])}${selectField('builder-action-operation','Operation',action.operation,Object.entries(operations).map(([id,label])=>[id,t(label)]))}${['deposit','transfer'].includes(action.operation)?field('builder-action-amountNodus','Exact amount · NODUS',action.amountNodus,{help:'Up to 8 decimal places. Deposits must match this amount exactly.'}):''}${action.operation==='transfer'?selectField('builder-action-recipient','Recipient role',action.recipient,roleOptions):''}${action.operation==='approve'?`<p>${esc(t('Each role can approve once for the entire workflow. Approvals are not reset when the state changes.'))}</p>`:''}${action.operation==='recordHash'?`<p>${esc(t('The caller supplies a nonzero bytes32 hash. Recording a hash does not verify a document or an external event.'))}</p>`:''}<div class="wb-guard-heading"><h3>${esc(t('CONDITIONS'))}</h3>${selectField('builder-action-guardMode','Combine conditions',action.guard.mode,[['all',t('ALL conditions')],['any',t('ANY condition')]])}</div><p>${esc(t('Caller permissions, exact payment values and sufficient funds are always enforced. ANY does not bypass them.'))}</p><div class="wb-conditions">${action.guard.conditions.map((condition,index)=>conditionCard(condition,index)).join('')||`<p>${esc(t('No extra conditions. Add condition cards from the palette.'))}</p>`}</div>${button('Remove action','remove-transition',{className:'danger'})}`;
  }
  function conditionCard(condition,index) {
    const attr=`data-builder-condition="${index}"`;
    let value='';
    if(condition.type==='approvedBy')value=selectField(`builder-condition-value-${index}`,'Role',condition.value,[['',t('Choose a role')],...draft.roles.map(role=>[role.id,role.label])],attr);
    else if(!['beforeDeadline','afterDeadline'].includes(condition.type))value=field(`builder-condition-value-${index}`,condition.type==='hashEquals'?'Expected document hash':condition.type==='approvalCountAtLeast'?'Required approvals':'Minimum balance · NODUS',condition.value,{attribute:attr});
    return `<div class="wb-guard-card">${selectField(`builder-condition-type-${index}`,'Condition',condition.type,Object.entries(predicates).map(([id,label])=>[id,t(label)]),attr)}${value}${condition.type==='balanceAtLeast'?`<p>${esc(t('Balance conditions check credited funds before this action. Forced extra EVM balances are excluded.'))}</p>`:''}${button('Remove condition',`remove-condition-${index}`,{className:'danger'})}</div>`;
  }
  function roleInspector(role) {
    return `<div class="wb-inspector-heading"><span class="eyebrow">${esc(t('ROLE'))}</span><h2>${esc(role.label||t('Unnamed role'))}</h2><code>${esc(role.id)}</code></div>${field('builder-role-label','Role name',role.label,{max:80})}${field('builder-role-address','Nodus EVM address',role.address,{help:'0x followed by 64 hexadecimal characters. Each role must use a different nonzero address.'})}${button('Remove role','remove-role',{className:'danger'})}<p>${esc(t('Removing a role keeps its references visible as issues until you assign another role.'))}</p>`;
  }
  function inspector() {
    const state=selectedState(),action=selectedTransition(),role=selection.kind==='role'?draft.roles.find(item=>item.id===selection.id):null;
    return `<aside class="wb-inspector wb-panel"><div id="builder-inspector-content">${state?stateInspector(state):action?transitionInspector(action):role?roleInspector(role):`<div class="wb-inspector-heading"><h2>${esc(t('Select a block'))}</h2><p>${esc(t('Select a state, action card or role to edit its executable rules.'))}</p></div>`}</div><div class="wb-roles"><h3>${esc(t('ROLES'))}</h3>${draft.roles.map(item=>`<button type="button" class="wb-role-card${selection.kind==='role'&&selection.id===item.id?' selected':''}" data-builder-role="${esc(item.id)}"><strong>${esc(item.label||t('Unnamed role'))}</strong><span>${esc(item.address?`${item.address.slice(0,10)}…${item.address.slice(-6)}`:t('Address missing'))}</span></button>`).join('')}${field('builder-deadline','Shared deadline · UTC',draft.config.deadline,{help:'The chain checks the deadline when a transaction is executed. No timer sends a transaction.'})}</div></aside>`;
  }
  function validationHTML() {
    const result=core().validate(draft);
    return `<div class="wb-validation${result.valid?' valid':''}" id="builder-validation"><strong>${esc(t(result.valid?'Ready for source generation':'Complete the workflow'))}</strong>${result.valid?`<p>${esc(t('The graph is structurally valid. Review the payment rules and test every path before publishing.'))}</p>`:`<ul>${result.errors.slice(0,30).map(error=>`<li>${esc(errorText(error))}</li>`).join('')}</ul>${result.errors.length>30?`<p>${esc(t('Additional issues: {count}',{count:result.errors.length-30}))}</p>`:''}`}</div>`;
  }
  function summaryPanel() {
    const actions=actionMap();
    return `<div class="wb-notice"><strong>${esc(t('Every action card defines a callable contract function.'))}</strong><p>${esc(t('The source state, caller, operation, destination and conditions below are the same rules used by source generation and simulation.'))}</p></div><div class="wb-table" tabindex="0"><table><thead><tr>${['Action','Function','Path','Caller','Effect'].map(label=>`<th>${esc(t(label))}</th>`).join('')}</tr></thead><tbody>${draft.transitions.map(action=>`<tr><td>${esc(action.label)}</td><td><code>${esc(actions.find(item=>item.id===action.id)?.functionName||'—')}</code></td><td>${esc(stateLabel(action.from))} → ${esc(stateLabel(action.to))}</td><td>${esc(roleLabel(action.caller))}</td><td>${esc(t(operations[action.operation]))}${action.amountNodus?` · ${esc(action.amountNodus)} NODUS`:''}<br>${esc(action.guard.conditions.map(conditionLabel).join(action.guard.mode==='any'?' / ':' + '))}</td></tr>`).join('')}</tbody></table></div><p>${esc(t('Transfers may use smaller amounts than deposits for staged payments. Design a reachable payout or refund path for every funded state.'))}</p><p>${esc(t('Approvals are one round for the whole workflow. A document hash is a recorded claim, not independent verification.'))}</p>`;
  }
  function sourcePanel() {
    const valid=core().validate(draft).valid;let source='';
    if(valid){try{source=core().generate(draft);}catch(error){return `<p>${esc(errorText(error))}</p>`;}}
    return `<div class="wb-inline">${button('Download .sol','download-source',{className:'primary',disabled:!valid})}${button('Copy source','copy-source',{disabled:!valid})}${button('Download manifest','download-manifest',{disabled:!valid})}</div>${valid?`${walletMappingPanel()}<pre class="wb-source" tabindex="0" aria-label="${esc(t('Solidity source'))}"><code>${esc(source)}</code></pre>`:`<p>${esc(t('Correct the listed issues to generate source. Incomplete drafts can still be saved.'))}</p>`}<p>${esc(t('The browser exports Solidity source only. Compile with the Nodus address256 compiler; ABI and bytecode are produced by that compiler.'))}</p><a href="https://github.com/Trader1976/nodus-observatory/blob/feature/contract-studio/docs/contract-studio-builder${currentLanguage()==='fi'?'_fin':''}.md" target="_blank" rel="noopener noreferrer">${esc(t('Compiler and wallet instructions'))} ↗</a>`;
  }
  function walletMappingPanel() {
    const mappings=walletMappings();
    return `<details class="wb-source-mappings"><summary>${esc(t('Wallet value mapping'))}</summary><p>${esc(t('These mappings belong to this source version. Adding or removing IDs can renumber generated functions and states. Keep the manifest with the compiled contract.'))}</p><div class="wb-table" tabindex="0"><table><thead><tr><th>${esc(t('Stage value'))}</th><th>${esc(t('State name'))}</th><th>ID</th></tr></thead><tbody>${mappings.states.map(item=>`<tr><td><code>${item.stageIndex}</code></td><td>${esc(item.label)}</td><td><code>${esc(item.id)}</code></td></tr>`).join('')}</tbody></table></div><div class="wb-table" tabindex="0"><table><thead><tr><th>${esc(t('Role constant'))}</th><th>${esc(t('Role name'))}</th><th>${esc(t('Nodus EVM address'))}</th></tr></thead><tbody>${mappings.roles.map(item=>`<tr><td><code>${esc(item.constantName)}</code></td><td>${esc(item.label)}</td><td><code>${esc(item.address)}</code></td></tr>`).join('')}</tbody></table></div></details>`;
  }
  function formatWei(value) {
    try { const n=BigInt(value),fraction=(n%1000000000000000000n).toString().padStart(18,'0').replace(/0+$/,'');return `${n/1000000000000000000n}${fraction?'.'+fraction:''}`; }catch{return '—';}
  }
  function simulationPanel() {
    const valid=core().validate(draft).valid;
    return `<div class="wb-inline">${button(simulation?'Restart simulation':'Start simulation','start-simulation',{className:'primary',disabled:!valid})}${button('Use simulation identities','sim-example-identities')}</div><p>${esc(t('Local model only. It does not execute compiled bytecode, consume gas or contact a wallet.'))}</p>${simulationExamples?`<div class="wb-notice"><strong>${esc(t('Example identities are used only in this simulation. The real draft is unchanged.'))}</strong></div>`:''}${simulation?`<div class="wb-sim-grid"><div><div class="wb-form-grid">${selectField('builder-sim-actor','Act as',simActor,[...simulation.project.roles.map(role=>[role.id,role.label]),['outsider',t('Outsider')]])}${field('builder-sim-value','Transaction value · NODUS',simValue,{help:'Leave empty to use the action’s exact deposit amount; other actions use zero.'})}</div>${field('builder-sim-hash','Supplied document hash',simHash,{help:'Only Record document hash accepts this input: 0x plus 64 hexadecimal characters.'})}${field('builder-sim-fail','Simulate a failed recipient transfer',failTransfer,{checkbox:true})}<div class="wb-sim-actions">${simulation.project.transitions.map(action=>button(action.label,`sim-action-${action.id}`,{raw:true})).join('')}</div><div class="wb-inline">${button('Advance 1 hour','sim-hour')}${button('Go to deadline','sim-deadline',{disabled:simulation.nowSeconds>=Date.parse(simulation.project.config.deadline)/1000})}</div></div><div class="wb-sim-state"><span class="eyebrow">${esc(t('SIMULATED STATE'))}</span><h2>${esc(simulation.project.states.find(state=>state.id===simulation.stage)?.label||simulation.stage)}</h2><dl><dt>${esc(t('Time'))}</dt><dd>${esc(new Date(simulation.nowSeconds*1000).toISOString())}</dd><dt>${esc(t('Contract balance'))}</dt><dd>${esc(formatWei(simulation.balanceWei))} NODUS</dd><dt>${esc(t('Total deposited'))}</dt><dd>${esc(formatWei(simulation.totalDepositedWei))} NODUS</dd><dt>${esc(t('Approvals'))}</dt><dd>${esc(simulation.approvals.map(id=>roleLabel(id)).join(', ')||'—')}</dd><dt>${esc(t('Recorded hash'))}</dt><dd>${esc(simulation.evidenceHash||'—')}</dd>${Object.entries(simulation.payouts).map(([id,value])=>`<dt>${esc(t('Paid to {role}',{role:roleLabel(id)}))}</dt><dd>${esc(formatWei(value))} NODUS</dd>`).join('')}</dl></div></div><ol class="wb-trace">${trace.slice().reverse().map(item=>`<li class="${item.ok?'accepted':'rejected'}"><strong>${esc(t(item.ok?'Accepted':'Rejected'))}</strong><span>${esc(item.label)} · ${esc(item.actor==='outsider'?t('Outsider'):roleLabel(item.actor))}<br>${esc(item.ok?stateLabel(item.stage):errorText(item.error))}</span></li>`).join('')}</ol>`:`<p>${esc(t('Fill role addresses or use simulation identities to test the workflow.'))}</p>`}`;
  }
  function workbenchPanel() { return activeTab==='source'?sourcePanel():activeTab==='simulation'?simulationPanel():summaryPanel(); }
  function storageText() { return t(storageStatus==='saved'?'Working draft autosaved in this browser':storageStatus==='invalid'?'Invalid values: the previous working autosave is retained':storageStatus==='unreadable'?'Stored working draft unreadable: this session uses a new draft':'Working draft is session-only: browser storage unavailable'); }
  function render() {
    if(!root||globalThis.location?.hash&&globalThis.location.hash!==route)return;
    if(!core()||!draft){root.innerHTML=`<section class="studio wb-panel"><h1>${esc(t('Visual contract editor'))}</h1><p>${esc(t('Editor assets are unavailable. Reload after all files have been installed.'))}</p></section>`;return;}
    const scroll=root.querySelector('.wb-canvas-scroll'),position={left:scroll?.scrollLeft||0,top:scroll?.scrollTop||0};
    const savesOpen=root.querySelector('.wb-saves')?.open===true;
    root.innerHTML=`<div class="studio workflow-builder" id="workflow-builder"><nav class="wb-subnav"><a href="#contracts">← ${esc(t('Document registry'))}</a><a href="#contracts-escrow">${esc(t('Original escrow example'))} ↗</a></nav><div class="wb-heading"><div><span class="eyebrow">${esc(t('CONTRACT STUDIO / VISUAL EDITOR'))}</span><h1>${esc(t('Build the rules behind the states.'))}</h1><p>${esc(t('Create states, callable actions, roles and conditions. Inspect the generated source and try every path.'))}</p></div><span class="wb-version">v2</span></div><div class="wb-notice"><strong>${esc(t('Local authoring and simulation'))}</strong><p>${esc(t('This editor does not sign, deploy or send transactions. External oracles, arbitrary contract calls and automatic timers are not supported.'))}</p></div>${replacement?`<div class="wb-confirm" role="alert"><h3>${esc(t('Replace the open draft?'))}</h3><p>${esc(t('Save or export your current changes first. Named saved copies are retained.'))}</p><div class="wb-inline">${button('Keep draft','keep-draft')}${button('Replace draft','replace-draft',{className:'danger'})}</div></div>`:''}${pendingConversion?`<div class="wb-confirm" role="alert"><h3>${esc(t('Convert the original escrow to editable v2?'))}</h3><p>${esc(t('This creates a separate editable copy. The original project file and named v1 save are retained. Review the converted rules before publishing.'))}</p><div class="wb-inline">${button('Create editable copy','convert-v1',{className:'primary'})}${button('Cancel conversion','cancel-conversion')}</div></div>`:''}<div class="wb-toolbar"><div class="wb-inline"><span>${esc(t('Start from'))}</span>${button('Escrow','template-escrow')}${button('Approval workflow','template-approval')}${button('Blank workflow','template-blank')}</div><div class="wb-inline">${button('Export project','export-project')}${button('Import project','import-project')}<input id="builder-import" type="file" accept="application/json,.json" hidden></div></div>${savedPanel()}<div class="wb-autosave" id="builder-autosave">${esc(storageText())}</div><div class="wb-layout">${palette()}${canvasPanel()}${inspector()}</div>${validationHTML()}<section class="wb-workbench wb-panel"><div class="wb-tabs" role="tablist" aria-label="${esc(t('Inspect the workflow'))}">${[['summary','Summary'],['source','Solidity source'],['simulation','Simulation']].map(([tab,label])=>`<button type="button" id="builder-tab-${tab}" role="tab" data-builder-tab="${tab}" aria-selected="${activeTab===tab}" aria-controls="builder-workbench" tabindex="${activeTab===tab?0:-1}">${esc(t(label))}</button>`).join('')}</div><div id="builder-workbench" role="tabpanel" aria-labelledby="builder-tab-${activeTab}">${workbenchPanel()}</div></section><div id="builder-message" class="wb-status" role="status" aria-live="polite">${esc(statusText())}</div></div>`;
    language=currentLanguage();bind();applyZoom();const restored=root.querySelector('.wb-canvas-scroll');if(restored){restored.scrollLeft=position.left;restored.scrollTop=position.top;}const saves=root.querySelector('.wb-saves');if(saves)saves.open=savesOpen||!!projectMessage||!!deleteId;
  }
  function refreshDerived() {
    if(!root||!draft)return;
    const validation=root.querySelector('#builder-validation');if(validation)validation.innerHTML=validationHTML().replace(/^<div[^>]*>|<\/div>$/g,'');
    const check=core().validate(draft);validation?.classList.toggle('valid',check.valid);
    const panel=root.querySelector('#builder-workbench');if(panel)panel.innerHTML=workbenchPanel();
    const autosave=root.querySelector('#builder-autosave');if(autosave)autosave.textContent=storageText();
    const message=root.querySelector('#builder-project-message');if(message)message.textContent=t(projectNotice());
    const statusElement=root.querySelector('#builder-message');if(statusElement)statusElement.textContent=statusText();
    bind();
  }
  function bounded(value,min,max){return Math.round(Math.max(min,Math.min(max,Number.isFinite(value)?value:min)));}
  function applyZoom(){const scroll=root?.querySelector('.wb-canvas-scroll'),space=root?.querySelector('.wb-canvas-space'),canvas=root?.querySelector('#builder-canvas');if(!scroll||!space||!canvas)return;const geometry=boardGeometry();zoomScale=zoomMode==='fit'?Math.max(.3,Math.min(1,(scroll.clientWidth||WIDTH)/geometry.width)):Number(zoomMode);space.style.width=`${geometry.width*zoomScale}px`;space.style.height=`${geometry.height*zoomScale}px`;canvas.style.width=`${geometry.width}px`;canvas.style.height=`${geometry.height}px`;canvas.style.transform=`scale(${zoomScale})`;}
  function moveState(dx,dy){const state=selectedState();if(!state)return;state.x=bounded(state.x+dx,-10000,10000);state.y=bounded(state.y+dy,-10000,10000);edit(false);render();}
  function addState(){if(draft.states.length>=24)return;const id=newId('state',draft.states);draft.states.push({id,label:t('New state'),initial:draft.states.length===0,terminal:false,x:60+(draft.states.length%4)*260,y:80+Math.floor(draft.states.length/4)*145});selection={kind:'state',id};edit();render();}
  function addTransition(operation){
    if(!operations[operation]||draft.transitions.length>=48)return;
    const id=newId('action',draft.transitions),state=selectedState()||draft.states.find(item=>item.initial)||draft.states[0];
    const target=['approve','recordHash'].includes(operation)?state:draft.states.find(item=>item.id!==state?.id);
    const money=['deposit','transfer'].includes(operation);
    draft.transitions.push({id,label:t(operations[operation]),from:state?.id||'',to:target?.id||'',caller:draft.roles[0]?.id||'',operation,recipient:operation==='transfer'?(draft.roles[1]?.id||draft.roles[0]?.id||''):'',amountNodus:money?'100':'',guard:{mode:'all',conditions:[]}});
    selection={kind:'transition',id};edit();render();
  }
  function defaultConditionValue(type){return type==='balanceAtLeast'?'100':type==='approvalCountAtLeast'?String(Math.min(2,Math.max(1,draft.roles.length))):type==='approvedBy'?(draft.roles[0]?.id||''):type==='hashEquals'?`0x${'1'.repeat(64)}`:'';}
  function addCondition(type){const action=selectedTransition();if(!action){notify('Select an action card before adding a condition.');return;}if(action.guard.conditions.length>=8){notify('An action supports up to eight conditions.');return;}if(!predicates[type])return;action.guard.conditions.push({type,value:defaultConditionValue(type)});edit();render();}
  function addRole(){if(draft.roles.length>=8)return;const id=newId('role',draft.roles);draft.roles.push({id,label:t('New role'),address:''});selection={kind:'role',id};edit();render();}
  function download(text,name,type){const blob=new Blob([text],{type});const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=name;document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function startSimulation(examples){
    const project=clone(draft);if(examples)project.roles.forEach((role,index)=>{role.address=`0x${(index+1).toString(16).padStart(64,'0')}`;});
    try{simulation=core().createSimulation(project);simulationExamples=examples;trace=[];simActor=project.roles[0]?.id||'outsider';simValue='';simHash='';failTransfer=false;status='Simulation started.';render();}catch(error){notify({error});}
  }
  function simulate(actionId){
    if(!simulation)return;const action=simulation.project.transitions.find(item=>item.id===actionId);if(!action)return;
    const command={action:actionId,actor:simActor};
    if(simValue!==''){try{command.valueWei=globalThis.NodusStudioCore.parseNodusAmount(simValue).wei;}catch{if(simValue==='0')command.valueWei='0';else{notify('Enter a valid transaction value with up to 8 decimal places.');return;}}}
    if(action.operation==='recordHash')command.evidenceHash=simHash;
    if(action.operation==='transfer')command.paymentSucceeds=!failTransfer;
    const result=core().transition(simulation,command);trace.push({ok:result.ok,label:action.label,actor:simActor,stage:result.state.stage,error:result.error});trace=trace.slice(-200);simulation=result.state;render();
  }
  function advanceTime(to){if(!simulation)return;const result=core().transition(simulation,{action:'advanceTime',nowSeconds:to});trace.push({ok:result.ok,label:t('Time'),actor:simActor,stage:result.state.stage,error:result.error});trace=trace.slice(-200);simulation=result.state;render();}
  async function act(action){
    if(action==='save-new'){saveProject(true);return;}if(action==='save-project'){saveProject(false);return;}if(action==='load-project'){openProject();return;}
    if(action==='delete-project'){deleteId=selectedProjectId;render();return;}if(action==='keep-project'){deleteId=null;render();return;}if(action==='confirm-delete-project'){deleteProject();return;}
    if(action==='convert-v1'){convertPending();return;}if(action==='cancel-conversion'){pendingConversion=null;render();return;}
    if(action==='keep-draft'){replacement=null;render();return;}if(action==='replace-draft'){const next=replacement;replacement=null;next?.();return;}
    if(action.startsWith('template-')){const template=action.slice(9);if(!['escrow','approval','blank'].includes(template))return;requestReplace(()=>replaceDraft(templateDraft(template),{message:'Template opened.'}));return;}
    if(action==='add-state'){addState();return;}if(action==='add-role'){addRole();return;}if(action.startsWith('add-condition-')){addCondition(action.slice(14));return;}if(action.startsWith('add-')){addTransition(action.slice(4));return;}
    if(action==='remove-state'){const state=selectedState();if(!state)return;draft.states=draft.states.filter(item=>item.id!==state.id);draft.transitions=draft.transitions.filter(item=>item.from!==state.id&&item.to!==state.id);selection={kind:'state',id:draft.states[0]?.id||''};edit();render();return;}
    if(action==='remove-transition'){const item=selectedTransition();if(!item)return;draft.transitions=draft.transitions.filter(transition=>transition.id!==item.id);selection={kind:'state',id:draft.states[0]?.id||''};edit();render();return;}
    if(action==='remove-role'){if(selection.kind!=='role')return;draft.roles=draft.roles.filter(item=>item.id!==selection.id);selection={kind:'state',id:draft.states[0]?.id||''};edit();render();return;}
    if(action.startsWith('remove-condition-')){const item=selectedTransition(),index=Number(action.slice(17));if(item&&Number.isInteger(index)&&index>=0&&index<item.guard.conditions.length){item.guard.conditions.splice(index,1);edit();render();}return;}
    if(action.startsWith('move-')){const move={left:[-20,0],right:[20,0],up:[0,-20],down:[0,20]}[action.slice(5)];if(move)moveState(...move);return;}
    if(action==='export-project'){try{download(core().exportProject(draft),'nodus-workflow-project.json','application/json');notify('Project file exported.');}catch(error){notify({error});}return;}
    if(action==='import-project'){root.querySelector('#builder-import')?.click();return;}
    if(action==='start-simulation'){startSimulation(false);return;}if(action==='sim-example-identities'){startSimulation(true);return;}
    if(action==='sim-hour'){if(simulation)advanceTime(simulation.nowSeconds+3600);return;}if(action==='sim-deadline'){if(simulation)advanceTime(Math.max(simulation.nowSeconds,Date.parse(simulation.project.config.deadline)/1000));return;}if(action.startsWith('sim-action-')){simulate(action.slice(11));return;}
    if(!core().validate(draft).valid)return;
    if(action==='download-source'){download(core().generate(draft),'ObservatoryWorkflow.sol','text/plain');notify('Solidity source exported.');return;}
    if(action==='copy-source'){try{await navigator.clipboard.writeText(core().generate(draft));notify('Source copied.');}catch{notify('Copy failed. Download the source file instead.');}return;}
    if(action==='download-manifest'){download(JSON.stringify({schema:'nodus-contract-studio/workflow-export-v2',generatedAt:new Date().toISOString(),projectSchema:draft.schema,sourceFile:'ObservatoryWorkflow.sol',contractName:'ObservatoryWorkflow',compiler:{family:'Nodus solc',version:'0.8.30',addressBytes:32},artifacts:{source:true,abi:false,bytecode:false},actions:actionMap(),states:walletMappings().states,roles:walletMappings().roles,deployment:{performed:false,note:'Compile with Nodus address256 solc, then review and sign in the Nodus wallet.'}},null,2)+'\n','nodus-workflow-manifest.json','application/json');notify('Export manifest downloaded.');}
  }
  function bindValue(id,update,{checkbox=false,rerender=true}={}){
    const element=root.querySelector(`#${id}`);if(!element)return;
    const change=()=>{update(checkbox?element.checked:element.value);edit();};
    if(element.tagName!=='SELECT'&&!checkbox)element.oninput=change;
    element.onchange=()=>{change();if(rerender)render();};
  }
  function bind(){
    root.querySelectorAll('[data-builder-action]').forEach(element=>{element.onclick=()=>act(element.dataset.builderAction);});
    root.querySelectorAll('[data-builder-state]').forEach(element=>{
      element.onclick=()=>{if(drag?.moved)return;selection={kind:'state',id:element.dataset.builderState};render();root.querySelector(`[data-builder-state="${selection.id}"]`)?.focus();};
      element.onkeydown=event=>{selection={kind:'state',id:element.dataset.builderState};const direction={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];if(direction){event.preventDefault();const step=event.shiftKey?40:10;moveState(direction[0]*step,direction[1]*step);root.querySelector(`[data-builder-state="${selection.id}"]`)?.focus();}else if(event.key==='Delete'){event.preventDefault();act('remove-state');}};
      element.onpointerdown=event=>{if(event.button!==0)return;const state=draft.states.find(item=>item.id===element.dataset.builderState);if(!state)return;selection={kind:'state',id:state.id};drag={id:state.id,pointer:event.pointerId,x:event.clientX,y:event.clientY,startX:state.x,startY:state.y,geometry:boardGeometry(),moved:false};element.setPointerCapture?.(event.pointerId);};
      element.onpointermove=event=>{if(!drag||drag.pointer!==event.pointerId)return;const state=draft.states.find(item=>item.id===drag.id);if(!state)return;const dx=(event.clientX-drag.x)/zoomScale,dy=(event.clientY-drag.y)/zoomScale;if(Math.abs(dx)+Math.abs(dy)>3)drag.moved=true;state.x=bounded(drag.startX+dx,-10000,10000);state.y=bounded(drag.startY+dy,-10000,10000);const node=root.querySelector(`[data-builder-node="${state.id}"]`);if(node){node.style.left=`${state.x+drag.geometry.offsetX}px`;node.style.top=`${state.y+drag.geometry.offsetY}px`;}const edges=root.querySelector('#builder-edge-paths');if(edges)edges.innerHTML=edgeHTML();};
      const stop=event=>{if(!drag||drag.pointer!==event.pointerId)return;const moved=drag.moved;drag=null;if(moved){edit(false);render();}};element.onpointerup=stop;element.onpointercancel=stop;
    });
    root.querySelectorAll('[data-builder-transition]').forEach(element=>{element.onclick=()=>{selection={kind:'transition',id:element.dataset.builderTransition};render();};});
    root.querySelectorAll('[data-builder-role]').forEach(element=>{element.onclick=()=>{selection={kind:'role',id:element.dataset.builderRole};render();};});
    root.querySelectorAll('[data-builder-tab]').forEach(element=>{
      element.onclick=()=>{activeTab=element.dataset.builderTab;render();root.querySelector(`#builder-tab-${activeTab}`)?.focus();};
      element.onkeydown=event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const tabs=['summary','source','simulation'],index=tabs.indexOf(activeTab);activeTab=event.key==='Home'?tabs[0]:event.key==='End'?tabs[2]:tabs[(index+(event.key==='ArrowRight'?1:2))%3];render();root.querySelector(`#builder-tab-${activeTab}`)?.focus();};
    });
    const name=root.querySelector('#builder-project-name');if(name)name.oninput=()=>{projectName=name.value;changed=true;projectMessage='';const message=root.querySelector('#builder-project-message');if(message)message.textContent=t(projectNotice());};
    const saved=root.querySelector('#builder-saved-project');if(saved)saved.onchange=()=>{selectedProjectId=saved.value;deleteId=null;projectMessage='';render();root.querySelector('#builder-saved-project')?.focus();};
    const state=selectedState();if(state){bindValue('builder-state-label',value=>{state.label=value;});bindValue('builder-state-initial',value=>{state.initial=value;if(value)draft.states.forEach(item=>{if(item.id!==state.id)item.initial=false;});},{checkbox:true});bindValue('builder-state-terminal',value=>{state.terminal=value;},{checkbox:true});}
    const action=selectedTransition();if(action){
      for(const key of ['label','from','to','caller','amountNodus','recipient'])bindValue(`builder-action-${key}`,value=>{action[key]=value;});
      bindValue('builder-action-operation',value=>{if(!operations[value])return;action.operation=value;if(!['deposit','transfer'].includes(value))action.amountNodus='';else if(!action.amountNodus)action.amountNodus='100';if(value!=='transfer')action.recipient='';else if(!action.recipient)action.recipient=draft.roles[1]?.id||draft.roles[0]?.id||'';});
      bindValue('builder-action-guardMode',value=>{action.guard.mode=value;});
      action.guard.conditions.forEach((condition,index)=>{bindValue(`builder-condition-type-${index}`,value=>{if(!predicates[value])return;condition.type=value;condition.value=defaultConditionValue(value);});bindValue(`builder-condition-value-${index}`,value=>{condition.value=value;});});
    }
    const role=selection.kind==='role'?draft.roles.find(item=>item.id===selection.id):null;if(role){bindValue('builder-role-label',value=>{role.label=value;});bindValue('builder-role-address',value=>{role.address=value;});}
    bindValue('builder-deadline',value=>{draft.config.deadline=value;});
    const zoom=root.querySelector('#builder-zoom');if(zoom)zoom.onchange=()=>{if(['fit','0.5','0.75','1'].includes(zoom.value)){zoomMode=zoom.value;applyZoom();}};
    const simRole=root.querySelector('#builder-sim-actor');if(simRole)simRole.onchange=()=>{simActor=simRole.value;};
    const simAmount=root.querySelector('#builder-sim-value');if(simAmount){simAmount.oninput=()=>{simValue=simAmount.value;};simAmount.onchange=simAmount.oninput;}
    const hash=root.querySelector('#builder-sim-hash');if(hash){hash.oninput=()=>{simHash=hash.value;};hash.onchange=hash.oninput;}
    const fail=root.querySelector('#builder-sim-fail');if(fail)fail.onchange=()=>{failTransfer=fail.checked;};
    const file=root.querySelector('#builder-import');if(file)file.onchange=async()=>{
      const item=file.files?.[0];if(!item)return;
      const token=++importSerial,startedDraft=draft;
      if(item.size>65536){notify('Choose a project JSON file smaller than 64 KiB.');file.value='';return;}
      try{const text=await item.text();if(token!==importSerial||draft!==startedDraft){notify('Another project was opened while the file was being read. Import the file again to use it.');return;}const next=parseProject(text);if(next.schema!=='nodus-contract-studio/v2'){pendingConversion={project:next,name:''};render();}else requestReplace(()=>replaceDraft(next,{message:'Project file imported.'}));}catch{notify('Invalid project file. The open draft is unchanged.');}finally{file.value='';}
    };
  }
  globalThis.NodusWorkflowStudio=Object.freeze({
    mount(target,options={}){if(typeof options.route==='string')route=options.route;const same=root===target&&target?.querySelector?.('#workflow-builder');root=target;if(!draft&&core()){draft=initialDraft();selection={kind:'state',id:draft.states.find(item=>item.initial)?.id||draft.states[0]?.id||''};}if(!same||language!==currentLanguage())render();},
    getDraft:()=>draft?clone(draft):null,
    getState:()=>({selection:clone(selection),activeTab,changed,simulation:simulation?clone(simulation):null,simulationExamples,trace:clone(trace),activeProjectId,projectName,storageStatus,catalogStatus,pendingConversion:!!pendingConversion,zoomMode,zoomScale}),
  });
  globalThis.addEventListener?.('resize',()=>{if(globalThis.location?.hash===route)applyZoom();});
})();
