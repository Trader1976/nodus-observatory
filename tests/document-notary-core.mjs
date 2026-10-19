import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createHash, webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const context = vm.createContext({ crypto: webcrypto, Uint8Array, ArrayBuffer });
vm.runInContext(fs.readFileSync(path.join(root, 'dist/document-notary-core.js'), 'utf8'), context);
const C = context.NodusDocumentCore;
const plain = value => JSON.parse(JSON.stringify(value));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const publisher = '0x' + 'ab'.repeat(32);
const registryAddress = '0x' + '34'.repeat(32);
const digest = '0x' + 'cd'.repeat(32);
const zero = '0x' + '0'.repeat(64);
const word = value => BigInt(value).toString(16).padStart(64, '0');
const encoded = (...values) => '0x' + values.map(word).join('');
const fails = (fn, code) => assert.throws(fn, error => error.code === code);
const rejects = async (fn, code) => assert.rejects(fn, error => error.code === code);

// The browser source and downloadable compiler artifact describe one contract.
const artifact = JSON.parse(fs.readFileSync(path.join(root, 'dist/document-registry.json'), 'utf8'));
assert.equal(C.SOURCE, fs.readFileSync(path.join(root, 'contracts/ObservatoryDocuments.sol'), 'utf8'));
assert.equal(C.SOURCE_SHA256, sha256(C.SOURCE));
assert.equal(artifact.sourceSha256, C.SOURCE_SHA256);
assert.equal(artifact.runtimeSha256, sha256(Buffer.from(artifact.runtimeBytecode.slice(2), 'hex')));
assert.equal(C.RUNTIME_SHA256, artifact.runtimeSha256);
assert.equal(C.CREATION_SHA256, sha256(Buffer.from(artifact.creationBytecode.slice(2), 'hex')));
assert.deepEqual(plain(C.ABI), artifact.abi);
assert.equal(artifact.contractName, 'ObservatoryDocuments');
assert.equal(artifact.schema, 'nodus-document-registry-artifact/v1');
assert.equal(artifact.compiler.version, '0.8.30+nodus.addr256.commit.73712a01.Linux.g++');
assert.equal(artifact.compiler.binarySha256, '6c981f36ee790a46fa2310c4eb925e35909b020a58a19654a063517947ceffb4');
for (const key of ['creationBytecode', 'runtimeBytecode']) assert.match(artifact[key], /^0x(?:[a-f0-9]{2})+$/);
assert.deepEqual(plain(C.ABI.filter(item => item.type === 'function').map(item => [item.name, item.stateMutability])), [
  ['record', 'view'], ['register', 'nonpayable'], ['revoke', 'nonpayable'],
]);
assert.equal(C.ABI.some(item => ['constructor', 'receive', 'fallback'].includes(item.type)), false);
assert.ok(Object.isFrozen(C.ABI) && Object.isFrozen(C.ABI[0].inputs[0]));

// 32-byte addresses, not Ethereum's 20-byte addresses or native fingerprints.
assert.equal(C.normalizeAddress(publisher.toUpperCase().replace('0X', '0x')), publisher);
assert.equal(C.normalizeDigest(digest.toUpperCase().replace('0X', '0x')), digest);
for (const value of [null, undefined, 12, '', '0x' + '1'.repeat(40), '0x' + '1'.repeat(128), zero,
  publisher + '\n', publisher + ' ', ' ' + publisher, publisher.replace('a', 'g'), publisher.replace('a', 'а')]) {
  fails(() => C.normalizeAddress(value), 'address');
  fails(() => C.normalizeDigest(value), 'digest');
}
assert.equal(C.encodeGetRecord(publisher, digest), '0x170c6999' + publisher.slice(2) + digest.slice(2));
assert.equal(C.encodeRegister(digest), '0xe1fa8e84' + digest.slice(2));
assert.equal(C.encodeRevoke(digest), '0xb75c7dc6' + digest.slice(2));
fails(() => C.encodeGetRecord(zero, digest), 'address');
fails(() => C.encodeRegister(digest + '\n'), 'digest');
fails(() => C.encodeRevoke(zero), 'digest');

// A corrupt or truncated RPC reply must never look like a successful record.
assert.deepEqual(plain(C.decodeRecord(encoded(0, 0, 0, 0))), { exists: false, blockNumber: '0', timestamp: '0', revoked: false });
assert.deepEqual(plain(C.decodeRecord(encoded(1, 0, 0, 1))), { exists: true, blockNumber: '0', timestamp: '0', revoked: true });
const max = (1n << 256n) - 1n;
assert.equal(C.decodeRecord(encoded(1, max, max, 0)).blockNumber, max.toString());
for (const value of [null, '', '0x', encoded(1, 1, 1), encoded(1, 1, 1, 0, 0), encoded(1, 1, 1, 0) + '\n']) fails(() => C.decodeRecord(value), 'record_encoding');
fails(() => C.decodeRecord(encoded(2, 0, 0, 0)), 'record_boolean');
fails(() => C.decodeRecord(encoded(1, 0, 0, 2)), 'record_boolean');
for (const value of [encoded(0, 1, 0, 0), encoded(0, 0, 1, 0), encoded(0, 0, 0, 1)]) fails(() => C.decodeRecord(value), 'record_inconsistent');

// Hash exactly the file bytes, with a bounded allocation before Web Crypto.
const file = text => { const buffer = Buffer.from(text); return { size: buffer.length, arrayBuffer: async () => Uint8Array.from(buffer).buffer }; };
assert.equal(await C.hashFile(file('abc')), '0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
assert.equal(await C.hashFile(file('')), '0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
assert.notEqual(await C.hashFile(file('abc')), await C.hashFile(file('abc\n')));
let read = false;
await rejects(() => C.hashFile({ size: C.MAX_FILE_BYTES + 1, arrayBuffer: async () => { read = true; return new ArrayBuffer(0); } }), 'file_too_large');
assert.equal(read, false);
await rejects(() => C.hashFile(file('abc'), { maxBytes: 2 }), 'file_too_large');
for (const maxBytes of [0, -1, 1.1, Infinity, C.MAX_FILE_BYTES + 1]) await rejects(() => C.hashFile(file(''), { maxBytes }), 'file_limit');
for (const value of [null, {}, { size: -1, arrayBuffer() {} }, { size: 1.5, arrayBuffer() {} }]) await rejects(() => C.hashFile(value), 'file');
await rejects(() => C.hashFile({ size: 2, arrayBuffer: async () => new ArrayBuffer(3) }), 'file_changed');
await rejects(() => C.hashFile(file('abc'), { crypto: {} }), 'crypto_unavailable');
await rejects(() => C.hashFile(file('abc'), { crypto: { subtle: { digest: async () => new ArrayBuffer(31) } } }), 'hash_result');

// Importing a proof never confers a "verified" state or authenticates a publisher.
const proof = C.createProof({ publisher, registryAddress, digest });
assert.deepEqual(plain(C.parseProof(JSON.stringify(proof))), plain(proof));
assert.equal(proof.claim, null);
assert.equal(proof.networkGenesisPin, null);
assert.equal('verified' in proof, false);
const claimed = C.createProof({ publisher, registryAddress, digest, networkGenesisPin: 'AF'.repeat(32), claim: { blockNumber: max.toString(), timestamp: '0', revoked: false } });
assert.equal(claimed.networkGenesisPin, 'af'.repeat(32));
assert.equal(claimed.claim.blockNumber, max.toString());
const invalid = (edit, code) => { const value = plain(proof); edit(value); fails(() => C.parseProof(JSON.stringify(value)), code); };
invalid(value => { value.verified = true; }, 'proof_fields');
invalid(value => { value.schema = 'other'; }, 'proof_schema');
invalid(value => { value.hashAlgorithm = 'Keccak-256'; }, 'proof_schema');
invalid(value => { delete value.publisher; }, 'proof_fields');
invalid(value => { value.networkGenesisPin = '0x' + 'a'.repeat(64); }, 'proof_network');
invalid(value => { value.publisher += '\n'; }, 'address');
invalid(value => { value.claim = { blockNumber: '01', timestamp: '0', revoked: false }; }, 'proof_number');
invalid(value => { value.claim = { blockNumber: (max + 1n).toString(), timestamp: '0', revoked: false }; }, 'proof_number');
invalid(value => { value.claim = { blockNumber: 1, timestamp: '0', revoked: false }; }, 'proof_number');
invalid(value => { value.claim = { blockNumber: '1', timestamp: '0', revoked: 0 }; }, 'proof_boolean');
fails(() => C.parseProof(JSON.stringify(proof).replace('{', '{"__proto__":{},')), 'proof_fields');
fails(() => C.parseProof('['), 'proof_json');
fails(() => C.parseProof(' '.repeat(C.MAX_PROOF_LENGTH + 1)), 'proof_size');
fails(() => C.createProof({ publisher, registryAddress, digest, fileContents: 'private' }), 'proof_fields');

console.log('Document notary core: artifact/source consistency, address256 ABI, exact hashing and untrusted-proof checks passed.');
