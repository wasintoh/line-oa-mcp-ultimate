# Security Policy

`line-oa-mcp-ultimate` handles **live LINE channel access tokens**. A leaked
token lets an attacker message every customer the shop has, read follower
profiles, rewrite rich menus, and — when a MyShop key is configured — manage
products and orders. We treat every report accordingly.

A Thai-language threat-model guide for shop owners is at
[`docs/security-th.md`](docs/security-th.md).

## Supported versions

| Version | Supported |
|---|---|
| 2.1.x | ✅ Full support — security fixes land here first |
| 2.0.x | ⚠️ Critical fixes only |
| < 2.0 | ❌ Not supported — please upgrade |

## Reporting a vulnerability

**Please do NOT open a public GitHub issue for security problems.**

Report privately via **GitHub Security Advisories**:
[github.com/wasintoh/line-oa-mcp-ultimate/security/advisories/new](https://github.com/wasintoh/line-oa-mcp-ultimate/security/advisories/new)

Include what you can: affected version, reproduction steps, impact, and any
suggested fix. Reports in Thai or English are both welcome.

### What to expect

- **Acknowledgement within 72 hours.**
- **Initial assessment within 7 days** — severity, affected versions, remediation plan.
- **Fix target:** critical issues (token leakage, auth bypass, message-sending
  by unauthorized parties) within 14 days; lower-severity issues in the next
  scheduled release.
- Credit in the release notes if you want it (or anonymity if you prefer).

## Scope — what a channel token can do

This MCP server is exactly as dangerous as the credentials you give it. With a
channel access token an agent (or an attacker who obtains the token) can:

- **Send messages** to any follower, any audience, or *everyone* (broadcast).
- Read follower IDs and profiles; build/export audiences.
- Create, replace, and delete rich menus (the OA's main UI).
- Manage coupons and LIFF apps; change the webhook endpoint.
- With a MyShop API key: read/modify products, prices, inventory, and orders,
  and view settlement data.

In-scope vulnerability classes (non-exhaustive): token/secret leakage in tool
output or logs, HTTP transport auth bypass, SSRF via user-supplied URLs,
config-file exposure, dependency vulnerabilities that affect the production
tree.

Out of scope: issues requiring an already-compromised host, LINE platform
bugs (report to LINE), and social engineering.

## Built-in hardening (v2.1)

- **HTTP transport auth** — `MCP_HTTP_TOKEN` enforces `Authorization: Bearer`
  on the MCP path (timing-safe comparison); binding a non-loopback host
  without a token is refused at startup. `/health` returns no secrets.
- **Secret redaction** — every configured token/secret/API key is registered
  at config load and replaced with `***REDACTED***` in error messages and logs,
  even when an upstream API echoes the `Authorization` header back.
- **SSRF guard** — server-side fetches of user-supplied URLs are https-only,
  blocked for private/link-local/metadata/multicast targets (literal IPs, DNS
  results, IPv6-mapped forms), size-capped, and re-validated on every redirect hop.
- **Config-file permission check** — a group/other-readable
  `~/.line-mcp/config.json` triggers a `chmod 600` warning at startup.
- **Blast-radius limiters** — Quota Guardian (blocks sends projected over 95%
  of remaining quota without `confirm: true`), quiet-hours warning
  (22:00–08:00 Asia/Bangkok), and explicit `confirm` for broadcast-to-everyone.

## Operational recommendations

- Prefer **stdio** transport (no open port). If you need HTTP, keep the bind
  on `127.0.0.1` and set `MCP_HTTP_TOKEN`; put TLS termination in front for
  anything remote. See [`docs/http-transport.md`](docs/http-transport.md).
- `chmod 600 ~/.line-mcp/config.json`.
- Issue **one token per OA** and rotate tokens in the LINE Developers Console
  if you suspect exposure; use `line_check_token` to verify validity/lifetime.
