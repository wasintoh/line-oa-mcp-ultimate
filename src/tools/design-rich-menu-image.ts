/**
 * Tool: line_design_rich_menu_image — Rich Menu Studio (v2.1).
 *
 * One tool takes a Thai SMB from idea to live rich menu:
 *   - preview (default): render the menu PNG with a pure-JS pipeline
 *     (satori → SVG → resvg → PNG, no headless browser) and return it as an
 *     MCP image block so the calling agent LOOKS at it before deploying.
 *   - save: write the PNG to disk.
 *   - deploy: render → create rich menu → upload image → optional default +
 *     alias. Tap areas are derived from the SAME template geometry as the
 *     rendered cells, so image and areas can never drift. Any failure after
 *     creation deletes the orphaned menu.
 *
 * LAZY LOADING: this file must never statically import satori/resvg/renderer
 * internals — the renderer is `await import(...)`ed inside the handler so
 * messaging-only users pay zero cold-start cost. `templates.ts` is pure data
 * and safe to import statically for validation.
 */

import { writeFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveOa } from "../config/multi-oa.js";
import { LineApiError, LineClient } from "../line/client.js";
import { TH } from "../i18n/th.js";
import {
  getTemplate,
  templateAreaBounds,
  TEMPLATE_IDS,
  RICH_MENU_TEMPLATES,
} from "../richmenu/templates.js";
import type { BrandKit } from "../richmenu/design.js";

// ---- Zod schemas ----

const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const ActionSchema = z.union([
  z
    .object({
      type: z.literal("uri"),
      uri: z.string().url().describe("https:// link, LIFF URL, or tel:"),
    })
    .strict(),
  z
    .object({
      type: z.literal("message"),
      text: z.string().min(1).max(300).describe("Text sent into the chat when tapped"),
    })
    .strict(),
  z
    .object({
      type: z.literal("postback"),
      data: z.string().min(1).max(300),
      display_text: z.string().max(300).optional(),
    })
    .strict(),
]);

const CellSchema = z
  .object({
    label: z.string().min(1).max(30).describe("Main label (Thai OK). Keep it short."),
    sublabel: z.string().min(1).max(60).optional().describe("Smaller secondary line"),
    icon_emoji: z
      .string()
      .min(1)
      .max(8)
      .optional()
      .describe("One emoji rendered as a crisp icon above the label (via twemoji)"),
    bg: z
      .string()
      .regex(HEX_COLOR, "bg ต้องเป็นสี hex เช่น #06C755")
      .optional()
      .describe("Override this cell's background color (hex)"),
    image_url: z
      .string()
      .url()
      .optional()
      .describe("HTTPS photo used as the cell background (with a readability scrim)"),
    action: ActionSchema.optional().describe(
      "Tap action. Optional for preview/save; REQUIRED on every cell for deploy.",
    ),
  })
  .strict();

const BrandSchema = z
  .object({
    primary: z.string().regex(HEX_COLOR, "primary ต้องเป็นสี hex เช่น #06C755").optional(),
    accent: z.string().regex(HEX_COLOR, "accent ต้องเป็นสี hex").optional(),
    text: z
      .string()
      .regex(HEX_COLOR, "text ต้องเป็นสี hex")
      .optional()
      .describe("Preferred label color — auto-corrected if unreadable on the background"),
    font: z
      .enum(["line-seed", "prompt", "noto"])
      .optional()
      .describe(
        "line-seed (default, LINE's own Thai typeface — fetched from seed.line.me on first use) | prompt | noto",
      ),
    font_path: z
      .string()
      .optional()
      .describe("Absolute path to your own licensed .ttf/.otf — overrides `font`"),
    logo_url: z.string().url().optional().describe("HTTPS logo shown in the first cell"),
    style: z
      .enum(["solid", "gradient", "outline", "glass"])
      .optional()
      .describe("Visual finish. Default 'gradient'."),
  })
  .strict();

const DeploySchema = z
  .object({
    name: z.string().min(1).max(300).describe("Internal rich menu name (admin only)"),
    set_default: z
      .boolean()
      .default(false)
      .describe("Set as the account-wide default menu after upload"),
    alias: z
      .string()
      .min(1)
      .max(32)
      .regex(/^[a-zA-Z0-9_-]+$/, "alias: a-z A-Z 0-9 _ - เท่านั้น")
      .optional()
      .describe("Rich menu alias id (for richmenuswitch tab designs). Conflicts are updated in place."),
    oa: z.string().optional(),
  })
  .strict();

const InputSchema = z
  .object({
    size: z
      .enum(["2500x1686", "2500x843"])
      .optional()
      .describe(
        "Optional; defaults to the template's native size (large templates → 2500x1686, compact_* → 2500x843). Errors if it contradicts the template.",
      ),
    template: z
      .enum(TEMPLATE_IDS)
      .describe("Layout template. grid_6 is the classic 3×2 LINE OA menu."),
    cells: z
      .array(CellSchema)
      .min(1)
      .max(6)
      .describe("One entry per template cell, in reading order (left→right, top→bottom)"),
    brand: BrandSchema.optional().describe("Brand kit. Omit for the tasteful default palette."),
    chat_bar_text: z
      .string()
      .min(1)
      .max(14)
      .optional()
      .describe('Chat-bar button label (≤14 chars). Default "เมนู".'),
    mode: z
      .enum(["preview", "save", "deploy"])
      .default("preview")
      .describe("preview (default) returns the PNG for inspection; save writes it; deploy goes live."),
    output_path: z
      .string()
      .optional()
      .describe("save mode: where to write the PNG. Default ./rich-menu-<template>.png"),
    deploy: DeploySchema.optional().describe("Required when mode='deploy'."),
    oa: z.string().optional().describe("OA id (multi-OA). Omit to use active OA."),
  })
  .strict();

type Input = z.infer<typeof InputSchema>;

// ---- helpers ----

function toLineAction(action: NonNullable<Input["cells"][number]["action"]>): Record<string, unknown> {
  if (action.type === "uri") return { type: "uri", uri: action.uri };
  if (action.type === "message") return { type: "message", text: action.text };
  const postback: Record<string, unknown> = { type: "postback", data: action.data };
  if (action.display_text) postback.displayText = action.display_text;
  return postback;
}

const templateList = TEMPLATE_IDS.map(
  (id) => `  - ${id} (${RICH_MENU_TEMPLATES[id].size}, ${RICH_MENU_TEMPLATES[id].cells.length} cells): ${RICH_MENU_TEMPLATES[id].description}`,
).join("\n");

// ---- registration ----

export function registerDesignRichMenuImageTool(server: McpServer): void {
  server.registerTool(
    "line_design_rich_menu_image",
    {
      title: "Design Rich Menu Image (Rich Menu Studio)",
      description: `Design a professional LINE rich menu PNG from labels alone — pure-JS renderer with Thai typography (LINE Seed / Prompt / Noto), then optionally deploy to LINE in the same call. No design tool or headless browser.

ALWAYS preview first: mode="preview" (default) returns the PNG as an image block — LOOK at it, iterate with the user, then call again mode="deploy". mode="save" writes the PNG to disk.

Templates (cells filled in reading order; tap areas auto-derived from the same geometry, pixel-perfect):
${templateList}

cells[] length MUST equal the template's cell count; per-cell action is required only for deploy. brand auto-corrects label contrast for readability. deploy needs deploy:{ name, set_default?, alias? } and auto-deletes the orphaned menu on any post-create failure; LINE caps the PNG at <1MB (gradients auto-flatten to solid once).

Returns preview → PNG image block + { width, height, bytes, template, font_used, warnings[] }; deploy → { rich_menu_id, areas_count, set_default, alias? }.

Example: "ทำเมนูร้านกาแฟ 6 ปุ่ม สีเขียว" → { template:"grid_6", brand:{primary:"#06C755"}, cells:[{label:"สั่งเลย", icon_emoji:"☕", action:{type:"uri", uri:"https://shop.line.me/@cafe"}}, ...5 more] }.`,
      inputSchema: InputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        // Open-world only because of optional image_url / logo_url / font fetches.
        openWorldHint: true,
      },
    },
    async (raw: unknown) => {
      try {
        const params: Input = InputSchema.parse(raw);
        const template = getTemplate(params.template);

        // size is informative only — but a contradiction is a real mistake.
        if (params.size && params.size !== template.size) {
          return errorText(TH.rmTemplateSizeMismatch(params.template, params.size, template.size));
        }
        if (params.cells.length !== template.cells.length) {
          return errorText(
            TH.rmCellCountMismatch(params.template, template.cells.length, params.cells.length),
          );
        }
        if (params.mode === "deploy") {
          if (!params.deploy) return errorText(TH.rmDeployConfigRequired);
          const missing = params.cells
            .map((c, i) => (c.action ? -1 : i))
            .filter((i) => i >= 0);
          if (missing.length > 0) return errorText(TH.rmDeployNeedsActions(missing));
        }

        // LAZY renderer import — messaging-only sessions never load satori/resvg.
        const { renderRichMenuPng } = await import("../richmenu/renderer.js");

        const brand: BrandKit | undefined = params.brand;
        let render = await renderRichMenuPng({
          template,
          cells: params.cells,
          brand,
        });
        const warnings = [...render.warnings];

        // ----- mode: preview -----
        if (params.mode === "preview") {
          const structured = {
            mode: "preview",
            width: render.width,
            height: render.height,
            bytes: render.bytes,
            template: params.template,
            font_used: render.fontUsed,
            warnings,
          };
          const text = `${TH.rmPreviewReady(
            params.template,
            render.width,
            render.height,
            Math.round(render.bytes / 1024),
            render.fontUsed,
          )}${warnings.length ? `\n\n${warnings.join("\n")}` : ""}`;
          return {
            content: [
              {
                type: "image" as const,
                data: render.png.toString("base64"),
                mimeType: "image/png",
              },
              { type: "text" as const, text },
            ],
            structuredContent: structured as unknown as Record<string, unknown>,
          };
        }

        // ----- mode: save -----
        if (params.mode === "save") {
          const path = resolvePath(params.output_path ?? `./rich-menu-${params.template}.png`);
          writeFileSync(path, render.png);
          const structured = {
            mode: "save",
            path,
            bytes: render.bytes,
            width: render.width,
            height: render.height,
            template: params.template,
            font_used: render.fontUsed,
            warnings,
          };
          const text = `${TH.rmSaved(path, Math.round(render.bytes / 1024))}${
            warnings.length ? `\n\n${warnings.join("\n")}` : ""
          }`;
          return textAndStructured(text, structured as unknown as Record<string, unknown>);
        }

        // ----- mode: deploy -----
        const deploy = params.deploy!; // presence checked above
        const { config } = resolveOa(deploy.oa ?? params.oa);
        const client = new LineClient({ channelAccessToken: config.channel_access_token });

        // LINE hard limit: PNG < 1MB. Gradients occasionally blow past it —
        // flatten to solid and retry once before giving up.
        if (render.bytes >= 1_000_000) {
          const style = brand?.style ?? "gradient";
          if (style === "gradient" || style === "glass") {
            render = await renderRichMenuPng({
              template,
              cells: params.cells,
              brand,
              styleOverride: "solid",
            });
            warnings.push(TH.rmRerenderedSolid);
          }
          if (render.bytes >= 1_000_000) {
            return errorText(TH.rmImageTooLarge(Math.round(render.bytes / 1024)));
          }
        }

        // 1 — create the rich menu. Areas come from the SAME geometry that
        // rendered the image (templates.ts) — no drift possible.
        const areas = templateAreaBounds(params.template).map((bounds, i) => ({
          bounds,
          action: toLineAction(params.cells[i]!.action!),
        }));
        const created = await client.request<{ richMenuId: string }>("POST", "/v2/bot/richmenu", {
          body: {
            size: { width: template.width, height: template.height },
            selected: false,
            name: deploy.name,
            chatBarText: params.chat_bar_text ?? "เมนู",
            areas,
          },
        });
        const richMenuId = created.richMenuId;

        // 2..4 — upload image, optional default + alias. ANY failure after
        // creation deletes the orphaned menu before surfacing the error.
        let aliasApplied: string | undefined;
        let step = "อัปโหลดรูป";
        try {
          await client.uploadRichMenuImage(richMenuId, render.png, "image/png");

          if (deploy.set_default) {
            step = "ตั้งเป็น default";
            await client.setDefaultRichMenu(richMenuId);
          }

          if (deploy.alias) {
            step = "สร้าง alias";
            try {
              await client.createRichMenuAlias(deploy.alias, richMenuId);
            } catch (err) {
              if (isAliasConflict(err)) {
                await client.updateRichMenuAlias(deploy.alias, richMenuId);
              } else {
                throw err;
              }
            }
            aliasApplied = deploy.alias;
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          try {
            await client.deleteRichMenu(richMenuId);
          } catch (cleanupErr) {
            const cleanupMsg =
              cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
            return errorText(
              `${TH.rmDeployCleanedUp(step, message)}\n${TH.rmDeployCleanupFailed(richMenuId, cleanupMsg)}`,
            );
          }
          return errorText(TH.rmDeployCleanedUp(step, message));
        }

        const structured: Record<string, unknown> = {
          mode: "deploy",
          rich_menu_id: richMenuId,
          image_bytes: render.bytes,
          set_default: deploy.set_default,
          areas_count: areas.length,
          font_used: render.fontUsed,
          warnings,
        };
        if (aliasApplied) structured.alias = aliasApplied;

        const text = `${TH.rmDeployed(richMenuId, areas.length, deploy.set_default, aliasApplied)}${
          warnings.length ? `\n\n${warnings.join("\n")}` : ""
        }`;
        return textAndStructured(text, structured);
      } catch (err) {
        return errorReply(err);
      }
    },
  );
}

function isAliasConflict(err: unknown): boolean {
  if (!(err instanceof LineApiError)) return false;
  if (err.status === 409) return true;
  const body = err.body as { message?: string } | undefined;
  return err.status === 400 && /conflict/i.test(body?.message ?? "");
}

// ---- shared response helpers (same shape as send-message.ts) ----

function textAndStructured(
  text: string,
  structured: Record<string, unknown>,
): {
  content: { type: "text"; text: string }[];
  structuredContent: Record<string, unknown>;
} {
  return {
    content: [{ type: "text", text }],
    structuredContent: structured,
  };
}

function errorText(text: string): {
  content: { type: "text"; text: string }[];
  isError: true;
} {
  return { isError: true, content: [{ type: "text", text }] };
}

function errorReply(err: unknown): {
  content: { type: "text"; text: string }[];
  isError: true;
} {
  if (err instanceof LineApiError) {
    const detail = err.details.length ? `\n${err.details.join("\n")}` : "";
    return {
      isError: true,
      content: [{ type: "text", text: `${err.message}${detail}` }],
    };
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
  return {
    isError: true,
    content: [{ type: "text", text: TH.unknownError(msg) }],
  };
}
