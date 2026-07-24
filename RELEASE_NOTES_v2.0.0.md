> ⚠️ Superseded — release history now lives in [CHANGELOG.md](./CHANGELOG.md).

# Release Notes — v2.0.0 "Shopping"

**LINE OA MCP Ultimate v2.0** brings **LINE Shopping (MyShop Open API)** into the same AI-agent workflow. v1 let your agent *talk to* customers; v2 lets it *sell to and manage* them — products, stock, orders, parcel labels, settlements, and payment links — all in natural language.

> **Additive & non-breaking.** Every v1 tool is untouched. The 14 shopping tools are **opt-in**: they register only when a MyShop API key is configured. Messaging-only users see no change.

---

## ✨ What's new — 14 LINE Shopping tools

**🛍️ Products (7)**
`line_list_products` · `line_create_product` · `line_update_product` · `line_delete_product` · `line_update_product_price` · `line_set_product_visibility` · `line_manage_product_variant`

**📦 Inventory (1)**
`line_manage_inventory` — set / increase / decrease stock (1–100,000).

**🧾 Orders (4)**
`line_list_orders` (search/filter + **polling** entry point) · `line_get_order` · `line_fulfill_order` (ship / mark-paid / update-tracking / **parcel-label**) · `line_cancel_order`

**💰 Settlement + 🔗 Checkout (2)**
`line_get_settlement` (income & fees per order) · `line_create_checkout_link` (**close the sale in chat** — generate a payment link and paste it to the customer)

Covers all **21 MyShop endpoints** using only an API key — **no webhook, no server required**.

---

## 🔑 Setup

1. Enable MyShop / LINE Shopping on your LINE OA (free).
2. As **Admin**, go to `oaplus.line.biz` → **Settings → API keys → Generate**.
3. Add the key to your config:
   - Single-OA: env `LINE_MYSHOP_API_KEY`
   - Multi-OA: `"myshop_api_key": "..."` per OA in `~/.line-mcp/config.json`

That's it — the shopping tools appear automatically once a key is present.

---

## 🖼️ Image hosting

LINE Shopping (like every image surface in this server) needs a **public HTTPS image URL** — there is no binary upload endpoint. Host product images on Cloudflare R2 / S3 / Cloudinary / ImageKit / `raw.githubusercontent.com`. Avoid Google Drive / Dropbox share links (they serve an HTML preview, not a direct image). See README → *Image hosting*.

---

## 🚫 Intentionally out of scope (v2.0)

- **Order webhook** — would require an always-on server. Use `line_list_orders` polling + a scheduled task instead.
- **Order Messaging API** — not self-serve (requires emailing LINE to enable).
- **Audience / MyCustomer API** — overlaps v1 audiences; deferred.

---

## 🛡️ Compatibility

- All **34 v1 tools** unchanged; **no breaking changes**.
- New client (`MyShopClient`) is fully separate from `LineClient` (different host + `X-API-KEY` auth + error envelope).
- TypeScript strict build passes; unit tests added for the client and key-resolution gate.

## 🔭 Architecture notes

- Base: `https://developers-oaplus.line.biz` · auth: `X-API-KEY` · errors: `{ code, message, info?, timestamp }`.
- Rate limit: 50 req/s, 1,000 req/min per resource (surfaced to agents).
- Schema verified against the live MyShop Swagger (Redoc 1.0.0) on 2026-06-03.
- Spec: [`docs/v2-shopping/PRD.md`](docs/v2-shopping/PRD.md) + [`docs/v2-shopping/TECH-SPEC.md`](docs/v2-shopping/TECH-SPEC.md).
