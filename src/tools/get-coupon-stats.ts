/**
 * Tool: line_get_coupon_stats
 *
 * Coupon analytics — answer พี่โต's question "ลูกค้าวันนี้มีใครใช้ coupon ซ้ำไหม".
 *
 * LINE's Coupon API does not (yet) expose dedicated redemption events. We
 * approximate by:
 *   1. Reading whatever stats fields LINE returns on GET /v2/bot/coupon/{id}
 *      (varies — some accounts/regions get usage counts inline)
 *   2. If a click_audience was created earlier from the coupon broadcast, we
 *      surface its size as "people who clicked through to redeem"
 *
 * We're transparent in the response about which signals are real vs. inferred.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveOa } from "../config/multi-oa.js";
import { LineApiError, LineClient } from "../line/client.js";
import { TH } from "../i18n/th.js";

const InputSchema = z
  .object({
    coupon_id: z.string().min(1),
    click_audience_id: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "Optional — if you created a click audience from the coupon broadcast, pass its id to enrich the stats with click-through count.",
      ),
    oa: z.string().optional(),
    response_format: z.enum(["markdown", "json"]).default("markdown"),
  })
  .strict();

export function registerGetCouponStatsTool(server: McpServer): void {
  server.registerTool(
    "line_get_coupon_stats",
    {
      title: "Get LINE coupon redemption stats",
      description: `Read available stats for a LINE coupon. LINE has no dedicated redemption endpoint, so this combines signals: raw coupon detail (some accounts include usage inline) plus, if you pass click_audience_id, the click-audience size as a clickthrough proxy. coupon_id comes from line_manage_coupon. Caveat (surfaced in notes): click-audience size approximates clickthroughs, NOT actual redemptions — for real counts build the coupon Flex with a postback action and listen via webhook.

Returns { coupon_id, raw, click_audience?, estimated_redemptions?, notes[] }.`,
      inputSchema: InputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (raw: unknown) => {
      try {
        const params = InputSchema.parse(raw);
        const { config } = resolveOa(params.oa);
        const client = new LineClient({ channelAccessToken: config.channel_access_token });

        const [coupon, audience] = await Promise.allSettled([
          client.getCoupon(params.coupon_id),
          params.click_audience_id
            ? client.getAudienceGroup(params.click_audience_id)
            : Promise.resolve(null),
        ]);

        const notes: string[] = [];
        if (coupon.status === "rejected") {
          notes.push("⚠️ ดึง coupon detail ไม่ได้");
        }

        const rawCoupon = coupon.status === "fulfilled" ? coupon.value : null;
        const ag =
          audience.status === "fulfilled" && audience.value ? audience.value.audienceGroup : null;

        let estimatedRedemptions: number | undefined;
        if (ag?.audienceCount !== undefined) {
          estimatedRedemptions = ag.audienceCount;
          notes.push(
            `ℹ️ "estimated_redemptions" มาจาก click audience size — ประมาณการเฉพาะคนที่คลิก ไม่ใช่ค่าจริงของการ redeem`,
          );
        } else {
          notes.push(
            `ℹ️ ไม่มี click_audience_id หรือ audience ยัง index ไม่เสร็จ — ส่ง audience id ที่สร้างจาก broadcast coupon เพื่อ enrich`,
          );
        }
        notes.push(
          "💡 สำหรับ redemption count แม่นจริง — ใช้ postback action ใน Flex coupon + webhook listener (จะมีใน V2)",
        );

        const output = {
          coupon_id: params.coupon_id,
          raw: rawCoupon,
          click_audience: ag
            ? {
                id: ag.audienceGroupId,
                name: ag.description,
                audience_count: ag.audienceCount,
                status: ag.status,
              }
            : undefined,
          estimated_redemptions: estimatedRedemptions,
          notes,
        };

        const text =
          params.response_format === "json"
            ? JSON.stringify(output, null, 2)
            : renderMd(output);
        return {
          content: [{ type: "text", text }],
          structuredContent: output as unknown as Record<string, unknown>,
        };
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

function renderMd(o: {
  coupon_id: string;
  raw: unknown;
  click_audience?: { id: number; name: string; audience_count?: number; status: string };
  estimated_redemptions?: number;
  notes: string[];
}): string {
  const lines: string[] = [`# 🎟 Coupon stats — \`${o.coupon_id}\``, ""];
  if (typeof o.estimated_redemptions === "number") {
    lines.push(`- **คาดการณ์การใช้ (จาก click audience):** ${o.estimated_redemptions.toLocaleString()} คน`);
  }
  if (o.click_audience) {
    lines.push(`- **Click audience:** "${o.click_audience.name}" (id ${o.click_audience.id}, status ${o.click_audience.status})`);
  }
  if (o.raw) {
    lines.push("");
    lines.push("## Raw coupon data");
    lines.push("```json");
    lines.push(JSON.stringify(o.raw, null, 2));
    lines.push("```");
  }
  if (o.notes.length) {
    lines.push("");
    lines.push("## Notes");
    for (const n of o.notes) lines.push(`- ${n}`);
  }
  return lines.join("\n");
}
