/**
 * Rich Menu Studio — font resolution.
 *
 * Three built-in choices + one override:
 *   - "line-seed" (default): LINE Seed Sans TH — the typeface the LINE app
 *     itself uses, so menus look native. LICENSE: SIL OFL 1.1 per
 *     https://seed.line.me, but the official download zip ships NO license
 *     text file, so we do NOT redistribute it in this package. Instead we
 *     fetch the official zip from seed.line.me on first use and cache the two
 *     TTFs under ~/.line-mcp/fonts (dir mode 0700). ANY failure falls back to
 *     Prompt with a Thai warning — a font must never fail a render.
 *   - "prompt": Prompt (OFL, bundled in assets/fonts).
 *   - "noto": Noto Sans Thai (OFL, bundled in assets/fonts).
 *   - brand.font_path: an absolute .ttf/.otf path (the shop's own licensed
 *     font) — loaded directly, wins over `font`.
 *
 * The renderer needs fonts twice: as Buffers for satori (layout metrics) and
 * as file paths for resvg (rustybuzz does the actual Thai shaping). We also
 * parse each font's internal family name from its `name` table so the CSS
 * font-family always matches what resvg's font database sees.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { TH } from "../i18n/th.js";
import { extractZipEntries } from "./zip.js";
import type { BrandFont } from "./design.js";

export interface SatoriFontInput {
  name: string;
  data: Buffer;
  weight: 400 | 600 | 700;
  style: "normal";
}

export interface ResolvedFonts {
  /** Fonts for satori (layout metrics). Primary family first. */
  satoriFonts: SatoriFontInput[];
  /** Font file paths for resvg (rustybuzz shaping). */
  fontFiles: string[];
  /** CSS font-family stack (primary + Thai fallbacks). */
  fontFamily: string;
  /** resvg defaultFontFamily. */
  primaryFamily: string;
  /** What was ACTUALLY used: "line-seed" | "prompt" | "noto" | custom family name. */
  fontUsed: string;
  warnings: string[];
}

const ASSET_FONT_DIR = fileURLToPath(new URL("../../assets/fonts/", import.meta.url));

const LINE_SEED_ZIP_URL = "https://seed.line.me/src/images/fonts/LINE_Seed_Sans_TH.zip";
const LINE_SEED_FILES = ["LINESeedSansTH_Rg.ttf", "LINESeedSansTH_Bd.ttf"] as const;
const LINE_SEED_FETCH_TIMEOUT_MS = 30_000;

/**
 * Read the internal family name from a TTF/OTF `name` table (typographic
 * family, name ID 16, preferred over legacy ID 1). Returns null when the
 * table can't be parsed — callers must supply a fallback.
 */
export function fontFamilyName(buf: Buffer): string | null {
  try {
    const u16 = (o: number) => buf.readUInt16BE(o);
    const u32 = (o: number) => buf.readUInt32BE(o);
    let base = 0;
    if (u32(0) === 0x74746366 /* 'ttcf' */) base = u32(12);
    const numTables = u16(base + 4);
    let nameOffset = -1;
    for (let i = 0; i < numTables; i++) {
      const rec = base + 12 + i * 16;
      if (buf.toString("ascii", rec, rec + 4) === "name") {
        nameOffset = u32(rec + 8);
        break;
      }
    }
    if (nameOffset < 0) return null;
    const count = u16(nameOffset + 2);
    const stringsAt = nameOffset + u16(nameOffset + 4);
    let family: string | null = null;
    let typographic: string | null = null;
    for (let i = 0; i < count; i++) {
      const r = nameOffset + 6 + i * 12;
      const platform = u16(r);
      const nameId = u16(r + 6);
      const len = u16(r + 8);
      const off = u16(r + 10);
      if (nameId !== 1 && nameId !== 16) continue;
      let value: string | null = null;
      if (platform === 3 || platform === 0) {
        let s = "";
        for (let j = 0; j + 1 < len; j += 2) s += String.fromCharCode(u16(stringsAt + off + j));
        value = s;
      } else if (platform === 1) {
        value = buf.toString("latin1", stringsAt + off, stringsAt + off + len);
      }
      if (!value) continue;
      if (nameId === 16) typographic = typographic ?? value;
      else family = family ?? value;
    }
    return typographic ?? family;
  } catch {
    return null;
  }
}

function isFontFile(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  const tag = buf.readUInt32BE(0);
  return (
    tag === 0x00010000 || // TrueType
    tag === 0x4f54544f || // 'OTTO' (CFF)
    tag === 0x74727565 || // 'true'
    tag === 0x74746366 // 'ttcf'
  );
}

function lineSeedCacheDir(): string {
  return join(homedir(), ".line-mcp", "fonts");
}

/**
 * Get LINE Seed Sans TH (Regular + Bold): from the local cache when present,
 * otherwise download the official zip and cache the TTFs. Throws on ANY
 * failure — the caller catches and falls back to Prompt.
 */
async function ensureLineSeed(): Promise<{ regular: string; bold: string }> {
  const dir = lineSeedCacheDir();
  const regularPath = join(dir, LINE_SEED_FILES[0]);
  const boldPath = join(dir, LINE_SEED_FILES[1]);
  if (existsSync(regularPath) && existsSync(boldPath)) {
    // Sanity-check the cache — a corrupt file must not poison every render.
    if (isFontFile(readFileSync(regularPath)) && isFontFile(readFileSync(boldPath))) {
      return { regular: regularPath, bold: boldPath };
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LINE_SEED_FETCH_TIMEOUT_MS);
  let zip: Buffer;
  try {
    const res = await fetch(LINE_SEED_ZIP_URL, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    zip = Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }

  const entries = extractZipEntries(
    zip,
    (name) =>
      !name.startsWith("__MACOSX") &&
      name.includes("Desktop/TTF/") &&
      LINE_SEED_FILES.some((f) => name.endsWith(`/${f}`)),
  );
  const regular = [...entries.entries()].find(([n]) => n.endsWith(LINE_SEED_FILES[0]))?.[1];
  const bold = [...entries.entries()].find(([n]) => n.endsWith(LINE_SEED_FILES[1]))?.[1];
  if (!regular || !bold || !isFontFile(regular) || !isFontFile(bold)) {
    throw new Error("LINE Seed zip did not contain the expected TTF files");
  }

  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(regularPath, regular, { mode: 0o600 });
  writeFileSync(boldPath, bold, { mode: 0o600 });
  return { regular: regularPath, bold: boldPath };
}

function familyEntry(
  paths: { regular: string; semibold: string },
  fallbackName: string,
  semiboldWeight: 600 | 700 = 600,
): { name: string; fonts: SatoriFontInput[]; files: string[] } {
  const regular = readFileSync(paths.regular);
  const semibold = readFileSync(paths.semibold);
  const name = fontFamilyName(regular) ?? fallbackName;
  return {
    name,
    fonts: [
      { name, data: regular, weight: 400, style: "normal" },
      { name, data: semibold, weight: semiboldWeight, style: "normal" },
    ],
    files: [paths.regular, paths.semibold],
  };
}

function promptEntry() {
  return familyEntry(
    {
      regular: join(ASSET_FONT_DIR, "Prompt-Regular.ttf"),
      semibold: join(ASSET_FONT_DIR, "Prompt-SemiBold.ttf"),
    },
    "Prompt",
  );
}

function notoEntry() {
  return familyEntry(
    {
      regular: join(ASSET_FONT_DIR, "NotoSansThai-Regular.ttf"),
      semibold: join(ASSET_FONT_DIR, "NotoSansThai-SemiBold.ttf"),
    },
    "Noto Sans Thai",
  );
}

/**
 * Resolve the full font stack for a render.
 * Never throws for "line-seed" problems — falls back to Prompt with a Thai
 * warning. DOES throw for an unreadable `fontPath` (explicit user input).
 */
export async function resolveFonts(
  font: BrandFont | undefined,
  fontPath?: string,
): Promise<ResolvedFonts> {
  const warnings: string[] = [];

  // 1 — explicit font file wins
  if (fontPath) {
    let data: Buffer;
    try {
      data = readFileSync(fontPath);
    } catch {
      throw new Error(TH.rmFontPathUnreadable(fontPath));
    }
    if (!isFontFile(data)) {
      throw new Error(TH.rmFontPathUnreadable(fontPath));
    }
    const name = fontFamilyName(data) ?? "Custom Font";
    const noto = notoEntry();
    const prompt = promptEntry();
    return {
      satoriFonts: [
        { name, data, weight: 400, style: "normal" },
        { name, data, weight: 600, style: "normal" },
        ...noto.fonts,
        ...prompt.fonts,
      ],
      fontFiles: [fontPath, ...noto.files, ...prompt.files],
      fontFamily: [name, noto.name, prompt.name].join(", "),
      primaryFamily: name,
      fontUsed: name,
      warnings,
    };
  }

  const choice = font ?? "line-seed";

  if (choice === "line-seed") {
    try {
      const seed = await ensureLineSeed();
      const seedEntry = familyEntry(
        { regular: seed.regular, semibold: seed.bold },
        "LINE Seed Sans TH",
        600, // register Bold at weight 600 so fontWeight:600 in styles picks it
      );
      const noto = notoEntry();
      const prompt = promptEntry();
      return {
        satoriFonts: [...seedEntry.fonts, ...noto.fonts, ...prompt.fonts],
        fontFiles: [...seedEntry.files, ...noto.files, ...prompt.files],
        fontFamily: [seedEntry.name, noto.name, prompt.name].join(", "),
        primaryFamily: seedEntry.name,
        fontUsed: "line-seed",
        warnings,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(TH.rmFontFallback(msg));
      // fall through to Prompt
    }
  }

  if (choice === "noto") {
    const noto = notoEntry();
    const prompt = promptEntry();
    return {
      satoriFonts: [...noto.fonts, ...prompt.fonts],
      fontFiles: [...noto.files, ...prompt.files],
      fontFamily: [noto.name, prompt.name].join(", "),
      primaryFamily: noto.name,
      fontUsed: "noto",
      warnings,
    };
  }

  // "prompt" or line-seed fallback
  const prompt = promptEntry();
  const noto = notoEntry();
  return {
    satoriFonts: [...prompt.fonts, ...noto.fonts],
    fontFiles: [...prompt.files, ...noto.files],
    fontFamily: [prompt.name, noto.name].join(", "),
    primaryFamily: prompt.name,
    fontUsed: "prompt",
    warnings,
  };
}
