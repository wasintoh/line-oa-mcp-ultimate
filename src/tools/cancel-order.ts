/**
 * Tool: line_cancel_order  (LINE Shopping / MyShop)
 * PUT /myshop/v1/orders/{orderNo}/cancel — cancel an order. Requires confirm.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveMyShopKey } from "../config/multi-oa.js";
import { MyShopClient } from "../line/myshop-client.js";
import { TH } from "../i18n/th.js";
import { myShopError, ok, fail } from "./myshop-shared.js";

const InputSchema = z
  .object({
    order_no: z.string().min(1).describe("Order number to cancel."),
    confirm: z.boolean().default(false).describe("Must be true — cancellation cannot be undone."),
    oa: z.string().optional(),
  })
  .strict();

export function registerCancelOrderTool(server: McpServer): void {
  server.registerTool(
    "line_cancel_order",
    {
      title: "Cancel a LINE Shopping order",
      description: `Cancel an order. PUT /myshop/v1/orders/{orderNo}/cancel.
IRREVERSIBLE — requires confirm=true.

Example:
  - "ยกเลิกออเดอร์ 100023" → { order_no: "100023", confirm: true }`,
      inputSchema: InputSchema.shape,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async (raw: unknown) => {
      try {
        const params = InputSchema.parse(raw);
        if (!params.confirm) return fail(TH.confirmRequired("ยกเลิกออเดอร์"));
        const { apiKey } = resolveMyShopKey(params.oa);
        await new MyShopClient({ apiKey }).cancelOrder(params.order_no);
        return ok(`🛑 ยกเลิกออเดอร์ \`${params.order_no}\` สำเร็จ`, {
          success: true,
          canceled_order: params.order_no,
        });
      } catch (err) {
        return myShopError(err);
      }
    },
  );
}
