/**
 * Tool: line_list_audiences
 *
 * Read-side companion to line_send_message — discover audience groups available
 * for narrowcast targeting. Importantly: audiences created via LINE OA Manager
 * UI (including the chat-tag audiences that pi3 Toh asked about) ALSO appear
 * here, because they share the same Audience Group resource on LINE's side.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "../constants.js";
import { resolveOa } from "../config/multi-oa.js";
import { LineApiError, LineClient } from "../line/client.js";
import { TH } from "../i18n/th.js";

const InputSchema = z
  .object({
    status_filter: z
      .enum(["all", "READY", "IN_PROGRESS", "FAILED", "EXPIRED"])
      .default("all")
      .describe("Filter audiences by readiness status. Default 'all'."),
    name_contains: z
      .string()
      .optional()
      .describe("Optional substring filter on audience name (case-insensitive)."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_PAGE_LIMIT)
      .default(DEFAULT_PAGE_LIMIT)
      .describe(`Page size (max ${MAX_PAGE_LIMIT}).`),
    page: z
      .number()
      .int()
      .min(1)
      .default(1)
      .describe("Page number (1-indexed)."),
    oa: z.string().optional(),
    response_format: z.enum(["markdown", "json"]).default("markdown"),
  })
  .strict();

type Input = z.infer<typeof InputSchema>;

interface AudienceItem {
  audience_group_id: number;
  name: string;
  status: string;
  audience_count?: number;
  created: number;
  type?: string;
}

export function registerListAudiencesTool(server: McpServer): void {
  server.registerTool(
    "line_list_audiences",
    {
      title: "List LINE Audiences",
      description: `List audience groups on the OA. Audiences created via LINE OA Manager UI (e.g. chat-tag audiences, friend-path audiences, web-traffic audiences) also appear here — even though those types cannot be CREATED via Messaging API.

Status meanings:
  - READY: usable in narrowcast immediately
  - IN_PROGRESS: still indexing — wait ~10 minutes
  - FAILED: creation failed; recreate
  - EXPIRED: aged out; recreate

Args:
  - status_filter: 'all' (default) | 'READY' | 'IN_PROGRESS' | 'FAILED' | 'EXPIRED'.
  - name_contains: optional substring filter (case-insensitive).
  - limit, page: pagination (default 20/page).
  - oa: optional OA id.

Returns:
  {
    total: number,
    count: number,
    page: number,
    audiences: [{ audience_group_id, name, status, audience_count?, created, type? }],
    has_more: boolean
  }

Examples:
  - "ดู audience ที่พร้อมส่ง" → { status_filter: "READY" }
  - "หา audience ชื่อ vip" → { name_contains: "vip" }`,
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

        const res = (await client.request("GET", "/v2/bot/audienceGroup/list", {
          query: {
            page: params.page,
            size: params.limit,
            ...(params.status_filter !== "all" ? { status: params.status_filter } : {}),
            ...(params.name_contains ? { description: params.name_contains } : {}),
          },
        })) as {
          audienceGroups?: Array<{
            audienceGroupId: number;
            description: string;
            status: string;
            audienceCount?: number;
            created: number;
            type?: string;
          }>;
          totalCount?: number;
        };

        const audiences: AudienceItem[] = (res.audienceGroups ?? []).map((a) => ({
          audience_group_id: a.audienceGroupId,
          name: a.description,
          status: a.status,
          audience_count: a.audienceCount,
          created: a.created,
          type: a.type,
        }));
        const total = res.totalCount ?? audiences.length;
        const output = {
          total,
          count: audiences.length,
          page: params.page,
          audiences,
          has_more: total > params.page * params.limit,
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
        if (err instanceof LineApiError) {
          return { isError: true, content: [{ type: "text", text: err.message }] };
        }
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: TH.unknownError(msg) }] };
      }
    },
  );
}

function renderMarkdown(o: {
  total: number;
  count: number;
  page: number;
  audiences: AudienceItem[];
  has_more: boolean;
}): string {
  if (!o.audiences.length) {
    return "_(ไม่มี audience ที่ตรงกับเงื่อนไข)_";
  }
  const lines: string[] = [`# 🎯 Audiences (${o.count} จาก ${o.total} — หน้า ${o.page})`, ""];
  lines.push("| ID | Status | ขนาด | ชื่อ |");
  lines.push("|---|---|---:|---|");
  for (const a of o.audiences) {
    const size = a.audience_count !== undefined ? a.audience_count.toLocaleString() : "-";
    lines.push(`| ${a.audience_group_id} | ${a.status} | ${size} | ${a.name} |`);
  }
  if (o.has_more) {
    lines.push("");
    lines.push(`_มีหน้าถัดไป — ใช้ page: ${o.page + 1}_`);
  }
  return lines.join("\n");
}
