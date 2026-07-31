/**
 * Tests for the zip writer + handoff provider (v2.2 Image Hosting Layer).
 *
 * The zip writer is validated by round-tripping through the EXISTING reader
 * (src/richmenu/zip.ts) — two independent implementations agreeing on the
 * container format is the strongest dependency-free check we have.
 */

import { existsSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, it, expect, afterAll } from "vitest";

import { buildZip } from "../src/imagehost/zip-writer.js";
import { extractZipEntries } from "../src/richmenu/zip.js";
import { HandoffHost } from "../src/imagehost/providers/handoff.js";
import { ImageHostError, type ImageVariants } from "../src/imagehost/types.js";
import { IMAGEMAP_SIZES } from "../src/constants.js";

// 8-byte PNG signature — embedded at the start of every fake image buffer so
// the payloads look like real PNGs to any magic-byte sniffing downstream.
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function fakePng(seed: number): Buffer {
  const body = Buffer.alloc(64);
  for (let i = 0; i < body.length; i++) body[i] = (i * 31 + seed * 7) % 256;
  return Buffer.concat([PNG_SIG, body]);
}

/** ImageVariants built by hand — the resize pipeline is NOT under test here. */
function makeVariants(): ImageVariants {
  const sizes = new Map<number, Buffer>();
  for (const size of IMAGEMAP_SIZES) sizes.set(size, fakePng(size));
  return { sizes, baseWidth: 1040, baseHeight: 700, sourceFormat: "png", warnings: [] };
}

function zipEntriesFrom(variants: ImageVariants): { name: string; data: Buffer }[] {
  return IMAGEMAP_SIZES.map((size) => ({ name: String(size), data: variants.sizes.get(size)! }));
}

describe("buildZip — round-trip through the existing reader", () => {
  it("extracts exactly the 5 size-named entries with byte-identical data", () => {
    const variants = makeVariants();
    const zip = buildZip(zipEntriesFrom(variants));

    const extracted = extractZipEntries(zip, () => true);
    expect([...extracted.keys()].sort()).toEqual(["1040", "700", "460", "300", "240"].sort());

    for (const size of IMAGEMAP_SIZES) {
      const original = variants.sizes.get(size)!;
      const roundTripped = extracted.get(String(size))!;
      expect(roundTripped.equals(original)).toBe(true);
      // And each payload still starts with the PNG signature.
      expect(roundTripped.subarray(0, 8).equals(PNG_SIG)).toBe(true);
    }
  });

  it("honours the wanted() filter of the reader", () => {
    const zip = buildZip(zipEntriesFrom(makeVariants()));
    const only1040 = extractZipEntries(zip, (name) => name === "1040");
    expect([...only1040.keys()]).toEqual(["1040"]);
  });

  it("throws ImageHostError on an empty entry list", () => {
    expect(() => buildZip([])).toThrow(ImageHostError);
    expect(() => buildZip([])).toThrow(/empty/);
  });

  it("throws ImageHostError on an empty entry name", () => {
    expect(() => buildZip([{ name: "", data: fakePng(1) }])).toThrow(ImageHostError);
  });

  it("still extracts bytes after a data-region byte flip (reader does not CRC-check)", () => {
    const variants = makeVariants();
    const entries = zipEntriesFrom(variants);
    const zip = buildZip(entries);

    // First entry layout: 30-byte local header + 4-byte name "1040", so its
    // data region starts at offset 34. Flip a byte well inside the payload.
    const corruptAt = 34 + 20;
    const corrupted = Buffer.from(zip);
    corrupted[corruptAt] = corrupted[corruptAt]! ^ 0xff;

    const extracted = extractZipEntries(corrupted, () => true);
    expect(extracted.size).toBe(5);
    const first = extracted.get("1040")!;
    expect(first.length).toBe(variants.sizes.get(1040)!.length);
    // The flipped byte comes back flipped — proof the reader returns raw bytes.
    expect(first.equals(variants.sizes.get(1040)!)).toBe(false);
    // All other entries are untouched.
    expect(extracted.get("700")!.equals(variants.sizes.get(700)!)).toBe(true);
  });

  it("is deterministic — two builds of the same input are byte-identical", () => {
    const entries = zipEntriesFrom(makeVariants());
    const a = buildZip(entries);
    const b = buildZip(entries);
    expect(a.equals(b)).toBe(true);
  });
});

describe("HandoffHost", () => {
  const key = `test-handoff-${process.pid}-${Date.now()}`;
  // Dir name is per-uid on POSIX (multi-user /tmp EACCES guard in handoff.ts).
  const uid = typeof process.getuid === "function" ? `-${process.getuid()}` : "";
  const expectedZipPath = path.join(os.tmpdir(), `line-oa-imagehost${uid}`, `${key}.zip`);

  afterAll(() => {
    rmSync(expectedZipPath, { force: true });
  });

  it("has the frozen provider identity", async () => {
    const host = new HandoffHost();
    expect(host.id).toBe("handoff");
    expect(host.supportsImagemap).toBe(true);
    await expect(host.isAvailable()).resolves.toBe(true);
  });

  it("put() writes a real zip to tmpdir and returns the handoff package", async () => {
    const variants = makeVariants();
    const result = await new HandoffHost().put(variants, key);

    expect(result.kind).toBe("handoff");
    expect(result.providerId).toBe("handoff");
    expect(result.warnings).toEqual([]);

    const handoff = result.handoff!;
    expect(handoff.zipPath).toBe(expectedZipPath);
    expect(handoff.fileNames).toEqual(["1040", "700", "460", "300", "240"]);
    expect(existsSync(handoff.zipPath)).toBe(true);

    // The written file round-trips through the existing reader.
    const extracted = extractZipEntries(readFileSync(handoff.zipPath), () => true);
    expect(extracted.size).toBe(5);
    for (const size of IMAGEMAP_SIZES) {
      expect(extracted.get(String(size))!.equals(variants.sizes.get(size)!)).toBe(true);
    }
  });

  it("stepsTh contains the three manual routes (LINE OA Manager, Netlify Drop, GitHub Pages)", async () => {
    const result = await new HandoffHost().put(makeVariants(), key);
    const steps = result.handoff!.stepsTh;

    expect(steps.length).toBeGreaterThanOrEqual(3);
    const joined = steps.join("\n");
    expect(joined).toContain("manager.line.biz");
    expect(joined).toContain("app.netlify.com/drop");
    expect(joined).toContain("GitHub");
    expect(joined).toContain("base_url");
    expect(joined).toContain("line_design_imagemap");
    // The zip path is surfaced so the user can find the file.
    expect(joined).toContain(result.handoff!.zipPath);
  });

  it("put() fails loudly when a size variant is missing", async () => {
    const variants = makeVariants();
    variants.sizes.delete(460);
    await expect(new HandoffHost().put(variants, `${key}-broken`)).rejects.toThrow(ImageHostError);
    await expect(new HandoffHost().put(variants, `${key}-broken`)).rejects.toThrow(/460/);
  });
});
