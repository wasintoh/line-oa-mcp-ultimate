/**
 * Renderer integration tests — real satori→resvg renders (no network):
 * PNG signature + exact IHDR dimensions, Thai proof strings, font fallback
 * behavior, font_path override, and emoji-fetch-failure resilience.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { getTemplate } from "../../src/richmenu/templates.js";

const RENDER_TIMEOUT = 60_000;

// satori initializes its yoga WASM via fetch(data:) on first render — warm it
// up BEFORE any test stubs global fetch, so ordering can never corrupt it.
beforeAll(async () => {
  const { renderRichMenuPng } = await import("../../src/richmenu/renderer.js");
  await renderRichMenuPng({
    template: getTemplate("compact_1"),
    cells: [{ label: "warmup" }],
    brand: { font: "prompt" },
  });
}, RENDER_TIMEOUT);

const ASSET_FONTS = fileURLToPath(new URL("../../assets/fonts/", import.meta.url));

// Thai proof strings — สระอำ, stacked tone marks over upper vowels, ๊ ๆ ฯ.
const THAI_PROOF = [
  { label: "โปรโมชั่นพิเศษ", sublabel: "น้ำดื่มเย็นๆ" },
  { label: "สั่งซื้อ / ที่อยู่ร้าน" },
  { label: "กตัญญู", sublabel: "โต๊ะป้าน้ำ" },
  { label: "สะสมแต้ม" },
  { label: "ติดต่อร้าน" },
  { label: "โปรวันนี้" },
];

function pngSize(png: Buffer): { width: number; height: number } {
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A, then IHDR at fixed offset.
  expect(png.subarray(0, 8)).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  expect(png.toString("ascii", 12, 16)).toBe("IHDR");
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

async function loadRenderer() {
  return import("../../src/richmenu/renderer.js");
}

describe("rich menu renderer", () => {
  let savedHome: string | undefined;

  beforeEach(() => {
    // Point HOME at a temp dir so the LINE Seed cache never touches the real one.
    savedHome = process.env.HOME;
    process.env.HOME = mkdtempSync(join(tmpdir(), "rm-home-"));
  });

  afterEach(() => {
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
    vi.unstubAllGlobals();
  });

  it(
    "renders grid_6 large with Thai proof strings → valid 2500×1686 PNG",
    async () => {
      const { renderRichMenuPng } = await loadRenderer();
      const result = await renderRichMenuPng({
        template: getTemplate("grid_6"),
        cells: THAI_PROOF,
        brand: { primary: "#06C755", style: "gradient", font: "prompt" },
      });
      const size = pngSize(result.png);
      expect(size).toEqual({ width: 2500, height: 1686 });
      expect(result.width).toBe(2500);
      expect(result.height).toBe(1686);
      expect(result.bytes).toBe(result.png.length);
      expect(result.bytes).toBeGreaterThan(30_000); // non-trivial: gradient + 6 Thai labels
      expect(result.fontUsed).toBe("prompt");
      expect(result.warnings).toEqual([]);
    },
    RENDER_TIMEOUT,
  );

  it(
    "renders compact_3 → valid 2500×843 PNG",
    async () => {
      const { renderRichMenuPng } = await loadRenderer();
      const result = await renderRichMenuPng({
        template: getTemplate("compact_3"),
        cells: [{ label: "สั่งซื้อ" }, { label: "โปรโมชั่นพิเศษ" }, { label: "ที่อยู่ร้าน" }],
        brand: { font: "prompt", style: "solid" },
      });
      expect(pngSize(result.png)).toEqual({ width: 2500, height: 843 });
      expect(result.bytes).toBeGreaterThan(10_000);
    },
    RENDER_TIMEOUT,
  );

  it(
    'font: "noto" renders with Noto Sans Thai',
    async () => {
      const { renderRichMenuPng } = await loadRenderer();
      const result = await renderRichMenuPng({
        template: getTemplate("compact_1"),
        cells: [{ label: "น้ำดื่มเย็นๆ", sublabel: "กตัญญู" }],
        brand: { font: "noto" },
      });
      expect(result.fontUsed).toBe("noto");
      expect(pngSize(result.png)).toEqual({ width: 2500, height: 843 });
    },
    RENDER_TIMEOUT,
  );

  it(
    'font: "line-seed" falls back to Prompt (Thai warning) when the download fails',
    async () => {
      vi.stubGlobal("fetch", () => Promise.reject(new Error("offline test")));
      const { renderRichMenuPng } = await loadRenderer();
      const result = await renderRichMenuPng({
        template: getTemplate("compact_1"),
        cells: [{ label: "โปรโมชั่นพิเศษ" }],
        brand: { font: "line-seed" },
      });
      expect(result.fontUsed).toBe("prompt");
      expect(result.warnings.length).toBe(1);
      expect(result.warnings[0]).toContain("Prompt");
      expect(result.warnings[0]).toContain("ฟอนต์"); // Thai, centralized in TH
      expect(pngSize(result.png)).toEqual({ width: 2500, height: 843 });
    },
    RENDER_TIMEOUT,
  );

  it(
    "brand.font_path loads a specific font file directly (bundled Noto as stand-in)",
    async () => {
      const { renderRichMenuPng } = await loadRenderer();
      const result = await renderRichMenuPng({
        template: getTemplate("compact_1"),
        cells: [{ label: "โต๊ะป้าน้ำ" }],
        brand: { font_path: join(ASSET_FONTS, "NotoSansThai-Regular.ttf") },
      });
      // fontUsed reports the file's REAL internal family name.
      expect(result.fontUsed).toBe("Noto Sans Thai");
      expect(pngSize(result.png)).toEqual({ width: 2500, height: 843 });
    },
    RENDER_TIMEOUT,
  );

  it(
    "an unreadable font_path throws the Thai error",
    async () => {
      const { renderRichMenuPng } = await loadRenderer();
      await expect(
        renderRichMenuPng({
          template: getTemplate("compact_1"),
          cells: [{ label: "ทดสอบ" }],
          brand: { font_path: "/does/not/exist.ttf" },
        }),
      ).rejects.toThrow(/อ่านไฟล์ฟอนต์ไม่ได้/);
    },
    RENDER_TIMEOUT,
  );

  it(
    "emoji fetch failure skips the icon with a Thai warning — never breaks the render",
    async () => {
      vi.stubGlobal("fetch", () => Promise.reject(new Error("no cdn")));
      const { renderRichMenuPng, clearEmojiCache } = await loadRenderer();
      clearEmojiCache();
      const result = await renderRichMenuPng({
        template: getTemplate("compact_2"),
        cells: [
          { label: "สั่งซื้อ", icon_emoji: "☕" },
          { label: "ติดต่อร้าน" },
        ],
        brand: { font: "prompt" },
      });
      expect(pngSize(result.png)).toEqual({ width: 2500, height: 843 });
      expect(result.warnings.some((w) => w.includes("emoji"))).toBe(true);
    },
    RENDER_TIMEOUT,
  );
});
