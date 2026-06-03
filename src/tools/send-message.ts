/**
 * Tool: line_send_message — the universal sender.
 *
 * One tool covers 5 LINE transports (reply, push, multicast, narrowcast,
 * broadcast) with three modes:
 *   - send_now  : send immediately
 *   - draft     : return a handoff package the user pastes into LINE OA Manager
 *                 (so scheduling happens in LINE's native UI — see doc #04 §5)
 *   - dry_run   : pre-flight validate + cost estimate, no recipients consumed
 *
 * The tool layer is intentionally thin — actual transport selection lives in
 * `line/transports.ts`, quota in `line/quota-guardian.ts`, etc.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveOa } from "../config/multi-oa.js";
import { LineApiError, LineClient } from "../line/client.js";
import { FLEX_TEMPLATE_NAMES, renderTemplate } from "../line/flex-templates.js";
import { checkQuota } from "../line/quota-guardian.js";
import { quietHoursCheck } from "../line/quiet-hours.js";
import { pickTransport } from "../line/transports.js";
import { TH } from "../i18n/th.js";
import type {
  DraftResultOutput,
  DryRunOutput,
  LineFlexMessage,
  LineMessage,
  SendResultOutput,
  SendTarget,
} from "../types.js";
import { snapshotQuota } from "../line/quota-guardian.js";

// ---- Zod schemas ----

const TargetSchema = z.union([
  z.object({ reply_to: z.string().min(1).describe("webhookEventId from an inbound event") }).strict(),
  z.object({ user_id: z.string().min(1).describe("LINE user ID") }).strict(),
  z
    .object({ user_ids: z.array(z.string().min(1)).min(1).max(10_000) })
    .strict()
    .describe("Multiple LINE user IDs — auto-chunked into 500-per-call multicasts"),
  z.object({ audience: z.string().min(1).describe("Audience id (numeric) or name") }).strict(),
  z
    .object({
      filter: z
        .object({
          ages: z.array(z.string()).optional(),
          genders: z.array(z.enum(["male", "female"])).optional(),
          areas: z.array(z.string()).optional(),
          app_types: z.array(z.enum(["ios", "android"])).optional(),
          subscription_periods: z.array(z.string()).optional(),
        })
        .strict()
        .describe("Demographic filter for narrowcast"),
    })
    .strict(),
  z.object({ everyone: z.literal(true) }).strict(),
]);

const MessageSchema = z.union([
  // Plain text
  z.object({ text: z.string().min(1).max(5000) }).strict(),
  // Template + data
  z
    .object({
      template: z.enum(FLEX_TEMPLATE_NAMES),
      data: z.record(z.unknown()).default({}),
      alt_text: z.string().min(1).max(400).optional(),
    })
    .strict(),
  // Raw Flex JSON (advanced)
  z
    .object({
      flex_json: z.record(z.unknown()),
      alt_text: z.string().min(1).max(400),
    })
    .strict(),
  // Sticker
  z
    .object({
      sticker: z
        .object({ package_id: z.string(), sticker_id: z.string() })
        .strict(),
    })
    .strict(),
  // Native LINE coupon (created via line_manage_coupon)
  z
    .object({
      coupon_id: z.string().min(1),
      delivery_tag: z
        .string()
        .max(30)
        .regex(/^[A-Za-z0-9_]+$/, "delivery_tag: a-z A-Z 0-9 _ เท่านั้น")
        .optional()
        .describe("Insight path label (≤30, [A-Za-z0-9_])."),
    })
    .strict(),
  // Image message (both URLs HTTPS + user-hosted; no upload API)
  z
    .object({
      image: z
        .object({
          original_content_url: z.string().url().describe("HTTPS JPEG/PNG, the full-size image"),
          preview_image_url: z.string().url().describe("HTTPS JPEG/PNG, the preview thumbnail"),
        })
        .strict(),
    })
    .strict(),
  // Video message (mp4 ≤200MB on an HTTPS range-request host; tracking_id fires videoPlayComplete)
  z
    .object({
      video: z
        .object({
          original_content_url: z.string().url().describe("HTTPS mp4, ≤200MB, host must support range requests"),
          preview_image_url: z.string().url().describe("HTTPS JPEG/PNG preview"),
          tracking_id: z
            .string()
            .optional()
            .describe("Optional; fires the videoPlayComplete webhook when the user finishes the video"),
        })
        .strict(),
    })
    .strict(),
  // Pre-built LINE message object passthrough — from line_design_imagemap (Rich Message),
  // line_design_card (Card Message), or line_design_flex. Must carry a valid `type`.
  z
    .object({
      message_json: z
        .record(z.unknown())
        .describe(
          "A complete LINE message object with a `type` field (imagemap | template | flex | text | sticker | image | video)",
        ),
    })
    .strict(),
]);

const InputSchema = z
  .object({
    target: TargetSchema.describe(
      "Who to send to. Pick one shape: { reply_to } | { user_id } | { user_ids[] } | { audience } | { filter } | { everyone: true }",
    ),
    message: MessageSchema.describe(
      "What to send. Pick one shape: { text } | { template, data } | { flex_json, alt_text } | { sticker } | { coupon_id }",
    ),
    mode: z
      .enum(["send_now", "draft", "dry_run"])
      .default("send_now")
      .describe(
        "send_now (default) sends immediately; draft returns a handoff package for LINE OA Manager UI; dry_run validates + estimates without sending.",
      ),
    oa: z.string().optional().describe("OA id (multi-OA). Omit to use active OA."),
    confirm: z
      .boolean()
      .default(false)
      .describe(
        "Required to be true when projected cost > 95% of remaining quota, or when target.everyone === true.",
      ),
    force: z
      .boolean()
      .default(false)
      .describe(
        "Override quiet-hours warning (22:00–08:00 BKK). Defaults false; LINE Thai customers prefer not to be pinged at night.",
      ),
    quiet_push: z
      .boolean()
      .default(false)
      .describe("Suppress push notification on recipient device (silent send). Default false."),
  })
  .strict();

type Input = z.infer<typeof InputSchema>;

// ---- helpers ----

function buildLineMessages(message: Input["message"]): LineMessage[] {
  if ("text" in message) {
    return [{ type: "text", text: message.text }];
  }
  if ("sticker" in message) {
    return [
      {
        type: "sticker",
        packageId: message.sticker.package_id,
        stickerId: message.sticker.sticker_id,
      },
    ];
  }
  if ("coupon_id" in message) {
    const coupon: Record<string, unknown> = {
      type: "coupon",
      couponId: message.coupon_id,
    };
    if (message.delivery_tag) coupon.deliveryTag = message.delivery_tag;
    return [coupon as unknown as LineMessage];
  }
  if ("image" in message) {
    return [
      {
        type: "image",
        originalContentUrl: message.image.original_content_url,
        previewImageUrl: message.image.preview_image_url,
      },
    ];
  }
  if ("video" in message) {
    const video: Record<string, unknown> = {
      type: "video",
      originalContentUrl: message.video.original_content_url,
      previewImageUrl: message.video.preview_image_url,
    };
    if (message.video.tracking_id) video.trackingId = message.video.tracking_id;
    return [video as unknown as LineMessage];
  }
  if ("message_json" in message) {
    const obj = message.message_json as Record<string, unknown>;
    if (typeof obj.type !== "string" || obj.type.length === 0) {
      throw new Error(
        "message_json ต้องมี field `type` (เช่น imagemap, template, flex) — ใช้ output จาก line_design_imagemap / line_design_card / line_design_flex",
      );
    }
    return [obj as unknown as LineMessage];
  }
  if ("template" in message) {
    const flex = renderTemplate(message.template, message.data ?? {});
    if (message.alt_text) flex.altText = message.alt_text;
    return [flex];
  }
  // flex_json
  const flex: LineFlexMessage = {
    type: "flex",
    altText: message.alt_text,
    contents: message.flex_json as Record<string, unknown>,
  };
  return [flex];
}

function estimateRecipients(target: SendTarget, estimatedFromTransport?: number): number {
  if ("user_id" in target) return 1;
  if ("user_ids" in target) return target.user_ids.length;
  if ("reply_to" in target) return 1;
  if (estimatedFromTransport !== undefined) return estimatedFromTransport;
  // Narrowcast / broadcast — unknown, use 0 so the Quota Guardian doesn't false-block.
  // The user must `confirm: true` for `everyone: true` per schema.
  return 0;
}

// ---- registration ----

export function registerSendMessageTool(server: McpServer): void {
  server.registerTool(
    "line_send_message",
    {
      title: "Send LINE Message (universal)",
      description: `Send any LINE message to any target. Picks the right LINE API automatically (reply / push / multicast / narrowcast / broadcast) based on the shape of \`target\`.

Three modes (parameter \`mode\`):
  - send_now (default): Send immediately. Pre-flight validation + Quota Guardian + quiet-hours check are applied.
  - draft: DO NOT SEND. Return a "handoff package" with audience id, Flex JSON, a LINE OA Manager broadcast URL, and 6 click-through steps. Use this when the user wants to SCHEDULE — LINE OA Manager UI has native scheduling that Messaging API lacks.
  - dry_run: Validate + estimate cost only. Useful before \`confirm\` flows.

Target shapes (pick one):
  - { reply_to: "webhookEventId" }          — reply (1 user, free, 30s window)
  - { user_id: "U..." }                      — push to one
  - { user_ids: ["U...", "U..."] }           — multicast (auto-chunked to 500/call)
  - { audience: "name-or-id" }               — narrowcast by audience group
  - { filter: { ages, genders, areas, ... } } — narrowcast by demographic
  - { everyone: true }                       — broadcast (requires confirm: true)

Message shapes (pick one):
  - { text: "..." }                          — plain text (≤5000 chars)
  - { template: "voucher", data: {...} }     — pre-built Thai-localized Flex template
  - { flex_json: {...}, alt_text: "..." }    — raw Flex JSON (advanced)
  - { sticker: { package_id, sticker_id } }  — LINE sticker
  - { coupon_id: "01..." , delivery_tag? }   — native LINE coupon (from line_manage_coupon)

Auto-applied safety:
  - Pre-flight validation via LINE /validate (catches JSON errors before consuming quota)
  - Quota Guardian: blocks if projected cost > 95% of remaining quota unless confirm=true
  - Quiet-hours warning (22:00–08:00 BKK) unless force=true
  - Reply-token TTL handling: falls back to push if token is expired (with a warning)
  - Auto-generated X-Line-Retry-Key for safe retries

Returns (varies by mode):
  send_now → { success, transport, request_id?, recipient_count_estimated, quota, warnings[], next_steps? }
  draft    → { draft: true, oa_manager_url, audience_summary, flex_json_pretty, flex_preview_url, copy_paste_steps[], notes }
  dry_run  → { dry_run: true, transport, validated, projected_recipients, projected_cost_messages, quota, warnings[] }

Examples:
  - "ส่งข้อความให้คุณ A" → { target: { user_id: "U..." }, message: { text: "..." } }
  - "ออกแบบโปรวันแม่ + เตรียม schedule" → { target: { audience: "moms" }, message: { template: "promo_simple", data: {...} }, mode: "draft" }
  - "ส่งโปรให้ผู้หญิง 25-44 กรุงเทพ" → { target: { filter: { genders: ["female"], ages: ["age_25", "age_30"], areas: ["bangkok"] } }, message: {...} }

Errors:
  - QUOTA_OVER → Reduce audience or wait for monthly reset
  - QUIET_HOURS → Pass force=true or use mode=draft to schedule
  - INVALID_MESSAGE → Pre-validation caught a JSON error; check details
  - AUDIENCE_NOT_READY → Wait ~10 minutes after audience creation`,
      inputSchema: InputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (raw: unknown) => {
      const params: Input = InputSchema.parse(raw);
      try {
        const { id: oaId, config } = resolveOa(params.oa);
        const client = new LineClient({ channelAccessToken: config.channel_access_token });

        const messages = buildLineMessages(params.message);

        // Attach silent-send hint per message if requested.
        if (params.quiet_push) {
          for (const m of messages) {
            (m as unknown as Record<string, unknown>).notificationDisabled = true;
          }
        }

        // Quiet hours warning
        const quiet = quietHoursCheck(params.force);

        // Resolve transport
        const picked = pickTransport({ client, target: params.target });

        // Validate FIRST (cheap; avoids burning quota on JSON errors)
        await picked.validate(messages);

        // Estimate cost
        const projected = estimateRecipients(params.target, picked.estimatedRecipients);

        // ----- mode: dry_run -----
        if (params.mode === "dry_run") {
          const quota = await snapshotQuota(client);
          const out: DryRunOutput = {
            dry_run: true,
            transport: picked.transport,
            validated: true,
            projected_recipients: picked.estimatedRecipients ?? projected,
            projected_cost_messages: picked.estimatedRecipients ?? projected,
            quota,
            warnings: [
              ...(quiet.warning ? [quiet.warning] : []),
            ],
          };
          return textAndStructured(JSON.stringify(out, null, 2), out as unknown as Record<string, unknown>);
        }

        // ----- mode: draft -----
        if (params.mode === "draft") {
          const draft = await buildDraftPackage({
            oaId,
            displayName: config.display_name ?? oaId,
            target: params.target,
            messages,
            quietWarning: quiet.warning,
          });
          return textAndStructured(renderDraftMarkdown(draft), draft as unknown as Record<string, unknown>);
        }

        // ----- mode: send_now -----
        // Quota guardian
        const guard = await checkQuota({
          client,
          projectedMessages: projected,
          confirm: params.confirm,
        });
        if (!guard.ok) {
          return {
            isError: true,
            content: [{ type: "text", text: guard.message }],
          };
        }

        // Confirm explicitly for broadcast-all
        if ("everyone" in params.target && !params.confirm) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: "⚠️ Broadcast ถึงทุกคนใน OA ต้องระบุ confirm=true",
              },
            ],
          };
        }

        const result = await picked.send(messages, { retryKey: client.retryKey() });

        const output: SendResultOutput = {
          success: true,
          transport: picked.transport,
          request_id: result.request_id,
          recipient_count_estimated: picked.estimatedRecipients ?? projected,
          quota: guard.snapshot,
          warnings: [
            ...guard.warnings,
            ...(quiet.warning ? [quiet.warning] : []),
          ],
          next_steps:
            picked.transport === "narrowcast"
              ? `รออย่างน้อย 24 ชม. แล้วใช้ line_get_message_stats ดู engagement (request_id: ${result.request_id ?? "n/a"})`
              : undefined,
        };

        const text = `${TH.sentSuccessfully(picked.transport, output.recipient_count_estimated)}${
          output.warnings.length ? `\n\n${output.warnings.join("\n")}` : ""
        }`;
        return textAndStructured(text, output as unknown as Record<string, unknown>);
      } catch (err) {
        return errorReply(err);
      }
    },
  );
}

// ---- draft helpers ----

interface DraftInput {
  oaId: string;
  displayName: string;
  target: SendTarget;
  messages: LineMessage[];
  quietWarning?: string;
}

async function buildDraftPackage(input: DraftInput): Promise<DraftResultOutput> {
  const oaManagerUrl = `https://manager.line.biz/account/${input.oaId.startsWith("@") ? input.oaId : `@${input.oaId}`}/broadcast/`;
  const flex = input.messages.find((m) => m.type === "flex") as LineFlexMessage | undefined;
  const flexJsonPretty = flex ? JSON.stringify(flex.contents, null, 2) : undefined;
  const flexPreviewUrl = flex
    ? `https://developers.line.biz/flex-simulator/?json=${encodeURIComponent(JSON.stringify(flex.contents))}`
    : undefined;

  const audienceSummary =
    "audience" in input.target
      ? { id: input.target.audience, name: input.target.audience }
      : undefined;

  const copyPasteSteps: string[] = [
    `1. เปิด LINE OA Manager: ${oaManagerUrl}`,
    `2. กด "ส่งใหม่" (New broadcast)`,
    audienceSummary
      ? `3. ในช่อง "ผู้รับ" — เลือก "Audience" → เลือก "${audienceSummary.name}"`
      : `3. เลือกผู้รับ (Audience / Filter / All friends) ตามที่ต้องการ`,
    flex
      ? `4. เปลี่ยน message type เป็น "Flex" → paste JSON ด้านล่าง`
      : `4. เลือก message type (text / sticker / image) → ใส่เนื้อหา`,
    `5. กด "ตั้งเวลา" → เลือกวันที่และเวลา (แนะนำ 11:00–13:00 หรือ 19:00–21:00 BKK)`,
    `6. กด "บันทึก" หรือ "Save"`,
  ];

  return {
    draft: true,
    oa_manager_url: oaManagerUrl,
    audience_summary: audienceSummary,
    flex_json_pretty: flexJsonPretty,
    flex_preview_url: flexPreviewUrl,
    copy_paste_steps: copyPasteSteps,
    notes: input.quietWarning ?? "พร้อม schedule แล้ว — เปิด LINE OA Manager แล้วทำตามขั้นตอน",
  };
}

function renderDraftMarkdown(d: DraftResultOutput): string {
  const lines: string[] = ["# 📋 Draft พร้อม schedule ใน LINE OA Manager", ""];
  lines.push(`**Open OA Manager:** ${d.oa_manager_url}`);
  if (d.audience_summary) {
    lines.push(`**Audience:** ${d.audience_summary.name}`);
  }
  lines.push("");
  lines.push("## ขั้นตอน 6 ขั้น");
  for (const step of d.copy_paste_steps) lines.push(step);
  if (d.flex_preview_url) {
    lines.push("");
    lines.push(`**Preview Flex:** ${d.flex_preview_url}`);
  }
  if (d.flex_json_pretty) {
    lines.push("");
    lines.push("## Flex JSON (copy-paste)");
    lines.push("```json");
    lines.push(d.flex_json_pretty);
    lines.push("```");
  }
  lines.push("");
  lines.push(`> ${d.notes}`);
  return lines.join("\n");
}

// ---- shared response helpers ----

function textAndStructured(
  text: string,
  structured: Record<string, unknown>,
): {
  content: { type: "text"; text: string }[];
  structuredContent: Record<string, unknown>;
} {
  return {
    content: [{ type: "text", text }],
    structuredContent: structured,
  };
}

function errorReply(err: unknown): {
  content: { type: "text"; text: string }[];
  isError: true;
} {
  if (err instanceof LineApiError) {
    const detail = err.details.length ? `\n${err.details.join("\n")}` : "";
    return {
      isError: true,
      content: [{ type: "text", text: `${err.message}${detail}` }],
    };
  }
  if (err instanceof z.ZodError) {
    return {
      isError: true,
      content: [
        { type: "text", text: `❌ Invalid input:\n${err.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n")}` },
      ],
    };
  }
  const msg = err instanceof Error ? err.message : String(err);
  return {
    isError: true,
    content: [{ type: "text", text: TH.unknownError(msg) }],
  };
}
