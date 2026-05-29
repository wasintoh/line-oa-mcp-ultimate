# ตั้งค่า Multi-OA (สำหรับ agency หรือคนมีหลาย OA)

> ถ้าพี่โตมี OA ตัวเดียว — ใช้ env var `LINE_CHANNEL_ACCESS_TOKEN` ก็พอ (ดู `quickstart-th.md`). ไฟล์นี้สำหรับคนที่มีหลาย OA และอยากให้ AI สลับใช้ได้ง่ายๆ

---

## เลือก 1 จาก 2 ทาง

### ทาง A — เก็บ config ใน repo (ใช้ที่ผมสร้างได้เลย) ⭐ แนะนำสำหรับ test

**ไฟล์ที่สร้างไว้แล้ว:** `~/Dev/AboutME/line-mcp-server/.line-mcp.local.json`

ไฟล์นี้:
- ✅ อยู่ใน .gitignore แล้ว — ไม่ติด commit (ปลอดภัย)
- ✅ อยู่ใน folder เดียวกับ code — เห็น + edit ใน Cowork ได้ตลอด
- ✅ ไม่ต้องสร้าง folder ใหม่ใน home

**ขั้นตอน:**

1. เปิด `~/Dev/AboutME/line-mcp-server/.line-mcp.local.json`
2. แทน `PASTE_YOUR_MAIN_LINE_TOKEN_HERE` ด้วย token จริงของแต่ละ OA
3. ลบ block ของ OA ที่ไม่ใช้ออก (เช่น forgeai ถ้ายังไม่มี)
4. แก้ `default_oa` เป็น OA ที่จะใช้บ่อยที่สุด
5. บันทึก

**Cowork config:**

```json
{
  "mcpServers": {
    "line": {
      "command": "node",
      "args": ["/Users/wasin/Dev/AboutME/line-mcp-server/dist/index.js"],
      "env": {
        "LINE_MCP_CONFIG": "/Users/wasin/Dev/AboutME/line-mcp-server/.line-mcp.local.json"
      }
    }
  }
}
```

Restart Cowork → ใช้ได้เลย

---

### ทาง B — Copy ไป home directory (มาตรฐาน production)

**ขั้นตอน:**

```bash
# 1. สร้าง folder (ครั้งเดียว)
mkdir -p ~/.line-mcp

# 2. Copy template
cp ~/Dev/AboutME/line-mcp-server/config.example.json ~/.line-mcp/config.json

# 3. แก้ token ใน editor
open ~/.line-mcp/config.json
# (หรือ code ~/.line-mcp/config.json ถ้าใช้ VS Code)
```

**Cowork config (สั้นกว่า — ไม่ต้องใส่ env var):**

```json
{
  "mcpServers": {
    "line": {
      "command": "node",
      "args": ["/Users/wasin/Dev/AboutME/line-mcp-server/dist/index.js"]
    }
  }
}
```

Server จะอ่าน `~/.line-mcp/config.json` อัตโนมัติ (ทาง standard ของ MCP servers ทั่วไป)

---

## รูปแบบ config

```json
{
  "default_oa": "main",          // ← ID ของ OA ที่ใช้เป็น default
  "oas": {
    "main": {                     // ← ID ที่พี่โต set เอง (ใช้สลับด้วย line_use_oa)
      "channel_access_token": "...", // จาก LINE Developers Console
      "channel_secret": "...",       // (optional) สำหรับ webhook signature
      "display_name": "...",         // (optional) แสดงใน Cowork
      "region": "TH",                // (optional) TH/JP/TW/ID/OTHER
      "is_premium": false            // (optional) มีผลกับ feature ที่ใช้ premium-only
    },
    "client_a": { ... },
    "client_b": { ... }
  }
}
```

### Field ที่บังคับ
- `default_oa` (string) — ID ของ OA ที่จะเป็น default
- `oas[id].channel_access_token` (string) — token ของ OA นั้น

### Field ที่ optional (ใส่หรือไม่ก็ได้)
- `channel_secret` — ใช้กับ `line_test_webhook` + webhook signature verification (V2)
- `display_name` — โชว์ใน `line_list_oas` ให้อ่านสบาย
- `region` — บางส่วนของ LINE API gate by region (audience, follower IDs)
- `is_premium` — flag สำหรับ feature ที่ต้องใช้ premium OA

---

## ใช้ Multi-OA ใน Cowork

หลัง setup เสร็จ — ลองสั่ง Cowork:

```
"ดู OA ทั้งหมด"
→ Cowork เรียก line_list_oas → แสดงทุก OA + ตัวที่ active

"สลับไป client_a"
→ line_use_oa({ oa_id: "client_a" })
→ ตอนนี้ active OA = client_a

"ดูสถานะ"
→ line_get_oa_status — ใช้ client_a อัตโนมัติ

"ส่งข้อความให้ user X ใน OA innovation_vantage"
→ line_send_message({ target: { user_id: "..." }, message: { text: "..." }, oa: "innovation_vantage" })
→ ใช้ innovation_vantage แค่ครั้งนี้ ไม่กระทบ active OA

"ส่ง broadcast ปีใหม่ไปทุก OA"
→ line_run_on_many_oas({ tool: "...", oa_ids: "all" })
→ agency power feature — รัน parallel ทุก OA
```

---

## ⚠️ Security

- **ทาง A** (.line-mcp.local.json): ในวง `.gitignore` แล้ว — push ไม่ติด **แต่ระวังถ้า share screen ห้ามเปิดไฟล์**
- **ทาง B** (~/.line-mcp/config.json): อยู่ใน home directory — ไม่อยู่ใน repo เลย ปลอดภัยกว่า

ถ้าจะ publish ขึ้น git:
- ทาง A — ตรวจสอบว่า `.gitignore` มี `.line-mcp.local.json` (✅ ผมเพิ่มไว้แล้ว)
- ทาง B — ไม่มีไฟล์ใน repo เลย ปลอดภัย

---

## เปลี่ยน config โดยไม่ restart ได้ไหม?

ตอน V1 — **ไม่ได้** ต้อง restart MCP host (Cowork) ทุกครั้งที่แก้ config

V1.1 จะเพิ่ม `line_reload_config` tool — hot reload โดยไม่ต้อง restart
