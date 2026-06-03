/**
 * Tool: line_set_webhook_endpoint
 *
 * Read/write the OA's webhook URL. Complements line_test_webhook: set the URL
 * here, then ping it there. The classic flow when "ลูกค้าทักแต่บอทไม่ตอบ" is
 * (1) check the configured URL, (2) point it at the right server, (3) test it.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveOa } from "../config/multi-oa.js";
import { LineApiError, LineClient } from "../line/client.js";
import { TH } from "../i18n/th.js";

const MAX_ENDPOINT_LENGTH = 500;

const InputSchema = z
  .object({
    mode: z
      .enum(["set", "get"])
      .describe("set: write a new webhook URL; get: read the currently configured one."),
    endpoint: z
      .string()
      .url()
      .optional()
      .describe(
        "Required for mode='set'. Public HTTPS URL (must start with https://, ≤500 chars).",
      ),
    oa: z.string().optional().describe("Optional OA id; defaults to active OA."),
  })
  .strict();

interface Output {
  endpoint: string;
  active: boolean;
}

export function registerSetWebhookEndpointTool(server: McpServer): void {
  server.registerTool(
    "line_set_webhook_endpoint",
    {
      title: "Set LINE Webhook Endpoint",
      description: `Read or write the LINE OA's webhook URL (PUT/GET /v2/bot/channel/webhook/endpoint). Complements line_test_webhook — set the URL here, then ping it with line_test_webhook.

Args:
  - mode ('set' | 'get'): write or read.
  - endpoint (string, set only): public HTTPS URL (https:// required, ≤500 chars).
  - oa (string, optional): OA id. Default = active OA.

Returns:
  { endpoint: string, active: boolean }   // re-read after a 'set' to confirm

Examples:
  - "ตั้ง webhook เป็น https://api.example.com/line" → { mode: "set", endpoint: "https://api.example.com/line" }
  - "ดู webhook URL ปัจจุบัน" → { mode: "get" }

Errors:
  - Non-HTTPS or >500 char URL → inline input error (LINE requires HTTPS).
  - mode='set' without endpoint → inline input error.
  - LINE rejects the URL → LineApiError surfaced.`,
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
          if (!params.endpoint) {
            return {
              isError: true,
              content: [{ type: "text", text: "❌ mode='set' ต้องการ endpoint (URL)" }],
            };
          }
          if (!params.endpoint.startsWith("https://")) {
            return {
              isError: true,
              content: [
                { type: "text", text: "❌ webhook URL ต้องเป็น HTTPS (ขึ้นต้นด้วย https://)" },
              ],
            };
          }
          if (params.endpoint.length > MAX_ENDPOINT_LENGTH) {
            return {
              isError: true,
              content: [
                {
                  type: "text",
                  text: `❌ webhook URL ยาว ${params.endpoint.length} ตัวอักษร เกิน ${MAX_ENDPOINT_LENGTH} limit`,
                },
              ],
            };
          }
          await client.setWebhookEndpoint(params.endpoint);
          // Re-read to confirm what LINE actually stored + its active flag.
          const confirmed = await client.getWebhookEndpoint();
          const output: Output = { endpoint: confirmed.endpoint, active: confirmed.active };
          return {
            content: [
              {
                type: "text",
                text: `✅ ตั้ง webhook สำเร็จ\n- Endpoint: ${output.endpoint}\n- Active: ${output.active ? "✅ ใช่" : "⛔ ยังไม่ active"}\n💡 ทดสอบต่อด้วย line_test_webhook`,
              },
            ],
            structuredContent: output as unknown as Record<string, unknown>,
          };
        }

        // mode === "get"
        const info = await client.getWebhookEndpoint();
        const output: Output = { endpoint: info.endpoint, active: info.active };
        return {
          content: [
            {
              type: "text",
              text: `🔌 Webhook ปัจจุบัน\n- Endpoint: ${output.endpoint || "(ยังไม่ได้ตั้ง)"}\n- Active: ${output.active ? "✅ ใช่" : "⛔ ยังไม่ active"}`,
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
