"""Economic invariants and public JSON/CSV contracts, not implementation mirrors."""
import csv
import itertools
import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from tokenomics_simulator import DEFAULTS, ParameterError, simulate
from tokenomics_simulator.model import TOTAL_SUPPLY


PHYSICAL_STOCKS = (
    "validator_reserve_nod", "storage_reserve_nod", "other_locked_nod",
    "validator_locked_nod", "storage_locked_nod", "lending_cash_nod", "wallet_nod",
)


class StockFlowTests(unittest.TestCase):
    def assert_invariants(self, result):
        self.assertEqual(result["schema_version"], 1)
        self.assertEqual(len(result["series"]), result["parameters"]["months"] + 1)
        for row in result["series"]:
            self.assertAlmostEqual(sum(row[key] for key in PHYSICAL_STOCKS), TOTAL_SUPPLY, delta=0.001)
            self.assertLessEqual(row["validators"], 32 + 1e-9)
            self.assertLessEqual(row["storage_nodes"], 256 + 1e-9)
            self.assertLessEqual(row["borrowed_nod"], row["validator_locked_nod"] + row["storage_locked_nod"] + 1e-6)
            # Pool cash and outstanding principal are views of the same capital.
            self.assertAlmostEqual(row["lending_cash_nod"] + row["borrowed_nod"],
                                   result["parameters"]["lending_pool_nod"] + row["interest_paid_nod"], delta=0.001)
            for value in row.values():
                self.assertTrue(math.isfinite(value))
                self.assertGreaterEqual(value, 0)
        json.dumps(result, allow_nan=False)

    def test_default_is_reproducible_and_storage_enters_more_slowly(self):
        first, second = simulate(), simulate()
        self.assertEqual(first, second)
        self.assert_invariants(first)
        self.assertLess(first["summary"]["storage_nodes"], first["summary"]["validators"])
        self.assertAlmostEqual(first["series"][12]["storage_nodes"], 5.2)
        self.assertFalse(first["metadata"]["live_chain_data"])
        self.assertEqual(first["parameters"], DEFAULTS)

    def test_reserve_decay_matches_epoch_fraction_without_fees(self):
        result = simulate({"months": 12, "fees_nod_year": 0, "borrowed_share": 0,
                           "validator_entry_per_month": 0, "storage_entry_per_month": 0,
                           "validator_cost_usdt_year": 0, "storage_cost_usdt_year": 0,
                           "required_return_pct": 0})
        expected_fraction = (1 - 1 / 65536) ** 8760
        self.assertAlmostEqual(result["summary"]["validator_reserve_nod"], 200_000_000 * expected_fraction, delta=0.001)
        self.assertAlmostEqual(result["summary"]["storage_reserve_nod"], 100_000_000 * expected_fraction, delta=0.001)
        self.assert_invariants(result)

    def test_fees_refill_consensus_only_and_are_existing_wallet_tokens(self):
        result = simulate({"months": 12, "validator_reserve_nod": 0, "storage_reserve_nod": 0,
                           "fees_nod_year": 12_000, "borrowed_share": 0,
                           "validator_entry_per_month": 0, "storage_entry_per_month": 0,
                           "validator_cost_usdt_year": 0, "storage_cost_usdt_year": 0,
                           "required_return_pct": 0})
        start, end = result["series"][0], result["summary"]
        self.assertEqual(end["fees_paid_nod"], 12_000)
        self.assertEqual(end["storage_reserve_nod"], 0)
        self.assertGreater(end["validator_reserve_nod"], 0)
        self.assertAlmostEqual(start["wallet_nod"] - end["wallet_nod"], end["validator_reserve_nod"], delta=0.001)
        self.assert_invariants(result)

    def test_no_storage_nodes_means_no_archive_reward_distribution(self):
        result = simulate({"months": 12, "initial_storage": 0, "storage_entry_per_month": 0})
        self.assertEqual(result["summary"]["storage_nodes"], 0)
        self.assertEqual(result["summary"]["storage_reserve_nod"], DEFAULTS["storage_reserve_nod"])
        self.assert_invariants(result)

    def test_zero_storage_population_can_attract_a_first_operator(self):
        result = simulate({"months": 12, "initial_storage": 0})
        self.assertGreater(result["summary"]["storage_nodes"], 0)
        self.assertLess(result["summary"]["storage_reserve_nod"], DEFAULTS["storage_reserve_nod"])
        self.assert_invariants(result)

    def test_high_storage_hardware_cost_changes_participation(self):
        baseline = simulate({"months": 12})
        costly = simulate({"months": 12, "storage_cost_usdt_year": 1_000_000})
        self.assertLess(costly["summary"]["storage_nodes"], baseline["summary"]["storage_nodes"])
        self.assert_invariants(costly)

    def test_unfunded_interest_is_a_claim_without_fabricated_tokens(self):
        result = simulate({"months": 12, "validator_reserve_nod": 0, "storage_reserve_nod": 0,
                           "initial_storage": 0, "other_locked_nod": 984_000_000,
                           "lending_pool_nod": 16_000_000, "borrowed_share": 1,
                           "fees_nod_year": 0, "validator_cost_usdt_year": 0,
                           "required_return_pct": 0})
        self.assertGreater(result["summary"]["arrears_nod"], 0)
        self.assertEqual(result["summary"]["interest_paid_nod"], 0)
        self.assert_invariants(result)

    def test_regimes_conserve_supply_and_respect_protocol_caps(self):
        for block_seconds, borrowing, hoarding, demand in itertools.product((1, 60), (0, 1), (0, 3), (-15, 25)):
            with self.subTest(block_seconds=block_seconds, borrowing=borrowing, hoarding=hoarding, demand=demand):
                result = simulate({"months": 240, "block_seconds": block_seconds,
                                   "borrowed_share": borrowing, "hoarding_strength": hoarding,
                                   "demand_growth_pct": demand, "validator_entry_per_month": 32,
                                   "storage_entry_per_month": 256})
                self.assert_invariants(result)

    def test_no_lending_liquidity_or_fee_revenue_is_valid_without_debt(self):
        result = simulate({"months": 12, "lending_pool_nod": 0, "borrowed_share": 0,
                           "fees_nod_year": 0, "validator_reserve_nod": 0, "storage_reserve_nod": 0})
        self.assertEqual(result["summary"]["borrowed_nod"], 0)
        self.assertEqual(result["summary"]["interest_paid_nod"], 0)
        self.assert_invariants(result)

    def test_fully_borrowed_exit_cannot_make_empty_wallet_negative(self):
        result = simulate({"months": 12, "validator_bond_nod": 100_000_000,
                           "storage_bond_nod": 100_000, "initial_validators": 1,
                           "initial_storage": 0, "lending_pool_nod": 500_000_000,
                           "borrowed_share": 1, "block_seconds": 60,
                           "validator_cost_usdt_year": 1_000_000,
                           "storage_cost_usdt_year": 0, "fees_nod_year": 0,
                           "validator_entry_per_month": 32, "storage_entry_per_month": 0,
                           "required_return_pct": 100, "hoarding_strength": 0,
                           "demand_growth_pct": 25})
        self.assert_invariants(result)
        self.assertEqual(result["summary"]["fees_paid_nod"], 0)


class ValidationTests(unittest.TestCase):
    def test_rejects_unknown_non_numeric_nonfinite_and_out_of_range_values(self):
        cases = [None, True, "5", float("nan"), float("inf"), -1, 0, 61]
        for value in cases:
            with self.subTest(value=value), self.assertRaises(ParameterError):
                simulate({"block_seconds": value})
        for parameter in ([], "scenario", False, 1):
            with self.subTest(parameter=parameter), self.assertRaises(ParameterError):
                simulate(parameter)
        for parameter in ({"unknown": 5}, {"months": 12.5}, {"initial_validators": 33},
                          {"initial_storage": 257}, {"storage_bond_nod": 2_000_000},
                          {"months": 10 ** 900}):
            with self.subTest(parameter=parameter), self.assertRaises(ParameterError):
                simulate(parameter)

    def test_initial_allocations_must_fit_and_loans_must_be_funded(self):
        for parameter in ({"validator_reserve_nod": 1_000_000_000},
                          {"lending_pool_nod": 1, "borrowed_share": 1},
                          {"initial_validators": 32, "validator_bond_nod": 100_000_000}):
            with self.subTest(parameter=parameter), self.assertRaises(ParameterError):
                simulate(parameter)

    def test_input_mapping_and_exported_defaults_are_not_mutated(self):
        original = dict(DEFAULTS)
        supplied = {"months": 12, "borrowed_share": 0}
        simulate(supplied)
        self.assertEqual(supplied, {"months": 12, "borrowed_share": 0})
        self.assertEqual(DEFAULTS, original)


class CliTests(unittest.TestCase):
    def test_cli_exports_the_same_monthly_series_to_json_and_csv(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            parameters, output, csv_path = root / "parameters.json", root / "scenario.json", root / "scenario.csv"
            parameters.write_text('{"months":12}', encoding="utf-8")
            command = [sys.executable, "-m", "tokenomics_simulator", "--parameters", str(parameters),
                       "--output", str(output), "--csv", str(csv_path)]
            run = subprocess.run(command, capture_output=True, text=True, check=False)
            self.assertEqual(run.returncode, 0, run.stderr)
            data = json.loads(output.read_text())
            with csv_path.open(newline="") as handle:
                rows = list(csv.DictReader(handle))
            self.assertEqual(len(rows), 13)
            self.assertEqual(float(rows[-1]["validators"]), data["summary"]["validators"])
            self.assertEqual(float(rows[-1]["validator_reserve_nod"]), data["summary"]["validator_reserve_nod"])
            self.assertEqual(run.stdout, "")

    def test_cli_default_stdout_and_invalid_input(self):
        run = subprocess.run([sys.executable, "-m", "tokenomics_simulator"], capture_output=True, text=True, check=False)
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertEqual(json.loads(run.stdout)["schema_version"], 1)
        with tempfile.TemporaryDirectory() as temp:
            parameters = Path(temp) / "invalid.json"
            parameters.write_text('{"months":true}', encoding="utf-8")
            run = subprocess.run([sys.executable, "-m", "tokenomics_simulator", "--parameters", str(parameters)], capture_output=True, text=True, check=False)
            self.assertEqual(run.returncode, 2)
            self.assertIn("months", run.stderr)

    def test_cli_will_not_overwrite_parameters_or_mix_output_formats(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "parameters.json"
            path.write_text("{}", encoding="utf-8")
            run = subprocess.run([sys.executable, "-m", "tokenomics_simulator", "--parameters", str(path), "--output", str(path)], capture_output=True, text=True, check=False)
            self.assertEqual(run.returncode, 2)
            self.assertEqual(path.read_text(), "{}")

    def test_cli_rejects_duplicate_parameter_keys(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "parameters.json"
            path.write_text('{"months":12,"months":120}', encoding="utf-8")
            run = subprocess.run([sys.executable, "-m", "tokenomics_simulator", "--parameters", str(path)], capture_output=True, text=True, check=False)
            self.assertEqual(run.returncode, 2)
            self.assertIn("duplicate", run.stderr)


if __name__ == "__main__":
    unittest.main()
