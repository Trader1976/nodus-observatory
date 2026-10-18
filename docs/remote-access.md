# Optional remote access from phones and other devices

[English](remote-access.md) | [Suomi](remote-access_fin.md)

The default installation listens at `http://127.0.0.1:8890`. The monitor starts
with systemd and collects measurements independently. Cloudflare and a domain
name are optional. If your browser runs on a different computer from the node,
use an SSH tunnel for local access:

```bash
ssh -N -L 8890:127.0.0.1:8890 USER@NODE_SERVER
```

Replace `USER` and `NODE_SERVER` with your SSH username and node server address.
Open `http://127.0.0.1:8890/#overview` in your browser. If port 8890 is already
in use on your desktop, use `-L 8891:127.0.0.1:8890` and browse to port 8891.

## Cloudflare Tunnel + Access

An administrator can expose the same local application at their own protected
HTTPS address, such as `https://node.example.com`, for access from a phone.
This example address is not a service provided by the project. Each operator
provides their own domain, tunnel and access policy.

You need a domain managed in Cloudflare, Cloudflare Access, and `cloudflared`
running as a service on the node server. Use a dedicated subdomain. A tunnel
can serve multiple applications on different subdomains.

1. **First**, create an Access *Self-hosted application* for the entire hostname
   (`node.example.com`, with no path restriction). Set an Allow policy for only
   the intended email addresses, such as `user@example.com`, and configure a
   login method. Do not use Everyone, Bypass, or a policy allowing the internet.
2. Add a *Published application route* to the tunnel. Preserve existing routes
   for any other applications.
3. Set the origin service to **HTTP** at **127.0.0.1:8890**. If the dashboard has
   a single Service URL field, enter **http://127.0.0.1:8890**. `cloudflared`
   must reach this address on the node server; localhost inside a separate
   container refers to that container instead.
4. Under *Additional application settings → HTTP settings → HTTP Host Header*,
   enter **localhost** (`httpHostHeader: localhost`). The monitor checks the
   Host header, so this preserves its localhost restriction. Adding a public
   hostname to `allowed_hosts` does not provide authentication.
5. Enable **Protect with Access** on the tunnel route. Use your actual Access
   team name in place of `<your-team-name>` and this application's Audience
   (AUD) tag in place of `<your-application-aud>`. This makes `cloudflared`
   validate the application's Access token before forwarding to the origin.
   The application AUD is not a policy ID or tunnel ID. Configure both the
   Access policy and token validation before enabling the route.
6. Bypass Cloudflare caching for this entire hostname. The API already sends
   `Cache-Control: no-store`; reward CSV exports must also be covered by Access
   and the cache bypass.
7. Ensure that the `cloudflared` service starts automatically. The monitor
   stays on `127.0.0.1:8890`. No router port forwarding is needed for this page.

## Verify the setup

- Open the address in a private browser window on your phone using mobile data.
  Before login, Access must show a login page or denial, not the dashboard.
- Test `/api/dashboard` and `/api/rewards/export.csv?year=2026` in the same
  unauthenticated session. Neither measurements nor a CSV file may be exposed.
- An allowed user can view the dashboard and API and download the CSV. Check
  the measurement timestamp and wait for a new collection to confirm live data.
- Other users without access must remain blocked. The same Access application
  must cover the entire hostname, including all `/api/` paths.
- Close the desktop SSH tunnel during the test. The public HTTPS address must
  work independently. After a server reboot, the monitor and `cloudflared`
  should start as services.

In this setup, the application relies on Cloudflare Access and `cloudflared`
token validation for authentication. It has no user database of its own.
Reward records and server measurements are for authorized users only. The
public GitHub repository contains source code, not your monitoring data.

## Maintenance

Remote access does not require changing the loopback default or application
code. Keep tunnel credentials, keys, Access settings and actual email addresses
in your server or Cloudflare configuration, outside the repository. To remove
remote access, remove this hostname's route, DNS record and Access application
in a controlled order. Preserve other applications using the same tunnel.

See the official Cloudflare documentation for current dashboard terminology
and configuration details:

- [Tunnel routing](https://developers.cloudflare.com/tunnel/concepts/routing/)
- [Self-hosted public applications](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)
- [Origin parameters](https://developers.cloudflare.com/tunnel/reference/origin-parameters/)
