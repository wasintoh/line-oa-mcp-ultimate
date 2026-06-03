/**
 * Tool: line_link_rich_menu
 *
 * Link / unlink a rich menu to LINE users. Supports a single user (per-user
 * link/unlink endpoints) or a list of users (bulk link/unlink, auto-chunked
 * into batches of 500 because LINE rejects more than 500 IDs per call).
 *
 * Per-user link beats the account-wide default when both are set, so this is
 * how you give specific segments (e.g. paid members) a different menu.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveOa } from "../config/multi-oa.js";
import { LineApiError, LineClient } from "../line/client.js";
import { RICHMENU_BULK_MAX_USERS } from "../constants.js";
import { TH } from "../i18n/th.js";

const InputSchema = z
  .object({
    mode: z
      .enum(["link", "unlink"])
      .describe("link: attach a rich menu to user(s); unlink: detach the per-user menu (falls back to default)."),
    rich_menu_id: z
      .string()
      .optional()
      .describe("Rich menu ID. Required for mode='link'; ignored for unlink."),
    user_id: z
      .string()
      .optional()
      .describe("Single LINE user ID. Provide this OR user_ids (not both needed)."),
    user_ids: z
      .array(z.string())
      .optional()
      .describe("List of LINE user IDs. Uses the bulk endpoint, auto-chunked into batches of 500."),
    oa: z.string().optional().describe("Optional OA id; defaults to active OA."),
  })
  .strict();

/** Split into batches of at most `size` (LINE bulk link/unlink caps at 500 ids/request). Exported for tests. */
export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

export function registerLinkRichMenuTool(server: McpServer): void {
  server.registerTool(
    "line_link_rich_menu",
    {
      title: "Link / unlink a LINE rich menu to user(s)",
      description: `Attach or detach a rich menu for specific LINE users. A per-user menu overrides the account-wide default, so this is the way to show different menus to different segments (e.g. paying members vs. free users).

Pass a single user_id (per-user endpoint) or a list of user_ids (bulk endpoint, auto-chunked into batches of 500). Unlinking a user makes them fall back to the account default menu (if any).

Args:
  - mode: 'link' (attach) | 'unlink' (detach).
  - rich_menu_id: Required for mode='link'; ignored for unlink.
  - user_id: A single LINE user ID, OR
  - user_ids: A list of LINE user IDs (bulk, auto-chunked at 500/batch).
  - oa: Optional OA id.

Returns:
  {
    mode: "link" | "unlink",
    linked_count?: number,   // present when mode='link'
    unlinked_count?: number, // present when mode='unlink'
    rich_menu_id?: string,   // present when mode='link'
    chunks?: number          // number of bulk batches sent (bulk path only)
  }

Examples:
  - "ผูก rich menu R123 ให้ user U1" → { mode: "link", rich_menu_id: "R123", user_id: "U1" }
  - "ผูก rich menu R123 ให้สมาชิก 800 คน" → { mode: "link", rich_menu_id: "R123", user_ids: [...800 ids] } (sent as 2 chunks)
  - "ถอด rich menu ของ user U1" → { mode: "unlink", user_id: "U1" }

Errors:
  - mode='link' without rich_menu_id → returns input error
  - neither user_id nor user_ids → returns input error
  - 404 → user has no rich menu linked (unlink), or rich_menu_id not found (link)`,
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

        const hasList = Array.isArray(params.user_ids) && params.user_ids.length > 0;
        const hasSingle = typeof params.user_id === "string" && params.user_id.length > 0;
        if (!hasList && !hasSingle) {
          return {
            isError: true,
            content: [{ type: "text", text: "❌ ต้องระบุ user_id หรือ user_ids อย่างน้อยหนึ่งอย่าง" }],
          };
        }
        if (params.mode === "link" && !params.rich_menu_id) {
          return {
            isError: true,
            content: [{ type: "text", text: "❌ mode='link' ต้องการ rich_menu_id" }],
          };
        }

        // ---- bulk path ----
        if (hasList) {
          const ids = params.user_ids as string[];
          const batches = chunk(ids, RICHMENU_BULK_MAX_USERS);
          if (params.mode === "link") {
            const richMenuId = params.rich_menu_id as string;
            for (const batch of batches) {
              await client.bulkLinkRichMenu(richMenuId, batch);
            }
            const output = {
              mode: "link" as const,
              linked_count: ids.length,
              rich_menu_id: richMenuId,
              chunks: batches.length,
            };
            return {
              content: [
                {
                  type: "text",
                  text: `✅ ผูก rich menu \`${richMenuId}\` ให้ ${ids.length} users สำเร็จ (${batches.length} batch)`,
                },
              ],
              structuredContent: output as unknown as Record<string, unknown>,
            };
          }
          for (const batch of batches) {
            await client.bulkUnlinkRichMenu(batch);
          }
          const output = {
            mode: "unlink" as const,
            unlinked_count: ids.length,
            chunks: batches.length,
          };
          return {
            content: [
              {
                type: "text",
                text: `✅ ถอด rich menu จาก ${ids.length} users สำเร็จ (${batches.length} batch)`,
              },
            ],
            structuredContent: output as unknown as Record<string, unknown>,
          };
        }

        // ---- single-user path ----
        const userId = params.user_id as string;
        if (params.mode === "link") {
          const richMenuId = params.rich_menu_id as string;
          await client.linkRichMenuToUser(userId, richMenuId);
          const output = {
            mode: "link" as const,
            linked_count: 1,
            rich_menu_id: richMenuId,
          };
          return {
            content: [
              { type: "text", text: `✅ ผูก rich menu \`${richMenuId}\` ให้ user \`${userId}\` สำเร็จ` },
            ],
            structuredContent: output as unknown as Record<string, unknown>,
          };
        }
        await client.unlinkRichMenuFromUser(userId);
        const output = {
          mode: "unlink" as const,
          unlinked_count: 1,
        };
        return {
          content: [{ type: "text", text: `✅ ถอด rich menu จาก user \`${userId}\` สำเร็จ` }],
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
