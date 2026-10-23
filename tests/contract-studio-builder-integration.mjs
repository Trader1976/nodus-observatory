/** General Contract Studio user-flow checks using the shipped handlers.
 * This offline DOM harness does not claim browser layout or EVM execution coverage.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import {boot as bootFrontend, flush} from './frontend-harness.mjs';

const dist = path.resolve(process.argv[2] || path.join(import.meta.dirname, '../dist'));
const boot = options => bootFrontend(dist, {route:'#contracts-editor', ...options});
const projectKey = 'nodus-observatory-contract-projects-v1';
const catalogSchema = 'nodus-contract-studio/projects-v1';
const page = app => app.document.querySelector('#page-content');
const draft = app => app.context.NodusWorkflowStudio.getDraft();
const state = app => app.context.NodusWorkflowStudio.getState();
function control(app, selector) {
  const result = app.document.querySelector(selector);
  assert(result, `builder control exists: ${selector}`);
  return result;
}
async function click(app, selector) { await control(app, selector).click(); await flush(); }
const action = (app, id) => click(app, `[data-builder-action="${id}"]`);
async function input(app, selector, value) {
  let field = control(app, selector); field.value = value;
  await field.fire('input'); await flush();
  field = control(app, selector); field.value = value;
  await field.fire('change'); await flush();
}
async function tab(app, id) { await click(app, `[data-builder-tab="${id}"]`); }
async function importProject(app, project) {
  const text = typeof project === 'string' ? project : JSON.stringify(project);
  const field = control(app, '#builder-import');
  field.files = [{size:Buffer.byteLength(text), text:async()=>text}];
  await field.fire('change'); await flush();
}
async function confirmReplacement(app) {
  if (app.document.querySelector('[data-builder-action="replace-draft"]')) await action(app, 'replace-draft');
}
async function chooseSaved(app, id) { await input(app, '#builder-saved-project', id); }
const entries = app => JSON.parse(app.preferences.get(projectKey)).projects;
const serialized = app => JSON.stringify(draft(app));
const address = n => `0x${n.toString(16).padStart(2,'0').repeat(32)}`;

function validProject(app, template = 'escrow') {
  const project = app.context.NodusWorkflowCore.defaultDraft(template);
  project.roles.forEach((role,index) => { role.address = address(index + 1); });
  project.config.deadline = '2030-01-01T00:00:00Z';
  // A valid authored ID must not collide with the simulator's Advance hour button.
  const deposit = project.transitions.find(item=>item.operation==='deposit');
  if (deposit) deposit.id = 'hour';
  return project;
}

// The workbench remains available independently of monitoring and browser storage.
const offline = await boot({offline:true, storageThrows:true});
assert(offline.context.NodusWorkflowStudio, 'the general editor ships in the shell');
assert.equal(offline.run('state.dashboard'), null);
assert.equal(draft(offline).schema, 'nodus-contract-studio/v2');
assert(draft(offline).roles.every(role => role.address === ''), 'new agreements do not invent usable participant addresses');
assert.match(page(offline).innerHTML, /RAKENNUSPALIKAT/, 'the actual builder is rendered in Finnish by default');
assert.equal(offline.context.NodusBuilderText('Record approval'), 'Kirjaa hyväksyntä');
const offlineDraft = serialized(offline);
offline.context.NodusI18n.setLanguage('en');
assert.match(page(offline).innerHTML, /BUILDING BLOCKS/, 'switching language rerenders the builder');
await tab(offline, 'source');
assert(control(offline, '[data-builder-action="download-source"]').disabled);
await action(offline, 'export-project');
assert.equal(JSON.parse(await offline.downloads.at(-1).text()).schema, 'nodus-contract-studio/v2');
await tab(offline, 'simulation'); await action(offline, 'sim-example-identities');
assert(state(offline).simulation, 'an explicit example simulation can start while real addresses are blank');
assert.equal(serialized(offline), offlineDraft, 'simulation identities never become the authored agreement');
await control(offline, '[data-builder-action="start-simulation"]').onclick(); await flush();
const englishValidation = control(offline, '#builder-message').textContent;
assert(englishValidation.length > 0);
offline.context.NodusI18n.setLanguage('fi');
assert.notEqual(control(offline, '#builder-message').textContent, englishValidation, 'stored validation errors are translated again after a language change');
offline.context.NodusI18n.setLanguage('en');
await offline.run('loadData(true)');
assert(offline.document.querySelector('[data-builder-tab="simulation"]'), 'monitoring refresh failures retain the editor');

// Import a valid configured agreement through the actual file input. An action
// card edit must change generated source, rather than only changing the drawing.
const app = await boot(); app.context.NodusI18n.setLanguage('en');
const project = validProject(app);
await importProject(app, project); await confirmReplacement(app);
assert.equal(app.context.NodusWorkflowCore.validate(draft(app)).valid, true);
const initialSource = app.context.NodusWorkflowCore.generate(draft(app));
const deposit = draft(app).transitions.find(item => item.operation === 'deposit');
assert(deposit);
await click(app, `[data-builder-transition="${deposit.id}"]`);
await input(app, '#builder-action-amountNodus', '0.00000001');
const editedSource = app.context.NodusWorkflowCore.generate(draft(app));
assert.notEqual(editedSource, initialSource, 'an edited exact deposit amount reaches executable source');
assert.equal(draft(app).transitions.find(item => item.id === deposit.id).amountNodus, '0.00000001');
await tab(app, 'source'); await action(app, 'download-source');
assert.equal(await app.downloads.at(-1).text(), editedSource, 'source download uses the current graph');
await action(app, 'download-manifest');
const manifest = JSON.parse(await app.downloads.at(-1).text());
const sortedStates = Array.from(draft(app).states).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
const sortedRoles = Array.from(draft(app).roles).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
assert.deepEqual(manifest.states.map(item=>[item.id,item.stageIndex]), sortedStates.map((item,index)=>[item.id,index]));
assert.deepEqual(manifest.roles.map(item=>[item.id,item.constantName,item.address]), sortedRoles.map((item,index)=>[item.id,`role_${index}`,item.address]));
assert(manifest.actions.some(item=>item.id===deposit.id && editedSource.includes(`function ${item.functionName}(`)), 'manifest exposes the actual sorted generated function mapping');
assert.equal(manifest.artifacts.abi, false); assert.equal(manifest.artifacts.bytecode, false);
assert.equal(manifest.deployment.performed, false);

// State and role cards are also real project data. Their labels are inert text.
const initialState = draft(app).states.find(item => item.initial);
await click(app, `[data-builder-state="${initialState.id}"]`);
await input(app, '#builder-state-label', '<img src=x onerror=alert(1)>');
assert(!page(app).innerHTML.includes('<img src=x'), 'state labels cannot inject markup');
assert(page(app).innerHTML.includes('&lt;img'));
assert(!app.context.NodusWorkflowCore.generate(draft(app)).includes('onerror=alert'), 'labels never become executable source');
const role = draft(app).roles[0];
await click(app, `[data-builder-role="${role.id}"]`);
await input(app, '#builder-role-label', 'Delivery buyer');
assert.equal(draft(app).roles[0].label, 'Delivery buyer');
await action(app, 'add-state');
assert(draft(app).states.length > project.states.length, 'palette adds a user state');
assert.equal(state(app).selection.kind, 'state');
const rolesBefore = draft(app).roles.length;
await action(app, 'add-role');
assert.equal(draft(app).roles.length, rolesBefore + 1, 'palette adds an independent role');
await input(app, '#builder-role-label', 'Document reviewer');
await input(app, '#builder-role-address', address(20));
const reviewer = draft(app).roles.find(item => item.label === 'Document reviewer');
assert(reviewer);
await action(app, 'add-recordHash');
assert.equal(state(app).selection.kind, 'transition');
await input(app, '#builder-action-caller', reviewer.id);
await action(app, 'add-condition-hashEquals');
const addedAction = draft(app).transitions.find(item => item.id === state(app).selection.id);
assert.equal(addedAction.operation, 'recordHash', 'action palette creates a configured operation');
assert.equal(addedAction.caller, reviewer.id);
const hashConditionIndex = addedAction.guard.conditions.findIndex(item => item.type === 'hashEquals');
assert(hashConditionIndex >= 0);
await input(app, `#builder-condition-value-${hashConditionIndex}`, `0x${'66'.repeat(32)}`);
assert.equal(draft(app).transitions.find(item => item.id === addedAction.id).guard.conditions[hashConditionIndex].value, `0x${'66'.repeat(32)}`);

// Return to a fully connected agreement, then use action/condition controls to
// make an OR guard. Authorization and exact incoming value still govern calls.
await importProject(app, project); await confirmReplacement(app);
await click(app, `[data-builder-transition="${deposit.id}"]`);
await input(app, '#builder-action-guardMode', 'any');
await action(app, 'add-condition-afterDeadline');
assert.equal(draft(app).transitions.find(item => item.id === deposit.id).guard.mode, 'any');
assert(draft(app).transitions.find(item => item.id === deposit.id).guard.conditions.some(item => item.type === 'afterDeadline'));
await tab(app, 'simulation'); await action(app, 'start-simulation');
const beforeWrongActor = JSON.stringify(state(app).simulation);
await input(app, '#builder-sim-actor', 'outsider'); await action(app, `sim-action-${deposit.id}`);
assert.equal(JSON.stringify(state(app).simulation), beforeWrongActor, 'OR guards cannot bypass caller authorization');
assert.equal(state(app).trace.at(-1).ok, false);
await input(app, '#builder-sim-actor', deposit.caller);
await input(app, '#builder-sim-value', '0.00000001'); await action(app, `sim-action-${deposit.id}`);
assert.equal(JSON.stringify(state(app).simulation), beforeWrongActor, 'an incorrect payment rolls back the whole call');
await input(app, '#builder-sim-value', deposit.amountNodus); await action(app, `sim-action-${deposit.id}`);
assert.equal(state(app).simulation.stage, deposit.to);
assert.equal(state(app).simulation.balanceWei, app.context.NodusWorkflowCore.parseNodusAmount(deposit.amountNodus).wei);
const simBeforeLanguage = JSON.stringify(state(app).simulation);
app.context.NodusI18n.setLanguage('fi');
assert.equal(JSON.stringify(state(app).simulation), simBeforeLanguage, 'FIN/ENG retains the simulation');
app.context.NodusI18n.setLanguage('en');

// Named copies retain full v2 semantics across new sessions and protect dirty
// work. A quota failure must retain the previous stored revision.
await input(app, '#builder-project-name', 'Editable escrow'); await action(app, 'save-new');
const saved = entries(app)[0];
assert.equal(JSON.parse(saved.json).schema, 'nodus-contract-studio/v2');
const savedDraft = serialized(app);
const reopened = await boot({saved:Object.fromEntries(app.preferences)}); reopened.context.NodusI18n.setLanguage('en');
assert.equal(serialized(reopened), savedDraft, 'browser-local working draft survives a new page session');
await chooseSaved(reopened, saved.id); await action(reopened, 'load-project'); await confirmReplacement(reopened);
assert.equal(serialized(reopened), savedDraft, 'named saved copy restores the actual rules');
assert.equal(state(reopened).simulation, null, 'saved projects do not restore an old simulation execution');
await input(reopened, '#builder-deadline', '2031-01-01T00:00:00Z');
const previousCatalog = reopened.preferences.get(projectKey);
const normalSet = reopened.context.localStorage.setItem;
reopened.context.localStorage.setItem = (key,value) => { if (key === projectKey) throw Error('Quota exceeded'); normalSet(key,value); };
await action(reopened, 'save-project');
assert.equal(reopened.preferences.get(projectKey), previousCatalog, 'failed save keeps the previous named copy');
assert.equal(state(reopened).changed, true, 'failed save does not clear dirty state');
reopened.context.localStorage.setItem = normalSet;
await chooseSaved(reopened, saved.id); await action(reopened, 'load-project');
assert(reopened.document.querySelector('[data-builder-action="replace-draft"]'), 'loading protects unsaved rule edits');
await action(reopened, 'keep-draft');
assert.equal(draft(reopened).config.deadline, '2031-01-01T00:00:00Z');
const openBeforeDelete = serialized(reopened);
await action(reopened, 'delete-project');
assert.equal(reopened.preferences.get(projectKey), previousCatalog, 'deleting a named project requires confirmation');
await action(reopened, 'keep-project');
assert.equal(reopened.preferences.get(projectKey), previousCatalog);
await action(reopened, 'delete-project'); await action(reopened, 'confirm-delete-project');
assert.equal(entries(reopened).length, 0);
assert.equal(serialized(reopened), openBeforeDelete, 'deleting a saved copy retains the open, edited agreement');
assert.equal(state(reopened).activeProjectId, null);

// V1 saves are deliberately converted as copies. No old named project is
// silently reinterpreted, replaced or deleted by the new editor.
const legacyProject = app.context.NodusStudioCore.defaultDraft();
legacyProject.config = {buyer:address(10), seller:address(11), amountNodus:'12.34567890', deadline:'2030-01-01T00:00:00Z'};
const legacyEntry = {id:'p-legacy', name:'Existing escrow', createdAt:'2026-01-01T00:00:00.000Z', updatedAt:'2026-01-01T00:00:00.000Z', json:app.context.NodusStudioCore.exportProject(legacyProject)};
const legacyCatalog = JSON.stringify({schema:catalogSchema, projects:[legacyEntry]});
const legacy = await boot({saved:{[projectKey]:legacyCatalog}}); legacy.context.NodusI18n.setLanguage('en');
const beforeLegacyLoad = serialized(legacy);
await chooseSaved(legacy, legacyEntry.id); await action(legacy, 'load-project'); await confirmReplacement(legacy);
assert.equal(state(legacy).pendingConversion, true, 'legacy loading requires an explicit conversion decision');
assert.equal(serialized(legacy), beforeLegacyLoad, 'waiting for conversion leaves the current agreement intact');
await action(legacy, 'cancel-conversion');
assert.equal(legacy.preferences.get(projectKey), legacyCatalog);
await chooseSaved(legacy, legacyEntry.id); await action(legacy, 'load-project'); await confirmReplacement(legacy);
await action(legacy, 'convert-v1');
assert.equal(draft(legacy).schema, 'nodus-contract-studio/v2');
assert.equal(state(legacy).activeProjectId, null, 'converted copy cannot update the original legacy entry');
assert.equal(legacy.preferences.get(projectKey), legacyCatalog);
await input(legacy, '#builder-project-name', 'Converted escrow'); await action(legacy, 'save-new');
assert.equal(entries(legacy).length, 2);
assert.equal(entries(legacy).find(entry=>entry.id===legacyEntry.id).json, legacyEntry.json);

// The earlier escrow route can still read a catalog containing both versions.
// It explains where to open a v2 project rather than rendering it as v1.
const mixed = await bootFrontend(dist, {route:'#contracts-escrow', saved:Object.fromEntries(legacy.preferences)});
mixed.context.NodusI18n.setLanguage('en');
assert.equal(mixed.context.NodusContractStudio.getState().projectsStatus, 'ready');
const oldDraft = JSON.stringify(mixed.context.NodusContractStudio.getDraft());
const v2Entry = entries(legacy).find(entry=>JSON.parse(entry.json).schema==='nodus-contract-studio/v2');
await input(mixed, '#studio-saved-project', v2Entry.id);
await click(mixed, '[data-studio-action="load-project"]');
if (mixed.document.querySelector('[data-studio-action="replace-draft"]')) await click(mixed, '[data-studio-action="replace-draft"]');
assert.equal(JSON.stringify(mixed.context.NodusContractStudio.getDraft()), oldDraft, 'legacy route never reinterprets a v2 project');
assert.match(mixed.document.querySelector('#studio-project-message')?.textContent || mixed.document.querySelector('#studio-message')?.textContent || page(mixed).innerHTML, /visual editor/);
await input(mixed, '#studio-saved-project', legacyEntry.id);
await click(mixed, '[data-studio-action="load-project"]');
if (mixed.document.querySelector('[data-studio-action="replace-draft"]')) await click(mixed, '[data-studio-action="replace-draft"]');
assert.equal(mixed.context.NodusContractStudio.getDraft().config.amountNodus, '12.34567890', 'legacy saved projects remain loadable from a mixed catalog');

// Reject hostile imports and unreadable catalogs without losing the last good
// agreement or storage bytes. File export remains available for recovery.
const beforeBadImport = serialized(app);
await importProject(app, '{"schema":"evil","__proto__":{"polluted":true}}');
assert.equal(serialized(app), beforeBadImport);
assert.equal({}.polluted, undefined);
const corrupt = await boot({saved:{[projectKey]:'unreadable catalog'}}); corrupt.context.NodusI18n.setLanguage('en');
await input(corrupt, '#builder-project-name', 'Rescue');
await control(corrupt, '[data-builder-action="save-new"]').onclick(); await flush();
assert.equal(corrupt.preferences.get(projectKey), 'unreadable catalog');
await action(corrupt, 'export-project');
assert.equal(JSON.parse(await corrupt.downloads.at(-1).text()).schema, 'nodus-contract-studio/v2');

// A delayed file read must not replace a newer project selected in the meantime.
const asynchronous = await boot(); asynchronous.context.NodusI18n.setLanguage('en');
let resolveFile;
const delayed = new Promise(resolve=>{resolveFile=resolve;});
const slowInput = control(asynchronous, '#builder-import');
const incomingText = JSON.stringify(validProject(asynchronous));
slowInput.files = [{size:Buffer.byteLength(incomingText), text:()=>delayed}];
const pendingImport = slowInput.fire('change'); await flush();
await action(asynchronous, 'template-blank'); await confirmReplacement(asynchronous);
const newerProject = serialized(asynchronous);
resolveFile(incomingText); await pendingImport; await flush();
assert.equal(serialized(asynchronous), newerProject, 'stale async import cannot overwrite a newer opened template');
assert.equal(state(asynchronous).pendingConversion, false);

// The supported state limit must not make the lower rows render at the same
// clamped position. This checks shipped geometry, not browser layout or pixels.
const crowded = await boot(); crowded.context.NodusI18n.setLanguage('en');
await action(crowded, 'template-blank'); await confirmReplacement(crowded);
while (draft(crowded).states.length < 24) await action(crowded, 'add-state');
assert.equal(new Set(draft(crowded).states.map(item=>`${item.x},${item.y}`)).size, 24);
const renderedPositions = draft(crowded).states.map(item=>control(crowded, `[data-builder-node="${item.id}"]`).getAttribute('style'));
assert.equal(new Set(renderedPositions).size, 24, 'each supported state retains a distinct rendered canvas position');
assert(control(crowded, '[data-builder-action="add-state"]').disabled);

// Valid project files can expand considerably when their escaped JSON is stored
// inside the saved-project catalog. Exercise real exports near the shared read
// limit: neither editor may claim a successful save that makes the list unreadable.
function largeEscapedProject(conditionCount) {
  const label = '\\'.repeat(100);
  return {
    schema:'nodus-contract-studio/v2', config:{deadline:'2030-01-01T00:00:00Z'},
    roles:Array.from({length:8},(_,i)=>({id:`role_${i}`,label,address:address(i+1)})),
    states:Array.from({length:24},(_,i)=>({id:`state_${i}`,label,initial:i===0,terminal:false,x:(i%4)*260,y:Math.floor(i/4)*145})),
    transitions:Array.from({length:48},(_,i)=>({id:`action_${i}`,label,from:`state_${i%24}`,to:`state_${(i+1)%24}`,caller:'role_0',operation:'move',recipient:'',amountNodus:'',guard:{mode:'all',conditions:Array.from({length:conditionCount},()=>({type:'beforeDeadline',value:''}))}})),
  };
}
const largeSix = app.context.NodusWorkflowCore.exportProject(largeEscapedProject(6));
const largeSeven = app.context.NodusWorkflowCore.exportProject(largeEscapedProject(7));
assert(Buffer.byteLength(largeSeven)<=65536, 'the large fixture is a valid exported project within its own file limit');
assert.equal(app.context.NodusWorkflowCore.validate(JSON.parse(largeSeven)).valid,true);
const capacityEntries = Array.from({length:49},(_,i)=>({id:`p-capacity-${i}`,name:`Capacity ${i}`,createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z',json:largeSeven}));
capacityEntries.push({...legacyEntry});
const capacityText = ()=>JSON.stringify({schema:catalogSchema,projects:capacityEntries});
const catalogReadLimit = 4*1024*1024, targetLength = catalogReadLimit-8;
for (const entry of capacityEntries) {
  if (capacityText().length<=targetLength) break;
  if (entry.id!==legacyEntry.id) entry.json=largeSix;
}
const adjustable = capacityEntries.find(entry=>entry.json===largeSix);
assert(adjustable);
const adjustableProject = JSON.parse(largeSix);
for (const transition of adjustableProject.transitions) {
  const before = adjustable.json;
  transition.guard.conditions.push({type:'beforeDeadline',value:''});
  adjustable.json=app.context.NodusWorkflowCore.exportProject(adjustableProject);
  if (capacityText().length>targetLength) {
    transition.guard.conditions.pop();adjustable.json=before;break;
  }
}
let remaining = targetLength-capacityText().length;
assert(remaining>=0 && remaining<100, 'valid project guards place the fixture just below the shared limit');
for (const entry of capacityEntries) {
  if (entry.id===legacyEntry.id) continue;
  const count=Math.min(remaining,100-entry.name.length);
  entry.name+='x'.repeat(count);remaining-=count;
  if (!remaining) break;
}
assert.equal(remaining,0);
const almostFullCatalog = capacityText();
assert.equal(almostFullCatalog.length,targetLength);
const updatableEntry = capacityEntries.find(entry=>entry.json===largeSix);
assert(updatableEntry, 'retain a six-condition project whose next legitimate edit grows the catalog');

const capacityBuilder = await boot({saved:{[projectKey]:almostFullCatalog}});
capacityBuilder.context.NodusI18n.setLanguage('en');
assert.equal(state(capacityBuilder).catalogStatus,'ready');
await chooseSaved(capacityBuilder,updatableEntry.id);await action(capacityBuilder,'load-project');await confirmReplacement(capacityBuilder);
await click(capacityBuilder,'[data-builder-transition="action_0"]');
await action(capacityBuilder,'add-condition-beforeDeadline');
assert.equal(app.context.NodusWorkflowCore.validate(draft(capacityBuilder)).valid,true);
await action(capacityBuilder,'save-project');
assert.equal(capacityBuilder.preferences.get(projectKey),almostFullCatalog,'v2 catalog overflow refuses the save and preserves every previous byte');
assert.equal(state(capacityBuilder).catalogStatus,'ready','the previous full catalog remains readable after a refused update');
assert.equal(state(capacityBuilder).changed,true);
assert.match(control(capacityBuilder,'#builder-project-message').textContent,/too large|Saving failed/);

const capacityLegacy = await bootFrontend(dist,{route:'#contracts-escrow',saved:{[projectKey]:almostFullCatalog}});
capacityLegacy.context.NodusI18n.setLanguage('en');
assert.equal(capacityLegacy.context.NodusContractStudio.getState().projectsStatus,'ready');
await input(capacityLegacy,'#studio-saved-project',legacyEntry.id);
await click(capacityLegacy,'[data-studio-action="load-project"]');
if (capacityLegacy.document.querySelector('[data-studio-action="replace-draft"]')) await click(capacityLegacy,'[data-studio-action="replace-draft"]');
await input(capacityLegacy,'#studio-amountNodus','184467440737.09551615');
await click(capacityLegacy,'[data-studio-action="save-project"]');
assert.equal(capacityLegacy.preferences.get(projectKey),almostFullCatalog,'legacy updater also preserves the exact mixed catalog when its next save would exceed the limit');
assert.equal(capacityLegacy.context.NodusContractStudio.getState().projectsStatus,'ready');
assert.equal(capacityLegacy.context.NodusContractStudio.getState().changed,true);
assert.match(control(capacityLegacy,'#studio-project-message').textContent,/Saving failed/);

for (const target of [offline, app, reopened, legacy, mixed, corrupt, asynchronous, crowded, capacityBuilder, capacityLegacy]) {
  assert(target.requests.every(({options})=>!options?.method || options.method==='GET'), 'builder never writes to monitoring, wallet or RPC endpoints');
  assert(target.requests.every(({request})=>request.startsWith('/api/') || ['snapshot.json','history.json','network.json','rewards.json','events.json'].includes(request)), 'builder does not contact external services');
}
console.log('Contract Studio builder integration: typed rule edits, source/simulation wiring, FIN/ENG, named v2 saves, explicit v1 copies, dirty work, failed/full storage, hostile input and offline operation PASS.');
