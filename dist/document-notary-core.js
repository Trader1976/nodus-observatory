/* Document notarization: deterministic data, ABI and local hashing only.
 * No wallet access, network access, signing, file upload or transaction submission.
 * The ABI/selectors are from the Nodus address256 Solidity 0.8.30 compiler.
 */
(() => {
  'use strict';
  const SOURCE = "// SPDX-License-Identifier: MIT\npragma solidity =0.8.30;\n\n/// @notice An immutable record of a publisher's claim about a SHA-256 digest.\n/// @dev Use the Nodus address256 compiler. A record proves neither authorship,\n///      publisher identity nor the truth of a document's contents.\ncontract ObservatoryDocuments {\n    struct DocumentRecord {\n        bool exists;\n        uint256 blockNumber;\n        uint256 timestamp;\n        bool revoked;\n    }\n\n    mapping(address => mapping(bytes32 => DocumentRecord)) private records;\n\n    event Registered(address indexed publisher, bytes32 indexed digest, uint256 blockNumber, uint256 timestamp);\n    event Revoked(address indexed publisher, bytes32 indexed digest);\n\n    function register(bytes32 digest) external {\n        require(digest != bytes32(0), \"zero digest\");\n        DocumentRecord storage entry = records[msg.sender][digest];\n        require(!entry.exists, \"already registered\");\n        entry.exists = true;\n        entry.blockNumber = block.number;\n        entry.timestamp = block.timestamp;\n        emit Registered(msg.sender, digest, block.number, block.timestamp);\n    }\n\n    function revoke(bytes32 digest) external {\n        DocumentRecord storage entry = records[msg.sender][digest];\n        require(entry.exists, \"not registered by sender\");\n        require(!entry.revoked, \"already revoked\");\n        entry.revoked = true;\n        emit Revoked(msg.sender, digest);\n    }\n\n    function record(address publisher, bytes32 digest) external view returns (\n        bool exists, uint256 blockNumber, uint256 timestamp, bool revoked\n    ) {\n        DocumentRecord storage entry = records[publisher][digest];\n        return (entry.exists, entry.blockNumber, entry.timestamp, entry.revoked);\n    }\n}\n";
  const ABI = [
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "publisher",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "digest",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "blockNumber",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "timestamp",
        "type": "uint256"
      }
    ],
    "name": "Registered",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "publisher",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "digest",
        "type": "bytes32"
      }
    ],
    "name": "Revoked",
    "type": "event"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "publisher",
        "type": "address"
      },
      {
        "internalType": "bytes32",
        "name": "digest",
        "type": "bytes32"
      }
    ],
    "name": "record",
    "outputs": [
      {
        "internalType": "bool",
        "name": "exists",
        "type": "bool"
      },
      {
        "internalType": "uint256",
        "name": "blockNumber",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "timestamp",
        "type": "uint256"
      },
      {
        "internalType": "bool",
        "name": "revoked",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "digest",
        "type": "bytes32"
      }
    ],
    "name": "register",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "digest",
        "type": "bytes32"
      }
    ],
    "name": "revoke",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
];
  const SOURCE_SHA256 = '3dd66d6306bdbe7e525ad86ec087efd2a3f09a23c1b4c1a0b729049a8e223d29';
  const CREATION_SHA256 = '3607a46e47462ee3235f0c5cd0dbcbe3abf102663a9f50de4d4504a19109b865';
  const RUNTIME_SHA256 = 'c7887eb7983178170bcf11c59f4cfd4bf04ee011010076bbd2878acdcbd72bcf';
  const SELECTORS = Object.freeze({ record: '170c6999', register: 'e1fa8e84', revoke: 'b75c7dc6' });
  const PROOF_SCHEMA = 'nodus-document-proof/v1';
  const MAX_FILE_BYTES = 64 * 1024 * 1024;
  const MAX_PROOF_LENGTH = 16384;
  const HEX32 = /^0x[0-9a-fA-F]{64}(?![\s\S])/;
  const PIN = /^[0-9a-fA-F]{64}(?![\s\S])/;
  const DECIMAL = /^(0|[1-9][0-9]{0,77})(?![\s\S])/;
  const UINT256_MAX = (1n << 256n) - 1n;
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const zero = '0x' + '0'.repeat(64);
  function failure(code) { const error = new Error(code); error.code = code; return error; }
  function normalize32(value, code) {
    if (typeof value !== 'string' || !HEX32.test(value) || value.toLowerCase() === zero) throw failure(code);
    return value.toLowerCase();
  }
  const normalizeAddress = value => normalize32(value, 'address');
  const normalizeDigest = value => normalize32(value, 'digest');
  const encodeGetRecord = (publisher, digest) => '0x' + SELECTORS.record + normalizeAddress(publisher).slice(2) + normalizeDigest(digest).slice(2);
  const encodeRegister = digest => '0x' + SELECTORS.register + normalizeDigest(digest).slice(2);
  const encodeRevoke = digest => '0x' + SELECTORS.revoke + normalizeDigest(digest).slice(2);
  function decodeRecord(hex) {
    if (typeof hex !== 'string' || !/^0x[0-9a-fA-F]{256}(?![\s\S])/.test(hex)) throw failure('record_encoding');
    const words = [0, 1, 2, 3].map(i => BigInt('0x' + hex.slice(2 + i * 64, 66 + i * 64)));
    if (words[0] > 1n || words[3] > 1n) throw failure('record_boolean');
    if (words[0] === 0n && words.some(value => value !== 0n)) throw failure('record_inconsistent');
    return { exists: words[0] === 1n, blockNumber: words[1].toString(), timestamp: words[2].toString(), revoked: words[3] === 1n };
  }
  async function hashFile(file, options = {}) {
    const crypto = options.crypto || globalThis.crypto;
    const maxBytes = options.maxBytes === undefined ? MAX_FILE_BYTES : options.maxBytes;
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_FILE_BYTES) throw failure('file_limit');
    if (!file || !Number.isSafeInteger(file.size) || file.size < 0 || typeof file.arrayBuffer !== 'function') throw failure('file');
    if (file.size > maxBytes) throw failure('file_too_large');
    if (!crypto || !crypto.subtle || typeof crypto.subtle.digest !== 'function') throw failure('crypto_unavailable');
    const buffer = await file.arrayBuffer();
    if (!buffer || Object.prototype.toString.call(buffer) !== '[object ArrayBuffer]' || buffer.byteLength !== file.size || buffer.byteLength > maxBytes) throw failure('file_changed');
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
    if (digest.byteLength !== 32) throw failure('hash_result');
    return normalizeDigest('0x' + Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join(''));
  }
  function keys(value, allowed, required = allowed) {
    if (!object(value) || Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !own(value, key))) throw failure('proof_fields');
  }
  function decimal(value) {
    if (typeof value !== 'string' || !DECIMAL.test(value) || BigInt(value) > UINT256_MAX) throw failure('proof_number');
    return value;
  }
  function normalizeProof(value) {
    keys(value, ['schema', 'hashAlgorithm', 'digest', 'registryAddress', 'publisher', 'networkGenesisPin', 'claim']);
    if (value.schema !== PROOF_SCHEMA || value.hashAlgorithm !== 'SHA-256') throw failure('proof_schema');
    if (value.networkGenesisPin !== null && (typeof value.networkGenesisPin !== 'string' || !PIN.test(value.networkGenesisPin))) throw failure('proof_network');
    let claim = null;
    if (value.claim !== null) {
      keys(value.claim, ['blockNumber', 'timestamp', 'revoked']);
      if (typeof value.claim.revoked !== 'boolean') throw failure('proof_boolean');
      claim = { blockNumber: decimal(value.claim.blockNumber), timestamp: decimal(value.claim.timestamp), revoked: value.claim.revoked };
    }
    // All imported fields, including the optional historical claim, are user
    // supplied. Only a fresh chain query can establish a current registry record.
    return {
      schema: PROOF_SCHEMA, hashAlgorithm: 'SHA-256', digest: normalizeDigest(value.digest),
      registryAddress: normalizeAddress(value.registryAddress), publisher: normalizeAddress(value.publisher),
      networkGenesisPin: value.networkGenesisPin === null ? null : value.networkGenesisPin.toLowerCase(), claim,
    };
  }
  function createProof(input) {
    keys(input, ['digest', 'registryAddress', 'publisher', 'networkGenesisPin', 'claim'], ['digest', 'registryAddress', 'publisher']);
    return normalizeProof({ schema: PROOF_SCHEMA, hashAlgorithm: 'SHA-256', digest: input.digest,
      registryAddress: input.registryAddress, publisher: input.publisher,
      networkGenesisPin: own(input, 'networkGenesisPin') ? input.networkGenesisPin : null,
      claim: own(input, 'claim') ? input.claim : null });
  }
  function parseProof(json) {
    if (typeof json !== 'string' || json.length > MAX_PROOF_LENGTH) throw failure('proof_size');
    let value;
    try { value = JSON.parse(json); } catch (_) { throw failure('proof_json'); }
    return normalizeProof(value);
  }
  function freeze(value) {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
  }
  globalThis.NodusDocumentCore = Object.freeze({
    SOURCE, SOURCE_SHA256, CREATION_SHA256, RUNTIME_SHA256, ABI: freeze(ABI), SELECTORS, PROOF_SCHEMA, MAX_FILE_BYTES, MAX_PROOF_LENGTH,
    normalizeAddress, normalizeDigest, encodeGetRecord, encodeRegister, encodeRevoke, decodeRecord,
    hashFile, createProof, parseProof,
  });
})();
