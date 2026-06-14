/**
 * Tool: line_delete_product  (LINE Shopping / MyShop)
 * DELETE /myshop/v1/products/{id} — permanently delete a product. Requires confirm.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveMyShopKey } from "../config/multi-oa.js";
import { MyShopClient } from "../line/myshop-client.js";
import { TH } from "../i18n/th.js";
import { myShopError, ok, fail } from "./myshop-shared.js";

const InputSchema = z
  .object({
    id: z.string().min(1).describe("Product id to delete."),
    confirm: z.boolean().default(false).describe("Must be true — deletion is irreversible."),
    oa: z.string().optional(),
  })
  .strict();

export function registerDeleteProductTool(server: McpServer): void {
  server.registerTool(
    "line_delete_product",
    {
      title: "Delete a LINE Shopping product",
      description: `Permanently delete a product. DELETE /myshop/v1/products/{id}.
IRREVERSIBLE — requires confirm=true. To merely take a product off sale without
deleting it, use line_set_product_visibility (status="hide") instead.

Example:
  - "ลบสินค้า P123" → { id: "P123", confirm: true }`,
      inputSchema: InputSchema.shape,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (raw: unknown) => {
      try {
        const params = InputSchema.parse(raw);
        if (!params.confirm) return fail(TH.confirmRequired("ลบสินค้า"));
        const { apiKey } = resolveMyShopKey(params.oa);
        await new MyShopClient({ apiKey }).deleteProduct(params.id);
        return ok(`🗑️ ลบสินค้า \`${params.id}\` สำเร็จ`, { success: true, deleted_id: params.id });
      } catch (err) {
        return myShopError(err);
      }
    },
  );
}
