/**
 * Tool: line_manage_inventory  (LINE Shopping / MyShop)
 * PUT /myshop/v1/inventory/{id}/{adjust|increase|decrease}
 *   - set      → adjust   (absolute overwrite)
 *   - increase → increase (relative +)
 *   - decrease → decrease (relative −)
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveMyShopKey } from "../config/multi-oa.js";
import { MyShopClient } from "../line/myshop-client.js";
import { MYSHOP_INVENTORY_MAX } from "../constants.js";
import { myShopError, ok } from "./myshop-shared.js";
import type { MyShopInventoryResult } from "../types.js";

const InputSchema = z
  .object({
    id: z.string().min(1).describe("Variant/inventory id."),
    mode: z
      .enum(["set", "increase", "decrease"])
      .describe("set = overwrite to an absolute number; increase/decrease = relative change."),
    amount: z
      .number()
      .int()
      .min(1)
      .max(MYSHOP_INVENTORY_MAX)
      .describe(`Amount, 1..${MYSHOP_INVENTORY_MAX.toLocaleString()}.`),
    oa: z.string().optional(),
  })
  .strict();

export function registerManageInventoryTool(server: McpServer): void {
  server.registerTool(
    "line_manage_inventory",
    {
      title: "Manage LINE Shopping inventory",
      description: `Adjust stock for a product variant. PUT /myshop/v1/inventory/{id}/{adjust|increase|decrease}.

  - set: overwrite to an absolute number (adjust)
  - increase: add to current stock
  - decrease: subtract from current stock
  amount must be 1..${MYSHOP_INVENTORY_MAX.toLocaleString()}.

Examples:
  - "ตั้งสต็อก V9 เป็น 100" → { id: "V9", mode: "set", amount: 100 }
  - "เติมสต็อก V9 อีก 50" → { id: "V9", mode: "increase", amount: 50 }`,
      inputSchema: InputSchema.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (raw: unknown) => {
      try {
        const params = InputSchema.parse(raw);
        const { apiKey } = resolveMyShopKey(params.oa);
        const c = new MyShopClient({ apiKey });
        let res: MyShopInventoryResult;
        if (params.mode === "set") res = await c.adjustInventory(params.id, params.amount);
        else if (params.mode === "increase") res = await c.increaseInventory(params.id, params.amount);
        else res = await c.decreaseInventory(params.id, params.amount);
        const verb = params.mode === "set" ? "ตั้งเป็น" : params.mode === "increase" ? "เพิ่ม" : "ลด";
        return ok(
          `📦 ${verb} ${params.amount} สำหรับ \`${params.id}\` สำเร็จ\nคงเหลือพร้อมขาย: ${res.availableNumber ?? "?"} (onHand ${res.onHandAmount ?? "?"}, reserved ${res.reservedAmount ?? "?"})`,
          res as unknown as Record<string, unknown>,
        );
      } catch (err) {
        return myShopError(err);
      }
    },
  );
}
