/**
 * Tool: line_build_audience_from_csv
 *
 * Build a LINE audience from a list of user IDs (the most common SMB
 * retargeting flow — "ส่งให้คนที่ซื้อในเดือนก่อน" → CSV from Sheets → audience).
 *
 * Uses LINE's JSON upload endpoint for ≤10K IDs per call. For larger lists,
 * a future V1.1 will add a file-upload variant via the api-data domain.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { AUDIENCE_MAX_IDS_PER_REQUEST } from "../constants.js";
import { resolveOa } from "../config/multi-oa.js";
import { LineApiError, LineClient } from "../line/client.js";
import { TH } from "../i18n/th.js";

const InputSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(120)
      .describe("Audience name as shown in LINE OA Manager (≤120 chars)."),
    user_ids: z
      .array(z.string().min(1))
      .min(1)
      .max(AUDIENCE_MAX_IDS_PER_REQUEST)
      .describe(`Array of LINE user IDs. Max ${AUDIENCE_MAX_IDS_PER_REQUEST.toLocaleString()} per call.`),
    is_ifa: z
      .boolean()
      .default(false)
      .describe("True if values are Identifiers for Advertisers (IFAs) instead of LINE user IDs."),
    oa: z.string().optional(),
  })
  .strict();

export function registerBuildAudienceFromCsvTool(server: McpServer): void {
  server.registerTool(
    "line_build_audience_from_csv",
    {
      title: "Build LINE audience from user IDs",
      description: `Create a new LINE audience by uploading user IDs (or IFAs). After creation LINE indexes the audience for ~5-10 minutes — line_list_audiences will report status=IN_PROGRESS during that window, then READY.

This is the "CSV from Google Sheets → retargeting audience" flow most Thai SMBs need.

Args:
  - name: Audience name (≤120 chars).
  - user_ids: Array of LINE user IDs (max 10,000 per call).
  - is_ifa: True for IFA values instead of LINE user IDs (default false).
  - oa: optional OA id.

Returns:
  { audience_group_id, name, type, created_unix_ms }

Region note: Audience Management API is gated to JP / TW / TH OAs (+ premium).

Examples:
  - "สร้าง audience ลูกค้าเดือนก่อน" → { name: "buyers_last_month", user_ids: [...] }`,
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
        const result = await client.createAudienceFromUserIds({
          description: params.name,
          audiences: params.user_ids.map((id) => ({ id })),
          isIfaAudience: params.is_ifa,
        });
        const output = {
          audience_group_id: result.audienceGroupId,
          name: result.description,
          type: result.type,
          created_unix_ms: result.created,
        };
        return {
          content: [
            {
              type: "text",
              text: `✅ สร้าง audience "${result.description}" (id ${result.audienceGroupId}) — ${params.user_ids.length.toLocaleString()} IDs\n_รอ ~5-10 นาทีให้ LINE index เสร็จ จึงใช้ส่งได้_`,
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
