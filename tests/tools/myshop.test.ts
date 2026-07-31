/**
 * E2E tool tests — LINE Shopping (MyShop) group + registration gating + resources/prompts.
 *
 * Every MyShop tool is driven through the real MCP client (tests/helpers/mcp.ts)
 * with all traffic intercepted at globalThis.fetch. Per tool we assert:
 *   (a) happy path hits the EXACT MyShop endpoint/method with the right body/query,
 *       carries the X-API-KEY header (NOT Bearer), and returns sane structuredContent;
 *   (b) at least one invalid input is rejected at the schema boundary
 *       (isError / "Input validation error") with ZERO network calls;
 *   (c) at least one MyShop API error (401/403/404/429/400) surfaces the Thai message.
 *
 * MyShop tools register ONLY when a key exists — so the whole group boots with
 * LINE_MYSHOP_API_KEY set BEFORE createTestMcp(). A dedicated "gating" describe
 * proves graceful degradation (37 tools without the key, 51 with it).
 *
 * Fetch-mock routing is SUBSTRING based, first-match-in-registration-order — the
 * more specific path must be registered BEFORE the shorter one.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TH } from "../../src/i18n/th.js";
import { installFetchMock, type FetchMock } from "../helpers/fetch-mock.js";
import { isolateConfigEnv, useSingleOaEnv, useConfigFile } from "../helpers/env.js";
import { createTestMcp, firstText, type TestMcp } from "../helpers/mcp.js";

let restoreEnv: () => void;
let api: FetchMock;
let mcp: TestMcp;

/** Boot the fetch mock + real MCP server after installing the given config env. */
async function boot(setupEnv: () => void): Promise<void> {
  restoreEnv = isolateConfigEnv();
  setupEnv();
  api = installFetchMock();
  mcp = await createTestMcp();
}

/** Single-OA env config WITH a MyShop key — the standard boot for the shopping group. */
function myShopEnv(): void {
  process.env.LINE_MYSHOP_API_KEY = "test-myshop-key";
  useSingleOaEnv("shop-token");
}

afterEach(async () => {
  if (mcp) await mcp.close();
  if (api) api.uninstall();
  if (restoreEnv) restoreEnv();
});

/** The X-API-KEY header the client attached to the most recent request (lower-cased key). */
function lastApiKey(): string | undefined {
  return api.lastCall()?.headers["x-api-key"];
}

// ============================================================================
// Registration gating (graceful degradation)
// ============================================================================
describe("MyShop registration gating", () => {
  it("without a MyShop key: 37 messaging tools and NO shopping tools", async () => {
    await boot(() => useSingleOaEnv("plain-token"));
    const { tools } = await mcp.client.listTools();
    const names = tools.map((t) => t.name);
    expect(tools.length).toBe(37);
    expect(names).not.toContain("line_list_products");
    expect(names).not.toContain("line_create_checkout_link");
    expect(names).not.toContain("line_cancel_order");
  });

  it("with a MyShop key (env): 51 tools incl. the 14 shopping tools", async () => {
    await boot(myShopEnv);
    const { tools } = await mcp.client.listTools();
    const names = tools.map((t) => t.name);
    expect(tools.length).toBe(51); // 37 messaging + 14 MyShop
    for (const t of [
      "line_list_products",
      "line_create_product",
      "line_update_product",
      "line_delete_product",
      "line_update_product_price",
      "line_set_product_visibility",
      "line_manage_product_variant",
      "line_manage_inventory",
      "line_list_orders",
      "line_get_order",
      "line_fulfill_order",
      "line_cancel_order",
      "line_get_settlement",
      "line_create_checkout_link",
    ]) {
      expect(names).toContain(t);
    }
  });

  it("per-OA myshop_api_key: registers tools and flows through as X-API-KEY", async () => {
    await boot(() =>
      useConfigFile({
        default_oa: "main",
        oas: {
          main: { channel_access_token: "tok-main", myshop_api_key: "oa-key-main", display_name: "Main" },
          shop2: { channel_access_token: "tok-shop2", display_name: "Shop2" },
        },
      }),
    );
    // Tools registered because ONE OA (main) has a key — even though env has none.
    const { tools } = await mcp.client.listTools();
    expect(tools.map((t) => t.name)).toContain("line_list_products");

    api.on("/myshop/v1/products", { body: { currentPage: 1, data: [], perPage: 25, totalPage: 0, totalRow: 0 } });
    const res = await mcp.callTool("line_list_products", {});
    expect(res.isError).toBeFalsy();
    expect(lastApiKey()).toBe("oa-key-main");
    // Never a Bearer token — MyShop uses X-API-KEY only.
    expect(api.lastCall()?.headers.authorization).toBeUndefined();
  });

  it("calling with an OA that has no key (and no env fallback) surfaces the missing-key message, zero network", async () => {
    await boot(() =>
      useConfigFile({
        default_oa: "main",
        oas: {
          main: { channel_access_token: "tok-main", myshop_api_key: "oa-key-main", display_name: "Main" },
          shop2: { channel_access_token: "tok-shop2", display_name: "Shop2" },
        },
      }),
    );
    const res = await mcp.callTool("line_list_products", { oa: "shop2" });
    expect(res.isError).toBe(true);
    expect(firstText(res)).toContain("ยังไม่ได้ตั้ง MyShop API key");
    expect(api.calls).toHaveLength(0);
  });
});

// ============================================================================
// line_list_products  — GET /myshop/v1/products
// ============================================================================
describe("line_list_products", () => {
  beforeEach(async () => {
    await boot(myShopEnv);
  });

  it("GETs /myshop/v1/products with X-API-KEY and renders markdown", async () => {
    api.on("/myshop/v1/products", {
      body: { currentPage: 1, data: [{ id: "P1", name: "เสื้อยืด" }], perPage: 25, totalPage: 1, totalRow: 1 },
    });
    const res = await mcp.callTool("line_list_products", {});
    expect(res.isError).toBeFalsy();
    const call = api.lastCall()!;
    expect(call.method).toBe("GET");
    expect(call.url.pathname).toBe("/myshop/v1/products");
    expect(call.url.host).toBe("developers-oaplus.line.biz");
    expect(call.headers["x-api-key"]).toBe("test-myshop-key");
    expect(firstText(res)).toContain("🛍️ สินค้า");
    expect(firstText(res)).toContain("เสื้อยืด");
    expect((res.structuredContent!.data as unknown[]).length).toBe(1);
  });

  it("passes ids[]/skus[] repeated + page/per_page as query params", async () => {
    api.on("/myshop/v1/products", { body: { currentPage: 2, data: [], perPage: 50, totalPage: 0, totalRow: 0 } });
    await mcp.callTool("line_list_products", { ids: ["P1", "P2"], skus: ["S1"], page: 2, per_page: 50 });
    const sp = api.lastCall()!.url.searchParams;
    expect(sp.getAll("ids")).toEqual(["P1", "P2"]);
    expect(sp.getAll("skus")).toEqual(["S1"]);
    expect(sp.get("page")).toBe("2");
    expect(sp.get("perPage")).toBe("50");
  });

  it("response_format=json returns serialized JSON text", async () => {
    api.on("/myshop/v1/products", { body: { currentPage: 1, data: [], perPage: 25, totalPage: 0, totalRow: 0 } });
    const res = await mcp.callTool("line_list_products", { response_format: "json" });
    expect(res.isError).toBeFalsy();
    expect(firstText(res)).toContain('"totalRow": 0');
  });

  it("rejects per_page above the max with zero network calls", async () => {
    const res = await mcp.callTool("line_list_products", { per_page: 9999 });
    expect(res.isError).toBe(true);
    expect(firstText(res)).toContain("Input validation error");
    expect(api.calls).toHaveLength(0);
  });

  it("401 surfaces the Thai MyShop unauthorized message", async () => {
    api.on("/myshop/v1/products", { status: 401, body: { code: "UNAUTHORIZED", message: "bad key" } });
    const res = await mcp.callTool("line_list_products", {});
    expect(res.isError).toBe(true);
    expect(firstText(res)).toContain(TH.myShopUnauthorized);
  });
});

// ============================================================================
// line_create_product  — POST /myshop/v1/products
// ============================================================================
describe("line_create_product", () => {
  beforeEach(async () => {
    await boot(myShopEnv);
  });

  it("simple product: builds a single default variant from price/on_hand/sku/weight", async () => {
    api.on("/myshop/v1/products", { body: { id: "P9", isDisplay: false } });
    const res = await mcp.callTool("line_create_product", {
      name: "เสื้อยืด",
      price: 299,
      on_hand: 50,
      sku: "TS-1",
      weight: 100,
    });
    expect(res.isError).toBeFalsy();
    const call = api.lastCall()!;
    expect(call.method).toBe("POST");
    expect(call.url.pathname).toBe("/myshop/v1/products");
    const body = call.body as Record<string, unknown>;
    expect(body.name).toBe("เสื้อยืด");
    expect(body.variants).toEqual([{ price: 299, weight: 100, sku: "TS-1", onHandNumber: 50 }]);
    expect(firstText(res)).toContain("สร้างสินค้า");
    expect(firstText(res)).toContain("ซ่อน"); // created hidden
    expect(res.structuredContent!.id).toBe("P9");
  });

  it("multi-variant: maps variants[] and all optional detail fields", async () => {
    api.on("/myshop/v1/products", { body: { id: "P10" } });
    await mcp.callTool("line_create_product", {
      name: "เสื้อโปโล",
      description: "<b>ดี</b>",
      brand: "BrandX",
      category_id: 7,
      code: "POLO",
      image_urls: ["https://cdn.example.com/a.png"],
      instant_discount: 10,
      variants: [
        { price: 390, sku: "M" },
        { price: 390, sku: "L", weight: 120, on_hand_number: 5 },
      ],
      variant_options: [{ name: "size", values: ["M", "L"] }],
    });
    const body = api.lastCall()!.body as Record<string, unknown>;
    expect((body.variants as unknown[]).length).toBe(2);
    expect((body.variants as Record<string, unknown>[])[1]).toEqual({
      price: 390,
      weight: 120,
      sku: "L",
      onHandNumber: 5,
    });
    expect(body.description).toBe("<b>ดี</b>");
    expect(body.brand).toBe("BrandX");
    expect(body.categoryId).toBe(7);
    expect(body.code).toBe("POLO");
    expect(body.imageUrls).toEqual(["https://cdn.example.com/a.png"]);
    expect(body.instantDiscount).toBe(10);
    expect(body.variantOptions).toEqual([{ name: "size", values: ["M", "L"] }]);
  });

  it("neither price nor variants → business-rule fail (no network)", async () => {
    const res = await mcp.callTool("line_create_product", { name: "ไม่มีราคา" });
    expect(res.isError).toBe(true);
    expect(firstText(res)).toContain("ต้องระบุ price");
    expect(api.calls).toHaveLength(0);
  });

  it("rejects a missing name at the schema boundary with zero network calls", async () => {
    const res = await mcp.callTool("line_create_product", { price: 100 });
    expect(res.isError).toBe(true);
    expect(firstText(res)).toContain("Input validation error");
    expect(api.calls).toHaveLength(0);
  });

  it("400 with a message surfaces the generic MyShop error text", async () => {
    api.on("/myshop/v1/products", { status: 400, body: { code: "BAD_REQUEST", message: "invalid category" } });
    const res = await mcp.callTool("line_create_product", { name: "x", price: 10 });
    expect(res.isError).toBe(true);
    expect(firstText(res)).toContain("MyShop 400");
    expect(firstText(res)).toContain("invalid category");
  });
});

// ============================================================================
// line_update_product  — PATCH /myshop/v1/products/{id}
// ============================================================================
describe("line_update_product", () => {
  beforeEach(async () => {
    await boot(myShopEnv);
  });

  it("PATCHes only the provided detail fields", async () => {
    api.on("/myshop/v1/products/P123", { body: {} });
    const res = await mcp.callTool("line_update_product", {
      id: "P123",
      name: "เสื้อยืดพรีเมียม",
      description: "ใหม่",
      brand: "B",
      category_id: 3,
      code: "C1",
      image_urls: ["https://cdn.example.com/x.png"],
    });
    expect(res.isError).toBeFalsy();
    const call = api.lastCall()!;
    expect(call.method).toBe("PATCH");
    expect(call.url.pathname).toBe("/myshop/v1/products/P123");
    expect(call.body).toEqual({
      name: "เสื้อยืดพรีเมียม",
      description: "ใหม่",
      brand: "B",
      categoryId: 3,
      code: "C1",
      imageUrls: ["https://cdn.example.com/x.png"],
    });
    expect(res.structuredContent!.updated_fields).toEqual(["name", "description", "brand", "categoryId", "code", "imageUrls"]);
  });

  it("no editable field → business-rule fail (no network)", async () => {
    const res = await mcp.callTool("line_update_product", { id: "P1" });
    expect(res.isError).toBe(true);
    expect(firstText(res)).toContain("ต้องระบุอย่างน้อยหนึ่งฟิลด์");
    expect(api.calls).toHaveLength(0);
  });

  it("rejects an empty id with zero network calls", async () => {
    const res = await mcp.callTool("line_update_product", { id: "", name: "x" });
    expect(res.isError).toBe(true);
    expect(api.calls).toHaveLength(0);
  });

  it("404 surfaces the Thai MyShop not-found message", async () => {
    api.on("/myshop/v1/products/P404", { status: 404, body: { code: "NOT_FOUND", message: "nope" } });
    const res = await mcp.callTool("line_update_product", { id: "P404", name: "x" });
    expect(res.isError).toBe(true);
    expect(firstText(res)).toContain(TH.myShopNotFound);
  });
});

// ============================================================================
// line_delete_product  — DELETE /myshop/v1/products/{id} (confirm gate)
// ============================================================================
describe("line_delete_product", () => {
  beforeEach(async () => {
    await boot(myShopEnv);
  });

  it("confirm=true DELETEs the product", async () => {
    api.on("/myshop/v1/products/P123", { body: {} });
    const res = await mcp.callTool("line_delete_product", { id: "P123", confirm: true });
    expect(res.isError).toBeFalsy();
    const call = api.lastCall()!;
    expect(call.method).toBe("DELETE");
    expect(call.url.pathname).toBe("/myshop/v1/products/P123");
    expect(res.structuredContent!.deleted_id).toBe("P123");
    expect(firstText(res)).toContain("ลบสินค้า");
  });

  it("confirm omitted → confirm gate, zero network", async () => {
    const res = await mcp.callTool("line_delete_product", { id: "P123" });
    expect(res.isError).toBe(true);
    expect(firstText(res)).toContain(TH.confirmRequired("ลบสินค้า"));
    expect(api.calls).toHaveLength(0);
  });

  it("rejects a missing id with zero network calls", async () => {
    const res = await mcp.callTool("line_delete_product", { confirm: true });
    expect(res.isError).toBe(true);
    expect(api.calls).toHaveLength(0);
  });

  it("404 surfaces the Thai MyShop not-found message", async () => {
    api.on("/myshop/v1/products/P404", { status: 404, body: { code: "NOT_FOUND", message: "nope" } });
    const res = await mcp.callTool("line_delete_product", { id: "P404", confirm: true });
    expect(res.isError).toBe(true);
    expect(firstText(res)).toContain(TH.myShopNotFound);
  });
});

// ============================================================================
// line_update_product_price  — PATCH /myshop/v1/products/{id}/prices
// ============================================================================
describe("line_update_product_price", () => {
  beforeEach(async () => {
    await boot(myShopEnv);
  });

  it("PATCHes /prices with the new price", async () => {
    api.on("/myshop/v1/products/P123/prices", { body: {} });
    const res = await mcp.callTool("line_update_product_price", { id: "P123", price: 350 });
    expect(res.isError).toBeFalsy();
    const call = api.lastCall()!;
    expect(call.method).toBe("PATCH");
    expect(call.url.pathname).toBe("/myshop/v1/products/P123/prices");
    expect(call.body).toEqual({ price: 350 });
    expect(res.structuredContent!.price).toBe(350);
  });

  it("instant_discount is mapped and reflected in the summary text", async () => {
    api.on("/myshop/v1/products/P123/prices", { body: {} });
    const res = await mcp.callTool("line_update_product_price", { id: "P123", price: 350, instant_discount: 51 });
    expect(res.isError).toBeFalsy();
    expect(api.lastCall()!.body).toEqual({ price: 350, instantDiscount: 51 });
    expect(firstText(res)).toContain("ลด 51 → จ่ายจริง 299");
  });

  it("rejects a missing price with zero network calls", async () => {
    const res = await mcp.callTool("line_update_product_price", { id: "P1" });
    expect(res.isError).toBe(true);
    expect(api.calls).toHaveLength(0);
  });

  it("403 surfaces the Thai MyShop forbidden message", async () => {
    api.on("/myshop/v1/products/P1/prices", { status: 403, body: { code: "FORBIDDEN", message: "promo active" } });
    const res = await mcp.callTool("line_update_product_price", { id: "P1", price: 100 });
    expect(res.isError).toBe(true);
    expect(firstText(res)).toContain(TH.myShopForbidden);
  });
});

// ============================================================================
// line_set_product_visibility  — POST /myshop/v1/products/{id}/display-status/{status}
// ============================================================================
describe("line_set_product_visibility", () => {
  beforeEach(async () => {
    await boot(myShopEnv);
  });

  it("onsale POSTs to /display-status/onsale", async () => {
    api.on("/display-status/onsale", { body: {} });
    const res = await mcp.callTool("line_set_product_visibility", { id: "P123", status: "onsale" });
    expect(res.isError).toBeFalsy();
    const call = api.lastCall()!;
    expect(call.method).toBe("POST");
    expect(call.url.pathname).toBe("/myshop/v1/products/P123/display-status/onsale");
    expect(res.structuredContent!.status).toBe("onsale");
    expect(firstText(res)).toContain("เปิดขาย");
  });

  it("hide POSTs to /display-status/hide", async () => {
    api.on("/display-status/hide", { body: {} });
    const res = await mcp.callTool("line_set_product_visibility", { id: "P456", status: "hide" });
    expect(res.isError).toBeFalsy();
    expect(api.lastCall()!.url.pathname).toBe("/myshop/v1/products/P456/display-status/hide");
    expect(firstText(res)).toContain("ซ่อน");
  });

  it("rejects an invalid status enum with zero network calls", async () => {
    const res = await mcp.callTool("line_set_product_visibility", { id: "P1", status: "maybe" });
    expect(res.isError).toBe(true);
    expect(firstText(res)).toContain("Input validation error");
    expect(api.calls).toHaveLength(0);
  });

  it("401 surfaces the Thai MyShop unauthorized message", async () => {
    api.on("/display-status/onsale", { status: 401, body: { code: "UNAUTHORIZED", message: "x" } });
    const res = await mcp.callTool("line_set_product_visibility", { id: "P1", status: "onsale" });
    expect(res.isError).toBe(true);
    expect(firstText(res)).toContain(TH.myShopUnauthorized);
  });
});

// ============================================================================
// line_manage_product_variant  — create / update / delete_option
// ============================================================================
describe("line_manage_product_variant", () => {
  beforeEach(async () => {
    await boot(myShopEnv);
  });

  it("create POSTs /variants with mapped body", async () => {
    api.on("/myshop/v1/products/P123/variants", { body: {} });
    const res = await mcp.callTool("line_manage_product_variant", {
      mode: "create",
      product_id: "P123",
      price: 390,
      sku: "XL",
      weight: 100,
      on_hand_number: 5,
    });
    expect(res.isError).toBeFalsy();
    const call = api.lastCall()!;
    expect(call.method).toBe("POST");
    expect(call.url.pathname).toBe("/myshop/v1/products/P123/variants");
    expect(call.body).toEqual({ price: 390, weight: 100, sku: "XL", onHandNumber: 5 });
    expect(firstText(res)).toContain("เพิ่ม variant");
  });

  it("create without price → business-rule fail (no network)", async () => {
    const res = await mcp.callTool("line_manage_product_variant", { mode: "create", product_id: "P1" });
    expect(res.isError).toBe(true);
    expect(firstText(res)).toContain("ต้องระบุ price");
    expect(api.calls).toHaveLength(0);
  });

  it("update PATCHes /variant with the variant id + changed fields", async () => {
    api.on("/myshop/v1/products/P123/variant", { body: {} });
    const res = await mcp.callTool("line_manage_product_variant", {
      mode: "update",
      product_id: "P123",
      variant_id: "V9",
      price: 350,
      barcode: "BC1",
      image_url: "https://cdn.example.com/v.png",
    });
    expect(res.isError).toBeFalsy();
    const call = api.lastCall()!;
    expect(call.method).toBe("PATCH");
    expect(call.url.pathname).toBe("/myshop/v1/products/P123/variant");
    expect(call.body).toEqual({ id: "V9", price: 350, barcode: "BC1", imageUrl: "https://cdn.example.com/v.png" });
    expect(res.structuredContent!.variant_id).toBe("V9");
  });

  it("update without variant_id → business-rule fail (no network)", async () => {
    const res = await mcp.callTool("line_manage_product_variant", { mode: "update", product_id: "P1" });
    expect(res.isError).toBe(true);
    expect(firstText(res)).toContain("ต้องระบุ variant_id");
    expect(api.calls).toHaveLength(0);
  });

  it("delete_option POSTs /delete-variant-option with name+value", async () => {
    api.on("/delete-variant-option", { body: {} });
    const res = await mcp.callTool("line_manage_product_variant", {
      mode: "delete_option",
      product_id: "P123",
      option_name: "size",
      option_value: "XL",
    });
    expect(res.isError).toBeFalsy();
    const call = api.lastCall()!;
    expect(call.method).toBe("POST");
    expect(call.url.pathname).toBe("/myshop/v1/products/P123/delete-variant-option");
    expect(call.body).toEqual({ name: "size", value: "XL" });
    expect(firstText(res)).toContain("ลบตัวเลือก");
  });

  it("delete_option missing name/value → business-rule fail (no network)", async () => {
    const res = await mcp.callTool("line_manage_product_variant", { mode: "delete_option", product_id: "P1" });
    expect(res.isError).toBe(true);
    expect(firstText(res)).toContain("option_name");
    expect(api.calls).toHaveLength(0);
  });

  it("rejects an invalid mode with zero network calls", async () => {
    const res = await mcp.callTool("line_manage_product_variant", { mode: "bogus", product_id: "P1" });
    expect(res.isError).toBe(true);
    expect(firstText(res)).toContain("Input validation error");
    expect(api.calls).toHaveLength(0);
  });

  it("404 (create) surfaces the Thai MyShop not-found message", async () => {
    api.on("/myshop/v1/products/P1/variants", { status: 404, body: { code: "NOT_FOUND", message: "no product" } });
    const res = await mcp.callTool("line_manage_product_variant", { mode: "create", product_id: "P1", price: 10 });
    expect(res.isError).toBe(true);
    expect(firstText(res)).toContain(TH.myShopNotFound);
  });
});

// ============================================================================
// line_manage_inventory  — PUT /myshop/v1/inventory/{id}/{adjust|increase|decrease}
// ============================================================================
describe("line_manage_inventory", () => {
  beforeEach(async () => {
    await boot(myShopEnv);
  });

  const invBody = { availableNumber: 100, onHandAmount: 100, readyToShipAmount: 0, reservedAmount: 0 };

  it("set → PUT /adjust with { amount }", async () => {
    api.on("/myshop/v1/inventory/V9/adjust", { body: invBody });
    const res = await mcp.callTool("line_manage_inventory", { id: "V9", mode: "set", amount: 100 });
    expect(res.isError).toBeFalsy();
    const call = api.lastCall()!;
    expect(call.method).toBe("PUT");
    expect(call.url.pathname).toBe("/myshop/v1/inventory/V9/adjust");
    expect(call.body).toEqual({ amount: 100 });
    expect(firstText(res)).toContain("ตั้งเป็น 100");
    expect(res.structuredContent!.availableNumber).toBe(100);
  });

  it("increase → PUT /increase", async () => {
    api.on("/myshop/v1/inventory/V9/increase", { body: invBody });
    const res = await mcp.callTool("line_manage_inventory", { id: "V9", mode: "increase", amount: 50 });
    expect(res.isError).toBeFalsy();
    expect(api.lastCall()!.url.pathname).toBe("/myshop/v1/inventory/V9/increase");
    expect(firstText(res)).toContain("เพิ่ม 50");
  });

  it("decrease → PUT /decrease", async () => {
    api.on("/myshop/v1/inventory/V9/decrease", { body: invBody });
    const res = await mcp.callTool("line_manage_inventory", { id: "V9", mode: "decrease", amount: 10 });
    expect(res.isError).toBeFalsy();
    expect(api.lastCall()!.url.pathname).toBe("/myshop/v1/inventory/V9/decrease");
    expect(firstText(res)).toContain("ลด 10");
  });

  it("rejects amount below 1 with zero network calls", async () => {
    const res = await mcp.callTool("line_manage_inventory", { id: "V9", mode: "set", amount: 0 });
    expect(res.isError).toBe(true);
    expect(firstText(res)).toContain("Input validation error");
    expect(api.calls).toHaveLength(0);
  });

  it("429 surfaces the Thai MyShop rate-limit message", async () => {
    api.on("/myshop/v1/inventory/V9/adjust", { status: 429, body: { code: "RATE_LIMITED", message: "slow" } });
    const res = await mcp.callTool("line_manage_inventory", { id: "V9", mode: "set", amount: 5 });
    expect(res.isError).toBe(true);
    expect(firstText(res)).toContain(TH.myShopRateLimited);
  });
});

// ============================================================================
// line_list_orders  — GET /myshop/v1/orders
// ============================================================================
describe("line_list_orders", () => {
  beforeEach(async () => {
    await boot(myShopEnv);
  });

  it("GETs /myshop/v1/orders and renders markdown", async () => {
    api.on("/myshop/v1/orders", {
      body: {
        currentPage: 1,
        data: [{ orderNo: "100023", orderStatus: "COMPLETED", paymentStatus: "PAID" }],
        perPage: 25,
        totalPage: 1,
        totalRow: 1,
      },
    });
    const res = await mcp.callTool("line_list_orders", {});
    expect(res.isError).toBeFalsy();
    const call = api.lastCall()!;
    expect(call.method).toBe("GET");
    expect(call.url.pathname).toBe("/myshop/v1/orders");
    expect(firstText(res)).toContain("🧾 ออเดอร์");
    expect(firstText(res)).toContain("100023");
  });

  it("maps every filter into the query string", async () => {
    api.on("/myshop/v1/orders", { body: { currentPage: 1, data: [], perPage: 10, totalPage: 0, totalRow: 0 } });
    await mcp.callTool("line_list_orders", {
      search: "สมชาย",
      order_status: ["COMPLETED", "CANCELED"],
      payment_status: ["PAID"],
      payment_method: "COD",
      shipment_status: "SHIPPED_ALL",
      start_at: "2026-06-01T00:00:00+07:00",
      end_at: "2026-06-30T23:59:59+07:00",
      sort_by: "UPDATED_AT",
      order_by: "ASC",
      page: 2,
      per_page: 10,
    });
    const sp = api.lastCall()!.url.searchParams;
    expect(sp.get("search")).toBe("สมชาย");
    expect(sp.getAll("orderStatus")).toEqual(["COMPLETED", "CANCELED"]);
    expect(sp.getAll("paymentStatus")).toEqual(["PAID"]);
    expect(sp.get("paymentMethod")).toBe("COD");
    expect(sp.get("shipmentStatus")).toBe("SHIPPED_ALL");
    expect(sp.get("startAt")).toBe("2026-06-01T00:00:00+07:00");
    expect(sp.get("sortBy")).toBe("UPDATED_AT");
    expect(sp.get("orderBy")).toBe("ASC");
    expect(sp.get("page")).toBe("2");
    expect(sp.get("perPage")).toBe("10");
  });

  it("response_format=json returns serialized JSON text", async () => {
    api.on("/myshop/v1/orders", { body: { currentPage: 1, data: [], perPage: 25, totalPage: 0, totalRow: 0 } });
    const res = await mcp.callTool("line_list_orders", { response_format: "json" });
    expect(res.isError).toBeFalsy();
    expect(firstText(res)).toContain('"totalRow": 0');
  });

  it("rejects an invalid order_status enum with zero network calls", async () => {
    const res = await mcp.callTool("line_list_orders", { order_status: ["BOGUS"] });
    expect(res.isError).toBe(true);
    expect(firstText(res)).toContain("Input validation error");
    expect(api.calls).toHaveLength(0);
  });

  it("401 surfaces the Thai MyShop unauthorized message", async () => {
    api.on("/myshop/v1/orders", { status: 401, body: { code: "UNAUTHORIZED", message: "x" } });
    const res = await mcp.callTool("line_list_orders", {});
    expect(res.isError).toBe(true);
    expect(firstText(res)).toContain(TH.myShopUnauthorized);
  });
});

// ============================================================================
// line_get_order  — GET /myshop/v1/orders/{orderNo}
// ============================================================================
describe("line_get_order", () => {
  beforeEach(async () => {
    await boot(myShopEnv);
  });

  it("GETs the single order and returns it as JSON + structuredContent", async () => {
    api.on("/myshop/v1/orders/100023", { body: { orderNo: "100023", orderStatus: "COMPLETED", orderItems: [] } });
    const res = await mcp.callTool("line_get_order", { order_no: "100023" });
    expect(res.isError).toBeFalsy();
    const call = api.lastCall()!;
    expect(call.method).toBe("GET");
    expect(call.url.pathname).toBe("/myshop/v1/orders/100023");
    expect(res.structuredContent!.orderNo).toBe("100023");
    expect(firstText(res)).toContain('"orderStatus": "COMPLETED"');
  });

  it("rejects a missing order_no with zero network calls", async () => {
    const res = await mcp.callTool("line_get_order", {});
    expect(res.isError).toBe(true);
    expect(api.calls).toHaveLength(0);
  });

  it("404 surfaces the Thai MyShop not-found message", async () => {
    api.on("/myshop/v1/orders/999", { status: 404, body: { code: "NOT_FOUND", message: "no order" } });
    const res = await mcp.callTool("line_get_order", { order_no: "999" });
    expect(res.isError).toBe(true);
    expect(firstText(res)).toContain(TH.myShopNotFound);
  });
});

// ============================================================================
// line_fulfill_order  — ship / paid / update_tracking / parcel_label
// ============================================================================
describe("line_fulfill_order", () => {
  beforeEach(async () => {
    await boot(myShopEnv);
  });

  it("ship with tracking POSTs /mark-as-ship with { trackingNumber }", async () => {
    api.on("/mark-as-ship", { body: {} });
    const res = await mcp.callTool("line_fulfill_order", {
      mode: "ship",
      order_no: "100023",
      tracking_number: "TH123",
    });
    expect(res.isError).toBeFalsy();
    const call = api.lastCall()!;
    expect(call.method).toBe("POST");
    expect(call.url.pathname).toBe("/myshop/v1/orders/100023/mark-as-ship");
    expect(call.body).toEqual({ trackingNumber: "TH123" });
    expect(res.structuredContent!.tracking_number).toBe("TH123");
    expect(firstText(res)).toContain("🚚");
  });

  it("ship without tracking sends an empty body and structuredContent tracking null", async () => {
    api.on("/mark-as-ship", { body: {} });
    const res = await mcp.callTool("line_fulfill_order", { mode: "ship", order_no: "100023" });
    expect(res.isError).toBeFalsy();
    expect(api.lastCall()!.body).toEqual({});
    expect(res.structuredContent!.tracking_number).toBeNull();
  });

  it("paid POSTs /mark-as-paid", async () => {
    api.on("/mark-as-paid", { body: {} });
    const res = await mcp.callTool("line_fulfill_order", { mode: "paid", order_no: "100023" });
    expect(res.isError).toBeFalsy();
    expect(api.lastCall()!.url.pathname).toBe("/myshop/v1/orders/100023/mark-as-paid");
    expect(firstText(res)).toContain("จ่ายแล้ว");
  });

  it("update_tracking PUTs /shipments with the new tracking number", async () => {
    api.on("/shipments", { body: {} });
    const res = await mcp.callTool("line_fulfill_order", {
      mode: "update_tracking",
      order_no: "100023",
      tracking_number: "TH999",
    });
    expect(res.isError).toBeFalsy();
    const call = api.lastCall()!;
    expect(call.method).toBe("PUT");
    expect(call.url.pathname).toBe("/myshop/v1/orders/100023/shipments");
    expect(call.body).toEqual({ trackingNumber: "TH999" });
  });

  it("update_tracking without tracking_number → business-rule fail (no network)", async () => {
    const res = await mcp.callTool("line_fulfill_order", { mode: "update_tracking", order_no: "1" });
    expect(res.isError).toBe(true);
    expect(firstText(res)).toContain("ต้องระบุ tracking_number");
    expect(api.calls).toHaveLength(0);
  });

  it("parcel_label POSTs /parcel-label and returns the label", async () => {
    api.on("/parcel-label", { body: { labelUrl: "https://cdn.example.com/label.pdf" } });
    const res = await mcp.callTool("line_fulfill_order", { mode: "parcel_label", order_no: "100023" });
    expect(res.isError).toBeFalsy();
    expect(api.lastCall()!.url.pathname).toBe("/myshop/v1/orders/100023/parcel-label");
    expect(res.structuredContent!.label).toEqual({ labelUrl: "https://cdn.example.com/label.pdf" });
    expect(firstText(res)).toContain("🏷️");
  });

  it("rejects a missing order_no with zero network calls", async () => {
    const res = await mcp.callTool("line_fulfill_order", { mode: "ship" });
    expect(res.isError).toBe(true);
    expect(api.calls).toHaveLength(0);
  });

  it("404 (ship) surfaces the Thai MyShop not-found message", async () => {
    api.on("/mark-as-ship", { status: 404, body: { code: "NOT_FOUND", message: "no order" } });
    const res = await mcp.callTool("line_fulfill_order", { mode: "ship", order_no: "999" });
    expect(res.isError).toBe(true);
    expect(firstText(res)).toContain(TH.myShopNotFound);
  });
});

// ============================================================================
// line_cancel_order  — PUT /myshop/v1/orders/{orderNo}/cancel (confirm gate)
// ============================================================================
describe("line_cancel_order", () => {
  beforeEach(async () => {
    await boot(myShopEnv);
  });

  it("confirm=true PUTs /cancel", async () => {
    api.on("/cancel", { body: {} });
    const res = await mcp.callTool("line_cancel_order", { order_no: "100023", confirm: true });
    expect(res.isError).toBeFalsy();
    const call = api.lastCall()!;
    expect(call.method).toBe("PUT");
    expect(call.url.pathname).toBe("/myshop/v1/orders/100023/cancel");
    expect(res.structuredContent!.canceled_order).toBe("100023");
    expect(firstText(res)).toContain("🛑");
  });

  it("confirm omitted → confirm gate, zero network", async () => {
    const res = await mcp.callTool("line_cancel_order", { order_no: "100023" });
    expect(res.isError).toBe(true);
    expect(firstText(res)).toContain(TH.confirmRequired("ยกเลิกออเดอร์"));
    expect(api.calls).toHaveLength(0);
  });

  it("rejects a missing order_no with zero network calls", async () => {
    const res = await mcp.callTool("line_cancel_order", { confirm: true });
    expect(res.isError).toBe(true);
    expect(api.calls).toHaveLength(0);
  });

  it("404 surfaces the Thai MyShop not-found message", async () => {
    api.on("/cancel", { status: 404, body: { code: "NOT_FOUND", message: "no order" } });
    const res = await mcp.callTool("line_cancel_order", { order_no: "999", confirm: true });
    expect(res.isError).toBe(true);
    expect(firstText(res)).toContain(TH.myShopNotFound);
  });
});

// ============================================================================
// line_get_settlement  — GET /myshop/v1/settlements/{orderNo}
// ============================================================================
describe("line_get_settlement", () => {
  beforeEach(async () => {
    await boot(myShopEnv);
  });

  it("GETs the settlement and returns it as JSON + structuredContent", async () => {
    api.on("/myshop/v1/settlements/100023", {
      body: { orderNumber: "100023", orderIncomeDetail: { total: 299 }, settlementDetail: { net: 270 } },
    });
    const res = await mcp.callTool("line_get_settlement", { order_no: "100023" });
    expect(res.isError).toBeFalsy();
    const call = api.lastCall()!;
    expect(call.method).toBe("GET");
    expect(call.url.pathname).toBe("/myshop/v1/settlements/100023");
    expect(res.structuredContent!.orderNumber).toBe("100023");
    expect(firstText(res)).toContain('"net": 270');
  });

  it("rejects a missing order_no with zero network calls", async () => {
    const res = await mcp.callTool("line_get_settlement", {});
    expect(res.isError).toBe(true);
    expect(api.calls).toHaveLength(0);
  });

  it("403 surfaces the Thai MyShop forbidden message", async () => {
    api.on("/myshop/v1/settlements/1", { status: 403, body: { code: "FORBIDDEN", message: "x" } });
    const res = await mcp.callTool("line_get_settlement", { order_no: "1" });
    expect(res.isError).toBe(true);
    expect(firstText(res)).toContain(TH.myShopForbidden);
  });
});

// ============================================================================
// line_create_checkout_link  — POST /myshop/v1/checkout-link
// ============================================================================
describe("line_create_checkout_link", () => {
  beforeEach(async () => {
    await boot(myShopEnv);
  });

  it("POSTs { orderItems } (variant_id → variantId) and returns the link", async () => {
    api.on("/myshop/v1/checkout-link", { body: { checkoutLink: "https://shop.line.me/checkout/abc" } });
    const res = await mcp.callTool("line_create_checkout_link", { items: [{ variant_id: "V9", quantity: 2 }] });
    expect(res.isError).toBeFalsy();
    const call = api.lastCall()!;
    expect(call.method).toBe("POST");
    expect(call.url.pathname).toBe("/myshop/v1/checkout-link");
    expect(call.body).toEqual({ orderItems: [{ quantity: 2, variantId: "V9" }] });
    expect(res.structuredContent!.checkout_link).toBe("https://shop.line.me/checkout/abc");
    expect(firstText(res)).toContain("https://shop.line.me/checkout/abc");
  });

  it("maps product_id → productId and passes through extra keys", async () => {
    api.on("/myshop/v1/checkout-link", { body: { checkoutLink: "https://shop.line.me/checkout/xyz" } });
    await mcp.callTool("line_create_checkout_link", { items: [{ product_id: "P1", quantity: 1, note: "gift" }] });
    const body = api.lastCall()!.body as Record<string, unknown>;
    expect((body.orderItems as Record<string, unknown>[])[0]).toEqual({ quantity: 1, note: "gift", productId: "P1" });
  });

  it("rejects an empty items array with zero network calls", async () => {
    const res = await mcp.callTool("line_create_checkout_link", { items: [] });
    expect(res.isError).toBe(true);
    expect(firstText(res)).toContain("Input validation error");
    expect(api.calls).toHaveLength(0);
  });

  it("400 with a message surfaces the generic MyShop error text", async () => {
    api.on("/myshop/v1/checkout-link", { status: 400, body: { code: "OUT_OF_STOCK", message: "sold out" } });
    const res = await mcp.callTool("line_create_checkout_link", { items: [{ variant_id: "V9" }] });
    expect(res.isError).toBe(true);
    expect(firstText(res)).toContain("MyShop 400");
    expect(firstText(res)).toContain("sold out");
  });
});

// ============================================================================
// Resources + Prompts (registered regardless of MyShop key)
// ============================================================================
describe("MCP resources", () => {
  beforeEach(async () => {
    await boot(() => useSingleOaEnv("res-token"));
  });

  it("lists the 3 static resources", async () => {
    const { resources } = await mcp.client.listResources();
    const uris = resources.map((r) => r.uri);
    expect(uris).toContain("line://flex/templates");
    expect(uris).toContain("line://stickers/catalog");
    expect(uris).toContain("line://calendar/thai-holidays");
  });

  it("exposes the OA snapshot as a resource template", async () => {
    const { resourceTemplates } = await mcp.client.listResourceTemplates();
    expect(resourceTemplates.map((t) => t.uriTemplate)).toContain("line://oa/{oa_id}/snapshot");
  });

  it("reads the Flex template catalog", async () => {
    const res = await mcp.client.readResource({ uri: "line://flex/templates" });
    const text = (res.contents[0] as { text: string }).text;
    expect(res.contents[0]!.uri).toBe("line://flex/templates");
    const parsed = JSON.parse(text) as { templates: unknown };
    expect(parsed.templates).toBeDefined();
  });

  it("reads the sticker catalog (count + stickers)", async () => {
    const res = await mcp.client.readResource({ uri: "line://stickers/catalog" });
    const parsed = JSON.parse((res.contents[0] as { text: string }).text) as { count: number; stickers: unknown[] };
    expect(parsed.count).toBe(parsed.stickers.length);
    expect(parsed.count).toBeGreaterThan(0);
  });

  it("reads the Thai holiday calendar", async () => {
    const res = await mcp.client.readResource({ uri: "line://calendar/thai-holidays" });
    const parsed = JSON.parse((res.contents[0] as { text: string }).text) as { holidays: unknown };
    expect(parsed.holidays).toBeDefined();
  });

  it("reads the OA snapshot template (aggregates bot info + quota + webhook)", async () => {
    api.on("/v2/bot/message/quota/consumption", { body: { totalUsage: 0 } });
    api.on("/v2/bot/message/quota", { body: { type: "limited", value: 1000 } }, { method: "GET" });
    api.on("/v2/bot/info", { body: { userId: "U", displayName: "Shop", chatMode: "bot", markAsReadMode: "auto" } });
    api.on("/v2/bot/channel/webhook/endpoint", { body: { endpoint: "https://h", active: true } });

    const res = await mcp.client.readResource({ uri: "line://oa/default/snapshot" });
    const parsed = JSON.parse((res.contents[0] as { text: string }).text) as { oa_id: string; captured_at: string };
    expect(parsed.oa_id).toBe("default");
    expect(parsed.captured_at).toBeTruthy();
  });
});

describe("MCP prompts", () => {
  beforeEach(async () => {
    await boot(() => useSingleOaEnv("prompt-token"));
  });

  it("lists the 8 guided prompts", async () => {
    const { prompts } = await mcp.client.listPrompts();
    expect(prompts.length).toBe(8);
    const names = prompts.map((p) => p.name);
    expect(names).toContain("daily-oa-report");
    expect(names).toContain("design-rich-menu");
  });

  const cases: { name: string; args: Record<string, string>; expect: string }[] = [
    { name: "daily-oa-report", args: { range: "today", oa: "default" }, expect: "line_get_oa_status" },
    { name: "daily-oa-report", args: {}, expect: "last-week" },
    { name: "build-campaign", args: { occasion: "วันแม่", audience_hint: "VIP" }, expect: "วันแม่" },
    { name: "schedule-broadcast-howto", args: {}, expect: "LINE OA Manager UI" },
    { name: "diagnose-rich-menu", args: { user_id: "U1", oa: "default" }, expect: "U1" },
    { name: "coupon-campaign", args: { discount: "ลด 20%", valid_to: "2026-08-31", audience: "VIP" }, expect: "ลด 20%" },
    { name: "migrate-from-line-notify", args: {}, expect: "LINE Notify" },
    { name: "webhook-setup-guide", args: {}, expect: "X-Line-Signature" },
    { name: "design-rich-menu", args: { purpose: "ร้านกาแฟ", brand_primary: "#06C755", oa: "default" }, expect: "ร้านกาแฟ" },
  ];

  it.each(cases)("getPrompt %# ($name) renders its message", async ({ name, args, expect: needle }) => {
    const res = await mcp.client.getPrompt({ name, arguments: args });
    const text = (res.messages[0]!.content as { text: string }).text;
    expect(text).toContain(needle);
  });
});
