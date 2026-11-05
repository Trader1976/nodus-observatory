# Trade / Swap — NODUS and USDT on BNB Smart Chain

The `#trade` area prepares NODUS buy/sell agreements priced in USDT on BNB Smart
Chain (BSC). The executable development profile is **Nodus testnet + BSC testnet
97 + TEST-USDT**. TEST-USDT is our freely minted 18-decimal mock token; it has no
monetary value. BSC transaction fees are paid separately in tBNB.

The intended mainnet quote asset is **Binance-Peg USDT (BSC-USD)** on BSC 56,
contract `0x55d398326f99059ff775485246999027b3197955`, with 18 decimals. This is a
Binance-pegged representation, not Tether-issued USD₮ on Ethereum or Tron. The
mainnet entry is information only: this release does not enable chain 56 or trade
real USDT. Token identity always includes network and contract address; the name
USDT alone does not identify an asset. See the [BNB Chain token reference](https://github.com/bnb-chain/mpp-sdk#tokens)
and [Tether's issuer protocol list](https://tether.to/en/supported-protocols/).

## What is available

The local workbench includes public offer import/export, separate private recovery
files, saved offers, exact token units, an approval/lock/claim/refund simulator,
transaction plans, and compiled Solidity contracts and ABIs. The FIN/ENG interface
uses the Observatory shell and works on mobile.

The P2P preparation flow adds advertisements shared by users of this Observatory
installation, short reservations, trade sessions, wallet request preparation and
read-only chain observations. A public
advertisement or reservation is **unsigned, unverified metadata**. It is not proof
of wallet ownership, available funds, an on-chain lock or a completed swap. The
board never holds funds. An offer-file exchange can still be used without it.

A browser BSC wallet connection can prepare deployment of the mock token and its
swap, mint free test tokens and request explicit approval for supported chain-97
actions. The wallet must already be on BSC testnet 97; the app refuses other
networks. Connection alone sends no transaction. The Nodus wallet handoff is an unsigned developer request; the
official Nodus wallet does not currently import it as a supported third-party
transaction format. The current Nodus CLI can read a lock and the contract clock,
but cannot return the deployed runtime code. Its chain identity also comes from
the local collector snapshot rather than an independently verified query.
Without verified Nodus code and confirmed lock observations, the application
blocks funding and secret revelation. A successful simulator run does not remove this blocker.

No mainnet payment or live two-chain settlement is claimed by these features.
The [wallet integration contract](trade-wallet-request.md) separates implemented
preparation from the remaining Nodus verification and signing requirements.

## Parties and trade directions

An offer fixes both parties' Nodus EVM addresses (32 bytes) and BSC addresses
(20 bytes), exact amounts, BSC token identity, hashlock, trade ID and deadlines.
The maker creates the secret and funds the longer leg first:

| Offer | Maker's longer leg | Taker's shorter leg | Maker's first claim |
|---|---|---|---|
| Sell NODUS | NODUS → taker | TEST-USDT → maker | TEST-USDT |
| Buy NODUS | TEST-USDT → taker | NODUS → maker | NODUS |

The maker claims the shorter leg using the preimage. The taker learns the preimage
from that claim and claims the longer leg. Each coin or token stays on its own
network. The two contracts do not call or verify one another.

Before a BSC token lock, the funder approves the verified swap contract for the
**exact token amount**, then calls `open` with zero native value. An existing
nonzero allowance may require a separate `approve(spender, 0)` before setting the
new allowance; the exported plan includes this zero-reset step. Do not approve an
unverified spender or use an unlimited allowance. A refund returns tokens; the
network does not return transaction fees.

## Try the local workbench

1. Select **Create example**. Its wallet and token addresses are fictional.
2. Open **Rehearse swap → Start simulation**.
3. Approve the exact test-token amount before the BSC leg, then lock the maker's
   funds first and the taker's funds second.
4. Test a wrong secret, claim the shorter leg as maker and then the longer leg as
   taker, or reset and advance to the refund deadlines.

For a separately deployed test, create a new offer with four actual test-wallet
addresses and the deployed `MockUsdt` address. The token profile is fixed to BSC
97 and 18 decimals. A Nodus 128-hex-character fingerprint is not its 32-byte EVM
address. Simulated approvals and deposits are never sent to a wallet or network.

## Offers, sessions and recovery

`nodus-trade/offer-v2` carries public terms only. Its `asset` object is exactly:

```json
{
  "kind": "bep20",
  "chainId": 97,
  "token": "0x<40 hexadecimal characters of the deployed test token>",
  "decimals": 18,
  "symbol": "TEST-USDT"
}
```

The offer uses `usdtAmount` and party addresses `{nodus, bsc}`. Amounts are decimal
strings, never floating-point calculations. TEST-USDT has 18 decimals; do not reuse
the six-decimal assumption from Ethereum USDT. One NODUS is 10^8 native raw units
or 10^18 EVM wei. Token units are not BNB `msg.value`.

The browser stores at most 50 public offers in `nodus-trade/book-v2`. The old v1
BNB catalog remains untouched and can be downloaded with **Export old BNB offers**.
Old BNB offers and recovery files are rejected for the new flow. There is no
automatic BNB-to-USDT reinterpretation or conversion.

The 32-byte secret is generated with the browser CSPRNG and hashed as SHA-256 of
32 raw bytes, not its hex text. The private `nodus-trade/recovery-v2` file contains
the offer and secret. Export it before closing, keep it private and never publish
it with an advertisement. Public offers, board entries and public session files
must not contain the private preimage. Importing a public file does not restore it.
A failed or malformed browser catalog is retained; export prepared files if local
storage is unavailable.

Deadlines start at offer creation, not funding: maker +24 h and taker +12 h. The
client requires at least a 2 h difference. A lock may open only 1 h to 7 days
before its refund deadline. Stale offers need new terms; a reservation does not
restart an on-chain deadline. The default intervals are a test policy, not a
measurement establishing production-safe timing.

Public advertisements have a whole-offer reservation lasting up to 10 minutes
(or the remaining advertisement lifetime, if shorter). Expired reservations free
the advertisement for another reservation. The private management capability
allows its holder to remove an advertisement when no active reservation exists.
Neither expiry nor removal cancels a contract lock. The capability is not a
wallet signature or evidence that its holder owns the advertised wallet.

## Contracts and deployments

| Artifact key | Contract | Constructor |
|---|---|---|
| `nodus` | `ObservatoryNodusSwap` | none |
| `bsc` | `ObservatoryBscUsdtSwap` | deployed token address |
| `mockUsdt` | `MockUsdt` | none |

The Nodus contract is compiled with exactly
`0.8.30+nodus.addr256.commit.73712a01.Linux.g++`, Prague, optimizer 200. The BSC
contracts use standard Solidity 0.8.30, Paris, optimizer 200. All use
`metadata.bytecodeHash=none`. New Nodus deployments include `currentBlockTime()`;
an old deployment from the native-BNB prototype does not have this getter and
cannot be substituted for the current artifact.

Deploy `MockUsdt` on chain 97 first, then pass its address to the BSC swap
constructor. `faucet()` mints 1,000,000 TEST-USDT to its caller per call and can be
repeated. It is deliberately unbacked test money. The BSC swap fixes one
18-decimal token at deployment and has no token setter, owner or upgrade path.
Its runtime is the same across token deployments, so a runtime match alone is
insufficient: verify `token()` and the token's code and decimals separately.

Each swap deployment can hold many independent trades. The namespace is
`(funder, tradeId)` and cannot be reused after settlement.

| Function | Rules |
|---|---|
| Nodus `open(bytes32,address,bytes32,uint64)` | Payable; exact native amount, in multiples of 10^10 EVM wei. |
| BSC `open(bytes32,address,bytes32,uint256,uint64)` | Nonpayable; approved exact token amount transferred from the funder. |
| `claim(address,bytes32,bytes32)` | Recorded recipient only; correct preimage; strictly before refund deadline. Emits the preimage and pays the fixed amount. |
| `refund(bytes32)` | Original funder only; at or after refund deadline. |
| `getSwap(address,bytes32)` | Recipient, amount, hashlock, refundAt and status: Empty=0, Locked=1, Claimed=2, Refunded=3. |
| Nodus `currentBlockTime()` | Execution block clock used for contract deadlines; not the browser clock. |
| `lockedTotal()` | Sum of unresolved credited deposits in that deployment's units. |

The BSC contract accepts standard true-return and legacy no-return token transfers.
False, malformed or reverted results fail. Balance deltas must match the exact
amount for sender, escrow and recipient; transfer-tax, rebasing and dishonest
tokens are unsupported. Failed transfers roll back status and accounting. All
mutations are guarded against reentrancy. There is no administrator sweep,
pre-deadline cancellation or automatic refund transaction.

### Manual Nodus test deployment

Use private **test-wallet** keys on the machine where they are already held. Do
not upload keys or a seed to Observatory or the board. Inspect the installed CLI's
`nodus-cli evm` usage and perform a dry run first:

```sh
nodus-cli evm deploy   --solc contracts/trade/ObservatoryNodusSwap.sol:ObservatoryNodusSwap   --solc-bin /path/to/solc-nodus   --keys /private/test-wallet-keys   --dry-run
```

For an operator-reviewed test deployment, replace `--dry-run` with
`--submit NODE_IP:4001`. Record the successful receipt, deployed address, source,
compiler settings and artifact hashes. Receipt acceptance and a predicted address
do not replace runtime-code verification. The CLI can prepare a native-to-EVM
balance deposit with `evm deposit <raw>` and later withdraw with
`evm withdraw <raw>`; both are separate transactions with fees and the same
`--keys` / dry-run or submit discipline. Funding an EVM balance is distinct from
locking that balance in the swap.

## Verify before funding or revealing

A live adapter must independently read both chains and bind every observation to
the current offer and configured contract addresses. Check chain identity,
deployed runtime, funder, recipient, trade ID, amount, hashlock, status, deadline
and the BSC token address/decimals. Use confirmed/finalized chain state and the
chain's execution clock. Keep enough time for the second claim and recovery.

`NodusTradeCore.verifyLock` compares supplied observations with terms; it is not a
chain-proof verifier. Browser simulation, imported booleans, transaction hashes,
screenshots, advertisements and wallet-request files do not prove code or funding.
In particular, the current CLI has no deployed-code read, so a successful Nodus
`getSwap`/clock read remains unverified and must not unlock funding or disclosure.

A claim can expose the secret to a wallet, an RPC simulation or pending calldata
before it is mined. Do not send claim calldata for estimation until both locks
and the remaining time margin have passed the same checks. Keep monitoring to
settlement. Expiry makes a refund callable; it does not send the refund for you.

## Reproduce the checks

```sh
npm ci --prefix tools/trade
NODUS_SOLC=/path/to/solc-nodus node tools/trade/build.mjs --check
node tests/trade/core.mjs
node tests/trade/integration.mjs
node tests/trade/contracts.mjs
```

The pinned compiler archive is
https://nodusnetwork.io/downloads/nodus-solc-0.8.30-nodus.addr256-linux-x86_64.tar.gz
with SHA-256 `a09d6486c944a795009f08dbc8210ce2eee2785248f9f5f7edc2aaa9c6934649`.
The build regenerates all three artifacts and byte-compares them with the
committed bundle. Normal frontend use does not need Node packages.

For the native Nodus engine check, use upstream
`nocdem/dna@2e881cc6e6d7a5050cc10400afc2b883f8fb712a` and build dependencies
C/C++, OpenSSL headers, make, m4 and xxd:

```sh
# In that disposable upstream checkout:
git sparse-checkout set shared/evm shared/crypto/sign shared/crypto/hash shared/crypto/utils
# In this repository:
NODUS_EVM_ROOT=/path/to/dna node tools/trade/test-nodus.mjs
```

The standard-EVM tests execute the BSC bytecode with token allowance, exact
payout/refund, authorization, deadline, failed-transfer and reentrancy cases. The
Nodus test executes its actual bytecode with high-byte 32-byte addresses,
SHA-256, native dust limits, accounting and deadline boundaries. Local tests are
not a live two-network wallet test or an external audit.

## Installation

The ordinary Observatory installer copies frontend files from `dist/` and the
bounded read-only/board backend. The board uses SQLite at
`<state_dir>/trade/board.sqlite3`; it does not store wallet keys or trade secrets.
It holds at most 100 active advertisements. A create response returns a private
management token once; the server stores its SHA-256 hash, not the raw token.
Download the management file before closing the page.

Board writes use the monitor's same-origin/CSRF checks; this does not authenticate
a wallet owner. Keep the existing authenticated access proxy for remote users.
The board is not a globally distributed order book or an authenticated exchange.
Node packages are development-only. The feature does not change Nodus node
identity or PQ-NAS data and does not create a signing-key service. The observation
route accepts only bounded reads with fixed testnet providers, not arbitrary RPC
methods or destinations.
