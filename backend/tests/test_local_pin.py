import tempfile
import unittest
from unittest.mock import patch

from network import collect_network, local_cli_args
from network_statistics.collector import _nodes


class LocalPinTests(unittest.TestCase):
    def test_invalid_or_mismatched_identity_never_builds_a_query(self):
        for fp in (None, "bad", "0" * 127):
            with self.subTest(fp=fp), self.assertRaises(ValueError):
                local_cli_args({"cli_path": "/nodus-cli"}, fp, "witness")
        with self.assertRaises(ValueError):
            local_cli_args({"cli_path": "/nodus-cli", "fingerprint": "b" * 128}, "a" * 128, "witness")

    def test_pinned_committee_enters_directory_and_merges_storage(self):
        fingerprint = "a" * 128
        node_id = "b" * 64
        output = ("Committee for block 123\n[0]\n    p2p id: " + node_id +
                  "\n    address: 198.51.100.8:4004\n    stake: 100\n    power: 1\n")
        with tempfile.TemporaryDirectory() as directory, \
             patch("network.read_api", return_value={}), \
             patch("collector.run_command", return_value={"error": None, "returncode": 0, "output": output}) as run:
            data = collect_network(directory, {"cli_path": "/nodus-cli"}, fingerprint)
        self.assertEqual(run.call_args.args[0], ["/nodus-cli", "-s", "127.0.0.1", "--pin", fingerprint, "witness"])
        self.assertEqual(data["committee"]["count"], 1)
        storage = {"nodes": [{"id": node_id, "fingerprint": node_id + "c" * 64,
                              "roles": ["storage"], "storage": {}}]}
        nodes = _nodes(data["committee"], storage, "now", [])
        self.assertEqual(len(nodes), 1)
        self.assertEqual(nodes[0]["roles"], ["witness", "storage"])


if __name__ == "__main__":
    unittest.main()
