# line-oa-mcp-ultimate — v2 PRD (API Completeness)

> **Status:** APPROVED — building
> **Author:** คลอเดียจัง (พี่โต · Innovation Vantage · ForgeAI)
> **Target version:** v2.0.0
> **Methodology:** mcp-builder (Research → Implement → Review/Test → Evaluations)
> **Date:** 2026-06-02

---

## 0. Decision log (ทำไม v2 เป็นแบบนี้)

เดิม Roadmap เขียน v2 = "inbound companion (webhook, auto-reply, greeting, chat tags)" แต่หลัง deep-research + คุยเรื่อง target พบว่า:

1. **Target = แจก npx, สร้างแบรนด์** ให้ user ติดตั้งใน Cowork / Claude Code / Codex / Cursor / Antigravity / OpenClaw / Hermes ได้ง่าย → ต้องเป็น **stdio MCP บนเครื่อง user, token-only, ไม่ต้อง host อะไร**
2. **Webhook ขัดกับ npx-pure** — stdio MCP ไม่มี public URL → รับ webhook เองไม่ได้ → ต้องให้ user แบก server 24/7 = friction ที่ขัดจุดขาย → **ตัด inbound/webhook ออก (เลื่อนเป็น optional companion ภายหลัง ถ้าต้องการ)**
3. **auto-reply rules / greeting setter / chat tags = ไม่มี public API** (verified) → ตัดทิ้ง ไม่เก็บ config ลอยๆ ที่ไม่มีที่ทำงาน

**∴ v2 = "API Completeness Pack"** — เติม LINE Messaging API endpoints ที่ทำงานด้วย **channel access token อย่างเดียว** (ไม่ต้อง webhook, ไม่ต้อง host) ที่ v1 ยังขาด ให้ MCP สมบูรณ์ตาม API ที่มีจริง

---

## 1. Principles (ห้ามหลุด)

- **Token-only:** ทุก tool ทำงานด้วย `channel_access_token` ผ่าน LINE API call ตรงๆ — ห้ามต้องการ `replyToken` / inbound `messageId` / `markAsReadToken` / public URL / hosted server
- **Stateless:** ไม่มี store/state ฝั่ง server (ต่างจาก inbound เดิม) — ทุก tool เป็น API call
- **Pattern fidelity:** ตาม v1 เป๊ะ — `InputSchema = z.object({}).strict()` → `inputSchema: InputSchema.shape` → parse `raw` ใน try → `resolveOa(params.oa)` → `new LineClient({channelAccessToken})` → return `{content, structuredContent}` / `{isError, content}` → i18n `TH` → `.js` imports → kebab-case files → exported pure helpers for unit test
- **Zero new dependency:** ใช้ของเดิม (`@line/bot-sdk`, `@modelcontextprotocol/sdk`, `zod`) + node built-in

---

## 2. Scope — v2.0 tools

### A. Rich Menu Lifecycle (gap ใหญ่สุด)
| Tool | Endpoint(s) | Mode/หน้าที่ |
|------|-------------|--------------|
| `line_link_rich_menu` | `POST/DELETE /v2/bot/user/{userId}/richmenu`, `POST /v2/bot/richmenu/bulk/{link,unlink}` | mode: link\|unlink · target: {user_id} \| {user_ids[]} (bulk ≤500/req, auto-chunk) |
| `line_set_default_rich_menu` | `POST/DELETE /v2/bot/user/all/richmenu/{id}` | mode: set\|clear |
| `line_manage_rich_menu_alias` | `POST/POST{id}/DELETE/GET/GET list /v2/bot/richmenu/alias` | mode: create\|update\|delete\|get\|list (สำหรับเมนูสลับแท็บ) |
| `line_upload_rich_menu_image` | `POST /v2/bot/richmenu/{id}/content` (api-data) | เปลี่ยนรูปเมนูที่มีอยู่ (fetch URL → upload) |

### B. Audience / Webhook / Stats / Token
| Tool | Endpoint(s) | Mode/หน้าที่ |
|------|-------------|--------------|
| `line_update_audience` | `PUT /v2/bot/audienceGroup/upload` (add by JSON), `PUT /v2/bot/audienceGroup/{id}/updateDescription` | mode: add_users\|rename |
| `line_set_webhook_endpoint` | `PUT/GET /v2/bot/channel/webhook/endpoint` | mode: set\|get (test มีแล้วที่ `line_test_webhook`) |
| `line_get_narrowcast_progress` | `GET /v2/bot/message/progress/narrowcast?requestId` | เช็คสถานะบลาสต์ |
| `line_issue_link_token` | `POST /v2/bot/user/{userId}/linkToken` | account linking |
| `line_check_token` | `GET /oauth2/v2.1/verify`, `GET /oauth2/v2.1/tokens/kid` | token health/expiry |

### C. Message Types (จากคำถามพี่โต — Rich/Card message)
| Tool | Endpoint(s) | หน้าที่ |
|------|-------------|---------|
| `line_design_imagemap` | builder → `type:"imagemap"` | **Rich Message** — areas (bounds+action) บน base 1040px, video optional. Validate + coach การ host รูป (LINE ขอ /1040 /700 /460 /300 /240, ไม่มี upload API) |
| `line_design_card` | builder → `type:"template"` | **Card Message** — kind: buttons (≤4) \| confirm (2) \| carousel (≤10 cols) \| image_carousel (≤10). Limits baked in |

### D. Extend existing
| ไฟล์ | เพิ่ม |
|------|------|
| `send-message.ts` | wire `image` (typed แล้วไม่เคยใช้) + เพิ่ม `video` (trackingId), `imagemap`, `template` branches เข้า `MessageSchema` + `buildLineMessages` |
| `get-oa-status.ts` | เผย `chatMode` + `markAsReadMode` (ดึงจาก /v2/bot/info อยู่แล้ว แต่ไม่โชว์) |

**CUT (verified ไม่มี API / ขัด token-only):** auto-reply rules, greeting setter, chat tags, get-content (ต้อง inbound messageId), reply (replyToken), markAsRead (markAsReadToken), standalone "Rich Video" parity tool, media upload/hosting tool, PNP/mission sticker (corporate-gated), group/room (groupId ต้อง webhook discover), membership (เฉพาะทาง).

---

## 3. File map

```
src/
├── line/client.ts          # EXTEND: + ~13 methods (linkRichMenu, unlinkRichMenu, bulkLink/Unlink,
│                           #   setDefaultRichMenu, clearDefaultRichMenu, uploadRichMenuImage,
│                           #   alias CRUD, addAudienceUsers, renameAudience, setWebhookEndpoint,
│                           #   getNarrowcastProgress, issueLinkToken, verifyToken)
├── types.ts                # EXTEND: + LineVideoMessage, LineImagemapMessage, LineTemplateMessage
│                           #   + output interfaces for new tools
├── i18n/th.ts              # EXTEND: + strings (success/coach/errors)
├── line/imagemap-builder.ts# NEW (pure): build/validate imagemap object  [testable]
├── line/template-builder.ts# NEW (pure): build/validate template object  [testable]
└── tools/
    ├── link-rich-menu.ts          # NEW
    ├── set-default-rich-menu.ts   # NEW
    ├── manage-rich-menu-alias.ts  # NEW
    ├── upload-rich-menu-image.ts  # NEW
    ├── update-audience.ts         # NEW
    ├── set-webhook-endpoint.ts    # NEW
    ├── get-narrowcast-progress.ts # NEW
    ├── issue-link-token.ts        # NEW
    ├── check-token.ts             # NEW
    ├── design-imagemap.ts         # NEW (uses imagemap-builder)
    ├── design-card.ts             # NEW (uses template-builder)
    ├── send-message.ts            # EXTEND
    └── get-oa-status.ts           # EXTEND
server.ts                   # EXTEND: register 11 new tools (section "J. Rich Menu Ops / K. Message Builders / L. Ops")
constants.ts                # EXTEND: bulk chunk size, imagemap base width=1040, template limits
package.json                # version → 2.0.0
```

→ v2 = **27 + 11 = 38 tools** + 2 extends

---

## 4. Test plan (vitest, zero-config, pure helpers, `.js` imports)

| Test | ครอบคลุม |
|------|----------|
| `tests/imagemap-builder.test.ts` | base width=1040 enforce, area bounds vs baseSize, action union, video block + externalLink, altText |
| `tests/template-builder.test.ts` | buttons ≤4, confirm =2, carousel ≤10 cols + text 60/120 limit, image_carousel ≤10, action union |
| `tests/rich-menu-link.test.ts` | bulk chunk ≤500, link/unlink body, single vs bulk routing |
| `tests/audience-update.test.ts` | add-users JSONL body shape, rename body |
| `tests/webhook-endpoint.test.ts` | URL validation (HTTPS, ≤500 chars), set/get body |
| `tests/message-schema.test.ts` | new send-message branches (image/video/imagemap/template) build correct LINE objects |
| `tests/token-link.test.ts` | linkToken parse, verify response shape |

เป้า: `npm run build` + `pnpm type-check` + `pnpm lint` + `vitest run` ผ่านหมด

+ mcp-builder Phase 4: `evaluations/v2-eval.xml` — 10 read-only QA pairs (optional)

---

## 5. Build phases + Agent Team

| Phase | งาน | ใคร |
|-------|-----|-----|
| 1 | Foundation: extend client.ts (methods) + types.ts + th.ts + builders (imagemap/template pure) | คลอเดียจัง |
| 2 | Build 11 tool files (parallel groups) | Implementer agents |
| 3 | Integrate: extend send-message + get-oa-status, register server.ts, bump version | คลอเดียจัง |
| 4 | Unit tests ครบ | คลอเดียจัง / test agent |
| 5 | **Agent QC** — behavior vs LINE spec + coverage | QC agent |
| 6 | **Agent Code Review** — security/types/DRY/consistency | Review agent |
| 7 | build + type-check + lint + vitest ผ่าน → fix → RELEASE_NOTES_v2.0.0 + สรุป | คลอเดียจัง |

---

## 6. Security & quality

- ทุก tool ใช้ token จาก `resolveOa` เท่านั้น ไม่ hardcode, ไม่ log token
- bulk link auto-chunk ≤500/req (LINE limit) + เคารพ rate-limit (richmenu bulk)
- imagemap/template: validate ตาม LINE limit ก่อนส่ง (actionable error)
- token-only: ไม่มี state, ไม่มี file write (ยกเว้น user ระบุ) → portable ทุก host
- TypeScript strict (no any), `.js` imports, kebab-case — ตาม v1
