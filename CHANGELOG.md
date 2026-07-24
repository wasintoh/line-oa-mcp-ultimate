# Changelog

All notable changes to `line-oa-mcp-ultimate` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.0] — 2026-07-24 "Trust Release"

Theme: Test + Security + Optimize + one visible upgrade. 100% backward
compatible — no existing tool, schema, env var, or config key changed shape.

### Added

- **Rich Menu Studio** — new tool `line_design_rich_menu_image`: one call takes
  a Thai SMB from idea to live rich menu. Declarative cells + brand kit,
  9 layout templates (2500×1686 and 2500×843) with tap areas auto-derived from
  the same geometry as the rendered image (they can never drift), auto
  text-contrast, solid/gradient/outline/glass styles. Three modes mirroring
  `line_send_message`: `preview` (returns the PNG as MCP image content so the
  agent reviews it BEFORE anything touches LINE), `save`, `deploy`
  (validate → create → upload → optional default/alias, with orphan cleanup on
  any mid-pipeline failure). Pure-JS renderer — satori (layout) +
  @resvg/resvg-js (rustybuzz does real Thai shaping: stacked marks, สระอำ, tone
  marks all correct) — ~10 MB total, no headless browser. Thai-first fonts:
  LINE Seed Sans TH (fetched on first use from seed.line.me and cached —
  OFL-licensed per the site but the official zip ships no license file, so we
  don't redistribute), Prompt + Noto Sans Thai bundled (OFL), `font_path`
  override supported. New MCP prompt `design-rich-menu`; Thai guide
  `docs/rich-menu-studio-th.md` with café / clinic / MyShop-commerce worked
  examples. Tool count 48 → 49.
- **HTTP bearer auth** — `MCP_HTTP_TOKEN` enforces `Authorization: Bearer` on
  the Streamable HTTP transport (timing-safe compare); binding to a
  non-loopback host without a token now refuses to start with a Thai
  explanation. HTTP server logic extracted to testable `src/http.ts`.
- [SECURITY.md](SECURITY.md) (vulnerability reporting policy) and a
  Thai-language threat-model guide for shop owners,
  [docs/security-th.md](docs/security-th.md).
- CI/CD: `test` (lint hook + typecheck + tests + coverage + build on Node
  20/22), `audit` (weekly + PR dependency audit, fails on high), and `release`
  (tag → tests → npm publish with provenance → GitHub Release from this file)
  workflows — all actions pinned by commit SHA; Renovate config; this
  changelog; ESLint 9 flat config.
- Test fortress: 553 tests across 24 files (v2.0 shipped 69) — fetch-boundary
  mock, in-memory MCP client harness (tests exercise the real MCP surface,
  schema validation included), env isolation, guardrail suites (quota
  hard/soft/confirm, quiet-hours boundary matrix, all 6 transport shapes incl.
  500-per-call multicast chunking, multi-OA resolution priority + runtime
  switching), per-tool breadth suites for all 49 tools, security suites
  (HTTP auth, redaction, SSRF, config perms), Rich Menu Studio suites
  (geometry exactness, contrast, PNG output, deploy pipeline + cleanup).
  Line coverage 89% on `src/`; ≥80% gate enforced in CI.

### Changed

- Tool descriptions: consistency + token pass over 37 of 49 tools — the
  description payload every MCP host loads per session shrank 42.7%
  (42,872 → 24,552 chars; full tool-list JSON 100,244 → 80,986 chars ≈ 20.2k
  tokens), while keeping safety semantics, cross-tool pointers, and Thai
  intent examples. Same behavior everywhere.
- `npx` footprint: removed the unused `@line/bot-sdk` dependency (zero imports
  existed) — runtime deps are now @modelcontextprotocol/sdk, zod, satori,
  @resvg/resvg-js. Cold start stays ~290 ms (renderer is lazy-loaded; a
  messaging-only session never pays for it).
- Response trimming was scoped out of 2.1 after review — changing response
  shapes risks breaking existing automations (kept for a majors-only pass).

### Fixed

- `target.reply_to` in `line_send_message` always failed with a generic
  English error (`pickTransport` was never given a reply-token resolver) while
  the description promised an automatic push fallback — it now returns an
  actionable Thai error (use `{ user_id }`) before any network call, and its
  validate path validates the real messages via `/validate/reply` instead of
  pinging `/validate/push` with an empty array.
- `line_build_rich_menu` orphaned the just-created menu object whenever the
  image download / format check / size check / upload failed — every failure
  path now deletes the orphan (best-effort) and says so in Thai.
- Rich Menu Studio development surfaced and fixed: satori alone drops Thai
  stacked marks (ชั่น → ชัน) — shaping moved to resvg/rustybuzz; auto-contrast
  originally picked white text on LINE green at 2.26:1 and mixed text colors
  across gradient rows — now chooses one worst-case-verified color per canvas.
- `tests` exposed and pinned (not fixed — documented SDK behavior): the MCP
  SDK re-wraps `inputSchema.shape` non-strictly, so unknown TOP-LEVEL
  arguments are silently stripped for every tool; nested objects remain
  strict.

### Security

- **HTTP transport authentication** (see Added) — previously anyone who could
  reach the HTTP port could broadcast as the shop.
- **Secret redaction** — channel tokens / channel secrets / MyShop keys /
  `MCP_HTTP_TOKEN` are registered at config load and scrubbed (raw, Bearer-
  embedded, and JSON-escaped forms) from every `LineApiError` /
  `MyShopApiError` message and stderr log line.
- **SSRF guards** — `line_upload_rich_menu_image`, `line_build_rich_menu`, and
  Rich Menu Studio image/logo URLs now go through a hardened fetcher:
  https-only, loopback/private/link-local/CGNAT/multicast/metadata ranges
  blocked for literal IPs AND DNS-resolved names (IPv6 fully expanded —
  v4-mapped, NAT64 included), redirects re-validated per hop, 10 MB stream
  cap, 15 s timeout. Known residual: DNS-rebinding TOCTOU window (documented
  in SECURITY.md).
- **Config file permissions** — one-time Thai warning (with the exact
  `chmod 600` command) when `~/.line-mcp/config.json` is group/other-readable.
- **Supply chain** — prod vulnerabilities eliminated by removing unused
  `@line/bot-sdk` (vulnerable axios chain); remaining prod audit findings: 2
  moderate advisories in hono via @modelcontextprotocol/sdk (code paths this
  server does not use — plain node:http transport); audit workflow fails CI on
  high; actions SHA-pinned; releases published with npm provenance.

## [2.0.0] — 2026-06-14 "Shopping"

### Added

- **LINE Shopping (MyShop Open API)** — 14 opt-in tools that register only
  when a MyShop API key is configured (`LINE_MYSHOP_API_KEY` env or
  `myshop_api_key` per OA):
  - Products (7): `line_list_products`, `line_create_product`,
    `line_update_product`, `line_delete_product`, `line_update_product_price`,
    `line_set_product_visibility`, `line_manage_product_variant`
  - Inventory (1): `line_manage_inventory` (set / increase / decrease stock)
  - Orders (4): `line_list_orders`, `line_get_order`, `line_fulfill_order`
    (ship / mark-paid / tracking / parcel label), `line_cancel_order`
  - Settlement + Checkout (2): `line_get_settlement`,
    `line_create_checkout_link`
- New `MyShopClient` (X-API-KEY auth, MyShop error envelope), fully separate
  from `LineClient`. Covers all 21 MyShop endpoints — API key only, no
  webhook or server required.
- Thai guides: `docs/myshop-guide-th.md`, `docs/messaging-guide-th.md`.

### Changed

- Nothing breaking: all 34 v1 messaging tools untouched (tool count 34 → 48).

## [1.1.0] — 2026-06-03 "API Completeness"

### Added

- 10 tools completing LINE's token-only Messaging API surface:
  `line_link_rich_menu`, `line_set_default_rich_menu`,
  `line_manage_rich_menu_alias`, `line_upload_rich_menu_image`,
  `line_design_imagemap` (Rich Message), `line_design_card` (Card Message),
  `line_update_audience`, `line_set_webhook_endpoint`,
  `line_get_narrowcast_progress`, `line_check_token`.
- `line_send_message`: image, video (optional `tracking_id`), and generic
  `message_json` passthrough shapes.
- `line_get_oa_status`: reports `chat_mode` and `mark_as_read_mode`.

### Removed

- 4 niche tools that don't fit an AI-agent workflow: `line_show_typing`,
  `line_emit_liff_code`, `line_emit_login_snippet`, `line_issue_link_token`.
  (Technically breaking under strict SemVer; shipped as a minor bump — see
  RELEASE_NOTES_v1.1.0.md for the rationale.) Tool count 27 → 34.

### Fixed

- `TH.replyTokenExpiredFallback`: reply-token lifetime corrected to ~1 minute
  (was "~30 seconds").

### Security

- https-only enforced on all fetched/area image URLs (rich-menu image,
  imagemap actions).

## [1.0.4] — 2026-06-01

### Added

- `line_send_message`: native LINE coupon message shape
  `{ coupon_id, delivery_tag? }` — broadcast a coupon created via
  `line_manage_coupon` straight into chats.

### Fixed

- **Coupon create was completely broken** — `line_manage_coupon
  { mode: "create" }` sent the wrong body (7 missing/renamed fields); rewritten
  to build the correct 8-field `POST /v2/bot/coupon` body (UNIX-seconds
  timestamps, `reward.priceInfo` mapping, sensible Thai defaults).
- **Coupon list always returned 0** — now reads the pager key `items`
  (with `coupons` fallback).
- `line_manage_coupon` surfaces LINE's per-field `details[]` instead of just
  "N error(s)".

## [1.0.3] — 2026-06-01

### Fixed

- `SERVER_VERSION` was hard-pinned to `1.0.0`, so every build from 1.0.0 to
  1.0.2 reported `v1.0.0` in the startup banner and `/health`. Now synced to
  the package version.

### Changed

- Docs rewritten npx-first (`npx -y line-oa-mcp-ultimate`); multi-OA guide
  rebuilt around the auto-discovered `~/.line-mcp/config.json`; HTTP-transport
  doc corrected to the real package name.

## [1.0.2] — 2026-05-29

### Changed

- Version bump only (package metadata); no functional changes.

## [1.0.1] — 2026-05-29

### Added

- **First canonical public release** — 27 tools, 4 resources, 7 guided
  prompts: universal `line_send_message` (5 transports, 3 modes), rich menus,
  Flex design (8 Thai templates), audiences (CSV + engagement), insights,
  coupons, webhook test, multi-OA operations (`line_use_oa`,
  `line_run_on_many_oas`), LIFF management.
- Built-in safety: Quota Guardian, quiet-hours guard (22:00–08:00
  Asia/Bangkok), pre-flight validation, reply-token TTL handling.

## [1.0.0] — 2026-05-29

- Initial publish with placeholder package metadata — superseded by 1.0.1.

[2.1.0]: https://github.com/wasintoh/line-oa-mcp-ultimate/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/wasintoh/line-oa-mcp-ultimate/compare/v1.1.0...v2.0.0
[1.1.0]: https://github.com/wasintoh/line-oa-mcp-ultimate/compare/v1.0.4...v1.1.0
[1.0.4]: https://github.com/wasintoh/line-oa-mcp-ultimate/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/wasintoh/line-oa-mcp-ultimate/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/wasintoh/line-oa-mcp-ultimate/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/wasintoh/line-oa-mcp-ultimate/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/wasintoh/line-oa-mcp-ultimate/releases/tag/v1.0.0
