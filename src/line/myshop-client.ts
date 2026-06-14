/**
 * MyShop Open API client (LINE Shopping).
 *
 * Deliberately separate from `LineClient`: the MyShop API differs from the
 * Messaging API on BOTH axes —
 *   - base host:  https://developers-oaplus.line.biz   (not api.line.me)
 *   - auth:       X-API-KEY header                       (not Bearer token)
 *   - errors:     { code, message, info?, timestamp }    (not { message, details[] })
 *
 * We mirror LineClient's thin `request()` design (direct fetch, 30s timeout,
 * query builder, safe-JSON) so the two clients feel the same to tool authors.
 *
 * Schema verified against the live Swagger (Redoc 1.0.0) on 2026-06-03.
 */

import { MYSHOP_API_BASE, SERVER_NAME, SERVER_VERSION } from "../constants.js";
import { TH } from "../i18n/th.js";
import type {
  CheckoutLinkItem,
  MyShopCheckoutResult,
  MyShopCreateProductResult,
  MyShopInventoryResult,
  MyShopOrder,
  MyShopOrderList,
  MyShopProductList,
  MyShopSettlement,
} from "../types.js";

export interface MyShopClientOptions {
  apiKey: string;
  /** Base URL override (used by tests). */
  apiBase?: string;
  /** User-Agent header — LINE recommends identifying your service for faster support triage. */
  userAgent?: string;
}

interface MyShopErrorShape {
  code?: string;
  message?: string;
  info?: unknown;
  timestamp?: number;
}

export class MyShopApiError extends Error {
  public readonly status: number;
  public readonly code?: string;
  public readonly info?: unknown;
  public readonly timestamp?: number;
  public readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(formatMessage(status, body));
    this.status = status;
    const b = body as MyShopErrorShape | undefined;
    this.code = b?.code;
    this.info = b?.info;
    this.timestamp = b?.timestamp;
    this.body = body;
    this.name = "MyShopApiError";
  }
}

function formatMessage(status: number, body: unknown): string {
  if (status === 401) return TH.myShopUnauthorized;
  if (status === 403) return TH.myShopForbidden;
  if (status === 404) return TH.myShopNotFound;
  if (status === 429) return TH.myShopRateLimited;
  const b = body as MyShopErrorShape | undefined;
  if (b?.message) {
    return `MyShop ${status}${b.code ? ` [${b.code}]` : ""}: ${b.message}`;
  }
  return `MyShop ${status}`;
}

type QueryValue = string | number | boolean | string[] | number[] | undefined;
export type MyShopQuery = Record<string, QueryValue>;

export class MyShopClient {
  private readonly apiKey: string;
  private readonly apiBase: string;
  private readonly userAgent: string;

  constructor(opts: MyShopClientOptions) {
    this.apiKey = opts.apiKey;
    this.apiBase = opts.apiBase ?? MYSHOP_API_BASE;
    this.userAgent = opts.userAgent ?? `${SERVER_NAME}/${SERVER_VERSION}`;
  }

  // ---- low-level request ----

  async request<T>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    options: { body?: unknown; query?: MyShopQuery } = {},
  ): Promise<T> {
    const url = new URL(`${this.apiBase}${path}`);
    if (options.query) {
      for (const [k, v] of Object.entries(options.query)) {
        if (v === undefined) continue;
        if (Array.isArray(v)) {
          for (const item of v) url.searchParams.append(k, String(item));
        } else {
          url.searchParams.set(k, String(v));
        }
      }
    }

    const headers: Record<string, string> = {
      "X-API-KEY": this.apiKey,
      Accept: "application/json",
      "User-Agent": this.userAgent,
    };
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new MyShopApiError(0, { message: `Network error: ${msg}` });
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    const parsed = text ? safeJson(text) : undefined;
    if (!response.ok) {
      throw new MyShopApiError(response.status, parsed ?? {});
    }
    // Empty body (e.g. 204 from DELETE) resolves to undefined, not {} —
    // so void methods (delete/cancel/mark-*) resolve cleanly.
    return parsed as T;
  }

  // ---- Products ----

  listProducts(query: MyShopQuery = {}): Promise<MyShopProductList> {
    return this.request("GET", "/myshop/v1/products", { query });
  }

  createProduct(body: Record<string, unknown>): Promise<MyShopCreateProductResult> {
    return this.request("POST", "/myshop/v1/products", { body });
  }

  updateProduct(id: string, body: Record<string, unknown>): Promise<unknown> {
    return this.request("PATCH", `/myshop/v1/products/${encodeURIComponent(id)}`, { body });
  }

  deleteProduct(id: string): Promise<void> {
    return this.request("DELETE", `/myshop/v1/products/${encodeURIComponent(id)}`);
  }

  updateProductPrice(id: string, body: Record<string, unknown>): Promise<unknown> {
    return this.request("PATCH", `/myshop/v1/products/${encodeURIComponent(id)}/prices`, { body });
  }

  setProductDisplayStatus(id: string, status: "onsale" | "hide"): Promise<unknown> {
    return this.request(
      "POST",
      `/myshop/v1/products/${encodeURIComponent(id)}/display-status/${status}`,
    );
  }

  createVariant(id: string, body: Record<string, unknown>): Promise<unknown> {
    return this.request("POST", `/myshop/v1/products/${encodeURIComponent(id)}/variants`, { body });
  }

  updateVariant(id: string, body: Record<string, unknown>): Promise<unknown> {
    return this.request("PATCH", `/myshop/v1/products/${encodeURIComponent(id)}/variant`, { body });
  }

  deleteVariantOption(id: string, body: { name: string; value: string }): Promise<unknown> {
    return this.request(
      "POST",
      `/myshop/v1/products/${encodeURIComponent(id)}/delete-variant-option`,
      { body },
    );
  }

  // ---- Inventory (amount 1..100,000) ----

  adjustInventory(id: string, amount: number): Promise<MyShopInventoryResult> {
    return this.request("PUT", `/myshop/v1/inventory/${encodeURIComponent(id)}/adjust`, {
      body: { amount },
    });
  }

  increaseInventory(id: string, amount: number): Promise<MyShopInventoryResult> {
    return this.request("PUT", `/myshop/v1/inventory/${encodeURIComponent(id)}/increase`, {
      body: { amount },
    });
  }

  decreaseInventory(id: string, amount: number): Promise<MyShopInventoryResult> {
    return this.request("PUT", `/myshop/v1/inventory/${encodeURIComponent(id)}/decrease`, {
      body: { amount },
    });
  }

  // ---- Orders ----

  listOrders(query: MyShopQuery = {}): Promise<MyShopOrderList> {
    return this.request("GET", "/myshop/v1/orders", { query });
  }

  getOrder(orderNo: string): Promise<MyShopOrder> {
    return this.request("GET", `/myshop/v1/orders/${encodeURIComponent(orderNo)}`);
  }

  cancelOrder(orderNo: string): Promise<unknown> {
    return this.request("PUT", `/myshop/v1/orders/${encodeURIComponent(orderNo)}/cancel`);
  }

  /** Mark as shipped. trackingNumber ≤ 50 chars. Triggers an automatic LINE message to the buyer. */
  markOrderAsShip(orderNo: string, trackingNumber?: string): Promise<unknown> {
    return this.request("POST", `/myshop/v1/orders/${encodeURIComponent(orderNo)}/mark-as-ship`, {
      body: trackingNumber ? { trackingNumber } : {},
    });
  }

  /** COD only. Must call mark-as-ship first; moves the order to COMPLETED. */
  markOrderAsPaid(orderNo: string): Promise<unknown> {
    return this.request("POST", `/myshop/v1/orders/${encodeURIComponent(orderNo)}/mark-as-paid`);
  }

  updateShipment(orderNo: string, trackingNumber: string): Promise<unknown> {
    return this.request("PUT", `/myshop/v1/orders/${encodeURIComponent(orderNo)}/shipments`, {
      body: { trackingNumber },
    });
  }

  getParcelLabel(orderNo: string): Promise<unknown> {
    return this.request("POST", `/myshop/v1/orders/${encodeURIComponent(orderNo)}/parcel-label`);
  }

  // ---- Settlement + Checkout ----

  getSettlement(orderNo: string): Promise<MyShopSettlement> {
    return this.request("GET", `/myshop/v1/settlements/${encodeURIComponent(orderNo)}`);
  }

  /** orderItems: 1..15 items → { checkoutLink }. */
  createCheckoutLink(orderItems: CheckoutLinkItem[]): Promise<MyShopCheckoutResult> {
    return this.request("POST", "/myshop/v1/checkout-link", { body: { orderItems } });
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}
