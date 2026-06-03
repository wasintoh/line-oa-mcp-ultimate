<div align="center">

# LINE OA MCP Ultimate

**Operate your LINE Official Account from any AI agent — through natural language.**

[![npm version](https://img.shields.io/npm/v/line-oa-mcp-ultimate.svg)](https://www.npmjs.com/package/line-oa-mcp-ultimate)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](#requirements)
[![MCP](https://img.shields.io/badge/MCP-1.x-purple.svg)](https://modelcontextprotocol.io)

[Quick Start](#quick-start) · [What you can do](#what-you-can-do) · [Configuration](#configuration) · [Documentation](#documentation)

</div>

---

## What is this?

`line-oa-mcp-ultimate` is a [Model Context Protocol](https://modelcontextprotocol.io) server that lets AI agents drive your LINE Official Account through natural conversation — no code, no API knowledge required.

Manage **one OA or many** — a single account needs just one env var, while agencies can register every client OA in one config file and switch between them with a single command (see [Configuration](#configuration)).

It works with **Claude Cowork, Claude Code, Cursor, Codex, ChatGPT desktop, OpenClaw, Hermes**, or any MCP-compatible host.

> **Disclaimer:** This is an independent open-source project. It is **not affiliated with or endorsed by LY Corporation / LINE Corp**. "LINE" is a registered trademark of LY Corporation, used here in a descriptive sense.

---

## Why use it?

LINE OA Manager works well — but it's a web UI you have to log into, click through, and operate manually. With this MCP server, the same operations become natural-language requests in your AI host of choice:

| Instead of clicking through LINE OA Manager... | Just say... |
|---|---|
| Open broadcast composer → pick audience → write text → preview → schedule | "Send a Mother's Day promo to my Bangkok-based 25-44 female audience" |
| Navigate Insight → Delivery → pick date range → screenshot | "Summarize last week's performance" |
| Open Audience → create from upload → upload CSV → wait | "Create an audience from this CSV: customers_last_month.csv" |
| Open Rich Menu → design tabs → upload images → set as default | "Build a Mother's Day rich menu and set it as default" |
| Open Coupon → check usage tab → cross-reference clicks | "How many people redeemed my Mother's Day coupon?" |

The MCP server takes care of LINE Messaging API calls, pre-flight validation, quota safety, quiet-hour warnings, and Thai-localized templates. You stay in your AI host and operate your OA the way you think about it — by intent.

---

## Who is it for?

- 🪐 **AI-first marketers** who run a LINE OA from their AI workspace.
- 🏪 **SMB owners** who already use LINE OA as their primary customer channel and want to automate routine work.
- 🏢 **Marketing agencies** managing many client OAs from one dashboard.
- 💻 **Developers** building LINE-integrated SaaS, automations, or AI bots.

**Free-tier ready** — no Premium upgrade required for the core feature set.

---

## What you can do

**34 tools + 4 resources + 7 guided prompts**, grouped by what you actually want to do:

### 📨 Send messages (2 tools)
One universal `send_message` covers every LINE transport (reply / push / multicast / narrowcast / broadcast). Three modes: `send_now`, `draft` (for scheduling via LINE OA Manager UI), and `dry_run` (validate + estimate cost without sending). Message shapes: text, Flex (template or raw JSON), sticker, **image**, **video**, **native LINE coupon** (`{ coupon_id }`), and a `message_json` passthrough for pre-built Rich/Card messages. Plus Thai-friendly sticker search.

### 🎨 Rich Menus (8 tools)
Build a rich menu in one call (create + upload image + set as default), list, delete, and diagnose "why doesn't this user see my menu?". Full lifecycle too: **link/unlink** a menu to specific users or in bulk (auto-chunked at 500), **set/clear** the account default, manage rich-menu **aliases** (tab-switching menus), and **swap the image** on an existing menu.

### 💎 Message Design (3 tools)
Design **Flex Messages** from 8 Thai-localized templates or raw JSON, build **Rich Messages** (`imagemap` — tappable image regions + optional video), and **Card Messages** (`template` — buttons / confirm / carousel / image_carousel). Each returns ready-to-send JSON you hand to `send_message`.

### 🎯 Audiences (5 tools)
Build retargeting audiences from a CSV or from prior broadcast engagement, list, delete — and **update** an existing audience (add users, rename).

### 📊 Insights (5 tools)
Quick OA status snapshot (incl. chat mode), weekly markdown reports, per-broadcast engagement stats, pre-flight send-cost estimation, and **narrowcast delivery progress** ("did my blast finish?").

### 🎟 Coupons (2 tools)
Create, list, get, and discontinue native LINE coupons with `line_manage_coupon`, then broadcast a created coupon straight into chats as a native coupon message via `send_message` (`{ coupon_id }`). Pull redemption analytics by combining coupon details with click-audience tracking.

### 🔌 Webhook (2 tools)
Test your OA's webhook URL and surface LINE's signature verification result, plus **set/get** the webhook endpoint — quick to wire up or diagnose "why isn't my bot responding?".

### 👤 Operations (5 tools)
User profile lookup, follower listing, multi-OA listing and switching, and `run_on_many_oas` for agencies that need to run a read-only tool across all client OAs in parallel.

### 💻 LIFF & Token (2 tools)
Manage LIFF app lifecycle (create / update / delete / list) and verify your channel access token's validity, expiry, and scope.

**Resources** — auto-refreshing OA snapshot, Flex template catalog, sticker catalog with mood-keyword index, and a Thai festival calendar with marketing promo patterns.

**Prompts** — guided workflows for daily reports, campaign building, broadcast scheduling, rich menu diagnosis, coupon campaigns, LINE Notify migration, and webhook setup.

---

## Quick Start

### Requirements

- **Node.js 20 or later**
- A LINE Official Account with Messaging API enabled
- A Channel Access Token

No database, no Playwright, no CDN, no public URL, no scheduler infrastructure required.

### Step 1 — Get your Channel Access Token

1. Open the [LINE Developers Console](https://developers.line.biz/console/).
2. Pick your provider → open (or create) a **Messaging API channel**.
3. Open the **Messaging API** tab → scroll to **Channel access token** → click **Issue**.
4. Copy the long-lived token. Treat it like a password.

If you don't yet have a LINE Official Account, follow [LINE's getting started guide](https://developers.line.biz/en/docs/messaging-api/getting-started/).

### Step 2 — Add the MCP server to your AI host

Paste the following block into your host's MCP config file (see table below):

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

**Where to find the config file:**

| Host | Where to add it |
|---|---|
| **Claude Cowork** | Settings → **Developer** → Local MCP servers → **Edit Config** |
| **Claude Desktop** (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| **Claude Desktop** (Windows) | `%APPDATA%\Claude\claude_desktop_config.json` |
| **Claude Code** | Run `claude mcp add line` or edit `~/.config/claude/mcp.json` |
| **Cursor / Codex / ChatGPT desktop** | See your host's MCP setup docs — same JSON shape |

> ⚠️ **Don't replace existing MCP servers.** Add the `"line"` entry alongside any existing entries inside `mcpServers`.

### Step 3 — Restart your AI host

Quit completely (Cmd+Q on macOS) and reopen. On first start the host runs `npx -y line-oa-mcp-ultimate`, downloads the package from npm, and caches it for subsequent starts.

### Step 4 — Verify

In a new chat, try:

```
Show my LINE OA status
```

or in Thai:

```
ดูสถานะ OA หน่อย
```

You should see a health card with friend count, monthly quota, webhook status, and the default rich menu. That's it — you're now operating your LINE OA from your AI agent.

---

## Configuration

### Single-OA mode (default — for most users)

That's the **Step 2** snippet above. One environment variable, one OA. Suitable for individual creators, course makers, and most SMB owners.

### Multi-OA mode (for agencies)

If you manage several LINE OAs (your own plus client accounts), create a JSON config file at `~/.line-mcp/config.json` — the server auto-discovers it, so there's nothing to clone or build:

```bash
mkdir -p ~/.line-mcp
nano ~/.line-mcp/config.json     # or: code ~/.line-mcp/config.json
```

> 📘 Full walkthrough (two placement options + security notes) in [`docs/multi-oa-setup-th.md`](docs/multi-oa-setup-th.md). A ready-to-edit template lives in [`config.example.json`](config.example.json).

Fill in one entry per OA:

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

Then **drop the `LINE_CHANNEL_ACCESS_TOKEN` env var** from your MCP config — the server discovers `~/.line-mcp/config.json` automatically.

Resolution order:

1. `LINE_MCP_CONFIG` env var (custom path)
2. `~/.line-mcp/config.json`
3. `LINE_CHANNEL_ACCESS_TOKEN` env var (single-OA fallback)

### Switching the active OA at runtime

Ask your AI host:

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
| [examples/](examples/) | Runnable examples |

---

## Versioning

This project follows [Semantic Versioning](https://semver.org/). Current release: **v1.1.0**.

Latest changes (v1.1.0): **+10 tools** completing LINE's token-only API surface — rich-menu lifecycle (per-user link/unlink, set/clear default, aliases, image swap), **Rich Message** (`imagemap`) and **Card Message** (`template`) builders, audience update, webhook set/get, narrowcast progress, and token check. `send_message` gained image / video / pre-built `message_json` shapes; `get_oa_status` now reports chat mode. Four real-time/codegen tools that don't fit an AI-agent workflow (loading indicator, account-link token, LIFF/Login code generators) were removed. See [RELEASE_NOTES_v1.1.0.md](RELEASE_NOTES_v1.1.0.md).

---

## Roadmap

- **v1.x** — Full token-only Messaging API coverage: outbound + rich-menu lifecycle + Rich/Card message builders + audiences + insights + coupons (current).
- **v2.x** — **LINE Shopping API** integration (under research) — bring shop catalog, products, and commerce flows into the same AI-agent workflow.
- **Hosted SaaS** — agency multi-tenant use.

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

- CEO at Innovation Vantage
- Founder at ForgeAI — AI Transformation Studio
- LINE Certified Coach 2026
- AI Transformation educator, SaaS builder, university lecturer

This project is part of a broader mission to bring production-grade AI automation to every Thai practitioner — regardless of technical background.

GitHub: [@wasintoh](https://github.com/wasintoh)

---

## License

[MIT](LICENSE) © Dr. Wasin Treesinthuros — Innovation Vantage / ForgeAI
