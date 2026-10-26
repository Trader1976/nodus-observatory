# Native tUSDT and deployability review

[Suomeksi](NATIVE_ASSETS_fin.md)

Reviewed on 2026-10-26 against the current upstream default-branch head
`nocdem/dna@d065cf3db719f990fe3777237af0f7166d5a5330`.

**The current native tUSDT cannot be used by this EVM lending contract through
any supported interface found in this review.** A separately named EVM test
token is a feasible deployment experiment. These are different assets.

## Evidence and boundaries

| Boundary | Reviewed source | Finding |
| --- | --- | --- |
| Asset identity | `web-wallet/crypto/nodus-send-wasm.c`, `NSW_PINS` | Test USDT is a native UTXO token with a 64-byte token ID and six decimals. Its ID is recorded in `config.example.json`; it is not an EVM address. |
| Spend authorization | `nodus/src/witness/nodus_witness_rt_native.c`, `rtn_input_owned`, `rtn_xfer_exec` | A token input needs its owner's verified signature or a satisfied native M-of-N descriptor. An EVM contract's storage does not grant that authority. |
| Native output conditions | Same file, native output construction | Ordinary wire outputs are unlocked (`unlock_block=0`). No general user-programmable native HTLC/covenant/loan rule interface was found. Protocol lifecycle locks are separate. |
| EVM funding | Same file, `rtn_evmfund_exec`; `shared/dnac/evm_call_wire.h` | Funding inputs must have the all-zero native NODUS token ID. DEPOSIT carries an amount and nonce, not a token ID. |
| Atomic envelopes | `nodus/src/witness/nodus_witness_runtime.c`, `nodus_rt_evm_pair_check` | Exactly two legs are required: CORE EVMFUND followed by the matching EVM operation. An ordinary native tUSDT SPEND cannot simply be appended to an EVM loan call. |
| Host/precompiles | `shared/evm/evm.h`, `evm_precompile.c` | Standard precompiles, ML-DSA operations and native NODUS withdrawal tickets were found; no native-token custody/settlement capability was found. |
| Wallet execution | `web-wallet/src/evm/ui.js` | The wallet can deploy bytecode with ABI/constructor arguments, and call ABI functions with payable NODUS. This supports the separate EVM-token experiment. |

This is a source-based conclusion, not proof that no future protocol extension
can support native tokens. A wallet displaying both assets on the same chain
does not imply the EVM can control both ledgers.

## Alternatives

1. **Separate EVM sandbox token:** deploy `SandboxDollar6` (OSD6) and
   `LendingReference(OSD6 address)` using the [manual wallet guide](DEPLOYMENT.md).
   The export kit contains genuine compiled contract creation bytecode, not
   fabricated transaction outcomes. It is not a tUSDT wrapper and has no USDT
   backing. Live chain execution still requires an operator test.
2. **Native multisig service:** native tUSDT can be held under M-of-N control,
   but transfers require signers. This introduces custody, availability and
   dispute assumptions; it does not implement autonomous loan enforcement.
3. **Canonical native/EVM integration:** requires protocol work, activation and
   wallet support. It cannot be added by changing Observatory JavaScript alone.

An ML-DSA signature on a claim about payment establishes the signer, not that
native tUSDT was paid or that its custody is enforced by consensus.

## Proposed upstream capability, not an existing API

A useful developer request is **consensus-enforced native asset access from
EVM contracts**, for tUSDT and later native assets. One possible design is a
canonical lock/mint and burn/release interface. Its exact architecture belongs
to the protocol developers; no address or undocumented bridge is assumed here.

Minimum properties to agree before implementation:

- Bind the network, native token ID, decimals and EVM representation explicitly.
  A symbol is insufficient. Define supply limits and native uint64 boundaries.
- Atomically consume native inputs and credit the correct EVM recipient; neither
  half may succeed alone. Preserve conservation across both ledgers.
- Atomically burn representation balances and issue token-specific release
  claims. Tickets must bind token ID, destination, amount, network and a unique
  replay-protected identity; prevent duplicate redemption.
- Check native ownership/multisig authorization and EVM caller authorization in
  their respective domains. Do not rely on an operator reporting deposits.
- Define token metadata changes, unknown assets, fees, rounding, failures and
  pending-transaction recovery. Failed operations must preserve custody.
- Version and activate consensus changes explicitly; add wallet/SDK methods and
  tests for forged tokens, wrong networks, double spending and partial execution.

After that capability exists, the lending application still needs confirmed
offer indexing, wallet requests, pending reconciliation and a redesigned
default/price-risk policy. Its present all-collateral default rule remains an
experimental test rule, not production liquidation.

## Pinned primary sources

All links refer to the reviewed revision:

- [Native asset pin](https://github.com/nocdem/dna/blob/d065cf3db719f990fe3777237af0f7166d5a5330/web-wallet/crypto/nodus-send-wasm.c)
- [Native ownership, transfer and funding](https://github.com/nocdem/dna/blob/d065cf3db719f990fe3777237af0f7166d5a5330/nodus/src/witness/nodus_witness_rt_native.c)
- [EVM envelope pairing](https://github.com/nocdem/dna/blob/d065cf3db719f990fe3777237af0f7166d5a5330/nodus/src/witness/nodus_witness_runtime.c)
- [EVM wire format](https://github.com/nocdem/dna/blob/d065cf3db719f990fe3777237af0f7166d5a5330/shared/dnac/evm_call_wire.h)
- [Native multisig](https://github.com/nocdem/dna/blob/d065cf3db719f990fe3777237af0f7166d5a5330/shared/dnac/msig_wire.h)
- [EVM host capabilities](https://github.com/nocdem/dna/blob/d065cf3db719f990fe3777237af0f7166d5a5330/shared/evm/evm.h)
- [Generic wallet contract UI](https://github.com/nocdem/dna/blob/d065cf3db719f990fe3777237af0f7166d5a5330/web-wallet/src/evm/ui.js)
