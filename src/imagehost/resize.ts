/**
 * resize.ts — decodes a user-supplied PNG/JPEG and produces the five width
 * variants (1040/700/460/300/240) that LINE's imagemap contract requires,
 * re-encoding everything to PNG.
 *
 * NON-OBVIOUS CONSTRAINT: this module has NO raster codec of its own. It bets
 * on resvg-js' `raster-images` feature — the source bytes are embedded as a
 * base64 data URI inside an <image> element and resvg rasterizes them while
 * rendering the wrapper SVG. This works for both PNG and JPEG sources
 * (proven pixel-for-pixel in tests/imagehost-resize.test.ts); anything else
 * must be rejected up front by sniffImage, because resvg would silently
 * render a blank (fully transparent) canvas instead of failing.
 */

import { Resvg } from "@resvg/resvg-js";

import {
  IMAGEMAP_BASE_WIDTH,
  IMAGEMAP_SIZES,
  IMAGE_MAX_DIMENSION,
  IMAGE_MAX_PIXELS,
  IMAGE_MAX_VARIANT_HEIGHT,
} from "../constants.js";
import { ImageHostError, type ImageVariants } from "./types.js";

/** 8-byte PNG signature: \x89PNG\r\n\x1a\n */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Detect the container format and pixel dimensions of an image buffer.
 *
 * - PNG: validates the 8-byte signature, then reads IHDR width/height
 *   (big-endian u32 at byte offsets 16 and 20).
 * - JPEG: validates the FF D8 SOI, then walks marker segments until a
 *   SOF0/SOF1/SOF2 frame header (0xC0/0xC1/0xC2): height is BE16 at
 *   marker+5, width is BE16 at marker+7.
 *
 * Returns null for anything else — including truncated or zero-dimension
 * inputs. This function NEVER throws.
 */
export function sniffImage(buf: Buffer): { format: "png" | "jpeg"; width: number; height: number } | null {
  try {
    // ---- PNG ----
    if (buf.length >= 24 && buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
      // Sanity: the first chunk must be IHDR (its type sits at bytes 12..16).
      if (buf.toString("ascii", 12, 16) !== "IHDR") return null;
      const width = buf.readUInt32BE(16);
      const height = buf.readUInt32BE(20);
      if (width <= 0 || height <= 0) return null;
      return { format: "png", width, height };
    }

    // ---- JPEG ----
    if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      let off = 2;
      while (off + 4 <= buf.length) {
        if (buf[off] !== 0xff) return null; // lost marker sync — corrupt stream
        // Skip fill bytes (0xFF padding before a marker).
        let markerOff = off;
        while (markerOff + 1 < buf.length && buf[markerOff + 1] === 0xff) markerOff++;
        if (markerOff + 1 >= buf.length) return null;
        const marker = buf[markerOff + 1];
        // Standalone markers with no length field: TEM, RSTn, SOI, EOI.
        if (marker === 0x01 || (marker !== undefined && marker >= 0xd0 && marker <= 0xd7)) {
          off = markerOff + 2;
          continue;
        }
        if (marker === 0xd9) return null; // EOI before any SOF — no frame header
        if (marker === 0xda) return null; // SOS before SOF — cannot scan entropy data
        if (markerOff + 4 > buf.length) return null; // truncated: no room for length
        const segLen = buf.readUInt16BE(markerOff + 2);
        if (segLen < 2) return null;
        if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
          // SOF segment: FF Cx LL LL PP HH HH WW WW ...
          if (markerOff + 9 > buf.length) return null;
          const height = buf.readUInt16BE(markerOff + 5);
          const width = buf.readUInt16BE(markerOff + 7);
          if (width <= 0 || height <= 0) return null;
          return { format: "jpeg", width, height };
        }
        off = markerOff + 2 + segLen;
      }
      return null; // ran out of bytes before a SOF marker
    }

    return null;
  } catch {
    // Defensive: any unexpected read error means "not a supported image".
    return null;
  }
}

/**
 * Produce the five imagemap width variants as PNG buffers.
 *
 * The source is embedded as a data URI in a wrapper SVG sized W×H and
 * rendered with resvg (fitTo width = W), which both decodes and scales in a
 * single pass. Heights preserve the source aspect ratio, rounded, min 1px.
 *
 * Throws ImageHostError("unsupported-image") when the buffer is not a
 * decodable PNG/JPEG, and ImageHostError("input-invalid") if resvg rejects
 * bytes that sniffed fine (e.g. a valid header on a corrupt body).
 */
export async function makeVariants(buf: Buffer): Promise<ImageVariants> {
  const sniffed = sniffImage(buf);
  if (sniffed === null) {
    throw new ImageHostError("unsupported image format — need PNG or JPEG", "unsupported-image");
  }
  const { format, width: origW, height: origH } = sniffed;

  // ---- pixel-bomb guard (BEFORE any native decode) ----
  // Declared dimensions are independent of byte size: a <1MB PNG declaring
  // 18000×18000 blocked the event loop ~26s across the 5 synchronous resvg
  // renders (verified live), and taller ones abort the process. Dimensions
  // come from the header, so rejecting here costs nothing.
  if (origW > IMAGE_MAX_DIMENSION || origH > IMAGE_MAX_DIMENSION || origW * origH > IMAGE_MAX_PIXELS) {
    throw new ImageHostError(
      `image dimensions ${origW}×${origH} exceed the supported limit (max ${IMAGE_MAX_DIMENSION}px per side, ${IMAGE_MAX_PIXELS / 1_000_000}MP total) — resize the source image first`,
      "input-too-large",
    );
  }
  const tallestH = Math.round((origH * IMAGEMAP_BASE_WIDTH) / origW);
  if (tallestH > IMAGE_MAX_VARIANT_HEIGHT) {
    throw new ImageHostError(
      `image is too tall for an imagemap: at width 1040 the height would be ${tallestH}px (max ${IMAGE_MAX_VARIANT_HEIGHT}px) — crop the image first`,
      "input-too-large",
    );
  }

  const warnings: string[] = [];
  if (origW < IMAGEMAP_BASE_WIDTH) {
    warnings.push("source image is narrower than 1040px — upscaled for the imagemap base size");
  }

  const dataUri = `data:image/${format};base64,${buf.toString("base64")}`;
  const sizes = new Map<number, Buffer>();
  let baseHeight = 0;

  for (const W of IMAGEMAP_SIZES) {
    const H = Math.max(1, Math.round((origH * W) / origW));
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
      `<image href="${dataUri}" width="${W}" height="${H}"/></svg>`;
    let png: Buffer;
    try {
      png = new Resvg(svg, { fitTo: { mode: "width", value: W } }).render().asPng();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new ImageHostError(`failed to rasterize ${format} source at width ${W}: ${detail}`, "input-invalid");
    }
    sizes.set(W, Buffer.from(png));
    if (W === IMAGEMAP_BASE_WIDTH) baseHeight = H;
  }

  return {
    sizes,
    baseWidth: IMAGEMAP_BASE_WIDTH,
    baseHeight,
    sourceFormat: format,
    warnings,
  };
}
