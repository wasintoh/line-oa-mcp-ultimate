# Technical Spec — v2.0 Shopping (MyShop Open API)

> Implementation blueprint. Schema verified against live Swagger (Redoc 1.0.0) on 2026-06-03.

---

## 1. Architecture decision

**Separate client.** MyShop API differs from Messaging API on **both** base host and auth header, so we add a dedicated `MyShopClient` instead of overloading `LineClient`. It re-uses `LineClient`'s `request()` shape (timeout, query builder, safe-JSON) but with `X-API-KEY` auth and the MyShop error envelope.

```
LineClient      → https://api.line.me        + Authorization: Bearer <token>   (v1, untouched)
MyShopClient    → https://developers-oaplus.line.biz + X-API-KEY: <apiKey>      (v2, new)
```

No v1 file is modified except **additive** changes: `constants.ts` (+consts), `types.ts` (+`myshop_api_key`, +shopping types), `server.ts` (+register block), `i18n/th.ts` (+strings). Zero edits to existing tools.

## 2. Config change (additive, optional)

`types.ts` → `OaConfig`:
```ts
export interface OaConfig {
  channel_access_token: string;   // still required (v1)
  channel_secret?: string;
  display_name?: string;
  is_premium?: boolean;
  region?: "TH" | "JP" | "TW" | "ID" | "OTHER";
  myshop_api_key?: string;        // NEW — optional; enables v2 shopping tools
}
```

Resolution (new helper in `config/multi-oa.ts`):
```ts
export function resolveMyShopKey(oaIdArg?: string): { id: string; apiKey: string }
// order: oa.myshop_api_key → process.env.LINE_MYSHOP_API_KEY → throw TH.missingMyShopKey
export function anyMyShopKeyConfigured(): boolean
// true if env LINE_MYSHOP_API_KEY set OR any oa has myshop_api_key → gates registration
```

`_setConfig` validation stays as-is (myshop_api_key optional, no new required check).

## 3. MyShopClient (`src/line/myshop-client.ts`)

```ts
export class MyShopApiError extends Error {
  status: number; code?: string; info?: unknown; timestamp?: number; body: unknown;
}
export interface MyShopClientOptions { apiKey: string; apiBase?: string; userAgent?: string; }

export class MyShopClient {
  request<T>(method, path, { body?, query? }): Promise<T>
  // headers: { "X-API-KEY": apiKey, Accept: json, "User-Agent": SERVER_NAME/version, [Content-Type if body] }
  // 30s AbortController timeout (same as LineClient)
  // on !ok → parse {code,message,info,timestamp} → throw MyShopApiError (status, code, message)
  // 429 → MyShopApiError with TH.myShopRateLimited

  // Products
  listProducts(q): Promise<ProductListResponse>
  createProduct(body): Promise<{id;hasOnlyDefaultVariant;isDisplay}>
  updateProduct(id, body): Promise<unknown>
  deleteProduct(id): Promise<void>                       // 204
  updateProductPrice(id, body): Promise<unknown>          // {price,instantDiscount}
  setProductDisplayStatus(id, "onsale"|"hide"): Promise<unknown>
  createVariant(id, body): Promise<unknown>
  updateVariant(id, body): Promise<unknown>               // PATCH /products/{id}/variant
  deleteVariantOption(id, {name,value}): Promise<unknown> // POST /products/{id}/delete-variant-option

  // Inventory
  adjustInventory(id, amount): Promise<InventoryResult>   // PUT .../adjust  (absolute)
  increaseInventory(id, amount): Promise<InventoryResult>
  decreaseInventory(id, amount): Promise<InventoryResult>

  // Orders
  listOrders(q): Promise<OrderListResponse>
  getOrder(orderNo): Promise<OrderDetail>
  cancelOrder(orderNo): Promise<unknown>                  // PUT .../cancel
  markOrderAsShip(orderNo, trackingNumber?): Promise<unknown>
  markOrderAsPaid(orderNo): Promise<unknown>              // COD
  updateShipment(orderNo, trackingNumber): Promise<unknown> // PUT .../shipments
  getParcelLabel(orderNo): Promise<unknown>               // POST .../parcel-label

  // Settlement + Checkout
  getSettlement(orderNo): Promise<SettlementDetail>
  createCheckoutLink(orderItems): Promise<{checkoutLink:string}>
}
```

### Endpoint reference (verified)

| Method | Path | Key params/body |
|---|---|---|
| GET | /myshop/v1/products | `ids[]`,`skus[]`,`page`(1),`perPage`(1–100,def 25) → `{currentPage,data,perPage,totalPage,totalRow}` |
| POST | /myshop/v1/products | `{brand,categoryId,code,description(HTML),imageUrls[],instantDiscount,name,variantOptions,variants[{price,weight,sku,onHandNumber}]}` → `{id,hasOnlyDefaultVariant,isDisplay(def false)}` |
| PATCH | /myshop/v1/products/{id} | product detail fields |
| PATCH | /myshop/v1/products/{id}/prices | `{price,instantDiscount}` (blocked during active promo) |
| POST | /myshop/v1/products/{id}/display-status/{status} | status = `onsale`\|`hide` |
| DELETE | /myshop/v1/products/{id} | → 204 |
| POST | /myshop/v1/products/{id}/variants | variant create |
| PATCH | /myshop/v1/products/{id}/variant | `{barcode,id,imageUrl,onHandNumber,price,sku,weight}` |
| POST | /myshop/v1/products/{id}/delete-variant-option | `{name,value}` |
| PUT | /myshop/v1/inventory/{id}/adjust\|increase\|decrease | `{amount}` 1–100,000 → `{availableNumber,onHandAmount,readyToShipAmount,reservedAmount}` |
| GET | /myshop/v1/orders | `search,page,perPage,sortBy(ORDER_NO\|CREATED_AT\|UPDATED_AT\|CHECKED_OUT_AT),orderBy(DESC\|ASC),orderStatus[](FINALIZED\|COMPLETED\|EXPIRED\|CANCELED),paymentStatus[](NO_PAYMENT\|PENDING\|PAID\|REFUND\|...),paymentMethod,shipmentStatus,startAt,endAt(ISO)` |
| GET | /myshop/v1/orders/{orderNo} | order detail incl. orderItems[] |
| PUT | /myshop/v1/orders/{orderNo}/cancel | cancel |
| POST | /myshop/v1/orders/{orderNo}/mark-as-ship | `{trackingNumber}` ≤50 → auto LINE msg to buyer |
| POST | /myshop/v1/orders/{orderNo}/mark-as-paid | COD; after mark-as-ship → COMPLETED |
| PUT | /myshop/v1/orders/{orderNo}/shipments | `{trackingNumber}` |
| POST | /myshop/v1/orders/{orderNo}/parcel-label | print parcel label |
| GET | /myshop/v1/settlements/{orderNo} | orderNo int → `{orderIncomeDetail,orderNumber,settlementDetail}` |
| POST | /myshop/v1/checkout-link | `{orderItems[]}` 1–15 → `{checkoutLink}` |

## 4. Tool → mode mapping (13 tools)

- `line_list_products` — read; params: ids[], skus[], page, per_page, response_format
- `line_create_product` — write; name, price (→default variant), description, image_urls[], category_id, variants[], etc.
- `line_update_product` — write; id + patch fields
- `line_delete_product` — destructive; id + confirm=true
- `line_update_product_price` — write; id, price, instant_discount?
- `line_set_product_visibility` — write; id, status(onsale|hide)
- `line_manage_product_variant` — write; mode(create|update|delete_option), id, variant fields
- `line_manage_inventory` — write; id, mode(set|increase|decrease), amount(1–100000)
- `line_list_orders` — read; search, status filters, start_at/end_at, page, per_page (← polling)
- `line_get_order` — read; order_no
- `line_fulfill_order` — write; order_no, mode(ship|paid|update_tracking|parcel_label), tracking_number?
- `line_cancel_order` — destructive; order_no, confirm=true
- `line_get_settlement` — read; order_no
- `line_create_checkout_link` — write; items[](1–15)

> 14 register fns total but Products variant-CRUD folded → exactly 13 user-facing tools per PRD.

## 5. Graceful degradation (KEY requirement)

In `server.ts`:
```ts
import { anyMyShopKeyConfigured } from "./config/multi-oa.js";
// ... after v1 tools ...
if (anyMyShopKeyConfigured()) {
  // J. LINE Shopping (v2) — registered ONLY when a MyShop key exists
  registerListProductsTool(server); /* ...all 13... */
}
```
Result: messaging-only users **never see** shopping tools, never hit a config error. Per-call, each tool calls `resolveMyShopKey(params.oa)` → friendly Thai error if the active OA lacks a key but env/another OA has one.

## 6. Constants to add (`constants.ts`)

```ts
export const MYSHOP_API_BASE = "https://developers-oaplus.line.biz";
export const MYSHOP_DEFAULT_PER_PAGE = 25;
export const MYSHOP_MAX_PER_PAGE = 100;
export const MYSHOP_INVENTORY_MAX = 100_000;
export const MYSHOP_CHECKOUT_MAX_ITEMS = 15;
export const MYSHOP_TRACKING_MAX_LEN = 50;
export const MYSHOP_RATE_LIMIT = { per_sec: 50, per_min: 1000 } as const;
```

## 7. i18n strings to add (`i18n/th.ts`)

`missingMyShopKey`, `myShopRateLimited`, `myShopUnauthorized`, `myShopForbidden`, `myShopNotFound`, `confirmRequired(action)`.

## 8. File structure (new)

```
src/
  line/myshop-client.ts            # NEW
  tools/
    list-products.ts               # NEW (13 files)
    create-product.ts
    update-product.ts
    delete-product.ts
    update-product-price.ts
    set-product-visibility.ts
    manage-product-variant.ts
    manage-inventory.ts
    list-orders.ts
    get-order.ts
    fulfill-order.ts
    cancel-order.ts
    get-settlement.ts
    create-checkout-link.ts
tests/
  myshop-client.test.ts            # NEW
  shopping-tools.test.ts           # NEW
docs/v2-shopping/                  # PRD + this spec
```

## 9. Test plan

- **MyShopClient**: builds `X-API-KEY` header (not Bearer); hits MyShop base; maps `{code,message}` → MyShopApiError; 429 → rate-limit msg; 204 → no-body ok. (mock global fetch)
- **resolveMyShopKey / anyMyShopKeyConfigured**: env vs per-oa precedence; throws when absent.
- **Tool validation**: zod rejects bad input; `confirm` gates on delete/cancel; inventory amount bounds; checkout items 1–15.
- **Graceful**: no key → registration count unchanged (still 34); with key → 47.

## 10. Conventions (match v1)

- Tool name `line_{action}_{resource}` snake_case; descriptions English + Thai examples.
- Handler: `params = Schema.parse(raw)` → `resolveMyShopKey` → `new MyShopClient({apiKey})` → call → `{content:[{type:"text",...}], structuredContent}`.
- Errors: `MyShopApiError` → surface `code + message`; else `TH.unknownError`.
- Destructive (`delete`, `cancel`) require `confirm: true`, `annotations.destructiveHint: true`.
- Reads support `response_format: markdown|json`.
