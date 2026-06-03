# Release checklist — v1.0.4

รันทีละขั้นจาก root ของ repo:

```bash
cd /Users/wasin/Dev/AboutME/line-oa-mcp-ultimate
```

---

## 0) Pre-flight — build + test ให้เขียวก่อน

```bash
npm install          # ให้ native binaries ตรงกับ Mac (เผื่อ vitest/rollup)
npm run build        # tsc -> dist (ต้อง exit 0)
npm test             # vitest: tests/coupon-body.test.ts ต้องผ่านทั้งหมด
```

> ถ้า `npm test` ฟ้อง `@rollup/rollup-*` หาย → `rm -rf node_modules package-lock.json && npm install` แล้วรันใหม่ (เป็นบั๊ก optional deps ของ npm ไม่เกี่ยวกับโค้ด)

---

## 1) Stage + review

```bash
git status
git add -A
git status          # ยืนยันว่าไฟล์ที่ stage ถูกต้อง ไม่มีไฟล์หลุด
```

ไฟล์ที่ควรเห็น: `package.json` `package-lock.json` `src/constants.ts` `src/line/client.ts`
`src/tools/manage-coupon.ts` `src/tools/send-message.ts` `README.md`
`docs/http-transport.md` `docs/clients-setup-th.md` `docs/cowork-local-test-th.md`
`docs/release-v1.0.4-steps.md` `RELEASE_NOTES_v1.0.4.md` `tests/coupon-body.test.ts`

---

## 2) Commit

```bash
git commit -m "fix(coupon): correct create schema + list pager; feat(send): native coupon message" -m "
- coupon create maps to POST /v2/bot/coupon (reward, acquisitionCondition,
  startTimestamp/endTimestamp in UNIX seconds, timezone, visibility, maxUseCountPerTicket)
- coupon list reads pager 'items' (was 'coupons' -> always returned 0)
- surface LINE error details[] in line_manage_coupon
- send_message: new { coupon_id, delivery_tag } shape -> LINE coupon message object
- add tests/coupon-body.test.ts (15 assertions)
- bump 1.0.3 -> 1.0.4; update README + docs
"
```

---

## 3) Tag

```bash
git tag -a v1.0.4 -m "v1.0.4 — coupon create/list fixes + native coupon message"
```

---

## 4) Push (code + tag)

```bash
git push origin main
git push origin v1.0.4
```

---

## 5) Publish to npm

```bash
npm whoami           # ถ้าไม่ได้ login -> npm login
npm publish          # prepublishOnly จะ clean+build ให้อัตโนมัติ
```

ตรวจว่าขึ้นแล้ว:

```bash
npm view line-oa-mcp-ultimate version    # ควรได้ 1.0.4
```

---

## 6) GitHub Release

**ถ้ามี GitHub CLI:**

```bash
gh release create v1.0.4 \
  --title "v1.0.4 — Coupon fixes + native coupon message" \
  --notes-file RELEASE_NOTES_v1.0.4.md
```

**ถ้าไม่มี gh (ทำผ่านเว็บ):**
GitHub repo → **Releases** → **Draft a new release** → เลือก tag `v1.0.4` →
Title: `v1.0.4 — Coupon fixes + native coupon message` →
วางเนื้อหาจาก `RELEASE_NOTES_v1.0.4.md` → **Publish release**

---

## 7) Post-publish — กลับ Cowork ไปใช้ตัว npm

ใน `claude_desktop_config.json` เปลี่ยน entry `line` กลับเป็น:

```json
"line": {
  "command": "npx",
  "args": ["-y", "line-oa-mcp-ultimate@1.0.4"],
  "env": { "LINE_CHANNEL_ACCESS_TOKEN": "YOUR_TOKEN" }
}
```

แล้ว `⌘Q` restart Cowork → ทดสอบ `สร้าง coupon ...` อีกครั้งบนตัว published

> เสร็จแล้วลบ coupon ทดสอบได้ด้วย: `line_manage_coupon { "mode":"discontinue", "coupon_id":"01KT1STJY01FXSJ7RDAPHAGN6V", "confirm": true }`
