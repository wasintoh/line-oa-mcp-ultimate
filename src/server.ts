/**
 * MCP server factory.
 *
 * Builds an McpServer instance and registers every tool / resource / prompt.
 * Kept separate from the transport entry (`index.ts`) so tests and future
 * Streamable HTTP transport can share the same server graph.
 *
 * Scope: token-only LINE Messaging API tools that an AI agent (Cowork, Claude
 * Code, Codex, OpenClaw, Hermes, etc.) actually calls. Real-time / backend /
 * codegen primitives (loading animation, account-link token, LIFF/Login code
 * snippets) were intentionally excluded — they don't fit an AI-agent workflow.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { SERVER_NAME, SERVER_VERSION } from "./constants.js";
import { registerResources } from "./resources/register.js";
import { registerPrompts } from "./prompts/register.js";

// Tools — alphabetically ordered for sanity.
import { registerAuditUserMenuTool } from "./tools/audit-user-menu.js";
import { registerBuildAudienceFromCsvTool } from "./tools/build-audience-from-csv.js";
import { registerBuildAudienceFromEngagementTool } from "./tools/build-audience-from-engagement.js";
import { registerBuildRichMenuTool } from "./tools/build-rich-menu.js";
import { registerDeleteAudienceTool } from "./tools/delete-audience.js";
import { registerDeleteRichMenuTool } from "./tools/delete-rich-menu.js";
import { registerDesignFlexTool } from "./tools/design-flex.js";
import { registerEstimateSendCostTool } from "./tools/estimate-send-cost.js";
import { registerFindStickerTool } from "./tools/find-sticker.js";
import { registerGetCouponStatsTool } from "./tools/get-coupon-stats.js";
import { registerGetMessageStatsTool } from "./tools/get-message-stats.js";
import { registerGetOaReportTool } from "./tools/get-oa-report.js";
import { registerGetOaStatusTool } from "./tools/get-oa-status.js";
import { registerGetUserProfileTool } from "./tools/get-user-profile.js";
import { registerListAudiencesTool } from "./tools/list-audiences.js";
import { registerListFollowersTool } from "./tools/list-followers.js";
import { registerListOasTool } from "./tools/list-oas.js";
import { registerListRichMenusTool } from "./tools/list-rich-menus.js";
import { registerManageCouponTool } from "./tools/manage-coupon.js";
import { registerManageLiffAppTool } from "./tools/manage-liff-app.js";
import { registerRunOnManyOasTool } from "./tools/run-on-many-oas.js";
import { registerSendMessageTool } from "./tools/send-message.js";
import { registerTestWebhookTool } from "./tools/test-webhook.js";
import { registerUseOaTool } from "./tools/use-oa.js";

// v1.1 — API completeness tools (token-only, no webhook)
import { registerLinkRichMenuTool } from "./tools/link-rich-menu.js";
import { registerSetDefaultRichMenuTool } from "./tools/set-default-rich-menu.js";
import { registerManageRichMenuAliasTool } from "./tools/manage-rich-menu-alias.js";
import { registerUploadRichMenuImageTool } from "./tools/upload-rich-menu-image.js";
import { registerDesignImagemapTool } from "./tools/design-imagemap.js";
import { registerDesignCardTool } from "./tools/design-card.js";
import { registerUpdateAudienceTool } from "./tools/update-audience.js";
import { registerSetWebhookEndpointTool } from "./tools/set-webhook-endpoint.js";
import { registerGetNarrowcastProgressTool } from "./tools/get-narrowcast-progress.js";
import { registerCheckTokenTool } from "./tools/check-token.js";

// v2.0 — LINE Shopping (MyShop Open API). Registered ONLY when a MyShop key is
// configured (graceful degradation: messaging-only users never see these tools).
import { anyMyShopKeyConfigured } from "./config/multi-oa.js";
import { registerListProductsTool } from "./tools/list-products.js";
import { registerCreateProductTool } from "./tools/create-product.js";
import { registerUpdateProductTool } from "./tools/update-product.js";
import { registerDeleteProductTool } from "./tools/delete-product.js";
import { registerUpdateProductPriceTool } from "./tools/update-product-price.js";
import { registerSetProductVisibilityTool } from "./tools/set-product-visibility.js";
import { registerManageProductVariantTool } from "./tools/manage-product-variant.js";
import { registerManageInventoryTool } from "./tools/manage-inventory.js";
import { registerListOrdersTool } from "./tools/list-orders.js";
import { registerGetOrderTool } from "./tools/get-order.js";
import { registerFulfillOrderTool } from "./tools/fulfill-order.js";
import { registerCancelOrderTool } from "./tools/cancel-order.js";
import { registerGetSettlementTool } from "./tools/get-settlement.js";
import { registerCreateCheckoutLinkTool } from "./tools/create-checkout-link.js";

export function buildServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  // ---- Tools (34 total) ----

  // A. Messaging
  registerSendMessageTool(server);
  registerFindStickerTool(server);

  // B. Rich Menu
  registerBuildRichMenuTool(server);
  registerListRichMenusTool(server);
  registerDeleteRichMenuTool(server);
  registerAuditUserMenuTool(server);
  registerLinkRichMenuTool(server);
  registerSetDefaultRichMenuTool(server);
  registerManageRichMenuAliasTool(server);
  registerUploadRichMenuImageTool(server);

  // C. Message design (Flex / Rich Message / Card Message)
  registerDesignFlexTool(server);
  registerDesignImagemapTool(server);
  registerDesignCardTool(server);

  // D. Audiences
  registerBuildAudienceFromCsvTool(server);
  registerBuildAudienceFromEngagementTool(server);
  registerListAudiencesTool(server);
  registerDeleteAudienceTool(server);
  registerUpdateAudienceTool(server);

  // E. Insights
  registerGetOaReportTool(server);
  registerGetMessageStatsTool(server);
  registerGetOaStatusTool(server);
  registerEstimateSendCostTool(server);
  registerGetNarrowcastProgressTool(server);

  // F. Webhook
  registerTestWebhookTool(server);
  registerSetWebhookEndpointTool(server);

  // G. LIFF / Token
  registerManageLiffAppTool(server);
  registerCheckTokenTool(server);

  // H. Ops / Multi-OA
  registerGetUserProfileTool(server);
  registerListFollowersTool(server);
  registerListOasTool(server);
  registerUseOaTool(server);
  registerRunOnManyOasTool(server);

  // I. Coupons
  registerManageCouponTool(server);
  registerGetCouponStatsTool(server);

  // J. LINE Shopping (v2.0 — MyShop Open API)
  // Gated: only registered when a MyShop API key is present (per-OA or env).
  // Messaging-only users see none of these and hit no config errors.
  if (anyMyShopKeyConfigured()) {
    // Products
    registerListProductsTool(server);
    registerCreateProductTool(server);
    registerUpdateProductTool(server);
    registerDeleteProductTool(server);
    registerUpdateProductPriceTool(server);
    registerSetProductVisibilityTool(server);
    registerManageProductVariantTool(server);
    // Inventory
    registerManageInventoryTool(server);
    // Orders
    registerListOrdersTool(server);
    registerGetOrderTool(server);
    registerFulfillOrderTool(server);
    registerCancelOrderTool(server);
    // Settlement + Checkout
    registerGetSettlementTool(server);
    registerCreateCheckoutLinkTool(server);
  }

  // ---- Resources + Prompts ----
  registerResources(server);
  registerPrompts(server);

  return server;
}
