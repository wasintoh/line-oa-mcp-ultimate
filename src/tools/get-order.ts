/**
 * Tool: line_get_order  (LINE Shopping / MyShop)
 * GET /myshop/v1/orders/{orderNo} — full order detail incl. orderItems[].
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveMyShopKey } from "../config/multi-oa.js";
import { MyShopClient } from "../line/myshop-client.js";
import { myShopError, ok } from "./myshop-shared.js";

const InputSchema = z
  .object({
    order_no: z.string().min(1).describe("Order number."),
    oa: z.string().optional(),
    response_format: z.enum(["markdown", "json"]).default("json"),
  })
  .strict();

export function registerGetOrderTool(server: McpServer): void {
  server.registerTool(
    "line_get_order",
    {
      title: "Get a LINE Shopping order detail",
      description: `Fetch full detail of one order (customer, items, amounts, statuses).
GET /myshop/v1/orders/{orderNo}.

Example:
  - "ดูรายละเอียดออเดอร์ 100023" → { order_no: "100023" }`,
      inputSchema: InputSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (raw: unknown) => {
      try {
        const params = InputSchema.parse(raw);
        const { apiKey } = resolveMyShopKey(params.oa);
        const order = await new MyShopClient({ apiKey }).getOrder(params.order_no);
        return ok(JSON.stringify(order, null, 2), order as unknown as Record<string, unknown>);
      } catch (err) {
        return myShopError(err);
      }
    },
  );
}
