/**
 * Tool: line_get_user_profile
 *
 * Look up a user's display name, picture, status message and language by user
 * ID. Used to confirm "this is who you'll send to" before line_send_message
 * for SMB workflows where the user pasted an ID from a CSV.
 *
 * Friendship requirement: this endpoint only works if the user has added the
 * bot as a friend (otherwise 404).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveOa } from "../config/multi-oa.js";
import { LineApiError, LineClient } from "../line/client.js";
import { TH } from "../i18n/th.js";

const InputSchema = z
  .object({
    user_id: z.string().min(1).describe("LINE user ID (starts with 'U' for chat users)"),
    oa: z.string().optional(),
    response_format: z.enum(["markdown", "json"]).default("markdown"),
  })
  .strict();

export function registerGetUserProfileTool(server: McpServer): void {
  server.registerTool(
    "line_get_user_profile",
    {
      title: "Get LINE User Profile",
      description: `Fetch a LINE user's profile (display name, picture, status message, language) by user ID.

Note: Only works if the user has added the bot as a friend AND has not blocked it AND has consented to share profile (per LINE TOS). Returns 404 ambiguously if any of these conditions fail — we surface a clear Thai-language explanation.

Args:
  - user_id: LINE user ID (typically starts with 'U').
  - oa: optional OA id.
  - response_format: 'markdown' (default) | 'json'.

Returns:
  { user_id, display_name, picture_url?, status_message?, language? }`,
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
        const profile = await client.getProfile(params.user_id);
        const output = {
          user_id: profile.userId,
          display_name: profile.displayName,
          picture_url: profile.pictureUrl,
          status_message: profile.statusMessage,
          language: profile.language,
        };
        const text =
          params.response_format === "json"
            ? JSON.stringify(output, null, 2)
            : `# 👤 ${output.display_name}\n- **ID:** \`${output.user_id}\`${
                output.language ? `\n- **ภาษา:** ${output.language}` : ""
              }${output.status_message ? `\n- **Status:** ${output.status_message}` : ""}`;
        return {
          content: [{ type: "text", text }],
          structuredContent: output as unknown as Record<string, unknown>,
        };
      } catch (err) {
        if (err instanceof LineApiError && err.status === 404) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `❓ ไม่พบ user profile — เป็นไปได้ 4 กรณี: (1) user ยังไม่เพิ่ม OA นี้เป็นเพื่อน, (2) user block OA, (3) user_id ผิด, (4) user ไม่ได้ consent share profile. LINE ไม่บอกแยกได้ว่าเป็นกรณีไหน`,
              },
            ],
          };
        }
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: TH.unknownError(msg) }] };
      }
    },
  );
}
