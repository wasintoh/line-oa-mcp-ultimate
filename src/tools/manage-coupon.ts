/**
 * Tool: line_manage_coupon
 *
 * Coupon CRUD — restored from V1 cut list after พี่โต pointed out that "ลูกค้า
 * วันนี้มีใครใช้ coupon ซ้ำไหม" is a daily SMB question. 4 modes wrapped in
 * one tool for compactness.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveOa } from "../config/multi-oa.js";
import { LineApiError, LineClient } from "../line/client.js";
import { TH } from "../i18n/th.js";

const InputSchema = z
  .object({
    mode: z
      .enum(["create", "list", "get", "discontinue"])
      .describe(
        "create: make a new coupon; list: list all coupons; get: fetch one; discontinue: end one (irreversible).",
      ),
    coupon_id: z
      .string()
      .optional()
      .describe("Required for mode='get' or 'discontinue'."),
    data: z
      .object({
        title: z.string().min(1).max(60).optional(),
        description: z.string().max(300).optional(),
        image_url: z.string().url().optional(),
        valid_from: z.string().optional().describe("ISO datetime."),
        valid_to: z.string().optional().describe("ISO datetime."),
        coupon_code: z.string().max(20).optional(),
        max_redemptions: z.number().int().positive().optional(),
        terms_url: z.string().url().optional(),
      })
      .optional()
      .describe("Required for mode='create'."),
    confirm: z
      .boolean()
      .default(false)
      .describe("Required true for mode='discontinue'."),
    oa: z.string().optional(),
    response_format: z.enum(["markdown", "json"]).default("markdown"),
  })
  .strict();

type Input = z.infer<typeof InputSchema>;

export function registerManageCouponTool(server: McpServer): void {
  server.registerTool(
    "line_manage_coupon",
    {
      title: "Manage LINE OA coupons",
      description: `Coupon CRUD on a LINE OA. Four modes:

  - create: Make a new coupon. Requires data: { title, description, valid_from, valid_to, ... }
  - list: List all coupons.
  - get: Fetch a specific coupon by coupon_id.
  - discontinue: End a live coupon (irreversible — requires confirm=true).

Rate limit: shared bucket 200 req/sec with multicast.

Args (varies by mode):
  - mode: 'create' | 'list' | 'get' | 'discontinue'
  - coupon_id: required for get / discontinue.
  - data: required for create.
  - confirm: required true for discontinue.
  - oa: optional OA id.

Examples:
  - "สร้าง coupon ส่วนลด 20% MOM20 ใช้ได้ถึง 31 ส.ค." →
      { mode: "create", data: { title: "คูปองวันแม่", coupon_code: "MOM20", valid_from: "2026-08-01", valid_to: "2026-08-31" } }
  - "ดู coupons ทั้งหมด" → { mode: "list" }
  - "ปิด coupon C123" → { mode: "discontinue", coupon_id: "C123", confirm: true }`,
      inputSchema: InputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (raw: unknown) => {
      try {
        const params = InputSchema.parse(raw);
        const { config } = resolveOa(params.oa);
        const client = new LineClient({ channelAccessToken: config.channel_access_token });

        switch (params.mode) {
          case "create": {
            if (!params.data || !params.data.title) {
              return {
                isError: true,
                content: [{ type: "text", text: "❌ mode='create' ต้องการ data.title อย่างน้อย" }],
              };
            }
            const body: Record<string, unknown> = {
              title: params.data.title,
              description: params.data.description,
              imageUrl: params.data.image_url,
              startTime: params.data.valid_from,
              endTime: params.data.valid_to,
              code: params.data.coupon_code,
              maxRedemptions: params.data.max_redemptions,
              termsUrl: params.data.terms_url,
            };
            const result = await client.createCoupon(body);
            return {
              content: [
                {
                  type: "text",
                  text: `✅ สร้าง coupon "${params.data.title}" (id ${result.couponId})`,
                },
              ],
              structuredContent: { coupon_id: result.couponId, ...params.data },
            };
          }
          case "list": {
            const res = await client.listCoupons();
            const items = res.coupons ?? [];
            return {
              content: [
                {
                  type: "text",
                  text:
                    params.response_format === "json"
                      ? JSON.stringify({ total: items.length, coupons: items }, null, 2)
                      : `# 🎟 Coupons (${items.length})\n\n${items.map((c) => `- \`${String(c.couponId)}\` — ${String(c.title ?? "(no title)")}`).join("\n") || "_ไม่มี coupon_"}`,
                },
              ],
              structuredContent: { total: items.length, coupons: items },
            };
          }
          case "get": {
            if (!params.coupon_id) {
              return {
                isError: true,
                content: [{ type: "text", text: "❌ mode='get' ต้องการ coupon_id" }],
              };
            }
            const c = await client.getCoupon(params.coupon_id);
            return {
              content: [{ type: "text", text: JSON.stringify(c, null, 2) }],
              structuredContent: c,
            };
          }
          case "discontinue": {
            if (!params.coupon_id) {
              return {
                isError: true,
                content: [{ type: "text", text: "❌ mode='discontinue' ต้องการ coupon_id" }],
              };
            }
            if (!params.confirm) {
              return {
                isError: true,
                content: [
                  {
                    type: "text",
                    text: `⚠️ ต้องตั้ง confirm=true ก่อนปิด coupon \`${params.coupon_id}\``,
                  },
                ],
              };
            }
            await client.discontinueCoupon(params.coupon_id);
            return {
              content: [
                { type: "text", text: `🛑 ปิด coupon \`${params.coupon_id}\` สำเร็จ` },
              ],
              structuredContent: { success: true, discontinued_id: params.coupon_id },
            };
          }
        }
      } catch (err) {
        if (err instanceof LineApiError) {
          return { isError: true, content: [{ type: "text", text: err.message }] };
        }
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: TH.unknownError(msg) }] };
      }
    },
  );
}
