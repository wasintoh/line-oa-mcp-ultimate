/**
 * Tool: line_update_product  (LINE Shopping / MyShop)
 * PATCH /myshop/v1/products/{id} — update product detail fields.
 * (Price is a separate endpoint — use line_update_product_price.)
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveMyShopKey } from "../config/multi-oa.js";
import { MyShopClient } from "../line/myshop-client.js";
import { myShopError, ok, fail } from "./myshop-shared.js";

const InputSchema = z
  .object({
    id: z.string().min(1).describe("Product id."),
    name: z.string().optional(),
    description: z.string().optional().describe("Description (HTML allowed)."),
    brand: z.string().optional(),
    category_id: z.union([z.string(), z.number()]).optional(),
    code: z.string().optional(),
    image_urls: z
      .array(z.string().url())
      .optional()
      .describe("Public HTTPS image URLs (JPEG/PNG)."),
    oa: z.string().optional(),
  })
  .strict();

export function registerUpdateProductTool(server: McpServer): void {
  server.registerTool(
    "line_update_product",
    {
      title: "Update a LINE Shopping product",
      description: `Update a product's detail fields. PATCH /myshop/v1/products/{id}.
Only provided fields are changed. For price use line_update_product_price; for
stock use line_manage_inventory; for show/hide use line_set_product_visibility.

Example:
  - "เปลี่ยนชื่อสินค้า P123 เป็น เสื้อยืดพรีเมียม" → { id: "P123", name: "เสื้อยืดพรีเมียม" }`,
      inputSchema: InputSchema.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (raw: unknown) => {
      try {
        const params = InputSchema.parse(raw);
        const { apiKey } = resolveMyShopKey(params.oa);

        const body: Record<string, unknown> = {};
        if (params.name !== undefined) body.name = params.name;
        if (params.description !== undefined) body.description = params.description;
        if (params.brand !== undefined) body.brand = params.brand;
        if (params.category_id !== undefined) body.categoryId = params.category_id;
        if (params.code !== undefined) body.code = params.code;
        if (params.image_urls !== undefined) body.imageUrls = params.image_urls;

        if (Object.keys(body).length === 0) {
          return fail("❌ ต้องระบุอย่างน้อยหนึ่งฟิลด์ที่จะแก้ไข (name, description, brand, ...)");
        }

        await new MyShopClient({ apiKey }).updateProduct(params.id, body);
        return ok(`✅ อัปเดตสินค้า \`${params.id}\` สำเร็จ (${Object.keys(body).join(", ")})`, {
          id: params.id,
          updated_fields: Object.keys(body),
        });
      } catch (err) {
        return myShopError(err);
      }
    },
  );
}
