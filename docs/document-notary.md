# Document registry — experimental testnet feature

**English** · [Suomi](document-notary_fin.md)

The document registry records a publisher's claim about a file's SHA-256 digest
in a Nodus smart contract. Select a file again later to check whether its exact
bytes match the selected publisher's registration. This does not upload or
store the document itself, establish the publisher's real-world identity or
certify the truth of the document's contents.

This feature belongs to `feature/contract-studio`; it is experimental and is
not merged into `main`. It has no IMS integration. The earlier visual escrow
editor remains available under **Examples**, at `#contracts-escrow`, for study
and simulation. The default `#contracts` page opens the document workflow.

## What the result means

| Result | Meaning |
| --- | --- |
| Matching registration | The selected node reports a record for this exact digest, publisher address and registry contract. |
| No registration found | That registry has no record for that publisher and digest in the node's current state. This is not proof that no one registered it elsewhere. |
| Revoked | A record exists, but its publisher has marked it revoked. The original recorded block and timestamp remain. |
| Query unavailable | Verification could not be completed. An unavailable or malformed answer is not treated as an absent registration. |

A file that merely **looks** the same need not have the same digest. Saving a
PDF again, changing its metadata or adding a digital signature changes its
bytes. A scan of a printed document is a different file. Keep the original
registered file if exact-byte verification matters.

The stored block number and timestamp are the values seen by the contract
when `register` executes. They support a claim that the matching content was
available by the time that block was committed. They do not establish the
file's creation date, exact civil-clock time, authorship, ownership, legal
validity or factual accuracy. A publisher can register a false document too.

## 1. Prepare a file locally

Open **Contract Studio** and select a file in the document workflow. The browser
computes SHA-256 using Web Crypto; the file's contents do not leave the browser.
The current limit is **64 MiB** per file. A secure browser context is required:
HTTPS, or the local loopback address used by the monitor.

The digest is public once registered. Although it does not reveal the file
directly, anyone who already has or can guess a candidate file can compute its
digest and test for a match. Do not treat hashing as encryption or a guarantee
that the existence of a predictable document stays secret.

Choose a **registry contract address** and the **publisher's Nodus EVM address**.
Both are `0x` followed by 64 hexadecimal digits. A native Nodus wallet fingerprint
with 128 hexadecimal digits is a different identifier. The publisher is the
wallet that will call `register`, not the monitor's storage-node identity.

## 2. Deploy a registry once, or use an existing trusted registry

The source is [ObservatoryDocuments.sol](../contracts/ObservatoryDocuments.sol).
The UI provides its actual ABI and creation bytecode, compiled with Nodus's
address256 Solidity compiler. The reproducible reference bundle is
[document-registry.json](../dist/document-registry.json); it includes the source
SHA-256, compiler version and binary hash, runtime bytecode and runtime SHA-256.
These artifact hashes describe the distributed files, not an on-chain
verification of a deployed contract.

To deploy your own registry:

1. Review the source and export the registry's ABI and **creation bytecode**.
2. Open the official [Nodus wallet's smart-contracts page](https://wallet.nodusnetwork.io/#contracts), unlock the wallet and select Nodus if needed.
3. Paste the ABI into **ABI** and creation bytecode into **Bytecode**. Choose **Deploy…**.
4. The contract has **no constructor arguments** and takes **zero NODUS value**. Use the wallet's **Review deployment** flow and check its fee before confirming.
5. Wait for the wallet to report successful inclusion and keep the resulting contract address with your exported artifacts.

The wallet signs and submits transactions. Observatory does not request a seed
phrase, private key or node identity, and does not deploy the contract on your
behalf. Native NODUS is needed for network fees. No document principal needs to
be moved into the EVM account: these contract functions are nonpayable and do
not transfer funds. An included transaction that reverts can still pay a fee.

For an existing registry, obtain its address and implementation from a source
you trust. A contract at an arbitrary address can return fabricated records.
The current Nodus CLI does not expose runtime bytecode or a runtime code hash,
so this monitor **does not automatically authenticate deployed contract code**.
Selecting the expected address and trusting its implementation is part of the
verification context. The bundled runtime hash is not a substitute for reading
the deployed code independently.

To reproduce the bundled artifacts with the separately obtained official
compiler, run this from the repository checkout:

```bash
python3 tools/contract-studio/compile.py contracts/ObservatoryDocuments.sol \
  --contract ObservatoryDocuments \
  --solc /absolute/path/to/solc-nodus \
  --out document-registry-build
```

The output directory must not already exist. Use
`ObservatoryDocuments.abi.json` and `ObservatoryDocuments.creation.hex` from
that output for wallet deployment. The [compiler instructions](contract-studio.md#compile-offline-with-nodus-solc)
explain the official address256 compiler download and pinned hashes. A stock
Ethereum compiler uses the wrong address width and must not be substituted.

## 3. Register the digest through the wallet

1. In the wallet's smart-contracts page, paste the deployed registry address and the same ABI, then choose **Open contract**.
2. Find `register(bytes32)` and paste the selected file's complete `0x`-prefixed SHA-256 digest into `digest`.
3. Use the publisher's wallet, choose **Review**, check the contract address and digest, then confirm there.
4. Wait for a successful included transaction. In Observatory, use the same registry address, that wallet's EVM address and the file, then request a fresh chain check.

Opening the wallet or copying calldata does not submit a registration. A saved
request or reference JSON is not confirmation that anything was recorded.
Only the wallet's transaction flow can perform the signed write in this
version. No contract-transaction prefill URL was found in the reviewed wallet
source. The wallet link opens its contracts page and the values are copied
explicitly.

The contract keys records by **publisher address and digest**. Another publisher
can register the same digest under their own address, without taking over or
overwriting your record. Each publisher can register a particular digest only
once. Registration is not exclusive copyright or a claim to be the first person
who ever possessed that content.

## 4. Check the file later

Select the original file again, enter the same registry and expected publisher,
and request a live read. The monitor's fixed read-only endpoint queries the
local node. It sends the digest and public addresses; **it does not send the
file**. A successful answer includes whether the record exists, its recorded
block number and timestamp, revocation status, and the node's query height.

These are **node-reported results**, not an independently verified cryptographic
inclusion proof. The upstream EVM read API reports a node's committed tip;
its receipt self-consistency check does not by itself bind the result to a
verified chain commitment. Check the network identity as well as the contract
and publisher. The network identity is taken from a recent collector snapshot,
not cryptographically bound to the getter's response. The snapshot must be at
most 180 seconds old and report the node synchronized; the live query height
must not be behind it. A synchronized node can still lag by up to two blocks,
so a new registration may require another check. A testnet reset, a different
chain, a different registry or an unavailable node can prevent a later lookup
from reproducing an earlier result.

An exported **reference JSON** helps remember the digest, registry, publisher,
network pin and any recorded result. It contains no document bytes and can be
edited by anyone. Importing it can restore the lookup context, but **does not
prove a registration**: the program must calculate the file digest and perform
a fresh chain query. Preserve the original file and lookup context separately.

For a direct read with a current EVM-capable Nodus CLI:

```bash
nodus-cli -s 127.0.0.1 -p 4001 evm call \
  0xREGISTRY_ADDRESS_64_HEX \
  'record(address,bytes32)(bool,uint256,uint256,bool)' \
  0xPUBLISHER_ADDRESS_64_HEX \
  0xFILE_SHA256_64_HEX
```

Replace the illustrative values with actual 32-byte values. This command uses
an ephemeral session identity when no `-i` is provided; it needs no wallet key
and does not sign a state-changing transaction. The result list is, in order:
`exists`, `blockNumber`, `timestamp`, `revoked`. A successful read of a missing
record returns `false, 0, 0, false`; a failed query must not be interpreted as
that result. The web endpoint fixes the method and validates each parameter;
it is not a general-purpose RPC, compiler or transaction proxy.

## Revocation

The original publisher can call `revoke(bytes32)` in the official wallet with
the same digest. Review and confirm the transaction there. Revocation is
**irreversible** in this template: it neither deletes the original entry nor
allows re-registration of that publisher/digest pair. A different publisher
cannot revoke your record. An updated document has a new digest and needs its
own registration.

## Upstream references and scope

The upstream investigation uses `nocdem/dna` revision
`908f76102ac3ded448f2c87ac72772e0c02642c0`:

- [Wallet ABI, deployment and function-call forms](https://github.com/nocdem/dna/blob/908f76102ac3ded448f2c87ac72772e0c02642c0/web-wallet/src/evm/ui.js)
- [Wallet contracts-page routing](https://github.com/nocdem/dna/blob/908f76102ac3ded448f2c87ac72772e0c02642c0/web-wallet/src/app.js)
- [CLI read-only calls, output decoding and ephemeral identities](https://github.com/nocdem/dna/blob/908f76102ac3ded448f2c87ac72772e0c02642c0/nodus/tools/nodus-cli.c)
- [Upstream read/receipt trust limits](https://github.com/nocdem/dna/blob/908f76102ac3ded448f2c87ac72772e0c02642c0/web-wallet/src/evm/rpc.js)
- [Nodus compiler and 32-byte addresses](https://github.com/nocdem/dna/blob/908f76102ac3ded448f2c87ac72772e0c02642c0/nodus/tools/evm/solc/README.md)
- [Pinned wallet testnet identity](https://github.com/nocdem/dna/blob/908f76102ac3ded448f2c87ac72772e0c02642c0/web-wallet/src/nodus/send-module.js)

The contract has no administrator, upgrade mechanism, arbitrary file storage,
document parsing, identity verification, automatic signing or IMS connection.
Compilation and automated checks do not constitute an audit or establish that
a live testnet deployment and registration have already succeeded.
