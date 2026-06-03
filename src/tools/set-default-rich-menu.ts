/**
 * Tool: line_set_default_rich_menu
 *
 * Set or clear the account-wide default rich menu — the menu every user sees
 * unless they have a per-user menu linked (see line_link_rich_menu).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveOa } from "../config/multi-oa.js";
import { LineApiError, LineClient } from "../line/client.js";
import { TH } from "../i18n/th.js";

const InputSchema = z
  .object({
    mode: z
      .enum(["set", "clear"])
      .describe("set: make a rich menu the account-wide default; clear: remove the default."),
    rich_menu_id: z
      .string()
      .optional()
      .describe("Rich menu ID to set as default. Required for mode='set'; ignored for clear."),
    oa: z.string().optional().describe("Optional OA id; defaults to active OA."),
  })
  .strict();

export function registerSetDefaultRichMenuTool(server: McpServer): void {
  server.registerTool(
    "line_set_default_rich_menu",
    {
      title: "Set / clear the account-wide default LINE rich menu",
      description: `Set or clear the OA's default rich menu. The default menu shows to every follower who does not have a per-user menu linked (per-user links override the default).

Args:
  - mode: 'set' (assign a default) | 'clear' (remove the default).
  - rich_menu_id: Required for mode='set'; ignored for clear.
  - oa: Optional OA id.

Returns:
  {
    mode: "set" | "clear",
    rich_menu_id?: string   // present when mode='set'
  }

Examples:
  - "ตั้ง rich menu R123 เป็น default" → { mode: "set", rich_menu_id: "R123" }
  - "ลบ default rich menu" → { mode: "clear" }

Errors:
  - mode='set' without rich_menu_id → returns input error
  - 404 → rich_menu_id not found (set), or no default set (clear)`,
      inputSchema: InputSchema.shape,
      annotations: {
        readOnlyHint: false,
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

        if (params.mode === "set") {
          if (!params.rich_menu_id) {
            return {
              isError: true,
              content: [{ type: "text", text: "❌ mode='set' ต้องการ rich_menu_id" }],
            };
          }
          await client.setDefaultRichMenu(params.rich_menu_id);
          const output = { mode: "set" as const, rich_menu_id: params.rich_menu_id };
          return {
            content: [
              {
                type: "text",
                text: `✅ ตั้ง rich menu \`${params.rich_menu_id}\` เป็น default ทั้งบัญชีแล้ว`,
              },
            ],
            structuredContent: output as unknown as Record<string, unknown>,
          };
        }

        await client.clearDefaultRichMenu();
        const output = { mode: "clear" as const };
        return {
          content: [{ type: "text", text: "✅ ลบ default rich menu สำเร็จ" }],
          structuredContent: output as unknown as Record<string, unknown>,
        };
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
