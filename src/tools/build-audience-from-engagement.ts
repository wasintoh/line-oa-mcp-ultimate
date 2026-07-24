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
      description: `Create a LINE audience from people who clicked or opened a previous broadcast/narrowcast — retarget without a CRM. source_request_id is the request_id returned by a prior line_send_message; type 'clicks' (default, optional click_url filter) or 'opens'. The source message must be ≥24h old before the audience is reliable, needs ~50+ users to be usable in narrowcast, and is region-gated to JP/TW/TH (+premium). Feed the resulting audience back into line_send_message target.audience.

Returns { audience_group_id, name, type }.`,
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
