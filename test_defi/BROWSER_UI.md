# Browser wallet integration

[Suomeksi](BROWSER_UI_fin.md)

Open Observatory `/#defi`. Three views keep their data sources explicit:

| View | Source and actions |
| --- | --- |
| Wallet | TronLink, selected testnet, actual TRX and allowlisted test-USDT balances; reviewed test-token transfers. |
| Nodus loans | Local Nodus node, fixed getters on the existing OSD6 lending deployment; read-only. |
| Practice | In-memory example offers and loan transitions; no funding or chain execution. |

## TRON connection and transactions

Install TronLink from its official site and open Observatory in that browser.
Click **Connect TronLink** and approve the origin. Nile is the default profile.
The account and genesis identity must match the profile before a transfer can
be prepared or signed. Mainnet and unknown networks are blocked. Changing
account or network invalidates cached balances and prepared requests.

Enter a TRON recipient and an amount with at most six decimals. Review the
token, sender, recipient, amount and TRX Energy fee limit next to the form. The
confirmation button opens TronLink for the signature. The Energy fee limit is
100 TRX, not an estimate of the actual fee; Bandwidth and other charges may
add TRX. Test tokens have no monetary value.

The browser records the signed transaction ID in local storage **before**
broadcast. If storage is blocked, it does not broadcast. Broadcast acceptance
differs from a confirmed successful receipt; uncertain requests remain pending
for reconciliation. There is no automatic repeat of a transfer. History is
local to the browser, bounded, and scoped by network/account. Disconnecting
the page does not revoke its authorization in TronLink.

`frontend/networks.js` owns network-specific identities. Nile's faucet token is
`TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf`, six decimals. Shasta has a separate
profile with **no token address configured**. Review a known deployment before
enabling it. Balances, contracts, offers and history do not migrate when
changing profiles. No mainnet USDT address is enabled.

## Nodus loan book

`GET /api/test-defi` reads these pinned testnet deployments:

- OSD6: `0x8B0A1C0b6ed36896cb60E0Bb7f364Eb95c4EF6Ddf123C7265a76E6Dd09a26769`
- Lending: `0x94635AfE032a90F0bD4a3a8C195f0732D208c01B58D7D80A03072dD128A6c4Dc`
- Chain: `a48d1a785500a1cdecd739ecd53ef0e95b1dc4a7a300f49176a7fa25ae176114`

The backend requires a fresh synchronized collector snapshot and invokes fixed
ABI getters via local `nodus-cli`. It accepts no contract address, RPC URL, ABI,
key directory or arbitrary call from the browser. Requests have a shared time
budget, bounded output, cache and one concurrent collector. Up to 20 recent
offers are returned, with explicit coverage and observation time. Separate
getter calls are not an atomic snapshot. Responses are reports from one node,
without independent chain proof or runtime-code verification. OSD6 is a
separate sandbox token, distinct from the TRON token and native Nodus tUSDT.

The user reported the complete OSD6 loan #1 lifecycle on testnet, ending with
repayment, both withdrawals and zero liabilities. The loan book queries current
state instead of presenting that report as hardcoded live data.

## Remaining lending integration

The reviewed Nodus wallet/SDK at `nocdem/dna@d065cf3` has no documented injected
browser signing provider. Its Node SDK signs from wallet keys; Observatory does
not import those keys or request a recovery phrase. Nodus loan actions remain
unavailable here until a supported connector exists. The tested manual wallet
kit is unchanged.

Cross-chain lending needs a reviewed settlement protocol coordinating NODUS
collateral and TRON token custody, expiry, repayment, default, finality and
recovery. Connecting wallets does not implement that protocol. This dashboard
does not emit loan approvals, cross-chain locks or token releases.

## Verification and deployment

Run the commands in [README](README.md). Automated tests mock wallet signatures
and receipts and never spend faucet funds. A real TronLink extension smoke test
still needs a user's browser. Use `sudo bash backend/install.sh` on Nexus;
existing monitor settings and GeoIP are preserved. The CSP permits same-origin
requests and exact Nile/Shasta RPC hosts. A reverse proxy with its own CSP must
allow the same endpoints. Use localhost via SSH or authenticated HTTPS.

## Primary references

- [TronLink provider and authorization](https://docs.tronlink.org/dapp/getting-started/)
- [Testnet identities and address units](https://docs.tronlink.org/reference/networks/)
- [Official test-token faucets](https://developers.tron.network/docs/getting-testnet-tokens-on-tron)
- [TRON genesis network identities](https://namespaces.chainagnostic.org/tron/caip2)
- [Energy fee limit and excluded fees](https://developers.tron.network/reference/triggersmartcontract)
- [Reviewed Nodus wallet and SDK](https://github.com/nocdem/dna/tree/d065cf3db719f990fe3777237af0f7166d5a5330)
