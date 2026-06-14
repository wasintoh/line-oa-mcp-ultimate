/**
 * Tool: line_fulfill_order  (LINE Shopping / MyShop)
 * Folds the four order-fulfillment endpoints into one tool:
 *   ship           → POST /mark-as-ship   (+trackingNumber; auto-notifies buyer on LINE)
 *   paid           → POST /mark-as-paid    (COD; after ship → COMPLETED)
 *   update_tracking→ PUT  /shipments       (update tracking number)
 *   parcel_label   → POST /parcel-label    (print parcel label)
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveMyShopKey } from "../config/multi-oa.js";
import { MyShopClient } from "../line/myshop-client.js";
import { MYSHOP_TRACKING_MAX_LEN } from "../constants.js";
import { myShopError, ok, fail } from "./myshop-shared.js";

const InputSchema = z
  .object({
    mode: z
      .enum(["ship", "paid", "update_tracking", "parcel_label"])
      .describe("ship (mark shipped) | paid (COD mark paid) | update_tracking | parcel_label."),
    order_no: z.string().min(1).describe("Order number."),
    tracking_number: z
      .string()
      .max(MYSHOP_TRACKING_MAX_LEN)
      .optional()
      .describe(`Tracking number ≤${MYSHOP_TRACKING_MAX_LEN}. Used by ship (optional) / update_tracking (required).`),
    oa: z.string().optional(),
  })
  .strict();

export function registerFulfillOrderTool(server: McpServer): void {
  server.registerTool(
    "line_fulfill_order",
    {
      title: "Fulfill a LINE Shopping order",
      description: `Move an order through fulfillment. One tool, four modes:

  - ship: mark as shipped (optional tracking_number). Auto-sends a LINE message to the buyer.
  - paid: mark COD order as paid (call after ship → order becomes COMPLETED).
  - update_tracking: update the tracking number after shipping (tracking_number required).
  - parcel_label: get/print the parcel label.

Examples:
  - "ส่งของออเดอร์ 100023 เลขพัสดุ TH123" → { mode: "ship", order_no: "100023", tracking_number: "TH123" }
  - "ออกใบปะหน้าออเดอร์ 100023" → { mode: "parcel_label", order_no: "100023" }`,
      inputSchema: InputSchema.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (raw: unknown) => {
      try {
        const params = InputSchema.parse(raw);
        const { apiKey } = resolveMyShopKey(params.oa);
        const c = new MyShopClient({ apiKey });

        switch (params.mode) {
          case "ship": {
            await c.markOrderAsShip(params.order_no, params.tracking_number);
            const tail = params.tracking_number ? ` (เลขพัสดุ ${params.tracking_number})` : "";
            return ok(`🚚 ทำเครื่องหมาย "ส่งแล้ว" ออเดอร์ \`${params.order_no}\`${tail} — ลูกค้าได้รับแจ้งใน LINE แล้ว`, {
              order_no: params.order_no,
              tracking_number: params.tracking_number ?? null,
            });
          }
          case "paid": {
            await c.markOrderAsPaid(params.order_no);
            return ok(`💵 ทำเครื่องหมาย "จ่ายแล้ว" (COD) ออเดอร์ \`${params.order_no}\` สำเร็จ`, {
              order_no: params.order_no,
            });
          }
          case "update_tracking": {
            if (!params.tracking_number) return fail("❌ mode='update_tracking' ต้องระบุ tracking_number");
            await c.updateShipment(params.order_no, params.tracking_number);
            return ok(`📮 อัปเดตเลขพัสดุออเดอร์ \`${params.order_no}\` เป็น ${params.tracking_number}`, {
              order_no: params.order_no,
              tracking_number: params.tracking_number,
            });
          }
          case "parcel_label": {
            const label = await c.getParcelLabel(params.order_no);
            return ok(`🏷️ ใบปะหน้าพัสดุออเดอร์ \`${params.order_no}\` พร้อมแล้ว`, {
              order_no: params.order_no,
              label,
            } as Record<string, unknown>);
          }
        }
      } catch (err) {
        return myShopError(err);
      }
    },
  );
}
