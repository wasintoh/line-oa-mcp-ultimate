/**
 * MCP server factory.
 *
 * Builds an McpServer instance and registers every tool / resource / prompt.
 * Kept separate from the transport entry (`index.ts`) so tests and future
 * Streamable HTTP transport can share the same server graph.
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
import { registerEmitLiffCodeTool } from "./tools/emit-liff-code.js";
import { registerEmitLoginSnippetTool } from "./tools/emit-login-snippet.js";
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
import { registerShowTypingTool } from "./tools/show-typing.js";
import { registerTestWebhookTool } from "./tools/test-webhook.js";
import { registerUseOaTool } from "./tools/use-oa.js";

export function buildServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  // ---- Tools (27 total) ----

  // A. Messaging
  registerSendMessageTool(server);
  registerShowTypingTool(server);
  registerFindStickerTool(server);

  // B. Rich Menu
  registerBuildRichMenuTool(server);
  registerListRichMenusTool(server);
  registerDeleteRichMenuTool(server);
  registerAuditUserMenuTool(server);

  // C. Flex
  registerDesignFlexTool(server);

  // D. Audiences
  registerBuildAudienceFromCsvTool(server);
  registerBuildAudienceFromEngagementTool(server);
  registerListAudiencesTool(server);
  registerDeleteAudienceTool(server);

  // E. Insights
  registerGetOaReportTool(server);
  registerGetMessageStatsTool(server);
  registerGetOaStatusTool(server);
  registerEstimateSendCostTool(server);

  // F. Webhook
  registerTestWebhookTool(server);

  // G. LIFF / Login
  registerManageLiffAppTool(server);
  registerEmitLiffCodeTool(server);
  registerEmitLoginSnippetTool(server);

  // H. Ops
  registerGetUserProfileTool(server);
  registerListFollowersTool(server);
  registerListOasTool(server);
  registerUseOaTool(server);
  registerRunOnManyOasTool(server);

  // I. Coupons
  registerManageCouponTool(server);
  registerGetCouponStatsTool(server);

  // ---- Resources + Prompts ----
  registerResources(server);
  registerPrompts(server);

  return server;
}
