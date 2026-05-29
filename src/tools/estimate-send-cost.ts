/**
 * Tool: line_estimate_send_cost
 *
 * Pre-flight cost estimate for a planned send. Same inputs as
 * line_send_message but never sends — just validates + reports projected
 * quota consumption.
 *
 * Useful when an agent wants to ask the user "ส่งเลยมั้ย? จะใช้ X messages"
 * before pulling the trigger.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveOa } from "../config/multi-oa.js";
import { LineApiError, LineClient } from "../line/client.js";
import { snapshotQuota } from "../line/quota-guardian.js";
import { TH } from "../i18n/th.js";

const TargetSchema = z.union([
  z.object({ user_id: z.string().min(1) }).strict(),
  z.object({ user_ids: z.array(z.string().min(1)).min(1).max(10000) }).strict(),
  z.object({ audience: z.string().min(1) }).strict(),
  z.object({ filter: z.record(z.unknown()) }).strict(),
  z.object({ everyone: z.literal(true) }).strict(),
]);

const InputSchema = z
  .object({
    target: TargetSchema,
    message_count: z
      .number()
      .int()
      .min(1)
      .max(5)
      .default(1)
      .describe("Number of messages in the send (LINE counts each message in a batch). Default 1."),
    oa: z.string().optional(),
  })
  .strict();

type Input = z.infer<typeof InputSchema>;

export function registerEstimateSendCostTool(server: McpServer): void {
  server.registerTool(
    "line_estimate_send_cost",
    {
      title: "Estimate LINE send cost",
      description: `Estimate how many quota messages a planned send will consume — without actually sending. Useful before user confirmation, especially for narrowcast / broadcast.

Args:
  - target: Same shapes as line_send_message ({ user_id } | { user_ids } | { audience } | { filter } | { everyone: true }).
  - message_count: How many message objects in the send (1-5, default 1). LINE charges per message * recipients.
  - oa: optional OA id.

Returns:
  {
    estimated_recipients?: number,      // known exactly for user_id(s); approximate for audience; unknown for filter/everyone
    estimated_cost_messages?: number,   // recipients * message_count
    quota: { used, total, remaining, percentage_used },
    cost_share_percent?: number,        // estimated_cost / remaining
    notes: string[]
  }

Notes:
  - For target.audience: we look up audience_count via line_list_audiences first.
  - For target.filter or target.everyone: exact estimation isn't possible from API alone — we surface "unknown" and recommend a dry_run via line_send_message instead.`,
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

        let estimatedRecipients: number | undefined;
        const notes: string[] = [];
        const t = params.target;

        if ("user_id" in t) {
          estimatedRecipients = 1;
        } else if ("user_ids" in t) {
          estimatedRecipients = t.user_ids.length;
        } else if ("audience" in t) {
          const idNum = Number(t.audience);
          if (Number.isFinite(idNum)) {
            try {
              const res = await client.getAudienceGroup(idNum);
              estimatedRecipients = res.audienceGroup.audienceCount;
            } catch {
              notes.push("⚠️ ไม่สามารถดึงขนาด audience ได้ — recipients = unknown");
            }
          } else {
            notes.push("⚠️ target.audience ต้องเป็น numeric id ตอนนี้ — ใช้ line_list_audiences เพื่อดู id");
          }
        } else if ("filter" in t) {
          notes.push("ℹ️ Narrowcast by filter — ขนาดที่แน่นอนต้องดู progress หลังส่ง (ผ่าน line_get_message_stats)");
        } else {
          notes.push("ℹ️ Broadcast everyone — ดูจำนวน friend ปัจจุบันด้วย line_get_oa_status เพื่อประมาณ");
        }

        const quota = await snapshotQuota(client);
        const estimatedCost =
          estimatedRecipients !== undefined ? estimatedRecipients * params.message_count : undefined;

        let costShare: number | undefined;
        if (
          typeof estimatedCost === "number" &&
          typeof quota.remaining === "number" &&
          quota.remaining > 0
        ) {
          costShare = Math.round((estimatedCost / quota.remaining) * 1000) / 10;
          if (costShare > 95) {
            notes.push(
              `🛑 ส่งนี้จะใช้ ${costShare}% ของ quota ที่เหลือ — Quota Guardian จะ block ถ้าไม่ confirm`,
            );
          } else if (costShare > 50) {
            notes.push(`🟡 ส่งนี้จะใช้ ${costShare}% ของ quota ที่เหลือ — ระวังจนสิ้นเดือน`);
          }
        }

        const output = {
          estimated_recipients: estimatedRecipients,
          estimated_cost_messages: estimatedCost,
          quota,
          cost_share_percent: costShare,
          notes,
        };

        const md: string[] = ["# 💰 Send cost estimate", ""];
        md.push(`- **คาดผู้รับ:** ${estimatedRecipients !== undefined ? estimatedRecipients.toLocaleString() : "ไม่ทราบ"}`);
        md.push(`- **คาดข้อความที่ส่ง:** ${estimatedCost !== undefined ? estimatedCost.toLocaleString() : "ไม่ทราบ"}`);
        md.push(
          `- **Quota:** ${quota.used.toLocaleString()} / ${quota.total === "unlimited" ? "ไม่จำกัด" : quota.total.toLocaleString()} (เหลือ ${quota.remaining === "unlimited" ? "ไม่จำกัด" : quota.remaining.toLocaleString()})`,
        );
        if (costShare !== undefined) md.push(`- **% of remaining:** ${costShare}%`);
        if (notes.length) {
          md.push("");
          md.push("## Notes");
          for (const n of notes) md.push(`- ${n}`);
        }

        return {
          content: [{ type: "text", text: md.join("\n") }],
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
