/* Local-only Contract Studio. No RPC, wallet, signing or backend write paths. */
(() => {
  'use strict';
  const core = () => globalThis.NodusStudioCore;
  const s = (key, params) => globalThis.NodusStudioText?.(key, params) ?? key;
  const errorText = issue => {
    if(issue?.code==='node_missing'){
      const type=String(issue.field||'').split('.').at(-1);
      return s('Missing state: {state}. Add the block or restore the standard flow.',{state:s(types[type]?.label||type)});
    }
    if(issue?.code==='edge_missing'){
      const [from,to]=String(issue.field||'').replace(/^edges\./,'').split('>');
      return s('Missing path: {from} → {to}. Connect the ports or restore the standard flow.',{from:s(types[from]?.label||from),to:s(types[to]?.label||to)});
    }
    return globalThis.NodusStudioText?.error(issue) ?? String(issue?.code || 'invalid_project');
  };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const clone = value => JSON.parse(JSON.stringify(value));
  const storageKey = 'nodus-observatory-contract-draft-v1';
  const projectsKey = 'nodus-observatory-contract-projects-v1';
  const projectsSchema = 'nodus-contract-studio/projects-v1';
  const maxProjects = 50;
  const width = 1050, height = 590, nodeWidth = 170, nodeHeight = 89;
  const types = {
    created: { label:'Created', description:'Await the buyer’s deposit.', color:'#7edbd2' },
    funded: { label:'Funded', description:'Hold exactly the agreed amount.', color:'#9ec9f5' },
    approved: { label:'Approved', description:'The buyer authorises payment.', color:'#e4c58e' },
    paid: { label:'Paid', description:'The seller withdraws payment.', color:'#bae1a3' },
    refunded: { label:'Refunded', description:'The buyer recovers funds after the deadline.', color:'#bdabdf' },
    cancelled: { label:'Cancelled', description:'The buyer closes an unfunded escrow.', color:'#b6c2d2' },
  };
  const actionLabels = { deposit:'Deposit', approve:'Approve delivery', withdraw:'Withdraw', refund:'Refund', cancel:'Cancel escrow', advanceTime:'Time' };
  let root, draft, activeTab = 'summary', selected = null, pendingFrom = null;
  let simulation = null, simulationUsesExamples = false, trace = [], actor = 'buyer', failTransfer = false;
  let status = '', storageStatus = 'saved', replaceAction = null, serial = 0, language = null, mounted = false;
  let drag = null, changed = false, zoomMode = 'fit', zoomScale = 1, activeRoute = '#contracts';
  let projectName = '', activeProjectId = null, activeRevision = null, selectedProjectId = '', deleteProjectId = null;
  let projects = [], projectsStatus = 'ready', projectMessage = '';

  function validProjectName(value) {
    return typeof value === 'string' && value === value.trim() && value.length > 0 && value.length <= 100 && !/[\u0000-\u001f\u007f]/.test(value);
  }
  function readProjects() {
    // Re-read before every operation so another tab's unrelated saves are retained.
    let saved;
    try { saved = globalThis.localStorage.getItem(projectsKey); }
    catch { projectsStatus = 'unavailable'; projects = []; return false; }
    try {
      if (saved === null) { projects = []; projectsStatus = 'ready'; return true; }
      if (saved.length > 4 * 1024 * 1024) throw Error('size');
      const catalog = JSON.parse(saved), ids = new Set();
      if (catalog?.schema !== projectsSchema || !Array.isArray(catalog.projects) || catalog.projects.length > maxProjects) throw Error('schema');
      for (const entry of catalog.projects) {
        if (!entry || typeof entry.id !== 'string' || !/^p-[a-zA-Z0-9-]{1,80}$/.test(entry.id) || ids.has(entry.id) || !validProjectName(entry.name)) throw Error('entry');
        for (const key of ['createdAt', 'updatedAt']) {
          if (typeof entry[key] !== 'string' || !Number.isFinite(Date.parse(entry[key])) || new Date(entry[key]).toISOString() !== entry[key]) throw Error('date');
        }
        core().importProject(entry.json);
        ids.add(entry.id);
      }
      projects = catalog.projects;
      projectsStatus = 'ready';
      return true;
    } catch { projectsStatus = 'unreadable'; projects = []; return false; }
  }
  function writeProjects(next) {
    try {
      const json=JSON.stringify({schema:projectsSchema,projects:next});
      if(json.length>4*1024*1024)throw Error('catalog_size');
      globalThis.localStorage.setItem(projectsKey,json);
      projects = next;
      projectsStatus = 'ready';
      return true;
    } catch { projectMessage = 'Saving failed. Browser storage may be full or blocked. Export the project to a file.'; return false; }
  }
  function saveProject(asNew) {
    const name = projectName.trim();
    if (!validProjectName(name)) { projectMessage = 'Enter a project name of 1–100 characters.'; render(); return; }
    let json;
    try { json = core().exportProject(draft); }
    catch { projectMessage = 'Correct invalid fields or unsupported connections before saving. Incomplete drafts can be saved.'; render(); return; }
    if (!readProjects()) { render(); return; }
    const previous = asNew ? null : projects.find(entry => entry.id === activeProjectId);
    if (!asNew && (!previous || JSON.stringify(previous) !== activeRevision)) {
      projectMessage = 'This saved project changed or was deleted in another tab. Load it again or save a new project.'; render(); return;
    }
    if (projects.some(entry => entry.id !== previous?.id && entry.name.toLowerCase() === name.toLowerCase())) {
      projectMessage = 'That name is already in use. Choose another name or load the saved project.'; render(); return;
    }
    if (asNew && projects.length >= maxProjects) { projectMessage = 'The 50-project limit has been reached. Export and delete an older project first.'; render(); return; }
    const now = new Date().toISOString();
    let id = previous?.id;
    if (!id) {
      do { id = `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,12)}`; } while (projects.some(entry => entry.id === id));
    }
    const entry = {id, name, createdAt:previous?.createdAt || now, updatedAt:now, json};
    const next = previous ? projects.map(item => item.id === id ? entry : item) : [...projects, entry];
    if (writeProjects(next)) {
      activeProjectId = id; activeRevision = JSON.stringify(entry); selectedProjectId = id;
      projectName = name; changed = false; deleteProjectId = null; replaceAction = null;
      projectMessage = 'Project saved in this browser.';
    }
    render();
  }
  function loadProject() {
    const id = selectedProjectId;
    if (!readProjects()) { render(); return; }
    const entry = projects.find(item => item.id === id);
    if (!entry) { projectMessage = 'Select a saved project to load.'; render(); return; }
    if(core().importProject(entry.json).schema!==core().SCHEMA){projectMessage='Open this project in the visual editor. The current escrow draft is retained.';render();return;}
    requestReplace(() => {
      // The confirmation may have stayed open while another tab changed storage.
      if (!readProjects()) { replaceAction = null; render(); return; }
      const current = projects.find(item => item.id === id);
      if (!current) { replaceAction = null; projectMessage = 'Select a saved project to load.'; render(); return; }
      if(core().importProject(current.json).schema!==core().SCHEMA){replaceAction=null;projectMessage='Open this project in the visual editor. The current escrow draft is retained.';render();return;}
      replaceDraft(core().importProject(current.json), 'Saved project loaded.');
      projectName = current.name; activeProjectId = id; activeRevision = JSON.stringify(current);
      selectedProjectId = id; projectMessage = 'Saved project loaded.'; render();
    });
  }
  function deleteProject() {
    const id = deleteProjectId;
    deleteProjectId = null;
    if (!readProjects()) { render(); return; }
    if (!projects.some(entry => entry.id === id)) { render(); return; }
    if (writeProjects(projects.filter(entry => entry.id !== id))) {
      if (activeProjectId === id) { activeProjectId = null; activeRevision = null; changed = true; }
      selectedProjectId = ''; projectMessage = 'Saved project deleted. The open draft is retained.';
    }
    render();
  }
  function projectNotice() {
    if (projectsStatus === 'unreadable') return 'Saved projects could not be read. The stored data has been retained. Export the open draft to a file.';
    if (projectsStatus === 'unavailable') return 'Project storage is unavailable. Export the project to a file.';
    return projectMessage || (activeProjectId && changed ? 'Changes to this named project have not been saved.' : '');
  }
  function refreshProjectNotice() {
    const element = root?.querySelector('#studio-project-message');
    if (element) element.textContent = s(projectNotice());
  }
  function projectsPanel() {
    readProjects();
    const selectedEntry = projects.find(entry => entry.id === selectedProjectId);
    const deleting = projects.find(entry => entry.id === deleteProjectId);
    return `<section class="studio-panel studio-projects" aria-labelledby="studio-projects-heading"><div class="studio-projects-heading"><h2 id="studio-projects-heading">${escape(s('Saved projects'))}</h2><p>${escape(s('Stored in this browser on this device. Export a project file for backup or another computer.'))}</p>${activeProjectId?`<p>${escape(s('Open saved project: {name}',{name:JSON.parse(activeRevision).name}))}</p>`:''}</div>
      <div class="studio-project-controls"><div class="studio-field"><label for="studio-project-name">${escape(s('Project name'))}</label><input id="studio-project-name" type="text" maxlength="100" autocomplete="off" value="${escape(projectName)}"></div><div class="studio-project-buttons">${button('Save as new project','save-new',{className:'primary',disabled:projectsStatus!=='ready'})}${button('Save changes','save-project',{disabled:!activeProjectId || projectsStatus!=='ready'})}</div></div>
      <div class="studio-project-controls"><div class="studio-field"><label for="studio-saved-project">${escape(s('Choose a saved project'))}</label><select id="studio-saved-project"${projectsStatus!=='ready'?' disabled':''}><option value="">${escape(s(projects.length?'Select a project…':'No saved projects yet.'))}</option>${projects.slice().sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(entry=>`<option value="${escape(entry.id)}"${entry.id===selectedProjectId?' selected':''}>${escape(entry.name)} · ${escape(new Date(entry.updatedAt).toLocaleString(currentLanguage()==='fi'?'fi-FI':'en-GB'))}</option>`).join('')}</select></div><div class="studio-project-buttons">${button('Load project','load-project',{disabled:!selectedEntry})}${button('Delete saved project','delete-project',{className:'danger',disabled:!selectedEntry})}</div></div>
      ${deleting?`<div class="studio-project-delete" role="alert"><p>${escape(s('Delete “{name}” from saved projects? The open draft will be retained.',{name:deleting.name}))}</p><div class="studio-project-buttons">${button('Keep saved project','keep-project')}${button('Confirm deletion','confirm-delete-project',{className:'danger'})}</div></div>`:''}
      <p id="studio-project-message" role="status" aria-live="polite">${escape(s(projectNotice()))}</p></section>`;
  }

  function initialDraft() {
    if (!core()) return null;
    let value = core().defaultDraft();
    try {
      const saved = globalThis.localStorage.getItem(storageKey);
      if (saved) {
        try { const loaded=core().importProject(saved);if(loaded.schema!==core().SCHEMA)throw Error('schema');value=loaded;changed = true; }
        catch { storageStatus='unreadable';status = 'A saved draft could not be read. Start a new draft or import a project.'; }
      } else globalThis.localStorage.setItem(storageKey,core().exportProject(value));
    } catch { storageStatus = 'unavailable'; }
    return value;
  }
  function persist() {
    try {
      const json = core().exportProject(draft);
      globalThis.localStorage.setItem(storageKey, json);
      storageStatus = 'saved';
    } catch (error) {
      storageStatus = error?.code === 'invalid_project' ? 'invalid' : 'unavailable';
    }
  }
  function validation() { return core().validate(draft); }
  function semanticEdit() {
    simulation = null; trace = []; simulationUsesExamples = false;
    changed = true; status = ''; projectMessage = ''; persist(); refreshProjectNotice();
  }
  function layoutEdit() { changed = true; projectMessage = ''; persist(); refreshProjectNotice(); }
  function button(label, action, options = {}) {
    return `<button type="button" class="studio-button ${options.className || ''}" data-studio-action="${escape(action)}"${options.disabled?' disabled':''}${options.title?` title="${escape(options.title)}"`:''}>${escape(s(label))}</button>`;
  }
  function currentLanguage() { return globalThis.NodusI18n?.language?.() || 'fi'; }
  function nodeLabel(id) { return s(types[draft.nodes.find(item=>item.id===id)?.type]?.label || id); }
  function pendingMessage() {
    return pendingFrom ? s('Connecting from {state}. Select a target input.', { state:nodeLabel(pendingFrom) }) : s('Select an output, then an input.');
  }
  function render() {
    if (!root) return;
    if (globalThis.location?.hash && globalThis.location.hash !== activeRoute) return;
    const previousCanvas=root.querySelector?.('.studio-canvas-scroll');
    const scrollPosition={left:previousCanvas?.scrollLeft||0,top:previousCanvas?.scrollTop||0};
    const connectionsOpen=root.querySelector?.('.studio-connections')?.open===true;
    if (!core() || !draft) {
      root.innerHTML = `<section class="studio studio-panel studio-unavailable"><h1>${escape(s('CONTRACT STUDIO / EXPERIMENTAL'))}</h1><p>${escape(s('Core unavailable. Reload the page after installing all Contract Studio assets.'))}</p></section>`;
      return;
    }
    const check = validation();
    root.innerHTML = `<div class="studio" id="contract-studio">
      <div class="studio-head"><div><a class="studio-example-back" href="#contracts">← ${escape(s('Back to document registry'))}</a><a class="studio-example-back" href="#contracts-editor">${escape(s('Visual editor'))} ↗</a><span class="eyebrow">${escape(s('CONTRACT STUDIO / EXPERIMENTAL'))}</span><h1>${escape(s('Draw the rules. Question every path.'))}</h1><p>${escape(s('A visual escrow workbench for Nodus. Build locally, inspect the source and test the unexpected.'))}</p></div><div class="studio-header-mark" aria-hidden="true"><svg viewBox="0 0 40 40"><rect x="3" y="3" width="12" height="10" rx="2"/><rect x="25" y="27" width="12" height="10" rx="2"/><rect x="3" y="27" width="12" height="10" rx="2"/><path d="M9 13v14m0-8h22v8m-3-3 3 3 3-3"/></svg></div></div>
      <div class="studio-notice"><span aria-hidden="true">⌁</span><div><strong>${escape(s('No wallet connection. No chain transactions.'))}</strong><p>${escape(s('This prototype produces Solidity source for the Nodus compiler. It does not compile, deploy or sign contracts. Keep keys and recovery phrases in your wallet.'))}</p></div></div>
      ${replaceAction?`<div class="studio-confirm" role="alert"><strong>${escape(s('Replace the current draft?'))}</strong><p>${escape(s('Changes to the open draft will be replaced. Save or export it first to keep them. Named saved projects are retained.'))}</p><div class="studio-confirm-actions">${button('Keep draft','keep-draft')}${button('Replace draft','replace-draft',{className:'danger'})}</div></div>`:''}
      <div class="studio-toolbar">${button('Export project','export-project')}${button('Import project','import-project')}${button('Reset draft','reset')}<input id="studio-import" type="file" accept="application/json,.json" hidden><span class="studio-save ${storageStatus!=='saved'?'warning':''}">${escape(s(storageStatus==='saved'?'Saved in this browser':storageStatus==='invalid'?'Invalid fields — the last saved draft is retained':storageStatus==='unreadable'?'Stored draft unreadable — this session uses a new draft':'Session only — browser storage unavailable'))}</span></div>
      ${projectsPanel()}
      <div class="studio-layout">
        <aside class="studio-panel studio-palette-panel"><div class="studio-panel-heading"><span class="eyebrow">${escape(s('BUILDING BLOCKS'))}</span><h2>${escape(s('One escrow. Six states.'))}</h2><p>${escape(s('Each state appears once. Show block selects an existing state; Add restores a removed state.'))}</p></div><div class="studio-palette">${Object.entries(types).map(([type,item])=>paletteItemHTML(type,item)).join('')}</div></aside>
        <section class="studio-panel studio-flow-panel"><div class="studio-canvas-heading"><div><span class="eyebrow">${escape(s('FLOW CANVAS'))}</span><h2>${escape(s('Escrow lifecycle'))}</h2></div><span class="studio-canvas-tip" id="studio-connect-hint">${escape(pendingMessage())}</span></div><div class="studio-zoom-bar"><label for="studio-zoom">${escape(s('Canvas zoom'))}</label><select id="studio-zoom">${[['fit','Fit'],['0.5','50%'],['0.75','75%'],['1','100%']].map(([value,label])=>`<option value="${value}"${zoomMode===value?' selected':''}>${escape(s(label))}</option>`).join('')}</select><span>${escape(s('Zoom out to see every path.'))}</span></div><div class="studio-canvas-scroll"><div class="studio-canvas-space"><div class="studio-canvas" id="studio-canvas" role="group" aria-label="${escape(s('Escrow lifecycle'))}"><svg class="studio-edges" viewBox="0 0 ${width} ${height}" aria-hidden="true"><defs><marker id="studio-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0L8 4L0 8Z" style="fill:#638f9b;stroke:none"/></marker></defs><g id="studio-edge-paths">${edgePaths()}</g></svg>${draft.nodes.map(node=>nodeHTML(node)).join('')}</div></div></div><div class="studio-canvas-footer"><p>${escape(s('Move a selected block with arrow keys. Shift + arrow moves 40 px. Delete removes it.'))}</p><div class="studio-flow-actions">${pendingFrom?button('Cancel connection','cancel-connection'):''}${button('Restore standard flow','restore-flow')}</div></div>${selectedPanel()}<details class="studio-connections"><summary>${escape(s('Connections'))} · ${draft.edges.length}</summary>${draft.edges.length?`<ul class="studio-connection-list">${draft.edges.map((edge,index)=>`<li><span>${escape(nodeLabel(edge.from))} → ${escape(nodeLabel(edge.to))}</span><button type="button" data-studio-remove-edge="${index}" aria-label="${escape(`${s('Remove connection')}: ${nodeLabel(edge.from)} → ${nodeLabel(edge.to)}`)}">×</button></li>`).join('')}</ul>`:`<p>${escape(s('No connections. Add the required paths before generating source.'))}</p>`}</details></section>
        <aside class="studio-panel studio-inspector"><div class="studio-panel-heading"><span class="eyebrow">${escape(s('INSPECTOR'))}</span><h2>${escape(s('The agreement'))}</h2></div><form class="studio-form" id="studio-config" novalidate>${field('buyer','Buyer address','0x…',draft.config.buyer,'Nodus EVM address: 0x followed by 64 hexadecimal characters.',check)}${field('seller','Seller address','0x…',draft.config.seller,'Nodus EVM address: 0x followed by 64 hexadecimal characters.',check)}${field('amountNodus','Amount · NODUS','100',draft.config.amountNodus,'Use a dot as decimal separator; up to 8 decimal places.',check)}${field('deadline','Deadline · UTC','2030-01-01T12:00:00Z',draft.config.deadline,'Enter an explicit UTC timestamp, for example 2030-01-01T12:00:00Z.',check)}</form><div class="studio-validation ${check.valid?'valid':''}" id="studio-validation"><strong>${escape(s(check.valid?'Ready for source generation':'Complete the agreement'))}</strong>${check.valid?'':`<ul>${check.errors.map(issue=>`<li>${escape(errorText(issue))}</li>`).join('')}</ul>`}</div><div class="studio-example"><p>${escape(s('No timer sends a transaction. After the deadline, the buyer must call refund().'))}</p></div></aside>
      </div>
      <details class="studio-howto studio-panel"><summary>${escape(s('How to explore this example'))}</summary><ol><li>${escape(s('Select Show block to find a state. Drag its title or use the arrow controls to move it.'))}</li><li>${escape(s('Remove a selected block, then use Add or drag it from the palette to restore it. Each state can appear only once.'))}</li><li>${escape(s('Connect the right output port to a left input port. Restore standard flow repairs all required states and paths.'))}</li><li>${escape(s('Use Simulation to try buyer and seller actions without moving coins. The exact escrow rules are explained in Summary.'))}</li></ol></details>
      <section class="studio-panel studio-workbench"><div class="studio-workbench-head"><div><span class="eyebrow">${escape(s('WORKBENCH'))}</span><h2>${escape(s('Inspect before you trust.'))}</h2></div><span class="studio-save">${escape(s('LOCAL DRAFT'))}</span></div><div class="studio-tabs" role="tablist" aria-label="${escape(s('WORKBENCH'))}">${[['summary','Summary'],['source','Solidity source'],['simulation','Simulation']].map(([tab,label])=>`<button type="button" id="studio-tab-${tab}" role="tab" data-studio-tab="${tab}" aria-selected="${activeTab===tab}" aria-controls="studio-workbench-content" tabindex="${activeTab===tab?0:-1}">${escape(s(label))}</button>`).join('')}</div><div class="studio-tab-panel" id="studio-workbench-content" role="tabpanel" aria-labelledby="studio-tab-${activeTab}">${activeTab==='source'?sourcePanel(check):activeTab==='simulation'?simulationPanel(check):summaryPanel()}</div></section>
      <div class="studio-message" id="studio-message" role="status" aria-live="polite">${escape(statusText())}</div>
    </div>`;
    language = currentLanguage();
    bind();
    applyZoom();
    const canvasScroll=root.querySelector('.studio-canvas-scroll');if(canvasScroll){canvasScroll.scrollLeft=scrollPosition.left;canvasScroll.scrollTop=scrollPosition.top;}
    const connections=root.querySelector('.studio-connections');if(connections)connections.open=connectionsOpen;
  }
  function statusText() { return typeof status === 'string' ? s(status) : status?.text || ''; }
  function field(key,label,placeholder,value,help,check) {
    return `<div class="studio-field"><label for="studio-${key}">${escape(s(label))}</label><input id="studio-${key}" name="${key}" value="${escape(value)}" placeholder="${escape(placeholder)}" type="text" spellcheck="false" autocomplete="off"${key==='amountNodus'?' inputmode="decimal"':''} aria-invalid="${check.errors.some(issue=>issue.field===`config.${key}`)}" aria-describedby="studio-${key}-help"><small id="studio-${key}-help">${escape(s(help))}</small></div>`;
  }
  function paletteItemHTML(type,item) {
    const existing=draft.nodes.some(node=>node.type===type);
    const state=s(item.label);
    return `<div class="studio-palette-item${existing?' on-canvas':''}" draggable="true" data-studio-palette="${type}" style="--state-color:${item.color}"><div class="studio-state-line"><span class="studio-state-dot"></span><strong>${escape(state)}</strong></div><p>${escape(s(item.description))}</p><button type="button" class="studio-button" data-studio-add="${type}" aria-label="${escape(s(existing?'Show {state} on canvas':'Add {state}',{state}))}" title="${escape(s(existing?'Already on canvas — select and reveal it.':'Add the missing state to the canvas.'))}">${existing?'↗':'+'} ${escape(s(existing?'Show block':'Add'))}</button></div>`;
  }
  function nodeHTML(node) {
    const item = types[node.type];
    return `<div class="studio-node ${selected===node.id?'selected':''} ${pendingFrom===node.id?'connecting':''}" id="studio-node-${escape(node.id)}" data-studio-node="${escape(node.id)}" style="left:${bounded(node.x,18,width-nodeWidth-18)}px;top:${bounded(node.y,18,height-nodeHeight-18)}px;--state-color:${item.color}"><button type="button" class="studio-port in" data-studio-input="${escape(node.id)}" aria-label="${escape(s('Input to {state}',{state:s(item.label)}))}">‹</button><button type="button" class="studio-node-title" data-studio-handle="${escape(node.id)}" aria-label="${escape(s('Select {state}',{state:s(item.label)}))}" aria-pressed="${selected===node.id}"><span class="studio-state-dot"></span>${escape(s(item.label))}</button><div class="studio-node-meta"><span>${escape(node.id)}</span><span>${['paid','refunded','cancelled'].includes(node.type)?escape(s('Terminal')):node.type==='created'?escape(s('Start')):'ESCROW'}</span></div><button type="button" class="studio-port out" data-studio-output="${escape(node.id)}" aria-label="${escape(s('Output from {state}',{state:s(item.label)}))}">›</button></div>`;
  }
  function edgePaths() {
    return draft.edges.map(edge=>{
      const from = draft.nodes.find(node=>node.id===edge.from), to = draft.nodes.find(node=>node.id===edge.to);
      if (!from || !to) return '';
      const x1=bounded(from.x,18,width-nodeWidth-18)+nodeWidth+1,y1=bounded(from.y,18,height-nodeHeight-18)+44;
      const x2=bounded(to.x,18,width-nodeWidth-18)-1,y2=bounded(to.y,18,height-nodeHeight-18)+44;
      const curve=Math.max(45,Math.abs(x2-x1)*.5);
      return `<path d="M${x1} ${y1}C${x1+curve} ${y1},${x2-curve} ${y2},${x2} ${y2}" marker-end="url(#studio-arrow)"/>`;
    }).join('');
  }
  function selectedPanel() {
    const node = draft.nodes.find(item=>item.id===selected);
    if (!node) return `<div class="studio-selected"><p>${escape(s('Select a block to move or remove it.'))}</p></div>`;
    return `<div class="studio-selected"><strong>${escape(s('Selected block'))}: ${escape(s(types[node.type].label))}</strong><div class="studio-move">${[['left','←','Move left'],['up','↑','Move up'],['down','↓','Move down'],['right','→','Move right']].map(([direction,glyph,label])=>`<button type="button" class="studio-button" data-studio-move="${direction}" aria-label="${escape(s(label))}">${glyph}</button>`).join('')}</div>${button('Remove block','remove-node',{className:'danger'})}</div>`;
  }
  function summaryPanel() {
    const config=draft.config;
    return `${deadlineWarning()}<div class="studio-summary-grid"><div class="studio-summary-cell"><span>${escape(s('Buyer'))}</span><strong>${escape(config.buyer||'—')}</strong></div><div class="studio-summary-cell"><span>${escape(s('Seller'))}</span><strong>${escape(config.seller||'—')}</strong></div><div class="studio-summary-cell amount"><span>${escape(s('Agreed amount'))}</span><strong>${escape(config.amountNodus||'—')} NODUS</strong></div><div class="studio-summary-cell"><span>${escape(s('Refund opens at'))}</span><strong>${escape(config.deadline||'—')} · UTC</strong></div></div><div class="studio-summary-notes"><p>${escape(s('The buyer deposits the exact amount before the deadline, then approves delivery. The seller withdraws the approved payment. If approval never happens, the buyer can refund the funded escrow at or after the deadline.'))}</p><p>${escape(s('Approval is final: an approved escrow has no buyer refund path. A failed transfer leaves the escrow unchanged.'))}</p><p>${escape(s('One buyer, one seller, one deposit. No arbitrary branches, oracles or external calls beyond the payout.'))}</p><p>${escape(s('Contract payments use Nodus EVM balances, separate from the native CORE wallet balance. Fund the EVM balance before depositing; transactions also require native wallet funds for fees.'))}</p></div>`;
  }
  function deadlineWarning() {
    const seconds=Date.parse(draft.config.deadline);
    return Number.isFinite(seconds)&&seconds<=Date.now()?`<div class="studio-validation"><p>${escape(s('This deadline is in the past. A deployed contract cannot accept a deposit or approval after its deadline. Set a future UTC deadline before publishing.'))}</p></div>`:'';
  }
  function sourcePanel(check) {
    let source = '';
    if (check.valid) { try { source=core().generate(draft); } catch { return `<p>${escape(s('Source generation failed.'))}</p>`; } }
    return `${deadlineWarning()}<div class="studio-source-actions">${button('Download .sol','download-source',{className:'primary',disabled:!check.valid})}${button('Copy source','copy-source',{disabled:!check.valid})}${button('Download export manifest','download-manifest',{disabled:!check.valid})}</div>${check.valid?`<pre class="studio-source" tabindex="0" aria-label="${escape(s('Solidity source'))}"><code>${escape(source)}</code></pre>`:`<div class="studio-validation"><strong>${escape(s('Complete the agreement'))}</strong><p>${escape(s('Fix the listed issues to generate executable source. Incomplete agreements may be exported as drafts; invalid data or unsupported connections must be corrected first.'))}</p></div>`}<div class="studio-compiler-note">${escape(s('ABI and bytecode are not generated in this browser. Compile the downloaded source with the pinned Nodus compiler, then use the Nodus wallet to review and publish.'))}<br><a href="https://github.com/Trader1976/nodus-observatory/blob/feature/contract-studio/docs/contract-studio${currentLanguage()==='fi'?'_fin':''}.md" target="_blank" rel="noopener noreferrer">${escape(s('Compiler & wallet instructions'))} ↗</a></div>`;
  }
  function weiNodus(value) {
    try { const amount=BigInt(value); return `${amount/1000000000000000000n}.${(amount%1000000000000000000n).toString().padStart(18,'0').slice(0,8)}`.replace(/\.?0+$/,''); }
    catch { return '—'; }
  }
  function simulationPanel(check) {
    return `<div class="studio-simulation-top"><span class="eyebrow">${escape(s('LOCAL SIMULATION'))} · ${escape(s('No network or wallet calls'))}</span>${button(simulation?'Restart simulation':'Start simulation','start-simulation',{className:'primary',disabled:!check.valid})}${button('Use simulation identities','simulate-examples')}</div>${simulationUsesExamples?`<div class="studio-validation"><strong>${escape(s('Simulation identities only — the actual agreement is unchanged.'))}</strong><p>${escape(s('These public example addresses are for simulation only. Replace both before publishing a contract.'))}</p></div>`:''}${simulation?`<div class="studio-sim-grid"><div class="studio-sim-controls"><div class="studio-role"><label for="studio-actor">${escape(s('Act as'))}</label><select id="studio-actor">${[['buyer','Buyer'],['seller','Seller'],['outsider','Outsider']].map(([role,label])=>`<option value="${role}"${actor===role?' selected':''}>${escape(s(label))}</option>`).join('')}</select></div><div class="studio-action-grid">${Object.entries(actionLabels).filter(([action])=>action!=='advanceTime').map(([action,label])=>button(label,`sim-${action}`)).join('')}</div><label class="studio-check"><input id="studio-fail-transfer" type="checkbox"${failTransfer?' checked':''}>${escape(s('Simulate a failed recipient transfer'))}</label><div class="studio-action-grid">${button('Advance 1 hour','sim-hour')}${button('Go to deadline','sim-deadline',{disabled:simulation.nowSeconds>=simulation.deadlineSeconds})}</div></div><div class="studio-sim-state"><div class="studio-sim-stage"><strong>${escape(s(types[simulation.stage]?.label||simulation.stage))}</strong><span>ESCROW</span></div><div class="studio-sim-numbers">${[['Time',new Date(simulation.nowSeconds*1000).toISOString().replace('.000Z','Z')],['Contract balance',`${weiNodus(simulation.balanceWei)} NODUS`],['Paid to seller',`${weiNodus(simulation.payouts.sellerWei)} NODUS`],['Returned to buyer',`${weiNodus(simulation.payouts.buyerWei)} NODUS`]].map(([label,value])=>`<div><span>${escape(s(label))}</span><strong>${escape(value)}</strong></div>`).join('')}</div></div></div><div class="studio-trace"><h3>${escape(s('Simulation trace'))}</h3>${trace.length?`<ol>${trace.slice().reverse().map(item=>`<li class="${item.ok?'':'rejected'}"><span class="result">${escape(s(item.ok?'Accepted':'Rejected'))}</span><span>${escape(s(actionLabels[item.action]||'Unknown action'))} · ${escape(s(item.actor==='buyer'?'Buyer':item.actor==='seller'?'Seller':'Outsider'))}<br>${escape(item.ok?s(types[item.stage]?.label||item.stage):errorText({code:item.code,field:'simulation'}))} · ${escape(new Date(item.at*1000).toISOString().replace('.000Z','Z'))}</span></li>`).join('')}</ol>`:`<p>${escape(s('No actions yet. Try the wrong role, a double withdrawal or the exact deadline.'))}</p>`}</div>`:`<p>${escape(s('Validate the agreement first, or fill the example identities to explore the simulator.'))}</p>`}`;
  }
  function bounded(value,min,max) { return Math.round(Math.max(min,Math.min(max,value))); }
  function notify(message) { status=message; const element=root?.querySelector('#studio-message'); if(element)element.textContent=statusText(); }
  function selectedNode() { return draft.nodes.find(node=>node.id===selected); }
  function revealNode(id,message) {
    selected=id;
    render();
    const handle=root?.querySelector(`[data-studio-handle="${id}"]`);
    handle?.scrollIntoView?.({block:'nearest',inline:'center'});
    handle?.focus?.({preventScroll:true});
    if(message)notify({text:s(message,{state:nodeLabel(id)})});
  }
  function addNode(type,x,y) {
    if (!types[type]) return;
    const existing=draft.nodes.find(node=>node.type===type);
    if(existing){revealNode(existing.id,'{state} is already on the canvas. Selected the existing block.');return;}
    let id;do{id=`${type}-${++serial}`;}while(draft.nodes.some(node=>node.id===id));
    const node={id,type,x:bounded(x??70+draft.nodes.length*35,18,width-nodeWidth-18),y:bounded(y??350,18,height-nodeHeight-18)};
    draft.nodes.push(node); semanticEdit(); revealNode(node.id,'{state} added. Connect its input and output to restore the required paths.');
  }
  function removeNode() {
    if (!selectedNode()) return;
    draft.nodes=draft.nodes.filter(node=>node.id!==selected);
    draft.edges=draft.edges.filter(edge=>edge.from!==selected&&edge.to!==selected);
    if(pendingFrom===selected)pendingFrom=null;
    selected=null; semanticEdit(); render();
  }
  function moveNode(dx,dy) {
    const node=selectedNode(); if(!node)return;
    node.x=bounded(node.x+dx,18,width-nodeWidth-18); node.y=bounded(node.y+dy,18,height-nodeHeight-18);
    layoutEdit(); render();
  }
  function replaceDraft(next,message) { draft=next;selected=null;pendingFrom=null;activeProjectId=null;activeRevision=null;projectName='';projectMessage='';deleteProjectId=null;semanticEdit();changed=false;replaceAction=null;status=message;render(); }
  function requestReplace(action) { if(changed){replaceAction=action;render();}else action(); }
  function connect(to) {
    if(!pendingFrom){selected=to;render();return;}
    if(pendingFrom===to){notify('A block cannot connect to itself.');return;}
    if(draft.edges.some(edge=>edge.from===pendingFrom&&edge.to===to)){notify('This connection already exists.');return;}
    draft.edges.push({from:pendingFrom,to});pendingFrom=null;semanticEdit();status='Connection added.';render();
  }
  function download(text,name,type) {
    const blob=new Blob([text],{type});const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=name;document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function startSimulation(examples=false) {
    const simulated=clone(draft);
    if(examples){simulated.config.buyer=`0x${'1'.repeat(64)}`;simulated.config.seller=`0x${'2'.repeat(64)}`;}
    const check=core().validate(simulated);
    if(!check.valid){notify({text:check.errors.map(errorText).join(' ')});return;}
    try { simulation=core().createSimulation(simulated);simulationUsesExamples=examples;trace=[];actor='buyer';failTransfer=false;status='Simulation started.';render(); }
    catch(error){notify({text:errorText(error)});}
  }
  function simulate(action) {
    if(!simulation)return;
    const command={action,actor};
    if(action==='advanceTime')command.nowSeconds=simulation.nowSeconds+3600;
    else if(['withdraw','refund'].includes(action))command.paymentSucceeds=!failTransfer;
    const result=core().transition(simulation,command);
    trace.push({action,actor,ok:result.ok,stage:result.state.stage,code:result.error?.code,at:result.state.nowSeconds});
    trace=trace.slice(-200);simulation=result.state;render();
  }
  function advance(to) {
    if(!simulation)return;
    const result=core().transition(simulation,{action:'advanceTime',nowSeconds:to});
    trace.push({action:'advanceTime',actor,ok:result.ok,stage:result.state.stage,code:result.error?.code,at:result.state.nowSeconds});trace=trace.slice(-200);simulation=result.state;render();
  }
  async function act(action) {
    if(action==='save-new'){saveProject(true);return;}
    if(action==='save-project'){saveProject(false);return;}
    if(action==='load-project'){loadProject();return;}
    if(action==='delete-project'){deleteProjectId=selectedProjectId;render();return;}
    if(action==='keep-project'){deleteProjectId=null;render();return;}
    if(action==='confirm-delete-project'){deleteProject();return;}
    if(action==='export-project'){
      try{download(core().exportProject(draft),'nodus-escrow-project.json','application/json');notify('Draft exported.');}catch(error){notify({text:(error.errors||[error]).map(errorText).join(' ')});}return;
    }
    if(action==='import-project'){root.querySelector('#studio-import').click();return;}
    if(action==='reset'){requestReplace(()=>replaceDraft(core().defaultDraft(),'Draft reset.'));return;}
    if(action==='keep-draft'){replaceAction=null;render();return;}
    if(action==='replace-draft'){const next=replaceAction;replaceAction=null;next?.();return;}
    if(action==='remove-node'){removeNode();return;}
    if(action==='restore-flow'){
      const base=core().defaultDraft();draft.nodes=base.nodes;draft.edges=base.edges;selected=null;pendingFrom=null;semanticEdit();status='Standard flow restored.';render();return;
    }
    if(action==='cancel-connection'){pendingFrom=null;render();return;}
    if(action==='start-simulation'){startSimulation();return;}
    if(action==='simulate-examples'){startSimulation(true);return;}
    if(action==='sim-hour'){advance(simulation.nowSeconds+3600);return;}
    if(action==='sim-deadline'){advance(simulation.deadlineSeconds);return;}
    if(action.startsWith('sim-')){simulate(action.slice(4));return;}
    if(!validation().valid)return;
    if(action==='download-source'){download(core().generate(draft),'ObservatoryEscrow.sol','text/plain');notify('Solidity source downloaded.');return;}
    if(action==='copy-source'){
      try{await navigator.clipboard.writeText(core().generate(draft));notify('Source copied.');}catch{notify('Copy failed. Use the source download instead.');}return;
    }
    if(action==='download-manifest'){
      const manifest={schema:'nodus-contract-studio/export-v1',generatedAt:new Date().toISOString(),projectSchema:draft.schema,template:'single-deposit-escrow/v1',sourceFile:'ObservatoryEscrow.sol',compiler:{family:'Nodus solc',version:'0.8.30',addressBytes:32},artifacts:{source:true,abi:false,bytecode:false},config:clone(draft.config),deployment:{performed:false,wallet:'Nodus wallet',valueBalance:'Nodus EVM',note:'Compile source using the pinned Nodus compiler. Review ABI, bytecode, constructor and EVM funding in the wallet. No signing or deployment was performed by this editor.'}};
      download(JSON.stringify(manifest,null,2)+'\n','nodus-escrow-export.json','application/json');notify('Manifest downloaded.');
    }
  }
  function bind() {
    root.querySelectorAll('[data-studio-action]').forEach(element=>element.onclick=()=>act(element.dataset.studioAction));
    const nameInput=root.querySelector('#studio-project-name');
    if(nameInput)nameInput.oninput=()=>{projectName=nameInput.value;changed=true;projectMessage='';refreshProjectNotice();};
    const savedProject=root.querySelector('#studio-saved-project');
    if(savedProject)savedProject.onchange=()=>{selectedProjectId=savedProject.value;deleteProjectId=null;projectMessage='';render();root.querySelector('#studio-saved-project')?.focus();};
    root.querySelectorAll('[data-studio-tab]').forEach(element=>{
      element.onclick=()=>{activeTab=element.dataset.studioTab;render();root.querySelector(`#studio-tab-${activeTab}`)?.focus();};
      element.onkeydown=event=>{
        if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
        event.preventDefault();const tabs=['summary','source','simulation'];const index=tabs.indexOf(activeTab);activeTab=event.key==='Home'?tabs[0]:event.key==='End'?tabs[2]:tabs[(index+(event.key==='ArrowRight'?1:2))%3];render();root.querySelector(`#studio-tab-${activeTab}`)?.focus();
      };
    });
    root.querySelectorAll('[data-studio-add]').forEach(element=>element.onclick=()=>addNode(element.dataset.studioAdd));
    root.querySelectorAll('[data-studio-palette]').forEach(element=>element.ondragstart=event=>{event.dataTransfer.setData('application/x-nodus-state',element.dataset.studioPalette);event.dataTransfer.effectAllowed='copy';});
    root.querySelectorAll('[data-studio-output]').forEach(element=>element.onclick=()=>{pendingFrom=element.dataset.studioOutput;selected=pendingFrom;render();});
    root.querySelectorAll('[data-studio-input]').forEach(element=>element.onclick=()=>connect(element.dataset.studioInput));
    root.querySelectorAll('[data-studio-remove-edge]').forEach(element=>element.onclick=()=>{draft.edges.splice(Number(element.dataset.studioRemoveEdge),1);semanticEdit();render();});
    root.querySelectorAll('[data-studio-move]').forEach(element=>element.onclick=()=>{const [x,y]={left:[-20,0],right:[20,0],up:[0,-20],down:[0,20]}[element.dataset.studioMove];moveNode(x,y);});
    root.querySelectorAll('[data-studio-handle]').forEach(element=>{
      element.onclick=()=>{if(drag?.moved)return;selected=element.dataset.studioHandle;render();root.querySelector(`[data-studio-handle="${selected}"]`)?.focus();};
      element.onkeydown=event=>{
        const movement={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
        selected=element.dataset.studioHandle;
        if(movement){event.preventDefault();const step=event.shiftKey?40:10;moveNode(movement[0]*step,movement[1]*step);root.querySelector(`[data-studio-handle="${selected}"]`)?.focus();}
        else if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();removeNode();}
      };
      element.onpointerdown=event=>{
        if(event.button!==0)return;
        const node=draft.nodes.find(item=>item.id===element.dataset.studioHandle);selected=node.id;
        drag={id:node.id,pointer:event.pointerId,x:event.clientX,y:event.clientY,startX:node.x,startY:node.y,moved:false};
        element.setPointerCapture?.(event.pointerId);
        root.querySelectorAll('.studio-node').forEach(item=>item.classList.toggle('selected',item.dataset.studioNode===selected));
      };
      element.onpointermove=event=>{
        if(!drag||drag.pointer!==event.pointerId)return;
        const node=draft.nodes.find(item=>item.id===drag.id);if(!node)return;
        const dx=(event.clientX-drag.x)/zoomScale,dy=(event.clientY-drag.y)/zoomScale;
        if(Math.abs(dx)+Math.abs(dy)>3)drag.moved=true;
        node.x=bounded(drag.startX+dx,18,width-nodeWidth-18);node.y=bounded(drag.startY+dy,18,height-nodeHeight-18);
        const box=root.querySelector(`#studio-node-${node.id}`);if(box){box.style.left=`${node.x}px`;box.style.top=`${node.y}px`;}
        const paths=root.querySelector('#studio-edge-paths');if(paths)paths.innerHTML=edgePaths();
      };
      const stop=event=>{if(!drag||drag.pointer!==event.pointerId)return;const moved=drag.moved;drag=null;if(moved){layoutEdit();render();}};
      element.onpointerup=stop;element.onpointercancel=stop;
    });
    const canvas=root.querySelector('#studio-canvas');
    if(canvas){canvas.ondragover=event=>{if(event.dataTransfer.types.includes('application/x-nodus-state')){event.preventDefault();event.dataTransfer.dropEffect='copy';}};canvas.ondrop=event=>{event.preventDefault();const type=event.dataTransfer.getData('application/x-nodus-state'),rect=canvas.getBoundingClientRect();addNode(type,(event.clientX-rect.left)/zoomScale-nodeWidth/2,(event.clientY-rect.top)/zoomScale-35);};}
    const zoom=root.querySelector('#studio-zoom');if(zoom)zoom.onchange=()=>{if(['fit','0.5','0.75','1'].includes(zoom.value)){zoomMode=zoom.value;applyZoom();}};
    const form=root.querySelector('#studio-config');if(form){form.onsubmit=event=>event.preventDefault();form.querySelectorAll('input').forEach(input=>{
      input.oninput=()=>{draft.config[input.name]=input.value;semanticEdit();refreshDerived();};
      input.onchange=()=>{draft.config[input.name]=input.value;semanticEdit();refreshDerived();};
    });}
    const importInput=root.querySelector('#studio-import');if(importInput)importInput.onchange=async()=>{
      const file=importInput.files?.[0];if(!file)return;
      if(file.size>(core().MAX_PROJECT_LENGTH||65536)){notify('Choose a JSON project smaller than 64 KiB.');importInput.value='';return;}
      try{const project=core().importProject(await file.text());if(project.schema!==core().SCHEMA){notify('Open this project in the visual editor. The current escrow draft is retained.');return;}requestReplace(()=>replaceDraft(project,'Project imported.'));}catch{notify('Invalid project file. Import only a Contract Studio project JSON file.');}finally{importInput.value='';}
    };
    const role=root.querySelector('#studio-actor');if(role)role.onchange=()=>{actor=role.value;};
    const fail=root.querySelector('#studio-fail-transfer');if(fail)fail.onchange=()=>{failTransfer=fail.checked;};
  }
  function applyZoom() {
    const scroll=root?.querySelector('.studio-canvas-scroll'),space=root?.querySelector('.studio-canvas-space'),canvas=root?.querySelector('#studio-canvas');
    if(!scroll||!space||!canvas)return;
    zoomScale=zoomMode==='fit'?Math.max(.35,Math.min(1,(scroll.clientWidth||width)/width)):Number(zoomMode);
    space.style.width=`${width*zoomScale}px`;space.style.height=`${height*zoomScale}px`;
    canvas.style.transform=`scale(${zoomScale})`;
  }
  function refreshDerived() {
    const check=validation(),box=root.querySelector('#studio-validation');
    if(box){box.classList.toggle('valid',check.valid);box.innerHTML=`<strong>${escape(s(check.valid?'Ready for source generation':'Complete the agreement'))}</strong>${check.valid?'':`<ul>${check.errors.map(issue=>`<li>${escape(errorText(issue))}</li>`).join('')}</ul>`}`;}
    root.querySelectorAll('#studio-config input').forEach(input=>input.setAttribute('aria-invalid',String(check.errors.some(issue=>issue.field===`config.${input.name}`))));
    const panel=root.querySelector('#studio-workbench-content');if(panel)panel.innerHTML=activeTab==='source'?sourcePanel(check):activeTab==='simulation'?simulationPanel(check):summaryPanel();
    const saved=root.querySelector('.studio-toolbar .studio-save');if(saved){saved.classList.toggle('warning',storageStatus!=='saved');saved.textContent=s(storageStatus==='saved'?'Saved in this browser':storageStatus==='invalid'?'Invalid fields — the last saved draft is retained':storageStatus==='unreadable'?'Stored draft unreadable — this session uses a new draft':'Session only — browser storage unavailable');}
    const message=root.querySelector('#studio-message');if(message)message.textContent=statusText();
    bind();
  }
  globalThis.NodusContractStudio = Object.freeze({
    mount(target, options = {}) {
      const previousRoute=activeRoute;
      if(typeof options.route==='string'&&/^#[a-z0-9-]+$/.test(options.route))activeRoute=options.route;
      const sameRoot=root===target&&target?.querySelector?.('#contract-studio')&&previousRoute===activeRoute;
      root=target;
      if(!draft)draft=initialDraft();
      if(!sameRoot||!mounted||language!==currentLanguage()){render();mounted=true;}
    },
    getDraft:()=>draft?clone(draft):null,
    getState:()=>({activeTab,selected,pendingFrom,simulation:simulation?clone(simulation):null,simulationUsesExamples,trace:clone(trace),storageStatus,changed,zoomMode,zoomScale,activeProjectId,projectName,projectsStatus}),
  });
  globalThis.addEventListener?.('resize',()=>{if(globalThis.location?.hash===activeRoute)applyZoom();});
  globalThis.addEventListener?.('keydown',event=>{if(event.key==='Escape'&&pendingFrom&&globalThis.location?.hash===activeRoute){pendingFrom=null;render();}});
})();
