/**
 * Tool: line_check_token
 *
 * Validates the active OA's configured channel access token (GET
 * /oauth2/v2.1/verify). Answers "token ของ OA นี้ยังใช้ได้ไหม / เหลืออายุเท่าไหร่"
 * before a campaign — a token that expires mid-send is a classic silent failure.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveOa } from "../config/multi-oa.js";
import { LineApiError, LineClient } from "../line/client.js";
import { TH } from "../i18n/th.js";

/** Below this many seconds remaining, surface a Thai warning. */
const EXPIRY_WARN_SECONDS = 7 * 24 * 60 * 60; // 7 days
const SECONDS_PER_DAY = 24 * 60 * 60;

const InputSchema = z
  .object({
    oa: z.string().optional().describe("Optional OA id; defaults to active OA."),
  })
  .strict();

interface Output {
  valid: true;
  client_id: string;
  expires_in_seconds: number;
  expires_in_days: number;
  scope?: string;
  warning?: string;
}

export function registerCheckTokenTool(server: McpServer): void {
  server.registerTool(
    "line_check_token",
    {
      title: "Check LINE Token Validity",
      description: `Verify the active OA's channel access token (GET /oauth2/v2.1/verify) — reports bound client_id, remaining lifetime, and granted scope; warns (Thai) when <7 days remain. Run before a campaign: a token expiring mid-send fails silently. An invalid/expired token surfaces a 401 error (no { valid:false } shape).

Returns { valid, client_id, expires_in_seconds, expires_in_days, scope?, warning? }.`,
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

        // No arg → verifyAccessToken uses the configured token.
        const res = await client.verifyAccessToken();
        const expiresInDays = Math.floor(res.expires_in / SECONDS_PER_DAY);
        const warning =
          res.expires_in < EXPIRY_WARN_SECONDS
            ? `⚠️ Token เหลืออายุอีกแค่ ~${expiresInDays} วัน (${res.expires_in.toLocaleString()} วินาที) — ควรต่ออายุ/ออก token ใหม่ก่อนหมดอายุ`
            : undefined;

        const output: Output = {
          valid: true,
          client_id: res.client_id,
          expires_in_seconds: res.expires_in,
          expires_in_days: expiresInDays,
          scope: res.scope,
          warning,
        };

        const lines: string[] = [
          "✅ Token ใช้งานได้",
          `- Client ID: ${output.client_id}`,
          `- เหลืออายุ: ~${output.expires_in_days} วัน (${output.expires_in_seconds.toLocaleString()} วินาที)`,
        ];
        if (output.scope) {
          lines.push(`- Scope: ${output.scope}`);
        }
        if (output.warning) {
          lines.push(output.warning);
        }
        return {
          content: [{ type: "text", text: lines.join("\n") }],
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
