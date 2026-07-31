<div align="center">

<img src="https://raw.githubusercontent.com/wasintoh/line-oa-mcp-ultimate/main/docs/brand/logo-v22-tagline.png" alt="<OA/> MCP Ultimate 2.2 — MCP server for LINE Official Account" width="720">

# LINE OA MCP Ultimate

**Operate your LINE Official Account from any AI agent — through natural language.**

🖼️ **New in 2.2:** attach a picture, say *"send this as a Rich Message"* — and it appears in your customers' chats. No hosting. No image resizing. No setup.

[![CI](https://github.com/wasintoh/line-oa-mcp-ultimate/actions/workflows/test.yml/badge.svg)](https://github.com/wasintoh/line-oa-mcp-ultimate/actions/workflows/test.yml)
[![npm version](https://img.shields.io/npm/v/line-oa-mcp-ultimate.svg)](https://www.npmjs.com/package/line-oa-mcp-ultimate)
[![npm downloads](https://img.shields.io/npm/dm/line-oa-mcp-ultimate.svg)](https://www.npmjs.com/package/line-oa-mcp-ultimate)
[![coverage](https://img.shields.io/badge/coverage-%E2%89%A580%25_enforced_in_CI-brightgreen.svg)](.github/workflows/test.yml)
[![npm provenance](https://img.shields.io/badge/npm-provenance-blue.svg)](https://www.npmjs.com/package/line-oa-mcp-ultimate)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](#requirements)
[![MCP](https://img.shields.io/badge/MCP-1.x-purple.svg)](https://modelcontextprotocol.io)

[Quick Start](#quick-start) · [What you can do](#what-you-can-do) · [Configuration](#configuration) · [Security](#-security) · [Documentation](#documentation)

**🇹🇭 คู่มือภาษาไทย:** [เริ่มต้น 5 นาที](docs/quickstart-th.md) · [Messaging — 37 tools](docs/messaging-guide-th.md) · [LINE Shopping — 14 tools](docs/myshop-guide-th.md)

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
| Resize the artwork to 5 sizes → find somewhere to host it → upload → paste URLs into a Rich Message | "ส่งรูปนี้เป็น Rich Message หาลูกค้าทุกคน" *(attach the picture — that's the whole job)* |
| Navigate Insight → Delivery → pick date range → screenshot | "Summarize last week's performance" |
| Open Audience → create from upload → upload CSV → wait | "Create an audience from this CSV: customers_last_month.csv" |
| Open Rich Menu → design tabs → upload images → set as default | "Build a Mother's Day rich menu and set it as default" |
| Open Coupon → check usage tab → cross-reference clicks | "How many people redeemed my Mother's Day coupon?" |

The MCP server takes care of LINE Messaging API calls, pre-flight validation, quota safety, quiet-hour warnings, and Thai-localized templates. You stay in your AI host and operate your OA the way you think about it — by intent.

---

## 🆚 vs the official `@line/line-bot-mcp-server`

LY Corporation publishes an official [LINE Bot MCP server](https://github.com/line/line-bot-mcp-server) (Apache-2.0, marked *preview*). It's a clean reference implementation, and ideas from it helped shape this project — if all you need is pushing a text or Flex message to one user from an agent, it may be enough. This project targets running a real OA (or an agency's worth of them) day to day:

| | **`line-oa-mcp-ultimate`** (this project) | official `@line/line-bot-mcp-server` |
|---|---|---|
| Tools | **51** (37 messaging + 14 shopping) + 4 resources + 8 guided prompts | 12 (push/broadcast text & Flex, profile, quota read, rich-menu basics, follower IDs) |
| LINE Shopping (MyShop) | ✅ 14 opt-in tools — products, stock, orders, parcel labels, settlements, checkout links | ❌ |
| Rich Message images | ✅ zero-setup (v2.2) — attach a picture, everything else is automatic and **verified delivered-able before "success"** | ❌ bring your own hosted URLs |
| Multi-OA | ✅ one config file for all client OAs + runtime switch (`line_use_oa`) + fan-out (`line_run_on_many_oas`) | ❌ one OA per server instance |
| Quota / quiet-hours guardrails | ✅ pre-flight Quota Guardian, 22:00–08:00 quiet-hours warnings, `dry_run` cost estimates | ➖ quota *read* tool (`get_message_quota`); no pre-flight guardrails |
| Thai i18n | ✅ every user-facing error/warning in Thai, plus full Thai guides | ❌ English (Japanese README available) |
| Rich-menu image generation | ✅ pure-JS satori + resvg (~10 MB, no browser), with a **preview-before-deploy** loop | ✅ Marp + Puppeteer (downloads headless Chromium), generate-and-upload in one shot |
| Transports | stdio + Streamable HTTP with bearer-token auth (`MCP_HTTP_TOKEN`) | stdio (npx / Docker) |
| Runtime footprint | browser-free — no headless Chromium download | depends on `puppeteer` + `@marp-team/marp-core` for rich-menu images |

*Based on the official repo's README and package manifest as of 2026-07 — see their repo for the latest.*

---

## Who is it for?

- 🪐 **AI-first marketers** who run a LINE OA from their AI workspace.
- 🏪 **SMB owners** who already use LINE OA as their primary customer channel and want to automate routine work.
- 🏢 **Marketing agencies** managing many client OAs from one dashboard.
- 💻 **Developers** building LINE-integrated SaaS, automations, or AI bots.

**Free-tier ready** — no Premium upgrade required for the core feature set.

---

## What you can do

**37 messaging tools + 14 LINE Shopping tools (v2.0, opt-in) + 4 resources + 8 guided prompts**, grouped by what you actually want to do:

### 📨 Send messages (2 tools)
One universal `send_message` covers every LINE transport (reply / push / multicast / narrowcast / broadcast). Three modes: `send_now`, `draft` (for scheduling via LINE OA Manager UI), and `dry_run` (validate + estimate cost without sending). Message shapes: text, Flex (template or raw JSON), sticker, **image**, **video**, **native LINE coupon** (`{ coupon_id }`), and a `message_json` passthrough for pre-built Rich/Card messages. Plus Thai-friendly sticker search.

### 🎨 Rich Menus (9 tools)
Build a rich menu in one call (create + upload image + set as default), list, delete, and diagnose "why doesn't this user see my menu?". Full lifecycle too: **link/unlink** a menu to specific users or in bulk (auto-chunked at 500), **set/clear** the account default, manage rich-menu **aliases** (tab-switching menus), and **swap the image** on an existing menu. **New in v2.1 — Rich Menu Studio:** `line_design_rich_menu_image` generates the menu image itself (Thai-ready layout templates, pure-JS satori + resvg — no headless browser), lets you **preview before deploying**, then hands off to `line_build_rich_menu`.

### 💎 Message Design (5 tools)
Design **Flex Messages** from 8 Thai-localized templates or raw JSON, build **Rich Messages** (`imagemap` — tappable image regions + optional video), and **Card Messages** (`template` — buttons / confirm / carousel / image_carousel). Each returns ready-to-send JSON you hand to `send_message`. **New in v2.2:** Rich Messages need zero hosting — attach any image and it's resized, hosted, and verified for you (`line_prepare_image` + `line_image_host_status`).

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

### 🛍️ LINE Shopping (14 tools — v2.0, opt-in)

Turn your agent into a storefront operator. These register **only when a MyShop API key is configured** (see [Configuration](#configuration)) — messaging-only users never see them. Powered by the **MyShop Open API** (`X-API-KEY`, no webhook/server required).

- **Products (7):** list, create, update, delete, change price, show/hide, and manage variants — e.g. *"เพิ่มสินค้าเสื้อยืด 299 บาท สต็อก 50"*, *"ลดราคาคอลเลกชันนี้ 15%"*.
- **Inventory (1):** set / increase / decrease stock — *"เติมสต็อก V9 อีก 50"*.
- **Orders (4):** list/search (with **polling** for new orders via a scheduled task), get detail, **fulfill** (mark shipped + tracking, mark COD paid, **print parcel label**), and cancel — *"ออกใบปะหน้าให้ออเดอร์ที่จ่ายแล้ววันนี้"*.
- **Settlement + Checkout (2):** see real income after fees, and **create a checkout link to close the sale in chat** — *"ลูกค้าอยากได้ 2 ชิ้น สร้างลิงก์จ่ายเงิน"*.

> 📘 **Full Thai guide:** [docs/myshop-guide-th.md](docs/myshop-guide-th.md) — get the API key, every tool explained, real workflows, safety rules, and troubleshooting.

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

### 🛍️ Want LINE Shopping too? (optional)

Add `LINE_MYSHOP_API_KEY` to the same `env` block (get it from `oaplus.line.biz` → **Settings → API keys**, Admin role). The full config looks like this:

```json
{
  "mcpServers": {
    "line": {
      "command": "npx",
      "args": ["-y", "line-oa-mcp-ultimate"],
      "env": {
        "LINE_CHANNEL_ACCESS_TOKEN": "YOUR_TOKEN_HERE",
        "LINE_MYSHOP_API_KEY": "YOUR_MYSHOP_API_KEY_HERE"
      }
    }
  }
}
```

Restart your host — that unlocks **14 shopping tools** (products, inventory, orders, parcel labels, settlements, checkout links). Without the key, the server stays messaging-only. See [LINE Shopping](#-line-shopping-14-tools--v20-opt-in), the **[full Thai MyShop guide](docs/myshop-guide-th.md)**, and [Image hosting](#️-image-hosting).

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
      "region": "TH",
      "myshop_api_key": "MYSHOP_KEY_1"
    },
    "client_a": {
      "channel_access_token": "TOKEN_2",
      "display_name": "Client A — Bangkok Cafe"
    }
  }
}
```

> 🛍️ **LINE Shopping (v2.0):** add `"myshop_api_key"` to any OA to enable the 14 shopping tools for it (get it from `oaplus.line.biz` → Settings → API keys, Admin role). In single-OA mode, set the env var `LINE_MYSHOP_API_KEY` instead. OAs without a key simply keep the messaging tools — the shopping tools never appear and never error.

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

## 🖼️ Images & Rich Messages — zero setup (v2.2)

Before 2.2, sending one Rich Message meant: resize your artwork into five exact sizes, find hosting, upload, paste URLs — the step where most shop owners simply gave up. Now the whole workflow is:

> **Attach a picture. Say "send this as a Rich Message". Done.**

What you get, without doing anything:

- 📐 Every size LINE requires — prepared automatically.
- 🌍 Your image made reachable for LINE — automatically, wherever you run: your laptop, a server, anywhere. Nothing to sign up for, nothing to configure.
- ✅ **Verified before "success"** — the tool checks that LINE can actually pull every size *before* it ever tells you the send worked. The classic "API said success but customers see a blank image" problem is gone.
- 🧰 **Never a dead end** — on locked-down networks where automation isn't possible, you instantly get a ready-made package + 1-minute Thai instructions instead of an error.

One honest rule to remember: LINE collects the image when each customer **first opens** the message — so keep your machine on until your audience has seen it (the built-in 24-hour window covers a normal broadcast day). Once opened, the image lives on LINE's side permanently.

Full guide + troubleshooting (Thai): [docs/image-hosting-th.md](docs/image-hosting-th.md)

Prefer hosting yourself (agencies, long-running campaigns)? Everything still works the classic way — every image tool accepts a **public, direct HTTPS URL** to a JPEG/PNG:

- ✅ **Recommended:** Cloudflare R2, AWS S3 (public bucket), `raw.githubusercontent.com`, Cloudinary, ImageKit — stable, direct URLs.
- ⚠️ **Avoid:** Google Drive / Dropbox share links — they return an HTML preview page, not a direct image. (The `source_url` input rewrites these to direct-download form automatically.)

## Documentation

| Doc | What's in it |
|---|---|
| [docs/quickstart-th.md](docs/quickstart-th.md) | Thai-language quick start (5-minute walkthrough) |
| [docs/messaging-guide-th.md](docs/messaging-guide-th.md) | 📨 **Messaging full guide — Thai.** The messaging tools explained, transports & send modes, real workflows, safety limits, and troubleshooting |
| [docs/myshop-guide-th.md](docs/myshop-guide-th.md) | 🛍️ **LINE Shopping (MyShop) full guide — Thai.** Get the API key, all 14 tools explained, real end-to-end workflows, safety rules, and troubleshooting |
| [docs/clients-setup-th.md](docs/clients-setup-th.md) | Per-host MCP setup — Cowork / Claude Desktop / Cursor / Codex (Thai) |
| [docs/image-hosting.md](docs/image-hosting.md) · [docs/image-hosting-th.md](docs/image-hosting-th.md) | 🖼️ **Images & Rich Messages with zero hosting (v2.2)** — EN + Thai: how it works, the first-view rule, troubleshooting |
| [docs/multi-oa-setup-th.md](docs/multi-oa-setup-th.md) | Multi-OA configuration guide (Thai) |
| [docs/cowork-local-test-th.md](docs/cowork-local-test-th.md) | Test a local build in Claude Cowork before publishing (Thai) |
| [docs/http-transport.md](docs/http-transport.md) | Streamable HTTP transport for self-hosted / remote use |
| [SECURITY.md](SECURITY.md) · [docs/security-th.md](docs/security-th.md) | Security policy (EN) · threat-model guide for shop owners (Thai) |
| [examples/](examples/) | Runnable examples |

---

## 🔐 Security

This server operates with **live channel access tokens** — whoever holds the token *is* your shop. Treat your MCP config like a password store.

- **Report vulnerabilities privately** via GitHub Security Advisories — see [SECURITY.md](SECURITY.md) for scope, response times, and what to include. Please don't open public issues for security problems.
- **Thai threat-model guide for shop owners:** [docs/security-th.md](docs/security-th.md) — what a leaked token can do, per-OA token isolation, and config-file permissions.
- **HTTP transport requires auth beyond localhost:** binding to any non-loopback host (e.g. `0.0.0.0`) **requires `MCP_HTTP_TOKEN`** — every request must then carry `Authorization: Bearer <token>`. Without the token the server refuses to expose itself beyond `127.0.0.1`. Details in [docs/http-transport.md](docs/http-transport.md).

---

## Versioning

This project follows [Semantic Versioning](https://semver.org/). Current release: **v2.1.0 "Trust Release"** — full history in [CHANGELOG.md](CHANGELOG.md).

Latest changes (v2.1.0): **Rich Menu Studio** (`line_design_rich_menu_image` — generate rich-menu images with no headless browser, preview before deploy), **HTTP bearer auth** (`MCP_HTTP_TOKEN`), a published security policy ([SECURITY.md](SECURITY.md)), CI/CD with npm **provenance**, and a much larger test suite with a coverage gate enforced in CI. See [CHANGELOG.md](CHANGELOG.md).

Previously (v2.0.0): **+14 LINE Shopping tools** via the MyShop Open API — products, inventory, orders (incl. parcel labels), settlements, and checkout links. API-key only, no webhook/server, fully **opt-in** (registers only when a MyShop key is set) and **non-breaking** on the 34 messaging tools. See [RELEASE_NOTES_v2.0.0.md](RELEASE_NOTES_v2.0.0.md).

Previously (v1.1.0): +10 tools completing LINE's token-only Messaging API surface (rich-menu lifecycle, Rich/Card message builders, audience update, webhook set/get, narrowcast progress, token check). See [RELEASE_NOTES_v1.1.0.md](RELEASE_NOTES_v1.1.0.md).

---

## Roadmap

- **v1.x** — Full token-only Messaging API coverage: outbound + rich-menu lifecycle + Rich/Card message builders + audiences + insights + coupons.
- **v2.0** — ✅ **LINE Shopping (MyShop Open API)** shipped — products, inventory, orders, parcel labels, settlements, and checkout links (API-key only, no webhook). See [RELEASE_NOTES_v2.0.0.md](RELEASE_NOTES_v2.0.0.md).
- **v2.1** — ✅ **"Trust Release"** shipped — Rich Menu Studio (image generation + preview), HTTP bearer auth, security policy + hardening, CI/CD with provenance, coverage-gated test suite. See [CHANGELOG.md](CHANGELOG.md).

Future direction is guided by real-world usage and community feedback.

---

## Contributing

PRs are welcome. Please open an issue first to discuss substantial changes.

**The one rule: a new tool ships with new tests.** Every tool is exercised through a real in-memory MCP client with the LINE API mocked at the fetch boundary (see `tests/helpers/`) — no live token needed to run the suite.

```bash
npm ci
npm run typecheck       # strict TypeScript, no `any`
npm test                # vitest run
npm run test:coverage   # coverage — ≥80% lines, enforced in CI
npm run build
```

When contributing:

- Tool names: `line_{action}_{resource}` (snake_case, prefix `line_`).
- Tool descriptions: English (for LLMs) — Thai examples encouraged.
- User-facing strings: Thai-friendly (centralized in `src/i18n/th.ts`).
- Pre-flight validation on every send tool.
- Quota Guardian + Quiet Hours on every consumption tool.
- **Backward compatibility is non-negotiable** — never rename or remove existing tools, params, response fields, env vars, or config keys.

PR expectations: CI must be green ([test workflow](.github/workflows/test.yml) — typecheck, tests with coverage, build on Node 20 & 22), and behavior changes come with a matching `CHANGELOG.md` line under *Unreleased*.

### Releasing (maintainers)

1. Move the *Unreleased* section of [CHANGELOG.md](CHANGELOG.md) to the new version and bump `package.json`.
2. `git tag vX.Y.Z && git push origin vX.Y.Z`.
3. The [release workflow](.github/workflows/release.yml) runs the full gate (typecheck + tests + build), publishes to npm with **`--provenance`**, and creates a GitHub Release from the matching CHANGELOG section. It needs one repo secret: **`NPM_TOKEN`** (npm granular access token with publish rights on this package).

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
