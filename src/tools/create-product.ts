/**
 * Tool: line_create_product  (LINE Shopping / MyShop)
 * POST /myshop/v1/products — create a product.
 *
 * Accepts friendly inputs and maps them to LINE's schema. For a simple product,
 * pass name + price (+ on_hand / sku) and we build a single default variant.
 * For multi-variant products, pass variants[] (and optionally variant_options[]).
 *
 * NOTE: image_urls[] must be public HTTPS JPEG/PNG URLs — MyShop has no binary
 * upload endpoint (see README → Image hosting). Host the image first, pass URLs.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveMyShopKey } from "../config/multi-oa.js";
import { MyShopClient } from "../line/myshop-client.js";
import { myShopError, ok, fail } from "./myshop-shared.js";

const VariantSchema = z
  .object({
    price: z.number().nonnegative().describe("Variant price (THB)."),
    weight: z.number().nonnegative().optional().describe("Weight in grams (for shipping)."),
    sku: z.string().optional(),
    on_hand_number: z.number().int().nonnegative().optional().describe("Initial stock."),
  })
  .strict();

const InputSchema = z
  .object({
    name: z.string().min(1).describe("Product name (required)."),
    description: z.string().optional().describe("Description (HTML allowed)."),
    brand: z.string().optional(),
    category_id: z.union([z.string(), z.number()]).optional().describe("MyShop category id."),
    code: z.string().optional().describe("Product code."),
    image_urls: z
      .array(z.string().url())
      .optional()
      .describe("Public HTTPS image URLs (JPEG/PNG). MyShop has no upload API — host first."),
    instant_discount: z.number().nonnegative().optional(),
    // Simple single-variant shortcut:
    price: z.number().nonnegative().optional().describe("Price for a single default variant."),
    on_hand: z.number().int().nonnegative().optional().describe("Stock for the default variant."),
    sku: z.string().optional().describe("SKU for the default variant."),
    weight: z.number().nonnegative().optional().describe("Weight (g) for the default variant."),
    // Multi-variant:
    variants: z.array(VariantSchema).optional().describe("Explicit variants (overrides price/on_hand)."),
    variant_options: z
      .array(z.record(z.string(), z.unknown()))
      .optional()
      .describe("Variant option groups, e.g. size / color."),
    oa: z.string().optional(),
  })
  .strict();

export function registerCreateProductTool(server: McpServer): void {
  server.registerTool(
    "line_create_product",
    {
      title: "Create a LINE Shopping product",
      description: `Create a product in LINE Shopping (MyShop). POST /myshop/v1/products. Simple: name + price (+ on_hand, sku, weight) → one default variant. Multi-variant: pass variants[] = [{ price, weight?, sku?, on_hand_number? }]. image_urls[] must be public HTTPS JPEG/PNG (no upload API — host first). New products are created HIDDEN (isDisplay=false) — publish with line_set_product_visibility.

Example: "เพิ่มเสื้อยืด 299 สต็อก 50" → { name:"เสื้อยืด", price:299, on_hand:50 }.`,
      inputSchema: InputSchema.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (raw: unknown) => {
      try {
        const params = InputSchema.parse(raw);
        const { apiKey } = resolveMyShopKey(params.oa);

        // Build variants: explicit variants[] win; else a single default from price.
        let variants: Record<string, unknown>[];
        if (params.variants && params.variants.length > 0) {
          variants = params.variants.map((v) => ({
            price: v.price,
            ...(v.weight !== undefined ? { weight: v.weight } : {}),
            ...(v.sku !== undefined ? { sku: v.sku } : {}),
            ...(v.on_hand_number !== undefined ? { onHandNumber: v.on_hand_number } : {}),
          }));
        } else if (params.price !== undefined) {
          variants = [
            {
              price: params.price,
              ...(params.weight !== undefined ? { weight: params.weight } : {}),
              ...(params.sku !== undefined ? { sku: params.sku } : {}),
              ...(params.on_hand !== undefined ? { onHandNumber: params.on_hand } : {}),
            },
          ];
        } else {
          return fail("❌ ต้องระบุ price (สินค้าตัวเดียว) หรือ variants[] อย่างน้อยหนึ่งอย่าง");
        }

        const body: Record<string, unknown> = { name: params.name, variants };
        if (params.description !== undefined) body.description = params.description;
        if (params.brand !== undefined) body.brand = params.brand;
        if (params.category_id !== undefined) body.categoryId = params.category_id;
        if (params.code !== undefined) body.code = params.code;
        if (params.image_urls !== undefined) body.imageUrls = params.image_urls;
        if (params.instant_discount !== undefined) body.instantDiscount = params.instant_discount;
        if (params.variant_options !== undefined) body.variantOptions = params.variant_options;

        const res = await client(apiKey).createProduct(body);
        return ok(
          `✅ สร้างสินค้า "${params.name}" สำเร็จ (id \`${String(res.id)}\`)\nℹ️ สินค้าถูกสร้างแบบ "ซ่อน" — ใช้ line_set_product_visibility เพื่อเปิดขาย`,
          res as unknown as Record<string, unknown>,
        );
      } catch (err) {
        return myShopError(err);
      }
    },
  );
}

function client(apiKey: string): MyShopClient {
  return new MyShopClient({ apiKey });
}
