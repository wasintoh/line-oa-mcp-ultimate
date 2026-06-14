/**
 * Tool: line_set_product_visibility  (LINE Shopping / MyShop)
 * POST /myshop/v1/products/{id}/display-status/{onsale|hide}
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveMyShopKey } from "../config/multi-oa.js";
import { MyShopClient } from "../line/myshop-client.js";
import { myShopError, ok } from "./myshop-shared.js";

const InputSchema = z
  .object({
    id: z.string().min(1).describe("Product id."),
    status: z
      .enum(["onsale", "hide"])
      .describe("onsale = publish/show for sale; hide = take off sale (not deleted)."),
    oa: z.string().optional(),
  })
  .strict();

export function registerSetProductVisibilityTool(server: McpServer): void {
  server.registerTool(
    "line_set_product_visibility",
    {
      title: "Show or hide a LINE Shopping product",
      description: `Publish (onsale) or unpublish (hide) a product without deleting it.
POST /myshop/v1/products/{id}/display-status/{status}. New products start hidden,
so call this with status="onsale" to put them on sale.

Examples:
  - "เปิดขายสินค้า P123" → { id: "P123", status: "onsale" }
  - "ซ่อนสินค้าที่หมด P456" → { id: "P456", status: "hide" }`,
      inputSchema: InputSchema.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (raw: unknown) => {
      try {
        const params = InputSchema.parse(raw);
        const { apiKey } = resolveMyShopKey(params.oa);
        await new MyShopClient({ apiKey }).setProductDisplayStatus(params.id, params.status);
        const label = params.status === "onsale" ? "เปิดขาย ✅" : "ซ่อน 🙈";
        return ok(`${label} สินค้า \`${params.id}\` เรียบร้อย`, {
          id: params.id,
          status: params.status,
        });
      } catch (err) {
        return myShopError(err);
      }
    },
  );
}
