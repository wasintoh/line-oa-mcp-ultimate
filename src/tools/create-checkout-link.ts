/**
 * Tool: line_create_checkout_link  (LINE Shopping / MyShop)
 * POST /myshop/v1/checkout-link — generate a payment link for a set of items.
 *
 * This is the "close the sale in chat" tool: build a checkout link and the
 * operator pastes it straight into the customer's LINE chat. Cuts stock on
 * LINE Shopping without any external OMS.
 *
 * NOTE: each item follows MyShop's CheckoutLinkItem schema. We accept friendly
 * { variant_id, quantity } and also passthrough any extra keys, so the exact
 * field names from the live Swagger always work.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveMyShopKey } from "../config/multi-oa.js";
import { MyShopClient } from "../line/myshop-client.js";
import { MYSHOP_CHECKOUT_MAX_ITEMS } from "../constants.js";
import { myShopError, ok } from "./myshop-shared.js";
import type { CheckoutLinkItem } from "../types.js";

const ItemSchema = z
  .object({
    variant_id: z.union([z.string(), z.number()]).optional().describe("Variant id."),
    product_id: z.union([z.string(), z.number()]).optional().describe("Product id (if variant not used)."),
    quantity: z.number().int().positive().default(1).describe("Quantity (default 1)."),
  })
  .passthrough();

const InputSchema = z
  .object({
    items: z
      .array(ItemSchema)
      .min(1)
      .max(MYSHOP_CHECKOUT_MAX_ITEMS)
      .describe(`Items to check out, 1..${MYSHOP_CHECKOUT_MAX_ITEMS}.`),
    oa: z.string().optional(),
  })
  .strict();

export function registerCreateCheckoutLinkTool(server: McpServer): void {
  server.registerTool(
    "line_create_checkout_link",
    {
      title: "Create a LINE Shopping checkout link",
      description: `Generate a checkout (payment) link for a set of items. POST /myshop/v1/checkout-link.
Paste the returned link into the customer's chat to close the sale — no external OMS needed.
Each item maps to MyShop's CheckoutLinkItem (e.g. variantId + quantity); extra keys pass through.

Example:
  - "ลูกค้าอยากได้ variant V9 จำนวน 2 ชิ้น สร้างลิงก์จ่ายเงิน" →
      { items: [{ variant_id: "V9", quantity: 2 }] }`,
      inputSchema: InputSchema.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (raw: unknown) => {
      try {
        const params = InputSchema.parse(raw);
        const { apiKey } = resolveMyShopKey(params.oa);

        const orderItems: CheckoutLinkItem[] = params.items.map((it) => {
          const { variant_id, product_id, quantity, ...rest } = it as Record<string, unknown>;
          const item: Record<string, unknown> = { quantity: quantity ?? 1, ...rest };
          if (variant_id !== undefined) item.variantId = variant_id;
          if (product_id !== undefined) item.productId = product_id;
          return item;
        });

        const res = await new MyShopClient({ apiKey }).createCheckoutLink(orderItems);
        return ok(`🔗 สร้างลิงก์จ่ายเงินสำเร็จ — ส่งให้ลูกค้าได้เลย:\n${res.checkoutLink}`, {
          checkout_link: res.checkoutLink,
          items: orderItems,
        });
      } catch (err) {
        return myShopError(err);
      }
    },
  );
}
