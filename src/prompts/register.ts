/**
 * Register MCP prompts.
 *
 * Prompts are guided multi-step workflows that an LLM can invoke. They differ
 * from tools in that prompts produce a *message stream* to drive the agent's
 * own reasoning, while tools execute actions.
 *
 * V1 ships 7 prompts. Each is short and intent-shaped so it works well in
 * both Cowork's prompt picker and Claude Code's `/prompt` interface.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerPrompts(server: McpServer): void {
  // ---- daily-oa-report ----
  server.registerPrompt(
    "daily-oa-report",
    {
      title: "Daily LINE OA report",
      description: "Generate a Thai-language summary of today's / last week's LINE OA performance.",
      argsSchema: {
        range: z
          .enum(["today", "yesterday", "this-week", "last-week", "this-month"])
          .optional()
          .describe("Date range. Defaults to 'last-week'."),
        oa: z.string().optional(),
      },
    },
    ({ range, oa }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `กรุณาสรุปสถานะของ LINE OA${oa ? ` (${oa})` : ""} ในช่วง ${range ?? "last-week"} เป็นภาษาไทย โดย:
1. เรียก line_get_oa_status เพื่อดู snapshot ปัจจุบัน (friends, quota, webhook)
2. เรียก line_get_oa_report ด้วย range='${range ?? "last-week"}' เพื่อดู delivery + followers
3. นำเสนอเป็น markdown report ที่ภาษาเข้าใจง่ายสำหรับ SMB owner ภาษาไทย
4. เน้น 3 ตัวเลขที่สำคัญที่สุด + 1 action ที่ควรทำต่อไป`,
          },
        },
      ],
    }),
  );

  // ---- build-campaign ----
  server.registerPrompt(
    "build-campaign",
    {
      title: "Build a LINE broadcast campaign",
      description: "Wizard for designing a broadcast: audience → Flex → schedule via OA Manager.",
      argsSchema: {
        occasion: z.string().describe('โอกาส เช่น "วันแม่", "ปีใหม่", "ล้างสต๊อก".'),
        audience_hint: z.string().optional().describe("คำอธิบายกลุ่มเป้าหมาย"),
      },
    },
    ({ occasion, audience_hint }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `ช่วยออกแบบ campaign LINE OA สำหรับโอกาส "${occasion}"${audience_hint ? ` (audience: ${audience_hint})` : ""} เป็นภาษาไทย โดยทำ 5 ขั้นตอน:
1. ใช้ line_list_audiences ดู audience ที่มีอยู่ — เลือกที่เหมาะกับ "${audience_hint ?? occasion}"
2. ใช้ line_design_flex สร้าง Flex template ที่เข้ากับ "${occasion}" (เลือก template เช่น promo_simple หรือ voucher)
3. ใช้ line_estimate_send_cost เพื่อประมาณ quota cost
4. ใช้ line_send_message ด้วย mode="draft" เพื่อสร้าง handoff package ให้ user ไป schedule ใน LINE OA Manager
5. สรุปขั้นตอนทั้งหมด + แนะนำเวลาส่งที่ดีที่สุด (11:00-13:00 หรือ 19:00-21:00 BKK)`,
          },
        },
      ],
    }),
  );

  // ---- schedule-broadcast-howto ----
  server.registerPrompt(
    "schedule-broadcast-howto",
    {
      title: "Schedule a LINE broadcast (how-to)",
      description: "Explain 3 patterns to schedule a LINE broadcast: OA Manager UI, Cowork Scheduled Tasks, system cron.",
    },
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `อธิบายให้ user (Thai SMB / agency) เข้าใจวิธี schedule LINE broadcast 3 แบบ:

1. **LINE OA Manager UI (แนะนำที่สุด)** — เพราะ LINE delivery reliability + audit log
   - ใช้ line_send_message ด้วย mode="draft" เพื่อสร้าง handoff package
   - paste Flex JSON + เลือก audience + ตั้งเวลาใน OA Manager UI
   - ข้อดี: zero infra, LINE-grade reliability, ใช้ UI ที่คุ้นเคย

2. **Cowork Scheduled Tasks** — สำหรับ workflow ซับซ้อน (recurring, conditional)
   - User บอก Cowork "ส่ง broadcast วันแม่ตอน 09:00 12 ส.ค."
   - Cowork สร้าง Scheduled Task → ตอนถึงเวลา → เรียก line_send_message ส่งทันที
   - ข้อดี: chain operations, recurring patterns

3. **System cron / GitHub Actions** — สำหรับ developer ที่ใช้ Claude Code headless
   - ใช้ \`claude code --headless\` รัน MCP จาก cron job
   - ข้อดี: integrate กับ CI/CD, version control

แนะนำให้ user เลือกตาม use case ของเขา — ส่วนใหญ่แนะนำแบบ 1`,
          },
        },
      ],
    }),
  );

  // ---- diagnose-rich-menu ----
  server.registerPrompt(
    "diagnose-rich-menu",
    {
      title: "Diagnose Rich Menu visibility",
      description: '"ทำไม user ไม่เห็นเมนู?" troubleshooter',
      argsSchema: {
        user_id: z.string().describe("LINE user ID to diagnose"),
        oa: z.string().optional(),
      },
    },
    ({ user_id, oa }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `ช่วย diagnose ว่า user \`${user_id}\` เห็น Rich Menu อะไรอยู่${oa ? ` ใน OA "${oa}"` : ""} โดย:
1. เรียก line_audit_user_menu({ user_id: "${user_id}"${oa ? `, oa: "${oa}"` : ""} }) — ดู priority chain
2. เรียก line_list_rich_menus เพื่อดู Rich Menus ทั้งหมด + default
3. อธิบายเป็นภาษาไทย:
   - User เห็นเมนูไหนอยู่
   - มาจาก layer ไหน (per-user link / default / none)
   - ถ้าไม่เห็น — แนะนำว่าควรทำอะไร (ไม่มี default → ใช้ line_build_rich_menu สร้าง)`,
          },
        },
      ],
    }),
  );

  // ---- coupon-campaign ----
  server.registerPrompt(
    "coupon-campaign",
    {
      title: "Run a coupon campaign end-to-end",
      description: "Create coupon → broadcast → audience from clicks → measure",
      argsSchema: {
        discount: z.string().describe('เช่น "ส่วนลด 20%" หรือ "ลด 100 บาท"'),
        valid_to: z.string().describe("วันหมดอายุ ISO date e.g. 2026-08-31"),
        audience: z.string().optional(),
      },
    },
    ({ discount, valid_to, audience }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Run coupon campaign end-to-end เป็นภาษาไทย:
1. ใช้ line_manage_coupon mode="create" สร้าง coupon "${discount}" ใช้ได้ถึง ${valid_to}
2. ใช้ line_design_flex template="voucher" data={ title, code, discount: "${discount}", valid_until: "${valid_to}" }
3. ใช้ line_send_message ด้วย mode="draft" — handoff ไป LINE OA Manager เพื่อ schedule${audience ? ` กับ audience "${audience}"` : ""}
4. หลังส่ง 24 ชม. — ใช้ line_build_audience_from_engagement สร้าง click audience จาก request_id
5. ใช้ line_get_coupon_stats เพื่อดู redemption (อ้าง click_audience_id จากขั้น 4)`,
          },
        },
      ],
    }),
  );

  // ---- migrate-from-line-notify ----
  server.registerPrompt(
    "migrate-from-line-notify",
    {
      title: "Migrate from LINE Notify",
      description: "Help user migrate LINE Notify (dead 2025-03-31) to Messaging API push.",
    },
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `User เคยใช้ LINE Notify ส่ง notification — แต่ LINE Notify ถูกปิดไปเมื่อ 31 มี.ค. 2025 ช่วย migrate เป็นภาษาไทย:

1. อธิบายความแตกต่าง:
   - LINE Notify: token-per-user-per-service, ส่งง่ายผ่าน HTTP POST
   - LINE Messaging API: channel access token, ส่งผ่าน push API, ต้อง user เพิ่ม OA เป็นเพื่อน

2. แนะนำขั้นตอน migrate:
   a. สร้าง LINE Messaging API channel ใน LINE Developers Console
   b. ออก channel access token ใหม่
   c. ให้ users เพิ่ม OA เป็นเพื่อน (ส่ง QR code / deep link)
   d. เปลี่ยน HTTP POST code จาก notify-api.line.me → api.line.me/v2/bot/message/push
   e. ใส่ user IDs ที่ดึงจาก webhook follow event

3. ใช้ line_emit_login_snippet ถ้า user ต้องการ OAuth flow เพื่อรับ user IDs

4. แสดง before/after curl example`,
          },
        },
      ],
    }),
  );

  // ---- webhook-setup-guide ----
  server.registerPrompt(
    "webhook-setup-guide",
    {
      title: "LINE Webhook setup guide (for developers)",
      description: "Walk through setting up a LINE webhook handler — signature verification, ngrok/cloudflared, common pitfalls.",
    },
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `User ต้องการ set up webhook สำหรับรับ event ขาเข้าจาก LINE OA ช่วยแนะนำเป็นภาษาไทย:

1. สถานะของ V1 MCP: outbound only — webhook ingestion ทำผ่าน external server (V2 จะมี @line-mcp/webhook-server)

2. Setup webhook server:
   a. สร้าง HTTP server (Express / Hono / Cloudflare Workers / Vercel Functions)
   b. POST /webhook endpoint
   c. **Verify X-Line-Signature** ด้วย HMAC-SHA256 + channel_secret (อย่าข้าม — security)
   d. Return 200 ภายใน 10 วินาที

3. Local dev:
   a. ngrok / cloudflared tunnel
   b. ใส่ public URL ใน LINE Developers Console → Messaging API → Webhook URL
   c. ใช้ line_test_webhook ทดสอบ

4. Common pitfalls:
   - Signature verify ผิด (ใช้ raw body bytes ไม่ใช่ parsed JSON)
   - Reply token มีอายุ ~30s — ตอบช้าเกินใช้ไม่ได้ → fallback to push
   - Webhook ต้อง return 200 ภายใน 10s — ไม่งั้น LINE retry

5. แนะนำ template: Cloudflare Workers หรือ Vercel Functions (zero infra, instant scale)`,
          },
        },
      ],
    }),
  );
}
