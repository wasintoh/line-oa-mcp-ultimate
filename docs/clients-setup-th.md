# ติดตั้งใน AI Agent Tools ต่างๆ (Claude Code · Cursor · Codex)

> `line-oa-mcp-ultimate` เป็น MCP server ตัวเดียว ใช้ได้กับทุก host ที่รองรับ MCP — โค้ดตัวเดียวกัน, tool ชุดเดียวกัน (27 tools) ต่างกันแค่ "วิธีบอก host ให้รัน" และไฟล์ config คนละรูปแบบ

สำหรับ **Claude Cowork** ดู [`quickstart-th.md`](quickstart-th.md) · สำหรับ **Multi-OA** ดู [`multi-oa-setup-th.md`](multi-oa-setup-th.md)

---

## สิ่งที่ต้องมีก่อน (เหมือนกันทุก tool)

- **Node.js ≥ 20** ติดตั้งในเครื่อง + อยู่บน PATH (`node -v` เช็คได้)
- **Channel Access Token** ของ LINE OA (ดูวิธีดึงใน [`quickstart-th.md`](quickstart-th.md))
- ไม่ต้อง clone repo / ไม่ต้อง build — `npx` ดึง package จาก npm ให้เอง

---

## 1. Claude Code (CLI / VS Code extension)

วิธีที่ง่ายที่สุดคือใช้คำสั่ง `claude mcp add` (จะเขียน config ให้อัตโนมัติ):

```bash
claude mcp add line \
  --transport stdio \
  --env LINE_CHANNEL_ACCESS_TOKEN=YOUR_TOKEN \
  -- npx -y line-oa-mcp-ultimate
```

### เลือก scope ได้ 3 ระดับ

| Scope | flag | เก็บที่ไหน | ใช้เมื่อ |
|---|---|---|---|
| **local** (default) | ไม่ต้องใส่ | `~/.claude.json` (ผูกกับ path โปรเจค) | ใช้คนเดียว เครื่องเดียว โปรเจคเดียว |
| **user** | `--scope user` | `~/.claude.json` (global) | ใช้ทุกโปรเจคในเครื่องตัวเอง |
| **project** | `--scope project` | `.mcp.json` ใน root โปรเจค (commit ขึ้น git ได้) | แชร์ให้ทั้งทีม |

ตัวอย่าง project scope (แชร์ทีม — commit `.mcp.json` ได้):

```bash
claude mcp add line --scope project --transport stdio \
  --env LINE_CHANNEL_ACCESS_TOKEN=YOUR_TOKEN \
  -- npx -y line-oa-mcp-ultimate
```

### หรือเขียน `.mcp.json` เองตรงๆ

```json
{
  "mcpServers": {
    "line": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "line-oa-mcp-ultimate"],
      "env": { "LINE_CHANNEL_ACCESS_TOKEN": "YOUR_TOKEN" }
    }
  }
}
```

> ⚠️ ถ้าใช้ project scope แล้ว commit `.mcp.json` ขึ้น git **อย่าใส่ token จริง** — ใช้ `${LINE_CHANNEL_ACCESS_TOKEN}` แล้วตั้ง env ในเครื่องแทน หรือใช้ Multi-OA config ที่ gitignore ไว้

ตรวจ + จัดการ: `claude mcp list` (ดูสถานะ), `claude mcp remove line` (ถอน). project-scoped จาก `.mcp.json` จะขึ้น "⏸ Pending approval" จนกว่าจะ approve ในเซสชัน

---

## 2. Cursor

Cursor ใช้ไฟล์ JSON รูปแบบเดียวกับ Claude Desktop:

- **Global** (ทุกโปรเจค): `~/.cursor/mcp.json`
- **Project** (เฉพาะโปรเจคนี้): `.cursor/mcp.json` ใน root — ถ้าซ้ำกัน project ชนะ

```json
{
  "mcpServers": {
    "line": {
      "command": "npx",
      "args": ["-y", "line-oa-mcp-ultimate"],
      "env": { "LINE_CHANNEL_ACCESS_TOKEN": "YOUR_TOKEN" }
    }
  }
}
```

หรือผ่าน UI: **Settings → Features → MCP → Add** (กรอก Name = `line`, Transport = stdio, Command = `npx -y line-oa-mcp-ultimate`)

> ⚠️ **Tool limit ของ Cursor ~40 tools รวมทุก MCP** — `line-oa-mcp-ultimate` มี 27 tools ถ้าเปิด MCP อื่นพร้อมกันหลายตัวอาจชน limit ทำให้ AI เลือก tool แม่นยำลดลง ถ้าใช้ร่วมกับ MCP อื่นเยอะ แนะนำเปิดเฉพาะที่ใช้จริง

---

## 3. Codex (OpenAI Codex CLI / desktop)

Codex ใช้ **TOML** (ไม่ใช่ JSON!) ที่ `~/.codex/config.toml`

วิธีง่ายสุด — ใช้คำสั่ง CLI (เขียน TOML ให้เอง):

```bash
codex mcp add line --env LINE_CHANNEL_ACCESS_TOKEN=YOUR_TOKEN -- npx -y line-oa-mcp-ultimate
```

หรือเขียน `~/.codex/config.toml` เองตรงๆ:

```toml
[mcp_servers.line]
command = "npx"
args = ["-y", "line-oa-mcp-ultimate"]

[mcp_servers.line.env]
LINE_CHANNEL_ACCESS_TOKEN = "YOUR_TOKEN"
```

> 💡 จุดที่คนพลาดบ่อยใน Codex: ถ้า `npx` ไม่อยู่บน PATH ที่ Codex มองเห็น ให้ใส่ **absolute path** (เช่น `command = "/usr/local/bin/npx"`) และเพิ่ม `startup_timeout` ถ้า server เริ่มช้า

---

## Multi-OA (เหมือนกันทุก tool)

แทนที่จะใส่ `LINE_CHANNEL_ACCESS_TOKEN` ให้ชี้ไปไฟล์ config แทน — ใช้ env `LINE_MCP_CONFIG` ชี้ `~/.line-mcp/config.json` (ดู [`multi-oa-setup-th.md`](multi-oa-setup-th.md))

- **Claude Code / Cursor (JSON):** `"env": { "LINE_MCP_CONFIG": "/Users/you/.line-mcp/config.json" }`
- **Codex (TOML):** `[mcp_servers.line.env]` แล้ว `LINE_MCP_CONFIG = "/Users/you/.line-mcp/config.json"`

---

## ทำอะไรได้บ้าง — เหมือนกันทั้ง 3 tools

เพราะเป็น MCP server ตัวเดียวกัน ทุก host จึงได้ **27 tools + 4 resources + 7 prompts** ครบเท่ากัน เช่น `send_message` (broadcast/push/multicast), `design_flex`, `build_rich_menu`, `manage_coupon`, `get_oa_report`, audience tools, `emit_liff_code` ฯลฯ

ต่างกันแค่ **บริบทการใช้งานของ host**:

| Host | จุดเด่นเวลาใช้กับ LINE OA MCP |
|---|---|
| **Claude Cowork** | สั่งงานด้วยภาษาธรรมชาติแบบแชต — เหมาะ marketer / non-dev ทำ broadcast, รายงาน, แคมเปญ |
| **Claude Code / Codex** | อยู่ใน terminal/โปรเจค — เด่นตอน **dev LINE Mini App แล้วเทสได้เลย** เช่น generate LIFF code (`emit_liff_code`) → วางในโค้ด → สั่ง broadcast ทดสอบในเซสชันเดียว |
| **Cursor** | อยู่ใน IDE — เขียนโค้ด LINE integration พร้อมเรียก tool ตรวจ/ส่งจริงระหว่างพัฒนา ไม่ต้องสลับหน้าต่าง |

---

## MCP ต่างจากเชื่อม REST API ปกติยังไง

นี่คือหัวใจที่ทำให้ MCP ทรงพลัง:

| | เชื่อม REST API ปกติ | ผ่าน MCP (`line-oa-mcp-ultimate`) |
|---|---|---|
| **คนเรียก** | โค้ดที่คุณเขียนเอง | **AI agent เรียกเองด้วยภาษาธรรมชาติ** |
| **ต้องรู้ API spec ไหม** | ต้องอ่าน LINE API doc เอง | ไม่ต้อง — tool description บอก AI เอง |
| **เขียนโค้ด** | ต้องเขียน HTTP request, parse, handle error | ไม่ต้องเขียนโค้ดเลย |
| **Validation / quota / quiet-hours** | ต้องทำเอง | server ทำให้ (pre-flight validate, Quota Guardian, quiet-hours warning) |
| **Thai templates / sticker / festival** | สร้างเอง | มีให้พร้อม (Flex templates, sticker index, ปฏิทินเทศกาลไทย) |
| **เปลี่ยน host** | ผูกกับโค้ดที่เขียน | ย้าย config ก็ใช้ได้ทุก host (Cowork/Code/Cursor/Codex) |
| **เหมาะกับ** | ระบบ production ที่ flow ตายตัว | งานที่สั่งด้วย "เจตนา" + เปลี่ยนแปลงบ่อย + ให้ AI ตัดสินใจ |

**สรุปสั้นๆ:** REST API คือ "ท่อ" ที่โปรแกรมเมอร์ต่อเอง — MCP คือ "ท่อที่ AI ใช้เป็น" เพราะมาพร้อม schema + คำอธิบายให้ LLM เลือก tool และกรอก argument ได้เอง คุณเลยสั่งงานด้วยภาษาคนแทนการเขียนโค้ด และ logic ความปลอดภัย (validate, quota, quiet-hours) ถูกฝังใน server ครั้งเดียว ใช้ซ้ำได้ทุก host

> MCP **ไม่ได้มาแทน** REST API — ข้างใน MCP server ตัวนี้ก็เรียก LINE REST API นั่นแหละ แต่มันห่อด้วยชั้นที่ "AI เข้าใจและใช้เองได้" ทำให้คุณข้ามขั้นเขียน integration code ไปเลย

---

## Troubleshooting (รวมทุก tool)

- **server ไม่ขึ้น / tool ไม่โผล่** → เช็ค `node -v` ≥ 20 และ `npx` อยู่บน PATH; ลองใส่ absolute path ของ `npx`
- **`missing LINE_CHANNEL_ACCESS_TOKEN`** → env ไม่ถูกส่งเข้า server (เช็ครูปแบบ env ของ host แต่ละตัว — Codex ต้องอยู่ใน `[mcp_servers.line.env]`)
- **LINE 401** → token หมดอายุ/ผิด → re-issue ที่ LINE Developers Console
- **เปลี่ยน config แล้วไม่อัปเดต** → restart host (Cowork/Cursor ปิด-เปิด, Claude Code เริ่ม session ใหม่)
- **อยาก pin เวอร์ชัน** → ใช้ `line-oa-mcp-ultimate@1.0.4` แทน `line-oa-mcp-ultimate` เฉยๆ
