/**
 * Tool: line_build_rich_menu
 *
 * Collapses the multi-step Rich Menu workflow into a single call:
 *   1. Validate menu object
 *   2. Create rich menu (returns richMenuId)
 *   3. Upload image (via the api-data domain — the #1 source of bugs)
 *   4. Optionally set as default rich menu (account-wide)
 *
 * V1 supports "single" panel. "tab-pair" (the agency killer feature) is wired
 * but marked experimental — it requires two pre-built panel images.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveOa } from "../config/multi-oa.js";
import { LineApiError, LineClient } from "../line/client.js";
import { fetchPublicImage } from "../line/ssrf-guard.js";
import { redactSecrets } from "../line/redact.js";
import { TH } from "../i18n/th.js";

const ActionSchema = z.union([
  z
    .object({
      type: z.literal("postback"),
      data: z.string().max(300),
      displayText: z.string().max(300).optional(),
      label: z.string().max(20).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("message"),
      text: z.string().min(1).max(300),
      label: z.string().max(20).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("uri"),
      uri: z.string().url(),
      label: z.string().max(20).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("richmenuswitch"),
      richMenuAliasId: z.string(),
      data: z.string(),
      label: z.string().max(20).optional(),
    })
    .strict(),
]);

const AreaSchema = z
  .object({
    bounds: z
      .object({
        x: z.number().int().nonnegative(),
        y: z.number().int().nonnegative(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      })
      .strict(),
    action: ActionSchema,
  })
  .strict();

const InputSchema = z
  .object({
    name: z.string().min(1).max(300).describe("Internal name (admin-only)."),
    chat_bar_text: z.string().min(1).max(14).describe("The button label shown in chat bar."),
    size: z
      .enum(["compact", "large"])
      .default("large")
      .describe(
        "compact (2500x843) for a single row, large (2500x1686) for a full panel. Default 'large'.",
      ),
    image_url: z
      .string()
      .url()
      .refine((u) => u.startsWith("https://"), "image_url ต้องเป็น HTTPS")
      .describe(
        "Public HTTPS URL of the rich menu image. Must be JPEG or PNG, aspect ratio ≥ 1.45, ≤1MB.",
      ),
    areas: z
      .array(AreaSchema)
      .min(1)
      .max(20)
      .describe("Tappable areas. Coordinates are in image pixels."),
    set_as_default: z
      .boolean()
      .default(true)
      .describe("Set this rich menu as the account-wide default. Default true."),
    selected: z
      .boolean()
      .default(true)
      .describe("Whether the rich menu opens by default when chat is opened."),
    oa: z.string().optional(),
  })
  .strict();

type _Input = z.infer<typeof InputSchema>; // kept for doc purposes

const SIZE_DIMENSIONS = {
  compact: { width: 2500, height: 843 },
  large: { width: 2500, height: 1686 },
} as const;

export function registerBuildRichMenuTool(server: McpServer): void {
  server.registerTool(
    "line_build_rich_menu",
    {
      title: "Build LINE Rich Menu (single panel)",
      description: `Create a LINE Rich Menu from an already-hosted image in one call: validate → create → upload image → set as default. Collapses 4 LINE API calls into one, incl. the api-data.line.me domain switch for image upload (the #1 cause of failed implementations). Single-panel menus only. To RENDER the image from labels instead of hosting your own, use line_design_rich_menu_image.

image_url must be public HTTPS JPEG/PNG, width 800–2500px, aspect ≥1.45, ≤1MB (validated client-side before upload). areas are tappable regions with postback/message/uri/richmenuswitch actions and must fit inside the image bounds. size 'large' (2500x1686, default) or 'compact' (2500x843). set_as_default default true. Max 1,000 rich menus per OA.

Returns { rich_menu_id, name, set_as_default, warnings[] }.`,
      inputSchema: InputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (raw: unknown) => {
      try {
        const params = InputSchema.parse(raw);
        const { config } = resolveOa(params.oa);
        const client = new LineClient({ channelAccessToken: config.channel_access_token });

        const dimensions = SIZE_DIMENSIONS[params.size];

        // Sanity-check areas against image bounds
        for (const a of params.areas) {
          const overflowsX = a.bounds.x + a.bounds.width > dimensions.width;
          const overflowsY = a.bounds.y + a.bounds.height > dimensions.height;
          if (overflowsX || overflowsY) {
            return {
              isError: true,
              content: [
                {
                  type: "text",
                  text: `❌ พื้นที่ tap (x:${a.bounds.x}, y:${a.bounds.y}, w:${a.bounds.width}, h:${a.bounds.height}) เกินขอบรูป ${dimensions.width}x${dimensions.height}`,
                },
              ],
            };
          }
        }

        // 1. Create rich menu
        const menuObject = {
          size: dimensions,
          selected: params.selected,
          name: params.name,
          chatBarText: params.chat_bar_text,
          areas: params.areas,
        };
        const createRes = (await client.request<{ richMenuId: string }>(
          "POST",
          "/v2/bot/richmenu",
          { body: menuObject },
        )) as { richMenuId: string };
        const richMenuId = createRes.richMenuId;

        // Any failure past this point would orphan the just-created menu
        // object — delete it best-effort before surfacing the error so
        // retries start clean.
        const cleanupOrphan = async (): Promise<void> => {
          try {
            await client.deleteRichMenu(richMenuId);
          } catch {
            /* best-effort */
          }
        };

        // 2. Download image bytes (since we only have a URL) — SSRF-guarded
        let imageBuf: Buffer;
        let contentType: string;
        try {
          const downloaded = await fetchPublicImage(params.image_url);
          imageBuf = downloaded.buffer;
          contentType = downloaded.contentType;
        } catch (err) {
          await cleanupOrphan();
          const msg = err instanceof Error ? err.message : String(err);
          return {
            isError: true,
            content: [
              { type: "text", text: `${msg} — ตรวจสอบ image_url แล้วลองใหม่ (rich menu ที่ค้างถูกลบให้แล้ว)` },
            ],
          };
        }
        if (!contentType.includes("png") && !contentType.includes("jpeg") && !contentType.includes("jpg")) {
          await cleanupOrphan();
          return {
            isError: true,
            content: [
              { type: "text", text: `❌ Image format ไม่รองรับ (${contentType}). ใช้ JPEG หรือ PNG เท่านั้น` },
            ],
          };
        }
        if (imageBuf.length > 1_000_000) {
          await cleanupOrphan();
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `❌ Image ใหญ่ ${(imageBuf.length / 1024).toFixed(0)}KB (max 1,000KB). บีบอัดก่อนอัปโหลด`,
              },
            ],
          };
        }

        // 3. Upload image — IMPORTANT: api-data.line.me domain
        const uploadUrl = new URL(
          `/v2/bot/richmenu/${richMenuId}/content`,
          "https://api-data.line.me",
        );
        const uploadRes = await fetch(uploadUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.channel_access_token}`,
            "Content-Type": contentType,
          },
          body: imageBuf,
        });
        if (!uploadRes.ok) {
          const text = await uploadRes.text();
          await cleanupOrphan();
          return {
            isError: true,
            content: [
              { type: "text", text: `❌ Upload image ไม่สำเร็จ (${uploadRes.status}): ${redactSecrets(text)} (rich menu ที่ค้างถูกลบให้แล้ว)` },
            ],
          };
        }

        // 4. Set as default
        if (params.set_as_default) {
          await client.request("POST", `/v2/bot/user/all/richmenu/${richMenuId}`);
        }

        const output = {
          rich_menu_id: richMenuId,
          name: params.name,
          set_as_default: params.set_as_default,
          warnings: [] as string[],
        };
        const text = `✅ Rich Menu สร้างสำเร็จ\n- ID: \`${richMenuId}\`\n- ชื่อ: ${params.name}${
          params.set_as_default ? "\n- ตั้งเป็น default แล้ว" : "\n- (ยังไม่ได้ตั้งเป็น default)"
        }`;
        return {
          content: [{ type: "text", text }],
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
    return { isError: true, content: [{ type: "text", text: err.message }] };
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
