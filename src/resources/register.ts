/**
 * Register MCP resources.
 *
 * V1 exposes 4 read-only resources:
 *   - line://oa/{id}/snapshot          — auto-refreshing OA status JSON
 *   - line://flex/templates            — Flex template catalog
 *   - line://stickers/catalog          — bundled sticker catalog
 *   - line://calendar/thai-holidays    — Thai festival calendar with promo patterns
 *
 * Each resource returns JSON-as-text; clients that want structured data should
 * parse the body. URI templating is used for the snapshot resource.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";

import { resolveOa } from "../config/multi-oa.js";
import { LineClient } from "../line/client.js";
import { snapshotQuota } from "../line/quota-guardian.js";
import { FLEX_TEMPLATE_CATALOG } from "../line/flex-templates.js";
import { STICKER_CATALOG } from "./sticker-catalog.js";
import { THAI_HOLIDAYS_2026 } from "./thai-holidays.js";

export function registerResources(server: McpServer): void {
  // ---- line://oa/{oa_id}/snapshot ----
  server.registerResource(
    "oa-snapshot",
    new ResourceTemplate("line://oa/{oa_id}/snapshot", {
      list: undefined,
    }),
    {
      title: "LINE OA Snapshot",
      description: "Auto-refreshing OA status (bot info + quota + webhook).",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const oaId = String(variables.oa_id);
      const { config } = resolveOa(oaId);
      const client = new LineClient({ channelAccessToken: config.channel_access_token });
      const [botInfo, quota, webhook] = await Promise.allSettled([
        client.getBotInfo(),
        snapshotQuota(client),
        client.getWebhookEndpoint(),
      ]);
      const body = {
        oa_id: oaId,
        bot_info: botInfo.status === "fulfilled" ? botInfo.value : null,
        quota: quota.status === "fulfilled" ? quota.value : null,
        webhook: webhook.status === "fulfilled" ? webhook.value : null,
        captured_at: new Date().toISOString(),
      };
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(body, null, 2),
          },
        ],
      };
    },
  );

  // ---- line://flex/templates ----
  server.registerResource(
    "flex-templates",
    "line://flex/templates",
    {
      title: "Flex Template Catalog",
      description: "Thai-localized Flex Message templates with required fields.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify({ templates: FLEX_TEMPLATE_CATALOG }, null, 2),
        },
      ],
    }),
  );

  // ---- line://stickers/catalog ----
  server.registerResource(
    "stickers-catalog",
    "line://stickers/catalog",
    {
      title: "LINE Sticker Catalog",
      description: "Bundled curated catalog of bot-safe LINE stickers with mood/keyword tags.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify({ count: STICKER_CATALOG.length, stickers: STICKER_CATALOG }, null, 2),
        },
      ],
    }),
  );

  // ---- line://calendar/thai-holidays ----
  server.registerResource(
    "thai-holidays",
    "line://calendar/thai-holidays",
    {
      title: "Thai Holiday Calendar",
      description: "Thai public, royal, Buddhist, and cultural holidays with marketing promo patterns.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify({ holidays: THAI_HOLIDAYS_2026 }, null, 2),
        },
      ],
    }),
  );
}
