/**
 * Tool: line_delete_rich_menu
 *
 * Delete a rich menu by ID. The account-wide default is preserved until you
 * explicitly clear it via line_build_rich_menu(set_as_default=true) for a new
 * menu, or via raw API call.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveOa } from "../config/multi-oa.js";
import { LineApiError, LineClient } from "../line/client.js";
import { TH } from "../i18n/th.js";

const InputSchema = z
  .object({
    rich_menu_id: z.string().min(1),
    confirm: z
      .boolean()
      .default(false)
      .describe("Required true. Deletion is irreversible."),
    oa: z.string().optional(),
  })
  .strict();

export function registerDeleteRichMenuTool(server: McpServer): void {
  server.registerTool(
    "line_delete_rich_menu",
    {
      title: "Delete LINE Rich Menu",
      description: `Delete a rich menu by ID. Requires confirm=true (guards against prompt drift). If the menu is linked to specific users those links break silently — consider line_audit_user_menu first.

Returns { success, deleted_id }.`,
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
                text: `⚠️ ต้องตั้ง confirm=true ก่อนลบ Rich Menu (\`${params.rich_menu_id}\`)`,
              },
            ],
          };
        }
        const { config } = resolveOa(params.oa);
        const client = new LineClient({ channelAccessToken: config.channel_access_token });
        await client.deleteRichMenu(params.rich_menu_id);
        return {
          content: [
            { type: "text", text: `🗑 ลบ Rich Menu \`${params.rich_menu_id}\` สำเร็จ` },
          ],
          structuredContent: { success: true, deleted_id: params.rich_menu_id },
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
