# v1.0.1 — Initial Public Release 🎉

The first stable release of **LINE OA MCP Ultimate** — a Model Context Protocol server that lets you operate your LINE Official Account from any AI agent through natural language.

> Note: v1.0.0 was published with placeholder package metadata. **Use v1.0.1 as the canonical first release.**

---

## What's inside

**27 tools · 4 resources · 7 guided prompts** covering the full LINE OA operating workflow.

### 📨 Messaging
- `line_send_message` — universal sender (5 transports, 3 modes)
- `line_show_typing` — typing indicator
- `line_find_sticker` — sticker search by mood / keyword

### 🎨 Rich Menu
- `line_build_rich_menu` — create + upload + set default in one call
- `line_list_rich_menus`
- `line_delete_rich_menu`
- `line_audit_user_menu` — "why does user X see menu Y?"

### 💎 Flex Message
- `line_design_flex` — 8 Thai-localized templates + raw JSON

### 🎯 Audiences
- `line_build_audience_from_csv` — CSV → audience
- `line_build_audience_from_engagement` — retarget from prior broadcast clicks
- `line_list_audiences`
- `line_delete_audience`

### 📊 Insights
- `line_get_oa_status` — quick health card
- `line_get_oa_report` — markdown digest for a date range
- `line_get_message_stats` — per-broadcast engagement
- `line_estimate_send_cost` — pre-flight cost estimate

### 🎟 Coupons
- `line_manage_coupon` — CRUD
- `line_get_coupon_stats` — redemption analytics

### 🔌 Webhook
- `line_test_webhook` — ping configured webhook URL

### 👤 Operations
- `line_get_user_profile`
- `line_list_followers` (Premium TH/JP/TW only)
- `line_list_oas`
- `line_use_oa` — switch active OA mid-session
- `line_run_on_many_oas` — agency feature

### 💻 Developer Pack
- `line_manage_liff_app` — LIFF lifecycle CRUD
- `line_emit_liff_code` — generate LIFF SDK init code (5 frameworks)
- `line_emit_login_snippet` — generate LINE Login OAuth scaffold

### Resources
- `line://oa/{id}/snapshot` — auto-refreshing OA status
- `line://flex/templates` — Flex template catalog
- `line://stickers/catalog` — sticker catalog with mood-keyword index
- `line://calendar/thai-holidays` — Thai festival calendar with promo patterns

### Prompts
- `daily-oa-report` · `build-campaign` · `schedule-broadcast-howto`
- `diagnose-rich-menu` · `coupon-campaign`
- `migrate-from-line-notify` · `webhook-setup-guide`

---

## Highlights

- 🪶 **Zero infrastructure** — no database, no public URL, no CDN, no tunnel.
- ⚡ **30-second install** — single env var, one `npx -y` command.
- 🇹🇭 **Thai-first** — Flex templates, error messages, sticker keywords, holiday calendar.
- 🛡 **Built-in safety** — Quota Guardian, quiet-hours guard, pre-flight validation, reply-token TTL handling.
- 🏢 **Multi-OA ready** — operate dozens of client OAs from a single instance (agency-grade).
- 🆓 **Free-tier ready** — no LINE Premium upgrade required for the core feature set.

---

## Install

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

Full setup walkthrough in the [README](https://github.com/wasintoh/line-oa-mcp-ultimate#quick-start).

---

## Compatibility

- **Node.js 20+**
- **MCP hosts:** Claude Cowork · Claude Desktop · Claude Code · Cursor · Codex · ChatGPT desktop · any MCP-compatible host

---

## Roadmap

- **v2.x** — Companion inbound package (webhook ingestion, chat 1:1 reply, auto-reply rules, greeting messages, chat tags).
- **v3.x** — Hosted SaaS for agency multi-tenant use.

---

**Author:** Dr. Wasin Treesinthuros (พี่โต) — Innovation Vantage / ForgeAI / LINE Certified Coach 2026

**License:** MIT
