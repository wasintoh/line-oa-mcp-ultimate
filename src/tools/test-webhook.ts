/**
 * Tool: line_test_webhook
 *
 * Sends a test ping from LINE to the OA's configured webhook URL and reports
 * the result. Useful when "ลูกค้าทักแต่บอทไม่ตอบ" — the answer is often that
 * the webhook URL is wrong, the SSL cert expired, or signature verification
 * failed.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveOa } from "../config/multi-oa.js";
import { LineApiError, LineClient } from "../line/client.js";
import { TH } from "../i18n/th.js";

const InputSchema = z
  .object({
    override_endpoint: z
      .string()
      .url()
      .optional()
      .describe("Test a specific URL instead of the OA's currently configured webhook URL."),
    oa: z.string().optional(),
  })
  .strict();

export function registerTestWebhookTool(server: McpServer): void {
  server.registerTool(
    "line_test_webhook",
    {
      title: "Test LINE Webhook Endpoint",
      description: `Ping the OA's webhook URL from LINE servers and report HTTP status + latency. LINE checks that the endpoint returns 200 within their timeout AND that signature verification works (when secret is configured).

Args:
  - override_endpoint: optional public HTTPS URL to test instead of the configured one.
  - oa: optional OA id.

Returns:
  {
    success: boolean,
    status_code: number,
    latency_ms?: number,
    reason: string,         // LINE's human-readable result
    detail?: string,
    configured_endpoint?: string,
    tested_endpoint: string
  }

Common failure modes (LINE returns them via 'reason'):
  - INVALID_REPLY: webhook responded but the response shape is unexpected
  - UNAUTHORIZED: signature verification failed (your code uses wrong channel_secret)
  - SERVER_ERROR: webhook returned 5xx
  - TIMEOUT: webhook took >10s
  - SSL_ERROR: HTTPS cert problem

Use this whenever a bot stops responding before debugging anything else.`,
      inputSchema: InputSchema.shape,
      annotations: {
        readOnlyHint: false, // technically performs a side-effect ping
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

        // Fetch configured endpoint for context
        let configuredEndpoint: string | undefined;
        try {
          const info = await client.getWebhookEndpoint();
          configuredEndpoint = info.endpoint;
        } catch {
          // ignored — not all OAs have webhook configured
        }

        const result = await client.testWebhook(params.override_endpoint);

        const testedEndpoint = params.override_endpoint ?? configuredEndpoint ?? "(unknown)";

        const output = {
          success: result.success,
          status_code: result.statusCode,
          reason: result.reason,
          detail: result.detail,
          configured_endpoint: configuredEndpoint,
          tested_endpoint: testedEndpoint,
        };

        const icon = result.success ? "✅" : "❌";
        const text = `${icon} Webhook test ${result.success ? "ผ่าน" : "ไม่ผ่าน"}\n- Endpoint: ${testedEndpoint}\n- HTTP ${result.statusCode}\n- Reason: ${result.reason}${result.detail ? `\n- Detail: ${result.detail}` : ""}`;
        return {
          content: [{ type: "text", text }],
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
