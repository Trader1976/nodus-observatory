"""Keep distributable examples synthetic and safe for an arbitrary installation."""
import ipaddress
import json
from pathlib import Path
import re
import unittest
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]
PREVIEW_FILES = ("snapshot.json", "history.json", "network.json", "rewards.json", "events.json")
DOCUMENTATION_NETWORKS = tuple(ipaddress.ip_network(cidr) for cidr in (
    "192.0.2.0/24", "198.51.100.0/24", "203.0.113.0/24",
))


def load_preview(name):
    return json.loads((ROOT / "dist" / name).read_text(encoding="utf-8"))


def public_text_files():
    """Read source directories only; never inspect git history or user state."""
    suffixes = {".md", ".json", ".py", ".mjs", ".js", ".html", ".sh", ".service", ".timer", ".yml"}
    yield from ROOT.glob("*.md")
    for directory in ("backend", "dist", "docs", "rewards", "tests", ".github/workflows"):
        yield from (path for path in (ROOT / directory).rglob("*") if path.is_file() and path.suffix in suffixes)


class PublicExamplesTests(unittest.TestCase):
    def test_every_preview_source_explicitly_identifies_synthetic_data(self):
        for name in PREVIEW_FILES:
            with self.subTest(source=name):
                sample = load_preview(name)
                self.assertIs(sample["preview"], True)
                self.assertIs(sample["demo"], True)
                self.assertEqual(sample["provenance"]["kind"], "synthetic")
                self.assertIn("not collected", sample["provenance"]["description"])

    def test_preview_identities_are_consistent_obvious_placeholders(self):
        snapshot, rewards = load_preview("snapshot.json"), load_preview("rewards.json")
        node = snapshot["node"]
        self.assertEqual(node["fingerprint"], "a" * 128)
        self.assertEqual(node["p2p_id"], node["fingerprint"][:64])
        self.assertEqual(node["owner"], "b" * 128)
        self.assertEqual(snapshot["chain"]["chain_id"], "c" * 64)
        self.assertEqual(rewards["node_fp"], node["fingerprint"])
        self.assertEqual(rewards["owner_fp"], node["owner"])
        self.assertEqual(rewards["chain_id"], snapshot["chain"]["chain_id"])
        self.assertEqual(node["hostname"], "demo-node")
        self.assertTrue(any(ipaddress.ip_address(node["external_ip"]) in network for network in DOCUMENTATION_NETWORKS))
        self.assertEqual(snapshot["resources"]["hostname"], node["hostname"])

    def test_demo_never_presents_invented_rewards_as_accounting_records(self):
        rewards = load_preview("rewards.json")
        self.assertEqual(rewards["source"]["status"], "unavailable")
        self.assertIs(rewards["source"]["complete_year"], False)
        self.assertEqual(rewards["items"], [])
        self.assertEqual(rewards["releases"], [])
        self.assertIsNone(rewards["summary"]["paid_raw"])
        self.assertIsNone(rewards["summary"]["paid_nodus"])
        self.assertIsNone(rewards["summary"]["eur_total"])

    def test_configuration_does_not_ship_a_server_identity_or_public_listener(self):
        config = json.loads((ROOT / "backend/config.example.json").read_text(encoding="utf-8"))
        self.assertTrue(ipaddress.ip_address(config["bind_host"]).is_loopback)
        self.assertEqual(set(config["allowed_hosts"]), {"127.0.0.1", "localhost", "::1"})
        for field in ("fingerprint", "disk_device", "network_interface"):
            self.assertIsNone(config[field], field)

    def test_source_examples_use_reserved_addresses_and_generic_home_paths(self):
        for path in public_text_files():
            text = path.read_text(encoding="utf-8")
            for candidate in re.findall(r"(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.])", text):
                with self.subTest(file=str(path.relative_to(ROOT)), address=candidate):
                    address = ipaddress.ip_address(candidate)
                    self.assertTrue(address.is_loopback or address.is_unspecified or any(
                        address in network for network in DOCUMENTATION_NETWORKS
                    ), "Use a loopback address or an RFC 5737 documentation address in public examples")
            for username in re.findall(r"/home/([A-Za-z0-9_.-]+)", text):
                with self.subTest(file=str(path.relative_to(ROOT)), home=username):
                    self.assertIn(username, ("USER", "USERNAME"), "Use ~ or a generic uppercase home-directory placeholder")
            for fingerprint in re.findall(r"\b[0-9a-fA-F]{128}\b", text):
                with self.subTest(file=str(path.relative_to(ROOT)), identity=fingerprint[:8]):
                    self.assertEqual(len(set(fingerprint.lower())), 1,
                                     "Use an obvious repeated-character placeholder instead of a node or wallet fingerprint")

    def test_documentation_language_pairs_link_to_each_other(self):
        for english, finnish in (
            ("README.md", "README_fin.md"),
            ("docs/remote-access.md", "docs/remote-access_fin.md"),
            ("rewards/README.md", "rewards/README_fin.md"),
        ):
            for source, target in ((english, finnish), (finnish, english)):
                with self.subTest(document=source):
                    path = ROOT / source
                    self.assertTrue(path.is_file(), "Both documentation languages are available")
                    links = re.findall(r"\[[^\]]*\]\(([^\s)]+)\)", path.read_text(encoding="utf-8"))
                    resolved = [(path.parent / unquote(urlsplit(link).path)).resolve() for link in links
                                if not urlsplit(link).scheme and urlsplit(link).path]
                    self.assertIn(ROOT / target, resolved, "Each language version links to its counterpart")

    def test_relative_documentation_links_resolve_inside_the_repository(self):
        documents = list(ROOT.glob("*.md")) + list((ROOT / "docs").rglob("*.md")) + list((ROOT / "rewards").rglob("*.md"))
        for path in documents:
            text = path.read_text(encoding="utf-8")
            for match in re.finditer(r"\[[^\]]*\]\(([^\s)]+)(?:\s+[\"'][^)]*)?\)", text):
                target = match.group(1).strip("<>")
                parsed = urlsplit(target)
                if parsed.scheme or parsed.netloc or not parsed.path:
                    continue
                resolved = (path.parent / unquote(parsed.path)).resolve()
                with self.subTest(document=str(path.relative_to(ROOT)), link=target):
                    self.assertTrue(resolved.is_relative_to(ROOT), "Documentation links stay within the repository")
                    self.assertTrue(resolved.exists(), "Relative documentation link does not exist")


if __name__ == "__main__":
    unittest.main()
