# ทดสอบ build local ใน Claude Cowork (v2.1)

> เทสโค้ดในเครื่องก่อน publish ขึ้น npm — ชี้ Cowork ไปรัน `dist/index.js` ในเครื่อง
> แทน package จาก npm (ตัวบน npm ยังเป็นเวอร์ชันเก่า ยังไม่มี LINE Shopping)

---

## ⚠️ 2 จุดที่พลาดบ่อย (อ่านก่อน)

1. **ใช้ `node dist/index.js` ไม่ใช่ `npx line-oa-mcp-ultimate`** — `npx` ดึงตัวเก่าจาก npm ต้องชี้ build ในเครื่อง
2. **shopping tools โผล่ก็ต่อเมื่อมี MyShop key** — ต้องใส่ `LINE_MYSHOP_API_KEY` ไม่งั้นเห็นแค่ messaging tools

---

## 1. Build ก่อน (ทุกครั้งหลังแก้โค้ด)

```bash
cd /Users/wasin/Dev/AboutME/line-oa-mcp-ultimate
npm run build
```

---

## 2. ตั้งค่า Cowork

เปิด **Cowork → Settings ⚙️ → Developer → Local MCP servers → Edit Config**
แก้ entry `line` ให้ใช้ `node` + path ของ `dist/index.js`:

```json
{
  "mcpServers": {
    "line": {
      "command": "node",
      "args": ["/Users/wasin/Dev/AboutME/line-oa-mcp-ultimate/dist/index.js"],
      "env": {
        "LINE_CHANNEL_ACCESS_TOKEN": "ใส่ token จริง",
        "LINE_MYSHOP_API_KEY": "ใส่ MyShop key จริง"
      }
    }
  }
}
```

**ถ้ามีหลาย OA** — ใช้ไฟล์ config แทน (ใส่ `myshop_api_key` ต่อ OA ในไฟล์ ดู [`multi-oa-setup-th.md`](multi-oa-setup-th.md)):

```json
"env": { "LINE_MCP_CONFIG": "/Users/wasin/Dev/AboutME/line-oa-mcp-ultimate/.line-mcp.local.json" }
```

---

## 3. Restart + ทดสอบ

1. **บันทึก** ไฟล์ config
2. ปิด Cowork ทั้งแอป (`⌘ + Q`) แล้วเปิดใหม่
3. หน้า Developer → ควรเห็น `line` status `running` — ถ้ามี MyShop key จะมี **49 tools** (35 messaging + 14 shopping), ถ้าไม่มีจะมี 35
4. ลองพิมพ์ใน Cowork:

   ```
   ดูสินค้าทั้งหมด                              → line_list_products
   มีออเดอร์อะไรบ้างวันนี้ สรุปให้หน่อย          → line_list_orders
   ลูกค้าอยากได้ variant V9 2 ชิ้น สร้างลิงก์จ่ายเงิน  → line_create_checkout_link
   ```

---

## เกร็ด

- **`node` หาไม่เจอ?** ใส่ absolute path (หาจาก `which node`) เช่น `"command": "/opt/homebrew/bin/node"`
- **แก้โค้ดแล้วต้อง `npm run build` ใหม่ + restart Cowork ทุกครั้ง** — Cowork รัน `dist/` ไม่ใช่ `src/`
- **shopping tools ไม่โผล่?** เช็คว่าใส่ `LINE_MYSHOP_API_KEY` แล้ว + ร้านเปิด LINE Shopping แล้ว
- **กลับไปใช้ตัว npm:** เปลี่ยน `command`/`args` กลับเป็น `"npx"` / `["-y", "line-oa-mcp-ultimate"]`
