# เริ่มต้นใช้งานใน 5 นาที (Quickstart ภาษาไทย)

> สำหรับ marketer / SMB / agency / course creator ที่ใช้ LINE OA + อยากให้ AI ช่วยทำงาน

---

## สิ่งที่ต้องมี

1. **LINE Official Account** ที่เปิด Messaging API แล้ว
2. **Channel Access Token** (ดูวิธีดึงด้านล่าง)
3. **Claude Cowork** (หรือ Claude Code / Cursor / ChatGPT desktop / client อื่นที่รองรับ MCP)
4. **Node.js ≥ 20** (Cowork มีให้ในตัว — ไม่ต้องลงเอง)

---

## ขั้นตอน 5 นาที

### 1. ดึง Channel Access Token (2 นาที)

1. เข้า https://developers.line.biz/console/ → login ด้วยบัญชี LINE Business ของคุณ
2. เลือก **Provider** ของ OA นี้ → เลือก **channel** ประเภท Messaging API (ถ้ายังไม่มี ต้องสร้างก่อน)
3. ในหน้า channel — ไปที่ tab **Messaging API** → เลื่อนลงไปหา **Channel access token**
4. กดปุ่ม **Issue** เพื่อสร้าง token ใหม่ (อายุไม่จำกัด)
5. คัดลอก token เก็บไว้

> 🔐 อย่าโพสต์ token ลง git หรือ public chat — ทำให้คนอื่นส่ง broadcast ในนามคุณได้

### 2. เพิ่ม MCP เข้า Claude Cowork (1 นาที)

ใช้ทาง **stdio + Edit Config** ของ Cowork — เป็นทางมาตรฐาน ไม่ต้องรัน terminal ค้างไว้ และ **ไม่ต้อง clone repo หรือ build เอง** เพราะ `npx` จะดึง package จาก npm มารันให้อัตโนมัติ

1. เปิด **Cowork** → **Settings** (⚙️) → **Developer** → **Local MCP servers**
2. กด **Edit Config** — จะเปิด `claude_desktop_config.json` ใน editor
3. เพิ่ม entry `line` เข้าใน `mcpServers` object (อย่าลบของเดิม) — แทน `YOUR_TOKEN` ด้วย token จริง:

   ```json
   {
     "mcpServers": {
       "line": {
         "command": "npx",
         "args": ["-y", "line-oa-mcp-ultimate"],
         "env": {
           "LINE_CHANNEL_ACCESS_TOKEN": "YOUR_TOKEN"
         }
       }
     }
   }
   ```

4. **บันทึก** ไฟล์
5. **Restart Cowork** (ปิดทั้งแอปด้วย `⌘ + Q` แล้วเปิดใหม่) — รอบแรก `npx` จะดาวน์โหลด package จาก npm (ใช้เวลาสักครู่ ต้องมีอินเทอร์เน็ต) แล้ว cache ไว้ รอบต่อไปเปิดได้เร็ว จากนั้นเปิดหน้า Developer อีกครั้ง จะเห็น `line` พร้อม status `running`

### 3. ลองสั่งงาน Cowork (2 นาที)

ลองพิมพ์คำสั่งเหล่านี้ใน Cowork:

#### เช็คสถานะ OA
```
ดูสถานะ OA หน่อย
```
→ AI จะเรียก `line_get_oa_status` และแสดง:
- จำนวน friends
- Quota ที่เหลือ (เปอร์เซ็นต์)
- Webhook ทำงานอยู่หรือไม่
- Default Rich Menu

#### ออกแบบ Flex Voucher
```
ออกแบบคูปองส่วนลด 20% รหัส MOM20 หมด 31 ส.ค.
```
→ AI จะเรียก `line_design_flex` แล้ว return Flex JSON + ลิงก์ preview

#### สรุปยอดสัปดาห์ที่แล้ว
```
สรุปยอดสัปดาห์ที่แล้วให้หน่อย
```
→ AI จะเรียก `line_get_oa_report` รวม insights หลายตัว return markdown report

#### เตรียม broadcast พร้อม schedule
```
ออกแบบโปรวันแม่ ปุ่ม "ดูสินค้า" — เตรียมส่ง audience "mothers-day-buyers"
ตั้งเวลา 12 ส.ค. 09:00
```
→ AI:
1. ออกแบบ Flex (line_design_flex)
2. ตรวจ audience พร้อมส่ง (line_list_audiences)
3. สร้าง draft package (line_send_message mode: "draft") — return URL ของ LINE OA Manager + 6 ขั้นตอน paste ตั้งเวลา

---

## เคล็ดลับการใช้งาน

### ✅ Best practice

- **ก่อน broadcast ใหญ่** — เริ่มจาก `mode: "dry_run"` เพื่อ validate + estimate cost
- **Schedule ใน LINE OA Manager** ดีกว่า build เอง — LINE delivery reliability สูงกว่า + audit log อยู่ใน OA Manager
- **Quota Guardian** จะเตือนเองถ้าจะส่งเกิน 95% ของ quota — ใช้ `confirm: true` ถ้ายืนยัน
- **Quiet hours (22:00–08:00 BKK)** ถ้าจำเป็นต้องส่ง ใช้ `force: true` หรือ `quiet_push: true`

### ⚠️ ระวัง

- Reply token มีอายุ ~30 วินาที — ถ้า AI ช้าเกินไป tool จะ fallback เป็น push อัตโนมัติ (ใช้ quota +1)
- Narrowcast ต้องการ audience อย่างน้อย 50 คน — น้อยกว่านั้น LINE จะ reject
- Insight data มี T-2 lag — ข้อมูลของเมื่อวานอาจยังไม่ครบ 100%
- Audience ที่สร้างใหม่ต้องรอ ~10 นาที ก่อนใช้ส่งได้

---

## ถ้าติดปัญหา

1. **"missing LINE_CHANNEL_ACCESS_TOKEN"** — ตรวจสอบว่าใส่ token ใน env แล้ว
2. **LINE 401 Unauthorized** — token หมดอายุหรือผิด → re-issue ที่ LINE Developers Console
3. **LINE 403 Forbidden** — บาง feature (narrowcast, follower IDs) ต้อง premium OA หรือใช้ได้เฉพาะ TH/JP/TW
4. **Webhook test ไม่ผ่าน** — ใช้ `line_test_webhook` ดู reason ที่ LINE return
5. **Audience ใช้ไม่ได้** — เช็ค status ด้วย `line_list_audiences` ต้องเป็น `READY`

---

## ต่อยอด

- ตั้ง config multi-OA (สำหรับ agency หรือคนมีหลาย OA) — ดู [`multi-oa-setup-th.md`](multi-oa-setup-th.md)
- รัน MCP แบบ HTTP / self-hosted — ดู [`http-transport.md`](http-transport.md)
- รายงาน issue / feature request ที่ [GitHub](https://github.com/wasintoh/line-oa-mcp-ultimate/issues)
