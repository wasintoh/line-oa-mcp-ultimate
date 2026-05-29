/**
 * Tool: line_delete_audience
 *
 * Delete an audience group by ID. Deletion is irreversible — requires
 * confirm=true.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveOa } from "../config/multi-oa.js";
import { LineApiError, LineClient } from "../line/client.js";
import { TH } from "../i18n/th.js";

const InputSchema = z
  .object({
    audience_group_id: z.number().int().positive(),
    confirm: z.boolean().default(false),
    oa: z.string().optional(),
  })
  .strict();

export function registerDeleteAudienceTool(server: McpServer): void {
  server.registerTool(
    "line_delete_audience",
    {
      title: "Delete LINE audience",
      description: `Delete an audience group. Irreversible — requires confirm=true.

Args:
  - audience_group_id: numeric ID (from line_list_audiences).
  - confirm: must be true to proceed.
  - oa: optional OA id.

Returns:
  { success: true, deleted_id }`,
      inputSchema: InputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (raw: unknown) => {
      try {
        const params = InputSchema.parse(raw);
        if (!params.confirm) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `⚠️ ต้องตั้ง confirm=true ก่อนลบ audience id ${params.audience_group_id}`,
              },
            ],
          };
        }
        const { config } = resolveOa(params.oa);
        const client = new LineClient({ channelAccessToken: config.channel_access_token });
        await client.deleteAudienceGroup(params.audience_group_id);
        return {
          content: [
            { type: "text", text: `🗑 ลบ audience id ${params.audience_group_id} สำเร็จ` },
          ],
          structuredContent: { success: true, deleted_id: params.audience_group_id },
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
