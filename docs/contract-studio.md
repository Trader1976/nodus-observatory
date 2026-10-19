# Contract Studio — experimental branch

**English** · [Suomi](contract-studio_fin.md)

Contract Studio is an experiment on `feature/contract-studio`. It is not part of
`main`. It adds a browser-local visual editor for one bounded escrow template,
an interactive state-machine model and deterministic Solidity/project exports.
The monitor remains read-only: this feature adds no transaction, signing,
compiler or key-management endpoint to the server.

## Build and inspect an escrow

Open **Contract Studio** in the sidebar. Set the buyer and seller to their
**Nodus EVM addresses**, the amount in NODUS and an explicit deadline. The blank
addresses in a new draft must be filled before source export or simulation of
that agreement. The separate example-simulation action uses public dummy
identities without changing the actual agreement. Studio requires the `0x` prefix
followed by 64 hexadecimal digits for each EVM address. A
128-character native Nodus fingerprint is a different identifier and is refused.

The canvas contains states and directed connections. Drag states to rearrange
the diagram; use the state and connection controls to add or remove parts of
the graph. Pointer dragging is an arrangement operation, not a change to the
contract's payment rules. The editor checks the graph against this first
template; missing, duplicate or unsupported states and connections prevent
source export rather than silently changing its meaning. The same controls
remain usable without dragging.

| Action | Who calls it | Required state and time | Result |
| --- | --- | --- | --- |
| `deposit()` | Buyer | Created; before deadline; exact value | Funded |
| `approve()` | Buyer | Funded; before deadline | Approved |
| `withdraw()` | Seller | Approved; including after deadline | Pays the agreed amount to seller; Paid |
| `refund()` | Buyer | Funded; at or after deadline | Returns the agreed amount to buyer; Refunded |
| `cancel()` | Buyer | Created | Cancelled |

Approval commits the payment: an approved contract does not become refundable
when its deadline passes. There is no third-party arbitrator or delivery
oracle. A deadline is checked when a transaction runs; it does not schedule or
send a transaction automatically. On-chain time is the committed block's Unix
timestamp, not the browser clock.

The amount has at most eight decimal places, matching the native NODUS bridge,
and is converted exactly with integers: native raw units × 10^10 = EVM wei.
One NODUS is 10^8 native raw units or 10^18 EVM wei. No floating-point amount is
inserted into the generated Solidity. The buyer and seller, amount and deadline
are constants fixed into the source. The constructor has no arguments. The
source is self-contained and uses neither imports nor external linked libraries.

### Simulation and drafts

Choose a role, try an action and advance the simulated time. The model checks
wrong-role calls, state order, exact deposits, the deadline boundary, duplicate
payments and a failed recipient payment. A failed action leaves the model's
state and balances unchanged. The Solidity uses checks before effects,
state changes before outbound payments and a reentrancy guard; a failed payment
reverts the transaction.

This is a JavaScript model of the intended rules, **not execution of the compiled
bytecode**, a network simulation or an audit. It does not model gas, block
ordering, arbitrary hostile callback contracts, chain reorganisations or the
native/EVM bridge. Imported projects are data: the editor validates their
schema and graph and does not execute imported code. Drafts are saved in this
browser; use project export/import to transfer them to another browser.

Ordinary unsolicited payments are rejected by the generated contract. The EVM
can nevertheless force a balance onto an address through `SELFDESTRUCT` without
calling its receive function. The escrow pays exactly the agreed amount; it has
no surplus-recovery function. Do not interpret its whole EVM balance as an
additional amount owed to either party.

## Compile offline with Nodus solc

The browser exports **Solidity source**, not invented ABI or bytecode. Obtain the
compiler separately and select its path explicitly when using the
[offline helper](../tools/contract-studio/compile.py). The helper never downloads
or installs executables and never reads an identity directory.

The supported compiler is Solidity **0.8.30 with the Nodus address256 patch**,
version `0.8.30+nodus.addr256.commit.73712a01`. Stock Ethereum solc is refused:
it treats addresses as 20 bytes and can silently target a different account.

Official upstream Linux x86-64 archive:

- [nodus-solc-0.8.30-nodus.addr256-linux-x86_64.tar.gz](https://nodusnetwork.io/downloads/nodus-solc-0.8.30-nodus.addr256-linux-x86_64.tar.gz)
- Archive SHA-256: `a09d6486c944a795009f08dbc8210ce2eee2785248f9f5f7edc2aaa9c6934649`
- Documented compiler-binary SHA-256: `6c981f36ee790a46fa2310c4eb925e35909b020a58a19654a063517947ceffb4`

These pins come from the upstream source revision listed below. Check current
upstream instructions before choosing a different release. The documented
binary needs glibc 2.34 or newer and libstdc++ providing `GLIBCXX_3.4.29`.
Do not substitute MetaMask, ethers, viem or a stock Solidity toolchain.

After downloading and verifying the archive independently, extract it into a
working directory and check `solc-nodus --version`. No system-wide installation
or `sudo` is necessary for this helper. From the Observatory checkout:

```bash
python3 tools/contract-studio/compile.py /path/to/ObservatoryEscrow.sol \
  --solc /path/to/solc-nodus \
  --project /path/to/project.json \
  --out /path/to/new-compiled-escrow
```

`--project` is optional. Existing output directories are refused. Compilation
uses Standard JSON, explicit Prague rules, optimizer runs 200 and no metadata
bytecode hash; imports and the compiler's filesystem import callback are
disabled. The helper checks compiler diagnostics, metadata identity, constructor
arguments, unresolved libraries and bytecode size/hex before writing a bundle.
Inputs are limited to 1 MiB each; compiler invocations have a default 60-second
timeout and a 16 MiB captured-output acceptance limit.

| Output | Purpose |
| --- | --- |
| `ObservatoryEscrow.sol` | Exact source bytes compiled |
| `ObservatoryEscrow.abi.json` | Compiler-produced function/event/error interface |
| `ObservatoryEscrow.creation.hex` | `0x`-prefixed creation bytecode for wallet deployment |
| `ObservatoryEscrow.runtime.hex` | Runtime reference; **not** the deployment input |
| `ObservatoryEscrow.metadata.json` | Compiler metadata, including its Nodus version |
| `ObservatoryEscrow.storage-layout.json` | Compiler-reported storage layout |
| `compiler-input.json`, `compiler-diagnostics.json` | Reproducible settings and diagnostics |
| `project.json` | Optional unmodified archived project |
| `manifest.json` | SHA-256 hashes, compiler identity, sizes and provenance |

The manifest records source and project hashes independently. It explicitly
labels the project/source binding **not verified**: the Python helper compiles
the source it receives and does not reimplement the browser generator or claim
that an unrelated archived project describes that source. The compiler version
string is checked, and the actual executable's SHA-256 is recorded; the manifest
also says whether it matches the documented official binary. A matching version
string alone is not an authenticity guarantee for an arbitrary executable.

## Wallet hand-off

Review the source and generated constants first. In the Nodus wallet's
smart-contracts panel, paste `ObservatoryEscrow.abi.json` into **ABI** and
`ObservatoryEscrow.creation.hex` into **Bytecode**, then choose **Deploy**.
Constructor arguments are empty and deployment value should be zero. The wallet
reviews and signs the transaction; the Observatory does neither. Record the
created contract address and keep the source, ABI and manifest together.

Open the deployed address with the same ABI. The buyer needs an EVM balance for
the escrow value, using the wallet's separate **Deposit** bridge action. Its
contract call is `deposit()` with precisely the agreed NODUS value. Approval,
seller withdrawal, refund and cancellation carry zero value. Each caller also
needs native coins for network fees. An included EVM call that reverts still
pays its fee under the current Nodus rules.

The contract's `withdraw()` pays the seller's **EVM account**. It does not itself
produce native spendable wallet coins. Moving value from that EVM account back
to native NODUS is a separate wallet **Withdraw** bridge operation. Contract
withdrawal and bridge withdrawal are different actions.

No live deployment, signing or transaction submission was performed for this
experiment. Use the official wallet's own transaction review and testnet flow
when evaluating an export. This template is not an audited escrow service.

## Verification and current limits

The branch includes graph/schema/generator/simulator tests and compiler-helper
boundary tests. The optional real-compiler check is enabled with:

```bash
NODUS_STUDIO_SOLC=/path/to/solc-nodus \
  python3 -m unittest discover -s tests -p test_contract_studio_compile.py -v
```

During implementation, the official archive and binary hashes above were
verified and the actual generator-produced escrow was compiled with that binary,
with no compiler diagnostics. The helper's optional integration test checks
repeatable artifacts and the compiler's 32-byte address storage layout. These
checks do not establish execution equivalence between the simulator and the
Nodus engine. No compiled escrow execution against a local EVM or live chain
has been claimed.

This first template does not support partial payments, multiple purchases,
arbitration, automatic timers, upgrades, arbitrary Solidity imports, external
oracles, linked libraries, custom execution blocks, contract deployment from
Observatory or contract transaction tracking. Changing the layout is supported;
changing the template's semantics requires extending its schema, generator,
simulator and tests together.

## Upstream source references

The investigation is pinned to `nocdem/dna` revision
`908f76102ac3ded448f2c87ac72772e0c02642c0` (reviewed 19 October 2026):

- [Nodus Solidity compiler and address32 rules](https://github.com/nocdem/dna/blob/908f76102ac3ded448f2c87ac72772e0c02642c0/nodus/tools/evm/solc/README.md)
- [Official compiler download, EVM units and wallet/CLI workflow](https://github.com/nocdem/dna/blob/908f76102ac3ded448f2c87ac72772e0c02642c0/website/wiki/developers.html)
- [Self-contained token example and compile workflow](https://github.com/nocdem/dna/blob/908f76102ac3ded448f2c87ac72772e0c02642c0/nodus/tools/evm/examples/README.md)
- [Wallet ABI/bytecode input and deployment form](https://github.com/nocdem/dna/blob/908f76102ac3ded448f2c87ac72772e0c02642c0/web-wallet/src/evm/ui.js)
- [Wallet transaction construction and native/EVM bridge](https://github.com/nocdem/dna/blob/908f76102ac3ded448f2c87ac72772e0c02642c0/web-wallet/src/evm/contract.js)
- [Node EVM configuration and committed block timestamp](https://github.com/nocdem/dna/blob/908f76102ac3ded448f2c87ac72772e0c02642c0/nodus/src/witness/nodus_witness_rt_evm.c)
- [Prague SELFDESTRUCT behavior](https://github.com/nocdem/dna/blob/908f76102ac3ded448f2c87ac72772e0c02642c0/shared/evm/evm_interp.c)
