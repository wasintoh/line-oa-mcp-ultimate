/**
 * Tool: line_list_orders  (LINE Shopping / MyShop)
 * GET /myshop/v1/orders — search/filter/paginate orders.
 *
 * This is the POLLING entry point: pair it with a scheduled task + start_at/end_at
 * (or payment/order status filters) to detect new orders without a webhook/server.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveMyShopKey } from "../config/multi-oa.js";
import { MyShopClient } from "../line/myshop-client.js";
import { MYSHOP_DEFAULT_PER_PAGE, MYSHOP_MAX_PER_PAGE } from "../constants.js";
import { myShopError, ok } from "./myshop-shared.js";

const InputSchema = z
  .object({
    search: z.string().optional().describe("Partial match on customer name or order number."),
    order_status: z
      .array(z.enum(["FINALIZED", "COMPLETED", "EXPIRED", "CANCELED"]))
      .optional()
      .describe("Filter by order status (multiple allowed)."),
    payment_status: z
      .array(z.enum(["NO_PAYMENT", "PENDING", "PAID", "REFUND", "PENDING_REFUND", "FAILED_REFUND"]))
      .optional()
      .describe("Filter by payment status (multiple allowed)."),
    payment_method: z.enum(["BANK", "COD", "RLP"]).optional().describe("BANK | COD | RLP (Rabbit LINE Pay)."),
    shipment_status: z
      .enum(["NO_SHIPMENT", "SHIPPED_ALL", "SHIPMENT_READY"])
      .optional(),
    start_at: z.string().optional().describe("ISO-8601 start of the time window (for polling)."),
    end_at: z.string().optional().describe("ISO-8601 end of the time window."),
    sort_by: z
      .enum(["ORDER_NO", "CREATED_AT", "UPDATED_AT", "CHECKED_OUT_AT"])
      .default("CREATED_AT"),
    order_by: z.enum(["DESC", "ASC"]).default("DESC"),
    page: z.number().int().positive().default(1),
    per_page: z.number().int().min(1).max(MYSHOP_MAX_PER_PAGE).default(MYSHOP_DEFAULT_PER_PAGE),
    oa: z.string().optional(),
    response_format: z.enum(["markdown", "json"]).default("markdown"),
  })
  .strict();

export function registerListOrdersTool(server: McpServer): void {
  server.registerTool(
    "line_list_orders",
    {
      title: "List LINE Shopping orders",
      description: `List/search orders in LINE Shopping (MyShop). GET /myshop/v1/orders. No order webhook in this server (by design) — to detect new orders, poll on a schedule with a status/time filter, e.g. { payment_status:["PAID"], start_at:"<last run ISO>" }. Filters: search, order_status[], payment_status[], payment_method, shipment_status, start_at/end_at (ISO), sort_by, order_by, pagination.

Example: "ออเดอร์ที่จ่ายแล้ววันนี้" → { payment_status:["PAID"], start_at:"2026-06-03T00:00:00+07:00" }.`,
      inputSchema: InputSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (raw: unknown) => {
      try {
        const params = InputSchema.parse(raw);
        const { apiKey } = resolveMyShopKey(params.oa);
        const res = await new MyShopClient({ apiKey }).listOrders({
          search: params.search,
          orderStatus: params.order_status,
          paymentStatus: params.payment_status,
          paymentMethod: params.payment_method,
          shipmentStatus: params.shipment_status,
          startAt: params.start_at,
          endAt: params.end_at,
          sortBy: params.sort_by,
          orderBy: params.order_by,
          page: params.page,
          perPage: params.per_page,
        });
        const items = res.data ?? [];
        if (params.response_format === "json") {
          return ok(JSON.stringify(res, null, 2), res as unknown as Record<string, unknown>);
        }
        const header = `# 🧾 ออเดอร์ (${res.totalRow ?? items.length} รายการ • หน้า ${res.currentPage ?? params.page}/${res.totalPage ?? "?"})`;
        const lines =
          items
            .map((o) => {
              const no = String(o.orderNo ?? o.orderNumber ?? "?");
              const status = o.orderStatus ? ` • ${String(o.orderStatus)}` : "";
              const pay = o.paymentStatus ? ` • ${String(o.paymentStatus)}` : "";
              return `- \`${no}\`${status}${pay}`;
            })
            .join("\n") || "_ไม่มีออเดอร์ตามเงื่อนไข_";
        return ok(`${header}\n\n${lines}`, res as unknown as Record<string, unknown>);
      } catch (err) {
        return myShopError(err);
      }
    },
  );
}
