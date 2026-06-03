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
    base_url: z
      .string()
      .url()
      .max(1000)
      .describe(
        "HTTPS base URL of the pre-hosted image set. LINE requests /1040 /700 /460 /300 /240 from it. No upload API — you must host the images yourself.",
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
      .describe("Image height in px WHEN the width is 1040 (width is always forced to 1040)."),
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
      description: `Build a validated Imagemap message (LINE OA Manager calls this a "Rich Message") and return it as JSON, ready to hand to line_send_message. DESIGN ONLY — this never calls the LINE API; it just builds + validates the message object.

Image hosting (read carefully):
  - LINE has NO imagemap-image upload API. You MUST pre-host the image yourself at a public HTTPS base_url.
  - At send time LINE fetches sized variants: \`\${base_url}/1040\`, \`/700\`, \`/460\`, \`/300\`, \`/240\`. Host all of them (or a server that serves the right size per suffix).
  - baseSize.width is always forced to ${IMAGEMAP_BASE_WIDTH}. You only provide base_height (the image height when width = ${IMAGEMAP_BASE_WIDTH}). All area coordinates are px on that ${IMAGEMAP_BASE_WIDTH}-wide canvas.

Args:
  - base_url: HTTPS base URL of the hosted image set (≤1000 chars).
  - alt_text: Fallback text (1..400 chars).
  - base_height: Integer image height at width ${IMAGEMAP_BASE_WIDTH}.
  - areas: ≥1 tappable area, each { bounds: { x, y, width, height (ints) }, action: { type:"uri", uri, label? } | { type:"message", text, label? } }. Areas must fit inside ${IMAGEMAP_BASE_WIDTH} × base_height.
  - video: optional { original_content_url, preview_image_url, area, external_link? }.

Returns:
  { message: <LINE imagemap message object>, usage_hint: string }

Composability:
  - Build here → grab \`message\` → send via line_send_message (raw message passthrough).

Examples:
  - "Rich Message โปรโมชั่น ครึ่งบน-ครึ่งล่าง กดไปคนละลิงก์" →
    { base_url: "https://cdn.example.com/promo", alt_text: "โปรโมชั่นเดือนนี้", base_height: 1040,
      areas: [
        { bounds: { x: 0, y: 0, width: 1040, height: 520 }, action: { type: "uri", uri: "https://shop.example.com/a" } },
        { bounds: { x: 0, y: 520, width: 1040, height: 520 }, action: { type: "uri", uri: "https://shop.example.com/b" } }
      ] }

Errors:
  - base_url ต้องเป็น HTTPS → fix the URL scheme
  - พื้นที่เกินขอบรูป → an area's x+width or y+height exceeds ${IMAGEMAP_BASE_WIDTH} × base_height`,
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

        const builderInput: ImagemapInput = {
          base_url: params.base_url,
          alt_text: params.alt_text,
          base_height: params.base_height,
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
          usage_hint:
            "ส่งด้วย line_send_message โดยส่ง message object นี้ตรงๆ (raw passthrough). อย่าลืม host รูปที่ base_url ให้ LINE ดึงได้ทั้ง /1040 /700 /460 /300 /240",
        };

        const text = `✅ สร้าง Imagemap (Rich Message) แล้ว — ${params.areas.length} พื้นที่กดได้ (ฐาน ${IMAGEMAP_BASE_WIDTH}×${params.base_height})
ℹ️ ต้อง host รูปเองที่ base_url (LINE ดึง /1040 /700 /460 /300 /240) แล้วส่งต่อด้วย line_send_message

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
