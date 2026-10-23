# Visual contract editor

**English** · [Suomi](contract-studio-builder_fin.md)

The visual editor at `#contracts-editor` builds a configurable state machine.
It extends the earlier [escrow example](contract-studio.md): states, callable
actions, conditions and roles are editable parts of the exported contract.
The [document registry](document-notary.md) remains a separate workspace.

The editor runs locally in the browser. It exports a declarative project and
Solidity source; it does not connect to a wallet, sign transactions or publish
contracts. The monitoring server gains no write endpoint.

## Build a workflow

Start with an escrow, an approval workflow or a blank project. Add named states,
choose one initial state and mark completed states as terminal. State positions
change only the diagram layout. Each action connects a source state to a target
state; changing those endpoints changes the generated behavior.

A project supports up to 8 roles, 24 states, 48 actions and 8 conditions per
action. Incomplete typed drafts can be saved. Source generation requires valid
references, one initial state, at least one action and reachable states.

An action has a label, an allowed caller, an operation and optional conditions.
Roles contain a label and a Nodus EVM address: `0x` followed by 64 hexadecimal
digits. The native Nodus fingerprint is a different identifier. Roles use
distinct, nonzero addresses. Enter the real addresses before generating source
or simulating the actual agreement.

| Operation | Executed behavior |
| --- | --- |
| Move | Changes the workflow state without accepting or sending funds. |
| Deposit | Accepts exactly the configured NODUS amount and changes state. |
| Transfer | Sends the configured amount to the selected role and changes state. |
| Approve | Records the calling role's approval once and changes state. |
| Record hash | Stores a nonzero `bytes32` hash supplied by the authorized caller and changes state. |

An approval or hash-recording action requires a specific role as caller.
The other operations can also allow anyone to call them. The configured source
state, caller authorization, transaction value and sufficient payout balance
are always checked. An action from a terminal state is invalid.

Configure installment payments with separate transfer actions and intermediate
states. Every transfer has its own exact amount and is a separate transaction.
The editor does not implement an atomic split between several recipients.

## Conditions and approvals

Conditions can require all predicates (**AND**) or at least one predicate
(**OR**). An empty condition group imposes no extra predicate.

| Condition | What it checks |
| --- | --- |
| Before deadline | The executing block's timestamp is strictly before the UTC deadline. |
| At or after deadline | The block timestamp has reached the deadline. |
| Balance at least | The credited workflow balance before the action meets the configured amount. |
| Approved by role | The specified role has recorded an approval. |
| Approval count at least | At least the configured number of distinct roles have approved. |
| Hash equals | The currently stored hash equals the configured `bytes32` value. |

AND/OR combines only these predicates. An OR group cannot bypass caller
authorization, exact deposit value, rejection of unexpected value or the balance
required for a transfer. NODUS values use at most eight decimal places and are
converted to 18-decimal EVM wei with integer arithmetic.

Predicates read the state before the action's effects: a deposit is not yet
included in its balance condition, and an approval or new hash is not yet
recorded. Use a subsequent action to check those new values. The credited
workflow balance includes accepted deposits only; unsolicited or forced EVM
surplus is not credited to the workflow.

Approvals belong to one global approval round for the contract. A role can
approve only once, and its approval remains recorded when the workflow changes
state. There is no reset or separate approval round for each state. To require
specific reviewers, use their individual approval conditions; a quorum count
alone counts every role that has successfully executed an approval action.

The stored hash is an authorized assertion. It does not prove the content,
delivery, ownership or authenticity of a document. Likewise, an approval proves
that the configured role called the approval action, not that an external event
is true. External oracle feeds are not part of this editor.

A hash-equality condition containing 64 zero digits checks the initial
"no evidence recorded" value. Recording a hash requires a nonzero value.

Deadlines permit or reject calls when a transaction executes. They do not send
transactions automatically. On-chain time comes from the committed block, not
the browser clock.

## Save, reopen and convert earlier projects

The editor uses the new `nodus-contract-studio/v2` project schema. Existing
`nodus-contract-studio/v1` escrow files and saves keep their original meaning.
Conversion is explicit and creates a detached v2 copy: save it under a new name
to retain both versions. Importing an earlier file does not silently overwrite
its named v1 save.
The legacy graph must contain its required states and paths before conversion;
repair an incomplete graph in the original escrow editor first. Blank participant
addresses or other unfinished settings can remain blank in the converted draft.

The named-project list is shared with the earlier escrow editor and holds up to
50 entries in the same browser, device and website origin. Saving a new project
creates a snapshot; saving changes updates the open named project. The working
draft's automatic browser save is separate. Loading, replacing or deleting a
saved project asks for confirmation when appropriate and retains the other
named entries. Invalid or unreadable stored data is not silently overwritten.

Export project files for backups or transfer to another browser or computer.
Clearing website data can remove local saves. A project contains the workflow,
roles, amounts, conditions and layout; it does not contain a deployed contract's
on-chain execution state or a simulation run.

## Inspect and simulate

The source view shows the Solidity generated from the current workflow. Action
labels are mapped to numeric functions such as `action_0()`; the mapping is
shown by the editor. Labels are not inserted as executable Solidity. Hash
recording functions take a `bytes32` argument. Other action functions have no
arguments, and only deposit actions accept a nonzero transaction value.

Function numbering follows sorted action identifiers. Adding or removing an
action can therefore renumber the functions in newly generated source. Keep
each source export and its action mapping together, and use the ABI compiled
from that exact source when interacting with a deployed version.
The source view and export manifest also map numeric stage values and
`role_N` constants to the project's state and role names.

The simulator uses the same configured states, roles, operations and predicates.
Choose a caller, execute an action, advance time and inspect balances, approvals
and the stored hash. A rejected action or failed recipient transfer leaves the
simulation's state, balances, approvals, hash and clock unchanged. Loading or
editing an agreement clears the previous simulation.

Simulation is a local JavaScript model, not execution of compiled Nodus bytecode
or an audit. It does not model gas, transaction ordering, arbitrary hostile
callbacks, forced EVM balances, chain reorganizations or the native/EVM bridge.
Generated source must be reviewed and tested independently before use.

## Compile and use the source

Download `ObservatoryWorkflow.sol`. Use the pinned Nodus address256 compiler
described in the [compiler instructions](contract-studio.md#compile-offline-with-nodus-solc):

```bash
python3 tools/contract-studio/compile.py /path/to/ObservatoryWorkflow.sol \
  --contract ObservatoryWorkflow \
  --solc /path/to/solc-nodus \
  --project /path/to/project.json \
  --out /path/to/new-compiled-workflow
```

The constructor has no arguments. Role addresses, amounts, conditions and the
deadline are fixed into the self-contained source, which uses no imports or
linked libraries. Stock Ethereum solc and 20-byte address tooling do not replace
the Nodus compiler and wallet. The browser does not generate ABI or bytecode.

The generated contract checks conditions before effects, changes state before
outbound transfers and protects entry points against reentrancy. A failed
transfer reverts the transaction. These safeguards do not make an arbitrary
user-designed workflow an audited escrow service.

The current executable palette does not include external contract calls,
arbitrary Solidity, external oracle data, upgrades or automatic transaction
scheduling. Extending the language requires corresponding validation,
generation, simulation and tests.
