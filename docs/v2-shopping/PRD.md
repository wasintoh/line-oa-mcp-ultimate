# PRD — LINE OA MCP Ultimate v2.0 "Shopping"

> **Status:** Approved for build (2026-06-03)
> **Owner:** Dr. Wasin Treesinthuros (พี่โต)
> **Target version:** `2.0.0` (additive, non-breaking on v1.1.0)

---

## 1. Vision (หนึ่งย่อหน้า)

v1 ทำให้ AI agent **คุยกับลูกค้า** ผ่าน LINE OA ได้ (broadcast, rich menu, flex, coupon). v2 ทำให้ AI agent **ขายของและจัดการร้าน** ได้ในที่เดียวกัน — โดยเชื่อม **LINE Shopping (MyShop Open API)** เข้ามา ผู้ใช้สั่งงานเป็นภาษาธรรมชาติเพื่อจัดการสินค้า สต็อก ออเดอร์ ออกใบปะหน้าพัสดุ ดูเงินเข้า และสร้างลิงก์จ่ายเงิน (checkout link) — ครบวงจร chat-commerce บน host ที่ตัวเองชอบ (Cowork / Claude Code / Cursor ฯลฯ) โดย **ไม่ต้องมี server, ไม่ต้องตั้ง webhook, ไม่กระทบฟีเจอร์ v1 เดิมแม้แต่นิดเดียว**

## 2. ทำไมต้องทำ (Why now)

- LINE Shopping (MyShop) เป็น **public self-serve API ฟรี** ตั้งแต่ 31 พ.ค. 2023 (โดย LY Corporation) — ไม่ต้องขออนุมัติสำหรับร้านตัวเอง
- Auth ง่ายมาก: static `X-API-KEY` header ตัวเดียว → map เป็น MCP tool ได้ตรงๆ
- เติมเต็มช่องว่างที่ใหญ่ที่สุดของ v1: v1 จบที่ "สื่อสาร" แต่ commerce จริงอยู่ที่ "จัดการร้าน + ปิดการขาย" — **Checkout Link** เปลี่ยน MCP จากเครื่องมือหลังบ้าน → เครื่องมือปิดการขายในแชท
- README roadmap เขียน v2.x ไว้แล้ว — ตรงแผนเดิม

## 3. Scope — 13 Tools (MyShop API ครบ 21 endpoints)

ใช้ **API key อย่างเดียว** ทุกตัวเป็น request-response (pull) — ไม่มี webhook/server

### 🛍️ Products (7 tools → 9 endpoints)

| Tool | Endpoint(s) |
|---|---|
| `line_list_products` | GET /products |
| `line_create_product` | POST /products |
| `line_update_product` | PATCH /products/{id} |
| `line_delete_product` | DELETE /products/{id} |
| `line_update_product_price` | PATCH /products/{id}/prices |
| `line_set_product_visibility` | POST /products/{id}/display-status/{onsale\|hide} |
| `line_manage_product_variant` | POST /variants, PATCH /variant, POST /delete-variant-option |

### 📦 Inventory (1 tool → 3 endpoints)

| `line_manage_inventory` | PUT /inventory/{id}/{adjust\|increase\|decrease} |
|---|---|

### 🧾 Orders (4 tools → 7 endpoints)

| Tool | Endpoint(s) |
|---|---|
| `line_list_orders` | GET /orders (รองรับ polling ผ่าน startAt/endAt/status) |
| `line_get_order` | GET /orders/{orderNo} |
| `line_fulfill_order` | POST /mark-as-ship, POST /mark-as-paid, PUT /shipments, POST /parcel-label |
| `line_cancel_order` | PUT /orders/{orderNo}/cancel |

### 💰 Settlement + 🔗 Checkout (1 tool → 2 endpoints)

| Tool | Endpoint |
|---|---|
| `line_get_settlement` | GET /settlements/{orderNo} |
| `line_create_checkout_link` | POST /checkout-link |

> **หมายเหตุ:** Orders รวม fulfill 4 endpoint ไว้ใน tool เดียว (`line_fulfill_order` mode: ship/paid/tracking/label) เพื่อลดจำนวน tool ที่ผู้ใช้เห็น — รวมเป็น **13 tools** พอดี

## 4. Non-Goals (ตั้งใจไม่ทำใน v2.0)

- ❌ **Order Webhook** — ต้องมี server 24/7 ขัดกับ opensource ที่ติดตั้งง่าย → ใช้ **polling** (`line_list_orders` + Scheduled Task) แทน
- ❌ **Order Messaging API** — ต้องอีเมลขอเปิดแยก (ไม่ self-serve) → เลื่อนไป v2.x+
- ❌ **Audience/MyCustomer API (oaplus)** — overlap กับ audience tools เดิมของ v1 → เลื่อน
- ❌ **Image upload helper** — MyShop รับแค่ image URL (ไม่มี binary upload endpoint) → v2.0 รับ URL, optional uploader ไว้ v2.1

## 5. Users & Use cases

- **SMB / แม่ค้าออนไลน์** ที่ใช้ LINE Shopping → "เช็คออเดอร์เช้านี้ ออกใบปะหน้าให้ที่จ่ายแล้ว", "สินค้าไหนสต็อกใกล้หมด"
- **AI-first marketer** → "ลูกค้าอยากได้ 2 ชิ้น สร้างลิงก์จ่ายเงิน", "ลดราคาคอลเลกชันนี้ 15%"
- **Agency** → multi-OA เดิม + ลูกค้าแต่ละรายใส่ MyShop key ของตัวเอง

## 6. Prerequisites (ผู้ใช้ต้องเตรียม)

1. LINE OA + เปิด MyShop / LINE Shopping (ฟรี)
2. **MyShop API Key** — Admin role → oaplus.line.biz → Settings → API keys → Generate (คนละตัวกับ Channel Access Token)
3. ใส่ key ใน config: `myshop_api_key` ต่อ OA หรือ env `LINE_MYSHOP_API_KEY`

## 7. Success Criteria

- [ ] ผู้ใช้ที่มี MyShop key สั่งจัดการสินค้า/ออเดอร์/checkout ได้ครบผ่านภาษาธรรมชาติ
- [ ] ผู้ใช้ที่**ไม่มี** MyShop key ใช้ v1 ได้เหมือนเดิมเป๊ะ — shopping tools ไม่โผล่/ไม่ error (graceful degradation)
- [ ] `pnpm build`, `pnpm type-check`, `pnpm test` ผ่านทั้งหมด
- [ ] 34 tools เดิมไม่ถูกแตะ
- [ ] README มี Shopping section + Image Hosting Guide

## 8. Constraints (จาก Swagger จริง — verified 2026-06-03)

- Base URL: `https://developers-oaplus.line.biz`
- Auth: header `X-API-KEY` (สูงสุด 10 keys/ร้าน); แนะนำใส่ `User-Agent`
- Error envelope: `{ code, message, info?, timestamp }` (code enum: BAD_REQUEST, DATA_CONFLICT, INTERNAL_ERROR, NOT_FOUND, PERMISSION_DENIED, UNAUTHORIZED)
- Rate limit: **50 req/s, 1,000 req/min** ต่อ resource (เกิน → 429)
- region: Thailand-only (payment: BANK/COD/RLP)
- **เชื่อมได้เฉพาะ seller profile ตัวเอง** — multi-tenant ผ่าน partner profile ยังไม่เปิด (ต้องสมัคร Official Partner Program) → โมเดล "ลูกค้าใส่ key ตัวเอง" ของเราอยู่ฝั่งทำได้ทันที
