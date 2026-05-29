/**
 * Tool: line_get_message_stats
 *
 * Per-broadcast engagement stats — impressions, opens, clicks, CTR. Answers
 * the SMB's #1 ROI question: "broadcast เมื่อสัปดาห์ที่แล้วได้คลิกกี่คน?"
 *
 * Data has a T-1 (24h) lag, and is null below ~20 unique users (privacy
 * floor). We surface both caveats clearly.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveOa } from "../config/multi-oa.js";
import { LineApiError, LineClient } from "../line/client.js";
import { TH } from "../i18n/th.js";

const InputSchema = z
  .object({
    request_id: z
      .string()
      .min(1)
      .describe(
        "request_id returned by a prior line_send_message (narrowcast/multicast/broadcast).",
      ),
    oa: z.string().optional(),
    response_format: z.enum(["markdown", "json"]).default("markdown"),
  })
  .strict();

interface OverviewBlock {
  requestId?: string;
  timestamp?: number;
  delivered?: number;
  uniqueImpression?: number | null;
  uniqueClick?: number | null;
  uniqueMediaPlayed?: number | null;
  uniqueMediaPlayed100Percent?: number | null;
}

interface MessageBlock {
  seq?: number;
  impression?: number | null;
  mediaPlayed?: number | null;
  mediaPlayed25Percent?: number | null;
  mediaPlayed50Percent?: number | null;
  mediaPlayed75Percent?: number | null;
  mediaPlayed100Percent?: number | null;
  uniqueImpression?: number | null;
  uniqueMediaPlayed?: number | null;
  uniqueMediaPlayed25Percent?: number | null;
  uniqueMediaPlayed50Percent?: number | null;
  uniqueMediaPlayed75Percent?: number | null;
  uniqueMediaPlayed100Percent?: number | null;
}

interface ClickBlock {
  seq?: number;
  url?: string;
  click?: number | null;
  uniqueClick?: number | null;
  uniqueClickOfRequest?: number | null;
}

interface RawEvent {
  overview?: OverviewBlock;
  messages?: MessageBlock[];
  clicks?: ClickBlock[];
}

export function registerGetMessageStatsTool(server: McpServer): void {
  server.registerTool(
    "line_get_message_stats",
    {
      title: "Get LINE message engagement stats",
      description: `Fetch per-broadcast engagement stats for a specific request_id: impressions, opens, clicks, CTR, and per-URL click breakdown.

Args:
  - request_id: From a prior line_send_message return value.
  - oa: optional OA id.
  - response_format: 'markdown' (default) | 'json'.

Returns (structured):
  {
    request_id,
    delivered?: number,
    unique_impression?: number,    // null if below ~20-user privacy floor
    unique_click?: number,
    ctr_percent?: number,
    per_url_clicks: [{ url, click, unique_click }],
    notes: string[]                // T-1 lag note, privacy-floor note
  }

Important caveats (surfaced in notes):
  - 24-hour data lag — stats stabilize ~T+1 after send.
  - Below ~20 unique users, LINE returns null for privacy.
  - Available only for narrowcast / multicast / broadcast (not reply / push to single user).`,
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
        const data = (await client.getMessageEvent(params.request_id)) as RawEvent;

        const overview = data.overview ?? {};
        const clicks = data.clicks ?? [];
        const uniqueImpression = overview.uniqueImpression ?? null;
        const uniqueClick = overview.uniqueClick ?? null;
        const ctr =
          typeof uniqueImpression === "number" && uniqueImpression > 0 && typeof uniqueClick === "number"
            ? Math.round((uniqueClick / uniqueImpression) * 1000) / 10
            : null;

        const perUrl = clicks.map((c) => ({
          url: c.url,
          click: c.click,
          unique_click: c.uniqueClick,
        }));

        const notes: string[] = [
          "ℹ️ ข้อมูลมี T-1 lag — ของวันนี้/เมื่อวานอาจยังไม่ครบ",
        ];
        if (uniqueImpression === null) {
          notes.push("🔒 unique_impression = null — broadcast นี้อาจมีผู้รับน้อยกว่า ~20 คน (privacy floor)");
        }

        const output = {
          request_id: params.request_id,
          delivered: overview.delivered,
          unique_impression: uniqueImpression,
          unique_click: uniqueClick,
          ctr_percent: ctr,
          per_url_clicks: perUrl,
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
  request_id: string;
  delivered?: number;
  unique_impression?: number | null;
  unique_click?: number | null;
  ctr_percent?: number | null;
  per_url_clicks: { url?: string; click?: number | null; unique_click?: number | null }[];
  notes: string[];
}): string {
  const lines: string[] = [`# 📈 Message stats — \`${o.request_id}\``, ""];
  if (typeof o.delivered === "number") lines.push(`- **Delivered:** ${o.delivered.toLocaleString()}`);
  lines.push(`- **Unique impressions:** ${o.unique_impression ?? "—"}`);
  lines.push(`- **Unique clicks:** ${o.unique_click ?? "—"}`);
  lines.push(`- **CTR:** ${o.ctr_percent !== null ? `${o.ctr_percent}%` : "—"}`);
  if (o.per_url_clicks.length) {
    lines.push("");
    lines.push("## Per-URL clicks");
    lines.push("| URL | Clicks | Unique |");
    lines.push("|---|---:|---:|");
    for (const c of o.per_url_clicks) {
      lines.push(`| ${c.url ?? "—"} | ${c.click ?? "—"} | ${c.unique_click ?? "—"} |`);
    }
  }
  if (o.notes.length) {
    lines.push("");
    lines.push("## Notes");
    for (const n of o.notes) lines.push(`- ${n}`);
  }
  return lines.join("\n");
}
