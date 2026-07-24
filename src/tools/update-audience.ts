/**
 * Tool: line_update_audience
 *
 * Mutation companion to line_list_audiences. Two modes that cover the two
 * everyday audience edits an SMB makes: top up an existing upload-type audience
 * with more user IDs, or rename one so the OA Manager list stays tidy.
 *
 * Note: only Messaging-API-created (upload) audiences accept add_users. Audiences
 * built in LINE OA Manager UI (chat-tag, friend-path, web-traffic) appear in
 * line_list_audiences but cannot be mutated here — LINE will reject the call.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveOa } from "../config/multi-oa.js";
import { LineApiError, LineClient } from "../line/client.js";
import { TH } from "../i18n/th.js";

const InputSchema = z
  .object({
    mode: z
      .enum(["add_users", "rename"])
      .describe(
        "add_users: append user IDs to an existing upload audience; rename: change an audience's display name.",
      ),
    audience_group_id: z
      .number()
      .int()
      .describe("Target audience group id (from line_list_audiences)."),
    user_ids: z
      .array(z.string())
      .optional()
      .describe("Required for mode='add_users'. LINE user IDs to append."),
    description: z
      .string()
      .max(120, "description ยาวเกิน 120 ตัวอักษร")
      .optional()
      .describe("Required for mode='rename'. The new audience name (≤120 chars)."),
    oa: z.string().optional().describe("Optional OA id; defaults to active OA."),
  })
  .strict();

type Output =
  | { mode: "add_users"; audience_group_id: number; added_count: number }
  | { mode: "rename"; audience_group_id: number; new_description: string };

export function registerUpdateAudienceTool(server: McpServer): void {
  server.registerTool(
    "line_update_audience",
    {
      title: "Update LINE Audience",
      description: `Mutate an existing LINE audience group. modes: add_users (append user_ids) | rename (set description). audience_group_id from line_list_audiences. Only Messaging-API-created (upload) audiences accept mutation — audiences built in LINE OA Manager UI (chat-tag, friend-path, web-traffic) are read-only and LINE will reject changes.

Returns add_users → { mode, audience_group_id, added_count }; rename → { mode, audience_group_id, new_description }.

Example: "เพิ่ม 3 คนเข้า audience 12345" → { mode:"add_users", audience_group_id:12345, user_ids:["U1","U2","U3"] }.`,
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

        if (params.mode === "add_users") {
          if (!params.user_ids || params.user_ids.length === 0) {
            return {
              isError: true,
              content: [
                { type: "text", text: "❌ mode='add_users' ต้องการ user_ids อย่างน้อย 1 คน" },
              ],
            };
          }
          await client.addAudienceUsers({
            audienceGroupId: params.audience_group_id,
            audiences: params.user_ids.map((id) => ({ id })),
          });
          const output: Output = {
            mode: "add_users",
            audience_group_id: params.audience_group_id,
            added_count: params.user_ids.length,
          };
          return {
            content: [
              {
                type: "text",
                text: `✅ เพิ่ม ${output.added_count.toLocaleString()} คน เข้า audience \`${params.audience_group_id}\` (รอ ~10 นาทีให้ index พร้อมก่อนใช้ส่ง)`,
              },
            ],
            structuredContent: output as unknown as Record<string, unknown>,
          };
        }

        // mode === "rename"
        if (!params.description || params.description.trim().length === 0) {
          return {
            isError: true,
            content: [{ type: "text", text: "❌ mode='rename' ต้องการ description (ชื่อใหม่)" }],
          };
        }
        await client.renameAudience(params.audience_group_id, params.description);
        const output: Output = {
          mode: "rename",
          audience_group_id: params.audience_group_id,
          new_description: params.description,
        };
        return {
          content: [
            {
              type: "text",
              text: `✏️ เปลี่ยนชื่อ audience \`${params.audience_group_id}\` เป็น "${params.description}" สำเร็จ`,
            },
          ],
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
