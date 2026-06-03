/**
 * Tool: line_get_narrowcast_progress
 *
 * Narrowcast is async on LINE's side: the send returns a request_id, then the
 * actual delivery happens in the background. This tool polls that request_id so
 * "ส่งไปกี่คนแล้ว / ส่งเสร็จยัง" has a real answer instead of a guess.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveOa } from "../config/multi-oa.js";
import { LineApiError, LineClient } from "../line/client.js";
import { TH } from "../i18n/th.js";

const InputSchema = z
  .object({
    request_id: z
      .string()
      .describe("The narrowcast request id returned by a prior narrowcast send."),
    oa: z.string().optional().describe("Optional OA id; defaults to active OA."),
  })
  .strict();

interface Output {
  request_id: string;
  phase: string;
  status_text: string;
  success_count?: number;
  failure_count?: number;
  target_count?: number;
  failed_description?: string;
  error_code?: number;
  accepted_time?: string;
  completed_time?: string;
}

/** Map LINE's narrowcast `phase` to a Thai status line. */
function phaseToThai(phase: string): string {
  switch (phase) {
    case "waiting":
      return "⏳ กำลังรอเริ่มส่ง (waiting)";
    case "sending":
      return "📤 กำลังส่งอยู่ (sending)";
    case "succeeded":
      return "✅ ส่งเสร็จสมบูรณ์ (succeeded)";
    case "failed":
      return "❌ ส่งล้มเหลว (failed)";
    default:
      return `ℹ️ สถานะ: ${phase}`;
  }
}

export function registerGetNarrowcastProgressTool(server: McpServer): void {
  server.registerTool(
    "line_get_narrowcast_progress",
    {
      title: "Get LINE Narrowcast Progress",
      description: `Poll the delivery progress of an async narrowcast send (GET /v2/bot/message/progress/narrowcast). Narrowcast runs in the background — the send returns a request_id, and this tool reports how far it has gotten.

Args:
  - request_id (string): the id returned by a prior narrowcast send.
  - oa (string, optional): OA id. Default = active OA.

Returns:
  {
    request_id, phase,           // waiting | sending | succeeded | failed
    status_text,                 // Thai-readable status line
    success_count?, failure_count?, target_count?,
    failed_description?, error_code?,
    accepted_time?, completed_time?
  }

Examples:
  - "narrowcast เสร็จยัง" → { request_id: "<id from send>" }

Errors:
  - Unknown / expired request_id → LineApiError surfaced.`,
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

        const p = await client.getNarrowcastProgress(params.request_id);
        const output: Output = {
          request_id: params.request_id,
          phase: p.phase,
          status_text: phaseToThai(p.phase),
          success_count: p.successCount,
          failure_count: p.failureCount,
          target_count: p.targetCount,
          failed_description: p.failedDescription,
          error_code: p.errorCode,
          accepted_time: p.acceptedTime,
          completed_time: p.completedTime,
        };

        const lines: string[] = [output.status_text];
        if (typeof output.target_count === "number") {
          lines.push(`- 🎯 เป้าหมาย: ${output.target_count.toLocaleString()} คน`);
        }
        if (typeof output.success_count === "number") {
          lines.push(`- ✅ สำเร็จ: ${output.success_count.toLocaleString()}`);
        }
        if (typeof output.failure_count === "number") {
          lines.push(`- ❌ ล้มเหลว: ${output.failure_count.toLocaleString()}`);
        }
        if (output.failed_description) {
          lines.push(`- ⚠️ สาเหตุ: ${output.failed_description}`);
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
