<div align="center">

# LINE OA MCP Ultimate

**The most complete Model Context Protocol server for LINE Official Accounts.**
Operate broadcasts, audiences, rich menus, Flex messages, coupons, and insights from any AI agent — without writing code.

[![npm version](https://img.shields.io/npm/v/line-oa-mcp-ultimate.svg)](https://www.npmjs.com/package/line-oa-mcp-ultimate)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](#requirements)
[![MCP](https://img.shields.io/badge/MCP-1.x-purple.svg)](https://modelcontextprotocol.io)

[Quick Start](#quick-start) · [Features](#features) · [Configuration](#configuration) · [Documentation](#documentation) · [Comparison](#comparison-vs-official-line-mcp)

</div>

---

## What is this?

`line-oa-mcp-ultimate` is an [MCP](https://modelcontextprotocol.io) server that exposes **27 tools, 4 resources, and 7 guided prompts** for LINE Official Accounts. Any MCP-compatible host — **Claude Cowork, Claude Code, Cursor, Codex, ChatGPT desktop**, or others — can drive your LINE OA through natural conversation.

Built with Thai SMBs, marketing agencies, course creators, and developers in mind. **Free-tier ready** — no Premium upgrade required for the core feature set.

> **Disclaimer:** This is an independent open-source project. It is **not affiliated with or endorsed by LY Corporation / LINE Corp**. "LINE" is a registered trademark of LY Corporation, used here in a descriptive sense.

---

## Why?

LINE's official MCP server ships ~12 tools — about 10% of the Messaging API surface. That leaves out almost everything marketers and SMBs actually need every day: narrowcast targeting, audience management, insight reports, Flex Message design, coupon analytics, multi-OA orchestration, and the killer pattern of handing off scheduled broadcasts to LINE OA Manager's native UI.

This project covers **all of that**, in a tight install with zero infrastructure.

---

## Features

### 📨 Messaging (3 tools)
Universal `send_message` covers 5 LINE transports (reply / push / multicast / narrowcast / broadcast) with 3 modes (`send_now`, `draft`, `dry_run`). Pre-flight validation, Quota Guardian, and quiet-hours guard built in.

### 🎨 Rich Menu (4 tools)
Build a rich menu in one call (create + upload image + set default). List, delete, and diagnose per-user menu visibility.

### 💎 Flex Message (1 tool)
Design Flex Messages from 8 Thai-localized templates (`receipt`, `voucher`, `shipping_update`, `promo_simple`, `thank_you`, ...) or raw JSON. Returns ready-to-send Flex JSON + LINE Flex Simulator preview URL.

### 🎯 Audience Management (4 tools)
Build retargeting audiences from CSV or from prior broadcast engagement. The zero-CRM retargeting feature most SMBs never knew they had.

### 📊 Insights & Reports (4 tools)
Quick OA status snapshot, weekly markdown reports, per-broadcast engagement stats, and pre-flight cost estimation.

### 🎟 Coupons (2 tools)
Coupon CRUD + redemption analytics combining LINE coupon details and click-audience tracking.

### 🔌 Webhook (1 tool)
Test the OA's webhook URL and report LINE's signature verification result.

### 👤 Operations & Multi-OA (5 tools)
Profile lookup, follower listing (Premium-gated), multi-OA orchestration with `run_on_many_oas` — operate dozens of client OAs from one MCP instance.

### 💻 Developer Pack (3 tools)
LIFF app lifecycle management plus code generators for LIFF SDK init (5 frameworks) and full LINE Login OAuth scaffold.

**Resources:** auto-refreshing OA snapshot, Flex template catalog, mood-indexed sticker catalog, Thai festival calendar with marketing promo patterns.

**Prompts:** `daily-oa-report`, `build-campaign`, `schedule-broadcast-howto`, `diagnose-rich-menu`, `coupon-campaign`, `migrate-from-line-notify`, `webhook-setup-guide`.

---

## Quick Start

### Requirements

- **Node.js 20 or later**
- A LINE Official Account with Messaging API enabled
- A Channel Access Token

**No** database, Playwright, CDN, public URL, or scheduler infrastructure required.

### Step 1 — Get your Channel Access Token

1. Open the [LINE Developers Console](https://developers.line.biz/console/).
2. Pick your provider → open (or create) a **Messaging API channel**.
3. Open the **Messaging API** tab → scroll to **Channel access token** → click **Issue**.
4. Copy the long-lived token. Treat it like a password.

For a walkthrough, see [LINE's official getting started guide](https://developers.line.biz/en/docs/messaging-api/getting-started/).

### Step 2 — Add the MCP server to your AI host

Add the following block to your host's MCP config file:

```json
{
  "mcpServers": {
    "line": {
      "command": "npx",
      "args": ["-y", "line-oa-mcp-ultimate"],
      "env": {
        "LINE_CHANNEL_ACCESS_TOKEN": "YOUR_TOKEN_HERE"
      }
    }
  }
}
```

**Config file location by host:**

| Host | Where to add it |
|---|---|
| **Claude Cowork** | Settings → **Developer** → Local MCP servers → **Edit Config** |
| **Claude Desktop** (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| **Claude Desktop** (Windows) | `%APPDATA%\Claude\claude_desktop_config.json` |
| **Claude Code** | Run `claude mcp add line` or edit `~/.config/claude/mcp.json` |
| **Cursor / Codex / ChatGPT desktop** | See your host's MCP setup docs — same JSON shape |

> ⚠️ **Don't overwrite existing MCP servers** — add the `"line"` entry alongside any existing entries inside `mcpServers`.

### Step 3 — Restart your AI host

Quit completely (Cmd+Q on macOS) and reopen. The host runs `npx -y line-oa-mcp-ultimate` on first start, downloads the package from npm, caches it, and is ready to use.

### Step 4 — Verify

In a new chat, try:

```
Show my LINE OA status
```

or in Thai:

```
ดูสถานะ OA หน่อย
```

You should see a health card with friend count, monthly quota, webhook status, and the default rich menu. That's it — you're now operating LINE OA from your AI agent.

---

## Configuration

### Single-OA mode (default)

Use a single environment variable in your MCP config — that's the **Step 2** snippet above. Suitable for individual creators or single-business owners.

### Multi-OA mode (for agencies)

Create `~/.line-mcp/config.json`:

```json
{
  "default_oa": "main",
  "oas": {
    "main": {
      "channel_access_token": "TOKEN_1",
      "display_name": "Main OA",
      "region": "TH"
    },
    "client_a": {
      "channel_access_token": "TOKEN_2",
      "display_name": "Client A — Bangkok Cafe"
    }
  }
}
```

Then drop `LINE_CHANNEL_ACCESS_TOKEN` from your MCP config — the server discovers `~/.line-mcp/config.json` automatically.

A copy-ready template lives in [`config.example.json`](config.example.json). The multi-OA loader resolution order:

1. `LINE_MCP_CONFIG` env var (custom path)
2. `~/.line-mcp/config.json`
3. `LINE_CHANNEL_ACCESS_TOKEN` env var (single-OA fallback)
4. Error

### Switching active OA at runtime

Use the `line_use_oa` tool in your AI host:

```
"Switch to client_a"
→ line_use_oa({ oa_id: "client_a" })
```

Or override per-call with the `oa` parameter on any tool.

### Advanced — HTTP transport (self-hosted)

For agencies running a shared remote instance, the server also supports Streamable HTTP. See [docs/http-transport.md](docs/http-transport.md).

---

## Documentation

| Doc | What's in it |
|---|---|
| [docs/quickstart-th.md](docs/quickstart-th.md) | Thai-language quick start (5-minute walkthrough) |
| [docs/multi-oa-setup-th.md](docs/multi-oa-setup-th.md) | Multi-OA configuration guide (Thai) |
| [docs/http-transport.md](docs/http-transport.md) | Streamable HTTP transport for self-hosted / remote use |
| [examples/](examples/) | Runnable examples — Cloudflare Worker webhook router for fan-out to multiple downstream services |

---

## Comparison vs Official LINE MCP

| Feature | Official `@line/line-bot-mcp-server` | `line-oa-mcp-ultimate` |
|---|:---:|:---:|
| Tool count | ~12 | **27** |
| Send unified (reply / push / multicast / narrowcast / broadcast) | Split into separate tools | ✅ One `send_message` tool |
| Rich Menu — create + upload + default in one call | 4 atomic tools | ✅ One composite tool |
| Flex Designer with Thai templates | ❌ | ✅ 8 templates + raw JSON |
| Audience management (CSV / engagement / list / delete) | ❌ | ✅ 4 tools |
| Narrowcast targeting (filter / audience) | ❌ | ✅ |
| Insights / weekly reports (markdown) | Quota only | ✅ 4 tools |
| Coupon CRUD + redemption analytics | ❌ | ✅ 2 tools |
| Multi-OA orchestration | ❌ | ✅ 3 tools |
| LIFF lifecycle + code emitters | ❌ | ✅ 3 tools |
| Quota Guardian (pre-flight check) | ❌ | ✅ Built into `send_message` |
| Quiet-hours guard (22:00–08:00 BKK) | ❌ | ✅ |
| Reply-token auto-fallback to push | ❌ | ✅ |
| LINE Messaging API coverage | ~10% | **~45%** |
| Free-tier ready (no Premium required) | Partial | ✅ |

---

## Versioning

This project follows [Semantic Versioning](https://semver.org/). Current release: **v1.0.0**.

---

## Roadmap

- **v1.x** — Outbound operations (current).
- **v2.x** — Companion `line-oa-mcp-inbound` package: webhook ingestion via built-in tunnel, chat 1:1 reply, auto-reply rules, greeting messages, chat tags.
- **v3.x** — Hosted SaaS for agency multi-tenant use.

---

## Contributing

PRs are welcome. Please open an issue first to discuss substantial changes.

When contributing:

- Tool names: `line_{action}_{resource}` (snake_case, prefix `line_`).
- Tool descriptions: English (for LLMs) — Thai examples encouraged.
- User-facing strings: Thai-friendly (centralized in `src/i18n/th.ts`).
- Pre-flight validation on every send tool.
- Quota Guardian + Quiet Hours on every consumption tool.

---

## Author

**Dr. Wasin Treesinthuros** (พี่โต / Dr. Wasin / #จารโต)

- CEO at [Innovation Vantage](https://innovation-vantage.com)
- Founder at [ForgeAI — AI Transformation Studio](https://forgeai.co)
- LINE Certified Coach 2026
- AI Transformation educator, SaaS builder, university lecturer

This project is part of a broader mission to bring production-grade AI automation to every Thai practitioner — regardless of technical background.

GitHub: [@wasintoh](https://github.com/wasintoh)

---

## License

[MIT](LICENSE) © Dr. Wasin Treesinthuros — Innovation Vantage / ForgeAI
