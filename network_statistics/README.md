# Network statistics

**English** · [Suomi](README_fin.md)

Open **Statistics** in the application's header (`#statistics`). This area
combines recorded network observations with a local index of public Scan block
data. **FIN / ENG** changes the interface language. The time choices are
**24 h, 7 days, 30 days, 1 year and all available history**.

The feature's source is kept in this directory. The existing Observatory,
Contract Studio, Trade and Settings remain separate areas.

Current network cards describe the latest observation. The range selector
filters recorded curves and indexed activity; it does not turn today's node
registry into a historical snapshot.

## What the figures mean

| Figure | Meaning and limits |
| --- | --- |
| Transactions | Applied envelope transactions (`applied_count`) in the indexed range. Claims are counted separately. Ordinary spends, staking operations and EVM operations are shown separately where the source identifies them. A transaction count is not a count of payments between people. |
| Refused items and failed EVM calls | Refused chain items are separate from applied transactions. An applied EVM transaction may fail while still paying its fee; its execution result is counted separately. |
| Transfer amount | Native spend outputs sent to addresses other than all known input owners. This excludes change to the known senders; it is not an economic trade-volume estimate. A spend with unknown input ownership has an unknown transfer total. Known partial totals and coverage are reported separately. |
| Fees | Exact raw-unit amounts from indexed records. Missing fees remain unknown. Testnet NODUS is not assigned a market or EUR value. |
| Active native / EVM addresses | Distinct addresses appearing in the selected indexed activity. The address spaces are counted separately. These are not wallet, user or person counts. |
| First-seen addresses | Addresses first encountered within this installation's indexed range. Until the range reaches genesis, these do not establish when an address first appeared on the chain. An unused, locally created wallet cannot be counted. |
| Validators | Current observed committee and staking information. An active committee seat, a bonded validator and an observed network server describe different things. |
| Storage nodes | Public registry and frozen-set information read from the local chain database. Registration, current membership, grace and failure streak have separate meanings. This does not report the network's total disk capacity. |
| Observed nodes | Nodes known through the collected sources. A node may have several roles; role counts must not be summed as if they were separate machines. The list is not a complete census of the network. A recorded registry row is not evidence that a server is online. |
| Contracts | Indexed EVM creations, calls, execution failures and gas use. Coverage follows the block index; it does not establish the business purpose or trustworthiness of a contract. |

Amounts remain decimal strings in machine-readable data so large integers are
not rounded through JavaScript floating-point numbers. One raw native unit is
10^-8 NODUS; EVM values use their own documented units.

Block-boundary reward payouts and stake releases are outside the item index;
the separate Rewards area handles their accounting. Shielded activity and
off-chain wallet creation are not covered. A node's last-seen time means the
last recorded committee or registry observation, not a transport heartbeat.

## Sources and history

The collector uses the existing network observation: public Scan `stats` and
`tps` responses plus the local committee query. Remote chain data is accepted
only when Scan's chain ID agrees with the observed local node and the supported
public testnet. An unavailable or mismatching source does not become a zero
measurement.

The event index starts near the current tip so recent activity can become
useful before the entire chain is copied. Each collection has bounded work;
new blocks are followed and older blocks are added in the background. A whole
block, its items and the index watermark are committed together. Coverage shows
the indexed heights and whether the selected period is complete.

Scan's ready-made TPS history covers 24 hourly buckets. Longer network curves
need observations collected by this installation. Historical block activity can
be filled from available chain records, but past node reachability and location
cannot be reconstructed from today's observation. Missing observations remain
gaps. An empty covered interval can be a real zero; an unobserved interval is
unknown.

Sources, the last observation, errors and incomplete coverage are displayed in
the statistics area. Stored results can remain useful when a source fails, but
their age and failure state must remain visible. API requests read the
monitoring state; they do not trigger a scan of the network or read the Nodus
database.

## Node map and local location data

The map plots only nodes with a matched location. Nodes without a location stay
in the node list and are counted as unlocated. IP location is approximate and
usually describes a hosting network or data centre, not a person's location.
Several nodes may share one IP address.

Located peer endpoints are also plotted, as diamonds labelled **identity
unconfirmed**. Their map count is separate from identified nodes. Role filters
hide endpoints whose roles are unknown; identifier/location search applies to them.
The local node is labelled **This node** when the status fingerprint/P2P ID
matches an observed registry identity. Its reported public `external_ip` can
fill a missing registry address; an existing committee endpoint takes priority.
Peer-list ordering or a shared IP never establishes an identity binding.

Statistics hides node and endpoint IP addresses in lists, details, map labels,
search and `/api/statistics` JSON. This report-time filter also covers observations
stored before the upgrade. The collector still uses IPs privately for local
GeoIP lookup; country, city and approximate map coordinates remain visible.
Anonymous endpoints use an installation-specific keyed identifier rather than
a reversible plain IP hash. CSV exports contain activity metrics only.
These rules cover the Statistics area and its report/export routes. The separate
administrator monitor, including `/api/dashboard`, keeps its existing scope.

Enable automatic local geolocation when installing or upgrading the monitor:

```bash
sudo bash backend/install.sh --enable-geoip
```

This explicit opt-in installs Debian/Ubuntu's `python3-maxminddb` reader,
backs up the installed monitor configuration, enables geolocation and starts
an unprivileged updater in the background. It does not change Nodus settings.
The first download is approximately 60 MB compressed / 127 MB on disk for the
October 2026 release; allow about 400 MB of free disk space during replacement.

The updater downloads the monthly [DB-IP City Lite MMDB](https://db-ip.com/db/download/ip-to-city-lite)
over HTTPS into `/var/lib/nodus-monitor/geoip/dbip-city-lite.mmdb`. Its timer
checks daily, retries failed releases and skips the download when a valid
current-month database is installed. A replacement is size/time limited,
validated and published atomically. A failed download or invalid candidate
preserves the previous file. The free database has reduced coverage and
accuracy. The map displays the database date and the required
**IP Geolocation by DB-IP** attribution, with its **CC BY 4.0** license link.

Only the full database is downloaded. Node addresses are never sent to DB-IP
or another geolocation API. Public IPv4 and IPv6 lookups use a memory-mapped
local file and a bounded cache (`/var/lib/nodus-monitor/geoip-cache.json`).
The cache is invalidated after a database replacement. Private, reserved and
unresolved addresses stay unknown. A storage registry fingerprint without an
IP address cannot be placed on the map. The collector refreshes derived
locations on the next collection even if the source network observation has
not changed. HTTP requests only read the monitor's stored report.

Check the background download and the resulting coverage:

```bash
systemctl status nodus-monitor-geoip-update.service --no-pager
systemctl is-active nodus-monitor-geoip-update.timer
journalctl -u nodus-monitor-geoip-update.service -n 20 --no-pager
curl -fsS 'http://127.0.0.1:8890/api/statistics?range=24h' \
  | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)["geolocation"], indent=2))'
```

A successful oneshot update service becomes `inactive (dead)` after exit;
its timer stays active. Locations appear after the download and the next
collector run. To retry immediately, run
`sudo systemctl start nodus-monitor-geoip-update.service`.

To disable downloads, stop/disable `nodus-monitor-geoip-update.timer` and set
`statistics_geoip_auto_update: false` in the installed monitor configuration.
Set `statistics_geoip_enabled: false` as well to stop local lookups. The updater
also honours `network_enabled` and `statistics_enabled`; disabling network
collection prevents external downloads. No DB-IP account or API key is needed.

An optional administrator-managed CSV provides manual overrides ahead of the
MMDB. Set `statistics_geoip_file` to its absolute path in
`/etc/nodus-monitor/config.json`. Keep this file outside the repository. The
path is a trusted installation setting, not a browser-editable setting.
[geoip.example.csv](geoip.example.csv) contains reserved documentation addresses
and illustrative locations only; it is not a real GeoIP database.

The required CSV header is
`network,country,country_code,city,latitude,longitude`. `network` accepts an
exact IP or CIDR prefix; the most specific matching prefix wins. Duplicate
networks are rejected. Coordinates must be finite numbers within latitude
−90…90 and longitude −180…180. A country code is optional and, when supplied,
has two letters. The reader accepts at most 100,000 rows and 16 MB. Private
and reserved addresses are never plotted, including the example addresses.

## Witness delegations

Click a witness in the map or node list to open its details. The delegation
panel separates the validator's own bond, its owner's additional delegation
and delegations from other wallets. It shows exact NODUS amounts, a proportional
stake graphic, the ten largest delegators plus the remainder, and a wallet list
with 25 entries per page. Wallet fingerprints identify chain accounts; they do
not identify people or supply their names.

The collector reads committed HF-6 `validators`, `v2_validator_roles` and
`delegations` state from the local witness database in a bounded, read-only
snapshot. Consensus-key hashes join validator records to observed node identities.
The sums of delegation rows must agree with the committed validator totals.
No owner-gated wallet delegation RPC is called.

Each panel reports its source block and observation time. A syncing local node
can trail Scan, so these are the latest supported **local chain** balances,
independent of the chart range. This version does not reconstruct historical
delegation balances. Unsupported schema, failed validation or a read limit
produces an unavailable state, not a zero balance. A completed undelegation is
absent from the current delegation table; a separate locked release is not an
active delegation.

## Installation settings

These administrator-owned keys are optional; existing configurations receive
the defaults shown below. They belong in the monitor configuration, not the
Nodus configuration.

| Key | Default | Accepted value |
| --- | --- | --- |
| `statistics_enabled` | `true` | Boolean. Enables this feature's collection. |
| `statistics_collection_seconds` | `20` | Integer, 2–60; collection time budget. |
| `statistics_max_blocks` | `32` | Integer, 1–256; forward indexing bound per collection. |
| `statistics_backfill_blocks` | `16` | Integer, 0–256; older-block indexing bound per collection. |
| `statistics_geoip_enabled` | `true` | Boolean. Allows local MMDB / CSV lookup when data exists. |
| `statistics_geoip_auto_update` | `false` | Boolean. Downloads require explicit installer opt-in and its timer. |
| `statistics_geoip_file` | `null` | Absolute local CSV override path, or `null`. |
| `statistics_history_days` | `366` | Integer, 1–3660; retained network-observation history. |

`network_enabled: false` disables external collection. A slow or failed source
may leave a collection incomplete; raising a block limit does not override its
time budget. Historic block indexing and recorded network observations have
different coverage and are labelled separately.

The root collector opens the local witness database read-only for public
storage and delegation state. It does not change Nodus configuration, sign transactions or
restart node services. The unprivileged HTTP service reads only the monitor's
stored statistics.

The read-only HTTP endpoints are:

| Endpoint | Result |
| --- | --- |
| `/api/statistics?range=24h` | Statistics JSON, source status and coverage. |
| `/api/statistics/export.csv?range=24h` | CSV export for the selected range. |

Supported `range` values are `24h`, `7d`, `30d`, `1y` and `all`; the default is
`24h`. Exported coverage remains part of the result. A selected range cannot
make an incomplete source complete.

Shorter collected history is still displayed in longer ranges and labelled
partial; seven days of collection are not required to open the `7d` view.
Reports use a six-second read deadline and a separate 500-million SQLite VM
instruction cap. Grand totals avoid sorting all rows into a constant group.
This supports multi-day aggregation without the generic reader's early
20-million-instruction cutoff. Query failures are shown as read errors, not
as a claim that collection has not started. No database reset or reindex is
needed when installing this query-only fix.

See the [main installation guide](../README.md) for the normal installer and
access instructions. Installation is a separate operator action; checking out
this feature branch alone does not update a running server.

## Source layout and development

| Path | Purpose |
| --- | --- |
| `collector.py`, `store.py`, `api.py` | Bounded collection, persistent observations and read-only reports. |
| `indexer.py` | Incremental block index and activity aggregation. |
| `delegations.py` | Bounded read of committed validator/delegator balances. |
| `geolocation.py`, `geoip_common.py` | Local MMDB / CSV lookup, cache and file contracts. |
| `geoip_update.py`, `enable_geoip.sh`, `nodus-monitor-geoip-update.*` | Validated monthly downloads and opt-in systemd setup. |
| `frontend/` | Canonical interface, styles, bundled map and explicit synthetic preview. |
| `tests/` | Synthetic backend and frontend checks. |

`sync_frontend.py` copies the canonical interface assets into `dist/statistics/`.
Those generated copies let the existing application preview use the same
assets as an installed monitor. The Python package is installed under
`/opt/nodus-monitor/network_statistics`.

After editing browser sources, run these from the repository root:

```bash
python3 network_statistics/sync_frontend.py
python3 network_statistics/sync_frontend.py --check
python3 -m pip install maxminddb==3.2.0  # optional reader, required for MMDB tests
python3 -m unittest discover -s network_statistics/tests -v
node network_statistics/tests/frontend.mjs
```

The bundled land outline and its public-domain source are documented in
[frontend/NOTICE.md](frontend/NOTICE.md). It contains geography only, not a list
of node locations.

The preview is explicitly synthetic. It is used only in deliberate demo mode;
a failed live API request must never load it as a replacement measurement.
Preview data is excluded from live installations.

## Upstream references

- [Scan JSON API and indexing rules](https://github.com/nocdem/dna/blob/main/explorer/README.md)
- [Nodus client queries](https://github.com/nocdem/dna/blob/main/nodus/include/nodus/nodus.h)
- [Public server and peer observations](https://github.com/nocdem/dna/blob/main/nodus/src/server/nodus_server.c)
- [HF-6 validator and delegation schema (pinned source)](https://github.com/nocdem/dna/blob/f11561f7debe77d7c5e69bd5e638b8439e638c47/nodus/src/witness/nodus_witness.c)
- [Validator identity/role mapping (pinned source)](https://github.com/nocdem/dna/blob/f11561f7debe77d7c5e69bd5e638b8439e638c47/nodus/src/witness/nodus_witness_validator.h)
- [Storage registry and frozen-set schema](https://github.com/nocdem/dna/blob/main/nodus/src/witness/nodus_witness.h)

Upstream software and deployed endpoints may differ. The tests use synthetic
fixtures; successful tests do not assert that every public node or Scan endpoint
is currently reachable.

Reports reuse bucket totals; distinct wallets remain range-wide, and the rolling-day KPI reads block counts only.
