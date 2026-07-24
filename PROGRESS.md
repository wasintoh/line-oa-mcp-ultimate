# PROGRESS — v2.1 "Trust Release" (Test + Security + Optimize + Rich Menu Studio)

Cross-session state file. One line per event. Newest at the bottom of each section.

## Baseline (v2.0.0, commit 798ab49 — measured 2026-07-24)

- Tools: 48 (34 messaging + 14 MyShop) · prompts 7 · resources 3 registered
- Tool-list JSON: 92,388 chars ≈ 23,097 tokens (chars/4) — heaviest: line_send_message 8,485 · line_design_card 5,958 · line_design_imagemap 5,538
- Cold start (node dist/index.js → "Ready", median of 5): **284 ms** · npm pack 168.9 kB / unpacked 774.3 kB / 272 files
- Tests: 69 passing in 6 files (~668 test lines vs 10,545 src lines ≈ 1:16)
- npm audit: 15 vulns total; **prod-affecting: axios + body-parser (via @line/bot-sdk), hono chain** — 7 prod vulns

## Workstream status

- [x] Scaffolding: fetch-boundary mock, in-memory MCP harness, env isolation, `resetConfigCache()` seam, SSRF-guard baseline, vitest coverage config (80% lines gate), measurement scripts (`scripts/measure-tools.mjs`, `scripts/measure-coldstart.mjs`) — commit 69ae076
- [x] A1 Guardrail tests — 89 tests: quota (hard/soft/confirm/unlimited), quiet-hours boundary matrix, all 6 transports incl. 1200-id chunking, multi-OA priority + runtime switch, send-message e2e (3 modes, confirm gates, Thai errors)
- [x] A2 Breadth tests — 236 tests across 3 files (richmenu-webhook 70, audience-insight-ops 80, myshop 86): every tool file covered (happy path w/ exact endpoint, schema rejection, Thai error), MyShop gating proven (35 vs 49 tools), resources+prompts read. Coverage 58.25% → 89.04% lines on src/ (gate ≥80% passes)
- [x] B Security hardening — HTTP bearer auth (MCP_HTTP_TOKEN, timing-safe; refuses public bind w/o token) in new src/http.ts, secret redaction registry wired into LineApiError/MyShopApiError/logs, config perms warning (0o077), SSRF guard hardened (IPv6 expansion, NAT64, metadata, DNS resolve, redirect re-validation, stream cap) + wired into both image tools, SECURITY.md + docs/security-th.md + http-transport.md token flow — 56 tests
- [x] C Optimize — description payload 42,872 → 24,552 chars (-42.7%); full tool-list JSON 100,244 → 80,986 (≈20.2k tokens, below the 48-tool v2.0 baseline despite +1 tool); 37/49 tools edited, schemas/handlers untouched (diff-audited); server.ts registration order byte-stable. Response trimming deferred to a majors-only pass (BC risk). Cold start after everything: 291ms median; npm pack 397.5 kB (fonts bundled)
- [x] D Rich Menu Studio — line_design_rich_menu_image (preview/save/deploy + orphan cleanup), 9 templates w/ single-source geometry, brand kit + auto-contrast, satori(layout)+resvg(rustybuzz Thai shaping) lazy-loaded (cold start unchanged: 288ms median), LINE Seed fetch-on-first-use (OFL per seed.line.me but no license file in zip → no redistribution) + Prompt/Noto bundled (OFL), prompt design-rich-menu, docs/rich-menu-studio-th.md, demo PNGs visually reviewed — 101 tests
- [x] E CI/CD — test.yml (Node 20/22), audit.yml (weekly + PR, fail-on-high), release.yml (tag → tests → publish --provenance → GitHub Release from CHANGELOG), all actions SHA-pinned, renovate.json conservative, CHANGELOG.md (Keep a Changelog, 1.0.0→2.1.0-unreleased), README badges + verified comparison vs official server (12 tools, puppeteer) + Contributing + Security sections
- [x] Phase-1 integration — commit ebe61d2: full suite 317 tests green; reply_to honest-error fix; build-rich-menu SSRF + orphan cleanup; @line/bot-sdk REMOVED (zero imports; kills axios/body-parser prod vulns — prod audit now 2 moderate, both hono-via-MCP-SDK, unused code path); eslint flat config added (lint green); checkpoint 1 synced to maintainer's machine
- [x] Fresh-context verification (Opus, fresh context) — verdict SHIP-WITH-NOTES, 0 critical/major: all B criteria pass (auth/redaction/SSRF/perms verified by running the built server + curl), all D criteria pass (PNGs re-rendered + visually inspected: Thai marks intact, LINE Seed vs Prompt visibly different, exact dims), DoD all pass. 3 minor notes ALL FIXED post-verification: redactSecrets wired into build-rich-menu upload-error text + send-message unknownError fallback; stale "34 total" comment corrected
- [x] v2.1.0 ship — 553 tests green · 89.04% line coverage · lint/typecheck/build clean · prod audit 0 high/critical (2 moderate transitive, unused path) · cold start 291ms (284 baseline) · tool-list 20.2k tokens (23.1k baseline, +1 tool) · synced to maintainer machine. Remaining manual steps: git commit/push from the real machine, `npm install` (lockfile changed), tag v2.1.0 → release.yml publishes with provenance (needs NPM_TOKEN secret)

## Decisions

- Mock at the global-fetch boundary (no test deps); tools tested through real in-memory MCP client (schema validation included).
- `src/index.ts` excluded from coverage — HTTP logic moves to testable `src/http.ts` (Workstream B), index stays a thin bootstrap.
- satori@0.29 + @resvg/resvg-js@2.6 (~10 MB combined, no headless browser) for Rich Menu Studio; renderer must be dynamically imported.
- Fonts: Prompt + Noto Sans Thai bundled (OFL, verified downloadable); LINE Seed Sans TH = license check → fetch-on-first-use unless redistribution clearly allowed.
- package.json / lockfile / vitest.config / tsconfig owned by orchestrator only (agents report needs).

## Bugs found (running log — final list goes to CHANGELOG)

- FIXED `target.reply_to` always failed with a generic English error (pickTransport never received resolveReplyToken) and its validate path pinged /validate/push with [] — now returns actionable Thai error (TH.replyTokenUnavailable) before any network call; validate uses /validate/reply with the real messages; tool description no longer promises an impossible push fallback
- FIXED HTTP transport had no authentication (anyone on the network could broadcast as the shop) — MCP_HTTP_TOKEN bearer auth, timing-safe compare, refuses non-loopback bind without token
- FIXED tokens/API keys echoed by LINE error bodies flowed verbatim into MCP error text and stderr logs — central redaction registry (raw/Bearer/JSON-escaped forms)
- FIXED `~/.line-mcp/config.json` loaded without permission check — one-time Thai chmod-600 warning when group/other-readable
- FIXED SSRF in upload-rich-menu-image AND build-rich-menu (raw fetch of user URL incl. 169.254.169.254) — both now use the hardened fetchPublicImage guard
- FIXED build-rich-menu orphaned the created menu object when download/format/size/upload failed — best-effort delete + Thai note on every failure path after creation
- FIXED satori drops Thai stacked marks (ชั่น→ชัน) — pipeline renders satori layout with embedFont:false and lets resvg/rustybuzz do real Thai shaping
- FIXED auto-contrast picked white on LINE-green (2.26:1) and mixed text colors across gradient rows — worst-case-contrast canvas-wide text color
- FIXED unused @line/bot-sdk prod dependency pulled vulnerable axios/body-parser chains — removed (zero imports existed)
- KNOWN GAP (pinned, unfixed): MCP SDK re-wraps inputSchema.shape non-strictly → unknown TOP-LEVEL params are silently stripped for every tool (nested objects stay strict) — cross-cutting SDK behavior, documented in tests/send-message.e2e.test.ts
- KNOWN LIMITATION (documented): SSRF guard has a DNS-rebinding TOCTOU window (validation resolve vs fetch resolve) — full fix needs a custom undici dispatcher pinning the validated IP; deferred
- Pinned as intentional: quota guardian soft-blocks when remaining=0 even for projected=0 (conservative fail-safe)
