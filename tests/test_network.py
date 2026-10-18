import sys
from pathlib import Path
import unittest
from unittest.mock import patch
import tempfile
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
import network


class NetworkTests(unittest.TestCase):
    def test_committee_parse_does_not_count_other_logs(self):
        r = network.parse_committee('''[INF/client] connecting
Committee for block 250689 (epoch start 250560), from 127.0.0.1:4001
[0]
    p2p id: abc123
    address: 192.0.2.1:4004
    stake: 100000000000000
    commission: 100 bps
    power: 42
[1]
    address: 192.0.2.2:4004
Committee size: 2
''')
        self.assertEqual(r['count'], 2)
        self.assertEqual(r['height'], 250689)
        self.assertEqual(r['seats'][0]['stake_raw'], '100000000000000')
        self.assertEqual(r['seats'][0]['commission_bps'], 100)
        self.assertIsNone(network.parse_committee('command failed')['count'])

    def test_no_data_is_unknown_not_zero(self):
        with tempfile.TemporaryDirectory() as d:
            with patch.object(network, 'read_api', side_effect=TimeoutError('unreachable')), patch.object(network, 'committee_text', side_effect=TimeoutError('offline')):
                r = network.collect_network(d, {})
            self.assertFalse(r['available'])
            self.assertIsNone(r['stats'])
            self.assertIsNone(r['tps'])
            self.assertIsNone(r['committee']['count'])
            self.assertEqual(len(r['errors']), 3)


if __name__ == '__main__':
    unittest.main()
