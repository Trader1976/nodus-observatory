"""Synthetic upstream fixtures; no deployment account or server data."""
import copy
import csv
from datetime import datetime, timezone
import importlib.util
from http.client import IncompleteRead
import io
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import URLError
from urllib.parse import parse_qs, urlsplit

spec = importlib.util.spec_from_file_location('scan_rewards', Path(__file__).with_name('rewards.py'))
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
CHAIN, OWNER, NODE = 'a' * 64, 'b' * 128, 'c' * 128
TS = int(datetime(2026, 1, 15, tzinfo=timezone.utc).timestamp())


def event(height, amount='1', sequence=0):
    return dict(height=height, sequence=sequence, amount=amount, time=TS * 1000)


def page(items=None, releases=None, paid='0', released='0', next_before=None, next_release_before=None):
    return dict(address=OWNER, from_height=1, at_height=1000, paid_total=paid,
                released_total=released, pending='29', items=items or [], releases=releases or [],
                next_before=next_before, next_release_before=next_release_before)


class ScanRewardTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name)
        self.ledger = self.base / 'reporting.sqlite3'
        self.pin = patch.object(r, 'SCAN_CHAIN_ID', CHAIN)
        self.pin.start()
        self.calls = []

    def tearDown(self):
        self.pin.stop()
        self.tmp.cleanup()

    def fetcher(self, pages, stats=None):
        iterator = iter(copy.deepcopy(pages))
        def fetch(path, timeout):
            self.calls.append(path)
            self.assertGreater(timeout, 0)
            self.assertLessEqual(timeout, 6)
            if path == 'stats':
                return dict(chain_id=CHAIN, indexed_height=1000) if stats is None else stats()
            return next(iterator)
        return fetch

    def collect(self, pages, **kwargs):
        with patch.object(r, '_scan_json', side_effect=self.fetcher(pages)):
            return r.collect_scan_rewards(self.ledger, CHAIN, OWNER, NODE, **kwargs)

    def count(self):
        with sqlite3.connect(self.ledger) as db:
            return db.execute('SELECT count(*) FROM reward_events').fetchone()[0]

    def local_source(self, amount='7', low=900):
        live = self.base / ('witness_' + CHAIN[:32] + '.db')
        with sqlite3.connect(live) as db:
            db.executescript('''
              CREATE TABLE v2_blocks(global_height INTEGER PRIMARY KEY);
              INSERT INTO v2_blocks VALUES(1000);
              CREATE TABLE v2_reward_accrual(owner_fp BLOB PRIMARY KEY,amount INTEGER);
              CREATE TABLE addr_history(h INTEGER,i INTEGER,seq INTEGER,owner BLOB,
                kind TEXT,amount INTEGER,token BLOB,ts INTEGER,PRIMARY KEY(h,i,seq));
              CREATE INDEX idx_addr_history_owner ON addr_history(owner,h,i,seq);
              CREATE TABLE addr_history_mark(id INTEGER PRIMARY KEY,from_height INTEGER,last_height INTEGER);
            ''')
            db.execute('INSERT INTO addr_history_mark VALUES(1,?,1000)', (low,))
            db.execute('INSERT INTO v2_reward_accrual VALUES(?,123)', (bytes.fromhex(OWNER),))
            db.execute('INSERT INTO addr_history VALUES(?,?,?,?,?,?,?,?)',
                       (950, r.BOUNDARY, 0, bytes.fromhex(OWNER), 'payout', int(amount), r.NATIVE, TS))
        return live

    def test_independent_cursors_exact_amounts_release_and_source_specific_csv(self):
        big = '9007199254740993'
        pages = [page([event(950, big)], [event(700, '12', 1)], paid=str(int(big) + 5),
                      released='15', next_before='950:0', next_release_before='700:1'),
                 page([event(100, '5')], [event(600, '3', 1)], paid=str(int(big) + 5), released='15')]
        result = self.collect(pages)
        self.assertEqual(result['status'], 'ok')
        self.assertEqual(result['rows'], 4)
        self.assertIn('before=950:0&release_before=700:1', self.calls[2])
        self.assertNotIn('%3A', self.calls[2])
        query = parse_qs(urlsplit(self.calls[2]).query)
        self.assertEqual(query['before'], ['950:0'])
        self.assertEqual(query['release_before'], ['700:1'])
        report = r.report(self.ledger, 2026)
        self.assertEqual(report['source']['status'], 'partial')
        self.assertEqual(report['source']['scan']['status'], 'ok')
        self.assertEqual(report['source']['local']['status'], 'unavailable')
        self.assertEqual(report['summary']['paid_raw'], str(int(big) + 5))
        self.assertEqual(report['summary']['released_raw'], '15')
        self.assertIsNone(report['summary']['pending_raw'])
        self.assertFalse(report['source']['complete_year'])
        self.assertEqual(report['source']['runs'][0]['source'], r.SCAN_SOURCE)
        csv_rows = list(csv.DictReader(io.StringIO(r.export_csv(self.ledger, 2026).decode('utf-8-sig'))))
        self.assertEqual(len(csv_rows), 4)
        self.assertTrue(all(row['source'] == r.SCAN_SOURCE for row in csv_rows))
        self.assertTrue(all(row['source_from_height'] == '1' for row in csv_rows))
        self.assertTrue(all(row['year_coverage_complete'] == 'false' for row in csv_rows))

    def test_completed_stream_repeated_by_api_is_not_counted_twice(self):
        pages = [page([event(900, '7')], [event(700, '2', 1)], paid='7', released='5',
                      next_release_before='700:1'),
                 page([event(900, '7')], [event(600, '3', 1)], paid='7', released='5')]
        self.assertEqual(self.collect(pages)['status'], 'ok')
        self.assertEqual(self.count(), 3)
        query = parse_qs(urlsplit(self.calls[2]).query)
        self.assertNotIn('before', query)
        self.assertIn('release_before', query)

    def test_scan_first_then_local_and_repeat_preserve_valuation_and_local_pending(self):
        p = page([event(950, '7'), event(100, '5')], paid='12')
        self.assertEqual(self.collect([p])['status'], 'ok')
        eid = r._event_id(CHAIN, OWNER, 950, r.BOUNDARY, 0)
        valuation = self.base / 'valuation.json'
        valuation.write_text(json.dumps(dict(schema_version=1, valuations=[dict(event_id=eid,
            price_eur='0.2', source='synthetic evidence', valuation_at='2026-01-15T00:00:00Z')])) )
        r.import_valuations(self.ledger, valuation)
        live = self.local_source()
        r.collect_rewards(live, self.ledger, CHAIN, OWNER, NODE)
        self.assertEqual(self.collect([p], cache_seconds=0)['status'], 'ok')
        report = r.report(self.ledger, 2026)
        self.assertEqual(self.count(), 2)
        self.assertEqual(report['summary']['paid_raw'], '12')
        self.assertEqual(report['summary']['pending_raw'], '123')
        self.assertEqual(report['summary']['eur_total'], '0.000000014')
        self.assertEqual(report['source']['local']['from_height'], 900)
        self.assertEqual(report['source']['from_height'], 1)
        with sqlite3.connect(self.ledger) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM reward_valuation_audit').fetchone()[0], 1)

    def test_local_first_overlap_retains_origin_and_both_coverage_sources(self):
        live = self.local_source()
        r.collect_rewards(live, self.ledger, CHAIN, OWNER, NODE)
        self.assertEqual(self.collect([page([event(950, '7'), event(100, '5')], paid='12')])['status'], 'ok')
        rows = list(csv.DictReader(io.StringIO(r.export_csv(self.ledger, 2026).decode('utf-8-sig'))))
        by_height = {row['height']: row for row in rows}
        self.assertEqual(by_height['950']['source'], r.LOCAL_SOURCE)
        self.assertEqual(by_height['950']['source_from_height'], '900')
        self.assertEqual(by_height['100']['source'], r.SCAN_SOURCE)
        self.assertEqual(by_height['100']['source_from_height'], '1')
        self.assertEqual(len(json.loads(by_height['100']['source_coverage_runs'])), 2)

    def test_conflict_rolls_back_whole_batch_and_preserves_stored_data(self):
        live = self.local_source()
        r.collect_rewards(live, self.ledger, CHAIN, OWNER, NODE)
        # First new event is inserted before a later conflicting replay.
        p = page([event(975, '3'), event(950, '8')], paid='11')
        result = self.collect([p])
        self.assertEqual(result['status'], 'error')
        self.assertIn('changed', result['reason'])
        self.assertEqual(self.count(), 1)
        report = r.report(self.ledger, 2026)
        self.assertEqual(report['summary']['paid_raw'], '7')
        self.assertEqual(report['summary']['pending_raw'], '123')
        self.assertEqual(len(report['source']['runs']), 1)
        self.assertEqual(report['source']['status'], 'partial')

    def test_chain_verification_before_and_after_requests(self):
        for changed_at in (0, 1):
            with self.subTest(changed_at=changed_at):
                calls = iter([dict(chain_id='d' * 64 if i == changed_at else CHAIN,
                                   indexed_height=1000) for i in range(2)])
                fetch = self.fetcher([page([event(700)], paid='1')], stats=lambda: next(calls))
                with patch.object(r, '_scan_json', side_effect=fetch):
                    result = r.collect_scan_rewards(self.ledger, CHAIN, OWNER, NODE, cache_seconds=0)
                self.assertEqual(result['status'], 'error')
                self.assertEqual(self.count(), 0)

    def test_explorer_index_can_lag_reward_database_without_regressing(self):
        fetch = self.fetcher([page([event(900, '7')], paid='7')],
                             stats=lambda: dict(chain_id=CHAIN, indexed_height=998))
        with patch.object(r, '_scan_json', side_effect=fetch):
            result = r.collect_scan_rewards(self.ledger, CHAIN, OWNER, NODE)
        self.assertEqual(result['status'], 'ok')
        self.assertEqual(result['at_height'], 1000)
        self.assertEqual(r.report(self.ledger, 2026)['summary']['paid_raw'], '7')

    def test_explorer_index_regression_against_its_own_snapshot_is_refused(self):
        indices = iter((1000, 999))
        fetch = self.fetcher([page([event(900, '7')], paid='7')],
                             stats=lambda: dict(chain_id=CHAIN, indexed_height=next(indices)))
        with patch.object(r, '_scan_json', side_effect=fetch):
            result = r.collect_scan_rewards(self.ledger, CHAIN, OWNER, NODE)
        self.assertEqual(result['status'], 'error')
        self.assertIn('indexed height regressed', result['reason'])
        self.assertEqual(self.count(), 0)
        self.assertIsNone(r.report(self.ledger, 2026)['summary']['paid_raw'])

    def test_unavailable_and_cached_failure_preserve_success_metadata_and_events(self):
        self.collect([page([event(900, '7')], paid='7')])
        previous = r.report(self.ledger, 2026)['source']['scan']
        with patch.object(r, '_scan_json', side_effect=URLError('offline')) as fetch:
            failed = r.collect_scan_rewards(self.ledger, CHAIN, OWNER, NODE, cache_seconds=0)
            self.assertEqual(failed['status'], 'error')
            cached = r.collect_scan_rewards(self.ledger, CHAIN, OWNER, NODE)
            self.assertTrue(cached['cached'])
            self.assertEqual(fetch.call_count, 1)
        report = r.report(self.ledger, 2026)
        self.assertEqual(report['summary']['paid_raw'], '7')
        self.assertEqual(report['source']['scan']['last_success_at'], previous['last_success_at'])
        self.assertEqual(report['source']['scan']['from_height'], 1)

    def test_incomplete_transport_preserves_observed_events(self):
        self.collect([page([event(900, '7')], paid='7')])
        with patch.object(r, '_scan_json', side_effect=IncompleteRead(b'partial', 100)):
            result = r.collect_scan_rewards(self.ledger, CHAIN, OWNER, NODE, cache_seconds=0)
        self.assertEqual(result['status'], 'error')
        self.assertEqual(r.report(self.ledger, 2026)['summary']['paid_raw'], '7')

    def test_success_cache_disable_then_reenable(self):
        self.collect([page([event(900, '7')], paid='7')])
        with patch.object(r, '_scan_json', side_effect=AssertionError('no request')):
            self.assertTrue(r.collect_scan_rewards(self.ledger, CHAIN, OWNER, NODE)['cached'])
            self.assertEqual(r.collect_scan_rewards(self.ledger, CHAIN, OWNER, NODE, enabled=False)['status'], 'disabled')
        self.assertEqual(r.report(self.ledger, 2026)['summary']['paid_raw'], '7')
        self.assertEqual(self.collect([page([event(900, '7')], paid='7')])['status'], 'ok')

    def test_invalid_api_fields_are_atomic_not_false_zero(self):
        alterations = [
            ('owner', lambda p: p.update(address='d' * 128)),
            ('bool height', lambda p: p['items'][0].update(height=True)),
            ('float amount', lambda p: p['items'][0].update(amount=1.0)),
            ('leading zero', lambda p: p['items'][0].update(amount='01')),
            ('overflow', lambda p: p['items'][0].update(amount=str(r.MAX_INT + 1))),
            ('fractional time', lambda p: p['items'][0].update(time=TS * 1000 + 1)),
            ('out of coverage', lambda p: p['items'][0].update(height=1001)),
            ('bad total', lambda p: p.update(paid_total='9')),
            ('missing cursor', lambda p: p.pop('next_before')),
            ('nonprogress cursor', lambda p: p.update(next_before='1000:0')),
            ('cursor bool', lambda p: p.update(next_before=True)),
            ('duplicate', lambda p: p['items'].append(copy.deepcopy(p['items'][0]))),
            ('unknown coverage', lambda p: p.update(from_height=None)),
        ]
        for name, alter in alterations:
            with self.subTest(name=name):
                p = page([event(900, '7')], paid='7')
                alter(p)
                self.assertEqual(self.collect([p], cache_seconds=0)['status'], 'error')
                self.assertEqual(self.count(), 0)
                self.assertIsNone(r.report(self.ledger, 2026)['summary']['paid_raw'])

    def test_changed_snapshot_row_and_page_budgets_refuse_partial_import(self):
        first = page([event(900, '7')], paid='12', next_before='900:0')
        last = page([event(800, '5')], paid='13')
        self.assertEqual(self.collect([first, last])['status'], 'error')
        self.assertEqual(self.collect([first], max_pages=1, cache_seconds=0)['status'], 'error')
        self.assertEqual(self.collect([page([event(900), event(800)], paid='2')], max_rows=1,
                                      cache_seconds=0)['status'], 'error')
        self.assertEqual(self.count(), 0)

    def test_unknown_chain_network_and_binding_refused_without_http(self):
        with patch.object(r, '_scan_json', side_effect=AssertionError('no request')):
            result = r.collect_scan_rewards(self.ledger, CHAIN, OWNER, NODE, network='mainnet')
            self.assertEqual(result['status'], 'error')
            with self.assertRaisesRegex(ValueError, 'separate'):
                r.collect_scan_rewards(self.ledger, 'd' * 64, OWNER, NODE)
            with self.assertRaisesRegex(ValueError, 'separate'):
                r.collect_scan_rewards(self.ledger, CHAIN, 'd' * 128, NODE)

    def test_http_fixed_origin_json_limits_duplicate_keys_and_headers(self):
        class Response:
            def __init__(self, raw, url=r.SCAN_ROOT + 'stats'):
                self.raw, self.url = io.BytesIO(raw), url
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def geturl(self): return self.url
            def read1(self, limit):
                self.limit = limit
                return self.raw.read(limit)
        class Opener:
            def __init__(self, response): self.response = response
            def open(self, request, timeout):
                self.request, self.timeout = request, timeout
                return self.response
        opener = Opener(Response(b'{"chain_id":"' + CHAIN.encode() + b'"}'))
        with patch.object(r, 'build_opener', return_value=opener):
            self.assertEqual(r._scan_json('stats', 2)['chain_id'], CHAIN)
        self.assertEqual(opener.request.get_header('User-agent'), 'Nodus-Observatory/1.0')
        self.assertEqual(opener.request.get_header('Accept'), 'application/json')
        for raw, url in ((b'{}', 'https://example.com/api/stats'),
                         (b'{"x":1,"x":2}', r.SCAN_ROOT + 'stats'),
                         (b'{}' + b' ' * r.SCAN_MAX_BYTES, r.SCAN_ROOT + 'stats'),
                         (b'{"x":NaN}', r.SCAN_ROOT + 'stats')):
            with self.subTest(url=url, size=len(raw)):
                with patch.object(r, 'build_opener', return_value=Opener(Response(raw, url))):
                    with self.assertRaises(ValueError):
                        r._scan_json('stats', 2)
        redirect = r._ScanRedirect()
        with self.assertRaisesRegex(ValueError, 'outside'):
            redirect.redirect_request(None, None, 302, 'redirect', {}, 'http://scan.nodusnetwork.io/api/stats')

    def test_http_read_deadline_checked_after_final_empty_chunk(self):
        clock = [0]
        class Response:
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def geturl(self): return r.SCAN_ROOT + 'stats'
            def read1(self, limit):
                clock[0] = 3
                return b''
        class Opener:
            def open(self, *args, **kwargs): return Response()
        with patch.object(r.time, 'monotonic', side_effect=lambda: clock[0]), \
                patch.object(r, 'build_opener', return_value=Opener()):
            with self.assertRaisesRegex(TimeoutError, 'request time budget'):
                r._scan_json('stats', 2)

    def test_final_request_over_total_deadline_never_imports(self):
        clock = [0]
        stats_calls = [0]
        def fetch(path, timeout):
            if path == 'stats':
                stats_calls[0] += 1
                if stats_calls[0] == 2:
                    clock[0] = 26
                return dict(chain_id=CHAIN, indexed_height=1000)
            return page([event(900, '7')], paid='7')
        with patch.object(r.time, 'monotonic', side_effect=lambda: clock[0]), \
                patch.object(r, '_scan_json', side_effect=fetch):
            result = r.collect_scan_rewards(self.ledger, CHAIN, OWNER, NODE, deadline_seconds=25)
        self.assertEqual(result['status'], 'error')
        self.assertIn('time budget', result['reason'])
        self.assertEqual(self.count(), 0)
        self.assertIsNone(r.report(self.ledger, 2026)['summary']['paid_raw'])

    def test_request_deadline_is_bounded_before_next_http_request(self):
        with patch.object(r, 'time') as clock, patch.object(r, '_scan_json') as fetch:
            clock.time.return_value = 100
            clock.monotonic.side_effect = [10, 40]
            result = r.collect_scan_rewards(self.ledger, CHAIN, OWNER, NODE, deadline_seconds=25)
            self.assertEqual(result['status'], 'error')
            self.assertIn('time budget', result['reason'])
            fetch.assert_not_called()


if __name__ == '__main__':
    unittest.main()
