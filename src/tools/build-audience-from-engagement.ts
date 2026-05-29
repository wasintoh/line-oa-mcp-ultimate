/**
 * Tool: line_build_audience_from_engagement
 *
 * Retargeting magic — create an audience of users who *clicked* or *opened*
 * a prior broadcast/narrowcast. No CRM, no CSV — just the request_id of the
 * earlier send and we materialize an audience.
 *
 * This is one of LINE's most under-used features and one of the highest-
 * leverage moves for Thai SMBs that don't have a CDP.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveOa } from "../config/multi-oa.js";
import { LineApiError, LineClient } from "../line/client.js";
import { TH } from "../i18n/th.js";

const InputSchema = z
  .object({
    name: z.string().min(1).max(120),
    source_request_id: z
      .string()
      .min(1)
      .describe(
        "The request_id returned by a prior line_send_message (narrowcast/multicast/push/broadcast).",
      ),
    type: z
      .enum(["clicks", "opens"])
      .default("clicks")
      .describe(
        "'clicks' = audience of users who clicked any link in the source message; 'opens' = users who saw it.",
      ),
    click_url: z
      .string()
      .url()
      .optional()
      .describe("If 'clicks' and you only want users who clicked a specific URL, set it here."),
    oa: z.string().optional(),
  })
  .strict();

export function registerBuildAudienceFromEngagementTool(server: McpServer): void {
  server.registerTool(
    "line_build_audience_from_engagement",
    {
      title: "Build retargeting audience from prior engagement",
      description: `Create a LINE audience from people who *clicked* or *opened* a previous broadcast / narrowcast. The killer "retarget without a CRM" tool.

Args:
  - name: New audience name.
  - source_request_id: request_id from a previous line_send_message call (saved in its return value).
  - type: 'clicks' (default) or 'opens'.
  - click_url: optional — limit to a specific clicked URL (for 'clicks' only).
  - oa: optional OA id.

Returns:
  { audience_group_id, name, type }

Notes:
  - LINE requires the source message to be ≥24 hours old before the engagement audience is reliable.
  - Minimum ~50 users for the audience to be usable in narrowcast.
  - Region-gated to JP / TW / TH (+ premium).

Example workflow:
  1. line_send_message(..., target: narrowcast) → save request_id
  2. Wait 24h
  3. line_build_audience_from_engagement({ source_request_id, type: 'clicks' })
  4. line_send_message(..., target: { audience: 'new-engagement-audience' })`,
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

        const result =
          params.type === "clicks"
            ? await client.createClickAudience({
                description: params.name,
                requestId: params.source_request_id,
                clickUrl: params.click_url,
              })
            : await client.createImpAudience({
                description: params.name,
                requestId: params.source_request_id,
              });

        const output = {
          audience_group_id: result.audienceGroupId,
          name: params.name,
          type: params.type,
          source_request_id: params.source_request_id,
        };
        return {
          content: [
            {
              type: "text",
              text: `✅ สร้าง retargeting audience "${params.name}" (id ${result.audienceGroupId}) จาก ${params.type === "clicks" ? "คนที่คลิก" : "คนที่เปิด"} request \`${params.source_request_id}\``,
            },
          ],
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
