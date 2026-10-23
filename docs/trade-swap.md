# Trade / Swap — NODUS and BNB testnet workbench

The `#trade` area prepares buy/sell agreements between **Nodus testnet** and
**BNB Smart Chain testnet (chain 97)**. It has a local offer book, public offer
import/export, separate private recovery files, a two-leg simulator, transaction
plans, and the complete compiled contracts and ABIs. It works without monitoring
or network access. FIN/ENG and mobile layouts use the Observatory shell.

This first version is preparation software. It does not connect wallets, publish
a shared order book, verify live chain state, deploy contracts or send payments.
A public offer is an unsigned proposal, not evidence of a funded swap. The actual
contracts can be deployed separately with the named testnet wallets. Do not infer
network settlement from a successful simulation.

## Parties and trade directions

An offer fixes both parties' Nodus EVM addresses (32 bytes), BNB addresses
(20 bytes), native coin amounts, hashlock, trade ID, chain identities and deadlines.
The maker creates the secret and always funds the longer leg first:

| Offer | Maker's longer leg | Taker's shorter leg | Maker's first claim |
|---|---|---|---|
| Sell NODUS | NODUS → taker | tBNB → maker | tBNB |
| Buy NODUS | tBNB → taker | NODUS → maker | NODUS |

The maker claims the shorter leg with the preimage. The taker learns it from the
claim and claims the longer leg. Neither chain queries the other. No wrapped
asset or foreign-signature verification is needed.

## Secret and offer handling

`nodus-trade/offer-v1` contains public terms only. The 32-byte preimage is generated
with the browser CSPRNG and hashed as **SHA-256 of its 32 raw bytes**, never its hex
text. Each newly created offer has a fresh preimage and trade ID. Browser storage
keeps public offers only (50 entries, bounded catalog); a failed or malformed
catalog is retained. In that case keep the newly prepared offer by exporting it.

The private `nodus-trade/recovery-v1` file contains the offer AND preimage. Download
it before closing the page, store it privately, and never send it as the public
offer. Reloading does not restore the preimage from browser storage; explicitly
import the recovery file. A public offer cannot restore the secret. Import rejects
unknown fields, wrong networks, invalid addresses, amounts and unsafe deadlines.
Offer names are inert user text. The example button uses labelled fictional
addresses and local simulation only; enter actual testnet addresses in New offer
for a separately deployed test.

Deadlines are fixed at offer creation, not at deposit: maker +24 h, taker +12 h.
The client validates at least a 2 h difference. The contracts allow each lock to
be opened from 1 h to 7 days before its refund deadline. An old offer therefore
cannot necessarily be funded later. These defaults are a test policy, not a
measurement proving a suitable margin for a production network.

## Contracts

`contracts/trade/ObservatoryNodusSwap.sol` is compiled with exactly
`0.8.30+nodus.addr256.commit.73712a01.Linux.g++`, Prague, optimizer 200.
`ObservatoryBnbSwap.sol` is compiled with standard Solidity 0.8.30, Paris,
optimizer 200. Both use metadata bytecodeHash=none. Each is standalone,
constructor-free, immutable code with no administrator or upgrade path.

Each deployed contract can hold many independent swaps; no deployment per pair
or per user is required. The namespace is `(funder, tradeId)`, so another funder
cannot front-run and reserve your ID. An ID cannot be reused by that funder even
after settlement. Native coins only; no ERC-20 or BEP-20 in this version.

| Function | Rules |
|---|---|
| `open(bytes32,address,bytes32,uint64)` | Payable; exact paid amount stored; nonzero ID/hash/recipient; recipient differs from funder and this contract; deadline in allowed range; unused funder/ID. |
| `claim(address,bytes32,bytes32)` | Only the recorded recipient; correct preimage; locked status; strictly before deadline. Emits the secret and pays the fixed amount. |
| `refund(bytes32)` | Only the original funder; locked status; at or after deadline. Pays original funder. |
| `getSwap(address,bytes32)` | Recipient, amount, hashlock, refundAt, status: Empty=0, Locked=1, Claimed=2, Refunded=3. |
| `lockedTotal()` | Sum of unresolved credited deposits. Unsolicited forced surplus does not alter per-swap amounts. |

Both contracts check their configured chain ID when opening. BNB mainnet (56)
is refused. Nodus testnet is pinned to chain ID
`a48d1a785500a1cdecd739ecd53ef0e95b1dc4a7a300f49176a7fa25ae176114`, from
nocdem/dna@2e881cc6e6d7a5050cc10400afc2b883f8fb712a,
`web-wallet/src/nodus/send-module.js`. Nodus amounts are multiples of 10^10 EVM
wei (one native raw unit); BNB uses 18 decimals. No floating point money.

State changes precede value calls, and all mutations have a reentrancy guard.
Failed payouts revert the whole call, preserving the deposit and its status.
There is no owner sweep, pre-deadline cancellation or automatic refund timer.
Refunds and claims require actual transactions and fees.

## Verify before revealing

A future network adapter must independently read both locks and check chain ID,
deployed runtime against the compiled artifact, funder, recipient, trade ID,
amount, SHA-256 hash, status and refund deadline. Verify confirmed/finalized chain
state, not a transaction screenshot or a pending submission. Both must remain
claimable with sufficient time for the second claim. `NodusTradeCore.verifyLock`
implements the term comparison, but this release has **no live adapter**; its
`confirmed` and `runtimeVerified` inputs must eventually come from that adapter.
It is not a chain-proof verifier. The maker must never publish the preimage
before those checks. Monitor to settlement; a timeout requires a refund call.
Chain stalls, reorganizations, an unavailable wallet and transaction censorship
are assumptions the timeout policy must handle. HTLCs do not promise simultaneous
confirmation or compensate price changes or network fees.

## Reproduce the contract checks

```sh
npm ci --prefix tools/trade
NODUS_SOLC=/path/to/solc-nodus node tools/trade/build.mjs --check
node tests/trade/core.mjs
node tests/trade/integration.mjs
node tests/trade/contracts.mjs
```

The pinned Nodus compiler archive is
https://nodusnetwork.io/downloads/nodus-solc-0.8.30-nodus.addr256-linux-x86_64.tar.gz
SHA-256: `a09d6486c944a795009f08dbc8210ce2eee2785248f9f5f7edc2aaa9c6934649`.
`build.mjs` rebuilds both outputs and byte-compares the committed JS artifact;
normal frontend use requires no Node packages.

The independent native-engine execution test requires the exact upstream checkout
and build dependencies (C/C++, OpenSSL development headers, make, m4, xxd):

```sh
# In a disposable nocdem/dna checkout at the pinned revision:
git sparse-checkout set shared/evm shared/crypto/sign shared/crypto/hash shared/crypto/utils
# In this repository:
NODUS_EVM_ROOT=/path/to/dna node tools/trade/test-nodus.mjs
```

BNB tests execute actual bytecode in local Ganache: funder namespaces, authorization,
payout and secret event, replay, exact claim/refund boundary, failed-payment rollback,
reentrancy and mainnet refusal. The Nodus C test uses the upstream engine and its
memory backend with high-byte addresses and low-20-byte twins, SHA-256 verification,
Nodus dust limits, amount accounting, payout, event preimage and boundary tests.
The test harness borrows helpers from the pinned upstream `test_contract_lib.c`;
it does not modify that file. Neither is a live two-network execution or external
audit. Engine execution does not cover real envelopes, network fees, RPC trust,
wallet signing, cross-chain monitoring or the withdrawal bridge.

## Installation

The ordinary Observatory installer copies the new static files with `dist/`.
Node packages are development-only. No new service, database, secret or listening
port is added. The frontend's only existing network traffic remains monitoring;
Trade/Swap itself does not send a request. Nodus and PQ-NAS need no changes.
