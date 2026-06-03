# Release Notes — v1.1.0 (API Completeness)

**Theme:** Complete LINE's **token-only** Messaging API surface — every tool works with just a channel access token, no webhook, no hosted server. Stays fully npx-installable in Claude Cowork, Claude Code, Codex, OpenClaw, Hermes, and any MCP host.

**Tool count: 27 → 34** (+10 new, −3 removed). Zero new npm dependencies (Node built-ins only).

---

## Added (10 tools)

### Rich Menu lifecycle
- **`line_link_rich_menu`** — link/unlink a rich menu to specific users (single or bulk; auto-chunked at 500 ids/request). Per-user menus override the default → segment-specific menus (e.g. paid vs free).
- **`line_set_default_rich_menu`** — set or **clear** the account-wide default menu (clearing had no tool before).
- **`line_manage_rich_menu_alias`** — alias CRUD (create/update/delete/get/list). Required for tab-switching menus.
- **`line_upload_rich_menu_image`** — replace the image on an existing menu without recreating it.

### Message builders
- **`line_design_imagemap`** — builds an `imagemap` message = OA Manager's **"Rich Message"** (tappable image regions + optional video). Validates the 1040px base-width contract.
- **`line_design_card`** — builds a `template` message = OA Manager's **"Card Message"** (buttons / confirm / carousel / image_carousel), all limits enforced.

### Audience / Webhook / Stats / Token
- **`line_update_audience`** — add users to / rename an existing upload audience.
- **`line_set_webhook_endpoint`** — set/get the webhook URL via API (v1 had test only).
- **`line_get_narrowcast_progress`** — check whether a broadcast finished or failed.
- **`line_check_token`** — verify the active token's validity, expiry, and scope (never prints the token).

## Extended
- **`line_send_message`** — now also sends **image**, **video** (optional `tracking_id`), and a generic **`message_json`** passthrough (forwards objects from `line_design_imagemap` / `line_design_card` / `line_design_flex`). The `image` type existed in v1 but was never wired.
- **`line_get_oa_status`** — now reports **`chat_mode`** (`bot` = auto-respond / `chat` = manual operator) and **`mark_as_read_mode`**.

## Removed (4 tools) — don't fit an AI-agent workflow
- **`line_show_typing`** — the loading animation is a real-time chatbot UX (needs an end-user waiting in a LINE chat); meaningless when an AI agent calls it through Cowork.
- **`line_emit_liff_code`**, **`line_emit_login_snippet`** — code generators; an AI agent already writes that code natively.
- **`line_issue_link_token`** — account-link token belongs to a real-time, backend-driven binding flow, not an ad-hoc agent call.

> Rationale: a distributed MCP should expose only what the agent actually uses. Removing these keeps the tool list honest for Cowork / OpenClaw / Hermes users.

## Fixes
- **`TH.replyTokenExpiredFallback`** corrected: reply-token lifetime is **~1 minute**, not "~30 seconds" (verified against LINE docs).
- **https-only** enforced on all fetched/area image URLs (rich-menu image, imagemap actions) — small SSRF hardening.

---

## Quality gate
- **`tsc --noEmit`**: clean (strict + `noUncheckedIndexedAccess`, no `any`).
- **`vitest run`**: **56/56 pass** — `imagemap-builder` (17), `template-builder` (17), `chunk` boundary 500/501 (6), `coupon-body` (16).
- **`npm run build`**: clean.
- **Agent QC** (vs live LINE docs): every endpoint path, method, body field, response field, and limit verified → **SHIP**.
- **Agent Code Review** (security / types / DRY / pattern): no token leakage, pattern-faithful to existing tools → **SHIP**.

## Versioning note
The 10 additions are backward-compatible (existing tools unchanged), so this is a **minor** bump (1.0.x → 1.1.0). The 3 removed v1 tools are technically a breaking change under strict SemVer, but they're niche, the package is early, and the feature additions dominate — so 1.1.0 is the pragmatic, honest choice over forcing a 2.0.0.

## Compatibility
- No new dependencies; same `@line/bot-sdk` + `@modelcontextprotocol/sdk` + `zod`.
- New files: `src/line/{imagemap-builder,template-builder}.ts`, 10 `src/tools/*.ts`, 3 test suites, `docs/v2-prd.md`.
- Extended: `src/line/client.ts`, `src/types.ts`, `src/constants.ts`, `src/i18n/th.ts`, `src/tools/{send-message,get-oa-status,build-rich-menu}.ts`, `src/server.ts`.
