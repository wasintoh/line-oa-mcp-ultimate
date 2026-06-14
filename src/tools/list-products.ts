/**
 * Tool: line_list_products  (LINE Shopping / MyShop)
 * GET /myshop/v1/products — list products with pagination + id/sku filters.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveMyShopKey } from "../config/multi-oa.js";
import { MyShopClient } from "../line/myshop-client.js";
import { MYSHOP_DEFAULT_PER_PAGE, MYSHOP_MAX_PER_PAGE } from "../constants.js";
import { myShopError, ok } from "./myshop-shared.js";

const InputSchema = z
  .object({
    ids: z.array(z.string()).optional().describe("Filter by specific product ids."),
    skus: z.array(z.string()).optional().describe("Filter by SKUs."),
    page: z.number().int().positive().default(1).describe("Page number (default 1)."),
    per_page: z
      .number()
      .int()
      .min(1)
      .max(MYSHOP_MAX_PER_PAGE)
      .default(MYSHOP_DEFAULT_PER_PAGE)
      .describe(`Items per page, 1..${MYSHOP_MAX_PER_PAGE} (default ${MYSHOP_DEFAULT_PER_PAGE}).`),
    oa: z.string().optional().describe("OA id override (multi-OA)."),
    response_format: z.enum(["markdown", "json"]).default("markdown"),
  })
  .strict();

export function registerListProductsTool(server: McpServer): void {
  server.registerTool(
    "line_list_products",
    {
      title: "List LINE Shopping products",
      description: `List products in your LINE Shopping (MyShop) store. GET /myshop/v1/products.

  - Paginated (page, per_page 1..${MYSHOP_MAX_PER_PAGE}). Optionally filter by ids[] or skus[].
  - Returns id, name, and the full product payload in structuredContent.

Examples:
  - "ดูสินค้าทั้งหมด" → {}
  - "สินค้าหน้า 2 หน้าละ 50" → { page: 2, per_page: 50 }`,
      inputSchema: InputSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (raw: unknown) => {
      try {
        const params = InputSchema.parse(raw);
        const { apiKey } = resolveMyShopKey(params.oa);
        const client = new MyShopClient({ apiKey });
        const res = await client.listProducts({
          ids: params.ids,
          skus: params.skus,
          page: params.page,
          perPage: params.per_page,
        });
        const items = res.data ?? [];
        if (params.response_format === "json") {
          return ok(JSON.stringify(res, null, 2), res as unknown as Record<string, unknown>);
        }
        const header = `# 🛍️ สินค้า (${res.totalRow ?? items.length} รายการ • หน้า ${res.currentPage ?? params.page}/${res.totalPage ?? "?"})`;
        const lines =
          items
            .map((p) => `- \`${String(p.id)}\` — ${String(p.name ?? "(ไม่มีชื่อ)")}`)
            .join("\n") || "_ไม่มีสินค้า_";
        return ok(`${header}\n\n${lines}`, res as unknown as Record<string, unknown>);
      } catch (err) {
        return myShopError(err);
      }
    },
  );
}
