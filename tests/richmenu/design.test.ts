/**
 * Design-system unit tests: hex parsing, luminance edge cases, and — most
 * importantly — the auto-contrast guarantee: label text is ALWAYS readable on
 * the cell's effective background, even for white-on-white attempts.
 */

import { describe, expect, it } from "vitest";

import {
  contrastRatio,
  DARK_TEXT,
  darken,
  DEFAULT_BRAND,
  LIGHT_TEXT,
  lighten,
  mix,
  paintForCell,
  parseHex,
  readableTextColor,
  relativeLuminance,
  resolveBrand,
  rgba,
  toHex,
} from "../../src/richmenu/design.js";

describe("parseHex", () => {
  it("parses #rrggbb", () => {
    expect(parseHex("#06C755")).toEqual({ r: 6, g: 199, b: 85 });
    expect(parseHex("#ffffff")).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("parses #rgb shorthand and missing #", () => {
    expect(parseHex("#fff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHex("0E6B54")).toEqual({ r: 14, g: 107, b: 84 });
  });

  it("rejects garbage", () => {
    expect(parseHex("#GGG")).toBeNull();
    expect(parseHex("#12345")).toBeNull();
    expect(parseHex("")).toBeNull();
    expect(parseHex("not-a-color")).toBeNull();
  });
});

describe("relativeLuminance / contrastRatio", () => {
  it("black is 0, white is 1", () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBe(0);
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5);
  });

  it("white vs black hits the max 21:1 ratio, symmetric", () => {
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 1);
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 1);
  });

  it("same color is 1:1; invalid inputs degrade to 1 (never NaN)", () => {
    expect(contrastRatio("#06C755", "#06C755")).toBe(1);
    expect(contrastRatio("nope", "#06C755")).toBe(1);
  });
});

describe("readableTextColor — the white-on-white guarantee", () => {
  it("white preferred on white background is overridden to dark", () => {
    expect(readableTextColor("#FFFFFF", "#FFFFFF")).toBe(DARK_TEXT);
  });

  it("near-same-tone preferred is overridden too", () => {
    expect(readableTextColor("#F4F4F4", "#FFFFFF")).toBe(DARK_TEXT);
    expect(readableTextColor("#101010", "#000000")).toBe(LIGHT_TEXT);
  });

  it("dark background → light text; light background → dark text", () => {
    expect(readableTextColor("#000000")).toBe(LIGHT_TEXT);
    expect(readableTextColor("#0E6B54")).toBe(LIGHT_TEXT);
    expect(readableTextColor("#FFFF00")).toBe(DARK_TEXT);
    expect(readableTextColor("#FFFFFF")).toBe(DARK_TEXT);
  });

  it("keeps a preferred color that clears the contrast bar", () => {
    expect(readableTextColor("#0E6B54", "#FFFFFF")).toBe("#FFFFFF");
    expect(readableTextColor("#FFFFFF", "#1C2A33")).toBe("#1C2A33");
  });
});

describe("color helpers", () => {
  it("mix endpoints and midpoint", () => {
    expect(mix("#000000", "#FFFFFF", 0)).toBe("#000000");
    expect(mix("#000000", "#FFFFFF", 1)).toBe("#FFFFFF");
    expect(mix("#000000", "#FFFFFF", 0.5)).toBe("#808080");
  });

  it("darken/lighten move luminance the right way", () => {
    const base = "#06C755";
    const darker = darken(base, 0.3);
    const lighter = lighten(base, 0.3);
    expect(relativeLuminance(parseHex(darker)!)).toBeLessThan(relativeLuminance(parseHex(base)!));
    expect(relativeLuminance(parseHex(lighter)!)).toBeGreaterThan(
      relativeLuminance(parseHex(base)!),
    );
  });

  it("toHex clamps and uppercases; rgba emits css", () => {
    expect(toHex({ r: 300, g: -5, b: 85.4 })).toBe("#FF0055");
    expect(rgba("#000000", 0.5)).toBe("rgba(0, 0, 0, 0.5)");
  });
});

describe("paintForCell — auto-contrast over every style", () => {
  const hostileBrands = [
    { primary: "#FFFFFF", accent: "#FFFFFF", text: "#FFFFFF" }, // white-on-white attempt
    { primary: "#000000", text: "#000000" }, // black-on-black attempt
    { primary: "#FFFF00", text: "#FFFFFF" }, // white on yellow
    { primary: "#06C755" },
    { primary: "#123456", accent: "#654321" },
    {}, // zero-config default
  ];
  const styles = ["solid", "gradient", "outline", "glass"] as const;

  for (const style of styles) {
    for (const kit of hostileBrands) {
      it(`style=${style} brand=${JSON.stringify(kit)} keeps label contrast ≥ 3`, () => {
        const brand = resolveBrand({ ...kit, style });
        for (const t of [0, 0.5, 1]) {
          const paint = paintForCell(brand, t);
          expect(contrastRatio(paint.text, paint.effectiveBg)).toBeGreaterThanOrEqual(3);
        }
      });
    }
  }

  it("explicit white cell bg + white brand text still yields readable dark text", () => {
    const brand = resolveBrand({ primary: "#06C755", text: "#FFFFFF", style: "solid" });
    const paint = paintForCell(brand, 0, "#FFFFFF");
    expect(paint.text).toBe(DARK_TEXT);
    expect(contrastRatio(paint.text, "#FFFFFF")).toBeGreaterThanOrEqual(3);
  });

  it("resolveBrand falls back to the default palette on invalid hex", () => {
    const brand = resolveBrand({ primary: "not-a-color", accent: "#zzz" });
    expect(brand.primary).toBe(DEFAULT_BRAND.primary);
    expect(brand.accent).toBe(DEFAULT_BRAND.accent);
  });
});
