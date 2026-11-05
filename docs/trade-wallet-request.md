# Trade wallet handoff and observations

This document describes the Observatory testnet integration boundary. It is a
developer handoff format, **not a format already accepted by the official Nodus
wallet**. It does not grant signing authority and does not carry a seed or key.
Current executable assets are Nodus testnet and the exact deployed `MockUsdt`
profile on BSC 97. Mainnet Binance-Peg USDT is not enabled.

## Current paths

| Path | Implemented behavior | Limit |
|---|---|---|
| Local simulator | Exact token approval, locks, claims and refunds | No network transaction or proof |
| Shared board | Publish, reserve and remove public advertisements in this Observatory installation | No wallet ownership or funds verification |
| BSC injected wallet | Connect on chain 97, prepare mock/swap deployment and faucet, review and explicitly submit supported requests | User approves each transaction; submitted hash is not confirmation |
| BSC observation | Read chain ID, finalized state, exact swap and mock runtime, fixed token and decimals | Relies on configured RPC responses, not a light-client proof |
| Nodus CLI observation | Read `getSwap` and `currentBlockTime()` from the configured local node | Deployed runtime unavailable; chain ID is collector-snapshot metadata, not independently verified |
| Nodus unsigned request | ABI-encoded developer handoff when required checks pass | No third-party official-wallet import/signing bridge is installed |

The Nodus limitation is an intentional blocker. A returned state row is shown as
unverified, with `confirmed: false`, `runtimeVerified: false`, `runtime: null` and
`blocker: "nodus_runtime_unavailable"`. It cannot authorize either chain's funding
or a secret-bearing claim. BSC token approval and a verified BSC timeout refund do
not rely on an unavailable Nodus signature bridge. Mock-token deployment/faucet
are separate test setup actions, not a cross-chain trade.

The upstream JavaScript SDK has a code-read operation, but it is not installed or
trusted implicitly by Observatory. Its Node/WASM build and authenticated node
connection require a separately reviewed integration. Do not emulate code
verification by setting a browser boolean to true.

## Public session format

`nodus-trade/session-v1` has exactly these top-level keys:

| Key | Contents |
|---|---|
| `schema` | `nodus-trade/session-v1` |
| `offer` | Strict validated `nodus-trade/offer-v2` |
| `contracts` | `{nodus, bsc}` deployed swap addresses, 32/20 bytes respectively |
| `transactions` | Up to 128 `{chain, action, hash, submittedAt}` records |

The two contracts must be the deployments that the parties independently agree
to use. BSC swap address and token address must differ. A session contains no
secret, wallet key or cached observation. Importing it always requires fresh
network reads. Transaction records are references, not receipts or verified
settlement. Unknown keys are rejected rather than silently retained.

The API is `NodusTradeSession.createSession(offer, contracts)`,
`validateSession`, `exportSession`, `importSession`, `recordTransaction`,
`inspect(session, observations, now)` and asynchronous
`request(session, chain, action, observations, options)`.

## Unsigned transaction requests

For session actions `approve`, `open`, `claim` and `refund`,
`nodus-trade/wallet-request-v1` contains:

| Key | Meaning |
|---|---|
| `chain`, `chainId` | `nodus` with the pinned 32-byte chain ID, or `bsc` with `97` |
| `action`, `offerId` | Intended operation and current public offer ID |
| `from`, `to` | Exact signing account and destination contract/token |
| `data` | Canonical ABI calldata, including a 32-byte Nodus address where required |
| `valueWei` | Native value as a decimal integer string; zero for token operations |
| `assetToken` | BSC token address, present for BSC requests |
| `summary` | Human-readable review text; calldata and terms remain authoritative |
| `notSent` | Always `true` when prepared |
| `containsSecret` | True for a claim; exported claim files must remain private |
| `independentVerification` | `false`: observations are node/RPC answers, not cryptographic light-client proofs |
| `preparedAt`, `expiresAt`, `validUntil` | Unix seconds; request is usable for no more than 30 seconds and within its observation lifetime |

A request is ephemeral. An expiry does not undo an already submitted transaction.
After account, network, offer, contract or observation changes, discard the
request and prepare it again. The BSC wallet adapter checks the selected account,
chain, exact supported runtime/token and canonical calldata before submission.
For non-claim actions it estimates gas, then opens the wallet's transaction approval.
For claims it uses a bounded gas limit without an extra estimate; the wallet may
still simulate the request itself. Cancelling a wallet prompt cannot restore
secrecy once the preimage reached a provider. Deployment and
faucet requests use the same request schema with action-specific setup fields;
they do not represent offer funding or settlement.

A claim request contains its preimage in `data`. Exporting it, requesting an RPC
simulation or broadcasting it can disclose the preimage before confirmation.
Treat **Prepare claim**, private export and wallet submission as disclosure
boundaries. Never generate claim calldata before both locks, their code, exact
terms and remaining time margin pass the checks. The taker's second claim uses
the preimage revealed by the first claim; the public session does not store it.

No imported JSON may authorize a transaction solely by declaring `confirmed`,
`runtimeVerified`, `notSent` or `independentVerification`. A wallet integration must
obtain and compare chain data itself. Wallet rejection sends nothing; a transport
error after submission may leave the outcome unknown. Inspect the chain before
trying again, so a lost response does not become an unintended repeated action.

## Read-only observation route

```text
GET /api/trade/observe?chain=nodus&contract=...&funder=...&trade_id=...
GET /api/trade/observe?chain=bsc&contract=...&funder=...&trade_id=...&token=...
```

Only those keys and supported testnets are accepted. Token is required for BSC
and forbidden for Nodus. No request contains a claim secret, arbitrary RPC method,
user-selected endpoint or shell command. The server uses bounded output, timeouts
and concurrency; it does not load signing keys or submit transactions.

The BSC path checks chain 97, a finalized block, swap runtime, `token()`, mock
runtime, `decimals() == 18` and the swap row. It checks the latest row has not
changed and re-reads the finalized block hash. The frontend compares runtime
bytes to the compiled artifacts. The current implementation uses fixed official
BSC-testnet RPC providers with fallback; this is availability fallback, not
agreement by multiple independent providers.

The Nodus path uses the configured local CLI and node to call the swap and its
execution clock. It also requires a fresh, synchronized collector snapshot with
the pinned chain identity. These are useful diagnostics but do not fix the missing
runtime read or turn the snapshot into a chain proof.

`inspect` requires exact offer/contract binding, supported state, observation
freshness of at most 30 seconds, chain-clock agreement within 120 seconds and
sensible nonzero block heights. The first secret-bearing claim requires both
locks and at least the configured two-hour claim margin. Browser time alone
cannot establish that a chain deadline has passed.

## Requirements for an official Nodus wallet integration

The wallet owns keys, account selection and the final transaction approval. A
future integration needs the following operations, all bound to one selected
account and the pinned testnet chain:

| Operation | Required behavior |
|---|---|
| Account and chain read | Return the full 32-byte EVM address and authenticated chain identity; never truncate to an Ethereum address |
| Deployed-code read | Return the actual runtime at the agreed contract and a usable confirmed state reference |
| Lock/clock reads | Return exact `getSwap` fields and execution time at a consistent state reference; distinguish unavailable data from an empty swap |
| Native-to-EVM deposit | Explicitly reviewed native raw amount and fee, independently from locking; one NODUS = 10^8 raw = 10^18 EVM wei |
| Nodus lock | Review `open(bytes32,address,bytes32,uint64)`, exact native value and fee; enforce role, terms and stage |
| Nodus claim | Review `claim(address,bytes32,bytes32)` only after cross-chain checks and disclosure consent |
| Nodus refund | Review `refund(bytes32)` for the funder, after the execution-clock deadline |
| EVM-to-native withdrawal | Explicitly reviewed withdrawal after payout; separate from HTLC settlement and public session format |
| Confirmation and recovery | Read receipt/state, distinguish pending/reverted/unknown, retain transaction references, and allow recovery without the board |

BSC token operations require token identity, decimals and approved spender checks,
an exact allowance (including a zero reset where needed), token lock, claim and
refund. BNB pays network fees. No cross-chain contract call or wrapped NODUS is
required, but both network observations must be trustworthy enough for the
application's chosen confirmation policy.

A wallet implementation must decode and display the actual calldata and amounts,
refuse unsupported networks and stale requests, and re-check account and chain
immediately before signing. It must not substitute an imported success flag for
these checks. The native wallet's withdrawal flow remains separate: receiving
NODUS in the EVM domain does not automatically withdraw it to native UTXOs.

## Shared advertisement API

```text
GET  /api/trade/board
POST /api/trade/listings
POST /api/trade/reserve
POST /api/trade/cancel
```

The board is local to the server. A listing contains public maker addresses,
amounts, direction, test-token identity and expiry. It publishes no maker preimage,
hashlock or proposed taker. Reserving supplies a taker's two addresses and
atomically reserves the entire advertisement for at most ten minutes. Addresses
are still unverified. The maker can copy a reservation to a **fresh** offer with
new secret, hashlock and deadlines, review it and share the public offer/session.

The create response returns a private management capability once. Its SHA-256
hash is stored server-side. The raw token is absent from board reads and must be
kept in the private management file. The holder can cancel the advertisement
when no reservation is active. Advertisements expire within seven days; the UI
creates a one-day advertisement. Expired/cancelled advertisements are excluded
from public reads. Cancellation and expiry never call either chain or return
locked funds.

The backend uses the monitor's Origin/Host/CSRF protections for writes. Remote
access still needs the existing authenticated proxy. CSRF is not wallet
ownership authentication. A reservation is coordination, not collateral or an
on-chain order, and the board provides no global discovery or automatic matching.
