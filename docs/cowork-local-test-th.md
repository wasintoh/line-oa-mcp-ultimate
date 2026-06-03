# ทดสอบ build local ใน Claude Cowork (v1.0.4)

> ใช้ระหว่างพัฒนา/เทสก่อน publish ขึ้น npm — ชี้ Cowork ไปรัน `dist/index.js` ในเครื่อง
> แทน package จาก npm จะได้เทส fix ของ `line_manage_coupon` (v1.0.4) ได้เลย

ก่อนอื่น (ทำครั้งเดียวหลังแก้โค้ด):

```bash
cd /Users/wasin/Dev/AboutME/line-oa-mcp-ultimate
npm run build      # คอมไพล์ src → dist (ทำไปแล้วในเซสชันนี้)
```

---

## วิธีที่ 1 — แก้ entry เดิม (แนะนำ, ไม่ต้องกรอก token ใหม่)

เปิด **Cowork → Settings ⚙️ → Developer → Local MCP servers → Edit Config**
แล้วในentry `line` ที่มีอยู่ **เปลี่ยนแค่ `command` + `args`** (เก็บ `env`/token เดิมไว้):

```json
{
  "mcpServers": {
    "line": {
      "command": "node",
      "args": ["/Users/wasin/Dev/AboutME/line-oa-mcp-ultimate/dist/index.js"],
      "env": {
        "LINE_CHANNEL_ACCESS_TOKEN": "ใช้ token เดิมที่เคยใส่ไว้"
      }
    }
  }
}
```

> เดิมเป็น `"command": "npx", "args": ["-y", "line-oa-mcp-ultimate"]` → เปลี่ยนเป็น `node` + path ของ `dist/index.js` ตามด้านบน

---

## วิธีที่ 2 — เพิ่ม entry แยกชื่อ `line-local` (เก็บตัว npm ไว้สลับ)

```json
{
  "mcpServers": {
    "line-local": {
      "command": "node",
      "args": ["/Users/wasin/Dev/AboutME/line-oa-mcp-ultimate/dist/index.js"],
      "env": {
        "LINE_CHANNEL_ACCESS_TOKEN": "YOUR_TOKEN"
      }
    }
  }
}
```

> ถ้าใช้ Multi-OA อยู่แล้ว แทน `LINE_CHANNEL_ACCESS_TOKEN` ด้วย
> `"LINE_MCP_CONFIG": "/Users/wasin/.line-mcp/config.json"` ได้เลย

---

## หลังแก้ config

1. **บันทึก** ไฟล์
2. ปิด Cowork ทั้งแอป (`⌘ + Q`) แล้วเปิดใหม่
3. เปิดหน้า Developer → ควรเห็น `line` (หรือ `line-local`) status `running`
4. ทดสอบสร้างคูปองจริง — พิมพ์ใน Cowork:

   ```
   สร้าง coupon Early Bird คอร์สจารโต ลด 20% รหัส EARLYBIRD ใช้ได้ 1–8 มิ.ย. 2026
   ```

   หรือเรียก tool ตรงๆ:

   ```
   line_manage_coupon { "mode": "create", "data": {
     "title": "Early Bird คอร์สจารโต",
     "discount_type": "percentage", "discount_value": 20,
     "valid_from": "2026-06-01", "valid_to": "2026-06-08",
     "coupon_code": "EARLYBIRD"
   } }
   ```

5. ตรวจผล:
   - สำเร็จ → ได้ `✅ สร้าง coupon ... (id ...)` แล้วลอง `line_manage_coupon { "mode":"list" }` ดูว่ามีจริง
   - ถ้ายัง error → ตอนนี้จะเห็น **รายละเอียดทีละ field** (เพราะ v1.0.4 โชว์ `details[]` ของ LINE แล้ว) ส่งข้อความ error มาได้เลย

---

## เกร็ด

- **`node` หาไม่เจอ?** ใส่ absolute path ของ node แทน (หาได้จาก `which node` ใน terminal) เช่น `"command": "/opt/homebrew/bin/node"`
- **เปลี่ยนโค้ดแล้วต้อง build ใหม่ทุกครั้ง** (`npm run build`) + restart Cowork ถึงจะเห็นผล
- **กลับไปใช้ตัว npm:** เปลี่ยน `command`/`args` กลับเป็น `"npx"` / `["-y", "line-oa-mcp-ultimate"]`
- ✅ verify สดแล้ว (v1.0.4): create / get / list / ส่ง coupon message ผ่านครบกับ LINE API จริง — response ใช้ field `couponId` ถูกต้อง
