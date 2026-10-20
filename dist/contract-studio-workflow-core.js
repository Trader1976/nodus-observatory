/* Declarative Contract Studio v2. Browser-local authoring and simulation only.
 * All executable identifiers are generated; imported text is never source code.
 */
(() => {
  'use strict';
  const legacy = globalThis.NodusStudioCore;
  const SCHEMA = 'nodus-contract-studio/v2';
  const SIMULATION_SCHEMA = 'nodus-contract-studio/workflow-simulation-v2';
  const MAX_PROJECT_LENGTH = 65536;
  const MAX_SECONDS = 253402300799;
  const UINT256_MAX = (1n << 256n) - 1n;
  const LIMITS = Object.freeze({roles:8, states:24, transitions:48, conditions:8});
  const OPERATIONS = Object.freeze(['move', 'deposit', 'transfer', 'approve', 'recordHash']);
  const CONDITIONS = Object.freeze(['beforeDeadline', 'afterDeadline', 'balanceAtLeast', 'approvedBy', 'approvalCountAtLeast', 'hashEquals']);
  const templates = Object.freeze(['escrow', 'approval', 'blank']);
  const ADDRESS = /^0x[0-9a-fA-F]{64}(?![\s\S])/;
  const ID = /^[A-Za-z][A-Za-z0-9_-]{0,47}(?![\s\S])/;
  const ZERO_HASH = `0x${'0'.repeat(64)}`;
  const RESERVED = new Set(['anyone', 'outsider', 'advanceTime', 'constructor', 'prototype', '__proto__']);
  const own = (value,key) => Object.prototype.hasOwnProperty.call(value,key);
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const clone = value => JSON.parse(JSON.stringify(value));
  const validId = value => typeof value === 'string' && ID.test(value) && !RESERVED.has(value);
  const validLabel = value => typeof value === 'string' && value.length <= 100 && !/[\u0000-\u001f\u007f]/.test(value);
  const validSeconds = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_SECONDS;
  const uint = value => typeof value === 'string' && value.length <= 78 && /^(0|[1-9][0-9]*)(?![\s\S])/.test(value) && BigInt(value) <= UINT256_MAX;
  const ledgerUint = value => uint(value) && BigInt(value) % 10000000000n === 0n;
  const sorted = values => values.slice().sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const utf8Length = value => {
    let bytes=0;
    for(const character of value){const point=character.codePointAt(0);bytes+=point<=0x7f?1:point<=0x7ff?2:point<=0xffff?3:4;}
    return bytes;
  };

  function failure(code, errors) {
    const error = new Error(code); error.code = code;
    if (errors) error.errors = errors;
    return error;
  }
  function parseNodusAmount(value) {
    if (!legacy?.parseNodusAmount) throw failure('core_unavailable');
    return legacy.parseNodusAmount(value);
  }
  function parseDeadline(value) {
    if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z(?![\s\S])/.test(value)) return null;
    const millis = Date.parse(value);
    if (!Number.isFinite(millis) || !validSeconds(millis / 1000)) return null;
    return new Date(millis).toISOString() === value.replace('Z','.000Z') ? millis / 1000 : null;
  }
  function rule(id, label, from, to, caller, operation, options = {}) {
    return {id,label,from,to,caller,operation,recipient:options.recipient || '',amountNodus:options.amountNodus || '',
      guard:{mode:options.mode || 'all',conditions:options.conditions || []}};
  }
  function state(id,label,initial,terminal,x,y) { return {id,label,initial,terminal,x,y}; }
  function defaultDraft(template = 'escrow') {
    if (template === 'custom') template = 'blank';
    if (!templates.includes(template)) throw failure('template');
    const deadline = new Date(Math.floor(Date.now()/1000)*1000 + 7*86400000).toISOString().replace('.000Z','Z');
    const result = {schema:SCHEMA,config:{deadline},roles:[],states:[],transitions:[]};
    if (template === 'approval') {
      result.roles = [{id:'reviewer1',label:'Reviewer 1',address:''},{id:'reviewer2',label:'Reviewer 2',address:''}];
      result.states = [state('review','In review',true,false,80,100),state('approved','Approved',false,true,580,100)];
      result.transitions = [
        rule('approve1','First reviewer approval','review','review','reviewer1','approve'),
        rule('approve2','Second reviewer approval','review','review','reviewer2','approve'),
        rule('complete','Complete after two approvals','review','approved','anyone','move',{conditions:[{type:'approvalCountAtLeast',value:'2'}]}),
      ];
    } else if (template === 'blank') {
      result.roles = [{id:'owner',label:'Owner',address:''}];
      result.states = [state('start','Start',true,false,80,100)];
    } else {
      result.roles = [{id:'buyer',label:'Buyer',address:''},{id:'seller',label:'Seller',address:''}];
      result.states = [state('created','Created',true,false,60,100),state('funded','Funded',false,false,310,100),state('approved','Approved',false,false,560,100),state('paid','Paid',false,true,810,100),state('refunded','Refunded',false,true,560,320),state('cancelled','Cancelled',false,true,310,320)];
      result.transitions = [
        rule('deposit','Deposit','created','funded','buyer','deposit',{amountNodus:'100',conditions:[{type:'beforeDeadline',value:''}]}),
        rule('approve','Approve delivery','funded','approved','buyer','move',{conditions:[{type:'beforeDeadline',value:''}]}),
        rule('withdraw','Withdraw','approved','paid','seller','transfer',{recipient:'seller',amountNodus:'100'}),
        rule('refund','Refund','funded','refunded','buyer','transfer',{recipient:'buyer',amountNodus:'100',conditions:[{type:'afterDeadline',value:''}]}),
        rule('cancel','Cancel','created','cancelled','buyer','move'),
      ];
    }
    return result;
  }

  function inspect(draft, complete = false) {
    const errors = [], add = (code,field) => errors.push({code,...(field ? {field} : {})});
    const keys = (value,allowed,field) => {
      for (const key of Object.keys(value)) if (!allowed.includes(key)) add('unexpected_field',field ? `${field}.${key}` : key);
      for (const key of allowed) if (!own(value,key)) add('missing_field',field ? `${field}.${key}` : key);
    };
    const label = (value,field) => { if (!validLabel(value) || complete && !value.trim()) add('label',field); };
    const reference = (value,field) => { if (value !== '' && !validId(value) || typeof value !== 'string') add('reference',field); };
    const amount = (value,field) => {
      if (!complete && value === '') return;
      try { parseNodusAmount(value); } catch { add('amount',field); }
    };
    const list = (value,limit,field) => {
      if (!Array.isArray(value)) { add('list',field); return []; }
      if (value.length > limit) { add('limit',field); return []; }
      return Array.from(value);
    };
    if (!isObject(draft)) return {valid:false,errors:[{code:'draft_type'}]};
    keys(draft,['schema','config','roles','states','transitions'],'');
    if (draft.schema !== SCHEMA) add('schema','schema');
    if (!isObject(draft.config)) add('config_type','config');
    else {
      keys(draft.config,['deadline'],'config');
      if (typeof draft.config.deadline !== 'string' || (complete || draft.config.deadline !== '') && parseDeadline(draft.config.deadline) === null) add('deadline','config.deadline');
    }
    const roles = list(draft.roles,LIMITS.roles,'roles'), roleIds = new Set(), addresses = new Set();
    roles.forEach((role,index) => {
      const field = `roles.${index}`;
      if (!isObject(role)) { add('role_shape',field); return; }
      keys(role,['id','label','address'],field);
      if (!validId(role.id)) add('role_id',`${field}.id`);
      if (roleIds.has(role.id)) add('duplicate_id',`${field}.id`);
      roleIds.add(role.id); label(role.label,`${field}.label`);
      if (typeof role.address !== 'string' || (complete || role.address !== '') && (!ADDRESS.test(role.address) || role.address.toLowerCase() === ZERO_HASH)) add('role_address',`${field}.address`);
      if (typeof role.address === 'string' && role.address !== '') {
        const address = role.address.toLowerCase();
        if (addresses.has(address)) add('duplicate_address',`${field}.address`);
        addresses.add(address);
      }
    });
    const states = list(draft.states,LIMITS.states,'states'), stateIds = new Set();
    states.forEach((item,index) => {
      const field = `states.${index}`;
      if (!isObject(item)) { add('state_shape',field); return; }
      keys(item,['id','label','initial','terminal','x','y'],field);
      if (!validId(item.id)) add('state_id',`${field}.id`);
      if (stateIds.has(item.id)) add('duplicate_id',`${field}.id`);
      stateIds.add(item.id); label(item.label,`${field}.label`);
      if (typeof item.initial !== 'boolean' || typeof item.terminal !== 'boolean') add('state_flags',field);
      if (!Number.isFinite(item.x) || !Number.isFinite(item.y) || Math.abs(item.x)>10000 || Math.abs(item.y)>10000) add('node_position',field);
    });
    const transitions = list(draft.transitions,LIMITS.transitions,'transitions'), transitionIds = new Set();
    transitions.forEach((item,index) => {
      const field = `transitions.${index}`;
      if (!isObject(item)) { add('transition_shape',field); return; }
      keys(item,['id','label','from','to','caller','operation','recipient','amountNodus','guard'],field);
      if (!validId(item.id)) add('transition_id',`${field}.id`);
      if (transitionIds.has(item.id)) add('duplicate_id',`${field}.id`);
      transitionIds.add(item.id); label(item.label,`${field}.label`);
      for (const key of ['from','to','recipient']) reference(item[key],`${field}.${key}`);
      if (item.caller !== 'anyone') reference(item.caller,`${field}.caller`);
      if (!OPERATIONS.includes(item.operation)) add('operation',`${field}.operation`);
      if (typeof item.amountNodus !== 'string') add('amount',`${field}.amountNodus`);
      if (['deposit','transfer'].includes(item.operation)) amount(item.amountNodus,`${field}.amountNodus`);
      else if (item.amountNodus !== '') add('unused_field',`${field}.amountNodus`);
      if (item.operation !== 'transfer' && item.recipient !== '') add('unused_field',`${field}.recipient`);
      if (['approve','recordHash'].includes(item.operation) && item.caller === 'anyone') add('explicit_caller',`${field}.caller`);
      if (!isObject(item.guard)) { add('guard_shape',`${field}.guard`); return; }
      keys(item.guard,['mode','conditions'],`${field}.guard`);
      if (!['all','any'].includes(item.guard.mode)) add('guard_mode',`${field}.guard.mode`);
      const conditions = list(item.guard.conditions,LIMITS.conditions,`${field}.guard.conditions`);
      conditions.forEach((condition,ci) => {
        const cf = `${field}.guard.conditions.${ci}`;
        if (!isObject(condition)) { add('condition_shape',cf); return; }
        keys(condition,['type','value'],cf);
        if (!CONDITIONS.includes(condition.type)) add('condition_type',`${cf}.type`);
        if (typeof condition.value !== 'string') { add('condition_value',`${cf}.value`); return; }
        if (['beforeDeadline','afterDeadline'].includes(condition.type) && condition.value !== '') add('condition_value',`${cf}.value`);
        if (condition.type === 'balanceAtLeast') amount(condition.value,`${cf}.value`);
        if (condition.type === 'approvedBy') {
          reference(condition.value,`${cf}.value`);
          if (complete && !roleIds.has(condition.value)) add('role_reference',`${cf}.value`);
        }
        if (condition.type === 'approvalCountAtLeast' && !(condition.value === '' && !complete) && (!/^[1-8]$/.test(condition.value) || complete && Number(condition.value)>roles.length)) add('condition_value',`${cf}.value`);
        if (condition.type === 'hashEquals' && !(condition.value === '' && !complete) && !ADDRESS.test(condition.value)) add('condition_value',`${cf}.value`);
      });
      if (complete) {
        if (!stateIds.has(item.from)) add('state_reference',`${field}.from`);
        if (!stateIds.has(item.to)) add('state_reference',`${field}.to`);
        if (item.caller !== 'anyone' && !roleIds.has(item.caller)) add('role_reference',`${field}.caller`);
        if (item.operation === 'transfer' && !roleIds.has(item.recipient)) add('role_reference',`${field}.recipient`);
        if (states.some(state => state?.id === item.from && state.terminal)) add('terminal_outgoing',`${field}.from`);
      }
    });
    if (complete) {
      if (!roles.length) add('roles_missing','roles');
      const initial = states.filter(item=>item?.initial);
      if (initial.length !== 1) add('initial_state','states');
      if (!transitions.length) add('transitions_missing','transitions');
      if (initial.length === 1) {
        const reachable = new Set([initial[0].id]);
        for (let pass=0;pass<states.length;pass++) for (const item of transitions) if (item && reachable.has(item.from) && stateIds.has(item.to)) reachable.add(item.to);
        states.forEach((item,index)=>{if(item && !reachable.has(item.id))add('unreachable_state',`states.${index}`);});
      }
    }
    return {valid:errors.length===0,errors};
  }
  const validate = draft => inspect(draft,true);
  function normalized(draft) {
    return {schema:SCHEMA,config:{deadline:draft.config.deadline},
      roles:draft.roles.map(role=>({id:role.id,label:role.label,address:role.address.toLowerCase()})),
      states:draft.states.map(item=>({id:item.id,label:item.label,initial:item.initial,terminal:item.terminal,x:item.x,y:item.y})),
      transitions:draft.transitions.map(item=>({id:item.id,label:item.label,from:item.from,to:item.to,caller:item.caller,operation:item.operation,recipient:item.recipient,amountNodus:item.amountNodus,
        guard:{mode:item.guard.mode,conditions:item.guard.conditions.map(condition=>({type:condition.type,value:condition.type==='hashEquals'?condition.value.toLowerCase():condition.value}))}}))};
  }
  function exportProject(draft) {
    const check = inspect(draft);
    if (!check.valid) throw failure('invalid_project',check.errors);
    const json = JSON.stringify(normalized(draft),null,2)+'\n';
    if (utf8Length(json)>MAX_PROJECT_LENGTH) throw failure('project_too_large');
    return json;
  }
  function importProject(json) {
    if (typeof json !== 'string') throw failure('malformed_json');
    if (json.length>MAX_PROJECT_LENGTH||utf8Length(json)>MAX_PROJECT_LENGTH) throw failure('project_too_large');
    let draft;
    try { draft=JSON.parse(json); } catch { throw failure('malformed_json'); }
    const check = inspect(draft);
    if (!check.valid) throw failure('invalid_project',check.errors);
    return normalized(draft);
  }
  function describeActions(draft) {
    if (!Array.isArray(draft?.transitions)) return [];
    return sorted(draft.transitions.filter(item=>isObject(item)&&typeof item.id==='string')).map((item,index)=>({id:item.id,functionName:`action_${index}`,label:item.label}));
  }
  function generate(draft) {
    const check=validate(draft);
    if(!check.valid)throw failure('invalid_project',check.errors);
    const project=normalized(draft),roles=sorted(project.roles),states=sorted(project.states),actions=sorted(project.transitions);
    const roleIndex=new Map(roles.map((role,index)=>[role.id,index]));
    const stateIndex=new Map(states.map((item,index)=>[item.id,index]));
    const conditionCode=condition=>({
      beforeDeadline:()=>'(block.timestamp < deadline)',afterDeadline:()=>'(block.timestamp >= deadline)',
      balanceAtLeast:()=>`(balanceWei >= ${parseNodusAmount(condition.value).wei})`,
      approvedBy:()=>`approvedBy[role_${roleIndex.get(condition.value)}]`,
      approvalCountAtLeast:()=>`(approvalCount >= ${condition.value})`,
      hashEquals:()=>`(evidenceHash == bytes32(${condition.value}))`,
    }[condition.type]());
    const functions=actions.map((item,index)=>{
      const lines=[`    function action_${index}(${item.operation==='recordHash'?'bytes32 evidence':''}) external${item.operation==='deposit'?' payable':''} nonReentrant {`];
      if(item.caller!=='anyone')lines.push(`        if (msg.sender != role_${roleIndex.get(item.caller)}) revert Unauthorized();`);
      lines.push(`        if (stage != ${stateIndex.get(item.from)}) revert InvalidState();`);
      if(item.operation==='deposit')lines.push(`        if (msg.value != ${parseNodusAmount(item.amountNodus).wei}) revert IncorrectValue();`);
      if(item.operation==='transfer')lines.push(`        if (balanceWei < ${parseNodusAmount(item.amountNodus).wei}) revert InsufficientBalance();`);
      if(item.operation==='approve')lines.push('        if (approvedBy[msg.sender]) revert AlreadyApproved();');
      if(item.operation==='recordHash')lines.push('        if (evidence == bytes32(0)) revert InvalidEvidence();');
      if(item.guard.conditions.length)lines.push(`        if (!(${item.guard.conditions.map(conditionCode).join(item.guard.mode==='all'?' && ':' || ')})) revert GuardFailed();`);
      lines.push(`        stage = ${stateIndex.get(item.to)};`);
      if(item.operation==='deposit')lines.push('        balanceWei += msg.value;','        totalDepositedWei += msg.value;');
      if(item.operation==='transfer') {
        const amount=parseNodusAmount(item.amountNodus).wei, recipient=roleIndex.get(item.recipient);
        lines.push(`        balanceWei -= ${amount};`,`        payouts[role_${recipient}] += ${amount};`,`        totalPaidWei += ${amount};`,
          `        (bool success, ) = role_${recipient}.call{value: ${amount}}("");`,'        if (!success) revert TransferFailed();');
      }
      if(item.operation==='approve')lines.push('        approvedBy[msg.sender] = true;','        approvalCount += 1;','        emit ApprovalRecorded(msg.sender, approvalCount);');
      if(item.operation==='recordHash')lines.push('        evidenceHash = evidence;','        emit EvidenceRecorded(msg.sender, evidence);');
      lines.push(`        emit ActionExecuted(${index}, ${stateIndex.get(item.from)}, ${stateIndex.get(item.to)}, msg.sender, ${item.operation==='deposit'?'msg.value':'0'});`,'    }');
      return lines.join('\n');
    }).join('\n\n');
    return `// SPDX-License-Identifier: MIT
// Generated by Nodus Observatory Contract Studio, workflow schema v2.
// Requires the Nodus Solidity compiler with 32-byte addresses.
// Conditions are checked only when a transaction executes; there is no automatic timer.
// evidenceHash records an authorised caller's statement, not independent document verification.
pragma solidity =0.8.30;

contract ObservatoryWorkflow {
${roles.map((role,index)=>`    address payable public constant role_${index} = payable(address(uint256(${role.address})));`).join('\n')}
    uint256 public constant deadline = ${parseDeadline(project.config.deadline)};
    uint256 public stage = ${stateIndex.get(states.find(item=>item.initial).id)};
    uint256 public balanceWei;
    uint256 public totalDepositedWei;
    uint256 public totalPaidWei;
    mapping(address => uint256) public payouts;
    mapping(address => bool) public approvedBy;
    uint256 public approvalCount;
    bytes32 public evidenceHash;
    bool private entered;

    error Unauthorized();
    error InvalidState();
    error IncorrectValue();
    error InsufficientBalance();
    error GuardFailed();
    error AlreadyApproved();
    error InvalidEvidence();
    error TransferFailed();
    error Reentrancy();
    error UnexpectedPayment();

    event ActionExecuted(uint256 indexed action, uint256 fromState, uint256 toState, address indexed caller, uint256 valueWei);
    event ApprovalRecorded(address indexed caller, uint256 count);
    event EvidenceRecorded(address indexed caller, bytes32 evidence);

    modifier nonReentrant() {
        if (entered) revert Reentrancy();
        entered = true;
        _;
        entered = false;
    }

${functions}

    receive() external payable { revert UnexpectedPayment(); }
    fallback() external payable { revert UnexpectedPayment(); }
}
`;
  }

  function createSimulation(draft,nowSeconds=Math.floor(Date.now()/1000)) {
    const check=validate(draft);
    if(!check.valid)throw failure('invalid_project',check.errors);
    if(!validSeconds(nowSeconds))throw failure('simulation_time');
    const project=normalized(draft);
    return {schema:SIMULATION_SCHEMA,project,stage:project.states.find(item=>item.initial).id,nowSeconds,balanceWei:'0',totalDepositedWei:'0',
      payouts:Object.fromEntries(project.roles.map(role=>[role.id,'0'])),approvals:[],evidenceHash:ZERO_HASH};
  }
  function validSimulation(sim) {
    if(!isObject(sim)||sim.schema!==SIMULATION_SCHEMA||!validate(sim.project).valid||!validSeconds(sim.nowSeconds))return false;
    const fields=['schema','project','stage','nowSeconds','balanceWei','totalDepositedWei','payouts','approvals','evidenceHash'];
    if(Object.keys(sim).some(key=>!fields.includes(key))||fields.some(key=>!own(sim,key)))return false;
    if(!sim.project.states.some(item=>item.id===sim.stage)||!ledgerUint(sim.balanceWei)||!ledgerUint(sim.totalDepositedWei)||!isObject(sim.payouts))return false;
    const roleIds=new Set(sim.project.roles.map(role=>role.id));
    if(Object.keys(sim.payouts).length!==roleIds.size||Object.keys(sim.payouts).some(id=>!roleIds.has(id))||sim.project.roles.some(role=>!own(sim.payouts,role.id)||!ledgerUint(sim.payouts[role.id])))return false;
    if(!Array.isArray(sim.approvals)||sim.approvals.length>roleIds.size||new Set(sim.approvals).size!==sim.approvals.length||sim.approvals.some(id=>!roleIds.has(id)))return false;
    if(typeof sim.evidenceHash!=='string'||!ADDRESS.test(sim.evidenceHash))return false;
    const paid=Object.values(sim.payouts).reduce((sum,value)=>sum+BigInt(value),0n);
    return paid<=UINT256_MAX&&BigInt(sim.totalDepositedWei)===BigInt(sim.balanceWei)+paid;
  }
  function transition(sim,command) {
    const reject=code=>({ok:false,state:sim,events:[],error:{code}});
    if(!validSimulation(sim))return reject('invalid_simulation');
    if(!isObject(command)||Object.keys(command).some(key=>!['action','actor','valueWei','nowSeconds','paymentSucceeds','evidenceHash'].includes(key)))return reject('simulation_command');
    if(command.actor!==undefined&&command.actor!=='outsider'&&!sim.project.roles.some(role=>role.id===command.actor))return reject('simulation_actor');
    const now=command.nowSeconds===undefined?sim.nowSeconds:command.nowSeconds;
    if(!validSeconds(now)||now<sim.nowSeconds)return reject('simulation_time');
    if(command.action==='advanceTime') {
      if(command.nowSeconds===undefined||command.valueWei!==undefined||command.paymentSucceeds!==undefined||command.evidenceHash!==undefined)return reject('simulation_command');
      const next=clone(sim);next.nowSeconds=now;
      return {ok:true,state:next,events:[{type:'time_advanced',nowSeconds:now}],error:null};
    }
    const action=sim.project.transitions.find(item=>item.id===command.action);
    if(!action)return reject('simulation_action');
    if(command.actor===undefined)return reject('simulation_actor');
    if(command.paymentSucceeds!==undefined&&(typeof command.paymentSucceeds!=='boolean'||action.operation!=='transfer'))return reject('simulation_command');
    if(command.evidenceHash!==undefined&&action.operation!=='recordHash')return reject('simulation_command');
    if(action.operation!=='deposit'&&command.valueWei!==undefined&&command.valueWei!=='0')return reject('unexpected_value');
    if(action.caller!=='anyone'&&command.actor!==action.caller)return reject('unauthorized');
    if(sim.stage!==action.from)return reject('invalid_state');
    let amount=0n;
    if(['deposit','transfer'].includes(action.operation))amount=BigInt(parseNodusAmount(action.amountNodus).wei);
    if(action.operation==='deposit') {
      const value=command.valueWei===undefined?amount.toString():command.valueWei;
      if(!uint(value)||BigInt(value)!==amount)return reject('incorrect_value');
      if(BigInt(sim.balanceWei)+amount>UINT256_MAX||BigInt(sim.totalDepositedWei)+amount>UINT256_MAX)return reject('amount_overflow');
    }
    if(action.operation==='transfer'&&BigInt(sim.balanceWei)<amount)return reject('insufficient_balance');
    if(action.operation==='approve'&&sim.approvals.includes(command.actor))return reject('already_approved');
    if(action.operation==='recordHash'&&(typeof command.evidenceHash!=='string'||!ADDRESS.test(command.evidenceHash)||command.evidenceHash.toLowerCase()===ZERO_HASH))return reject('invalid_evidence');
    const evaluate=condition=>({
      beforeDeadline:()=>now<parseDeadline(sim.project.config.deadline),afterDeadline:()=>now>=parseDeadline(sim.project.config.deadline),
      balanceAtLeast:()=>BigInt(sim.balanceWei)>=BigInt(parseNodusAmount(condition.value).wei),
      approvedBy:()=>sim.approvals.includes(condition.value),approvalCountAtLeast:()=>sim.approvals.length>=Number(condition.value),
      hashEquals:()=>sim.evidenceHash.toLowerCase()===condition.value.toLowerCase(),
    }[condition.type]());
    const conditions=action.guard.conditions;
    if(conditions.length&&!(action.guard.mode==='all'?conditions.every(evaluate):conditions.some(evaluate)))return reject('guard_failed');
    if(action.operation==='transfer'&&command.paymentSucceeds===false)return reject('transfer_failed');
    const next=clone(sim);next.nowSeconds=now;next.stage=action.to;
    if(action.operation==='deposit') {
      next.balanceWei=(BigInt(sim.balanceWei)+amount).toString();
      next.totalDepositedWei=(BigInt(sim.totalDepositedWei)+amount).toString();
    }
    if(action.operation==='transfer') {
      next.balanceWei=(BigInt(sim.balanceWei)-amount).toString();
      next.payouts[action.recipient]=(BigInt(sim.payouts[action.recipient])+amount).toString();
    }
    if(action.operation==='approve')next.approvals.push(command.actor);
    if(action.operation==='recordHash')next.evidenceHash=command.evidenceHash.toLowerCase();
    return {ok:true,state:next,events:[{type:action.operation,action:action.id,actor:command.actor,from:sim.stage,to:next.stage,nowSeconds:now,
      ...(['deposit','transfer'].includes(action.operation)?{amountWei:amount.toString()}:{}),...(action.operation==='recordHash'?{evidenceHash:next.evidenceHash}:{})}],error:null};
  }
  function convertV1(draft) {
    if(draft?.schema!=='nodus-contract-studio/v1'||!legacy?.exportProject)throw failure('schema');
    const imported=legacy.importProject(legacy.exportProject(draft));
    // Permit blank required fields while still checking the exact canonical graph.
    const checked=clone(imported);
    for(const party of ['buyer','seller'])if(checked.config[party]===''){
      let digit=1;
      while(Object.values(checked.config).some(value=>typeof value==='string'&&value.toLowerCase()===`0x${digit.toString(16).repeat(64)}`))digit++;
      checked.config[party]=`0x${digit.toString(16).repeat(64)}`;
    }
    if(checked.config.amountNodus==='')checked.config.amountNodus='100';
    if(checked.config.deadline==='')checked.config.deadline='2030-01-01T00:00:00Z';
    const check=legacy.validate(checked);
    if(!check.valid)throw failure('invalid_project',check.errors);
    const result=defaultDraft('escrow');
    result.config.deadline=imported.config.deadline;
    result.roles[0].address=imported.config.buyer;result.roles[1].address=imported.config.seller;
    const labels={created:'Created',funded:'Funded',approved:'Approved',paid:'Paid',refunded:'Refunded',cancelled:'Cancelled'};
    result.states=imported.nodes.map(item=>state(item.type,labels[item.type],item.type==='created',['paid','refunded','cancelled'].includes(item.type),item.x,item.y));
    result.transitions.forEach(item=>{if(['deposit','transfer'].includes(item.operation))item.amountNodus=imported.config.amountNodus;});
    return normalized(result);
  }
  globalThis.NodusWorkflowCore=Object.freeze({SCHEMA,SIMULATION_SCHEMA,MAX_PROJECT_LENGTH,LIMITS,OPERATIONS,CONDITIONS,templates,
    defaultDraft,validate,inspect,exportProject,importProject,generate,createSimulation,transition,convertV1,describeActions,parseNodusAmount});
})();
