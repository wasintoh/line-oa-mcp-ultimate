# HTTP transport (advanced / self-hosted)

The standard install for `line-oa-mcp-ultimate` is **stdio** — every MCP host (Cowork, Claude Desktop, Claude Code, Cursor, etc.) supports it natively via JSON config. **Most users should use stdio.**

This document is for the niche cases where you actually need HTTP:

- An agency running one MCP instance shared by many teammates.
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
[line-oa-mcp-ultimate v1.0.4] Loaded 1 OA(s). Default: "default".
[line-oa-mcp-ultimate] Ready (http) — http://127.0.0.1:3000/mcp
  Health: http://127.0.0.1:3000/health
```

Verify the server is healthy:

```bash
curl http://127.0.0.1:3000/health
# → {"ok":true,"name":"line-oa-mcp-ultimate","version":"1.0.4"}
```

## Configuration

All settings are environment variables — no config file needed.

| Variable | Default | Description |
|---|---|---|
| `MCP_TRANSPORT` | `stdio` | Set to `http` to enable HTTP mode |
| `MCP_HTTP_HOST` | `127.0.0.1` | Bind address (use `0.0.0.0` only behind a tunnel/proxy) |
| `MCP_HTTP_PORT` | `3000` | Listen port |
| `MCP_HTTP_PATH` | `/mcp` | URL path that serves the MCP endpoint |

CLI flags also work: `node dist/index.js --http` or `--stdio`.

## Wire it into Cowork

1. Cowork → Settings → **Connectors** → **+ (Add custom connector)**
2. Name: `LINE OA`
3. Remote MCP server URL: `http://127.0.0.1:3000/mcp`
4. Add

## Wire it into another HTTP-capable client

The endpoint speaks **Streamable HTTP** (the modern MCP transport — not deprecated SSE). Any compliant client works.

## Production deployment

When running for an agency or hosted service:

- **Never bind to `0.0.0.0` directly.** Put the server behind a reverse proxy (Caddy, Nginx, Cloudflare Tunnel) that handles TLS.
- **Add auth in front of the MCP path.** The server validates LINE tokens but has no per-user auth of its own. A simple bearer header check at the proxy level is enough for V1.
- **One process per OA, or use multi-OA config.** Multiple tenants in the same process share env vars — use the JSON multi-OA config and per-call `oa` parameter.
- **Health check** at `/health` returns `{"ok": true, ...}` — use it for liveness probes.
- **Graceful shutdown** on `SIGINT` / `SIGTERM` (5s force-kill grace).

## DNS-rebinding protection

The HTTP server checks the `Origin` header on incoming requests. Only `127.0.0.1`, `localhost`, and the configured `MCP_HTTP_HOST` are allowed. Requests from other origins return `403 Forbidden`.

If you need additional allowed origins (e.g. a specific Cowork domain), set `MCP_HTTP_HOST` accordingly or add a proxy that rewrites the `Origin` header.

## Why stdio is still the default

- **No always-on process.** Cowork spawns the server when needed and tears it down when done.
- **No port to manage.** No localhost firewall, no tunnel, no DNS, no TLS.
- **No infrastructure drift.** What works on one machine works on another with no setup.

If you don't have an explicit need for HTTP, **use stdio.**
