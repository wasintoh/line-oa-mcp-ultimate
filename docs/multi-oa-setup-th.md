# ตั้งค่าหลาย OA (Multi-OA)

> มี OA ตัวเดียว? ใช้ env `LINE_CHANNEL_ACCESS_TOKEN` พอ — ดู [`quickstart-th.md`](quickstart-th.md)
> ไฟล์นี้สำหรับคนที่มีหลาย OA (เช่น agency) อยากสลับใช้ได้ง่ายผ่าน config ไฟล์เดียว

---

## วิธีตั้งค่า

เก็บ token ของทุก OA ไว้ใน JSON ไฟล์เดียวที่ `~/.line-mcp/config.json` — server หาเจอเองอัตโนมัติ ไม่ต้องตั้ง env เพิ่ม

```bash
mkdir -p ~/.line-mcp
nano ~/.line-mcp/config.json      # หรือ: code ~/.line-mcp/config.json
```

ใส่เนื้อหาแบบนี้ (ก๊อปจาก [`config.example.json`](../config.example.json) ใน repo ได้เลย):

```json
{
  "default_oa": "main",
  "oas": {
    "main": {
      "channel_access_token": "TOKEN_ของ_OA_หลัก",
      "display_name": "My Main OA",
      "region": "TH",
      "myshop_api_key": "MYSHOP_KEY_ถ้าจะใช้_LINE_Shopping"
    },
    "shop_2": {
      "channel_access_token": "TOKEN_ของ_OA_ที่สอง",
      "display_name": "Second OA"
    }
  }
}
```

> `id` ของแต่ละ OA (เช่น `main`, `shop_2`) ตั้งชื่อเองได้ — ใช้อ้างอิงตอนสลับด้วย `line_use_oa`

---

## ต่อเข้า Cowork

**Cowork → Settings ⚙️ → Developer → Local MCP servers → Edit Config** แล้วใส่ (ไม่ต้องมี env เลย):

```json
{
  "mcpServers": {
    "line": {
      "command": "npx",
      "args": ["-y", "line-oa-mcp-ultimate"]
    }
  }
}
```

บันทึก แล้ว **restart Cowork** (`⌘ + Q` เปิดใหม่) — server อ่าน `~/.line-mcp/config.json` ให้เอง

> 💡 อยากเก็บไฟล์ config ไว้ที่อื่น (เช่นใน folder โปรเจค)? เพิ่ม `"env": { "LINE_MCP_CONFIG": "/path/เต็ม/ของไฟล์.json" }` ชี้ path เอง

---

## Field ในไฟล์ config

**บังคับ:**
- `default_oa` — id ของ OA ที่เป็น default
- `oas[id].channel_access_token` — token ของ OA นั้น (จาก LINE Developers Console)

**ไม่บังคับ:**
- `display_name` — ชื่อโชว์ใน `line_list_oas`
- `region` — `TH` / `JP` / `TW` / `ID` / `OTHER`
- `is_premium` — flag สำหรับ feature ที่ต้องใช้ Premium OA
- `myshop_api_key` — **(v2.0)** ใส่เพื่อเปิด LINE Shopping tools ให้ OA นั้น (จาก oaplus.line.biz → Settings → API keys, Admin role) ไม่ใส่ = messaging อย่างเดียว

---

## สั่งงานหลาย OA ใน Cowork

```
"ดู OA ทั้งหมด"              → line_list_oas (แสดงทุก OA + ตัวที่ active)
"สลับไป shop_2"             → line_use_oa({ oa_id: "shop_2" })
"ส่งข้อความ ... ใน OA main"   → ใส่ param oa: "main" เฉพาะครั้งนั้น
"ส่ง broadcast ไปทุก OA"     → line_run_on_many_oas (รัน read-only ทุก OA พร้อมกัน)
```

---

## ⚠️ Security

- `~/.line-mcp/config.json` อยู่ใน home directory นอก repo — ไม่เสี่ยงติด git (ถ้าเก็บไว้ที่อื่นในโปรเจค ต้องเพิ่มใน `.gitignore`)
- **ห้ามเปิดไฟล์ config ตอน share screen / demo** — ในนั้นมี token จริงของทุก OA
- ใช้โหมด HTTP หลายคน/หลาย agent → **1 instance ต่อ 1 agent** เพราะร้านที่สลับด้วย `line_use_oa` เป็นค่าร่วมกันทั้ง instance — รายละเอียดที่ [security-th.md](security-th.md) ข้อ 6.4
- token re-issue ได้ที่ LINE Developers Console — ถ้าสงสัยว่าหลุด re-issue ทันที (ตัวเก่าใช้ไม่ได้ทันที)
- เปลี่ยน config แล้วต้อง **restart Cowork** (`⌘ + Q`) ทุกครั้ง
