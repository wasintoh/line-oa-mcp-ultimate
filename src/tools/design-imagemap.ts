/**
 * Tool: line_design_imagemap
 *
 * Build a validated Imagemap message (LINE OA Manager calls these "Rich Message")
 * from friendly snake_case inputs. This is a DESIGN tool — it builds + validates
 * the message object and returns it as JSON; it does NOT touch the network. Pass
 * the returned `message` to line_send_message to actually deliver it.
 *
 * IMPORTANT: LINE has NO imagemap-image upload API. The user must pre-host the
 * image at `base_url`; LINE then requests `${base_url}/1040`, `/700`, `/460`,
 * `/300`, `/240`. baseSize.width is always forced to 1040 (the LINE contract).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { IMAGEMAP_BASE_WIDTH } from "../constants.js";
import { TH } from "../i18n/th.js";
import { imageStore } from "../imagehost/store.js";
import { buildImagemapMessage, type ImagemapInput } from "../line/imagemap-builder.js";

const BoundsSchema = z
  .object({
    x: z.number().int().nonnegative().describe("Left offset in px on the 1040-wide base image."),
    y: z.number().int().nonnegative().describe("Top offset in px on the 1040-wide base image."),
    width: z.number().int().positive().describe("Tappable width in px."),
    height: z.number().int().positive().describe("Tappable height in px."),
  })
  .strict();

const AreaActionSchema = z.union([
  z
    .object({
      type: z.literal("uri"),
      uri: z.string().url().describe("Destination URL (http/https) opened on tap."),
      label: z.string().optional().describe("Accessibility label for this area."),
    })
    .strict(),
  z
    .object({
      type: z.literal("message"),
      text: z.string().min(1).describe("Text sent back to the OA when this area is tapped."),
      label: z.string().optional().describe("Accessibility label for this area."),
    })
    .strict(),
]);

const AreaSchema = z
  .object({
    bounds: BoundsSchema,
    action: AreaActionSchema,
  })
  .strict();

const VideoSchema = z
  .object({
    original_content_url: z
      .string()
      .url()
      .describe("HTTPS URL of the mp4 video (≤1 min, ≤10MB)."),
    preview_image_url: z.string().url().describe("HTTPS URL of the preview image."),
    area: BoundsSchema.describe("Where the video plays inside the image (px on the 1040 base)."),
    external_link: z
      .object({
        uri: z.string().url().describe("URL opened from the video's external link button."),
        label: z.string().min(1).describe("Label for the external link button."),
      })
      .strict()
      .optional()
      .describe("Optional 'more info' link shown after the video finishes."),
  })
  .strict();

const InputSchema = z
  .object({
    prepared_key: z
      .string()
      .min(1)
      .optional()
      .describe(
        "RECOMMENDED path: key from line_prepare_image (purpose 'imagemap'). base_url and base_height are filled in automatically from the prepared image.",
      ),
    base_url: z
      .string()
      .url()
      .max(1000)
      .optional()
      .describe(
        "Self-hosting path: HTTPS base URL of a pre-hosted image set. LINE requests /1040 /700 /460 /300 /240 from it. Use line_prepare_image + prepared_key instead if the user has no host.",
      ),
    alt_text: z
      .string()
      .min(1)
      .max(400)
      .describe("Fallback text shown when the image can't render (≤400 chars)."),
    base_height: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "Image height in px WHEN the width is 1040. REQUIRED with base_url; ignored with prepared_key (auto-derived).",
      ),
    areas: z
      .array(AreaSchema)
      .min(1)
      .describe("At least 1 tappable area. Bounds are px on the 1040-wide base; must stay in bounds."),
    video: VideoSchema.optional().describe(
      "Optional inline video that plays over part of the image.",
    ),
  })
  .strict();

export function registerDesignImagemapTool(server: McpServer): void {
  server.registerTool(
    "line_design_imagemap",
    {
      title: "Design LINE Imagemap (Rich Message)",
      description: `Build a validated Imagemap message (LINE OA Manager calls it a "Rich Message") and return it as JSON to hand to line_send_message via message.message_json. DESIGN ONLY — never calls the LINE API.

Image hosting — two paths: (1) RECOMMENDED: run line_prepare_image first and pass its prepared_key here (hosting + the 5 size variants + verification all handled; base_height auto-derived). (2) Self-hosted: pass base_url of a public HTTPS host serving \`\${base_url}/1040\`, \`/700\`, \`/460\`, \`/300\`, \`/240\` (LINE has NO upload API) plus base_height. Canvas width is always forced to ${IMAGEMAP_BASE_WIDTH}; all area coordinates are px on that ${IMAGEMAP_BASE_WIDTH}-wide canvas and must fit inside ${IMAGEMAP_BASE_WIDTH} × base_height. Optional video area supported.

Returns { message, usage_hint }.

Example (prepared): "ส่งรูปนี้เป็น Rich Message ครึ่งบน-ครึ่งล่าง" → line_prepare_image first, then { prepared_key:"ab12…", alt_text:"โปรเดือนนี้", areas:[{bounds:{x:0,y:0,width:1040,height:520},action:{type:"uri",uri:"https://shop.example.com/a"}},{bounds:{x:0,y:520,width:1040,height:520},action:{type:"uri",uri:"https://shop.example.com/b"}}] }. Example (self-hosted): same but { base_url:"https://cdn.example.com/promo", base_height:1040 } instead of prepared_key.`,
      inputSchema: InputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (raw: unknown) => {
      try {
        const params = InputSchema.parse(raw);

        // Exactly one image source: prepared_key (hosted for the user) XOR base_url (self-hosted).
        if ((params.prepared_key ? 1 : 0) + (params.base_url ? 1 : 0) !== 1) {
          return { isError: true, content: [{ type: "text", text: TH.imgBaseUrlOrPreparedKey }] };
        }

        let baseUrl: string;
        let baseHeight: number;
        if (params.prepared_key) {
          const stored = imageStore.get(params.prepared_key);
          const hosting = imageStore.getHosting(params.prepared_key);
          if (!stored || !hosting) {
            return { isError: true, content: [{ type: "text", text: TH.imgPreparedKeyNotFound(params.prepared_key) }] };
          }
          if (!hosting.baseUrl) {
            return { isError: true, content: [{ type: "text", text: TH.imgPreparedNotImagemap(params.prepared_key) }] };
          }
          baseUrl = hosting.baseUrl;
          // The schema documents base_height as IGNORED with prepared_key —
          // honoring a caller-supplied value here would let a stale/mistaken
          // number silently misalign every tap area (QC catch). Derived only.
          baseHeight = stored.variants.baseHeight;
        } else {
          if (params.base_height === undefined) {
            return { isError: true, content: [{ type: "text", text: TH.imgBaseHeightRequired }] };
          }
          baseUrl = params.base_url!;
          baseHeight = params.base_height;
        }

        const builderInput: ImagemapInput = {
          base_url: baseUrl,
          alt_text: params.alt_text,
          base_height: baseHeight,
          areas: params.areas.map((a) => ({
            bounds: a.bounds,
            action:
              a.action.type === "uri"
                ? { type: "uri", uri: a.action.uri, ...(a.action.label ? { label: a.action.label } : {}) }
                : {
                    type: "message",
                    text: a.action.text,
                    ...(a.action.label ? { label: a.action.label } : {}),
                  },
          })),
          ...(params.video
            ? {
                video: {
                  original_content_url: params.video.original_content_url,
                  preview_image_url: params.video.preview_image_url,
                  area: params.video.area,
                  ...(params.video.external_link
                    ? {
                        external_link: {
                          uri: params.video.external_link.uri,
                          label: params.video.external_link.label,
                        },
                      }
                    : {}),
                },
              }
            : {}),
        };

        const message = buildImagemapMessage(builderInput);

        const output = {
          message,
          usage_hint: params.prepared_key
            ? "ส่งด้วย line_send_message โดยส่ง message object นี้ตรงๆ (message_json) — รูปถูกโฮสต์และตรวจครบ 5 ขนาดแล้ว ส่งได้ทันที"
            : "ส่งด้วย line_send_message โดยส่ง message object นี้ตรงๆ (raw passthrough). อย่าลืม host รูปที่ base_url ให้ LINE ดึงได้ทั้ง /1040 /700 /460 /300 /240",
        };

        const text = `✅ สร้าง Imagemap (Rich Message) แล้ว — ${params.areas.length} พื้นที่กดได้ (ฐาน ${IMAGEMAP_BASE_WIDTH}×${baseHeight})
${params.prepared_key ? "ℹ️ รูปโฮสต์ผ่าน line_prepare_image แล้ว — ส่งต่อด้วย line_send_message ได้เลย" : "ℹ️ ต้อง host รูปเองที่ base_url (LINE ดึง /1040 /700 /460 /300 /240) แล้วส่งต่อด้วย line_send_message"}

\`\`\`json
${JSON.stringify(message, null, 2)}
\`\`\``;

        return {
          content: [{ type: "text", text }],
          structuredContent: output as unknown as Record<string, unknown>,
        };
      } catch (err) {
        if (err instanceof z.ZodError) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `❌ Invalid input:\n${err.issues
                  .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
                  .join("\n")}`,
              },
            ],
          };
        }
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `❌ ${msg}` }] };
      }
    },
  );
}
