/**
 * Tool: line_update_product_price  (LINE Shopping / MyShop)
 * PATCH /myshop/v1/products/{id}/prices — update price + instant discount.
 * (Blocked by LINE while a promotion is active on the product.)
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveMyShopKey } from "../config/multi-oa.js";
import { MyShopClient } from "../line/myshop-client.js";
import { myShopError, ok } from "./myshop-shared.js";

const InputSchema = z
  .object({
    id: z.string().min(1).describe("Product id."),
    price: z.number().nonnegative().describe("New price (THB)."),
    instant_discount: z
      .number()
      .nonnegative()
      .optional()
      .describe("Instant discount amount (0 = none)."),
    oa: z.string().optional(),
  })
  .strict();

export function registerUpdateProductPriceTool(server: McpServer): void {
  server.registerTool(
    "line_update_product_price",
    {
      title: "Update LINE Shopping product price",
      description: `Update a product's price (and optional instant discount).
PATCH /myshop/v1/products/{id}/prices. NOTE: LINE blocks price edits while a
promotion is active on the product.

Examples:
  - "ตั้งราคาสินค้า P123 เป็น 350" → { id: "P123", price: 350 }
  - "ลดสินค้า P123 เหลือจ่ายจริง 299 (ลด 51)" → { id: "P123", price: 350, instant_discount: 51 }`,
      inputSchema: InputSchema.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (raw: unknown) => {
      try {
        const params = InputSchema.parse(raw);
        const { apiKey } = resolveMyShopKey(params.oa);
        const body: Record<string, unknown> = { price: params.price };
        if (params.instant_discount !== undefined) body.instantDiscount = params.instant_discount;
        await new MyShopClient({ apiKey }).updateProductPrice(params.id, body);
        const disc =
          params.instant_discount && params.instant_discount > 0
            ? ` (ลด ${params.instant_discount} → จ่ายจริง ${params.price - params.instant_discount})`
            : "";
        return ok(`✅ อัปเดตราคาสินค้า \`${params.id}\` เป็น ${params.price} บาท${disc}`, {
          id: params.id,
          price: params.price,
          instant_discount: params.instant_discount ?? 0,
        });
      } catch (err) {
        return myShopError(err);
      }
    },
  );
}
