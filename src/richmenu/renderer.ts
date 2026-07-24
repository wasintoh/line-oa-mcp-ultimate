/**
 * Rich Menu Studio — pure-JS renderer (satori → SVG → resvg → PNG).
 *
 * No headless browser. satori lays the menu out from a plain-object element
 * tree (no React), emits SVG with <text> runs (embedFont: false), and
 * @resvg/resvg-js rasterizes it — its rustybuzz shaper applies full Thai
 * GSUB/GPOS (stacked tone marks over upper vowels render correctly, which
 * satori's own path embedding cannot do).
 *
 * This module (and everything satori/resvg) is imported LAZILY by the tool
 * handler — messaging-only users never pay its cost.
 *
 * Geometry comes straight from `templates.ts`: cells are absolutely
 * positioned divs using the SAME boxes that become LINE tap areas.
 */

import satori from "satori";
import { Resvg } from "@resvg/resvg-js";

import { TH } from "../i18n/th.js";
import { fetchPublicImage } from "../line/ssrf-guard.js";
import {
  canvasBackground,
  paintForCell,
  rgba,
  resolveBrand,
  type BrandKit,
} from "./design.js";
import { resolveFonts } from "./fonts.js";
import type { CellBox, RichMenuTemplate } from "./templates.js";

// ---- input/output shapes ----

export interface RenderCell {
  label: string;
  sublabel?: string;
  icon_emoji?: string;
  bg?: string;
  image_url?: string;
}

export interface RenderOptions {
  template: RichMenuTemplate;
  cells: RenderCell[];
  brand?: BrandKit;
  /** Force a style override (used by the deploy path to flatten oversized PNGs). */
  styleOverride?: BrandKit["style"];
}

export interface RenderResult {
  png: Buffer;
  width: number;
  height: number;
  bytes: number;
  fontUsed: string;
  warnings: string[];
}

// ---- satori element helpers (plain objects, no React) ----

type VNode = { type: string; props: Record<string, unknown> };

function el(
  type: string,
  style: Record<string, unknown>,
  children?: VNode[] | string,
  extraProps: Record<string, unknown> = {},
): VNode {
  // satori's style expander throws on `undefined` values — strip them.
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(style)) {
    if (v !== undefined) clean[k] = v;
  }
  return { type, props: { style: clean, children, ...extraProps } };
}

// ---- twemoji (emoji → CDN image, in-memory cache, never fatal) ----

const TWEMOJI_BASE = "https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/svg/";
const emojiCache = new Map<string, string | null>();

function emojiCodepoints(emoji: string, keepVs16: boolean): string {
  const points: number[] = [];
  for (const ch of emoji) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    if (!keepVs16 && cp === 0xfe0f) continue;
    points.push(cp);
  }
  return points.map((p) => p.toString(16)).join("-");
}

/** Resolve an emoji to a data: URL via the twemoji CDN. null on any failure. */
async function twemojiDataUrl(emoji: string): Promise<string | null> {
  const cached = emojiCache.get(emoji);
  if (cached !== undefined) return cached;
  for (const keepVs16 of [false, true]) {
    const code = emojiCodepoints(emoji, keepVs16);
    if (!code) continue;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      try {
        const res = await fetch(`${TWEMOJI_BASE}${code}.svg`, { signal: controller.signal });
        if (!res.ok) continue;
        const type = res.headers.get("content-type") ?? "";
        if (!type.includes("svg") && !type.startsWith("image/")) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length === 0) continue;
        const url = `data:image/svg+xml;base64,${buf.toString("base64")}`;
        emojiCache.set(emoji, url);
        return url;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // try next variant / give up below
    }
  }
  emojiCache.set(emoji, null);
  return null;
}

/** TEST-ONLY seam: clear the emoji cache. */
export function clearEmojiCache(): void {
  emojiCache.clear();
}

// ---- cell tree construction ----

interface CellAssets {
  emojiGrapheme?: string;
  imageDataUrl?: string;
  logoDataUrl?: string;
}

function buildCellNode(
  template: RichMenuTemplate,
  index: number,
  box: CellBox,
  cell: RenderCell,
  assets: CellAssets,
  brand: ReturnType<typeof resolveBrand>,
): VNode {
  const isHero = template.hero?.indexes.includes(index) ?? false;
  const scale = isHero && template.hero ? template.hero.scale : template.scale;
  const isRightEdge = box.x + box.width >= template.width;
  const isBottomEdge = box.y + box.height >= template.height;

  // Position along the gradient axis (150deg ≈ mostly vertical) → effective bg.
  const positionT =
    (box.y + box.height / 2) / template.height * 0.8 +
    (box.x + box.width / 2) / template.width * 0.2;
  const paint = paintForCell(brand, positionT, cell.bg);

  const glass = brand.style === "glass" && !cell.image_url && !cell.bg;

  const outerStyle: Record<string, unknown> = {
    position: "absolute",
    left: box.x,
    top: box.y,
    width: box.width,
    height: box.height,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: glass ? Math.round(scale.padding * 0.55) : scale.padding,
    backgroundColor: cell.image_url ? undefined : paint.background,
    borderRight: isRightEdge ? undefined : `2px solid ${paint.separator}`,
    borderBottom: isBottomEdge ? undefined : `2px solid ${paint.separator}`,
  };
  if (assets.imageDataUrl) {
    outerStyle.backgroundImage = `url("${assets.imageDataUrl}")`;
    outerStyle.backgroundSize = `${box.width}px ${box.height}px`;
  }

  const textColor = assets.imageDataUrl ? "#FFFFFF" : paint.text;
  const subColor = assets.imageDataUrl ? "rgba(255, 255, 255, 0.88)" : paint.subtext;

  const inner: VNode[] = [];

  const iconSrc = assets.logoDataUrl ?? undefined;
  if (iconSrc) {
    inner.push(
      el("img", { width: scale.icon, height: scale.icon, marginBottom: Math.round(scale.icon * 0.16), objectFit: "contain" }, undefined, { src: iconSrc, width: scale.icon, height: scale.icon }),
    );
  } else if (assets.emojiGrapheme) {
    inner.push(
      el(
        "div",
        { fontSize: scale.icon, lineHeight: 1.15, marginBottom: Math.round(scale.icon * 0.1), display: "flex" },
        assets.emojiGrapheme,
      ),
    );
  }

  // Thai needs generous line-height (stacked marks + descenders) — ≥1.6.
  inner.push(
    el(
      "div",
      {
        fontSize: scale.label,
        fontWeight: 600,
        color: textColor,
        lineHeight: 1.6,
        textAlign: "center",
        maxWidth: box.width - scale.padding,
        display: "block",
        textShadow: assets.imageDataUrl ? "0 2px 12px rgba(0, 0, 0, 0.55)" : undefined,
      },
      cell.label,
    ),
  );

  if (cell.sublabel) {
    inner.push(
      el(
        "div",
        {
          fontSize: scale.sublabel,
          fontWeight: 400,
          color: subColor,
          lineHeight: 1.6,
          textAlign: "center",
          maxWidth: box.width - scale.padding,
          display: "block",
          textShadow: assets.imageDataUrl ? "0 2px 10px rgba(0, 0, 0, 0.55)" : undefined,
        },
        cell.sublabel,
      ),
    );
  }

  const children: VNode[] = [];

  if (assets.imageDataUrl) {
    // Readability scrim between the photo and the text.
    children.push(
      el("div", {
        position: "absolute",
        left: 0,
        top: 0,
        width: box.width,
        height: box.height,
        backgroundImage:
          "linear-gradient(180deg, rgba(0, 0, 0, 0.08) 0%, rgba(0, 0, 0, 0.18) 55%, rgba(0, 0, 0, 0.52) 100%)",
      }),
    );
  }

  if (glass) {
    // Frosted card floating inside the cell.
    children.push(
      el(
        "div",
        {
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%",
          backgroundColor: "rgba(255, 255, 255, 0.13)",
          border: "2px solid rgba(255, 255, 255, 0.22)",
          borderRadius: 36,
        },
        inner,
      ),
    );
    outerStyle.backgroundColor = undefined;
  } else {
    if (brand.style === "outline" && !assets.imageDataUrl) {
      // Accent bar between label block and cell bottom for visual hierarchy.
      inner.push(
        el("div", {
          width: Math.round(scale.label * 1.1),
          height: Math.max(8, Math.round(scale.label * 0.09)),
          marginTop: Math.round(scale.sublabel * 0.5),
          borderRadius: 6,
          backgroundColor: paint.accentBar,
        }),
      );
    }
    children.push(...inner);
  }

  return el("div", outerStyle, children);
}

// ---- main entry ----

export async function renderRichMenuPng(opts: RenderOptions): Promise<RenderResult> {
  const { template, cells } = opts;
  const warnings: string[] = [];
  const brandInput: BrandKit = { ...(opts.brand ?? {}) };
  if (opts.styleOverride) brandInput.style = opts.styleOverride;
  const brand = resolveBrand(brandInput);

  const fonts = await resolveFonts(brandInput.font, brandInput.font_path);
  warnings.push(...fonts.warnings);

  // Resolve remote assets (never fatal): cell images, brand logo, emoji.
  const graphemeImages: Record<string, string> = {};
  const assets: CellAssets[] = [];
  let logoDataUrl: string | undefined;
  if (brandInput.logo_url) {
    try {
      const img = await fetchPublicImage(brandInput.logo_url, { maxBytes: 3 * 1024 * 1024 });
      logoDataUrl = `data:${img.contentType};base64,${img.buffer.toString("base64")}`;
    } catch (err) {
      warnings.push(
        TH.rmImageFetchFailed(brandInput.logo_url, err instanceof Error ? err.message : String(err)),
      );
    }
  }

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const a: CellAssets = {};
    if (cell?.image_url) {
      try {
        const img = await fetchPublicImage(cell.image_url, { maxBytes: 6 * 1024 * 1024 });
        a.imageDataUrl = `data:${img.contentType};base64,${img.buffer.toString("base64")}`;
      } catch (err) {
        warnings.push(
          TH.rmImageFetchFailed(cell.image_url, err instanceof Error ? err.message : String(err)),
        );
      }
    }
    if (cell?.icon_emoji) {
      const url = await twemojiDataUrl(cell.icon_emoji);
      if (url) {
        graphemeImages[cell.icon_emoji] = url;
        a.emojiGrapheme = cell.icon_emoji;
      } else {
        warnings.push(TH.rmEmojiSkipped(cell.icon_emoji));
      }
    }
    // Brand logo goes into the first (hero) cell unless it already has an icon.
    if (i === 0 && logoDataUrl && !cell?.icon_emoji) {
      a.logoDataUrl = logoDataUrl;
    }
    assets.push(a);
  }

  const bg = canvasBackground(brand);
  const rootStyle: Record<string, unknown> = {
    position: "relative",
    display: "flex",
    width: template.width,
    height: template.height,
    fontFamily: fonts.fontFamily,
  };
  if (bg.isGradient) rootStyle.backgroundImage = bg.css;
  else rootStyle.backgroundColor = bg.css;

  const cellNodes = template.cells.map((box, i) =>
    buildCellNode(template, i, box, cells[i] ?? { label: "" }, assets[i] ?? {}, brand),
  );

  // Subtle accent edge along the very top (brand signature line).
  const accentEdge = el("div", {
    position: "absolute",
    left: 0,
    top: 0,
    width: template.width,
    height: brand.style === "outline" ? 10 : 0,
    backgroundColor: brand.style === "outline" ? brand.primary : rgba(brand.primary, 0),
  });

  const tree = el("div", rootStyle, [accentEdge, ...cellNodes]);

  const svg = await satori(tree as never, {
    width: template.width,
    height: template.height,
    embedFont: false,
    fonts: fonts.satoriFonts,
    graphemeImages,
  });

  const png = new Resvg(svg, {
    fitTo: { mode: "width", value: template.width },
    font: {
      loadSystemFonts: false,
      fontFiles: fonts.fontFiles,
      defaultFontFamily: fonts.primaryFamily,
    },
  })
    .render()
    .asPng();

  return {
    png,
    width: template.width,
    height: template.height,
    bytes: png.length,
    fontUsed: fonts.fontUsed,
    warnings,
  };
}
