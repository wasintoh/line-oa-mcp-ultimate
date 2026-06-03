/**
 * Tool: line_manage_coupon
 *
 * Coupon CRUD — restored from V1 cut list after พี่โต pointed out that "ลูกค้า
 * วันนี้มีใครใช้ coupon ซ้ำไหม" is a daily SMB question. 4 modes wrapped in
 * one tool for compactness.
 *
 * v1.0.4 — Coupon create rewritten to match the real LINE Coupon API
 * (POST /v2/bot/coupon). The previous body shape (startTime / endTime / code /
 * maxRedemptions) was rejected with "7 error(s)" because LINE requires 8 fields:
 *   title, reward, acquisitionCondition, startTimestamp, endTimestamp,
 *   timezone, visibility, maxUseCountPerTicket.
 * We now accept friendly inputs (discount_type/discount_value, valid_from/_to,
 * ...) and map them to the exact LINE schema. The mapping helpers are exported
 * so they can be unit-tested without hitting the network.
 *
 * Schema reference:
 *   https://developers.line.biz/en/reference/messaging-api/#create-coupon
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveOa } from "../config/multi-oa.js";
import { LineApiError, LineClient } from "../line/client.js";
import { TH } from "../i18n/th.js";

// ---- mapping helpers (exported for unit tests) -----------------------------

export type CouponDiscountType = "percentage" | "fixed" | "explicit";

export interface CouponCreateData {
  title?: string;
  description?: string;
  image_url?: string;
  // reward / discount
  discount_type?: CouponDiscountType;
  discount_value?: number; // % when percentage, currency amount when fixed
  price_before?: number; // explicit only
  price_after?: number; // explicit only
  // validity period
  valid_from?: string | number;
  valid_to?: string | number;
  timezone?: string; // LINE timezone enum, default ASIA_BANGKOK
  visibility?: "PUBLIC" | "UNLISTED";
  // acquisition
  acquisition_type?: "normal" | "lottery";
  lottery_probability?: number;
  max_acquire_count?: number;
  // usage
  max_use_per_ticket?: 1 | -1;
  coupon_code?: string;
  barcode_image_url?: string;
}

/**
 * Map a date-ish input to a UNIX timestamp **in seconds** (LINE Coupon API
 * uses seconds, not milliseconds).
 *   - number  → assumed seconds (auto-divides if it looks like ms, > 1e12)
 *   - "YYYY-MM-DD" → start (00:00:00) or end (23:59:59) of that day in the
 *     given timezone's offset
 *   - any other string → parsed as ISO datetime
 */
const TZ_OFFSETS: Record<string, string> = {
  ASIA_BANGKOK: "+07:00",
  ASIA_JAKARTA: "+07:00",
  ASIA_TOKYO: "+09:00",
  ASIA_TAIPEI: "+08:00",
  ASIA_SEOUL: "+09:00",
};

export function toUnixSeconds(
  input: string | number,
  opts: { endOfDay?: boolean; timezone?: string } = {},
): number {
  if (typeof input === "number") {
    return input > 1e12 ? Math.floor(input / 1000) : Math.floor(input);
  }
  const s = input.trim();
  let iso = s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const off = TZ_OFFSETS[opts.timezone ?? "ASIA_BANGKOK"] ?? "Z";
    const time = opts.endOfDay ? "23:59:59" : "00:00:00";
    iso = off === "Z" ? `${s}T${time}Z` : `${s}T${time}${off}`;
  }
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    throw new Error(
      `ไม่เข้าใจรูปแบบวันที่: "${input}" — ใช้ UNIX seconds, "YYYY-MM-DD" หรือ ISO datetime`,
    );
  }
  return Math.floor(ms / 1000);
}

/** Build the LINE `reward.priceInfo` object from friendly discount inputs. */
export function buildCouponPriceInfo(d: CouponCreateData): Record<string, unknown> {
  const type = d.discount_type ?? "percentage";
  if (type === "percentage") {
    if (d.discount_value == null) {
      throw new Error("discount_value (เปอร์เซ็นต์ 1–100) จำเป็นเมื่อ discount_type='percentage'");
    }
    return { type: "percentage", percentage: d.discount_value };
  }
  if (type === "fixed") {
    if (d.discount_value == null) {
      throw new Error("discount_value (จำนวนเงินที่ลด) จำเป็นเมื่อ discount_type='fixed'");
    }
    return { type: "fixed", fixedAmount: d.discount_value };
  }
  // explicit — show original price crossed out + discounted price
  if (d.price_before == null || d.price_after == null) {
    throw new Error("price_before และ price_after จำเป็นเมื่อ discount_type='explicit'");
  }
  return {
    type: "explicit",
    priceBeforeDiscount: d.price_before,
    priceAfterDiscount: d.price_after,
  };
}

/**
 * Build the full request body for `POST /v2/bot/coupon`.
 * Throws a Thai-friendly error if a required input is missing.
 */
export function buildCouponCreateBody(d: CouponCreateData): Record<string, unknown> {
  if (!d.title) throw new Error("data.title จำเป็น (ชื่อคูปอง ≤ 60 ตัวอักษร)");
  if (d.valid_from == null || d.valid_to == null) {
    throw new Error("data.valid_from และ data.valid_to จำเป็น (ระยะเวลาคูปอง)");
  }

  const timezone = d.timezone ?? "ASIA_BANGKOK";

  const acqType = d.acquisition_type ?? "normal";
  const acquisitionCondition: Record<string, unknown> = { type: acqType };
  if (acqType === "lottery") {
    if (d.lottery_probability == null) {
      throw new Error("lottery_probability (1–99) จำเป็นเมื่อ acquisition_type='lottery'");
    }
    acquisitionCondition.lotteryProbability = d.lottery_probability;
  }
  if (d.max_acquire_count != null) {
    acquisitionCondition.maxAcquireCount = d.max_acquire_count;
  }

  const startTimestamp = toUnixSeconds(d.valid_from, { endOfDay: false, timezone });
  const endTimestamp = toUnixSeconds(d.valid_to, { endOfDay: true, timezone });
  if (endTimestamp <= startTimestamp) {
    throw new Error("valid_to ต้องอยู่หลัง valid_from");
  }

  const body: Record<string, unknown> = {
    title: d.title,
    reward: { type: "discount", priceInfo: buildCouponPriceInfo(d) },
    acquisitionCondition,
    startTimestamp,
    endTimestamp,
    timezone,
    visibility: d.visibility ?? "UNLISTED",
    maxUseCountPerTicket: d.max_use_per_ticket ?? 1,
  };
  if (d.description) body.description = d.description;
  if (d.image_url) body.imageUrl = d.image_url;
  if (d.coupon_code) body.couponCode = d.coupon_code;
  if (d.barcode_image_url) body.barcodeImageUrl = d.barcode_image_url;
  return body;
}

// ---- input schema ----------------------------------------------------------

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
        description: z.string().max(1000).optional(),
        image_url: z.string().url().optional(),
        // reward / discount
        discount_type: z.enum(["percentage", "fixed", "explicit"]).optional()
          .describe("percentage (default) | fixed (amount off) | explicit (before→after price)."),
        discount_value: z.number().positive().optional()
          .describe("Percent (1–100) when percentage; currency amount when fixed."),
        price_before: z.number().positive().optional().describe("Explicit only."),
        price_after: z.number().positive().optional().describe("Explicit only."),
        // validity
        valid_from: z.union([z.string(), z.number()]).optional()
          .describe("UNIX seconds, 'YYYY-MM-DD', or ISO datetime."),
        valid_to: z.union([z.string(), z.number()]).optional()
          .describe("UNIX seconds, 'YYYY-MM-DD', or ISO datetime."),
        timezone: z.string().optional()
          .describe("LINE timezone enum, default ASIA_BANGKOK."),
        visibility: z.enum(["PUBLIC", "UNLISTED"]).optional()
          .describe("PUBLIC = listed in LY services; UNLISTED (default) = link/broadcast only."),
        // acquisition
        acquisition_type: z.enum(["normal", "lottery"]).optional(),
        lottery_probability: z.number().int().min(1).max(99).optional(),
        max_acquire_count: z.number().int().positive().optional(),
        // usage
        max_use_per_ticket: z
          .union([z.literal(1), z.literal(-1)])
          .optional()
          .describe("1 = once per user (default); -1 = unlimited."),
        coupon_code: z.string().max(16).optional(),
        barcode_image_url: z.string().url().optional(),
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
      description: `Coupon CRUD on a LINE OA (POST /v2/bot/coupon). Four modes:

  - create: Make a new coupon. Maps friendly inputs to LINE's required schema
            (reward, acquisitionCondition, startTimestamp/endTimestamp in UNIX
            seconds, timezone, visibility, maxUseCountPerTicket).
  - list: List all coupons.
  - get: Fetch a specific coupon by coupon_id.
  - discontinue: End a live coupon (irreversible — requires confirm=true).

Rate limit: shared bucket 200 req/sec with multicast.

create data fields:
  - title (required, ≤60)
  - discount_type: 'percentage' (default) | 'fixed' | 'explicit'
  - discount_value: % (percentage) or amount (fixed)
  - price_before / price_after: for discount_type='explicit'
  - valid_from / valid_to (required): UNIX seconds | 'YYYY-MM-DD' | ISO datetime
  - timezone: default 'ASIA_BANGKOK'
  - visibility: 'PUBLIC' | 'UNLISTED' (default UNLISTED)
  - max_use_per_ticket: 1 (default) | -1 (unlimited)
  - acquisition_type: 'normal' (default) | 'lottery' (+lottery_probability)
  - description, image_url, coupon_code, barcode_image_url (optional)

Examples:
  - "Early Bird ลด 20% 1–8 มิ.ย." →
      { mode: "create", data: { title: "Early Bird คอร์สจารโต", discount_type: "percentage", discount_value: 20, valid_from: "2026-06-01", valid_to: "2026-06-08", coupon_code: "EARLYBIRD" } }
  - "คูปองลด 100 บาท" →
      { mode: "create", data: { title: "ลด 100", discount_type: "fixed", discount_value: 100, valid_from: "2026-06-01", valid_to: "2026-06-30" } }
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
            let body: Record<string, unknown>;
            try {
              body = buildCouponCreateBody(params.data as CouponCreateData);
            } catch (mapErr) {
              const m = mapErr instanceof Error ? mapErr.message : String(mapErr);
              return { isError: true, content: [{ type: "text", text: `❌ ${m}` }] };
            }
            const result = await client.createCoupon(body);
            return {
              content: [
                {
                  type: "text",
                  text: `✅ สร้าง coupon "${params.data.title}" (id ${result.couponId})`,
                },
              ],
              structuredContent: { coupon_id: result.couponId, sent_body: body },
            };
          }
          case "list": {
            const res = await client.listCoupons();
            // LINE pager response uses `items`; fall back to `coupons` for safety.
            const items = res.items ?? res.coupons ?? [];
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
          // Surface LINE's per-field validation details (the "N errors" breakdown)
          const detail =
            err.details && err.details.length
              ? `${err.message}\n${err.details.map((d) => `  • ${d}`).join("\n")}`
              : err.message;
          return { isError: true, content: [{ type: "text", text: detail }] };
        }
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: TH.unknownError(msg) }] };
      }
    },
  );
}
