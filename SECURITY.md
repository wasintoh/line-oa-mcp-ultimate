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
  See [Known limitations](#known-limitations) for the one gap that remains.
- **Config-file permission check** — a group/other-readable
  `~/.line-mcp/config.json` triggers a `chmod 600` warning at startup.
- **Blast-radius limiters** — Quota Guardian (blocks sends projected over 95%
  of remaining quota without `confirm: true`), quiet-hours warning
  (22:00–08:00 Asia/Bangkok), and explicit `confirm` for broadcast-to-everyone.

## Known limitations

We would rather publish the gaps we know about than let you find them. None of
these are exploitable in the default stdio setup with a trusted operator, but
they are real and you should be able to weigh them yourself.

### 1. DNS-rebinding window in the SSRF guard (TOCTOU)

`fetchPublicImage()` in [`src/line/ssrf-guard.ts`](src/line/ssrf-guard.ts)
resolves the hostname with `dns.lookup()` and rejects private, link-local,
loopback, metadata, and multicast addresses before fetching. The subsequent
`fetch()` then resolves that name **a second time, independently**. A hostname
served with a very short TTL that answers with a public IP during validation
and a private one microseconds later at connect time can slip through the gap
between those two resolutions.

- **Reach:** only the two tools that download a user-supplied URL —
  `line_upload_rich_menu_image` and `line_build_rich_menu`. Every redirect hop
  is separately re-validated, so this is not a redirect bypass.
- **Requires:** an attacker who can both choose the image URL your agent
  fetches *and* control authoritative DNS for that hostname.
- **Mitigation today:** treat image URLs arriving from untrusted chat input as
  untrusted, and don't run the server on a host whose loopback/private range
  exposes anything sensitive.
- **Real fix:** a custom `undici` dispatcher that pins the validated IP for the
  life of the connection. Deferred deliberately — it rewrites the fetch path
  used by every tool, so it belongs in a minor release with its own tests, not
  a patch.

### 2. Unknown top-level tool parameters are stripped, not rejected

Every tool's input schema is declared `.strict()`, but `registerTool()` receives
`InputSchema.shape` and the MCP SDK re-wraps it in a non-strict `z.object()`.
The consequence: an unrecognised key at the **top level** of a tool call is
silently dropped instead of raising `InvalidParams`. Nested schemas keep their
strictness, so message bodies, send targets, and rich-menu tap areas still
reject typos loudly.

- **Impact:** a misspelled top-level parameter (`dry_run` typed as `dryrun`) is
  ignored rather than reported, so the call proceeds with the default — which
  for that particular example means a real send instead of a rehearsal. It
  cannot inject behaviour: stripped keys never reach a handler.
- **Status:** pinned by an assertion in
  [`tests/send-message.e2e.test.ts`](tests/send-message.e2e.test.ts) so that any
  future SDK change which fixes this forces a conscious update to the test
  rather than passing unnoticed.

### 3. Quota Guardian asks for confirmation at zero remaining quota

When the monthly quota reports 0 remaining, the projected-share calculation
falls back to 1 (100%), so even a send projected at **zero** messages returns
`needs_confirmation` instead of passing through. Anything above zero is already
hard-blocked as over-quota. This is a deliberate fail-safe — at zero remaining
we would rather ask than assume — and is documented here so it is not filed as
a bug.

## Operational recommendations

- Prefer **stdio** transport (no open port). If you need HTTP, keep the bind
  on `127.0.0.1` and set `MCP_HTTP_TOKEN`; put TLS termination in front for
  anything remote. See [`docs/http-transport.md`](docs/http-transport.md).
- `chmod 600 ~/.line-mcp/config.json`.
- Issue **one token per OA** and rotate tokens in the LINE Developers Console
  if you suspect exposure; use `line_check_token` to verify validity/lifetime.
