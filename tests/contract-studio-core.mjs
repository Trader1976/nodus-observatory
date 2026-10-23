/** Contract Studio language, exact-unit, and transaction boundary checks.
 * Run: node tests/contract-studio-core.mjs [dist-directory]
 * The simulator is a local model, not a substitute for execution by Nodus EVM.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const dist = path.resolve(process.argv[2] || path.join(import.meta.dirname, '../dist'));
const context = vm.createContext({ console, Date, BigInt, Number, JSON });
vm.runInContext(fs.readFileSync(path.join(dist, 'contract-studio-core.js'), 'utf8'), context);
const core = context.NodusStudioCore;
const copy = value => JSON.parse(JSON.stringify(value));
const buyer = `0x${'12'.repeat(32)}`;
const seller = `0x${'ab'.repeat(32)}`;
const deadline = Date.parse('2026-11-01T12:00:00Z') / 1000;
function draft() {
  const result = core.defaultDraft();
  result.config = { buyer, seller, amountNodus: '1234.56789012', deadline: '2026-11-01T12:00:00Z' };
  return result;
}
function hasError(project, code) {
  const result = core.validate(project);
  assert.equal(result.valid, false, `project rejected (${code})`);
  assert(result.errors.some(error => error.code === code), `specific error ${code}: ${JSON.stringify(result.errors)}`);
  assert.throws(() => core.generate(project), error => error.code === 'invalid_project');
}
function step(state, action, actor, extra = {}) {
  const before = JSON.stringify(state);
  const result = core.transition(state, { action, actor, ...extra });
  assert.equal(JSON.stringify(state), before, 'transitions never mutate their input');
  assert.equal(result.ok, true, `${action} succeeded: ${JSON.stringify(result.error)}`);
  assert.equal(result.error, null);
  return result.state;
}
function rejected(state, command, code) {
  const before = JSON.stringify(state);
  const result = core.transition(state, command);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, code);
  assert.equal(result.events.length, 0);
  assert.equal(JSON.stringify(result.state), before, 'failed transaction rolls back funds, state, and clock');
  assert.equal(JSON.stringify(state), before, 'failed transaction does not mutate original');
}

assert(Object.isFrozen(core));
const initial = core.defaultDraft();
assert.equal(initial.config.buyer, '', 'no usable actor address is invented for a new project');
assert.equal(initial.config.seller, '');
hasError(initial, 'buyer_address');
assert.equal(core.validate(draft()).valid, true);

// Eight native decimal places map exactly into eighteen EVM decimal places.
assert.equal(core.parseNodusAmount('0.00000001').raw, '1');
assert.equal(core.parseNodusAmount('0.00000001').wei, '10000000000');
assert.equal(core.parseNodusAmount('1').raw, '100000000');
assert.equal(core.parseNodusAmount('1').wei, '1000000000000000000');
assert.equal(core.parseNodusAmount('1234.56789012').raw, '123456789012');
assert.equal(core.parseNodusAmount('1234.56789012').wei, '1234567890120000000000');
assert.equal(core.parseNodusAmount('184467440737.09551615').raw, '18446744073709551615');
for (const amount of ['184467440737.09551616', '0', '0.00000000', '1.000000001', '1e3', '1E3', '-1', '+1', ' 1', '1 ', '1\n', '1\r', '01', '.5', '1.', '1,5', '１', '', 1, null, {}, '9'.repeat(10000)]) {
  assert.throws(() => core.parseNodusAmount(amount), error => error.code === 'amount', `invalid amount ${String(amount).slice(0, 30)}`);
}

// Calendar and address constraints prevent normalization surprises and code injection.
for (const value of ['2026-02-30T12:00:00Z', '2026-13-01T12:00:00Z', '2026-11-01T24:00:00Z', '2026-11-01', '2026-11-01T12:00:00+00:00', '2026-11-01T12:00:00.000Z', '1969-12-31T23:59:59Z', 'x; selfdestruct(buyer);']) {
  const project = draft(); project.config.deadline = value; hasError(project, 'deadline');
}
for (const address of [`0x${'12'.repeat(20)}`, `0x${'0'.repeat(64)}`, buyer + ';', buyer + '\n', 'constructor() {}', '', null]) {
  const project = draft(); project.config.buyer = address; hasError(project, 'buyer_address');
}
const same = draft(); same.config.seller = buyer.toUpperCase().replace('0X', '0x'); hasError(same, 'same_parties');

// Every visible supported state and edge is necessary for this exact escrow template.
for (const type of core.TYPES) {
  const project = draft(); project.nodes = project.nodes.filter(node => node.type !== type);
  hasError(project, 'node_missing');
}
for (const edge of core.CANONICAL_EDGES) {
  const project = draft(); project.edges = project.edges.filter(item => item.from !== edge.from || item.to !== edge.to);
  hasError(project, 'edge_missing');
}
const bypass = draft(); bypass.edges[4] = { from: 'funded', to: 'paid' }; hasError(bypass, 'edge_unsupported');
const orphan = draft(); orphan.edges[0].to = 'not-present'; hasError(orphan, 'edge_reference');
const duplicate = draft(); duplicate.nodes[1].id = 'created'; hasError(duplicate, 'node_duplicate_id');
const duplicateType = draft(); duplicateType.nodes[1].type = 'created'; hasError(duplicateType, 'node_duplicate_type');
const duplicateEdge = draft(); duplicateEdge.edges[1] = copy(duplicateEdge.edges[0]); hasError(duplicateEdge, 'edge_duplicate');
const nonFinite = draft(); nonFinite.nodes[0].x = Infinity; hasError(nonFinite, 'node_position');
const newlineId = draft(); newlineId.nodes[0].id += '\n'; hasError(newlineId, 'node_id');
const injected = draft(); injected.config.extraSource = 'selfdestruct(buyer);'; hasError(injected, 'unexpected_field');

const source = core.generate(draft());
assert.match(source, /pragma solidity =0\.8\.30;/);
assert.match(source, /amountWei = 1234567890120000000000;/);
assert.match(source, new RegExp(`uint256\\(${buyer}\\)`));
assert.match(source, /deadline = 1793534400;/);
assert.match(source, /receive\(\) external payable \{ revert UnexpectedPayment\(\); \}/);
const moved = draft(); moved.nodes.reverse(); moved.edges.reverse(); moved.nodes[0].x = 456.25;
assert.equal(core.generate(moved), source, 'layout and collection order never change generated behavior');
const renamed = draft();
renamed.nodes.forEach(node => { node.id = `state_${node.id}`; });
renamed.edges.forEach(edge => { edge.from = `state_${edge.from}`; edge.to = `state_${edge.to}`; });
assert.equal(core.generate(renamed), source, 'edges are validated by actual state types, not assumed node IDs');
const mixedCase = draft(); mixedCase.config.seller = seller.toUpperCase().replace('0X', '0x');
assert.equal(core.generate(mixedCase), source);

// JSON files contain a bounded declarative model, never source snippets or executable code.
const serialized = core.exportProject(draft());
assert.equal(core.exportProject(core.importProject(serialized)), serialized);
assert.equal(core.exportProject(core.importProject(core.exportProject(initial))), core.exportProject(initial), 'an incomplete new draft can be saved');
const incomplete = draft(); incomplete.nodes = []; incomplete.edges = [];
assert.equal(core.importProject(core.exportProject(incomplete)).nodes.length, 0);
assert.throws(() => core.generate(core.importProject(core.exportProject(incomplete))), error => error.code === 'invalid_project');
for (const input of ['{', '', 'null', '[]', '{"schema":"evil/v1"}', JSON.stringify({ ...copy(draft()), '__proto__': { dangerous: true } }).replace('"schema"', '"__proto__":{"x":1},"schema"')]) {
  assert.throws(() => core.importProject(input));
}
assert.throws(() => core.importProject(' '.repeat(core.MAX_PROJECT_LENGTH + 1)), error => error.code === 'project_too_large');
const hugeNodes = draft(); hugeNodes.nodes = Array(7).fill(hugeNodes.nodes[0]);
assert.throws(() => core.importProject(JSON.stringify(hugeNodes)), error => error.errors.some(item => item.code === 'node_limit'));
const hugeEdges = draft(); hugeEdges.edges = Array(6).fill(hugeEdges.edges[0]);
assert.throws(() => core.importProject(JSON.stringify(hugeEdges)), error => error.errors.some(item => item.code === 'edge_limit'));
const sparseNodes = draft(); delete sparseNodes.nodes[0];
assert.throws(() => core.exportProject(sparseNodes), error => error.errors.some(item => item.code === 'node_shape'));
const sparseEdges = draft(); delete sparseEdges.edges[0];
assert.throws(() => core.exportProject(sparseEdges), error => error.errors.some(item => item.code === 'edge_shape'));

// Happy-path funding -> approval -> withdrawal preserves every exact unit.
let state = core.createSimulation(draft(), deadline - 100);
assert.equal(state.balanceWei, '0');
assert.equal(state.amountRaw, '123456789012');
assert.equal(state.amountWei, '1234567890120000000000');
for (const actor of ['seller', 'outsider']) rejected(state, { action: 'deposit', actor }, 'unauthorized');
for (const valueWei of ['0', '1234567890120000000001', '1e21', 1234, '-1']) rejected(state, { action: 'deposit', actor: 'buyer', valueWei }, 'incorrect_value');
rejected(state, { action: 'approve', actor: 'buyer' }, 'invalid_state');
state = step(state, 'deposit', 'buyer');
assert.equal(state.balanceWei, state.amountWei);
rejected(state, { action: 'deposit', actor: 'buyer' }, 'invalid_state');
rejected(state, { action: 'cancel', actor: 'buyer' }, 'invalid_state');
rejected(state, { action: 'approve', actor: 'outsider' }, 'unauthorized');
rejected(state, { action: 'refund', actor: 'buyer' }, 'deadline_not_reached');
state = step(state, 'approve', 'buyer', { nowSeconds: deadline - 1 });
rejected(state, { action: 'refund', actor: 'buyer', nowSeconds: deadline + 1 }, 'invalid_state');
rejected(state, { action: 'withdraw', actor: 'buyer' }, 'unauthorized');
rejected(state, { action: 'withdraw', actor: 'seller', nowSeconds: deadline + 100, paymentSucceeds: false }, 'transfer_failed');
state = step(state, 'withdraw', 'seller', { nowSeconds: deadline + 100 });
assert.equal(state.stage, 'paid');
assert.equal(state.balanceWei, '0');
assert.equal(state.payouts.sellerWei, state.amountWei);
assert.equal(state.payouts.buyerWei, '0');
rejected(state, { action: 'withdraw', actor: 'seller' }, 'invalid_state');
rejected(state, { action: 'refund', actor: 'buyer' }, 'invalid_state');

// The boundary is exact: deposit and approval require < deadline; refund uses >=.
state = core.createSimulation(draft(), deadline - 1);
rejected(state, { action: 'deposit', actor: 'buyer', nowSeconds: deadline }, 'deadline_passed');
state = step(state, 'deposit', 'buyer');
rejected(state, { action: 'approve', actor: 'buyer', nowSeconds: deadline }, 'deadline_passed');
rejected(state, { action: 'refund', actor: 'seller', nowSeconds: deadline }, 'unauthorized');
rejected(state, { action: 'refund', actor: 'buyer', nowSeconds: deadline, paymentSucceeds: false }, 'transfer_failed');
state = step(state, 'refund', 'buyer', { nowSeconds: deadline });
assert.equal(state.stage, 'refunded');
assert.equal(state.balanceWei, '0');
assert.equal(state.payouts.buyerWei, state.amountWei);
rejected(state, { action: 'refund', actor: 'buyer' }, 'invalid_state');
rejected(state, { action: 'approve', actor: 'buyer' }, 'invalid_state');

state = core.createSimulation(draft(), deadline + 1);
state = step(state, 'cancel', 'buyer', { valueWei: '0' });
assert.equal(state.stage, 'cancelled', 'unfunded escrow can be cancelled even after deadline');
rejected(state, { action: 'deposit', actor: 'buyer' }, 'invalid_state');

// Time controls are explicit, monotonic, bounded and have no automatic transaction effects.
state = core.createSimulation(draft(), deadline - 100);
state = step(state, 'advanceTime', undefined, { nowSeconds: deadline });
assert.equal(state.stage, 'created');
rejected(state, { action: 'advanceTime', nowSeconds: deadline - 1 }, 'simulation_time');
rejected(state, { action: 'advanceTime', nowSeconds: Infinity }, 'simulation_time');
rejected(state, { action: 'advanceTime', nowSeconds: deadline + 0.5 }, 'simulation_time');
rejected(state, { action: 'advanceTime' }, 'simulation_command');
rejected(state, { action: 'deposit', actor: {} }, 'simulation_actor');
rejected(state, { action: 'selfdestruct', actor: 'buyer' }, 'simulation_action');
rejected(state, { action: 'cancel', actor: 'buyer', code: 'anything' }, 'simulation_command');
rejected(state, { action: 'cancel', actor: 'buyer', valueWei: '1' }, 'unexpected_value');
const forged = copy(state); forged.balanceWei = state.amountWei;
rejected(forged, { action: 'cancel', actor: 'buyer' }, 'invalid_simulation');
assert.throws(() => core.createSimulation(draft(), -1), error => error.code === 'simulation_time');
assert.throws(() => core.createSimulation(initial), error => error.code === 'invalid_project');

console.log('Contract Studio core: validation, exact units, source, imports and escrow simulation passed.');
