# Economic scenario engine

This standard-library Python module is an exploratory stock-flow model, **not a
Nodus ledger, an oracle, or a market forecast**. It performs no I/O, RPC, signing
or persistent writes when imported or when simulate() is called. The defaults
are illustrative starting balances, not measurements of the current testnet.

Run from the repository root:

    python3 -m tokenomics_simulator > scenario.json
    python3 -m tokenomics_simulator --parameters assumptions.json --output scenario.json --csv scenario.csv
    python3 -m unittest discover -s tokenomics_simulator/tests -v

The parameter input is a JSON object containing any subset of DEFAULTS.
Unknown or duplicate keys, booleans, strings used as numbers, non-finite numbers,
over-budget initial allocations, and initial borrowing without funding are
rejected. Runs are bounded to 12–240 monthly steps and always include the initial
month-zero row. JSON output and CSV output must differ from the input file.

    from tokenomics_simulator import simulate
    result = simulate({"storage_cost_usdt_year": 2400, "storage_entry_per_month": 0.05})
    print(result["summary"]["storage_nodes"])

## Stocks and claims

The physical supply is always:

    validator reserve + storage reserve + other locked treasury
    + validator locks + storage locks + lending cash + wallets = 1 billion NOD

Borrowed principal is a **subset of node locks**, never another supply stock.
Lender principal and paid income satisfy:

    lending cash + borrowed principal = initial lending capital + cumulative paid interest

Unpaid interest is tracked separately as a claim; it never creates tokens. The
model neither writes off those claims nor liquidates borrower collateral.

## Rewards and participation

Both reserves pay a budget of their remaining amount divided by 65,536 per epoch
of 720 blocks. Monthly aggregation uses the continuous approximation
1 - (1 - 1/65536) ** epochs_in_month, with a 365-day year and fractional epochs.
It omits raw-unit truncation and the chain's individual settlement timing.

After monthly node entry/exit, available assumed network fees move from wallets
into the **consensus** reserve before rewards. The storage reserve gets no fee
refill. Rewards move from each reserve to wallets only while its modeled role has
participants. All modeled active validators qualify; commissions, voting-power
caps, downtime and differences in archive assignment are omitted. Storage is an
average per-node archive share, not a prediction of any server's rewards.

Node counts are continuous aggregate estimates. Profitable entry is limited by
available owned/lent tokens, the role's monthly entry ceiling and the active role
cap. The current modeled limits are 32 active validators and 256 storage nodes;
validator candidates waiting for a seat are not simulated. Defaults allow four
new validators versus 0.1 storage operators per month. This slower storage entry
and its higher annual hardware-amortization/operation cost express a **user
hypothesis**, not measured adoption or a relative protocol hardware requirement.

Roles enter/exit according to gross NOD rewards minus assumed USDT costs,
average borrowing costs, and a required return threshold. Each entrant finances
the borrowed_share fraction of its bond. Higher NOD prices affect the fiat cost
ratio; they do not multiply the gross token reward rate. Exits return principal
immediately: the protocol's unbonding delays are not represented.

## Lending and price

The illustrative borrow APR starts at 3%, reaches 10% at 80% utilization, and
rises quadratically to 90% at full utilization. This is a simulator assumption,
not an asserted Nodus lending rule. Interest first consumes borrowed stakes'
share of rewards; shortfalls are purchased from offered wallet tokens, limited
to 8% of that offered stock per month. External USDT funding is assumed rather
than modeled. Paid interest goes back into lending cash.

The price index is a heuristic based on offered wallet liquidity, available
lending cash, price-responsive hoarding, and an externally supplied trend. It
does **not** clear actual order books or establish a future price. Changes are
limited to a monthly log step of ±0.20 as an adjustment-speed assumption.

Every output carries source links pinned to the upstream commit and a complete
assumptions list. Node counts at the final date are snapshots, not proof of a
stable equilibrium. USDT collateral, liquidation/default, slashing, lock delays,
market execution and consensus outages are omitted. The model assumes block
production continues at the configured interval.
