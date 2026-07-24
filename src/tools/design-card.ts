/**
 * Tool: line_design_card
 *
 * Build a validated Template message (LINE OA Manager calls these "Card Message")
 * from friendly snake_case inputs. This is a DESIGN tool — it builds + validates
 * the message object and returns it as JSON; it does NOT touch the network. Pass
 * the returned `message` to line_send_message to actually deliver it.
 *
 * Covers all four LINE template subtypes: buttons / confirm / carousel /
 * image_carousel. The pure builder enforces every LINE limit up front.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  TEMPLATE_BUTTONS_MAX_ACTIONS,
  TEMPLATE_CAROUSEL_MAX_ACTIONS_PER_COLUMN,
  TEMPLATE_CAROUSEL_MAX_COLUMNS,
  TEMPLATE_CONFIRM_ACTIONS,
  TEMPLATE_IMAGE_CAROUSEL_MAX_COLUMNS,
} from "../constants.js";
import {
  buildTemplateMessage,
  type CarouselColumnInput,
  type TemplateActionInput,
  type TemplateInput,
} from "../line/template-builder.js";

const ActionSchema = z.union([
  z
    .object({
      type: z.literal("uri"),
      label: z.string().min(1).max(20).describe("Button label (≤20 chars)."),
      uri: z.string().url().describe("Destination URL (http/https/tel/line)."),
    })
    .strict(),
  z
    .object({
      type: z.literal("message"),
      label: z.string().min(1).max(20).describe("Button label (≤20 chars)."),
      text: z.string().min(1).describe("Text sent back to the OA on tap."),
    })
    .strict(),
  z
    .object({
      type: z.literal("postback"),
      label: z.string().min(1).max(20).describe("Button label (≤20 chars)."),
      data: z.string().min(1).describe("Postback payload delivered to your webhook."),
      displayText: z.string().optional().describe("Text echoed in the chat as the user's reply."),
    })
    .strict(),
]);

const CarouselColumnSchema = z
  .object({
    title: z.string().optional().describe("Optional column title."),
    text: z.string().min(1).describe("Column body text (≤60 with title/thumb, else ≤120)."),
    thumbnail_image_url: z.string().url().optional().describe("Optional HTTPS thumbnail."),
    default_action: ActionSchema.optional().describe("Action fired when the column body is tapped."),
    actions: z
      .array(ActionSchema)
      .min(1)
      .describe(
        `1..${TEMPLATE_CAROUSEL_MAX_ACTIONS_PER_COLUMN} buttons. Every column MUST have the same number of buttons (LINE rule).`,
      ),
  })
  .strict();

const ImageCarouselColumnSchema = z
  .object({
    image_url: z.string().url().describe("HTTPS image URL for this card."),
    action: ActionSchema.describe("Single action fired when the image is tapped."),
  })
  .strict();

const InputSchema = z
  .object({
    kind: z
      .enum(["buttons", "confirm", "carousel", "image_carousel"])
      .describe("Card subtype. Determines which other fields are required."),
    alt_text: z
      .string()
      .min(1)
      .max(400)
      .describe("Fallback text shown in push notification + chat list (1..400 chars)."),

    // buttons / confirm shared + buttons-only fields
    title: z.string().optional().describe("[buttons] Optional card title."),
    text: z
      .string()
      .optional()
      .describe("[buttons] body (≤60 with title/thumb, else ≤160). [confirm] question (required)."),
    thumbnail_image_url: z.string().url().optional().describe("[buttons] Optional HTTPS thumbnail."),

    // buttons / confirm actions
    actions: z
      .array(ActionSchema)
      .optional()
      .describe(
        `[buttons] 1..${TEMPLATE_BUTTONS_MAX_ACTIONS} buttons. [confirm] exactly ${TEMPLATE_CONFIRM_ACTIONS} buttons.`,
      ),

    // carousel / image_carousel
    columns: z
      .array(z.union([CarouselColumnSchema, ImageCarouselColumnSchema]))
      .optional()
      .describe(
        `[carousel] ≤${TEMPLATE_CAROUSEL_MAX_COLUMNS} columns (same action-count each). [image_carousel] ≤${TEMPLATE_IMAGE_CAROUSEL_MAX_COLUMNS} columns.`,
      ),
  })
  .strict();

export function registerDesignCardTool(server: McpServer): void {
  server.registerTool(
    "line_design_card",
    {
      title: "Design LINE Card Message (Template)",
      description: `Build a validated LINE Template message (LINE OA Manager calls it a "Card Message") and return it as JSON to hand to line_send_message via message.message_json. DESIGN ONLY — never calls the LINE API.

\`kind\` (required) picks the subtype and enforces LINE limits:
  - buttons → title?, text, thumbnail_image_url?, actions (1..${TEMPLATE_BUTTONS_MAX_ACTIONS} buttons; text ≤60 chars with title/thumb, else ≤160)
  - confirm → text + exactly ${TEMPLATE_CONFIRM_ACTIONS} buttons (e.g. ตกลง / ยกเลิก)
  - carousel → columns (≤${TEMPLATE_CAROUSEL_MAX_COLUMNS}, each ≤${TEMPLATE_CAROUSEL_MAX_ACTIONS_PER_COLUMN} buttons); EVERY column must have the SAME number of buttons (LINE rule)
  - image_carousel → columns of { image_url (HTTPS), action } (≤${TEMPLATE_IMAGE_CAROUSEL_MAX_COLUMNS})
Actions: uri | message | postback; label ≤20 chars. alt_text (1..400) required.

Returns { message, usage_hint }.

Example: "การ์ดยืนยันการจอง ตกลง/ยกเลิก" → { kind:"confirm", alt_text:"ยืนยันการจอง", text:"ยืนยันคิว 14:00 ไหม?", actions:[{type:"postback",label:"ตกลง",data:"confirm=1"},{type:"message",label:"ยกเลิก",text:"ยกเลิก"}] }.`,
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

        // Map the flat friendly input → the builder's discriminated union.
        // The builder enforces all per-kind limits and throws Thai-friendly errors,
        // so we only translate shape here and let it own the cross-field validation.
        let builderInput: TemplateInput;

        switch (params.kind) {
          case "buttons":
            builderInput = {
              kind: "buttons",
              alt_text: params.alt_text,
              ...(params.title !== undefined ? { title: params.title } : {}),
              text: params.text ?? "",
              ...(params.thumbnail_image_url !== undefined
                ? { thumbnail_image_url: params.thumbnail_image_url }
                : {}),
              actions: (params.actions ?? []) as TemplateActionInput[],
            };
            break;

          case "confirm":
            builderInput = {
              kind: "confirm",
              alt_text: params.alt_text,
              text: params.text ?? "",
              actions: (params.actions ?? []) as TemplateActionInput[],
            };
            break;

          case "carousel":
            builderInput = {
              kind: "carousel",
              alt_text: params.alt_text,
              columns: ((params.columns ?? []) as CarouselColumnInput[]).map((c) => ({
                ...(c.title !== undefined ? { title: c.title } : {}),
                text: c.text,
                ...(c.thumbnail_image_url !== undefined
                  ? { thumbnail_image_url: c.thumbnail_image_url }
                  : {}),
                ...(c.default_action !== undefined ? { default_action: c.default_action } : {}),
                actions: c.actions,
              })),
            };
            break;

          case "image_carousel":
            builderInput = {
              kind: "image_carousel",
              alt_text: params.alt_text,
              columns: (params.columns ?? []).map((c) => {
                const col = c as { image_url?: string; action?: TemplateActionInput };
                if (col.image_url === undefined || col.action === undefined) {
                  throw new Error(
                    "image_carousel: ทุก column ต้องมี image_url และ action (ใช้ field ของ image_carousel ไม่ใช่ carousel)",
                  );
                }
                return { image_url: col.image_url, action: col.action };
              }),
            };
            break;
        }

        const message = buildTemplateMessage(builderInput);

        const output = {
          message,
          usage_hint: "ส่งด้วย line_send_message โดยส่ง message object นี้ตรงๆ (raw passthrough)",
        };

        const text = `✅ สร้าง Card Message (kind: ${params.kind}) แล้ว — ส่งต่อด้วย line_send_message

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
