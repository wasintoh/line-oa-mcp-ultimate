/**
 * Unit tests for the imagemap (Rich Message) builder.
 *
 * Pure logic — no network. Verifies the 1040px base-width contract, area-bounds
 * validation, action mapping (uri/message), and the optional video block.
 */

import { describe, it, expect } from "vitest";

import { buildImagemapMessage, type ImagemapInput } from "../src/line/imagemap-builder.js";

const valid: ImagemapInput = {
  base_url: "https://cdn.example.com/rich/promo",
  alt_text: "โปรโมชั่นวันแม่",
  base_height: 1040,
  areas: [
    { bounds: { x: 0, y: 0, width: 520, height: 1040 }, action: { type: "uri", uri: "https://example.com/left" } },
    { bounds: { x: 520, y: 0, width: 520, height: 1040 }, action: { type: "message", text: "สนใจ" } },
  ],
};

describe("buildImagemapMessage — happy path", () => {
  it("builds a valid imagemap with width forced to 1040", () => {
    const m = buildImagemapMessage(valid);
    expect(m.type).toBe("imagemap");
    expect(m.baseSize.width).toBe(1040);
    expect(m.baseSize.height).toBe(1040);
    expect(m.baseUrl).toBe("https://cdn.example.com/rich/promo");
    expect(m.altText).toBe("โปรโมชั่นวันแม่");
    expect(m.actions).toHaveLength(2);
  });

  it("maps a uri action to linkUri + area", () => {
    const m = buildImagemapMessage(valid);
    const a0 = m.actions[0];
    expect(a0?.type).toBe("uri");
    expect(a0?.linkUri).toBe("https://example.com/left");
    expect(a0?.area).toEqual({ x: 0, y: 0, width: 520, height: 1040 });
  });

  it("maps a message action to text", () => {
    const m = buildImagemapMessage(valid);
    const a1 = m.actions[1];
    expect(a1?.type).toBe("message");
    expect(a1?.text).toBe("สนใจ");
  });

  it("omits video when not provided", () => {
    const m = buildImagemapMessage(valid);
    expect(m.video).toBeUndefined();
  });
});

describe("buildImagemapMessage — validation", () => {
  it("rejects a non-https base_url", () => {
    expect(() => buildImagemapMessage({ ...valid, base_url: "http://x.com/a" })).toThrow(/HTTPS/);
  });

  it("rejects base_url longer than 1000 chars", () => {
    expect(() => buildImagemapMessage({ ...valid, base_url: "https://x.com/" + "a".repeat(1000) })).toThrow(/1000/);
  });

  it("rejects empty alt_text", () => {
    expect(() => buildImagemapMessage({ ...valid, alt_text: "" })).toThrow(/alt_text/);
  });

  it("rejects alt_text over 400 chars", () => {
    expect(() => buildImagemapMessage({ ...valid, alt_text: "ก".repeat(401) })).toThrow(/400/);
  });

  it("rejects a non-positive base_height", () => {
    expect(() => buildImagemapMessage({ ...valid, base_height: 0 })).toThrow(/base_height/);
  });

  it("rejects a non-integer base_height", () => {
    expect(() => buildImagemapMessage({ ...valid, base_height: 10.5 })).toThrow(/base_height/);
  });

  it("rejects empty areas", () => {
    expect(() => buildImagemapMessage({ ...valid, areas: [] })).toThrow(/areas/);
  });

  it("rejects an area whose x+width exceeds 1040", () => {
    expect(() =>
      buildImagemapMessage({
        ...valid,
        areas: [{ bounds: { x: 600, y: 0, width: 500, height: 100 }, action: { type: "uri", uri: "https://x.com" } }],
      }),
    ).toThrow(/เกินขอบรูป/);
  });

  it("rejects an area whose y+height exceeds base_height", () => {
    expect(() =>
      buildImagemapMessage({
        ...valid,
        base_height: 500,
        areas: [{ bounds: { x: 0, y: 400, width: 100, height: 200 }, action: { type: "uri", uri: "https://x.com" } }],
      }),
    ).toThrow(/เกินขอบรูป/);
  });

  it("rejects non-integer bounds", () => {
    expect(() =>
      buildImagemapMessage({
        ...valid,
        areas: [{ bounds: { x: 0.5, y: 0, width: 100, height: 100 }, action: { type: "uri", uri: "https://x.com" } }],
      }),
    ).toThrow(/จำนวนเต็ม/);
  });

  it("rejects a uri action with an invalid url", () => {
    expect(() =>
      buildImagemapMessage({
        ...valid,
        areas: [{ bounds: { x: 0, y: 0, width: 10, height: 10 }, action: { type: "uri", uri: "not-a-url" } }],
      }),
    ).toThrow();
  });
});

describe("buildImagemapMessage — video block", () => {
  it("includes a video block with externalLink", () => {
    const m = buildImagemapMessage({
      ...valid,
      video: {
        original_content_url: "https://cdn.example.com/v.mp4",
        preview_image_url: "https://cdn.example.com/p.jpg",
        area: { x: 0, y: 0, width: 1040, height: 520 },
        external_link: { uri: "https://example.com/more", label: "ดูเพิ่มเติม" },
      },
    });
    expect(m.video?.originalContentUrl).toBe("https://cdn.example.com/v.mp4");
    expect(m.video?.externalLink?.linkUri).toBe("https://example.com/more");
    expect(m.video?.externalLink?.label).toBe("ดูเพิ่มเติม");
  });

  it("rejects a non-https video url", () => {
    expect(() =>
      buildImagemapMessage({
        ...valid,
        video: {
          original_content_url: "http://x/v.mp4",
          preview_image_url: "https://x/p.jpg",
          area: { x: 0, y: 0, width: 10, height: 10 },
        },
      }),
    ).toThrow(/HTTPS/);
  });
});
