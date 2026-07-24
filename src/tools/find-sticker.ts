/**
 * Tool: line_find_sticker
 *
 * Sticker discovery by mood or keyword from a bundled catalog. Marketers can't
 * guess sticker IDs but they know moods ("ขอบคุณ", "celebration"). Returns
 * a few candidate stickers with package_id / sticker_id / thumbnail so the
 * agent can show them to the user, who picks one, and the agent then passes
 * { sticker: { package_id, sticker_id } } to line_send_message.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { findStickers, STICKER_CATALOG } from "../resources/sticker-catalog.js";

const InputSchema = z
  .object({
    query: z
      .string()
      .min(1)
      .describe(
        'Mood or keyword (Thai or English). Examples: "ขอบคุณ", "celebration", "sorry", "ดีใจ".',
      ),
    limit: z.number().int().min(1).max(20).default(5),
    response_format: z.enum(["markdown", "json"]).default("markdown"),
  })
  .strict();

export function registerFindStickerTool(server: McpServer): void {
  server.registerTool(
    "line_find_sticker",
    {
      title: "Find LINE sticker by mood/keyword",
      description: `Find LINE stickers from a curated catalog by mood or keyword (Thai or English). Bots may only send stickers from LINE's limited official list, so this picks by intent ("celebration", "ขอบคุณ", "sorry") instead of guessing IDs. Pass the chosen package_id + sticker_id to line_send_message via message.sticker.

Returns { query, count, stickers:[{ package_id, sticker_id, moods, keywords_th, keywords_en, description }] }.`,
      inputSchema: InputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (raw: unknown) => {
      const params = InputSchema.parse(raw);
      const matches = findStickers(params.query, params.limit);
      const output = {
        query: params.query,
        count: matches.length,
        total_in_catalog: STICKER_CATALOG.length,
        stickers: matches,
      };
      const text =
        params.response_format === "json"
          ? JSON.stringify(output, null, 2)
          : renderMd(params.query, matches);
      return {
        content: [{ type: "text", text }],
        structuredContent: output as unknown as Record<string, unknown>,
      };
    },
  );
}

function renderMd(query: string, items: ReturnType<typeof findStickers>): string {
  if (!items.length) return `_ไม่พบ sticker ที่ตรงกับ "${query}"_`;
  const lines: string[] = [`# 🎴 Sticker matches: "${query}"`, ""];
  for (const s of items) {
    lines.push(`## ${s.description}`);
    lines.push(`- **packageId/stickerId:** \`${s.package_id}\` / \`${s.sticker_id}\``);
    lines.push(`- **Moods:** ${s.moods.join(", ")}`);
    lines.push(`- **TH:** ${s.keywords_th.join(", ")}`);
    lines.push("");
  }
  return lines.join("\n");
}
