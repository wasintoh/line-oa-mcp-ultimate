/**
 * Tool: line_show_typing
 *
 * Display the "..." typing indicator in a 1:1 chat. Useful when an AI agent
 * is about to take >1s to respond — UX win at zero cost.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveOa } from "../config/multi-oa.js";
import { LineApiError, LineClient } from "../line/client.js";
import { TH } from "../i18n/th.js";

const InputSchema = z
  .object({
    chat_id: z.string().min(1).describe("User ID (1:1 chats only — does not work in groups)"),
    seconds: z
      .number()
      .int()
      .min(5)
      .max(60)
      .default(20)
      .describe("How long to show the indicator (5-60s). Default 20."),
    oa: z.string().optional(),
  })
  .strict();

export function registerShowTypingTool(server: McpServer): void {
  server.registerTool(
    "line_show_typing",
    {
      title: "Show typing indicator in LINE chat",
      description: `Display the "..." typing indicator in a 1:1 chat with a user. The indicator vanishes when the bot sends a message OR after the timeout. Use this when an agent is about to take a noticeable amount of time before replying.

Only works in 1:1 chats (NOT in groups or multi-person rooms).

Args:
  - chat_id: The user ID of the 1:1 chat.
  - seconds: How long to display (5-60). Default 20.
  - oa: optional OA id.

Returns:
  { success: true, chat_id, seconds }`,
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
        await client.showLoading(params.chat_id, params.seconds);
        const output = { success: true, chat_id: params.chat_id, seconds: params.seconds };
        return {
          content: [{ type: "text", text: `⌨️ แสดง typing indicator ${params.seconds} วินาที` }],
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
