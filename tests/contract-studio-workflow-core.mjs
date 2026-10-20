/** Declarative v2 language and financial/authorisation boundary checks.
 * This suite checks the JS model and emitted source, not live Nodus EVM execution.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const dist=path.resolve(process.argv[2]||path.join(path.dirname(fileURLToPath(import.meta.url)),'../dist'));
const context=vm.createContext({Date,BigInt,Number,JSON,console});
for(const script of ['contract-studio-core.js','contract-studio-workflow-core.js'])vm.runInContext(fs.readFileSync(path.join(dist,script),'utf8'),context,{filename:script});
const core=context.NodusWorkflowCore, legacy=context.NodusStudioCore;
const clone=value=>JSON.parse(JSON.stringify(value));
const deadline=Date.parse('2030-01-01T00:00:00Z')/1000;
const zeroHash='0x'+'0'.repeat(64), hash='0x'+'ab'.repeat(32);
function draft(template='escrow'){
  const result=core.defaultDraft(template);result.config.deadline='2030-01-01T00:00:00Z';
  result.roles.forEach((role,index)=>{role.address='0x'+(index+1).toString(16).repeat(64);});
  return result;
}
function accepted(sim,action,actor,extra={}){
  const before=JSON.stringify(sim),result=core.transition(sim,{action,actor,...extra});
  assert.equal(result.ok,true,`${action}: ${JSON.stringify(result.error)}`);
  assert.equal(result.error,null);assert.equal(JSON.stringify(sim),before,'successful calls never mutate the input simulation');
  return result.state;
}
function rejected(sim,command,code){
  const before=JSON.stringify(sim),result=core.transition(sim,command);
  assert.equal(result.ok,false,`reject ${command.action}`);assert.equal(result.error.code,code);
  assert.equal(result.state,sim,'rejection returns the original simulation object');
  assert.equal(JSON.stringify(sim),before,'rejection rolls back clock, stage, approvals and funds');
  assert.equal(result.events.length,0);
}
function invalid(project,code){
  const check=core.validate(project);assert.equal(check.valid,false);
  assert(check.errors.some(error=>error.code===code),`${code}: ${JSON.stringify(check.errors)}`);
  assert.throws(()=>core.generate(project),error=>error.code==='invalid_project');
}

assert(Object.isFrozen(core));assert(Object.isFrozen(core.templates));
assert.equal(core.defaultDraft().schema,'nodus-contract-studio/v2');
assert.equal(core.defaultDraft('custom').states[0].id,'start');
assert.throws(()=>core.defaultDraft('unrecognised'),error=>error.code==='template');
assert(core.inspect(core.defaultDraft()).valid,'blank role addresses are valid incomplete drafts');
invalid(core.defaultDraft(),'role_address');
assert(core.validate(draft()).valid);
assert(core.validate(draft('approval')).valid);
assert(core.inspect(core.defaultDraft('blank')).valid);
invalid(draft('blank'),'transitions_missing');
assert.equal(core.parseNodusAmount('0.00000001').wei,'10000000000');
assert.equal(core.parseNodusAmount('184467440737.09551615').raw,'18446744073709551615');
for(const value of ['0','-1','1e2','1.000000001','01',' 1','1\n',1,null])assert.throws(()=>core.parseNodusAmount(value));

// Schema shape, bounded data and untrusted labels/identifiers.
for(const json of ['','{','null','[]','{"schema":"evil"}',' '.repeat(core.MAX_PROJECT_LENGTH+1)])assert.throws(()=>core.importProject(json));
assert.throws(()=>core.importProject('é'.repeat(40000)),error=>error.code==='project_too_large','the file bound counts UTF-8 bytes, matching browser file.size');
assert.throws(()=>core.importProject(legacy.exportProject(legacy.defaultDraft())),'v1 is never silently migrated');
const roundTrip=core.exportProject(core.defaultDraft());
assert.equal(core.exportProject(core.importProject(roundTrip)),roundTrip);
let project=draft();project.untrustedSource='selfdestruct(msg.sender)';invalid(project,'unexpected_field');
project=draft();project.roles[0].id='constructor';invalid(project,'role_id');
project=draft();project.roles[0].id='outsider';invalid(project,'role_id');
project=draft();project.transitions[0].id='advanceTime';invalid(project,'transition_id');
project=draft();project.roles[1].address=project.roles[0].address.toUpperCase().replace('0X','0x');invalid(project,'duplicate_address');
project=draft();project.roles[0].address='0x'+'1'.repeat(40);invalid(project,'role_address');
project=draft();project.roles[0].address=zeroHash;invalid(project,'role_address');
project=draft();project.states[1].id=project.states[0].id;invalid(project,'duplicate_id');
project=draft();project.states[0].initial=false;invalid(project,'initial_state');
project=draft();project.states[1].initial=true;invalid(project,'initial_state');
project=draft();project.states[0].terminal=true;invalid(project,'terminal_outgoing');
project=draft();project.states.push({id:'unreachable',label:'Unreachable',initial:false,terminal:true,x:20,y:20});invalid(project,'unreachable_state');
project=draft();project.states[0].x=Infinity;invalid(project,'node_position');
project=draft();project.states[0].label='newline\nlabel';invalid(project,'label');
project=draft();project.transitions[0].from='missing';assert(core.inspect(project).valid,'unfinished graph references may be saved');invalid(project,'state_reference');
project=draft();project.transitions[0].amountNodus='';assert(core.inspect(project).valid);invalid(project,'amount');
project=draft();project.transitions[0].operation='arbitraryCall';invalid(project,'operation');
project=draft();project.transitions[0].recipient='seller';invalid(project,'unused_field');
project=draft();project.transitions[0].guard.mode='xor';invalid(project,'guard_mode');
project=draft();project.transitions[0].guard.conditions=[{type:'oracleSaysDelivered',value:'yes'}];invalid(project,'condition_type');
project=draft();project.transitions[0].guard.conditions=Array.from({length:9},()=>({type:'beforeDeadline',value:''}));invalid(project,'limit');
project=draft();project.roles=Array.from({length:9},(_,index)=>({id:`role${index}`,label:'Role',address:''}));invalid(project,'limit');
project=draft();project.config.deadline='2030-02-30T00:00:00Z';invalid(project,'deadline');
project=draft();project.transitions[0].guard.conditions=[{type:'hashEquals',value:'0x1234'}];invalid(project,'condition_value');

// Generated functions are deterministic, isolated from labels and 32-byte safe.
project=draft();
const source=core.generate(project), actions=core.describeActions(project);
assert.match(source,/contract ObservatoryWorkflow/);
assert.match(source,/pragma solidity =0\.8\.30;/);
assert.match(source,/address\(uint256\(0x1{64}\)\)/);
assert.match(source,/deadline = 1893456000;/);
assert.match(source,/receive\(\) external payable \{ revert UnexpectedPayment\(\); \}/);
assert.equal(actions.length,project.transitions.length);
assert.equal(actions[0].functionName,'action_0');
const permuted=clone(project);permuted.roles.reverse();permuted.states.reverse();permuted.transitions.reverse();permuted.states[0].x=123;
assert.equal(core.generate(permuted),source,'layout and collection order do not change the executable contract');
const hostileLabel=clone(project);hostileLabel.states[0].label='*/ selfdestruct(msg.sender); /*';hostileLabel.transitions[0].label='<img src=x onerror=alert(1)>';
assert.equal(core.generate(hostileLabel),source,'labels never enter executable source or comments');
const rewired=clone(project);rewired.transitions.find(item=>item.id==='approve').to='funded';
rewired.transitions=rewired.transitions.filter(item=>item.id!=='withdraw');rewired.states=rewired.states.filter(item=>!['approved','paid'].includes(item.id));
assert(core.validate(rewired).valid);assert.notEqual(core.generate(rewired),source,'editing actual graph edges changes executable source');
const transferFunction=source.slice(source.indexOf('        balanceWei -='));
assert(transferFunction.indexOf('totalPaidWei +=')<transferFunction.indexOf('.call{value:'),'effects precede external transfers');
assert.match(source,/if \(entered\) revert Reentrancy\(\);/);
assert.match(source,/if \(!success\) revert TransferFailed\(\);/);
for(const match of source.matchAll(/function action_\d+\([^)]*\) external nonReentrant \{([\s\S]*?)\n    \}/g))assert(!match[1].includes('msg.value'),'Solidity nonpayable external functions never reference msg.value');

// Original escrow semantics, precise boundary and financial conservation.
let sim=core.createSimulation(project,deadline-2);
rejected(sim,{action:'deposit',actor:'outsider'},'unauthorized');
rejected(sim,{action:'approve',actor:'buyer'},'invalid_state');
rejected(sim,{action:'deposit',actor:'buyer',valueWei:'1'},'incorrect_value');
rejected(sim,{action:'deposit',actor:'buyer',nowSeconds:deadline},'guard_failed');
sim=accepted(sim,'deposit','buyer');
assert.equal(sim.balanceWei,'100000000000000000000');assert.equal(sim.totalDepositedWei,sim.balanceWei);
rejected(sim,{action:'approve',actor:'buyer',nowSeconds:deadline},'guard_failed');
rejected(sim,{action:'refund',actor:'buyer'},'guard_failed');
sim=accepted(sim,'approve','buyer',{nowSeconds:deadline-1});
rejected(sim,{action:'withdraw',actor:'buyer'},'unauthorized');
rejected(sim,{action:'refund',actor:'buyer',nowSeconds:deadline},'invalid_state');
rejected(sim,{action:'withdraw',actor:'seller',nowSeconds:deadline+100,paymentSucceeds:false},'transfer_failed');
sim=accepted(sim,'withdraw','seller',{nowSeconds:deadline+100});
assert.equal(sim.stage,'paid');assert.equal(sim.balanceWei,'0');assert.equal(sim.payouts.seller,sim.totalDepositedWei);
rejected(sim,{action:'withdraw',actor:'seller'},'invalid_state');
let refund=accepted(core.createSimulation(project,deadline-1),'deposit','buyer');
refund=accepted(refund,'refund','buyer',{nowSeconds:deadline});
assert.equal(refund.payouts.buyer,refund.totalDepositedWei);assert.equal(refund.stage,'refunded');
let cancel=accepted(core.createSimulation(project,deadline+10),'cancel','buyer');assert.equal(cancel.stage,'cancelled');

// OR guards cannot bypass authentication, exact value or sufficient balance.
const permissive=draft();permissive.transitions.find(item=>item.id==='deposit').guard={mode:'any',conditions:[{type:'beforeDeadline',value:''},{type:'afterDeadline',value:''}]};
let orSim=core.createSimulation(permissive,deadline);
rejected(orSim,{action:'deposit',actor:'seller'},'unauthorized');
rejected(orSim,{action:'deposit',actor:'buyer',valueWei:'0'},'incorrect_value');
orSim=accepted(orSim,'deposit','buyer');assert.equal(orSim.stage,'funded');
const tooMuch=draft();tooMuch.transitions.find(item=>item.id==='withdraw').amountNodus='101';
tooMuch.transitions.find(item=>item.id==='withdraw').guard={mode:'any',conditions:[{type:'beforeDeadline',value:''},{type:'afterDeadline',value:''}]};
let poor=accepted(core.createSimulation(tooMuch,deadline-10),'deposit','buyer');poor=accepted(poor,'approve','buyer');
rejected(poor,{action:'withdraw',actor:'seller'},'insufficient_balance');
const andProject=draft();andProject.transitions.find(item=>item.id==='deposit').guard.conditions.push({type:'afterDeadline',value:''});
rejected(core.createSimulation(andProject,deadline-10),{action:'deposit',actor:'buyer'},'guard_failed');
const emptyAny=draft();emptyAny.transitions.find(item=>item.id==='deposit').guard={mode:'any',conditions:[]};
assert.equal(accepted(core.createSimulation(emptyAny,deadline),'deposit','buyer').stage,'funded','an empty guard is unconditional under either mode');

// Two distinct authorised reviewers, one global approval per role and one round.
const approvals=draft('approval');
let review=core.createSimulation(approvals,deadline);
rejected(review,{action:'complete',actor:'outsider'},'guard_failed');
rejected(review,{action:'approve1',actor:'reviewer2'},'unauthorized');
review=accepted(review,'approve1','reviewer1');
rejected(review,{action:'approve1',actor:'reviewer1'},'already_approved');
rejected(review,{action:'complete',actor:'outsider'},'guard_failed');
review=accepted(review,'approve2','reviewer2');review=accepted(review,'complete','outsider');
assert.equal(review.stage,'approved');assert.equal(review.approvals.length,2);
const byRole=draft('approval');byRole.transitions.find(item=>item.id==='complete').guard.conditions=[{type:'approvedBy',value:'reviewer1'}];
let oneReview=accepted(core.createSimulation(byRole,deadline),'approve1','reviewer1');
oneReview=accepted(oneReview,'complete','outsider');assert.equal(oneReview.approvals.length,1);
const anyoneApproval=draft('approval');anyoneApproval.transitions[0].caller='anyone';invalid(anyoneApproval,'explicit_caller');

// Hash recording is an authorised attestation. Equality does not verify a file.
const evidence=draft('approval');evidence.transitions=[
  {id:'record',label:'Record hash',from:'review',to:'review',caller:'reviewer1',operation:'recordHash',recipient:'',amountNodus:'',guard:{mode:'all',conditions:[]}},
  {id:'complete',label:'Complete',from:'review',to:'approved',caller:'anyone',operation:'move',recipient:'',amountNodus:'',guard:{mode:'all',conditions:[{type:'hashEquals',value:hash}]}},
];
let proof=core.createSimulation(evidence,deadline);
rejected(proof,{action:'record',actor:'reviewer2',evidenceHash:hash},'unauthorized');
for(const value of [undefined,zeroHash,'0x1234',hash+'\n'])rejected(proof,{action:'record',actor:'reviewer1',evidenceHash:value},'invalid_evidence');
rejected(proof,{action:'record',actor:'reviewer1',evidenceHash:hash,valueWei:'1'},'unexpected_value');
rejected(proof,{action:'complete',actor:'outsider'},'guard_failed');
proof=accepted(proof,'record','reviewer1',{evidenceHash:hash.toUpperCase().replace('0X','0x')});
assert.equal(proof.evidenceHash,hash);proof=accepted(proof,'complete','outsider');assert.equal(proof.stage,'approved');
assert.match(core.generate(evidence),/function action_1\(bytes32 evidence\)/);
const noEvidence=clone(evidence);noEvidence.transitions.find(item=>item.id==='complete').guard.conditions[0].value=zeroHash;
assert.equal(accepted(core.createSimulation(noEvidence,deadline),'complete','outsider').stage,'approved','zero expected hash explicitly matches no recorded evidence');

// Accounted balance predicates and hostile simulation states.
const balanceProject=draft();balanceProject.transitions.find(item=>item.id==='approve').guard.conditions=[{type:'balanceAtLeast',value:'100'}];
const balanceSim=accepted(core.createSimulation(balanceProject,deadline-10),'deposit','buyer');
assert.equal(accepted(balanceSim,'approve','buyer').stage,'approved');
const invalidBalance=clone(balanceSim);invalidBalance.balanceWei='0';rejected(invalidBalance,{action:'approve',actor:'buyer'},'invalid_simulation');
const invalidUnits=clone(balanceSim);invalidUnits.balanceWei='1';invalidUnits.totalDepositedWei='1';rejected(invalidUnits,{action:'approve',actor:'buyer'},'invalid_simulation');
const badPayout=clone(balanceSim);badPayout.payouts.outsider='0';rejected(badPayout,{action:'approve',actor:'buyer'},'invalid_simulation');
const duplicateVotes=clone(balanceSim);duplicateVotes.approvals=['buyer','buyer'];rejected(duplicateVotes,{action:'approve',actor:'buyer'},'invalid_simulation');
rejected(balanceSim,{action:'approve',actor:'buyer',nowSeconds:deadline-11},'simulation_time');
rejected(balanceSim,{action:'approve',actor:'buyer',valueWei:'1'},'unexpected_value');
rejected(balanceSim,{action:'approve',actor:'missing'},'simulation_actor');
rejected(balanceSim,{action:'approve',actor:'buyer',arbitrarySource:'code'},'simulation_command');
assert.equal(accepted(balanceSim,'advanceTime',undefined,{nowSeconds:deadline+1}).nowSeconds,deadline+1);

// Cyclic workflows and fixed partial payouts account for actual credited funds.
const cyclic=draft();cyclic.states=[{id:'open',label:'Open',initial:true,terminal:false,x:0,y:0}];
cyclic.transitions=[
  {id:'deposit',label:'Deposit two',from:'open',to:'open',caller:'buyer',operation:'deposit',recipient:'',amountNodus:'2',guard:{mode:'all',conditions:[]}},
  {id:'pay',label:'Pay one',from:'open',to:'open',caller:'buyer',operation:'transfer',recipient:'seller',amountNodus:'1',guard:{mode:'all',conditions:[]}},
];
let rolling=core.createSimulation(cyclic,deadline);
rolling=accepted(rolling,'deposit','buyer');rolling=accepted(rolling,'deposit','buyer');
assert.equal(rolling.totalDepositedWei,'4000000000000000000');
for(let count=0;count<4;count++)rolling=accepted(rolling,'pay','buyer');
assert.equal(rolling.balanceWei,'0');assert.equal(rolling.payouts.seller,rolling.totalDepositedWei);
rejected(rolling,{action:'pay',actor:'buyer'},'insufficient_balance');
const forged=clone(rolling);forged.extraField='untrusted';rejected(forged,{action:'deposit',actor:'buyer'},'invalid_simulation');

// Explicit v1 conversion preserves the canonical agreement and layout only.
const old=legacy.defaultDraft();old.config={buyer:'0x'+'1'.repeat(64),seller:'0x'+'2'.repeat(64),amountNodus:'1234.56789012',deadline:'2030-01-01T00:00:00Z'};
old.nodes[0].x=123.25;
const converted=core.convertV1(old);
assert(core.validate(converted).valid);assert.equal(converted.states.find(item=>item.id==='created').x,123.25);
assert.equal(converted.transitions.find(item=>item.id==='deposit').amountNodus,'1234.56789012');
assert.equal(converted.roles.find(item=>item.id==='buyer').address,old.config.buyer);
let convertedSim=accepted(core.createSimulation(converted,deadline-10),'deposit','buyer');convertedSim=accepted(convertedSim,'approve','buyer');convertedSim=accepted(convertedSim,'withdraw','seller');
assert.equal(convertedSim.payouts.seller,'1234567890120000000000');
assert(core.inspect(core.convertV1(legacy.defaultDraft())).valid,'canonical v1 with blank addresses converts to an incomplete v2 draft');
const missing=clone(old);missing.nodes=missing.nodes.filter(item=>item.type!=='paid');
assert.throws(()=>core.convertV1(missing),error=>error.code==='invalid_project','incomplete v1 graph is never silently repaired');
const unusualBlank=clone(old);unusualBlank.config.buyer='';unusualBlank.config.seller='0x'+'1'.repeat(64);
assert(core.inspect(core.convertV1(unusualBlank)).valid,'validation placeholders do not collide with a real party address');
console.log('Contract Studio workflow core: v2 schema, v1 conversion, graph semantics, exact money, roles, AND/OR guards, deadline boundaries, quorum, hashes, atomic rejection and hostile inputs PASS.');
