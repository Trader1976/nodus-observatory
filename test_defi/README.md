# Observatory Test DeFi

[Suomeksi](README_fin.md)

This directory owns the Test DeFi feature. Open **Test DeFi** in Observatory
(`/#defi`) for the browser wallet dashboard, the read-only Nodus OSD6 loan book,
and a separate local lending rehearsal. [Browser integration](BROWSER_UI.md)
describes what works today and the remaining cross-chain settlement boundary.

The wallet dashboard connects TronLink on explicit request, reads testnet
balances and lets the user review and sign a Nile test-USDT transfer. Keys stay
in TronLink. Nodus loan signing awaits a documented Nodus wallet connector;
the cross-chain NODUS/TRON lending protocol is not yet implemented.

See [Native assets](NATIVE_ASSETS.md) for the expanded feasibility review and
the [manual wallet guide](DEPLOYMENT.md) for an optional **separate OSD6 EVM-token**
experiment. Its fixed-supply `SandboxDollar6` replaces the configurable attack-test
mock. The kit does not connect the rehearsal to live contracts or support native tUSDT.

## Important asset distinction

The tUSDT shown in Nodus Wallet is a **native Nodus UTXO token**, identified by
a 64-byte token ID. It is not an ERC20 contract address. The pinned upstream
wallet source identifies it as **Test USDT / tUSDT, 6 decimals**, created at
testnet block 305991:

```text
7142460f5dd73ce7123905c423e1eb17fbff36f14b031e24837a4b6d7bedd5677baaa3a3e6015e6d6fc706b0b0d8799a88d7fd63f6d1e7807dbb88577b7c3b50
```

At the reviewed upstream revision, the EVM funding path accepts only the native
NODUS coin. Its DEPOSIT operation has an amount and nonce, with no token ID;
the consensus-side funding code rejects inputs whose token differs from the
native coin. A normal ERC20 `approve` / `transferFrom` call therefore cannot
spend the existing wallet tUSDT. This is a protocol integration gap, not a
missing token address setting.

The browser model uses six-decimal simulated tUSDT for the proposed user flow.
The separate Solidity reference uses **MockUSDT6**, a deliberately mintable ERC20
test helper, to exercise escrow and settlement in an isolated EVM harness. Its
compiled artifacts explicitly set `nativeTusdtCompatible: false`. They are not
a deployment for the existing wallet token. No wrapped representation, bridge,
custodial transfer service or real lending deployment is provided here.

## First-version loan rules

| Item | Rule |
| --- | --- |
| Offer | One funded offer becomes one whole loan; no partial fills. |
| Principal | Positive six-decimal token amount, up to `10^24` raw model units. |
| Collateral | Positive fixed NODUS amount, eight display decimals; chosen by the lender. |
| Annual interest | Simple fixed APR, 1–5000 basis points (0.01–50%). |
| Term | 1–365 days, starting when the offer is accepted. |
| Offer expiry | 1–30 days after creation for browser drafts; no acceptance at expiry. |
| Grace period | 1–30 days after the due date; no extra late fee in this model. |
| Repayment | One payment: principal plus the full agreed term's interest. Early repayment still pays that full interest. |
| Unused funds | Lender can cancel an open offer. |
| Default | At or after due date + grace period, repayment closes and the lender can claim all agreed collateral. |

The all-collateral default rule is an explicit experimental simplification. It
does not cap the collateral award at the debt's market value or return a
market-value surplus. There is no price oracle, live LTV, price-triggered
liquidation, guaranteed yield, or protection against collateral losing value.
Do not treat this reference as a production credit market.

Interest is calculated once with integer arithmetic:

```text
interestRaw = ceil(principalRaw * aprBps * termDays / (10000 * 365))
repaymentRaw = principalRaw + interestRaw
```

This version has no monthly instalments. Credit scoring, Proof of Life, chat
notifications, multiple lenders per loan and a shared offer book are later
features. The examples' 8% and 10% offers have no score restrictions.

## Source map

| Path | Responsibility |
| --- | --- |
| `frontend/core.js` | Exact amount parsing, quotes, validated offers and replay-checked simulation transitions; no network or storage. |
| `frontend/defi.js`, `frontend/defi.css` | Finnish/English browser dashboard and scoped responsive styles. |
| `frontend/practice.js` | Isolated local lending rehearsal; never a source of on-chain balances. |
| `frontend/networks.js`, `frontend/tron.js` | Testnet profiles and the TronLink wallet adapter. |
| `read_api.py` | Fixed read-only getters for the pinned OSD6 lending deployment on the local Nodus node. |
| `sync_frontend.py` | Copies canonical frontend files into generated `dist/test-defi`; `--check` rejects drift. |
| `contracts/LendingReference.sol` | Offline ERC20 reference with funded offers, native collateral, settlement credits and withdrawals. |
| `contracts/MockUSDT6.sol` | Disposable mock token and failure helpers; anyone can mint or change mock behavior. |
| `artifacts/reference.json` | Reproducible ABI/bytecode, source hashes, compiler identity and explicit compatibility flag. |
| `contracts/SandboxDollar6.sol`, `artifacts/wallet-kit.json` | Fixed-supply OSD6 and a manual-deployment kit, with no mint/admin controls. |
| `tools/export-wallet-kit.mjs` | Offline ABI, bytecode, source and manifest export into a new directory. |
| `tools/`, `tests/` | Pinned compiler build, execution harness and economic/state regression checks. |
| `config.example.json` | Research identity record; execution is disabled and deployments are unset. The UI does not load this as live configuration. |

The Solidity contract separates settlement from withdrawals: cancellation and
repayment create token credits; repayment/default creates collateral credits.
A credit owner withdraws to a chosen recipient. A failed payout rolls back the
withdrawal and preserves the credit. This prevents a rejecting native recipient
from blocking loan settlement. Exact token balance deltas and return values are
checked; malicious token implementations remain an external trust assumption.

Amounts are decimal strings at the frontend boundary and `BigInt` internally.
NODUS uses eight native decimal places; the Nodus EVM uses eighteen. Thus
`1 raw NODUS = 10^10 EVM wei`. Only whole native raw units are accepted for
collateral. The model's large arithmetic cap is not a claim that native UTXO
transactions support that range: a future native adapter must also enforce
the chain's actual amount and transaction bounds.

## Verify and preview

From the repository root:

```sh
python3 test_defi/sync_frontend.py
python3 test_defi/sync_frontend.py --check
node test_defi/tests/core.mjs
node test_defi/tests/tron.mjs
node test_defi/tests/frontend.mjs
node test_defi/tests/browser-ui.mjs
python3 -m unittest discover -s test_defi/tests -p 'test_*.py' -v
python3 -m http.server 8891 --directory dist
```

Open `http://127.0.0.1:8891/#defi`. A static preview can use the TronLink testnet
adapter; the Nodus loan book needs the installed Observatory backend. The
standard installer includes both. Installation never deploys contracts or
requests wallet access; each wallet action starts with an explicit user click.

To rebuild the offline reference, set `NODUS_SOLC` to the pinned Nodus addr256
Solidity compiler and run:

```sh
node test_defi/tools/build-contracts.mjs --check
```

The build requires `0.8.30+nodus.addr256.commit.73712a01.Linux.g++`; stock
Ethereum Solidity uses 20-byte addresses and is not a substitute. See the
contract execution script and CI for its pinned Nodus engine revision and
required build dependencies. Offline execution is not a live testnet result.

With `NODUS_EVM_ROOT` pointing at a checkout of
`nocdem/dna@2e881cc6e6d7a5050cc10400afc2b883f8fb712a`, run the in-memory
32-byte engine tests with `node test_defi/tools/test-contracts.mjs`.

## Before enabling real testnet loans

1. Agree and implement a consensus-enforced native-token custody/settlement
   interface, or explicitly choose and disclose a separate test asset model.
   A trusted server moving tUSDT is not equivalent to autonomous escrow.
2. Verify chain identity, exact asset ID and metadata, deployed code/ABI and
   native/EVM units against confirmed chain state. Never substitute an asset
   by symbol or infer an ERC20 address from a native token ID.
3. Integrate supported wallet approvals, decoded transaction review, durable
   pending records and reconciliation. Keep keys outside Observatory's server
   and never request a recovery phrase in this page.
4. Add a chain-derived shared offer index and confirmed loan history. Imported
   drafts and successful rehearsals must never count as funded offers or
   credit-score evidence.
5. Review the economic default rule, oracle/liquidation design and operational
   recovery paths; test failure and adversarial cases before using real value.
   Later credit-score proofs need explicit issuer/rule trust and expiry checks.

## Reviewed primary sources

All links below are pinned to `nocdem/dna@d065cf3db719f990fe3777237af0f7166d5a5330`:

- [Wallet native tUSDT pin and metadata checks](https://github.com/nocdem/dna/blob/d065cf3db719f990fe3777237af0f7166d5a5330/web-wallet/crypto/nodus-send-wasm.c)
- [Native token wallet regression tests](https://github.com/nocdem/dna/blob/d065cf3db719f990fe3777237af0f7166d5a5330/web-wallet/test/nodus-tokens.test.js)
- [EVM funding wire format](https://github.com/nocdem/dna/blob/d065cf3db719f990fe3777237af0f7166d5a5330/shared/dnac/evm_call_wire.h)
- [Consensus-side native EVM funding checks](https://github.com/nocdem/dna/blob/d065cf3db719f990fe3777237af0f7166d5a5330/nodus/src/witness/nodus_witness_rt_native.c)
- [Native/EVM unit conversion](https://github.com/nocdem/dna/blob/d065cf3db719f990fe3777237af0f7166d5a5330/web-wallet/src/evm/units.js)
- [Node.js SDK operations and wallet confirmation/pending model](https://github.com/nocdem/dna/blob/d065cf3db719f990fe3777237af0f7166d5a5330/sdk/js/README.md)
