/**
 * Unit tests for src/imagehost/resize.ts (Image Hosting Layer v2.2).
 *
 * Also serves as the SPIKE PROOF for the layer's central bet: resvg-js
 * rasterizes raster <image> data URIs embedded in SVG — for BOTH PNG and
 * JPEG sources. Dimension checks alone cannot prove this (a failed decode
 * still yields a correctly-sized but fully transparent canvas), so we decode
 * output PNG pixels with a minimal reader and assert the center pixel keeps
 * the source color.
 *
 * PNG fixtures are generated at runtime by rendering a solid-rect SVG with
 * Resvg itself; the JPEG fixture is an embedded base64 constant (8x4 solid
 * red, baseline JFIF) — no binary fixtures on disk.
 */

import { inflateSync } from "node:zlib";

import { Resvg } from "@resvg/resvg-js";
import { describe, expect, it } from "vitest";

import { IMAGEMAP_SIZES } from "../src/constants.js";
import { makeVariants, sniffImage } from "../src/imagehost/resize.js";
import { ImageHostError } from "../src/imagehost/types.js";

// ---------------------------------------------------------------------------
// Fixtures & helpers
// ---------------------------------------------------------------------------

/** Render a solid-color rect SVG to PNG bytes — runtime PNG fixture factory. */
function makeSolidPng(width: number, height: number, fill = "#ff0000"): Buffer {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<rect width="${width}" height="${height}" fill="${fill}"/></svg>`;
  return Buffer.from(new Resvg(svg).render().asPng());
}

/**
 * Tiny valid baseline JPEG: 8x4 pixels, solid red (#ff0000), JFIF, 635 bytes.
 * Verified to decode with byte-exact dimensions and near-red pixels.
 */
const TINY_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAIBAQEBAQIBAQECAgICAgQDAgICAgUEBAMEBgUGBgYFBgYGBwkIBgcJBwYGCAsICQoKCgoKBggLDAsKDAkKCgr/2wBDAQICAgICAgUDAwUKBwYHCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgr/wAARCAAEAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD4vooor+Uz/fw//9k=";
const TINY_JPEG = Buffer.from(TINY_JPEG_BASE64, "base64");

/** Deterministic junk that matches neither the PNG nor the JPEG signature. */
const RANDOM_BYTES = Buffer.from(Array.from({ length: 256 }, (_, i) => (i * 37 + 11) & 0xff));

/**
 * Minimal PNG pixel reader — enough for resvg output (8-bit, non-interlaced).
 * Inflates IDAT with node:zlib and reverses scanline filters 0-4.
 */
function decodePng(buf: Buffer): { width: number; height: number; channels: number; pixels: Buffer } {
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const bitDepth = buf[24];
  const colorType = buf[25] as 0 | 2 | 4 | 6;
  const interlace = buf[28];
  if (bitDepth !== 8 || interlace !== 0) throw new Error("test decoder: unsupported PNG layout");
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error("test decoder: unsupported color type");

  const idats: Buffer[] = [];
  let off = 8;
  while (off + 12 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    if (type === "IDAT") idats.push(buf.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }

  const raw = inflateSync(Buffer.concat(idats));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    for (let x = 0; x < stride; x++) {
      const cur = raw[p++] ?? 0;
      const left = x >= channels ? (pixels[y * stride + x - channels] ?? 0) : 0;
      const up = y > 0 ? (pixels[(y - 1) * stride + x] ?? 0) : 0;
      const ul = y > 0 && x >= channels ? (pixels[(y - 1) * stride + x - channels] ?? 0) : 0;
      let val: number;
      switch (filter) {
        case 0:
          val = cur;
          break;
        case 1:
          val = cur + left;
          break;
        case 2:
          val = cur + up;
          break;
        case 3:
          val = cur + ((left + up) >> 1);
          break;
        case 4: {
          const pa = Math.abs(up - ul);
          const pb = Math.abs(left - ul);
          const pc = Math.abs(left + up - 2 * ul);
          val = cur + (pa <= pb && pa <= pc ? left : pb <= pc ? up : ul);
          break;
        }
        default:
          throw new Error(`test decoder: bad filter byte ${filter}`);
      }
      pixels[y * stride + x] = val & 0xff;
    }
  }
  return { width, height, channels, pixels };
}

/** RGBA of the center pixel (alpha defaults to 255 for alpha-less layouts). */
function centerPixel(png: Buffer): { r: number; g: number; b: number; a: number } {
  const { width, height, channels, pixels } = decodePng(png);
  const i = ((height >> 1) * width + (width >> 1)) * channels;
  if (channels === 4) {
    return { r: pixels[i] ?? 0, g: pixels[i + 1] ?? 0, b: pixels[i + 2] ?? 0, a: pixels[i + 3] ?? 0 };
  }
  if (channels === 3) {
    return { r: pixels[i] ?? 0, g: pixels[i + 1] ?? 0, b: pixels[i + 2] ?? 0, a: 255 };
  }
  const v = pixels[i] ?? 0;
  return { r: v, g: v, b: v, a: channels === 2 ? (pixels[i + 1] ?? 0) : 255 };
}

const expectedHeight = (origW: number, origH: number, W: number): number =>
  Math.max(1, Math.round((origH * W) / origW));

// ---------------------------------------------------------------------------
// sniffImage
// ---------------------------------------------------------------------------

describe("sniffImage", () => {
  it("reads PNG dimensions from IHDR", () => {
    const png = makeSolidPng(123, 45);
    expect(sniffImage(png)).toEqual({ format: "png", width: 123, height: 45 });
  });

  it("reads JPEG dimensions from the SOF marker", () => {
    expect(sniffImage(TINY_JPEG)).toEqual({ format: "jpeg", width: 8, height: 4 });
  });

  it("returns null (never throws) on non-image and truncated input", () => {
    expect(sniffImage(RANDOM_BYTES)).toBeNull();
    expect(sniffImage(Buffer.alloc(0))).toBeNull();
    expect(sniffImage(Buffer.from("definitely not an image"))).toBeNull();
    // PNG signature alone, no IHDR:
    expect(sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBeNull();
    // JPEG SOI alone, no SOF:
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
    // Truncated real PNG (cut inside IHDR):
    expect(sniffImage(makeSolidPng(10, 10).subarray(0, 20))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// makeVariants
// ---------------------------------------------------------------------------

describe("makeVariants — square 1200x1200 PNG", () => {
  it("produces all five variants at exact widths with square heights", async () => {
    const v = await makeVariants(makeSolidPng(1200, 1200));
    expect(v.sizes.size).toBe(IMAGEMAP_SIZES.length);
    for (const W of IMAGEMAP_SIZES) {
      const out = v.sizes.get(W);
      expect(out, `variant ${W} missing`).toBeDefined();
      expect(sniffImage(out as Buffer)).toEqual({ format: "png", width: W, height: W });
    }
    expect(v.baseWidth).toBe(1040);
    expect(v.baseHeight).toBe(1040);
    expect(v.sourceFormat).toBe("png");
    expect(v.warnings).toHaveLength(0); // 1200 >= 1040 — no upscale warning
  });

  it("SPIKE PROOF (PNG): embedded PNG data URIs are actually rasterized", async () => {
    const v = await makeVariants(makeSolidPng(1200, 1200, "#ff0000"));
    const px = centerPixel(v.sizes.get(240) as Buffer);
    // A failed embed renders fully transparent — this proves real decoding.
    expect(px.a).toBe(255);
    expect(px.r).toBeGreaterThanOrEqual(250);
    expect(px.g).toBeLessThanOrEqual(5);
    expect(px.b).toBeLessThanOrEqual(5);
  });
});

describe("makeVariants — non-square 1600x900 PNG", () => {
  it("keeps heights proportional to the 16:9 source", async () => {
    const v = await makeVariants(makeSolidPng(1600, 900));
    expect(sniffImage(v.sizes.get(1040) as Buffer)).toEqual({ format: "png", width: 1040, height: 585 });
    for (const W of IMAGEMAP_SIZES) {
      const H = expectedHeight(1600, 900, W);
      expect(sniffImage(v.sizes.get(W) as Buffer)).toEqual({ format: "png", width: W, height: H });
    }
    expect(v.baseHeight).toBe(585);
    expect(v.warnings).toHaveLength(0);
  });
});

describe("makeVariants — small 400x300 PNG (upscale path)", () => {
  it("still produces all five variants and warns about upscaling", async () => {
    const v = await makeVariants(makeSolidPng(400, 300));
    expect(v.sizes.size).toBe(IMAGEMAP_SIZES.length);
    for (const W of IMAGEMAP_SIZES) {
      const H = expectedHeight(400, 300, W);
      expect(sniffImage(v.sizes.get(W) as Buffer)).toEqual({ format: "png", width: W, height: H });
    }
    expect(v.baseHeight).toBe(780); // 300 * 1040 / 400
    expect(v.warnings).toContain(
      "source image is narrower than 1040px — upscaled for the imagemap base size",
    );
  });
});

describe("makeVariants — tiny JPEG source (the resvg JPEG spike)", () => {
  it("SPIKE PROOF (JPEG): decodes an embedded JPEG data URI into valid PNG variants", async () => {
    const v = await makeVariants(TINY_JPEG);
    expect(v.sourceFormat).toBe("jpeg");
    expect(v.sizes.size).toBe(IMAGEMAP_SIZES.length);
    for (const W of IMAGEMAP_SIZES) {
      // 8x4 source → every height is exactly W/2.
      expect(sniffImage(v.sizes.get(W) as Buffer)).toEqual({ format: "png", width: W, height: W / 2 });
    }
    expect(v.baseHeight).toBe(520);
    // 8px wide → the upscale warning must fire.
    expect(v.warnings).toContain(
      "source image is narrower than 1040px — upscaled for the imagemap base size",
    );

    // Pixel proof: the solid-red JPEG must survive into the output. If resvg
    // could not decode JPEG, the canvas would be fully transparent instead.
    const px = centerPixel(v.sizes.get(240) as Buffer);
    expect(px.a).toBe(255);
    expect(px.r).toBeGreaterThanOrEqual(200);
    expect(px.g).toBeLessThanOrEqual(60);
    expect(px.b).toBeLessThanOrEqual(60);
  });
});

describe("makeVariants — rejection", () => {
  it("throws ImageHostError(unsupported-image) for random bytes", async () => {
    await expect(makeVariants(RANDOM_BYTES)).rejects.toMatchObject({
      name: "ImageHostError",
      reason: "unsupported-image",
    });
    // And it is the real typed error class, not a lookalike.
    await makeVariants(RANDOM_BYTES).then(
      () => {
        throw new Error("expected makeVariants to reject");
      },
      (err: unknown) => {
        expect(err).toBeInstanceOf(ImageHostError);
        expect((err as ImageHostError).message).toMatch(/PNG or JPEG/);
      },
    );
  });
});
