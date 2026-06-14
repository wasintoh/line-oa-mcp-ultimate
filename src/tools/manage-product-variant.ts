/**
 * Tool: line_manage_product_variant  (LINE Shopping / MyShop)
 * Three variant operations folded into one tool:
 *   create        → POST  /myshop/v1/products/{id}/variants
 *   update        → PATCH /myshop/v1/products/{id}/variant
 *   delete_option → POST  /myshop/v1/products/{id}/delete-variant-option
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveMyShopKey } from "../config/multi-oa.js";
import { MyShopClient } from "../line/myshop-client.js";
import { myShopError, ok, fail } from "./myshop-shared.js";

const InputSchema = z
  .object({
    mode: z
      .enum(["create", "update", "delete_option"])
      .describe("create a variant; update a variant; or delete a variant option (size/color value)."),
    product_id: z.string().min(1).describe("Product id."),
    // create / update fields
    variant_id: z.string().optional().describe("Variant id (required for mode='update')."),
    price: z.number().nonnegative().optional(),
    weight: z.number().nonnegative().optional().describe("Weight in grams."),
    sku: z.string().optional(),
    barcode: z.string().optional().describe("update only."),
    image_url: z.string().url().optional().describe("update only — public HTTPS image URL."),
    on_hand_number: z.number().int().nonnegative().optional().describe("Stock for the variant."),
    // delete_option fields
    option_name: z.string().optional().describe("Option group name, e.g. 'size' (delete_option)."),
    option_value: z.string().optional().describe("Option value, e.g. 'XL' (delete_option)."),
    oa: z.string().optional(),
  })
  .strict();

export function registerManageProductVariantTool(server: McpServer): void {
  server.registerTool(
    "line_manage_product_variant",
    {
      title: "Manage a LINE Shopping product variant",
      description: `Create/update a product variant, or delete a variant option.

  - create: { product_id, price, sku?, weight?, on_hand_number? }
  - update: { product_id, variant_id, ...fields to change (price/sku/weight/barcode/image_url/on_hand_number) }
  - delete_option: { product_id, option_name, option_value } (e.g. remove size "XL")

Examples:
  - "เพิ่มไซส์ XL ให้สินค้า P123 ราคา 390" → { mode: "create", product_id: "P123", price: 390, sku: "XL" }
  - "แก้ราคา variant V9 เป็น 350" → { mode: "update", product_id: "P123", variant_id: "V9", price: 350 }`,
      inputSchema: InputSchema.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (raw: unknown) => {
      try {
        const params = InputSchema.parse(raw);
        const { apiKey } = resolveMyShopKey(params.oa);
        const c = new MyShopClient({ apiKey });

        if (params.mode === "create") {
          if (params.price === undefined) return fail("❌ mode='create' ต้องระบุ price");
          const body: Record<string, unknown> = { price: params.price };
          if (params.weight !== undefined) body.weight = params.weight;
          if (params.sku !== undefined) body.sku = params.sku;
          if (params.on_hand_number !== undefined) body.onHandNumber = params.on_hand_number;
          await c.createVariant(params.product_id, body);
          return ok(`✅ เพิ่ม variant ให้สินค้า \`${params.product_id}\` สำเร็จ`, {
            product_id: params.product_id,
          });
        }

        if (params.mode === "update") {
          if (!params.variant_id) return fail("❌ mode='update' ต้องระบุ variant_id");
          const body: Record<string, unknown> = { id: params.variant_id };
          if (params.price !== undefined) body.price = params.price;
          if (params.weight !== undefined) body.weight = params.weight;
          if (params.sku !== undefined) body.sku = params.sku;
          if (params.barcode !== undefined) body.barcode = params.barcode;
          if (params.image_url !== undefined) body.imageUrl = params.image_url;
          if (params.on_hand_number !== undefined) body.onHandNumber = params.on_hand_number;
          await c.updateVariant(params.product_id, body);
          return ok(`✅ อัปเดต variant \`${params.variant_id}\` ของสินค้า \`${params.product_id}\` สำเร็จ`, {
            product_id: params.product_id,
            variant_id: params.variant_id,
          });
        }

        // delete_option
        if (!params.option_name || !params.option_value) {
          return fail("❌ mode='delete_option' ต้องระบุ option_name และ option_value");
        }
        await c.deleteVariantOption(params.product_id, {
          name: params.option_name,
          value: params.option_value,
        });
        return ok(
          `🗑️ ลบตัวเลือก "${params.option_name}: ${params.option_value}" ของสินค้า \`${params.product_id}\` สำเร็จ`,
          { product_id: params.product_id },
        );
      } catch (err) {
        return myShopError(err);
      }
    },
  );
}
