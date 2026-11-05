import concurrent.futures
import hashlib
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import trade_board as board


NOW = 1_800_000_000


def listing(identifier="11"):
    return {
        "schema": "nodus-trade/listing-v1", "id": "0x" + identifier * 32,
        "name": "1000 NODUS for test USDT", "side": "sell_nodus",
        "nodusAmount": "1000.12345678", "usdtAmount": "10.000000000000000001",
        "maker": {"nodus": "0x" + "22" * 32, "bsc": "0x" + "33" * 20},
        "asset": {"kind": "bep20", "chainId": 97, "token": "0x" + "44" * 20, "decimals": 18, "symbol": "TEST-USDT"},
        "createdAt": NOW, "expiresAt": NOW + 24 * 60 * 60,
    }


def taker(nodus="55", bsc="66"):
    return {"nodus": "0x" + nodus * 32, "bsc": "0x" + bsc * 20}


class TradeBoardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name)
        self.config = {"state_dir": str(self.path)}
        self.clock = patch.object(board, "_now", return_value=NOW)
        self.clock.start()

    def tearDown(self):
        self.clock.stop()
        self.temp.cleanup()

    def assert_code(self, code, function, *args, status=None):
        with self.assertRaises(board.BoardError) as error:
            function(*args)
        self.assertEqual(error.exception.code, code)
        if status is not None:
            self.assertEqual(error.exception.status, status)
        return error.exception

    def create(self, identifier="11"):
        return board.create(self.config, listing(identifier))

    def test_create_read_persist_and_keep_management_token_private(self):
        result = self.create()
        token = result["managementToken"]
        self.assertRegex(token, r"^[0-9a-f]{64}$")
        self.assertIsNone(result["listing"]["reservation"])
        observed = board.board(dict(self.config))
        self.assertEqual(observed["schema"], "nodus-trade/board-v1")
        self.assertEqual(observed["trust"], "unverified_advertisements")
        self.assertEqual(observed["serverTime"], NOW)
        self.assertEqual(observed["listings"], [result["listing"]])
        public = json.dumps(observed)
        self.assertNotIn(token, public)
        self.assertNotIn("management", public)
        self.assertNotIn("confirmed", public)
        self.assertEqual(observed["listings"][0]["usdtAmount"], "10.000000000000000001")
        with sqlite3.connect(self.path / "trade/board.sqlite3") as database:
            digest = database.execute("SELECT management_hash FROM listings").fetchone()[0]
        self.assertEqual(digest, hashlib.sha256(token.encode("ascii")).hexdigest())
        self.assertNotEqual(digest, token)
        self.assertNotIn(token.encode("ascii"), (self.path / "trade/board.sqlite3").read_bytes())

    def test_duplicate_id_and_unknown_private_fields_refused(self):
        self.create()
        self.assert_code("listing_exists", board.create, self.config, listing(), status=409)
        for key in ("secret", "seed", "privateKey", "recovery", "taker", "hashlock", "signature", "reservation", "managementToken"):
            value = listing("12")
            value[key] = "not-public"
            self.assert_code("invalid_schema", board.create, self.config, value)
        self.assertEqual(len(board.board(self.config)["listings"]), 1)

    def test_unknown_nested_fields_and_native_or_mainnet_asset_refused(self):
        variants = []
        for patch_value in ({"chainId": 56}, {"chainId": True}, {"kind": "native"}, {"decimals": 6}, {"decimals": True}, {"symbol": "USDT"}, {"token": "0x" + "00" * 20}, {"unexpected": 1}):
            value = listing()
            value["asset"].update(patch_value)
            variants.append(value)
        value = listing()
        value["maker"]["unexpected"] = "secret"
        variants.append(value)
        for value in variants:
            with self.assertRaises(board.BoardError):
                board.create(self.config, value)
        self.assertFalse((self.path / "trade").exists(), "invalid input must not open storage")

    def test_exact_decimal_uint256_limits_and_invalid_numbers(self):
        for field, decimals in (("nodusAmount", 8), ("usdtAmount", 18)):
            for invalid in ("0", "-1", "+1", "1e6", "01", "1,2", " 1", "1.", "NaN", "1." + "0" * decimals + "1", "9" * 78, 1, 1.5, True, None):
                value = listing()
                value[field] = invalid
                self.assert_code("invalid_amount", board.create, self.config, value)
        maximum = str(board.UINT256_MAX // 10 ** 18) + "." + str(board.UINT256_MAX % 10 ** 18).zfill(18)
        value = listing()
        value["usdtAmount"] = maximum
        self.assertEqual(board.validate_listing(value, NOW)["usdtAmount"], maximum)
        value["usdtAmount"] = str(board.UINT256_MAX // 10 ** 18 + 1)
        self.assert_code("invalid_amount", board.validate_listing, value, NOW)

    def test_times_types_expiry_and_clock_skew(self):
        for changes in ({"createdAt": True}, {"expiresAt": NOW}, {"createdAt": NOW - 301}, {"createdAt": NOW + 301}, {"expiresAt": NOW + board.MAX_LIFETIME + 1}, {"expiresAt": 253402300800}, {"createdAt": -1}):
            value = listing()
            value.update(changes)
            self.assert_code("invalid_expiry", board.create, self.config, value)
        result = self.create()
        with patch.object(board, "_now", return_value=NOW + 24 * 60 * 60):
            self.assertEqual(board.board(self.config)["listings"], [])
            self.assert_code("listing_unavailable", board.reserve, self.config, {"id": result["listing"]["id"], "taker": taker()}, status=404)

    def test_bad_identifiers_names_schema_and_size(self):
        for field, invalid in (("id", "0x" + "00" * 32), ("id", "../../something"), ("id", "0x" + "12" * 20), ("name", ""), ("name", " x"), ("name", "x" * 81), ("name", "hi\n"), ("schema", "nodus-trade/offer-v2"), ("side", "swap")):
            value = listing()
            value[field] = invalid
            with self.assertRaises(board.BoardError):
                board.create(self.config, value)
        value = listing()
        value["name"] = "x" * (board.MAX_BYTES + 1)
        self.assert_code("request_too_large", board.create, self.config, value, status=413)
        for invalid in (None, [], "text", {"schema": "nodus-trade/listing-v1"}):
            self.assert_code("invalid_schema", board.create, self.config, invalid)

    def test_addresses_normalize_and_hostile_text_is_inert(self):
        value = listing()
        value["name"] = "<img src=x onerror=alert(1)> '); DROP TABLE listings; --"
        value["maker"]["nodus"] = "0x" + "AB" * 32
        value["asset"]["token"] = "0x" + "CD" * 20
        result = board.create(self.config, value)
        self.assertEqual(result["listing"]["name"], value["name"])
        self.assertEqual(result["listing"]["maker"]["nodus"], value["maker"]["nodus"].lower())
        self.assertEqual(board.board(self.config)["listings"][0]["asset"]["token"], value["asset"]["token"].lower())
        self.assertEqual(len(board.board(self.config)["listings"]), 1)

    def test_reserve_once_and_expiry_allows_new_reservation(self):
        created = self.create()
        payload = {"id": created["listing"]["id"], "taker": taker()}
        result = board.reserve(self.config, payload)
        reservation = result["reservation"]
        self.assertEqual(result["listing"]["reservation"], reservation)
        self.assertEqual(reservation["taker"], taker())
        self.assertEqual(reservation["listingId"], payload["id"])
        self.assertEqual(reservation["expiresAt"], NOW + 600)
        self.assertEqual(board.board(self.config)["listings"][0]["reservation"], reservation)
        self.assert_code("already_reserved", board.reserve, self.config, payload, status=409)
        with patch.object(board, "_now", return_value=NOW + 600):
            self.assertIsNone(board.board(self.config)["listings"][0]["reservation"])
            next_result = board.reserve(self.config, {"id": payload["id"], "taker": taker("77", "88")})
            self.assertNotEqual(next_result["reservation"]["id"], reservation["id"])
            self.assertEqual(next_result["reservation"]["taker"], taker("77", "88"))

    def test_reservation_never_outlives_listing(self):
        value = listing()
        value["expiresAt"] = NOW + 60
        board.create(self.config, value)
        result = board.reserve(self.config, {"id": value["id"], "taker": taker()})
        self.assertEqual(result["reservation"]["expiresAt"], NOW + 60)

    def test_reserve_rejects_same_party_or_unknown_fields(self):
        result = self.create()
        for party in (taker(nodus="22"), taker(bsc="33")):
            self.assert_code("same_party", board.reserve, self.config, {"id": result["listing"]["id"], "taker": party})
        self.assert_code("invalid_schema", board.reserve, self.config, {"id": result["listing"]["id"], "taker": taker(), "secret": "no"})
        self.assert_code("listing_unavailable", board.reserve, self.config, {"id": "0x" + "99" * 32, "taker": taker()}, status=404)

    def test_simultaneous_reservation_has_one_winner(self):
        result = self.create()
        gate = threading.Barrier(2)
        def attempt(party):
            gate.wait(timeout=5)
            try:
                return board.reserve(self.config, {"id": result["listing"]["id"], "taker": party})
            except board.BoardError as error:
                return error
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(attempt, [taker(), taker("77", "88")]))
        self.assertEqual(sum(isinstance(value, dict) for value in results), 1)
        errors = [value for value in results if isinstance(value, board.BoardError)]
        self.assertEqual([(value.code, value.status) for value in errors], [("already_reserved", 409)])
        self.assertIsNotNone(board.board(self.config)["listings"][0]["reservation"])

    def test_cancel_requires_token_does_not_cancel_reserved_trade(self):
        result = self.create()
        identifier, token = result["listing"]["id"], result["managementToken"]
        self.assert_code("invalid_management_token", board.cancel, self.config, {"id": identifier, "managementToken": "00" * 32}, status=403)
        self.assert_code("invalid_management_token", board.cancel, self.config, {"id": "0x" + "77" * 32, "managementToken": token}, status=403)
        for invalid in (None, "", "0x" + token, token.upper()):
            self.assert_code("invalid_management_token", board.cancel, self.config, {"id": identifier, "managementToken": invalid}, status=403)
        board.reserve(self.config, {"id": identifier, "taker": taker()})
        self.assert_code("already_reserved", board.cancel, self.config, {"id": identifier, "managementToken": token}, status=409)
        with patch.object(board, "_now", return_value=NOW + 600):
            cancelled = board.cancel(self.config, {"id": identifier, "managementToken": token})
            self.assertEqual(cancelled, {"schema": "nodus-trade/cancel-result-v1", "id": identifier, "cancelled": True})
            self.assertEqual(board.board(self.config)["listings"], [])
            self.assert_code("listing_unavailable", board.reserve, self.config, {"id": identifier, "taker": taker()}, status=404)
            self.assertEqual(board.cancel(self.config, {"id": identifier, "managementToken": token}), cancelled)

    def test_active_and_tombstone_bounds_and_expiry_cleanup(self):
        with patch.object(board, "MAX_ACTIVE", 2):
            self.create("11")
            self.create("12")
            self.assert_code("board_full", board.create, self.config, listing("13"), status=409)
            self.assertEqual(len(board.board(self.config)["listings"]), 2)
            with patch.object(board, "_now", return_value=NOW + 86400):
                value = listing("13")
                value["createdAt"], value["expiresAt"] = NOW + 86400, NOW + 2 * 86400
                board.create(self.config, value)
                self.assertEqual(len(board.board(self.config)["listings"]), 1)
            with sqlite3.connect(self.path / "trade/board.sqlite3") as connection:
                self.assertEqual(connection.execute("SELECT COUNT(*) FROM listings").fetchone()[0], 1)
        # Cancellation retains the id until expiry rather than reinterpreting it.
        self.assert_code("listing_exists", board.create, self.config, listing("13"), status=409)

    def test_cancelled_tombstones_are_bounded(self):
        with patch.object(board, "MAX_ACTIVE", 1):
            for index in range(10):
                result = self.create(f"{index + 1:02x}")
                board.cancel(self.config, {"id": result["listing"]["id"], "managementToken": result["managementToken"]})
            self.assertEqual(board.board(self.config)["listings"], [])
            self.assert_code("board_full", board.create, self.config, listing("aa"), status=409)

    def test_corrupt_stored_payload_or_reservation_is_unavailable(self):
        result = self.create()
        with sqlite3.connect(self.path / "trade/board.sqlite3") as connection:
            payload = listing()
            payload["secret"] = "do-not-export"
            connection.execute("UPDATE listings SET payload=?", (json.dumps(payload),))
        self.assert_code("board_unavailable", board.board, self.config, status=503)
        with sqlite3.connect(self.path / "trade/board.sqlite3") as connection:
            connection.execute("UPDATE listings SET payload=?,reservation=?,reserved_until=?", (json.dumps(listing()), json.dumps({"wrong": "private"}), NOW + 600))
        self.assert_code("board_unavailable", board.board, self.config, status=503)

    def test_cancelled_id_not_reused_before_original_expiry(self):
        result = self.create()
        board.cancel(self.config, {"id": result["listing"]["id"], "managementToken": result["managementToken"]})
        self.assert_code("listing_exists", board.create, self.config, listing(), status=409)
        self.assertEqual(board.board(self.config)["listings"], [])

    def test_storage_symlinks_unavailable_and_errors_do_not_echo_input(self):
        outside = self.path / "outside"
        outside.mkdir()
        (self.path / "trade").symlink_to(outside, target_is_directory=True)
        error = self.assert_code("board_unavailable", board.board, self.config, status=503)
        self.assertNotIn(str(self.path), str(error))
        (self.path / "trade").unlink()
        (self.path / "trade").mkdir()
        (self.path / "trade/board.sqlite3").symlink_to(outside / "private")
        self.assert_code("board_unavailable", board.create, self.config, listing(), status=503)
        self.assertFalse((outside / "private").exists())

    def test_corrupt_database_does_not_become_empty_board(self):
        (self.path / "trade").mkdir()
        (self.path / "trade/board.sqlite3").write_text("broken sqlite private data")
        error = self.assert_code("board_unavailable", board.board, self.config, status=503)
        self.assertNotIn("private", str(error))
        self.assertEqual((self.path / "trade/board.sqlite3").read_text(), "broken sqlite private data")


if __name__ == "__main__":
    unittest.main()
