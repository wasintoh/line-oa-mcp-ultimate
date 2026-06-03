# Release Notes — v1.0.4

**Release date:** 2026-06-01
**Type:** Patch (bug fixes + backward-compatible additions, no breaking changes)

## 🐛 Fixes

- **Coupon create was completely broken** — `line_manage_coupon { mode: "create" }` rejected every request with LINE `400: The request body has 7 error(s)`. The handler sent `{ startTime, endTime, code, maxRedemptions, termsUrl }`, but `POST /v2/bot/coupon` requires **8 fields**: `title`, `reward`, `acquisitionCondition`, `startTimestamp`, `endTimestamp`, `timezone`, `visibility`, `maxUseCountPerTicket` — hence exactly 7 missing/renamed fields. The create path was rewritten to build the correct body from friendly inputs:
  - `discount_type` (`percentage` | `fixed` | `explicit`) + `discount_value` (or `price_before`/`price_after`) → `reward.priceInfo`
  - `valid_from` / `valid_to` accept `YYYY-MM-DD`, ISO datetime, or epoch → converted to **UNIX seconds** (LINE uses seconds, not milliseconds)
  - sensible defaults: `timezone: ASIA_BANGKOK`, `visibility: UNLISTED`, `acquisitionCondition.type: normal`, `maxUseCountPerTicket: 1`
- **Coupon list always returned 0** — `line_manage_coupon { mode: "list" }` read `res.coupons`, but `GET /v2/bot/coupon` returns a pager response keyed `items`. Now reads `items` (with a `coupons` fallback) so created coupons actually show up.
- **Opaque API errors** — `line_manage_coupon` now surfaces LINE's per-field `details[]` instead of just `"N error(s)"`, so validation failures are debuggable at a glance.

## ✨ Added

- **Send a native LINE coupon** — `line_send_message` gained a fifth message shape `{ coupon_id, delivery_tag? }`. It builds LINE's coupon message object (`{ type: "coupon", couponId, deliveryTag? }`) so a coupon created via `line_manage_coupon` can be broadcast/pushed straight into chats. `delivery_tag` (≤30, `[A-Za-z0-9_]`) feeds LINE's coupon-path insights.

## ✅ Tests & Verification

- New unit tests for the coupon body mapper (`tests/coupon-body.test.ts`) — 15 assertions covering required fields, UNIX-seconds conversion, percentage/fixed/explicit rewards, default values, and validation errors.
- Verified live end-to-end against the LINE API: `create` (real `couponId` returned), `get` (`status: RUNNING`), `list` (coupon appears), and a native coupon-message broadcast (`success: true`).

## 📝 Documentation

- `README.md` — Coupons and Send-messages sections note native coupon sending; version bumped to v1.0.4 with a "latest changes" summary.
- `docs/clients-setup-th.md` — version-pin example updated to `@1.0.4`.
- `docs/http-transport.md` — startup banner and `/health` example updated to `1.0.4`.
- `docs/cowork-local-test-th.md` — local-build test guide for validating fixes in Claude Cowork before publishing.

## 🔁 Consistency

- Version is now `1.0.4` across `package.json`, `package-lock.json`, `src/constants.ts`, `README.md`, and every doc.

---

> Previous notes: [`RELEASE_NOTES_v1.0.3.md`](RELEASE_NOTES_v1.0.3.md) · [`RELEASE_NOTES_v1.0.1.md`](RELEASE_NOTES_v1.0.1.md)
