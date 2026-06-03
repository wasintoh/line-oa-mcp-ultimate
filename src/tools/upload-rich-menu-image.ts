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
      description: `Replace the image on an EXISTING rich menu without recreating it — the richMenuId, tappable areas, and any per-user links are preserved. Downloads the image from a public HTTPS URL, validates format + size, then uploads to the api-data.line.me content endpoint (the domain switch that trips up most implementations).

Args:
  - rich_menu_id: ID of the existing rich menu to update.
  - image_url: Public HTTPS URL of the new image. JPEG/PNG, ≤1MB.
  - oa: Optional OA id.

Returns:
  {
    rich_menu_id: string,
    uploaded: true,
    bytes: number   // size of the uploaded image
  }

Image requirements (validated client-side before upload):
  - Format: JPEG or PNG
  - File size: ≤1MB

Examples:
  - "เปลี่ยนรูป rich menu R123 เป็นแบนเนอร์ใหม่" → { rich_menu_id: "R123", image_url: "https://.../banner.png" }

Errors:
  - image_url not reachable → returns download error
  - unsupported format → returns format error
  - IMAGE_TOO_LARGE → ≥1MB; compress and retry
  - 404 → rich_menu_id not found`,
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

        // Download image bytes (we only have a URL)
        const imageRes = await fetch(params.image_url);
        if (!imageRes.ok) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `❌ ดาวน์โหลด image_url ไม่ได้ (HTTP ${imageRes.status}). ตรวจสอบ URL public + format`,
              },
            ],
          };
        }
        const contentType = imageRes.headers.get("content-type") ?? "image/jpeg";
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
        const imageBuf = Buffer.from(await imageRes.arrayBuffer());
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
