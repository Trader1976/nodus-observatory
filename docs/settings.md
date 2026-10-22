# Node roles and Observatory settings

**English** · [Suomi](settings_fin.md)

The header separates **Observatory**, **Contract Studio** and **Settings**.
Observatory monitors a storage node, a witness node or both. Contract Studio
keeps its existing editors and document tools as a separate experimental area;
this change adds no chain deployment action.

## Choose roles and views

In **Settings**, enable the roles that this installation should monitor. At least
one of **Storage** and **Witness** must be selected. These choices describe the
existing Nodus installation. They do not register a node role, start or stop a
Nodus service, change `/etc/nodus.conf` or release a bond.

The view selector inside Observatory changes only what you see:

| View | Contents |
| --- | --- |
| Overview | Shared chain, network and host observations, plus the selected roles |
| Storage | Storage role status, segments and storage observations |
| Witness | Witness service status and observations from the local committee query |

Storage and Witness views appear only for monitored roles. A saved link to a
disabled role falls back to Overview. Network, Rewards and Events remain shared
monitoring pages. Switching a view does not change collection, selected roles
or alerts. A witness-only node still has filesystem and host resource monitoring;
its unused storage role is not a fault.

An enabled role stays enabled when its service fails. The failure is shown
instead of silently removing the role from monitoring. A missing observation is
unknown, not a successful check or a zero measurement. Committee membership
reflects an observed committee; it does not prove future participation or a
particular reward.

A fresh installation uses local service evidence when discovering roles. Review
the result in Settings. For an existing base configuration without a `roles`
key, both roles remain enabled to preserve earlier monitoring. Automatic
discovery does not continuously remove services that stop responding.

## Edit settings

| Setting | Behaviour |
| --- | --- |
| Node display name | Optional label, up to 80 characters; blank uses the observed hostname |
| Monitored roles | Storage, Witness or both |
| Default view | Overview, Storage or Witness; a disabled role falls back to Overview |
| Measurement history | 1–366 days; separate reward records are retained independently |
| Network interface | Interface identifier; blank follows automatic discovery |
| Disk device | Device identifier, such as `sda`; blank disables device-specific I/O and SMART probes |
| External network queries | Controls external network queries, including Scan reward imports |
| Reward collection | Controls local and Scan reward collection |
| Scan reward imports | Controls the Scan source; local collection can continue independently |

**Check settings** validates the proposed settings, checks whether the
configured CLI is executable and reports the latest service observations. The
web service does not inspect Nodus data paths through its sandbox; filesystem
checks remain the collector's responsibility and are reported as unknown here.
This button runs no Nodus commands and saves nothing.

**Save settings** validates and atomically saves the monitor preferences. Display
labels and navigation update immediately; collection uses the saved values at
the next scheduled sample, normally within about a minute. No Nodus or monitor
service restart is needed. A reduced history retention period takes effect in
normal collection cleanup, so choose it before saving with care.

An unsaved draft survives navigation and language changes within the current
page session. Reloading or closing the page can discard that draft. The FIN/ENG
language preference is kept separately in that browser's storage. Saved monitor
settings apply to all users of this installation, not just the current browser.
The static demo cannot save live settings.

If another browser saved settings after you loaded them, saving reports a
conflict rather than replacing the newer settings. Reload the settings, review
the current values and apply your changes again.

## Administrator configuration and storage

| File | Purpose |
| --- | --- |
| `/etc/nodus-monitor/config.json` | Administrator-owned base configuration |
| `/var/lib/nodus-monitor/settings/settings.json` | Allowlisted preferences saved by the Settings page |
| `/var/lib/nodus-monitor` | Measurements, events and separate reward ledger |

Saved preferences override matching keys in the base configuration. To change a
value already saved through the UI, change it through Settings. Editing only the
base value does not override the saved preference. Installation updates preserve
both configuration files and collected history.

The Advanced settings display the CLI, Nodus data, mount and reward source
database paths as read-only. An administrator changes these paths explicitly in
`/etc/nodus-monitor/config.json`. Keep them under system directories accessible
to the installed services; `ProtectHome=yes` excludes home directories. The web
page cannot choose a new executable for the privileged collector. Listener,
frontend and state-directory settings also remain administrator-owned. After
changing data or mount paths, rerun the normal installer to validate them and
update the collector's systemd mount dependency; it restarts only monitor units.

The HTTP process can write only its dedicated Settings subdirectory; monitoring
history and reward databases remain read-only to it. A malformed preferences
file is a configuration error and is not silently ignored. Keep configuration
and accounting backups outside the source checkout. Back up the Settings file
along with the base configuration and monitor state.

## Access and rewards

The application has no separate viewer and administrator login roles. Anyone
allowed to open this installation can change its editable Settings. Use an SSH
tunnel or an authenticated HTTPS proxy. Protect the whole hostname, including
all Settings API routes; CSRF protection is not user authentication.

If a proxy rewrites the HTTP Host header, add the exact public HTTPS origin to
`settings_allowed_origins` in the administrator-owned base configuration. The
default is an empty list; normal direct access needs no addition. For example,
add `"settings_allowed_origins": ["https://node.example.com"]` as a field in the
existing JSON object, preserving its other settings. Use your actual origin,
with no path or trailing slash, then restart only the HTTP monitor service:

```bash
sudo systemctl restart nodus-monitor.service
```

This allows same-origin Settings requests through that proxy; it does not
authenticate users or expose the listener. Forwarded host headers are not
trusted automatically. See the [remote access guide](remote-access.md).

Rewards remain evidence of payments to the **owner wallet**. Changing the
monitored roles or selected view does not split mixed wallet payouts into
storage and witness income. Disabling a source does not erase its previously
recorded rewards. See [reward evidence and bookkeeping](../rewards/README.md).
