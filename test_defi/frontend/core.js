/*
 * Test DeFi's deterministic, offline loan model.
 *
 * This module deliberately has no wallet, storage or network access. Its records
 * are rehearsal data, never evidence of a funded offer or a real repayment.
 * Token amounts remain integer strings at the API boundary and BigInt internally:
 * tUSDT has six decimals; native NODUS has eight display decimals. The Nodus EVM
 * represents a native coin with eighteen decimals, hence raw NODUS * 10^10.
 */
(() => {
  'use strict';
  const DAY = 86400;
  const MAX_AMOUNT = 10n ** 24n;
  const MAX_TIMESTAMP = 253402300799;
  const SCHEMA = 'nodus-defi/offers-v1';
  const MAX_OFFERS = 100, MAX_BYTES = 262144;
  const OFFER_KEYS = ['id', 'name', 'principalRaw', 'collateralRaw', 'aprBps',
    'termDays', 'graceDays', 'createdAt', 'expiresAt'];
  const STATE_KEYS = ['offer', 'lender', 'borrower', 'status', 'acceptedAt',
    'dueAt', 'settledAt', 'now', 'events'];
  const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
  let sequence = 0;

  const clone = value => JSON.parse(JSON.stringify(value));
  function fail(code, field = '') {
    throw Object.assign(new Error(code), {code, field});
  }
  function object(value, keys, field) {
    if (!value || Array.isArray(value) || typeof value !== 'object'
        || Object.keys(value).length !== keys.length
        || keys.some(key => !Object.hasOwn(value, key))) fail('invalid_schema', field);
  }
  function integer(value, min, max, field) {
    if (!Number.isSafeInteger(value) || value < min || value > max) fail('invalid_number', field);
    return value;
  }
  function rawAmount(value, field, zero = false, maximum = MAX_AMOUNT) {
    if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,24})$/.test(value)) fail('invalid_amount', field);
    const raw = BigInt(value);
    if (raw > maximum || (!zero && raw === 0n)) fail('invalid_amount', field);
    return raw;
  }
  function decimals(value) { return integer(value, 0, 18, 'decimals'); }

  /** Parse an exact human-readable decimal; exponent notation and rounding fail. */
  function parseAmount(text, digits) {
    decimals(digits);
    const fraction = digits ? '(?:\\.[0-9]{1,' + digits + '})?' : '';
    if (typeof text !== 'string' || text.length > 64
        || !new RegExp('^(0|[1-9][0-9]*)' + fraction + '$').test(text)) fail('invalid_amount');
    const [whole, tail = ''] = text.split('.');
    const raw = BigInt(whole) * 10n ** BigInt(digits)
      + BigInt((tail + '0'.repeat(digits)).slice(0, digits) || '0');
    if (raw > MAX_AMOUNT) fail('invalid_amount');
    return raw.toString();
  }

  /** Formatting is exact and locale independent; the UI may add unit labels. */
  function formatAmount(raw, digits) {
    decimals(digits);
    // A valid repayment can exceed the principal cap by its agreed interest.
    rawAmount(raw, 'amount', true, MAX_AMOUNT * 2n);
    if (!digits) return raw;
    const padded = raw.padStart(digits + 1, '0');
    const fraction = padded.slice(-digits).replace(/0+$/, '');
    return padded.slice(0, -digits) + (fraction ? '.' + fraction : '');
  }

  function validateOffer(input) {
    object(input, OFFER_KEYS, 'offer');
    if (typeof input.id !== 'string' || !ID.test(input.id)) fail('invalid_id', 'id');
    if (typeof input.name !== 'string' || input.name !== input.name.trim()
        || !input.name || input.name.length > 80 || /[\u0000-\u001f\u007f]/.test(input.name)) fail('invalid_name', 'name');
    rawAmount(input.principalRaw, 'principalRaw');
    rawAmount(input.collateralRaw, 'collateralRaw');
    integer(input.aprBps, 1, 5000, 'aprBps');
    integer(input.termDays, 1, 365, 'termDays');
    integer(input.graceDays, 1, 30, 'graceDays');
    // Leave room for offer expiry, the longest loan term and its grace period.
    integer(input.createdAt, 0, MAX_TIMESTAMP - 425 * DAY, 'createdAt');
    integer(input.expiresAt, input.createdAt + 1, input.createdAt + 30 * DAY, 'expiresAt');
    return Object.fromEntries(OFFER_KEYS.map(key => [key, input[key]]));
  }

  /** Create a draft, with a local readable ID rather than a cryptographic ID. */
  function createOffer(fields, now = Math.floor(Date.now() / 1000)) {
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) fail('invalid_schema');
    const allowed = ['id', 'name', 'principal', 'collateral', 'aprBps', 'termDays', 'graceDays', 'offerDays'];
    if (Object.keys(fields).some(key => !allowed.includes(key))) fail('invalid_schema');
    integer(now, 0, MAX_TIMESTAMP - 425 * DAY, 'createdAt');
    const offerDays = fields.offerDays === undefined ? 7 : fields.offerDays;
    integer(offerDays, 1, 30, 'offerDays');
    return validateOffer({id: fields.id === undefined ? `local-${now}-${++sequence}` : fields.id,
      name: fields.name, principalRaw: parseAmount(fields.principal, 6),
      collateralRaw: parseAmount(fields.collateral, 8), aprBps: fields.aprBps,
      termDays: fields.termDays, graceDays: fields.graceDays,
      createdAt: now, expiresAt: now + offerDays * DAY});
  }

  // The full agreed term's simple interest is charged even on early repayment.
  // Round upward only once, to the smallest tUSDT unit. No floating-point money.
  function interestRaw(input) {
    const offer = validateOffer(input);
    const numerator = BigInt(offer.principalRaw) * BigInt(offer.aprBps) * BigInt(offer.termDays);
    const denominator = 10000n * 365n;
    return ((numerator + denominator - 1n) / denominator).toString();
  }
  function quote(input) {
    const offer = validateOffer(input), interest = interestRaw(offer);
    return {principalRaw: offer.principalRaw, collateralRaw: offer.collateralRaw,
      collateralWei: (BigInt(offer.collateralRaw) * 10000000000n).toString(),
      interestRaw: interest, repayRaw: (BigInt(offer.principalRaw) + BigInt(interest)).toString()};
  }

  /** Starting a rehearsal means simulating one funded, indivisible offer. */
  function start(input) {
    const offer = validateOffer(input);
    return {offer, lender: 'lender', borrower: null, status: 'open',
      acceptedAt: null, dueAt: null, settledAt: null, now: offer.createdAt, events: []};
  }
  function deadline(state) { return state.dueAt + state.offer.graceDays * DAY; }

  // Only this internal function mutates a state. Public transitions first replay
  // and validate its history so a modified due date or party cannot bypass rules.
  function apply(state, action, actor, now) {
    integer(now, state.now, MAX_TIMESTAMP, 'now');
    if (action === 'advance') {
      actor = null;
    } else {
      if (typeof actor !== 'string' || !ID.test(actor)) fail('unauthorized', 'actor');
      if (action === 'accept') {
        if (state.status !== 'open') fail('offer_not_open');
        if (actor === state.lender) fail('self_loan');
        if (now >= state.offer.expiresAt) fail('offer_expired');
        state.status = 'active';
        state.borrower = actor;
        state.acceptedAt = now;
        state.dueAt = now + state.offer.termDays * DAY;
      } else if (action === 'cancel') {
        if (actor !== state.lender) fail('unauthorized');
        if (state.status !== 'open') fail('offer_not_open');
        state.status = 'cancelled'; state.settledAt = now;
      } else if (action === 'repay') {
        if (actor !== state.borrower) fail('unauthorized');
        if (state.status !== 'active') fail('loan_not_active');
        if (now >= deadline(state)) fail('repayment_closed');
        state.status = 'repaid'; state.settledAt = now;
      } else if (action === 'default') {
        if (actor !== state.lender) fail('unauthorized');
        if (state.status !== 'active') fail('loan_not_active');
        if (now < deadline(state)) fail('default_not_ready');
        // Experimental fixed-term settlement: the whole agreed collateral is
        // assigned to the lender. There is no price feed or price liquidation.
        state.status = 'defaulted'; state.settledAt = now;
      } else fail('invalid_action');
    }
    state.now = now;
    state.events.push({action, actor, now});
    return state;
  }

  function validateState(input) {
    object(input, STATE_KEYS, 'state');
    if (!Array.isArray(input.events) || input.events.length > 1000) fail('invalid_state');
    const expected = start(input.offer);
    for (const event of input.events) {
      object(event, ['action', 'actor', 'now'], 'event');
      if (event.action === 'advance' && event.actor !== null) fail('invalid_state');
      apply(expected, event.action, event.actor, event.now);
    }
    for (const key of STATE_KEYS) {
      if (key === 'offer' || key === 'events') continue;
      if (input[key] !== expected[key]) fail('invalid_state', key);
    }
    return expected;
  }

  /** Return a new state. An error leaves the caller's previous state untouched. */
  function step(input, action, {actor = null, now = input?.now} = {}) {
    const state = validateState(input);
    if (state.events.length >= 1000) fail('history_full');
    return apply(state, action, actor, now);
  }

  function validateList(offers) {
    if (!Array.isArray(offers) || offers.length > MAX_OFFERS) fail('too_many_offers');
    const result = offers.map(validateOffer);
    if (new Set(result.map(offer => offer.id)).size !== result.length) fail('duplicate_id');
    return result;
  }
  // Export draft terms only. Neither simulation state nor purported credit
  // scores can be imported as if they were verified facts about a user.
  function exportOffers(offers) {
    const text = JSON.stringify({schema: SCHEMA, offers: validateList(offers)}, null, 2) + '\n';
    if (new TextEncoder().encode(text).length > MAX_BYTES) fail('file_too_large');
    return text;
  }
  function importOffers(text) {
    if (typeof text !== 'string' || text.length > MAX_BYTES
        || new TextEncoder().encode(text).length > MAX_BYTES) fail('file_too_large');
    let parsed;
    try { parsed = JSON.parse(text); } catch { fail('invalid_json'); }
    object(parsed, ['schema', 'offers'], 'file');
    if (parsed.schema !== SCHEMA) fail('invalid_schema');
    return validateList(parsed.offers);
  }
  function sampleOffers(now = Math.floor(Date.now() / 1000)) {
    return [
      createOffer({id: 'example-8', name: 'Example 8%', principal: '1000', collateral: '20000',
        aprBps: 800, termDays: 30, graceDays: 3}, now),
      createOffer({id: 'example-10', name: 'Example 10%', principal: '500', collateral: '10000',
        aprBps: 1000, termDays: 30, graceDays: 3}, now),
    ];
  }
  globalThis.NodusDefiCore = Object.freeze({SCHEMA, DAY, MAX_AMOUNT: MAX_AMOUNT.toString(),
    MAX_OFFERS, MAX_BYTES, validateOffer, createOffer, parseAmount, formatAmount,
    interestRaw, quote, start, step, validateState, sampleOffers, exportOffers, importOffers, clone});
})();
