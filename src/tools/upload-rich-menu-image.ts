/**
 * Tool: line_upload_rich_menu_image
 *
 * Replace the image on an EXISTING rich menu without recreating it. Downloads
 * the image from a public HTTPS URL, validates format + size (same checks as
 * line_build_rich_menu), then uploads to the api-data.line.me content endpoint.
 *
 * Use this to refresh a rich menu's artwork (e.g. a seasonal promo banner)
 * while keeping the same richMenuId, tappable areas, and any per-user links.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveOa } from "../config/multi-oa.js";
import { LineApiError, LineClient } from "../line/client.js";
import { SsrfBlockedError, fetchPublicImage } from "../line/ssrf-guard.js";
import { RICH_MENU_IMAGE_MAX_BYTES } from "../constants.js";
import { TH } from "../i18n/th.js";

const InputSchema = z
  .object({
    rich_menu_id: z
      .string()
      .describe("ID of the existing rich menu whose image will be replaced."),
    image_url: z
      .string()
      .url()
      .refine((u) => u.startsWith("https://"), "image_url ต้องเป็น HTTPS")
      .describe("Public HTTPS URL of the new image. Must be JPEG or PNG, ≤1MB."),
    oa: z.string().optional().describe("Optional OA id; defaults to active OA."),
  })
  .strict();

export function registerUploadRichMenuImageTool(server: McpServer): void {
  server.registerTool(
    "line_upload_rich_menu_image",
    {
      title: "Upload / replace a LINE rich menu image",
      description: `Replace the image on an EXISTING rich menu without recreating it — richMenuId, tappable areas, and per-user links are preserved. Downloads from a public HTTPS URL, validates JPEG/PNG ≤1MB, then uploads to the api-data.line.me content endpoint (the domain switch that trips up most implementations). Private/internal addresses are blocked by an SSRF guard.

Returns { rich_menu_id, uploaded, bytes }.

Example: "เปลี่ยนรูป rich menu R123" → { rich_menu_id:"R123", image_url:"https://.../banner.png" }.`,
      inputSchema: InputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (raw: unknown) => {
      try {
        const params = InputSchema.parse(raw);
        const { config } = resolveOa(params.oa);
        const client = new LineClient({ channelAccessToken: config.channel_access_token });

        // Download image bytes through the SSRF guard (https only, no
        // private/internal targets, redirect hops re-validated, size-capped).
        const downloaded = await fetchPublicImage(params.image_url);
        const contentType = downloaded.contentType;
        if (
          !contentType.includes("png") &&
          !contentType.includes("jpeg") &&
          !contentType.includes("jpg")
        ) {
          return {
            isError: true,
            content: [
              { type: "text", text: `❌ Image format ไม่รองรับ (${contentType}). ใช้ JPEG หรือ PNG เท่านั้น` },
            ],
          };
        }
        const imageBuf = downloaded.buffer;
        if (imageBuf.length > RICH_MENU_IMAGE_MAX_BYTES) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `❌ Image ใหญ่ ${(imageBuf.length / 1024).toFixed(0)}KB (max ${(RICH_MENU_IMAGE_MAX_BYTES / 1000).toFixed(0)}KB). บีบอัดก่อนอัปโหลด`,
              },
            ],
          };
        }

        // Upload to existing rich menu (api-data.line.me, raw body) — throws LineApiError on failure
        await client.uploadRichMenuImage(params.rich_menu_id, imageBuf, contentType);

        const output = {
          rich_menu_id: params.rich_menu_id,
          uploaded: true as const,
          bytes: imageBuf.length,
        };
        return {
          content: [
            {
              type: "text",
              text: `✅ อัปโหลดรูปใหม่ให้ rich menu \`${params.rich_menu_id}\` สำเร็จ (${(imageBuf.length / 1024).toFixed(0)}KB)`,
            },
          ],
          structuredContent: output as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return errorReply(err);
      }
    },
  );
}

function errorReply(err: unknown): { content: { type: "text"; text: string }[]; isError: true } {
  if (err instanceof SsrfBlockedError) {
    // Already a Thai, user-facing message (download failed / blocked target / too large).
    return { isError: true, content: [{ type: "text", text: err.message }] };
  }
  if (err instanceof LineApiError) {
    const detail = err.details.length
      ? `${err.message}\n${err.details.map((d) => `  • ${d}`).join("\n")}`
      : err.message;
    return { isError: true, content: [{ type: "text", text: detail }] };
  }
  if (err instanceof z.ZodError) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `❌ Invalid input:\n${err.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n")}`,
        },
      ],
    };
  }
  const msg = err instanceof Error ? err.message : String(err);
  return { isError: true, content: [{ type: "text", text: TH.unknownError(msg) }] };
}
