/**
 * Rich Menu Studio — design system (brand kit, color math, auto-contrast).
 *
 * Pure math, no heavy imports. The centerpiece is `readableTextColor`: it
 * computes the relative luminance of each cell's EFFECTIVE background and
 * picks a light/dark text color so labels stay readable no matter what colors
 * the user throws at us (white-on-white attempts included).
 */

export type BrandStyle = "solid" | "gradient" | "outline" | "glass";
export type BrandFont = "line-seed" | "prompt" | "noto";

export interface BrandKit {
  /** Main brand color (hex). */
  primary?: string;
  /** Secondary/accent color (hex) — used for accent bars + sublabels. */
  accent?: string;
  /** Preferred label color (hex). Overridden automatically when unreadable. */
  text?: string;
  font?: BrandFont;
  /** Absolute path to a .ttf/.otf — takes precedence over `font`. */
  font_path?: string;
  logo_url?: string;
  style?: BrandStyle;
}

/** Zero-config default: deep teal-green + warm amber, gradient finish. */
export const DEFAULT_BRAND = {
  primary: "#0E6B54",
  accent: "#FFC24B",
  style: "gradient" as BrandStyle,
  font: "line-seed" as BrandFont,
};

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Parse #rgb / #rrggbb (case-insensitive). Returns null when invalid. */
export function parseHex(hex: string): Rgb | null {
  if (typeof hex !== "string") return null;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m || !m[1]) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

export function toHex(rgb: Rgb): string {
  const c = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${c(rgb.r)}${c(rgb.g)}${c(rgb.b)}`.toUpperCase();
}

/** WCAG 2.x relative luminance (0 = black, 1 = white). */
export function relativeLuminance(rgb: Rgb): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
}

/** WCAG contrast ratio between two hex colors (1..21). Invalid hex → 1. */
export function contrastRatio(hexA: string, hexB: string): number {
  const a = parseHex(hexA);
  const b = parseHex(hexB);
  if (!a || !b) return 1;
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export const LIGHT_TEXT = "#FFFFFF";
export const DARK_TEXT = "#1C2A33";

/** Minimum contrast we accept for menu labels (large text). */
const MIN_LABEL_CONTRAST = 3;

/**
 * Pick a text color that is ALWAYS readable on `bg`.
 * A `preferred` color is honored only when it clears the contrast bar —
 * white-on-white (and any same-tone pair) is silently corrected. The
 * luminance-based pick is verified too: mid-tone backgrounds (e.g. LINE green
 * #06C755) flip to whichever of light/dark actually clears ≥3:1 (the max of
 * the two is mathematically always ≥3.8:1 for this DARK_TEXT).
 */
export function readableTextColor(bg: string, preferred?: string): string {
  if (preferred && parseHex(preferred) && contrastRatio(preferred, bg) >= MIN_LABEL_CONTRAST) {
    return preferred;
  }
  const rgb = parseHex(bg);
  const lum = rgb ? relativeLuminance(rgb) : 0;
  const pick = lum > 0.42 ? DARK_TEXT : LIGHT_TEXT;
  if (contrastRatio(pick, bg) >= MIN_LABEL_CONTRAST) return pick;
  return pick === DARK_TEXT ? LIGHT_TEXT : DARK_TEXT;
}

/** Linear mix of two colors, t ∈ [0,1] (0 → a, 1 → b). Invalid hex → a or #000000. */
export function mix(hexA: string, hexB: string, t: number): string {
  const a = parseHex(hexA) ?? { r: 0, g: 0, b: 0 };
  const b = parseHex(hexB) ?? a;
  const k = Math.max(0, Math.min(1, t));
  return toHex({
    r: a.r + (b.r - a.r) * k,
    g: a.g + (b.g - a.g) * k,
    b: a.b + (b.b - a.b) * k,
  });
}

export function darken(hex: string, amount: number): string {
  return mix(hex, "#000000", amount);
}

export function lighten(hex: string, amount: number): string {
  return mix(hex, "#FFFFFF", amount);
}

/** hex → rgba() css string. */
export function rgba(hex: string, alpha: number): string {
  const c = parseHex(hex) ?? { r: 0, g: 0, b: 0 };
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
}

// ---- per-cell paint resolution ----

export interface ResolvedBrand {
  primary: string;
  accent: string;
  text?: string;
  style: BrandStyle;
}

export function resolveBrand(brand?: BrandKit): ResolvedBrand {
  return {
    primary: brand?.primary && parseHex(brand.primary) ? brand.primary : DEFAULT_BRAND.primary,
    accent: brand?.accent && parseHex(brand.accent) ? brand.accent : DEFAULT_BRAND.accent,
    text: brand?.text && parseHex(brand.text) ? brand.text : undefined,
    style: brand?.style ?? DEFAULT_BRAND.style,
  };
}

export interface CellPaint {
  /** CSS background for the cell div ("transparent" when the canvas shows through). */
  background: string;
  /** Effective flat hex the text will sit on — drives auto-contrast. */
  effectiveBg: string;
  text: string;
  subtext: string;
  separator: string;
  /** Accent bar color under the label (outline style) — empty string = none. */
  accentBar: string;
}

/** How far the gradient darkens from the brand primary. Kept moderate so a
 * SINGLE text color can stay readable across the whole canvas. */
const GRADIENT_DARKEN = 0.32;

function gradientAt(brand: ResolvedBrand, t: number): string {
  return mix(brand.primary, darken(brand.primary, GRADIENT_DARKEN), Math.max(0, Math.min(1, t)));
}

/** CSS background for the whole canvas (behind all cells). */
export function canvasBackground(brand: ResolvedBrand): { css: string; isGradient: boolean } {
  switch (brand.style) {
    case "gradient":
    case "glass":
      return {
        css: `linear-gradient(160deg, ${brand.primary} 0%, ${darken(brand.primary, GRADIENT_DARKEN)} 100%)`,
        isGradient: true,
      };
    case "outline":
      return { css: "#FFFFFF", isGradient: false };
    case "solid":
      return { css: brand.primary, isGradient: false };
  }
}

/** Effective flat background of a canvas-backed cell at gradient position t. */
function effectiveCanvasBg(brand: ResolvedBrand, t: number): string {
  const base = brand.style === "solid" ? brand.primary : gradientAt(brand, t);
  return brand.style === "glass" ? mix(base, "#FFFFFF", 0.14) : base;
}

/**
 * ONE text color for ALL canvas-backed cells — decided by the best WORST-CASE
 * contrast across the gradient extremes, so a menu never mixes dark labels on
 * light rows with light labels on dark rows. brand.text is honored only when
 * it is readable across the entire canvas.
 */
export function canvasTextColor(brand: ResolvedBrand): string {
  if (brand.style === "outline") {
    return readableTextColor("#FFFFFF", brand.text ?? darken(brand.primary, 0.18));
  }
  const ends = [effectiveCanvasBg(brand, 0), effectiveCanvasBg(brand, 1)];
  const minContrast = (c: string) =>
    Math.min(...ends.map((bg) => contrastRatio(c, bg)));
  if (brand.text && parseHex(brand.text) && minContrast(brand.text) >= MIN_LABEL_CONTRAST) {
    return brand.text;
  }
  return minContrast(LIGHT_TEXT) >= minContrast(DARK_TEXT) ? LIGHT_TEXT : DARK_TEXT;
}

/**
 * Resolve the paint of one cell from the SAME brand + geometry the renderer
 * uses. `positionT` ∈ [0,1] approximates where the cell sits along the
 * gradient axis so effective luminance tracks the actual pixels behind it.
 */
export function paintForCell(
  brand: ResolvedBrand,
  positionT: number,
  explicitBg?: string,
): CellPaint {
  const style = brand.style;

  if (explicitBg && parseHex(explicitBg)) {
    const text = readableTextColor(explicitBg, brand.text);
    return {
      background: explicitBg,
      effectiveBg: explicitBg,
      text,
      subtext: rgba(text, 0.78),
      separator: text === LIGHT_TEXT ? "rgba(255, 255, 255, 0.35)" : "rgba(28, 42, 51, 0.22)",
      accentBar: brand.accent,
    };
  }

  if (style === "outline") {
    const text = canvasTextColor(brand);
    return {
      background: "transparent",
      effectiveBg: "#FFFFFF",
      text,
      subtext: rgba(DARK_TEXT, 0.62),
      separator: rgba(brand.primary, 0.28),
      accentBar: brand.accent,
    };
  }

  // solid / gradient / glass — cells sit on the primary-colored canvas.
  // Text color is UNIFORM across the canvas (see canvasTextColor) so rows
  // never flip between light and dark labels mid-menu.
  const text = canvasTextColor(brand);
  return {
    background: style === "glass" ? "rgba(255, 255, 255, 0.14)" : "transparent",
    effectiveBg: effectiveCanvasBg(brand, positionT),
    text,
    subtext: rgba(text, 0.8),
    separator:
      text === LIGHT_TEXT ? "rgba(255, 255, 255, 0.28)" : "rgba(28, 42, 51, 0.25)",
    accentBar: brand.accent,
  };
}
