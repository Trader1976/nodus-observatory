"""A bounded monthly economic scenario, not a ledger implementation or forecast.

Amounts are floating-point NOD rather than ledger raw units. Physical token
stocks always sum to TOTAL_SUPPLY. Lending claims and arrears are never added
to those stocks. All participants in a role are averaged together: individual
validator commissions, archive assignments and participation are not inferred.
"""
from __future__ import annotations

from collections.abc import Mapping
import math

TOTAL_SUPPLY = 1_000_000_000.0
EPOCH_BLOCKS = 720
REWARD_DIVISOR = 65_536
ACTIVE_VALIDATOR_LIMIT = 32
STORAGE_LIMIT = 256
SOURCE_COMMIT = "d9cefb4fcf2e2e9ce073cedacaff45caa93c8e2c"

DEFAULTS = {
    "months": 120,
    "block_seconds": 5.0,
    "validator_reserve_nod": 200_000_000.0,
    "storage_reserve_nod": 100_000_000.0,
    "other_locked_nod": 200_000_000.0,
    "validator_bond_nod": 2_000_000.0,
    "storage_bond_nod": 1_000_000.0,
    "initial_validators": 8,
    "initial_storage": 4,
    "lending_pool_nod": 100_000_000.0,
    "borrowed_share": 0.4,
    "validator_cost_usdt_year": 360.0,
    "storage_cost_usdt_year": 1_800.0,
    "validator_entry_per_month": 4.0,
    "storage_entry_per_month": 0.1,
    "fees_nod_year": 1_000_000.0,
    "initial_price_usdt": 0.1,
    "demand_growth_pct": 0.0,
    "hoarding_strength": 1.0,
    "required_return_pct": 6.0,
}

# Every work/input budget is explicit. JSON booleans are not numbers here.
_BOUNDS = {
    "months": (12, 240),
    "block_seconds": (1, 60),
    "validator_reserve_nod": (0, TOTAL_SUPPLY),
    "storage_reserve_nod": (0, TOTAL_SUPPLY),
    "other_locked_nod": (0, TOTAL_SUPPLY),
    "validator_bond_nod": (100_000, 100_000_000),
    "storage_bond_nod": (100_000, 1_000_000),
    "initial_validators": (1, ACTIVE_VALIDATOR_LIMIT),
    "initial_storage": (0, STORAGE_LIMIT),
    "lending_pool_nod": (0, TOTAL_SUPPLY),
    "borrowed_share": (0, 1),
    "validator_cost_usdt_year": (0, 1_000_000),
    "storage_cost_usdt_year": (0, 1_000_000),
    "validator_entry_per_month": (0, ACTIVE_VALIDATOR_LIMIT),
    "storage_entry_per_month": (0, STORAGE_LIMIT),
    "fees_nod_year": (0, TOTAL_SUPPLY),
    "initial_price_usdt": (0.000001, 100),
    "demand_growth_pct": (-15, 25),
    "hoarding_strength": (0, 3),
    "required_return_pct": (0, 100),
}
_INTEGERS = {"months", "initial_validators", "initial_storage"}


class ParameterError(ValueError):
    """A scenario request is invalid; callers may return an HTTP 400."""


def _parameters(values):
    if values is None:
        values = {}
    if not isinstance(values, Mapping):
        raise ParameterError("parameters must be a JSON object")
    if set(values) - set(DEFAULTS):
        raise ParameterError("unknown simulation parameter")
    result = dict(DEFAULTS)
    for key, value in values.items():
        low, high = _BOUNDS[key]
        # Bound arbitrary-size JSON integers before math.isfinite converts them.
        if (isinstance(value, bool) or not isinstance(value, (int, float))
                or not low <= value <= high or not math.isfinite(value)):
            raise ParameterError(f"{key} must be a finite number in [{low:g}, {high:g}]")
        if key in _INTEGERS and value != int(value):
            raise ParameterError(f"{key} must be an integer")
        result[key] = int(value) if key in _INTEGERS else float(value)
    locked = (result["initial_validators"] * result["validator_bond_nod"]
              + result["initial_storage"] * result["storage_bond_nod"])
    borrowed = locked * result["borrowed_share"]
    if borrowed > result["lending_pool_nod"]:
        raise ParameterError("lending_pool_nod cannot fund the initial borrowed stakes")
    initial_cash = result["lending_pool_nod"] - borrowed
    allocated = (result["validator_reserve_nod"] + result["storage_reserve_nod"]
                 + result["other_locked_nod"] + locked + initial_cash)
    if allocated > TOTAL_SUPPLY:
        raise ParameterError("initial physical allocations exceed the fixed billion NOD")
    return result


def _clamp(value, low, high):
    return max(low, min(high, value))


def _metadata():
    base = f"https://github.com/nocdem/dna/blob/{SOURCE_COMMIT}/"
    return {
        "model_kind": "hypothetical_monthly_stock_flow",
        "live_chain_data": False,
        "total_supply_nod": TOTAL_SUPPLY,
        "epoch_blocks": EPOCH_BLOCKS,
        "reward_divisor": REWARD_DIVISOR,
        "active_validator_limit": ACTIVE_VALIDATOR_LIMIT,
        "storage_limit": STORAGE_LIMIT,
        "upstream_commit": SOURCE_COMMIT,
        "parameter_bounds": {key: list(bounds) for key, bounds in _BOUNDS.items()},
        "assumptions": [
            "All starting balances and economic inputs are scenario assumptions, not observed testnet state.",
            "Validator and storage reserves follow their separate remaining-pool / 65536 reward budgets.",
            "Fractional epochs and monthly continuous decay approximate epoch rounding and fee timing; no new NOD is minted.",
            "After monthly node entry/exit, available wallet fees are credited to the consensus reserve before rewards; storage receives no fee refill.",
            "All modeled active validators qualify for rewards; average rewards are proportional to locked stake, with no commissions.",
            "Storage rewards use an average equal per-node archive share; assignments, grace and failed proofs are omitted.",
            "Node counts are continuous aggregate estimates. Active validators are capped at 32; waiting bonded candidates are omitted.",
            "Higher storage hardware costs and a slower entry limit are user hypotheses, not protocol requirements or measured adoption.",
            "Annual hardware amortization is included in each role's assumed USDT operating cost.",
            "Price is an offered-liquidity, hoarding and external-demand heuristic; it is not a market-clearing forecast.",
            "Borrowers can fund interest purchases externally in USDT, limited by offered NOD; their USDT funding capacity is not simulated.",
            "Interest is paid from borrower rewards then market purchases. Unpaid interest is a claim, never extra tokens.",
            "Loan interest is reinvested into the lending pool. Lending rates are illustrative utilization curves, not Nodus protocol settings.",
            "Principal exits return immediately; unbond delays, USDT collateral, liquidation, credit losses, slashing and execution costs are omitted.",
            "Node profitability uses gross token income minus assumed fiat costs, average loan interest and a required return threshold.",
            "Block production is assumed to continue at the supplied interval; consensus outages and governance changes are not modeled.",
            "Year-end or final node counts are snapshots and do not establish that an equilibrium has been reached.",
        ],
        "sources": [
            {"label": "Genesis allocation template", "url": base + "nodus/tools/genesis/testnet_v3.conf.template", "commit": SOURCE_COMMIT},
            {"label": "Validator reward settlement", "url": base + "nodus/src/witness/nodus_witness_v2_econ.c", "commit": SOURCE_COMMIT},
            {"label": "Storage reward settlement", "url": base + "nodus/src/witness/nodus_witness_v2_storage.c", "commit": SOURCE_COMMIT},
            {"label": "Role, bond and epoch constants", "url": base + "dnac/include/dnac/dnac.h", "commit": SOURCE_COMMIT},
        ],
    }


def simulate(parameters=None):
    """Return a reproducible monthly scenario. This function does no I/O."""
    p = _parameters(parameters)
    validator_reserve = p["validator_reserve_nod"]
    storage_reserve = p["storage_reserve_nod"]
    other_locked = p["other_locked_nod"]
    role = {
        "validator": {"bond": p["validator_bond_nod"], "locked": p["initial_validators"] * p["validator_bond_nod"],
                      "limit": ACTIVE_VALIDATOR_LIMIT, "cost": p["validator_cost_usdt_year"], "entry": p["validator_entry_per_month"]},
        "storage": {"bond": p["storage_bond_nod"], "locked": p["initial_storage"] * p["storage_bond_nod"],
                    "limit": STORAGE_LIMIT, "cost": p["storage_cost_usdt_year"], "entry": p["storage_entry_per_month"]},
    }
    for item in role.values():
        item["borrowed"] = item["locked"] * p["borrowed_share"]
        item["owned"] = item["locked"] - item["borrowed"]
    cash = p["lending_pool_nod"] - sum(item["borrowed"] for item in role.values())
    wallet = TOTAL_SUPPLY - validator_reserve - storage_reserve - other_locked - cash - sum(item["locked"] for item in role.values())
    price_index, prior_return, arrears = 100.0, 0.0, 0.0
    fees_paid = interest_paid = market_interest = max_error = 0.0
    initial_liquidity = max(1e-12, wallet * 0.65 + cash * 0.35)
    # A 365-day year: E=720, five-second blocks -> 730 epochs/month.
    epochs_month = 365 * 86400 / (12 * EPOCH_BLOCKS * p["block_seconds"])
    monthly_fraction = -math.expm1(epochs_month * math.log1p(-1 / REWARD_DIVISOR))
    series = []

    def borrowed_total():
        return sum(item["borrowed"] for item in role.values())

    def utilization():
        debt = borrowed_total() + arrears
        return debt / (cash + debt) if cash + debt else 0.0

    def loan_rate():
        u = utilization()
        return 0.03 + 0.07 * u / 0.8 if u <= 0.8 else 0.10 + 0.8 * ((u - 0.8) / 0.2) ** 2

    def record(month, reward_validator, reward_storage):
        nonlocal max_error
        physical = (validator_reserve + storage_reserve + other_locked + cash + wallet
                    + sum(item["locked"] for item in role.values()))
        error = abs(physical - TOTAL_SUPPLY)
        max_error = max(max_error, error)
        if error > 0.001:
            raise ArithmeticError("simulation token conservation failed")
        v, s = role["validator"], role["storage"]
        row = {
            "month": month, "year": month / 12,
            "price_index": price_index, "price_usdt": p["initial_price_usdt"] * price_index / 100,
            "validators": v["locked"] / v["bond"], "storage_nodes": s["locked"] / s["bond"],
            "validator_reward_pct": 1200 * reward_validator / v["locked"] if v["locked"] else 0.0,
            "storage_reward_pct": 1200 * reward_storage / s["locked"] if s["locked"] else 0.0,
            "borrow_apr_pct": 100 * loan_rate(), "utilization_pct": 100 * utilization(),
            "validator_reserve_nod": validator_reserve, "storage_reserve_nod": storage_reserve,
            "other_locked_nod": other_locked, "validator_locked_nod": v["locked"],
            "storage_locked_nod": s["locked"], "lending_cash_nod": cash, "wallet_nod": wallet,
            "borrowed_nod": borrowed_total(), "validator_borrowed_nod": v["borrowed"],
            "storage_borrowed_nod": s["borrowed"], "arrears_nod": arrears,
            "fees_paid_nod": fees_paid, "interest_paid_nod": interest_paid,
            "market_interest_nod": market_interest,
        }
        if any(not math.isfinite(value) or value < 0 for value in row.values()):
            raise ArithmeticError("simulation produced invalid state")
        series.append(row)

    record(0, validator_reserve * monthly_fraction, storage_reserve * monthly_fraction)
    for month in range(1, p["months"] + 1):
        hoarded = _clamp(0.35 + 0.08 * p["hoarding_strength"] * math.log(price_index / 100)
                         + 1.5 * p["hoarding_strength"] * prior_return, 0.05, 0.95)
        start_rate = loan_rate()
        spot = p["initial_price_usdt"] * price_index / 100
        monthly_fee = min(wallet, p["fees_nod_year"] / 12)
        projected = {"validator": (validator_reserve + monthly_fee) * monthly_fraction,
                     "storage": storage_reserve * monthly_fraction}
        changes = {}
        for name, item in role.items():
            prospective_stake = max(item["bond"], item["locked"])
            gross = 12 * projected[name] / prospective_stake
            debt_fraction = item["borrowed"] / item["locked"] if item["locked"] else p["borrowed_share"]
            gap = gross - item["cost"] / (item["bond"] * spot) - debt_fraction * start_rate - p["required_return_pct"] / 100
            nodes = item["locked"] / item["bond"]
            changes[name] = (min(item["entry"] * _clamp(gap / 0.10, 0, 1), max(0, item["limit"] - nodes))
                             if gap >= 0 else -nodes * _clamp(-0.5 * gap, 0, 0.20)) * item["bond"]

        # Source-bound principal transfers prevent fractional-raw overdrafts.
        for name, item in role.items():
            release = min(item["locked"], max(0, -changes[name]))
            debt_return = min(release, item["borrowed"], release * item["borrowed"] / item["locked"]) if item["locked"] else 0.0
            own_return = min(item["owned"], max(0.0, release - debt_return))
            item["borrowed"] -= debt_return
            item["owned"] -= own_return
            item["locked"] = item["owned"] + item["borrowed"]
            wallet += own_return
            cash += debt_return
        for name, item in role.items():
            desired = max(0, changes[name])
            share = p["borrowed_share"]
            capacity = desired
            if share:
                capacity = min(capacity, cash / share)
                if arrears > 1e-8:
                    capacity = 0.0
            if share < 1:
                capacity = min(capacity, wallet * (1 - hoarded) / (1 - share))
            entry = max(0.0, capacity)
            debt_entry = min(cash, entry * share)
            own_entry = min(wallet, entry * (1 - share))
            cash -= debt_entry
            wallet -= own_entry
            item["borrowed"] += debt_entry
            item["owned"] += own_entry
            item["locked"] = item["owned"] + item["borrowed"]

        # Fees refill only the consensus reserve; they never mint or burn.
        fee = min(wallet, p["fees_nod_year"] / 12)
        wallet -= fee
        validator_reserve += fee
        fees_paid += fee
        v, s = role["validator"], role["storage"]
        paid_v = validator_reserve * monthly_fraction if v["locked"] else 0.0
        paid_s = storage_reserve * monthly_fraction if s["locked"] else 0.0
        validator_reserve -= paid_v
        storage_reserve -= paid_s
        wallet += paid_v + paid_s

        borrower_rewards = sum(paid * item["borrowed"] / item["locked"] if item["locked"] else 0.0
                               for paid, item in ((paid_v, v), (paid_s, s)))
        due = arrears + borrowed_total() * start_rate / 12
        from_rewards = min(due, borrower_rewards, wallet)
        market_capacity = max(0, wallet - from_rewards) * (1 - hoarded) * 0.08
        from_market = min(max(0, due - from_rewards), market_capacity)
        paid_interest = from_rewards + from_market
        wallet -= paid_interest
        cash += paid_interest
        interest_paid += paid_interest
        market_interest += from_market
        arrears = max(0, due - paid_interest)

        liquid = max(1e-12, wallet * (1 - hoarded) + 0.35 * cash)
        target = math.log(100) + 0.7 * math.log(initial_liquidity / liquid) + p["demand_growth_pct"] / 100 * month / 12
        step = _clamp(0.15 * (target - math.log(price_index)) + 0.20 * prior_return, -0.20, 0.20)
        next_price = price_index * math.exp(step)
        prior_return = next_price / price_index - 1
        price_index = next_price
        record(month, paid_v, paid_s)

    summary = dict(series[-1])
    summary.update({
        "peak_price_index": max(row["price_index"] for row in series),
        "peak_validators": max(row["validators"] for row in series),
        "peak_storage_nodes": max(row["storage_nodes"] for row in series),
        "max_supply_error_nod": max_error,
        "lending_assets_nod": cash + borrowed_total(),
        "last_year_validator_change_pct": (series[-1]["validators"] / series[-13]["validators"] - 1) * 100 if series[-13]["validators"] else None,
        "last_year_storage_change_pct": (series[-1]["storage_nodes"] / series[-13]["storage_nodes"] - 1) * 100 if series[-13]["storage_nodes"] else None,
    })
    return {"schema_version": 1, "parameters": p, "metadata": _metadata(), "series": series, "summary": summary}
