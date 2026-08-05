# HTTP transport (advanced / self-hosted)

The standard install for `line-oa-mcp-ultimate` is **stdio** — every MCP host (Cowork, Claude Desktop, Claude Code, Cursor, etc.) supports it natively via JSON config. **Most users should use stdio.**

This document is for the niche cases where you actually need HTTP:

- An agency running MCP instances on a shared server — **one instance per agent/teammate**, because the active OA switched by `line_use_oa` is shared per instance (see [Production deployment](#production-deployment)).
- A hosted SaaS deployment behind a tunnel or load balancer.
- Cowork's "Add custom connector" UI when you specifically want a URL-based connector instead of a managed local subprocess.

---

## Run in HTTP mode

Install via `npx` (no repo clone needed) — just set `MCP_TRANSPORT=http`:

```bash
LINE_CHANNEL_ACCESS_TOKEN="YOUR_TOKEN" MCP_TRANSPORT=http npx -y line-oa-mcp-ultimate
```

Or, if you cloned the repo and built it yourself, use the bundled script:

```bash
LINE_CHANNEL_ACCESS_TOKEN="YOUR_TOKEN" npm run start:http
```

You should see:

```
[line-oa-mcp-ultimate vX.Y.Z] Loaded 1 OA(s). Default: "default".
[line-oa-mcp-ultimate] Ready (http) — http://127.0.0.1:3000/mcp
  Health: http://127.0.0.1:3000/health
```

Verify the server is healthy:

```bash
curl http://127.0.0.1:3000/health
# → {"ok":true,"name":"line-oa-mcp-ultimate","version":"X.Y.Z"}
```

## Configuration

All settings are environment variables — no config file needed.

| Variable | Default | Description |
|---|---|---|
| `MCP_TRANSPORT` | `stdio` | Set to `http` to enable HTTP mode |
| `MCP_HTTP_HOST` | `127.0.0.1` | Bind address (use `0.0.0.0` only behind a tunnel/proxy — **requires `MCP_HTTP_TOKEN`**) |
| `MCP_HTTP_PORT` | `3000` | Listen port |
| `MCP_HTTP_PATH` | `/mcp` | URL path that serves the MCP endpoint |
| `MCP_HTTP_TOKEN` | *(unset)* | Bearer token required on the MCP path (v2.1). When set, every request must carry `Authorization: Bearer <token>` |

CLI flags also work: `node dist/index.js --http` or `--stdio`.

## Authentication (v2.1 — `MCP_HTTP_TOKEN`)

The MCP endpoint can send messages **as the shop**, so the HTTP transport now
supports (and, off loopback, requires) bearer-token auth:

```bash
# Generate a strong random token once:
export MCP_HTTP_TOKEN="$(openssl rand -hex 32)"

LINE_CHANNEL_ACCESS_TOKEN="YOUR_TOKEN" MCP_TRANSPORT=http npx -y line-oa-mcp-ultimate
```

Behavior:

- **Every request to the MCP path** (`/mcp` by default) must carry
  `Authorization: Bearer <MCP_HTTP_TOKEN>`. Missing or wrong token → `401`
  JSON error **before any MCP processing happens**. The comparison is
  timing-safe (`crypto.timingSafeEqual` over sha256 hashes).
- **`/health` stays open** in all modes and never returns secrets — keep using
  it for liveness probes without credentials.
- **Non-loopback binds are refused without a token.** Setting
  `MCP_HTTP_HOST=0.0.0.0` (or any non-`127.0.0.1`/`::1`/`localhost` host)
  without `MCP_HTTP_TOKEN` aborts startup with an explanation — an open,
  unauthenticated MCP port would let anyone on the network broadcast as the
  shop.

Quick check:

```bash
curl -s -X POST "http://127.0.0.1:3000/mcp" \
  -H "Authorization: Bearer $MCP_HTTP_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
# → {"result":{"serverInfo":{"name":"line-oa-mcp-ultimate", ...
# Without the header → HTTP 401
```

## Wire it into Cowork

1. Start the server with `MCP_HTTP_TOKEN` set (see above).
2. Cowork → Settings → **Connectors** → **+ (Add custom connector)**
3. Name: `LINE OA`
4. Remote MCP server URL: `http://127.0.0.1:3000/mcp`
5. In the connector's **Authentication / Headers** section, add the bearer
   token: header `Authorization`, value `Bearer <your MCP_HTTP_TOKEN>`.
   (If your Cowork build only offers a "Token" field, paste the raw token —
   it is sent as a bearer header.)
6. Add

If the client UI has no way to send an `Authorization` header, either keep the
server on loopback without a token (localhost-only, previous behavior), or put
a reverse proxy in front that injects the header.

## Wire it into another HTTP-capable client

The endpoint speaks **Streamable HTTP** (the modern MCP transport — not deprecated SSE). Any compliant client works.

## Production deployment

When running for an agency or hosted service:

- **Never bind to `0.0.0.0` directly.** Put the server behind a reverse proxy (Caddy, Nginx, Cloudflare Tunnel) that handles TLS. (Since v2.1 the server refuses a non-loopback bind unless `MCP_HTTP_TOKEN` is set.)
- **Always set `MCP_HTTP_TOKEN`.** The built-in bearer check protects the MCP path itself; the proxy adds TLS so the token never travels in cleartext.
- **One instance = one agent.** The active OA switched by `line_use_oa` is
  process-wide state: every client of the same instance shares it, so agent
  A's switch silently retargets agent B's next unqualified send — and a
  broadcast cannot be unsent. Run one instance per agent/teammate (separate
  ports behind the same proxy), or make every call pass the explicit `oa`
  parameter, which always beats the shared switch. Since v2.2.1 the server
  logs a loud warning when a second distinct client initializes while a
  switch is active. (Full write-up: SECURITY.md → Known limitations #4.)
- **One process per OA, or use multi-OA config.** Multiple tenants in the same process share env vars — use the JSON multi-OA config and per-call `oa` parameter.
- **Health check** at `/health` returns `{"ok": true, ...}` — use it for liveness probes.
- **Graceful shutdown** on `SIGINT` / `SIGTERM` (5s force-kill grace).

## DNS-rebinding protection

The HTTP server checks the `Origin` header on incoming requests. Only `127.0.0.1`, `localhost`, and the configured `MCP_HTTP_HOST` are allowed. Requests from other origins return `403 Forbidden`.

If you need additional allowed origins (e.g. a specific Cowork domain), set `MCP_HTTP_HOST` accordingly or add a proxy that rewrites the `Origin` header.

## Why stdio is still the default

- **No always-on process.** Cowork spawns the server when needed and tears it down when done.
- **One process per host, automatically.** Each MCP host gets its own private server, so the shared-active-OA concern above simply cannot occur.
- **No port to manage.** No localhost firewall, no tunnel, no DNS, no TLS.
- **No infrastructure drift.** What works on one machine works on another with no setup.

If you don't have an explicit need for HTTP, **use stdio.**
