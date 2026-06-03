/**
 * Tool: line_get_oa_status
 *
 * The "first thing every user asks" tool. Bundles bot info, quota, webhook
 * status, and default rich menu into a single compact health card.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveOa } from "../config/multi-oa.js";
import { LineClient, LineApiError } from "../line/client.js";
import { snapshotQuota } from "../line/quota-guardian.js";
import { TH } from "../i18n/th.js";
import type { OaStatusOutput } from "../types.js";

const InputSchema = z
  .object({
    oa: z
      .string()
      .optional()
      .describe(
        "Optional OA id from the multi-OA config. Omit to use the active/default OA.",
      ),
    response_format: z
      .enum(["markdown", "json"])
      .default("markdown")
      .describe("Output format. 'markdown' is human-readable; 'json' is structured."),
  })
  .strict();

type Input = z.infer<typeof InputSchema>;

export function registerGetOaStatusTool(server: McpServer): void {
  server.registerTool(
    "line_get_oa_status",
    {
      title: "Get LINE OA Status",
      description: `Quick health check of a LINE Official Account: friend count, monthly quota usage, webhook status, and current default rich menu. Aggregates 4 LINE API calls into one card.

Use this as the first call of a session — every other tool decision (whether to send, schedule, switch OA, etc.) benefits from knowing current quota and webhook state.

Args:
  - oa (string, optional): OA id from multi-OA config. Default = active OA.
  - response_format ('markdown' | 'json'): Output format. Default 'markdown'.

Returns:
  Structured object:
  {
    oa: { id, display_name, picture_url? },
    friends?: number,         // omitted if not retrievable
    quota: { used, total, remaining, percentage_used },
    webhook: { active, url? },
    default_rich_menu?: { id, name? },
    region?: string,
    health: 'OK' | 'WARNING' | 'ERROR',
    warnings: string[]
  }

Examples:
  - "ดูสถานะ OA หน่อย" → call with no args
  - "Status ของ Client A" → { oa: "client_a" }`,
      inputSchema: InputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: Input) => {
      try {
        const { id, config } = resolveOa(params.oa);
        const client = new LineClient({
          channelAccessToken: config.channel_access_token,
        });

        // Parallel fetch — quota is two calls inside snapshotQuota.
        const [botInfo, quota, webhook, defaultMenuRef] = await Promise.allSettled([
          client.getBotInfo(),
          snapshotQuota(client),
          client.getWebhookEndpoint(),
          client.getDefaultRichMenu(),
        ]);

        const warnings: string[] = [];

        const oaInfo =
          botInfo.status === "fulfilled"
            ? {
                id: botInfo.value.basicId ?? botInfo.value.userId,
                display_name: botInfo.value.displayName,
                picture_url: botInfo.value.pictureUrl,
              }
            : {
                id,
                display_name: config.display_name ?? id,
              };
        if (botInfo.status === "rejected") {
          warnings.push("⚠️ ดึง bot info ไม่ได้ — ใช้ค่าจาก config แทน");
        }

        const quotaSnap =
          quota.status === "fulfilled"
            ? quota.value
            : {
                used: 0,
                total: "unlimited" as const,
                remaining: "unlimited" as const,
                percentage_used: 0,
              };
        if (quota.status === "rejected") {
          warnings.push("⚠️ ดึง quota ไม่ได้");
        }

        const webhookSnap =
          webhook.status === "fulfilled"
            ? { active: webhook.value.active, url: webhook.value.endpoint }
            : { active: false };
        if (webhook.status === "rejected") {
          warnings.push("⚠️ ดึง webhook info ไม่ได้");
        }

        const defaultMenu =
          defaultMenuRef.status === "fulfilled" && defaultMenuRef.value
            ? { id: defaultMenuRef.value.richMenuId }
            : undefined;

        const chatMode =
          botInfo.status === "fulfilled" ? botInfo.value.chatMode : undefined;
        const markAsReadMode =
          botInfo.status === "fulfilled" ? botInfo.value.markAsReadMode : undefined;

        const health: OaStatusOutput["health"] =
          warnings.length === 0 ? "OK" : warnings.length < 2 ? "WARNING" : "ERROR";

        const output: OaStatusOutput = {
          oa: oaInfo,
          quota: quotaSnap,
          webhook: webhookSnap,
          default_rich_menu: defaultMenu,
          chat_mode: chatMode,
          mark_as_read_mode: markAsReadMode,
          region: config.region,
          health,
          warnings,
        };

        const text =
          params.response_format === "json"
            ? JSON.stringify(output, null, 2)
            : renderMarkdown(output);

        return {
          content: [{ type: "text", text }],
          structuredContent: output as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return errorReply(err);
      }
    },
  );
}

function renderMarkdown(o: OaStatusOutput): string {
  const lines: string[] = [];
  const icon = o.health === "OK" ? "✅" : o.health === "WARNING" ? "🟡" : "🔴";
  lines.push(`# ${icon} ${o.oa.display_name} (${o.oa.id})`);
  lines.push("");
  if (typeof o.friends === "number") {
    lines.push(`- 👥 Friends: **${o.friends.toLocaleString()}**`);
  }
  const q = o.quota;
  const totalStr = q.total === "unlimited" ? "ไม่จำกัด" : q.total.toLocaleString();
  const remStr = q.remaining === "unlimited" ? "ไม่จำกัด" : q.remaining.toLocaleString();
  lines.push(`- 📊 Quota: **${q.used.toLocaleString()} / ${totalStr}** (เหลือ ${remStr}, ใช้ไป ${q.percentage_used}%)`);
  if (o.webhook) {
    const w = o.webhook;
    lines.push(`- 🔌 Webhook: ${w.active ? "✅ active" : "⛔ inactive"}${w.url ? ` — ${w.url}` : ""}`);
  }
  if (o.default_rich_menu) {
    lines.push(`- 🎨 Default Rich Menu: ${o.default_rich_menu.id}`);
  } else {
    lines.push("- 🎨 Default Rich Menu: (ไม่มี — ใช้ line_build_rich_menu สร้าง)");
  }
  if (o.chat_mode) {
    const modeLabel =
      o.chat_mode === "bot" ? "bot (ตอบอัตโนมัติผ่าน API)" : "chat (เปิดแชทให้คนตอบ)";
    lines.push(
      `- 💬 Chat mode: ${modeLabel}${o.mark_as_read_mode ? ` · mark-as-read: ${o.mark_as_read_mode}` : ""}`,
    );
  }
  if (o.region) {
    lines.push(`- 🌏 Region: ${o.region}`);
  }
  if (o.warnings.length) {
    lines.push("");
    lines.push("## Warnings");
    for (const w of o.warnings) lines.push(`- ${w}`);
  }
  return lines.join("\n");
}

function errorReply(err: unknown): {
  content: { type: "text"; text: string }[];
  isError: true;
} {
  if (err instanceof LineApiError) {
    return {
      isError: true,
      content: [{ type: "text", text: err.message }],
    };
  }
  const msg = err instanceof Error ? err.message : String(err);
  return {
    isError: true,
    content: [{ type: "text", text: TH.unknownError(msg) }],
  };
}
