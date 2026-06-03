/**
 * Tool: line_manage_rich_menu_alias
 *
 * Rich menu alias CRUD. Aliases are the backbone of tab-switching rich menus:
 * a `richmenuswitch` action targets a `richMenuAliasId`, and pointing that
 * alias at a different rich menu swaps the panel without re-linking users.
 * Five modes wrapped in one tool for compactness (mirrors line_manage_coupon).
 *
 * Alias API reference:
 *   https://developers.line.biz/en/reference/messaging-api/#create-rich-menu-alias
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveOa } from "../config/multi-oa.js";
import { LineApiError, LineClient } from "../line/client.js";
import { TH } from "../i18n/th.js";

const InputSchema = z
  .object({
    mode: z
      .enum(["create", "update", "delete", "get", "list"])
      .describe(
        "create: bind a new alias→menu; update: repoint an alias to another menu; delete: remove an alias; get: fetch one; list: list all.",
      ),
    alias_id: z
      .string()
      .optional()
      .describe("The rich menu alias ID. Required for all modes except 'list'."),
    rich_menu_id: z
      .string()
      .optional()
      .describe("Rich menu ID the alias points to. Required for mode='create' and 'update'."),
    oa: z.string().optional().describe("Optional OA id; defaults to active OA."),
  })
  .strict();

export function registerManageRichMenuAliasTool(server: McpServer): void {
  server.registerTool(
    "line_manage_rich_menu_alias",
    {
      title: "Manage LINE rich menu aliases (tab switching)",
      description: `Rich menu alias CRUD. Aliases power tab-switching rich menus: a 'richmenuswitch' action references a richMenuAliasId, and repointing that alias at a different rich menu swaps the displayed panel instantly — no per-user re-linking. Five modes:

  - create: Bind a new alias_id to a rich_menu_id.
  - update: Repoint an existing alias to a different rich_menu_id.
  - delete: Remove an alias (does not delete the underlying rich menu).
  - get: Fetch a single alias by alias_id.
  - list: List all aliases on the OA.

Args:
  - mode: 'create' | 'update' | 'delete' | 'get' | 'list'.
  - alias_id: Required for all modes except 'list'.
  - rich_menu_id: Required for 'create' and 'update'.
  - oa: Optional OA id.

Returns:
  - create/update/delete → { mode, alias_id, rich_menu_id? }
  - get → { richMenuAliasId, richMenuId }
  - list → { aliases: { richMenuAliasId, richMenuId }[] }

Examples:
  - "สร้าง alias tab-a ชี้ไป R123" → { mode: "create", alias_id: "tab-a", rich_menu_id: "R123" }
  - "เปลี่ยน alias tab-a ไปที่ R456" → { mode: "update", alias_id: "tab-a", rich_menu_id: "R456" }
  - "ดู alias ทั้งหมด" → { mode: "list" }
  - "ลบ alias tab-a" → { mode: "delete", alias_id: "tab-a" }

Errors:
  - missing alias_id (non-list modes) / missing rich_menu_id (create/update) → returns input error
  - 400 → alias_id already exists (create)
  - 404 → alias not found (update/delete/get)`,
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
            if (!params.alias_id) {
              return {
                isError: true,
                content: [{ type: "text", text: "❌ mode='create' ต้องการ alias_id" }],
              };
            }
            if (!params.rich_menu_id) {
              return {
                isError: true,
                content: [{ type: "text", text: "❌ mode='create' ต้องการ rich_menu_id" }],
              };
            }
            await client.createRichMenuAlias(params.alias_id, params.rich_menu_id);
            return {
              content: [
                {
                  type: "text",
                  text: `✅ สร้าง alias \`${params.alias_id}\` → \`${params.rich_menu_id}\` สำเร็จ`,
                },
              ],
              structuredContent: {
                mode: "create",
                alias_id: params.alias_id,
                rich_menu_id: params.rich_menu_id,
              },
            };
          }
          case "update": {
            if (!params.alias_id) {
              return {
                isError: true,
                content: [{ type: "text", text: "❌ mode='update' ต้องการ alias_id" }],
              };
            }
            if (!params.rich_menu_id) {
              return {
                isError: true,
                content: [{ type: "text", text: "❌ mode='update' ต้องการ rich_menu_id" }],
              };
            }
            await client.updateRichMenuAlias(params.alias_id, params.rich_menu_id);
            return {
              content: [
                {
                  type: "text",
                  text: `✅ เปลี่ยน alias \`${params.alias_id}\` → \`${params.rich_menu_id}\` สำเร็จ`,
                },
              ],
              structuredContent: {
                mode: "update",
                alias_id: params.alias_id,
                rich_menu_id: params.rich_menu_id,
              },
            };
          }
          case "delete": {
            if (!params.alias_id) {
              return {
                isError: true,
                content: [{ type: "text", text: "❌ mode='delete' ต้องการ alias_id" }],
              };
            }
            await client.deleteRichMenuAlias(params.alias_id);
            return {
              content: [{ type: "text", text: `🛑 ลบ alias \`${params.alias_id}\` สำเร็จ` }],
              structuredContent: { mode: "delete", alias_id: params.alias_id },
            };
          }
          case "get": {
            if (!params.alias_id) {
              return {
                isError: true,
                content: [{ type: "text", text: "❌ mode='get' ต้องการ alias_id" }],
              };
            }
            const alias = await client.getRichMenuAlias(params.alias_id);
            return {
              content: [
                {
                  type: "text",
                  text: `# Alias \`${alias.richMenuAliasId}\`\n- ชี้ไปที่: \`${alias.richMenuId}\``,
                },
              ],
              structuredContent: alias as unknown as Record<string, unknown>,
            };
          }
          case "list": {
            const res = await client.listRichMenuAliases();
            const aliases = res.aliases ?? [];
            return {
              content: [
                {
                  type: "text",
                  text:
                    `# Rich Menu Aliases (${aliases.length})\n\n` +
                    (aliases
                      .map((a) => `- \`${a.richMenuAliasId}\` → \`${a.richMenuId}\``)
                      .join("\n") || "_ไม่มี alias_"),
                },
              ],
              structuredContent: { aliases },
            };
          }
        }
      } catch (err) {
        return errorReply(err);
      }
    },
  );
}

function errorReply(err: unknown): { content: { type: "text"; text: string }[]; isError: true } {
  if (err instanceof LineApiError) {
    const detail = err.details.length
      ? `${err.message}\n${err.details.map((d) => `  • ${d}`).join("\n")}`
      : err.message;
    return { isError: true, content: [{ type: "text", text: detail }] };
  }
  if (err instanceof z.ZodError) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `❌ Invalid input:\n${err.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n")}`,
        },
      ],
    };
  }
  const msg = err instanceof Error ? err.message : String(err);
  return { isError: true, content: [{ type: "text", text: TH.unknownError(msg) }] };
}
