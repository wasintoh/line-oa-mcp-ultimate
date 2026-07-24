/**
 * Tool: line_list_rich_menus
 *
 * List all rich menus on an OA + identify which one is the account-wide
 * default. Used to inspect state before line_build_rich_menu (you might want
 * to delete the old one first to stay within the 1,000-menu cap).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveOa } from "../config/multi-oa.js";
import { LineApiError, LineClient } from "../line/client.js";
import { TH } from "../i18n/th.js";

const InputSchema = z
  .object({
    oa: z.string().optional(),
    response_format: z.enum(["markdown", "json"]).default("markdown"),
  })
  .strict();

export function registerListRichMenusTool(server: McpServer): void {
  server.registerTool(
    "line_list_rich_menus",
    {
      title: "List LINE Rich Menus",
      description: `List all rich menus on an OA and identify the account-wide default. OAs hold up to 1,000 rich menus — run this before line_build_rich_menu to avoid the cap, and line_delete_rich_menu to clean up.

Returns { total, default_id?, rich_menus:[{ rich_menu_id, name, chat_bar_text?, size?, is_default, is_selected }] }.`,
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

        const [listRes, defaultRes] = await Promise.allSettled([
          client.listRichMenus(),
          client.getDefaultRichMenu(),
        ]);

        const menus = listRes.status === "fulfilled" ? listRes.value.richmenus : [];
        const defaultId =
          defaultRes.status === "fulfilled" && defaultRes.value
            ? defaultRes.value.richMenuId
            : undefined;

        const output = {
          total: menus.length,
          default_id: defaultId,
          rich_menus: menus.map((m) => ({
            rich_menu_id: m.richMenuId,
            name: m.name,
            chat_bar_text: m.chatBarText,
            size: m.size,
            is_default: m.richMenuId === defaultId,
            is_selected: m.selected,
          })),
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

function renderMd(o: { total: number; default_id?: string; rich_menus: Array<{ rich_menu_id: string; name: string; chat_bar_text?: string; size?: { width: number; height: number }; is_default: boolean; is_selected: boolean }> }): string {
  if (!o.rich_menus.length) {
    return "_ยังไม่มี Rich Menu บน OA นี้ — ใช้ line_build_rich_menu สร้างได้เลย_";
  }
  const lines: string[] = [`# 🎨 Rich Menus (${o.total})`, ""];
  for (const m of o.rich_menus) {
    const star = m.is_default ? "⭐ (default) " : "";
    const sz = m.size ? `${m.size.width}x${m.size.height}` : "?";
    lines.push(`## ${star}${m.name}`);
    lines.push(`- **ID:** \`${m.rich_menu_id}\``);
    if (m.chat_bar_text) lines.push(`- **Chat bar text:** ${m.chat_bar_text}`);
    lines.push(`- **Size:** ${sz}`);
    lines.push("");
  }
  return lines.join("\n");
}
