# ตั้งค่า Multi-OA (สำหรับ agency หรือคนมีหลาย OA)

> ถ้ามี OA ตัวเดียว — ใช้ env var `LINE_CHANNEL_ACCESS_TOKEN` ก็พอ (ดู [`quickstart-th.md`](quickstart-th.md)) ไฟล์นี้สำหรับคนที่มีหลาย OA และอยากให้ AI สลับใช้ได้ง่ายๆ ผ่าน config ไฟล์เดียว

---

## ภาพรวม

Multi-OA ทำงานด้วย **ไฟล์ config JSON ไฟล์เดียว** ที่เก็บ token ของทุก OA ไว้ แล้วชี้ให้ MCP server อ่านไฟล์นั้น จากนั้นจะสั่ง AI สลับ OA หรือระบุ OA ราย call ก็ได้

> 💡 ติดตั้งผ่าน `npx` เหมือน single-OA ทุกอย่าง — Multi-OA **ไม่ต้อง clone repo หรือ build เอง** ต่างกันแค่ "ใส่ token หลายตัวในไฟล์ config แทนที่จะใส่ token เดียวใน env var"

---

## เลือก 1 จาก 2 ทาง

### ทาง A — วางที่ `~/.line-mcp/config.json` (มาตรฐาน ⭐ แนะนำ)

server จะ **auto-discover** ไฟล์นี้เอง ไม่ต้องตั้ง env var เพิ่ม

```bash
# 1. สร้าง folder (ครั้งเดียว)
mkdir -p ~/.line-mcp

# 2. สร้าง + เปิดไฟล์ config (ใช้ editor ตัวไหนก็ได้)
nano ~/.line-mcp/config.json     # หรือ: code ~/.line-mcp/config.json
```

ใส่เนื้อหาตาม [รูปแบบ config](#รูปแบบ-config) ด้านล่าง แล้วบันทึก

**Cowork config (สั้นสุด — ไม่ต้องใส่ env var เลย):**

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

Restart Cowork (`⌘ + Q` แล้วเปิดใหม่) → server อ่าน `~/.line-mcp/config.json` อัตโนมัติ

---

### ทาง B — วางไฟล์ที่ไหนก็ได้ แล้วชี้ด้วย `LINE_MCP_CONFIG`

เหมาะถ้าอยากเก็บ config ไว้ใน folder โปรเจคของตัวเอง (เช่น vault ที่ sync/backup อยู่แล้ว)

**Cowork config:**

```json
{
  "mcpServers": {
    "line": {
      "command": "npx",
      "args": ["-y", "line-oa-mcp-ultimate"],
      "env": {
        "LINE_MCP_CONFIG": "/absolute/path/to/your/config.json"
      }
    }
  }
}
```

> แก้ `/absolute/path/to/your/config.json` เป็น path เต็มจริงของไฟล์ในเครื่องคุณ เช่น `/Users/yourname/line-config/oas.json`

Restart Cowork → ใช้ได้เลย

---

## รูปแบบ config

วางเป็น JSON ปกติ (ห้ามมี comment `//` ในไฟล์จริง — ที่อธิบายไว้ในตารางด้านล่างแทน):

```json
{
  "default_oa": "main",
  "oas": {
    "main": {
      "channel_access_token": "TOKEN_ของ_OA_หลัก",
      "display_name": "บริษัทหลัก",
      "region": "TH",
      "is_premium": false
    },
    "client_a": {
      "channel_access_token": "TOKEN_ของ_CLIENT_A",
      "display_name": "Client A — Bangkok Cafe",
      "region": "TH"
    },
    "client_b": {
      "channel_access_token": "TOKEN_ของ_CLIENT_B",
      "display_name": "Client B"
    }
  }
}
```

> 📄 ดูไฟล์ตัวอย่างพร้อมใช้ที่ [`config.example.json`](../config.example.json) ใน repo — ก๊อปไปเป็นจุดเริ่มต้นได้เลย

### Field ที่บังคับ

- `default_oa` (string) — ID ของ OA ที่จะเป็น default
- `oas[id].channel_access_token` (string) — token ของ OA นั้น (จาก LINE Developers Console)

### Field ที่ optional

- `channel_secret` — ใช้กับ `line_test_webhook` + webhook signature verification
- `display_name` — โชว์ใน `line_list_oas` ให้อ่านสบาย
- `region` — `TH` / `JP` / `TW` / `ID` / `OTHER` (บาง API gate by region เช่น audience, follower IDs)
- `is_premium` — flag สำหรับ feature ที่ต้องใช้ premium OA

> `id` ของแต่ละ OA (เช่น `main`, `client_a`) เป็นชื่อที่คุณตั้งเอง — ใช้อ้างอิงตอนสลับด้วย `line_use_oa`

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

"ส่งข้อความให้ user X ใน OA client_b"
→ line_send_message({ target: { user_id: "..." }, message: { text: "..." }, oa: "client_b" })
→ ใช้ client_b แค่ครั้งนี้ ไม่กระทบ active OA

"ส่ง broadcast ปีใหม่ไปทุก OA"
→ line_run_on_many_oas({ tool: "...", oa_ids: "all" })
→ agency power feature — รัน parallel ทุก OA (เฉพาะ tool แบบ read-only)
```

---

## ⚠️ Security

- **ทาง A** (`~/.line-mcp/config.json`): อยู่ใน home directory นอก repo — ไม่เสี่ยงติด git
- **ทาง B** (custom path): ถ้าวางไฟล์ไว้ในโปรเจคที่เป็น git repo **ต้องเพิ่ม path นั้นใน `.gitignore`** กัน token หลุดขึ้น git
- **ห้ามเปิดไฟล์ config ตอน share screen / demo** — ในนั้นมี token จริงของทุก OA
- ทุก token ดึง/เพิกถอนได้ที่ LINE Developers Console — ถ้าสงสัยว่าหลุด ให้ **re-issue ทันที** (ตัวเก่าจะใช้ไม่ได้ทันที)

---

## ลำดับที่ server ค้นหา config (resolution order)

ตัวบนชนะ:

1. `LINE_MCP_CONFIG` (path ที่ชี้เอง — ทาง B)
2. `~/.line-mcp/config.json` (auto-discover — ทาง A)
3. `LINE_CHANNEL_ACCESS_TOKEN` env var (fallback แบบ single-OA)

---

## เปลี่ยน config ต้อง restart ไหม?

ต้อง — แก้ไฟล์ config แล้วต้อง **restart Cowork** (`⌘ + Q` แล้วเปิดใหม่) ทุกครั้ง เพื่อให้ server โหลดค่าใหม่
