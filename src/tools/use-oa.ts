/**
 * Tool: line_use_oa
 *
 * Switch the active OA for the rest of this MCP session. In-memory only —
 * does not modify the config file.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { useOa } from "../config/multi-oa.js";
import { TH } from "../i18n/th.js";

const InputSchema = z
  .object({
    oa_id: z.string().min(1).describe("OA id from line_list_oas"),
  })
  .strict();

export function registerUseOaTool(server: McpServer): void {
  server.registerTool(
    "line_use_oa",
    {
      title: "Switch active LINE OA",
      description: `Switch which OA all subsequent tool calls default to (until changed or process restart). In-memory only — does not edit config.json. oa_id from line_list_oas.

Returns { active_oa, display_name }.`,
      inputSchema: InputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (raw: unknown) => {
      try {
        const params = InputSchema.parse(raw);
        const cfg = useOa(params.oa_id);
        const output = {
          active_oa: params.oa_id,
          display_name: cfg.display_name ?? params.oa_id,
        };
        return {
          content: [
            { type: "text", text: `✅ Active OA: \`${output.active_oa}\` — ${output.display_name}` },
          ],
          structuredContent: output as unknown as Record<string, unknown>,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text", text: msg.includes("ไม่พบ OA") ? msg : TH.unknownError(msg) }],
        };
      }
    },
  );
}
