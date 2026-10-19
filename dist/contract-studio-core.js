/* Contract Studio: a deliberately small, deterministic escrow language.
 * Local authoring/simulation only. This module never connects to a wallet or node.
 * Nodus native ledger units use 8 decimals; Nodus EVM values use 18 decimals.
 */
(() => {
  'use strict';

  const SCHEMA = 'nodus-contract-studio/v1';
  const SIMULATION_SCHEMA = 'nodus-contract-studio/simulation-v1';
  const TYPES = Object.freeze(['created', 'funded', 'approved', 'paid', 'refunded', 'cancelled']);
  const CANONICAL_EDGES = Object.freeze([
    Object.freeze({ from: 'created', to: 'funded' }),
    Object.freeze({ from: 'created', to: 'cancelled' }),
    Object.freeze({ from: 'funded', to: 'approved' }),
    Object.freeze({ from: 'funded', to: 'refunded' }),
    Object.freeze({ from: 'approved', to: 'paid' }),
  ]);
  const MAX_PROJECT_LENGTH = 65536;
  const MAX_RAW = (1n << 64n) - 1n;
  const RAW_SCALE = 100000000n;
  const WEI_PER_RAW = 10000000000n;
  const MAX_SECONDS = 253402300799; // 9999-12-31T23:59:59Z, safely exact as a Number.
  // (?![\s\S]) is an absolute end anchor. JavaScript's $ also matches before
  // a final newline, which would accidentally accept whitespace in identifiers.
  const ADDRESS = /^0x[0-9a-fA-F]{64}(?![\s\S])/;
  const ID = /^[A-Za-z][A-Za-z0-9_-]{0,47}(?![\s\S])/;
  const ZERO_ADDRESS = `0x${'0'.repeat(64)}`;
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const clone = value => JSON.parse(JSON.stringify(value));

  function failure(code, errors) {
    const error = new Error(code);
    error.code = code;
    if (errors) error.errors = errors;
    return error;
  }

  function parseNodusAmount(value) {
    // No signs, exponents, whitespace, locale separators or precision-losing Number input.
    if (typeof value !== 'string' || value.length > 32 || !/^(0|[1-9][0-9]*)(?:\.[0-9]{1,8})?(?![\s\S])/.test(value)) {
      throw failure('amount');
    }
    const [whole, fraction = ''] = value.split('.');
    const raw = BigInt(whole) * RAW_SCALE + BigInt(fraction.padEnd(8, '0'));
    if (raw <= 0n || raw > MAX_RAW) throw failure('amount');
    return { raw: raw.toString(), wei: (raw * WEI_PER_RAW).toString() };
  }

  function parseDeadline(value) {
    if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z(?![\s\S])/.test(value)) return null;
    const millis = Date.parse(value);
    if (!Number.isFinite(millis) || millis < 0 || millis / 1000 > MAX_SECONDS) return null;
    // Date.parse normalizes invalid days such as February 30; reject them explicitly.
    if (new Date(millis).toISOString() !== value.replace('Z', '.000Z')) return null;
    return millis / 1000;
  }

  function defaultDraft() {
    const deadline = new Date(Math.floor(Date.now() / 1000) * 1000 + 7 * 86400000).toISOString().replace('.000Z', 'Z');
    const positions = {
      created: [60, 100], funded: [310, 100], approved: [560, 100],
      paid: [810, 100], refunded: [560, 320], cancelled: [310, 320],
    };
    return {
      schema: SCHEMA,
      config: { buyer: '', seller: '', amountNodus: '100', deadline },
      nodes: TYPES.map(type => ({ id: type, type, x: positions[type][0], y: positions[type][1] })),
      edges: CANONICAL_EDGES.map(edge => ({ ...edge })),
    };
  }

  // Shape validation also governs JSON import/export. A draft may be incomplete, but
  // arbitrary fields/code and malformed values never become part of the language.
  function inspect(draft, complete) {
    const errors = [];
    const add = (code, field) => errors.push({ code, ...(field ? { field } : {}) });
    const keys = (object, allowed, field) => {
      for (const key of Object.keys(object)) {
        if (!allowed.includes(key)) add('unexpected_field', field ? `${field}.${key}` : key);
      }
      for (const key of allowed) {
        if (!own(object, key)) add('missing_field', field ? `${field}.${key}` : key);
      }
    };
    if (!isObject(draft)) return { valid: false, errors: [{ code: 'draft_type' }] };
    keys(draft, ['schema', 'config', 'nodes', 'edges'], '');
    if (draft.schema !== SCHEMA) add('schema', 'schema');
    if (!isObject(draft.config)) {
      add('config_type', 'config');
    } else {
      keys(draft.config, ['buyer', 'seller', 'amountNodus', 'deadline'], 'config');
      for (const party of ['buyer', 'seller']) {
        const value = draft.config[party];
        if (typeof value !== 'string' || (complete || value !== '') && (!ADDRESS.test(value) || value.toLowerCase() === ZERO_ADDRESS)) {
          add(`${party}_address`, `config.${party}`);
        }
      }
      if (typeof draft.config.buyer === 'string' && typeof draft.config.seller === 'string' && ADDRESS.test(draft.config.buyer) && ADDRESS.test(draft.config.seller) && draft.config.buyer.toLowerCase() === draft.config.seller.toLowerCase()) {
        add('same_parties', 'config.seller');
      }
      if (typeof draft.config.amountNodus !== 'string') add('amount', 'config.amountNodus');
      else if (complete || draft.config.amountNodus !== '') {
        try { parseNodusAmount(draft.config.amountNodus); } catch { add('amount', 'config.amountNodus'); }
      }
      if (typeof draft.config.deadline !== 'string' || (complete || draft.config.deadline !== '') && parseDeadline(draft.config.deadline) === null) {
        add('deadline', 'config.deadline');
      }
    }

    const byId = new Map();
    const byType = new Map();
    if (!Array.isArray(draft.nodes)) add('nodes_type', 'nodes');
    else if (draft.nodes.length > TYPES.length) add('node_limit', 'nodes');
    else Array.from(draft.nodes).forEach((node, index) => {
      const field = `nodes.${index}`;
      if (!isObject(node)) { add('node_shape', field); return; }
      keys(node, ['id', 'type', 'x', 'y'], field);
      if (typeof node.id !== 'string' || !ID.test(node.id)) add('node_id', `${field}.id`);
      if (!TYPES.includes(node.type)) add('node_type', `${field}.type`);
      if (!Number.isFinite(node.x) || !Number.isFinite(node.y) || Math.abs(node.x) > 10000 || Math.abs(node.y) > 10000) add('node_position', field);
      if (byId.has(node.id)) add('node_duplicate_id', `${field}.id`);
      if (byType.has(node.type)) add('node_duplicate_type', `${field}.type`);
      byId.set(node.id, node);
      byType.set(node.type, node);
    });
    if (complete) for (const type of TYPES) if (!byType.has(type)) add('node_missing', `nodes.${type}`);

    const pairs = new Set();
    const seenEdges = new Set();
    if (!Array.isArray(draft.edges)) add('edges_type', 'edges');
    else if (draft.edges.length > CANONICAL_EDGES.length) add('edge_limit', 'edges');
    else Array.from(draft.edges).forEach((edge, index) => {
      const field = `edges.${index}`;
      if (!isObject(edge)) { add('edge_shape', field); return; }
      keys(edge, ['from', 'to'], field);
      if (typeof edge.from !== 'string' || typeof edge.to !== 'string' || !ID.test(edge.from) || !ID.test(edge.to)) {
        add('edge_reference', field); return;
      }
      const pair = `${edge.from}>${edge.to}`;
      if (seenEdges.has(pair)) add('edge_duplicate', field);
      seenEdges.add(pair);
      if (!byId.has(edge.from) || !byId.has(edge.to)) { add('edge_reference', field); return; }
      const fromType = byId.get(edge.from).type;
      const toType = byId.get(edge.to).type;
      if (!CANONICAL_EDGES.some(item => item.from === fromType && item.to === toType)) add('edge_unsupported', field);
      else pairs.add(`${fromType}>${toType}`);
    });
    if (complete) for (const edge of CANONICAL_EDGES) {
      if (!pairs.has(`${edge.from}>${edge.to}`)) add('edge_missing', `edges.${edge.from}>${edge.to}`);
    }
    return { valid: errors.length === 0, errors };
  }

  const validate = draft => inspect(draft, true);

  function normalizedDraft(draft) {
    return {
      schema: SCHEMA,
      config: {
        buyer: draft.config.buyer.toLowerCase(), seller: draft.config.seller.toLowerCase(),
        amountNodus: draft.config.amountNodus, deadline: draft.config.deadline,
      },
      nodes: draft.nodes.map(node => ({ id: node.id, type: node.type, x: node.x, y: node.y })),
      edges: draft.edges.map(edge => ({ from: edge.from, to: edge.to })),
    };
  }

  function exportProject(draft) {
    const result = inspect(draft, false);
    if (!result.valid) throw failure('invalid_project', result.errors);
    const output = JSON.stringify(normalizedDraft(draft), null, 2) + '\n';
    if (output.length > MAX_PROJECT_LENGTH) throw failure('project_too_large');
    return output;
  }

  function importProject(json) {
    if (typeof json !== 'string') throw failure('malformed_json');
    if (json.length > MAX_PROJECT_LENGTH) throw failure('project_too_large');
    let draft;
    try { draft = JSON.parse(json); } catch { throw failure('malformed_json'); }
    const result = inspect(draft, false);
    if (!result.valid) throw failure('invalid_project', result.errors);
    return normalizedDraft(draft);
  }

  function generate(draft) {
    const result = validate(draft);
    if (!result.valid) throw failure('invalid_project', result.errors);
    const { wei } = parseNodusAmount(draft.config.amountNodus);
    const buyer = draft.config.buyer.toLowerCase();
    const seller = draft.config.seller.toLowerCase();
    const deadline = parseDeadline(draft.config.deadline);
    return `// SPDX-License-Identifier: MIT
// Generated by Nodus Observatory Contract Studio, escrow template v1.
// Requires the Nodus Solidity compiler (32-byte addresses). NOT stock solc.
// EVM values use 18 decimals; native NODUS values use 8 decimals.
// A deadline permits a transaction; it does not execute a transaction automatically.
pragma solidity =0.8.30;

contract ObservatoryEscrow {
    enum Stage { Created, Funded, Approved, Paid, Refunded, Cancelled }
    address payable public constant buyer = payable(address(uint256(${buyer})));
    address payable public constant seller = payable(address(uint256(${seller})));
    uint256 public constant amountWei = ${wei};
    uint256 public constant deadline = ${deadline};
    Stage public stage = Stage.Created;
    bool private entered;

    error Unauthorized();
    error InvalidState();
    error DeadlinePassed();
    error DeadlineNotReached();
    error IncorrectValue();
    error TransferFailed();
    error Reentrancy();
    error UnexpectedPayment();

    event Deposited(address indexed buyer, uint256 amountWei);
    event DeliveryApproved(address indexed buyer);
    event Paid(address indexed seller, uint256 amountWei);
    event Refunded(address indexed buyer, uint256 amountWei);
    event Cancelled(address indexed buyer);

    modifier onlyBuyer() {
        if (msg.sender != buyer) revert Unauthorized();
        _;
    }

    modifier nonReentrant() {
        if (entered) revert Reentrancy();
        entered = true;
        _;
        entered = false;
    }

    function deposit() external payable onlyBuyer nonReentrant {
        if (stage != Stage.Created) revert InvalidState();
        if (block.timestamp >= deadline) revert DeadlinePassed();
        if (msg.value != amountWei) revert IncorrectValue();
        stage = Stage.Funded;
        emit Deposited(msg.sender, msg.value);
    }

    function approve() external onlyBuyer nonReentrant {
        if (stage != Stage.Funded) revert InvalidState();
        if (block.timestamp >= deadline) revert DeadlinePassed();
        stage = Stage.Approved;
        emit DeliveryApproved(msg.sender);
    }

    // Approval commits the payment: the seller may withdraw even after the deadline.
    function withdraw() external nonReentrant {
        if (msg.sender != seller) revert Unauthorized();
        if (stage != Stage.Approved) revert InvalidState();
        stage = Stage.Paid;
        (bool success, ) = seller.call{value: amountWei}("");
        if (!success) revert TransferFailed();
        emit Paid(seller, amountWei);
    }

    function refund() external onlyBuyer nonReentrant {
        if (stage != Stage.Funded) revert InvalidState();
        if (block.timestamp < deadline) revert DeadlineNotReached();
        stage = Stage.Refunded;
        (bool success, ) = buyer.call{value: amountWei}("");
        if (!success) revert TransferFailed();
        emit Refunded(buyer, amountWei);
    }

    function cancel() external onlyBuyer nonReentrant {
        if (stage != Stage.Created) revert InvalidState();
        stage = Stage.Cancelled;
        emit Cancelled(msg.sender);
    }

    receive() external payable { revert UnexpectedPayment(); }
    fallback() external payable { revert UnexpectedPayment(); }
}
`;
  }

  const validSeconds = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_SECONDS;

  function createSimulation(draft, nowSeconds = Math.floor(Date.now() / 1000)) {
    const result = validate(draft);
    if (!result.valid) throw failure('invalid_project', result.errors);
    if (!validSeconds(nowSeconds)) throw failure('simulation_time');
    const amount = parseNodusAmount(draft.config.amountNodus);
    return {
      schema: SIMULATION_SCHEMA, stage: 'created', nowSeconds,
      deadlineSeconds: parseDeadline(draft.config.deadline),
      amountRaw: amount.raw, amountWei: amount.wei, balanceWei: '0',
      payouts: { buyerWei: '0', sellerWei: '0' },
      config: { buyer: draft.config.buyer.toLowerCase(), seller: draft.config.seller.toLowerCase() },
    };
  }

  function validSimulation(sim) {
    if (!isObject(sim) || sim.schema !== SIMULATION_SCHEMA || !TYPES.includes(sim.stage) || !validSeconds(sim.nowSeconds) || !validSeconds(sim.deadlineSeconds)) return false;
    if (!isObject(sim.payouts) || !isObject(sim.config) || typeof sim.config.buyer !== 'string' || typeof sim.config.seller !== 'string' || !ADDRESS.test(sim.config.buyer) || !ADDRESS.test(sim.config.seller)) return false;
    if (sim.config.buyer.toLowerCase() === ZERO_ADDRESS || sim.config.seller.toLowerCase() === ZERO_ADDRESS || sim.config.buyer.toLowerCase() === sim.config.seller.toLowerCase()) return false;
    for (const value of [sim.amountRaw, sim.amountWei, sim.balanceWei, sim.payouts.buyerWei, sim.payouts.sellerWei]) {
      if (typeof value !== 'string' || value.length > 80 || !/^(0|[1-9][0-9]*)(?![\s\S])/.test(value)) return false;
    }
    const amount = BigInt(sim.amountRaw);
    if (amount <= 0n || amount > MAX_RAW || BigInt(sim.amountWei) !== amount * WEI_PER_RAW) return false;
    // Never accept a hand-edited simulation with invented funds or payouts.
    const funded = ['funded', 'approved'].includes(sim.stage);
    return BigInt(sim.balanceWei) === (funded ? BigInt(sim.amountWei) : 0n) &&
      BigInt(sim.payouts.buyerWei) === (sim.stage === 'refunded' ? BigInt(sim.amountWei) : 0n) &&
      BigInt(sim.payouts.sellerWei) === (sim.stage === 'paid' ? BigInt(sim.amountWei) : 0n);
  }

  function transition(sim, command) {
    const reject = code => ({ ok: false, state: sim, events: [], error: { code } });
    if (!validSimulation(sim)) return reject('invalid_simulation');
    if (!isObject(command)) return reject('simulation_command');
    if (Object.keys(command).some(key => !['action', 'actor', 'valueWei', 'nowSeconds', 'paymentSucceeds'].includes(key))) return reject('simulation_command');
    if (!['deposit', 'approve', 'withdraw', 'refund', 'cancel', 'advanceTime'].includes(command.action)) return reject('simulation_action');
    if (command.actor !== undefined && !['buyer', 'seller', 'outsider'].includes(command.actor)) return reject('simulation_actor');
    if (command.action !== 'advanceTime' && command.actor === undefined) return reject('simulation_actor');
    if (command.paymentSucceeds !== undefined && typeof command.paymentSucceeds !== 'boolean') return reject('simulation_command');
    const now = command.nowSeconds === undefined ? sim.nowSeconds : command.nowSeconds;
    if (!validSeconds(now) || now < sim.nowSeconds) return reject('simulation_time');
    const next = clone(sim);
    next.nowSeconds = now;
    if (command.action === 'advanceTime') {
      if (command.nowSeconds === undefined || command.valueWei !== undefined || command.paymentSucceeds !== undefined) return reject('simulation_command');
      return { ok: true, state: next, events: [{ type: 'time_advanced', nowSeconds: now }], error: null };
    }
    // Nonpayable Solidity entry points accept an explicit zero transaction value.
    if (command.valueWei !== undefined && command.action !== 'deposit' && command.valueWei !== '0') return reject('unexpected_value');
    const requiredActor = command.action === 'withdraw' ? 'seller' : 'buyer';
    if (command.actor !== requiredActor) return reject('unauthorized');
    const expectedStage = { deposit: 'created', approve: 'funded', withdraw: 'approved', refund: 'funded', cancel: 'created' }[command.action];
    if (sim.stage !== expectedStage) return reject('invalid_state');
    if (['deposit', 'approve'].includes(command.action) && now >= sim.deadlineSeconds) return reject('deadline_passed');
    if (command.action === 'refund' && now < sim.deadlineSeconds) return reject('deadline_not_reached');
    if (command.action === 'deposit') {
      const value = command.valueWei === undefined ? sim.amountWei : command.valueWei;
      if (typeof value !== 'string' || value.length > 80 || !/^(0|[1-9][0-9]*)(?![\s\S])/.test(value) || BigInt(value) !== BigInt(sim.amountWei)) return reject('incorrect_value');
      next.stage = 'funded';
      next.balanceWei = sim.amountWei;
    } else if (command.action === 'approve') next.stage = 'approved';
    else if (command.action === 'cancel') next.stage = 'cancelled';
    else {
      if (command.paymentSucceeds === false) return reject('transfer_failed');
      next.stage = command.action === 'withdraw' ? 'paid' : 'refunded';
      next.balanceWei = '0';
      next.payouts[command.action === 'withdraw' ? 'sellerWei' : 'buyerWei'] = sim.amountWei;
    }
    return {
      ok: true, state: next,
      events: [{ type: next.stage, actor: command.actor, nowSeconds: now,
        ...(['funded', 'paid', 'refunded'].includes(next.stage) ? { amountWei: sim.amountWei } : {}) }],
      error: null,
    };
  }

  globalThis.NodusStudioCore = Object.freeze({
    SCHEMA, TYPES, CANONICAL_EDGES, MAX_PROJECT_LENGTH,
    defaultDraft, validate, generate, exportProject, importProject,
    parseNodusAmount, createSimulation, transition,
    createDefaultProject: defaultDraft, validateProject: validate, generateSource: generate,
  });
})();
