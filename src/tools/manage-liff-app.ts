/**
 * Tool: line_manage_liff_app
 *
 * LIFF lifecycle CRUD via the LIFF Server API (v1). Single tool with mode
 * switch for developer Personas — V1 keeps it simple, V1.1 may break out
 * specific helpers.
 *
 * NOTE: LIFF Server API uses a separate auth — the channel must be a "LINE
 * Login channel" (not Messaging API channel). We use the same Bearer token
 * here for simplicity, but production users with separate channels will need
 * to plug in a Login channel token via env var LINE_LOGIN_CHANNEL_TOKEN
 * (V1.1).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveOa } from "../config/multi-oa.js";
import { LineApiError, LineClient } from "../line/client.js";
import { TH } from "../i18n/th.js";

const ViewSchema = z
  .object({
    type: z.enum(["compact", "tall", "full"]),
    url: z.string().url(),
  })
  .strict();

const InputSchema = z
  .object({
    mode: z.enum(["create", "list", "update", "delete"]),
    liff_id: z.string().optional().describe("Required for update / delete."),
    config: z
      .object({
        view: ViewSchema.optional(),
        description: z.string().optional(),
        features: z
          .object({
            ble: z.boolean().optional(),
            qrCode: z.boolean().optional(),
          })
          .optional(),
        scope: z.array(z.string()).optional(),
        bot_prompt: z.enum(["normal", "aggressive", "none"]).optional(),
      })
      .optional()
      .describe("Required for create. Partial for update."),
    confirm: z.boolean().default(false),
    oa: z.string().optional(),
  })
  .strict();

type Input = z.infer<typeof InputSchema>;

export function registerManageLiffAppTool(server: McpServer): void {
  server.registerTool(
    "line_manage_liff_app",
    {
      title: "Manage LIFF apps",
      description: `LIFF lifecycle CRUD. Four modes:
  - create: New LIFF app. Requires config.view (type + url).
  - list: List all LIFF apps on the channel.
  - update: Modify an existing LIFF app. Requires liff_id + partial config.
  - delete: Remove a LIFF app. Requires liff_id + confirm=true.

Args:
  - mode: 'create' | 'list' | 'update' | 'delete'.
  - liff_id: required for update / delete.
  - config: full for create, partial for update.
  - confirm: required true for delete.
  - oa: optional OA id.

Auth note: LIFF Server API uses LINE Login channel tokens — V1 uses the same Messaging API token for simplicity. For separate-channel setups, see docs.

Examples:
  - "สร้าง LIFF tall https://my.app" → { mode: "create", config: { view: { type: "tall", url: "https://my.app" } } }
  - "ดู LIFF apps ทั้งหมด" → { mode: "list" }`,
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
          case "list": {
            const res = await client.listLiffApps();
            return {
              content: [
                { type: "text", text: `📱 LIFF apps: ${res.apps.length}\n\n${JSON.stringify(res.apps, null, 2)}` },
              ],
              structuredContent: res as unknown as Record<string, unknown>,
            };
          }
          case "create": {
            if (!params.config?.view) {
              return {
                isError: true,
                content: [{ type: "text", text: "❌ mode='create' ต้องการ config.view (type + url)" }],
              };
            }
            const body: Record<string, unknown> = {
              view: params.config.view,
              description: params.config.description,
              features: params.config.features,
              scope: params.config.scope,
              botPrompt: params.config.bot_prompt,
            };
            const res = await client.createLiffApp(body);
            return {
              content: [
                { type: "text", text: `✅ สร้าง LIFF app สำเร็จ\n- liff_id: \`${res.liffId}\`\n- URL: https://liff.line.me/${res.liffId}` },
              ],
              structuredContent: { liff_id: res.liffId, liff_url: `https://liff.line.me/${res.liffId}` },
            };
          }
          case "update": {
            if (!params.liff_id || !params.config) {
              return {
                isError: true,
                content: [{ type: "text", text: "❌ mode='update' ต้องการ liff_id และ config" }],
              };
            }
            await client.updateLiffApp(params.liff_id, params.config as Record<string, unknown>);
            return {
              content: [{ type: "text", text: `✅ อัปเดต LIFF \`${params.liff_id}\` สำเร็จ` }],
              structuredContent: { success: true, liff_id: params.liff_id },
            };
          }
          case "delete": {
            if (!params.liff_id) {
              return {
                isError: true,
                content: [{ type: "text", text: "❌ mode='delete' ต้องการ liff_id" }],
              };
            }
            if (!params.confirm) {
              return {
                isError: true,
                content: [
                  {
                    type: "text",
                    text: `⚠️ ต้องตั้ง confirm=true ก่อนลบ LIFF app \`${params.liff_id}\``,
                  },
                ],
              };
            }
            await client.deleteLiffApp(params.liff_id);
            return {
              content: [{ type: "text", text: `🗑 ลบ LIFF \`${params.liff_id}\` สำเร็จ` }],
              structuredContent: { success: true, deleted_id: params.liff_id },
            };
          }
        }
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
