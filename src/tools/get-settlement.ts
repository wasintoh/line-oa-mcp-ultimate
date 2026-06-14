/**
 * Tool: line_get_settlement  (LINE Shopping / MyShop)
 * GET /myshop/v1/settlements/{orderNo} — income + fee breakdown for an order.
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

export function registerGetSettlementTool(server: McpServer): void {
  server.registerTool(
    "line_get_settlement",
    {
      title: "Get LINE Shopping settlement detail",
      description: `Get the settlement (income + fees, net payout) for an order.
GET /myshop/v1/settlements/{orderNo}. Returns orderIncomeDetail + settlementDetail.

Example:
  - "ออเดอร์ 100023 ได้เงินจริงเท่าไหร่หลังหักค่าธรรมเนียม" → { order_no: "100023" }`,
      inputSchema: InputSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (raw: unknown) => {
      try {
        const params = InputSchema.parse(raw);
        const { apiKey } = resolveMyShopKey(params.oa);
        const s = await new MyShopClient({ apiKey }).getSettlement(params.order_no);
        return ok(JSON.stringify(s, null, 2), s as unknown as Record<string, unknown>);
      } catch (err) {
        return myShopError(err);
      }
    },
  );
}
