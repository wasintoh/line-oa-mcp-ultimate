/**
 * Tool: line_list_oas
 *
 * List all LINE Official Accounts configured in this MCP instance, including
 * which one is currently active. Multi-OA users (agencies) call this first to
 * discover available OAs before switching with `line_use_oa`.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { listOas } from "../config/multi-oa.js";
import { TH } from "../i18n/th.js";

const InputSchema = z
  .object({
    response_format: z.enum(["markdown", "json"]).default("markdown"),
  })
  .strict();

export function registerListOasTool(server: McpServer): void {
  server.registerTool(
    "line_list_oas",
    {
      title: "List LINE OAs configured",
      description: `List all LINE Official Accounts available to this MCP instance, from the multi-OA config file (or single-OA env mode). Useful before line_use_oa to discover the OA IDs.

Args:
  - response_format: 'markdown' (default) | 'json'.

Returns:
  {
    active_oa: string,
    oas: [{ id, display_name?, region?, is_premium?, is_active }]
  }`,
      inputSchema: InputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (raw: unknown) => {
      try {
        const params = InputSchema.parse(raw);
        const items = listOas();
        const activeId = items.find((i) => i.is_active)?.id ?? items[0]?.id ?? "(none)";
        const output = {
          active_oa: activeId,
          oas: items.map((i) => ({
            id: i.id,
            display_name: i.config.display_name,
            region: i.config.region,
            is_premium: i.config.is_premium,
            is_active: i.is_active,
          })),
        };
        const text =
          params.response_format === "json"
            ? JSON.stringify(output, null, 2)
            : renderMarkdown(output);
        return {
          content: [{ type: "text", text }],
          structuredContent: output as unknown as Record<string, unknown>,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text", text: TH.unknownError(msg) }],
        };
      }
    },
  );
}

function renderMarkdown(o: { active_oa: string; oas: { id: string; display_name?: string; region?: string; is_premium?: boolean; is_active: boolean }[] }): string {
  const lines: string[] = ["# 📚 LINE OAs", ""];
  lines.push(`Active: **${o.active_oa}**`);
  lines.push("");
  for (const oa of o.oas) {
    const star = oa.is_active ? "⭐" : "  ";
    const premium = oa.is_premium ? " 💎" : "";
    const region = oa.region ? ` (${oa.region})` : "";
    lines.push(`${star} \`${oa.id}\`${premium} — ${oa.display_name ?? "(no name)"}${region}`);
  }
  return lines.join("\n");
}
