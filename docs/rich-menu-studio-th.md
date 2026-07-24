# Rich Menu Studio — ออกแบบ Rich Menu สวยระดับมืออาชีพ ด้วยคำสั่งเดียว (v2.1)

`line_design_rich_menu_image` เปลี่ยน "ไอเดียเมนู" ให้กลายเป็น Rich Menu จริงบน LINE OA
โดยไม่ต้องเปิดโปรแกรมออกแบบ ไม่ต้องจ้างกราฟิก ไม่ต้องมี Chromium/headless browser —
ตัวเรนเดอร์เป็น pure JavaScript (satori → SVG → resvg → PNG) และจัดตัวอักษรไทยแบบถูกต้อง
100% (วรรณยุกต์ซ้อนสระบน เช่น "ชั่น", "ดื่ม", "ซื้อ" ไม่หาย ไม่เพี้ยน)

จุดที่เหนือกว่าการทำมือ / เครื่องมืออื่น:

- **ภาพกับพื้นที่กดตรงกัน 100% ตลอดไป** — พิกัด cell ที่ใช้วาดภาพ กับ `areas` ที่ส่งให้
  LINE มาจากตัวเลขชุดเดียวกันใน template ไม่มีทาง "กดปุ่มแล้วไปผิดช่อง"
- **Preview ก่อนเสมอ** — agent เห็นรูป PNG จริงก่อน แล้วค่อยตัดสินใจ deploy
- **ฟอนต์ไทยระดับแบรนด์** — LINE Seed Sans TH (หน้าตาเดียวกับแอป LINE), Prompt,
  Noto Sans Thai หรือไฟล์ฟอนต์ของร้านเอง
- **สีตัวอักษรอ่านออกเสมอ** — ระบบคำนวณ contrast อัตโนมัติ ตั้งค่าสีขาวบนพื้นขาวมา
  ระบบก็แก้ให้เอง และสีตัวอักษรสม่ำเสมอทั้งเมนู (ไม่มีแถวบนดำ-แถวล่างขาว)

---

## Template ทั้งหมด (9 แบบ)

| template | ขนาด | จำนวนปุ่ม | เหมาะกับ |
|---|---|---|---|
| `grid_6` | 2500×1686 | 6 (3×2) | เมนูหลักคลาสสิกของ LINE OA — ตัวเด่นที่สุด |
| `grid_4` | 2500×1686 | 4 (2×2) | เมนูหลักแบบปุ่มใหญ่ กดง่าย |
| `hero_top_3` | 2500×1686 | 4 | แบนเนอร์โปรใหญ่ด้านบน + 3 ปุ่มล่าง |
| `hero_left_2` | 2500×1686 | 3 | ภาพ/แคมเปญครึ่งซ้าย + 2 ปุ่มขวา |
| `split_2` | 2500×1686 | 2 | สองทางเลือกใหญ่ (เช่น "สั่งซื้อ" / "ติดต่อ") |
| `full_1` | 2500×1686 | 1 | แบนเนอร์แคมเปญเดียวเต็มจอ |
| `compact_3` | 2500×843 | 3 (1×3) | เมนูแถวเดียว ประหยัดพื้นที่แชท |
| `compact_2` | 2500×843 | 2 (1×2) | สองปุ่มแถวเดียว |
| `compact_1` | 2500×843 | 1 | แถบแคมเปญเดี่ยว |

ปกติ **ไม่ต้องส่ง `size`** — ระบบรู้ขนาดจาก template เอง (ส่งมาขัดกันจะได้ error ภาษาไทย)

## Brand kit (`brand`)

| field | ความหมาย |
|---|---|
| `primary` | สีหลักของแบรนด์ (hex) — default เขียวอมเทา `#0E6B54` |
| `accent` | สีรอง ใช้กับแถบเน้น (style `outline`) — default เหลืองทอง `#FFC24B` |
| `text` | สีตัวอักษรที่อยากได้ — ถ้าอ่านไม่ออกบนพื้นจริง ระบบเปลี่ยนให้อัตโนมัติ |
| `font` | `"line-seed"` (default) / `"prompt"` / `"noto"` |
| `font_path` | path เต็มไปยัง .ttf/.otf ของร้านเอง (ชนะ `font`) |
| `logo_url` | โลโก้ (HTTPS) แสดงใน cell แรก |
| `style` | `"gradient"` (default) / `"solid"` / `"outline"` (พื้นขาว+แถบสี) / `"glass"` (การ์ดโปร่งบน gradient) |

ต่อ cell: `label` (บังคับ), `sublabel`, `icon_emoji` (แสดงเป็นไอคอนคมชัดผ่าน twemoji),
`bg` (สีพื้นเฉพาะช่อง), `image_url` (รูปถ่ายเป็นพื้นหลังช่อง), `action`

## 3 โหมด

1. **`preview`** (default) — เรนเดอร์ PNG แล้วส่งกลับเป็นรูปในคำตอบ (agent มองเห็นจริง)
   → ดูรูป ปรับ แก้ จนพอใจ **ก่อน** ขึ้นระบบเสมอ
2. **`save`** — บันทึกไฟล์ PNG ลงเครื่อง (`output_path`, default `./rich-menu-<template>.png`)
3. **`deploy`** — ครบวงจร: เรนเดอร์ → ตรวจข้อจำกัด LINE (ขนาดตรงเป๊ะ, PNG < 1MB —
   ถ้าเกินระบบเรนเดอร์ใหม่แบบ solid ให้อัตโนมัติ) → สร้าง rich menu → อัปโหลดรูป →
   (option) ตั้ง default → (option) ตั้ง alias — **ถ้าพลาดขั้นไหนหลังสร้างเมนู ระบบลบเมนู
   ที่ค้างให้ทันที ไม่มีเมนูกำพร้า**

ทุก cell ต้องมี `action` ก่อน deploy (`uri` / `message` / `postback`)

---

## ตัวอย่างที่ 1 — ร้านกาแฟ สะสมแต้ม (grid_6)

```json
{
  "template": "grid_6",
  "chat_bar_text": "เมนูร้าน",
  "brand": { "primary": "#06C755", "style": "gradient", "font": "line-seed" },
  "cells": [
    { "label": "สั่งเครื่องดื่ม", "sublabel": "โปรโมชั่นพิเศษวันนี้", "icon_emoji": "☕",
      "action": { "type": "uri", "uri": "https://shop.line.me/@cafe" } },
    { "label": "สะสมแต้ม", "sublabel": "ครบ 10 แก้วฟรี 1", "icon_emoji": "⭐",
      "action": { "type": "postback", "data": "loyalty", "display_text": "ดูแต้มของฉัน" } },
    { "label": "เมนูน้ำดื่มเย็นๆ", "sublabel": "ชา กาแฟ สมูทตี้", "icon_emoji": "🧋",
      "action": { "type": "message", "text": "ขอดูเมนูเครื่องดื่ม" } },
    { "label": "สั่งซื้อ / จัดส่ง", "sublabel": "ส่งฟรีเมื่อครบ 300.-", "icon_emoji": "🛵",
      "action": { "type": "message", "text": "สั่งเดลิเวอรี่" } },
    { "label": "ที่อยู่ร้าน", "sublabel": "เปิดทุกวัน 07:00-18:00", "icon_emoji": "📍",
      "action": { "type": "uri", "uri": "https://maps.app.goo.gl/xxxx" } },
    { "label": "คุยกับพนักงาน", "sublabel": "ตอบไวใน 5 นาที", "icon_emoji": "💬",
      "action": { "type": "message", "text": "ติดต่อพนักงาน" } }
  ],
  "mode": "deploy",
  "deploy": { "name": "เมนูหลัก ร้านกาแฟ 2026", "set_default": true }
}
```

> เรียกครั้งแรกด้วย `"mode": "preview"` (ตัด `deploy` ออก) ให้ลูกค้าดูรูปก่อนเสมอ

## ตัวอย่างที่ 2 — คลินิกจองคิว (hero_top_3)

```json
{
  "template": "hero_top_3",
  "chat_bar_text": "เมนูคลินิก",
  "brand": { "primary": "#7A3E8F", "accent": "#F2C94C", "style": "outline" },
  "cells": [
    { "label": "จองคิววันนี้", "sublabel": "รับส่วนลด 20% ทันที", "icon_emoji": "📅",
      "action": { "type": "uri", "uri": "https://liff.line.me/xxxx-booking" } },
    { "label": "บริการของเรา", "icon_emoji": "💉",
      "action": { "type": "message", "text": "ขอดูรายการบริการ" } },
    { "label": "รีวิวคนไข้", "icon_emoji": "⭐",
      "action": { "type": "uri", "uri": "https://clinic.example.com/reviews" } },
    { "label": "ติดต่อคลินิก", "icon_emoji": "📞",
      "action": { "type": "message", "text": "ติดต่อเจ้าหน้าที่" } }
  ],
  "mode": "preview"
}
```

cell แรกคือ hero (แบนเนอร์เต็มความกว้าง ฟอนต์ใหญ่กว่า) — เหมาะกับ call-to-action หลัก

## ตัวอย่างที่ 3 — ร้านค้าออนไลน์ + ลิงก์จ่ายเงิน MyShop (compact_3)

สร้างลิงก์ชำระเงินก่อนด้วย `line_create_checkout_link` แล้วเอา URL มาใส่ปุ่ม "สั่งซื้อ":

```json
{
  "template": "compact_3",
  "chat_bar_text": "ช้อปเลย",
  "brand": { "primary": "#12355B", "accent": "#FFC24B", "style": "glass" },
  "cells": [
    { "label": "สินค้าใหม่", "sublabel": "อัปเดตทุกสัปดาห์", "icon_emoji": "🛍️",
      "action": { "type": "uri", "uri": "https://shop.line.me/@myshop" } },
    { "label": "สั่งซื้อ", "sublabel": "จ่ายผ่าน LINE ได้เลย", "icon_emoji": "🛒",
      "action": { "type": "uri", "uri": "https://s.lmes.jp/checkout/xxxxx" } },
    { "label": "แจ้งส่งของ", "sublabel": "เช็คสถานะพัสดุ", "icon_emoji": "📦",
      "action": { "type": "postback", "data": "track_order", "display_text": "เช็คพัสดุของฉัน" } }
  ],
  "mode": "deploy",
  "deploy": { "name": "เมนูร้านค้า compact", "set_default": true, "alias": "shop-main" }
}
```

`alias` ใช้ต่อยอดทำเมนูแบบสลับแท็บ (`richmenuswitch`) ได้ — ถ้า alias มีอยู่แล้ว
ระบบอัปเดตให้ชี้เมนูใหม่แทน (ไม่ error)

---

## หมายเหตุ license ฟอนต์

- **Prompt** และ **Noto Sans Thai** — SIL Open Font License 1.1, bundle มากับ
  package นี้ (ไฟล์ license อยู่ที่ `assets/fonts/OFL-Prompt.txt` และ
  `assets/fonts/OFL-NotoSansThai.txt`)
- **LINE Seed Sans TH** — ตามประกาศที่ https://seed.line.me ฟอนต์เผยแพร่ภายใต้
  SIL Open Font License 1.1 (ใช้ส่วนตัว/การค้าได้ ห้ามนำไฟล์ฟอนต์ไปขายแยก) แต่ไฟล์
  zip ทางการ **ไม่มีไฟล์ license แนบมา** เราจึงเลือก **ไม่ redistribute** ฟอนต์ใน
  package นี้ — ระบบจะดาวน์โหลดจากแหล่งทางการ
  (`https://seed.line.me/src/images/fonts/LINE_Seed_Sans_TH.zip`) ครั้งแรกที่ใช้
  แล้ว cache ไว้ที่ `~/.line-mcp/fonts/` (สิทธิ์ 0700) — ดาวน์โหลดไม่ได้เมื่อไร
  ระบบ fallback เป็น Prompt พร้อมคำเตือนภาษาไทย งานเรนเดอร์ไม่มีวันล้มเพราะฟอนต์
