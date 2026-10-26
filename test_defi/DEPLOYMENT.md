# Manual Nodus testnet deployment

[Suomeksi](DEPLOYMENT_fin.md) · [Feature guide](README.md)

This guide describes an operator-run test with **OSD6**, a separate EVM token.
It does not use the native tUSDT already in Nodus Wallet. OSD6 has no backing,
redemption or monetary value. The Observatory page remains a local simulator;
the steps below run manually in the wallet's **Smart contracts** page.

The package has not been proven by a live deployment merely because it compiles
or passes the memory-only engine tests. Record real receipts and resulting state
before describing your own run as successful.

## 1. Export the wallet files

From the Observatory repository root, using Node.js:

```sh
node test_defi/tools/export-wallet-kit.mjs --output ~/nodus-defi-wallet-kit
```

The output directory must not exist; its parent must already exist. Export reads
committed artifacts, verifies their scope and source hashes, and creates:

- `SandboxDollar6.abi.json`, `.creation.hex`, `.runtime.hex`, `.sol`;
- `LendingReference.abi.json`, `.creation.hex`, `.runtime.hex`, `.sol`;
- `manifest.json`, with file hashes, expected chain and initially unset addresses.

No compiler, recovery phrase, connection or transaction is needed for export.
Do not substitute the unrestricted `MockUSDT6` adversarial test helper. The
wallet kit's SandboxDollar6 has a fixed supply of 1,000,000 OSD6 issued once to
the deployer; it has no further mint function or administrator.

## 2. Prepare two dedicated test identities

Use separate **lender** and **borrower** identities in a trusted Nodus Wallet.
The lender also deploys the contracts in this example. Record both full EVM
addresses: `0x` plus **64 hexadecimal characters**, not a 20-byte Ethereum
address and not the 128-hex native wallet fingerprint.

Both identities need native testnet NODUS for transaction fees. The borrower
also needs at least 100 NODUS of collateral, plus separate fee coins. There is
no fixed fee promise: inspect each wallet review. A failed contract execution
can still consume its declared fee.

Use the wallet's supported testnet build. The kit pins chain ID:

```text
a48d1a785500a1cdecd739ecd53ef0e95b1dc4a7a300f49176a7fa25ae176114
```

Keep recovery phrases in your wallet, never in Observatory, its server, source
files or this guide. Do not use the same identity concurrently in another app
while an EVM transaction is pending. Each write needs review and confirmation.

## 3. Deploy the token, then the loan contract

With the lender selected, open the wallet's **Smart contracts** page:

1. Paste the contents of `SandboxDollar6.abi.json` into **ABI** and
   `SandboxDollar6.creation.hex` into **Bytecode**. Choose **Deploy…**, then
   **Review deployment**. There are no constructor arguments and no payable
   NODUS value. Review and confirm in the wallet.
2. Wait for a successful receipt. Record the intent ID, block height and full
   created address only when it matches the address computed from the signed
   transaction. An intent ID alone is not a successful deployment.
3. Open that token address with its ABI. Read `name()`, `symbol()`, `decimals()`,
   `totalSupply()`, `SUPPORTED_CHAIN_ID()` and `balanceOf(lenderAddress)`.
   Expect Observatory Sandbox Dollar, OSD6, 6, `1000000000000`, the pinned chain
   and that same supply in the deployer's balance.
4. Deploy `LendingReference` using its ABI and creation bytecode. Its
   `tokenAddress` constructor argument is the **confirmed OSD6 EVM address**.
   Send no payable value. A native tUSDT token ID cannot be used here.
5. Record and check its successful receipt and created address the same way.
   Open it with its ABI and read `token()` and `SUPPORTED_CHAIN_ID()` before
   granting any allowance. `token()` must equal your OSD6 deployment.

Keep a separate operator record of these public addresses, kit hashes and
receipts. The export manifest is an offline description, not an on-chain
deployment certificate. If you have an SDK runtime reader, compare
`evm.code(address).code` byte-for-byte with the corresponding `.runtime.hex`.
The generic wallet form does not itself provide that runtime-comparison tool;
do not claim you performed it by reading `token()` or a receipt alone.

## 4. Run one 100 OSD6 loan

All generic Solidity integer fields take **raw integer strings**. They do not
take decimal token amounts. The wallet's payable **Send with it (NODUS)** field
is different: it takes a human-readable NODUS amount.

| Term | Contract argument / value |
| --- | --- |
| Principal | `100000000` = 100 OSD6 |
| Collateral | `100000000000000000000` EVM wei = 100 NODUS |
| APR | `800` basis points = 8% annually |
| Term | `30` days |
| Grace | `3` days |
| Full-term interest | `657535` = 0.657535 OSD6 |
| Total repayment | `100657535` = 100.657535 OSD6 |

Interest is `ceil(100000000 * 800 * 30 / (10000 * 365))`. The full agreed
interest is due even on immediate repayment; the grace period adds no interest
in this model. There are no monthly instalments yet.

**As lender:**

1. In the OSD6 contract, call `transfer(borrowerAddress, 657535)`. This gives the
   borrower the extra interest tokens they cannot obtain from the principal
   alone. Wait for success and check `balanceOf(borrowerAddress)`.
2. Call `approve(lendingAddress, 100000000)` on OSD6. After success, read
   `allowance(lenderAddress, lendingAddress)` and check the exact amount.
3. Choose a fresh future Unix expiry in seconds, at most 30 days ahead. For an
   initial estimate seven days ahead on the operator's computer:

   ```sh
   python3 -c 'import time; print(int(time.time()) + 7 * 86400)'
   ```

   Contract validation uses the chain's current block timestamp, not the browser
   clock. A stale or out-of-range value is refused; do not bypass that refusal.
4. Call `createOffer(100000000, 100000000000000000000, 800, 30, 3, expiresAt)`.
   This transfers the principal into escrow; approval alone did not fund an
   offer. Record the actual ID from the `Offered` event. The first successful
   offer on a fresh contract is 1, but do not assume 1 in an existing deployment.
5. Read `getOffer(id)`. Check lender, token amounts, exact interest, term, grace,
   expiry and status **1 / Open**. OSD6 `balanceOf(lendingAddress)` should now
   include the reserved principal.

**As borrower:**

1. In the wallet's **Move NODUS to smart contracts** section, deposit 100 NODUS
   into your own EVM balance if it is not already funded. This is a separate
   transaction; it does not yet fund the loan contract. Keep native fee coins.
2. Open the same loan address and ABI; independently inspect `getOffer(id)`.
   Call `accept(id)` with **Send with it (NODUS) = `100`**. Do not enter the
   21-digit wei integer into that payable field. Exact collateral is required.
3. After success, check status **2 / Active**, borrower, accepted/due/deadline
   timestamps and OSD6 balance `100657535`. The 100 OSD6 principal was paid out
   by the loan contract; the extra `657535` came from the separate test transfer.
4. On OSD6 call `approve(lendingAddress, 100657535)`, wait for success, then on
   the loan contract call `repay(id)` before its deadline. No payable NODUS is
   sent with repayment. Check status **3 / Repaid**.
5. Read `collateralCredit(borrowerAddress)` and call
   `withdrawCollateral(borrowerAddress)` to receive 100 NODUS into your **EVM
   balance**. Moving that credit back to native NODUS requires the wallet's
   separate **Move NODUS back** operation.

**As lender:** read `tokenCredit(lenderAddress)` = `100657535`, then call
`withdrawToken(lenderAddress)`. Check the OSD6 credit becomes zero and the token
balance increases by exactly that amount. Settlement and withdrawal are
separate; a repaid loan does not mean its credits have already been withdrawn.

## 5. Cancellation, default and uncertain results

An unused **Open** offer may be cancelled by its lender with `cancel(id)`.
That creates a token credit, recovered separately with `withdrawToken`.

For this experimental contract, a lender can claim **all** agreed collateral
with `claimDefault(id)` at or after `dueAt + grace`. Repayment closes exactly
at that boundary. Claiming creates a collateral credit, withdrawn separately.
There is no price oracle, debt-value cap or return of a market-value surplus.
Collateral may fall below the debt value, or the award may exceed it. This is a
test settlement rule, not a production lending design. Use another tiny test
offer to try default; real block time cannot be advanced by the simulator's UI.

Wait for each definitive receipt before continuing. If the connection drops,
the wallet reports a pending transaction, or the outcome is unknown, inspect
the original intent and confirmed state. Do not repeat `deploy`, `createOffer`
or other writes to find out whether the first one succeeded. Preserve the
wallet's pending/activity records. No automatic retry is part of this guide.

The deployed contracts are independent of browser drafts and the Observatory
simulator. Editing, importing or resetting a local draft does not change them.
This procedure does not integrate credit scores, native tUSDT, automatic chat
notifications or a shared offer index.

## Reviewed primary sources

- [Wallet generic deployment and ABI function forms](https://github.com/nocdem/dna/blob/d065cf3db719f990fe3777237af0f7166d5a5330/web-wallet/src/evm/ui.js)
- [SDK operations, address/amount units and transaction outcomes](https://github.com/nocdem/dna/blob/d065cf3db719f990fe3777237af0f7166d5a5330/sdk/js/README.md)
- [Starter confirmation, local key handling and durable pending journals](https://github.com/nocdem/dna/blob/d065cf3db719f990fe3777237af0f7166d5a5330/sdk/starter/README.md)
- [SDK generic deployment and send implementation](https://github.com/nocdem/dna/blob/d065cf3db719f990fe3777237af0f7166d5a5330/sdk/js/src/sdk.js)
