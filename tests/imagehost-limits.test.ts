/**
 * Pixel-bomb guard regression tests (QC finding, reproduced live before the
 * fix): a tiny PNG can DECLARE enormous dimensions; without header-level caps
 * the 5 synchronous resvg renders freeze the event loop for tens of seconds
 * (or SIGABRT on multi-GB canvases). These tests forge the IHDR dimensions of
 * a real PNG and assert makeVariants rejects BEFORE any native decode —
 * instantly, with the actionable "input-too-large" reason.
 */

import { Resvg } from "@resvg/resvg-js";
import { describe, expect, it } from "vitest";

import { makeVariants, sniffImage } from "../src/imagehost/resize.js";
import { ImageHostError } from "../src/imagehost/types.js";

function tinyPng(): Buffer {
  return Buffer.from(
    new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#0f0"/></svg>')
      .render()
      .asPng(),
  );
}

/** Forge the declared IHDR width/height of a valid PNG (offsets 16 / 20, BE32). */
function forgeDimensions(png: Buffer, width: number, height: number): Buffer {
  const forged = Buffer.from(png);
  forged.writeUInt32BE(width, 16);
  forged.writeUInt32BE(height, 20);
  return forged;
}

describe("pixel-bomb guards", () => {
  it("rejects a huge declared side length instantly (18000×18000 froze the loop ~26s pre-fix)", async () => {
    const bomb = forgeDimensions(tinyPng(), 18_000, 18_000);
    expect(sniffImage(bomb)).toEqual({ format: "png", width: 18_000, height: 18_000 });
    const t0 = Date.now();
    await expect(makeVariants(bomb)).rejects.toMatchObject({ reason: "input-too-large" });
    expect(Date.now() - t0).toBeLessThan(500); // header check, no native decode
  });

  it("rejects total megapixels over the cap even when each side passes", async () => {
    // 11000×9000 = 99MP: sides < 12000 but total > 60MP.
    const bomb = forgeDimensions(tinyPng(), 11_000, 9_000);
    await expect(makeVariants(bomb)).rejects.toMatchObject({ reason: "input-too-large" });
  });

  it("rejects skinny images whose 1040-wide variant height explodes", async () => {
    // 200×4000 is only 0.8MP, but at width 1040 the height would be 20800px.
    const skinny = forgeDimensions(tinyPng(), 200, 4_000);
    await expect(makeVariants(skinny)).rejects.toMatchObject({ reason: "input-too-large" });
  });

  it("still accepts a normal large photo (4000×3000)", () => {
    // Guard must not over-reject: dimensions typical of phone photos pass the
    // header checks (no full render here — sniff + the same cap math).
    const photo = forgeDimensions(tinyPng(), 4_000, 3_000);
    const sniffed = sniffImage(photo);
    expect(sniffed).toEqual({ format: "png", width: 4_000, height: 3_000 });
  });

  it("error message tells the user what to do", async () => {
    const bomb = forgeDimensions(tinyPng(), 18_000, 18_000);
    await expect(makeVariants(bomb)).rejects.toThrow(/resize the source image/);
    await expect(makeVariants(bomb)).rejects.toBeInstanceOf(ImageHostError);
  });
});
