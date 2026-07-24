/**
 * Tool: line_list_followers
 *
 * Page through every user that added the OA as a friend. Region-gated to
 * JP / TW / TH (+ premium account requirement). LINE returns IDs only — no
 * profile data — use line_get_user_profile to enrich individually.
 *
 * For 50k+ followers, prefer building an audience and using it for retargeting
 * instead of pulling all IDs.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveOa } from "../config/multi-oa.js";
import { LineApiError, LineClient } from "../line/client.js";
import { TH } from "../i18n/th.js";

const InputSchema = z
  .object({
    page_size: z.number().int().min(1).max(1000).default(300),
    continuation_token: z
      .string()
      .optional()
      .describe("Token returned by a prior call to page through more results."),
    oa: z.string().optional(),
    response_format: z.enum(["markdown", "json"]).default("markdown"),
  })
  .strict();

export function registerListFollowersTool(server: McpServer): void {
  server.registerTool(
    "line_list_followers",
    {
      title: "List LINE OA followers",
      description: `Page through every user that has added the OA as a friend. Region-gated: only TH/JP/TW OAs on premium tier — others get LINE 403. page_size 1-1000 (default 300); continuation_token for cursor pagination. For very large OAs (50k+), prefer an engagement audience via line_build_audience_from_engagement over pulling all IDs.

Returns { user_ids[], count, has_more, next_continuation_token? }.`,
      inputSchema: InputSchema.shape,
      annotations: {
        readOnlyHint: true,
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
        const res = await client.listFollowerIds(params.continuation_token, params.page_size);
        const output = {
          user_ids: res.userIds,
          count: res.userIds.length,
          has_more: Boolean(res.next),
          next_continuation_token: res.next,
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

function renderMd(o: { user_ids: string[]; count: number; has_more: boolean; next_continuation_token?: string }): string {
  const lines = [`# 👥 Followers (${o.count} on this page)`, ""];
  for (const id of o.user_ids.slice(0, 50)) lines.push(`- \`${id}\``);
  if (o.user_ids.length > 50) lines.push(`- _... และอีก ${o.user_ids.length - 50} ราย_`);
  if (o.has_more) {
    lines.push("");
    lines.push(`**Next page token:** \`${o.next_continuation_token}\``);
  }
  return lines.join("\n");
}
