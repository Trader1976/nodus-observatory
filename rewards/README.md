# Reward evidence and bookkeeping

[English](README.md) | [Suomi](README_fin.md)

The web server reads only the monitor's independent `reporting.sqlite3` database.
The root collector opens the existing Nodus chain DB using SQLite `mode=ro`,
`query_only=ON`, a read transaction, 200 ms busy timeout and 2 s query deadline.
It never uses `immutable=1`, copies a live database file, checkpoints WAL or
modifies the live database. The owner query uses Nodus' owner index, is limited
to 5,000 rows per collection and fails honestly if that budget is exceeded.

This source is optional. No source means *unknown*, never invented zero earnings.
The source should be the absolute path
`/var/lib/nodus/data/witness_<first 32 hex characters of chain ID>.db`.
The full chain and owner identity come from the collector's observed node status;
the database filename must agree with that chain prefix. This is a local source
binding, not independent cryptographic verification of every payout.

## Verified source contract

The implementation was checked against upstream commit
`24f93e6b709119a3013efacf3a374930c97871b7`:

- [Address history schema and semantics](https://github.com/nocdem/dna/blob/24f93e6b709119a3013efacf3a374930c97871b7/nodus/src/witness/nodus_witness_addr_index.h)
- [Address history schema implementation](https://github.com/nocdem/dna/blob/24f93e6b709119a3013efacf3a374930c97871b7/nodus/src/witness/nodus_witness_addr_index.c)
- [Official explorer reward reader](https://github.com/nocdem/dna/blob/24f93e6b709119a3013efacf3a374930c97871b7/explorer/src/exp_rewards.c)

`addr_history(h,i,seq,owner,kind,amount,token,fee,peer,wire,ts)` has primary key
`(h,i,seq)`. The owner is a 64-byte raw fingerprint, not ASCII hex. Native token
is 64 zero bytes. Boundary payouts and stake releases use `i=4294967295`.
`ts` is the committed block's Unix-seconds timestamp, not collection time.
Boundary `kind='payout'` is a reward; boundary `kind='release'` is returned stake
and is shown separately. Non-boundary EVM release rows are outside this report.

`addr_history_mark(id=1,from_height,last_height)` describes only the current
contiguous run. Its last height must agree with `v2_blocks`' current tip in the
same read snapshot. Index gaps start a new run. Every observed run is retained
in the monitor ledger, and the CSV includes all its known runs.

**The index is off by default in the referenced Nodus version.** Top-level
`"addr_history_index": true` in
`/etc/nodus.conf` enables future history when the witness next starts with this
configuration. There is no historical backfill. This monitor never enables the
index or restarts Nodus itself. An administrator must make that separate choice
before rewards begin if they want a local payout archive from that point onward.

Pending reward is `v2_reward_accrual(owner_fp BLOB,amount INTEGER)` at collection
time. A missing owner row means zero only after a valid successful query. Pending
is kept separate from actual payout events and the selected annual report.

Amounts use exact raw integers and division by 100,000,000. Python integers and
Decimal arithmetic avoid JavaScript's 2^53 precision limit. JSON amounts are
strings. Event deduplication keys include chain, owner, height, item position and
boundary sequence. An existing event with a different time, amount or kind is
rejected; old accounting evidence is never silently overwritten.

The source identifies a *recipient owner*, not a particular storage node. It can
include storage, validator and delegation rewards paid to the same owner. A node
fingerprint identifies the monitored installation; it does not prove attribution
of all the owner's payouts to that storage node.

## HTTP contract

- `GET /api/rewards?year=2026`: exact annual and monthly received payout summaries,
  separate stake releases, current pending amount, observed coverage, and rows.
- `GET /api/rewards/export.csv?year=2026`: UTF-8 BOM, comma-delimited CSV with exact
  raw/NODUS amounts, UTC and Europe/Helsinki timestamps, identifiers, valuation
  evidence, collection times, source coverage and testnet/mainnet label. An empty
  source has a `coverage_metadata` row with no fabricated amount.

The collector currently labels its source as **testnet**. A label in a report
does not establish that a token has market value.

Year/month boundaries use `Europe/Helsinki`, including historical UTC offsets
and DST. CSV includes UTC as well. No view claims an entire year complete based
only on the node's current contiguous index coverage. A temporary source error
does not delete earlier observed events.

## Manual EUR valuation with evidence

There is no automatic token price or EUR value. An absent quote remains null,
not EUR 0.00. This is particularly important for testnet tokens, for which this
tool does not establish market value or tax treatment.

An administrator can record a documented price for an **already observed**
payout using a file with this schema (replace placeholders with actual evidence):

```json
{
  "schema_version": 1,
  "valuations": [
    {
      "event_id": "<event_id from the actual report>",
      "price_eur": "<documented exact decimal price per NODUS>",
      "source": "<quote/evidence URL or document reference>",
      "valuation_at": "<ISO 8601 timestamp with explicit offset>",
      "note": "<why the selected evidence applies to this payout>"
    }
  ]
}
```

```bash
sudo python3 /opt/nodus-monitor/rewards.py value \
  --database /var/lib/nodus-monitor/reporting.sqlite3 \
  --file /etc/nodus-monitor/valuations.json
```

`price_eur` must be a decimal **string**. EUR amount is exactly raw amount /
100,000,000 × price, without binary floats or intermediate cent rounding. Every
replacement preserves the prior revision in `reward_valuation_audit`. A failed
batch is atomic. Annual EUR totals include only valued payouts and expose
`valued_count`, `unvalued_count` and `eur_complete`; no missing values are filled
with zero. Summaries do not calculate tax liability, tax rates, income categories,
FIFO gains or allowable expense deductions.

This is an evidence and reporting tool, not tax advice. Consult the applicable
rules for your jurisdiction; Finnish users can refer to
[Verohallinto's crypto guidance](https://www.vero.fi/syventavat-vero-ohjeet/ohje-hakusivu/48411/kryptovarojen-verotus/).
The tool does not classify storage-service remuneration as passive staking or
determine its legal or tax treatment.

The SQLite ledger and any valuation evidence must be included in normal backups
if they are to be retained for bookkeeping. They are independent of the Nodus
identity directory; the monitor never reads or exports private identity keys.

## Checks

```bash
python3 -m unittest discover -s rewards -p 'test_*.py' -v
```

Tests cover large exact amounts, deduplication, owner filtering, payout/release
separation, missing coverage, coverage gaps, local year/DST boundaries, source
read-only behavior, bounded query failure, exact valuations, audit revisions,
atomic invalid inputs and CSV formula protection. They use temporary synthetic
databases, which are test fixtures and are never shown as real node earnings.
