/**
 * Tool: line_design_flex
 *
 * Build a validated Flex Message from either:
 *   - a pre-built Thai-localized template + structured data, or
 *   - raw Flex JSON (advanced users who already know the schema)
 *
 * In V1 we ship template-based rendering. The "natural-language → Flex" path
 * via MCP sampling is reserved for V1.1 — sampling support across MCP clients
 * is still uneven, so we keep V1 deterministic.
 *
 * Output includes: the Flex JSON, an LINE Flex Simulator preview URL, the
 * derived alt text, and any size / lint warnings.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { FLEX_BUBBLE_MAX_JSON_BYTES } from "../constants.js";
import { TH } from "../i18n/th.js";
import {
  FLEX_TEMPLATE_CATALOG,
  FLEX_TEMPLATE_NAMES,
  renderTemplate,
} from "../line/flex-templates.js";
import type { LineFlexMessage } from "../types.js";

// Keep the schema as a plain ZodObject (no .refine) so that `.shape` is
// available for the MCP SDK's `registerTool`. We do the cross-field validation
// manually in the handler.
const InputSchema = z
  .object({
    template: z
      .enum(FLEX_TEMPLATE_NAMES)
      .optional()
      .describe(
        "Name of a pre-built Thai-localized Flex template. See catalog below. Mutually exclusive with flex_json.",
      ),
    data: z
      .record(z.unknown())
      .optional()
      .describe("Template-specific data fields. Required when template is set."),
    flex_json: z
      .record(z.unknown())
      .optional()
      .describe(
        "Raw Flex contents (bubble or carousel). Advanced users only. Mutually exclusive with template.",
      ),
    alt_text: z
      .string()
      .min(1)
      .max(400)
      .optional()
      .describe("Optional override for altText. Defaults to a template-derived alt text."),
    list_templates: z
      .boolean()
      .default(false)
      .describe("Set true to return the available template catalog instead of rendering."),
  })
  .strict();

type _Input = z.infer<typeof InputSchema>; // kept for doc purposes

interface DesignOutput {
  template?: string;
  flex_json: Record<string, unknown>;
  alt_text: string;
  preview_url: string;
  size_bytes: number;
  warnings: string[];
}

export function registerDesignFlexTool(server: McpServer): void {
  server.registerTool(
    "line_design_flex",
    {
      title: "Design LINE Flex Message",
      description: `Compose a validated Flex Message for line_send_message. Modes: template mode { template, data } (Thai-localized, recommended; templates: ${FLEX_TEMPLATE_NAMES.join(", ")}); raw mode { flex_json, alt_text } (advanced); or { list_templates: true } to get the catalog with Thai descriptions + required fields per template. DESIGN ONLY — never calls the LINE API.

Feed the result to line_send_message via message.flex_json, or pass { template, data } straight to line_send_message (same templates). Returns { flex_json, alt_text, preview_url (Flex Simulator), size_bytes, warnings[] } (warns near the 30KB bubble limit).

Example: "ออกแบบคูปอง 20% หมด 31 ส.ค." → { template:"voucher", data:{ title:"ส่วนลดวันแม่", code:"MOM20", discount:"ส่วนลด 20%", valid_until:"31 ส.ค. 2026" } }.`,
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

        // Cross-field check (was a .refine before — moved here so `.shape` works).
        if (!params.list_templates && params.template === undefined && params.flex_json === undefined) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: "❌ ต้องระบุอย่างใดอย่างหนึ่ง: template + data / flex_json / list_templates=true",
              },
            ],
          };
        }

        if (params.list_templates) {
          const text = renderCatalog();
          return {
            content: [{ type: "text", text }],
            structuredContent: { templates: FLEX_TEMPLATE_CATALOG } as unknown as Record<
              string,
              unknown
            >,
          };
        }

        let flex: LineFlexMessage;
        let templateUsed: string | undefined;
        if (params.template) {
          flex = renderTemplate(params.template, params.data ?? {});
          templateUsed = params.template;
        } else {
          flex = {
            type: "flex",
            altText: params.alt_text ?? "Flex message",
            contents: params.flex_json as Record<string, unknown>,
          };
        }
        if (params.alt_text) flex.altText = params.alt_text;

        const flexJson = flex.contents as Record<string, unknown>;
        const jsonStr = JSON.stringify(flexJson);
        const sizeBytes = new TextEncoder().encode(jsonStr).length;

        const warnings: string[] = [];
        if (sizeBytes > FLEX_BUBBLE_MAX_JSON_BYTES) {
          warnings.push(TH.flexTooLarge(sizeBytes, FLEX_BUBBLE_MAX_JSON_BYTES));
        } else if (sizeBytes > FLEX_BUBBLE_MAX_JSON_BYTES * 0.8) {
          warnings.push(
            `🟡 Flex JSON ขนาด ${sizeBytes.toLocaleString()} bytes ใกล้ limit (${FLEX_BUBBLE_MAX_JSON_BYTES.toLocaleString()})`,
          );
        }

        const previewUrl = `https://developers.line.biz/flex-simulator/?json=${encodeURIComponent(
          jsonStr,
        )}`;

        const output: DesignOutput = {
          template: templateUsed,
          flex_json: flexJson,
          alt_text: flex.altText,
          preview_url: previewUrl,
          size_bytes: sizeBytes,
          warnings,
        };

        const md: string[] = [`# ✨ Flex Message`, ""];
        if (templateUsed) md.push(`**Template:** \`${templateUsed}\``);
        md.push(`**Alt text:** ${flex.altText}`);
        md.push(`**Size:** ${sizeBytes.toLocaleString()} bytes`);
        md.push(`**Preview:** ${previewUrl}`);
        if (warnings.length) {
          md.push("");
          md.push("## Warnings");
          for (const w of warnings) md.push(`- ${w}`);
        }
        md.push("");
        md.push("```json");
        md.push(JSON.stringify(flexJson, null, 2));
        md.push("```");

        return {
          content: [{ type: "text", text: md.join("\n") }],
          structuredContent: output as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return errorReply(err);
      }
    },
  );
}

function renderCatalog(): string {
  const lines: string[] = ["# 🎨 Flex Templates (Thai-localized)", ""];
  for (const t of FLEX_TEMPLATE_CATALOG) {
    lines.push(`## \`${t.name}\``);
    lines.push(t.description_th);
    lines.push(`**Fields:** ${t.fields.join(", ")}`);
    lines.push("");
  }
  return lines.join("\n");
}

function errorReply(err: unknown): { content: { type: "text"; text: string }[]; isError: true } {
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
  return {
    isError: true,
    content: [{ type: "text", text: TH.unknownError(msg) }],
  };
}
