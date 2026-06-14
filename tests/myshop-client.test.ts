/**
 * Unit tests for MyShopClient (LINE Shopping / MyShop Open API).
 *
 * Verifies the things that distinguish it from the Messaging API client:
 *   - X-API-KEY auth header (NOT Bearer)
 *   - developers-oaplus.line.biz base host
 *   - {code,message,timestamp} error envelope → MyShopApiError
 *   - 429 → Thai rate-limit message; 204 → empty-body OK
 *   - array query params repeated; checkout posts orderItems
 * All network calls are mocked — no real requests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { MyShopClient, MyShopApiError } from "../src/line/myshop-client.js";

type FetchMock = ReturnType<typeof vi.fn>;
let fetchMock: FetchMock;

function mockResponse(status: number, body: unknown): void {
  fetchMock.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
  } as unknown as Response);
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("MyShopClient — auth + base host", () => {
  it("sends X-API-KEY (not Bearer) to the oaplus base host", async () => {
    mockResponse(200, { currentPage: 1, data: [], perPage: 25, totalPage: 0, totalRow: 0 });
    await new MyShopClient({ apiKey: "KEY123" }).listProducts();

    const [url, opts] = fetchMock.mock.calls[0] as [URL, RequestInit];
    const headers = opts.headers as Record<string, string>;
    expect(headers["X-API-KEY"]).toBe("KEY123");
    expect(headers["Authorization"]).toBeUndefined();
    expect(headers["User-Agent"]).toContain("line-oa-mcp-ultimate");
    expect(String(url)).toContain("https://developers-oaplus.line.biz/myshop/v1/products");
  });
});

describe("MyShopClient — error envelope", () => {
  it("maps {code,message} into MyShopApiError with status + code", async () => {
    mockResponse(400, { code: "BAD_REQUEST", message: "invalid", timestamp: 123 });
    await expect(new MyShopClient({ apiKey: "K" }).getOrder("1")).rejects.toMatchObject({
      status: 400,
      code: "BAD_REQUEST",
    });
  });

  it("surfaces the Thai rate-limit message on 429", async () => {
    mockResponse(429, { code: "INTERNAL_ERROR", message: "too many" });
    await expect(new MyShopClient({ apiKey: "K" }).listOrders()).rejects.toThrow(/🚦|429|วินาที/);
  });

  it("MyShopApiError is the thrown type", async () => {
    mockResponse(404, { code: "NOT_FOUND", message: "nope" });
    const err = await new MyShopClient({ apiKey: "K" }).getSettlement("9").catch((e) => e);
    expect(err).toBeInstanceOf(MyShopApiError);
  });
});

describe("MyShopClient — verbs + bodies", () => {
  it("204 (delete) resolves with no body", async () => {
    mockResponse(204, undefined);
    await expect(new MyShopClient({ apiKey: "K" }).deleteProduct("P1")).resolves.toBeUndefined();
  });

  it("repeats array query params (orderStatus)", async () => {
    mockResponse(200, { data: [] });
    await new MyShopClient({ apiKey: "K" }).listOrders({
      orderStatus: ["COMPLETED", "CANCELED"],
      page: 1,
    });
    const [url] = fetchMock.mock.calls[0] as [URL];
    const sp = new URL(String(url)).searchParams;
    expect(sp.getAll("orderStatus")).toEqual(["COMPLETED", "CANCELED"]);
    expect(sp.get("page")).toBe("1");
  });

  it("inventory adjust PUTs the amount in the body", async () => {
    mockResponse(200, {
      availableNumber: 100,
      onHandAmount: 100,
      readyToShipAmount: 0,
      reservedAmount: 0,
    });
    await new MyShopClient({ apiKey: "K" }).adjustInventory("V9", 100);
    const [url, opts] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(opts.method).toBe("PUT");
    expect(String(url)).toContain("/myshop/v1/inventory/V9/adjust");
    expect(JSON.parse(opts.body as string)).toEqual({ amount: 100 });
  });

  it("checkout link POSTs { orderItems } and returns the link", async () => {
    mockResponse(200, { checkoutLink: "https://shop.line.me/checkout/abc" });
    const res = await new MyShopClient({ apiKey: "K" }).createCheckoutLink([
      { variantId: "V9", quantity: 2 },
    ]);
    expect(res.checkoutLink).toContain("https://");
    const [, opts] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toEqual({
      orderItems: [{ variantId: "V9", quantity: 2 }],
    });
  });

  it("mark-as-ship sends trackingNumber when provided", async () => {
    mockResponse(200, {});
    await new MyShopClient({ apiKey: "K" }).markOrderAsShip("100023", "TH123");
    const [url, opts] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toContain("/myshop/v1/orders/100023/mark-as-ship");
    expect(JSON.parse(opts.body as string)).toEqual({ trackingNumber: "TH123" });
  });
});
