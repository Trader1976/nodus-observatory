import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Run the shipped browser module without browser, RPC, wallet or storage globals.
const context = {TextEncoder};
vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL('../frontend/core.js', import.meta.url), 'utf8'), context);
const c = context.NodusDefiCore;
const now = 1800000000;
const fields = {name: 'Thirty day test loan', principal: '1000', collateral: '20000',
  aprBps: 800, termDays: 30, graceDays: 3};
const offer = c.createOffer(fields, now);
const copy = value => JSON.parse(JSON.stringify(value));
function rejects(fn, code) {
  assert.throws(fn, error => error.code === code, 'expected ' + code);
}

// Exact integer accounting includes values beyond JavaScript's safe integer.
assert.equal(c.parseAmount('900719925474099.123456', 6), '900719925474099123456');
assert.equal(c.parseAmount('0.00000001', 8), '1');
assert.equal(c.parseAmount('1.23456789', 8), '123456789');
assert.equal(c.formatAmount('123456789', 8), '1.23456789');
assert.equal(c.formatAmount('100000000', 8), '1');
assert.equal(c.formatAmount('0', 6), '0');
assert.equal(c.formatAmount('1', 6), '0.000001');
for (const input of ['-1', '+1', '1e6', 'Infinity', 'NaN', ' 1', '1 ', '01', '1.', '.1', '1,2', '', '1.0000001']) {
  rejects(() => c.parseAmount(input, 6), 'invalid_amount');
}
rejects(() => c.parseAmount('1.0', 0), 'invalid_amount');
rejects(() => c.parseAmount('1', 19), 'invalid_number');
rejects(() => c.formatAmount('01', 6), 'invalid_amount');
rejects(() => c.formatAmount('-1', 6), 'invalid_amount');
assert.equal(c.quote(offer).interestRaw, '6575343'); // 1000 * 8% * 30/365, rounded up to 6dp.
assert.equal(c.quote(offer).repayRaw, '1006575343');
assert.equal(c.quote(offer).collateralWei, '20000000000000000000000');
const tiny = c.createOffer({...fields, principal: '0.000001', aprBps: 1, termDays: 1}, now);
assert.equal(c.interestRaw(tiny), '1', 'one final ceiling preserves a nonzero minimum unit');
const max = c.createOffer({...fields, principal: '1000000000000000000', collateral: '10000000000000000',
  aprBps: 5000, termDays: 365}, now);
assert.equal(max.principalRaw, c.MAX_AMOUNT);
assert.equal(max.collateralRaw, c.MAX_AMOUNT);
assert.equal(c.quote(max).interestRaw, '500000000000000000000000');
assert.equal(c.quote(max).repayRaw, '1500000000000000000000000');
assert.equal(c.formatAmount(c.quote(max).repayRaw, 6), '1500000000000000000');
assert.equal(c.quote(max).collateralWei, '10000000000000000000000000000000000');

// Every failed transition must preserve the original state.
let state = c.start(offer);
const initial = JSON.stringify(state);
rejects(() => c.step(state, 'accept', {actor: 'lender'}), 'self_loan');
rejects(() => c.step(state, 'accept', {actor: 'borrower', now: offer.expiresAt}), 'offer_expired');
rejects(() => c.step(state, 'cancel', {actor: 'borrower'}), 'unauthorized');
rejects(() => c.step(state, 'accept', {actor: 'borrower', now: now - 1}), 'invalid_number');
rejects(() => c.step(state, 'bogus', {actor: 'borrower'}), 'invalid_action');
assert.equal(JSON.stringify(state), initial);
state = c.step(state, 'accept', {actor: 'borrower', now: now + 60});
assert.equal(state.status, 'active');
assert.equal(state.acceptedAt, now + 60);
assert.equal(state.dueAt, now + 60 + 30 * 86400);
assert.equal(state.borrower, 'borrower');
rejects(() => c.step(state, 'cancel', {actor: 'lender'}), 'offer_not_open');
rejects(() => c.step(state, 'accept', {actor: 'another'}), 'offer_not_open');
rejects(() => c.step(state, 'repay', {actor: 'lender'}), 'unauthorized');
rejects(() => c.step(state, 'default', {actor: 'borrower'}), 'unauthorized');
const cutoff = state.dueAt + 3 * 86400;
rejects(() => c.step(state, 'default', {actor: 'lender', now: cutoff - 1}), 'default_not_ready');
rejects(() => c.step(state, 'repay', {actor: 'borrower', now: cutoff}), 'repayment_closed');
assert.equal(c.step(state, 'repay', {actor: 'borrower', now: cutoff - 1}).status, 'repaid');
assert.equal(c.step(state, 'repay', {actor: 'borrower', now: state.dueAt + 1}).status, 'repaid', 'repayment allowed in grace');
const early = c.step(state, 'repay', {actor: 'borrower', now: state.acceptedAt});
assert.equal(c.quote(early.offer).interestRaw, '6575343', 'early repayment retains full-term interest');
rejects(() => c.step(early, 'repay', {actor: 'borrower'}), 'loan_not_active');
const defaulted = c.step(state, 'default', {actor: 'lender', now: cutoff});
assert.equal(defaulted.status, 'defaulted');
assert.equal(defaulted.settledAt, cutoff);
rejects(() => c.step(defaulted, 'default', {actor: 'lender'}), 'loan_not_active');
rejects(() => c.step(defaulted, 'repay', {actor: 'borrower'}), 'loan_not_active');
const cancelled = c.step(c.start(offer), 'cancel', {actor: 'lender', now: offer.expiresAt});
assert.equal(cancelled.status, 'cancelled', 'an unused expired offer can still be reclaimed');
rejects(() => c.step(cancelled, 'accept', {actor: 'borrower'}), 'offer_not_open');
assert.equal(c.step(c.start(offer), 'accept', {actor: 'borrower', now: offer.expiresAt - 1}).status, 'active');

// A tampered in-memory state cannot change the agreed parties, time or status.
for (const patch of [{lender: 'attacker'}, {borrower: 'attacker'}, {dueAt: state.dueAt + 10},
  {status: 'open'}, {now: now}, {settledAt: now}, {extra: true}]) {
  assert.throws(() => c.step({...copy(state), ...patch}, 'advance', {now: cutoff}));
}
const badHistory = copy(state); badHistory.events[0].actor = 'lender';
rejects(() => c.step(badHistory, 'advance', {now: cutoff}), 'self_loan');
const foreignEvent = copy(state); foreignEvent.events.push({action: 'advance', actor: 'lender', now: cutoff});
rejects(() => c.step(foreignEvent, 'advance', {now: cutoff}), 'invalid_state');
const advanced = c.step(state, 'advance', {now: cutoff});
assert.equal(advanced.now, cutoff);
rejects(() => c.step(advanced, 'repay', {actor: 'borrower', now: cutoff - 1}), 'invalid_number');
assert.equal(c.step(advanced, 'default', {actor: 'lender'}).status, 'defaulted');

// Imported files contain validated draft terms only, never histories or scores.
const text = c.exportOffers([offer]);
assert.equal(c.exportOffers(c.importOffers(text)), text);
assert(!text.includes('events'));
rejects(() => c.exportOffers([offer, offer]), 'duplicate_id');
rejects(() => c.exportOffers(Array(101).fill(offer)), 'too_many_offers');
rejects(() => c.importOffers('x'.repeat(c.MAX_BYTES + 1)), 'file_too_large');
rejects(() => c.importOffers('{'), 'invalid_json');
rejects(() => c.importOffers(JSON.stringify({schema: c.SCHEMA, offers: [], creditScore: 1000})), 'invalid_schema');
rejects(() => c.importOffers(JSON.stringify({schema: 'other', offers: []})), 'invalid_schema');
assert.equal(c.importOffers(c.exportOffers([])).length, 0);
assert.equal(c.sampleOffers(now).length, 2);

for (const patch of [{principalRaw: '0'}, {principalRaw: '01'}, {principalRaw: '1000000000000000000000001'},
  {principalRaw: 1000}, {collateralRaw: '0'}, {aprBps: 0}, {aprBps: 5001}, {aprBps: 800.1},
  {termDays: 0}, {termDays: 366}, {graceDays: 0}, {graceDays: 31}, {createdAt: -1},
  {expiresAt: now}, {expiresAt: now + 31 * 86400}, {id: '<script>'}, {name: ' '},
  {name: '\nLoan'}, {score: 800}, {schema: c.SCHEMA}]) {
  assert.throws(() => c.validateOffer({...copy(offer), ...patch}), JSON.stringify(patch));
}
rejects(() => c.createOffer({...fields, principal: '0'}, now), 'invalid_amount');
rejects(() => c.createOffer({...fields, offerDays: 0}, now), 'invalid_number');
rejects(() => c.createOffer({...fields, creditScore: 800}, now), 'invalid_schema');
rejects(() => c.createOffer(fields, Number.NaN), 'invalid_number');

console.log('Test DeFi core: exact money, full-term interest, authorization, expiry/grace boundaries, replay protection and hostile draft imports PASS.');
