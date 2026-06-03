/**
 * Unit tests for the template (Card Message) builder.
 *
 * Pure logic — no network. Verifies the four template subtypes and their LINE
 * limits: buttons ≤4 actions, confirm =2, carousel ≤10 columns with equal
 * action counts, image_carousel ≤10 columns, action label ≤20, text limits.
 */

import { describe, it, expect } from "vitest";

import {
  buildTemplateMessage,
  type TemplateActionInput,
} from "../src/line/template-builder.js";

const uri = (label: string): TemplateActionInput => ({ type: "uri", label, uri: "https://example.com" });
const msg = (label: string): TemplateActionInput => ({ type: "message", label, text: "t" });

describe("buildTemplateMessage — buttons", () => {
  it("builds a valid buttons template", () => {
    const m = buildTemplateMessage({ kind: "buttons", alt_text: "เมนู", text: "เลือกเลย", actions: [uri("เว็บ")] });
    expect(m.type).toBe("template");
    const t = m.template as Record<string, unknown>;
    expect(t.type).toBe("buttons");
    expect(t.text).toBe("เลือกเลย");
    expect(t.actions).toHaveLength(1);
  });

  it("includes title + thumbnailImageUrl when provided", () => {
    const m = buildTemplateMessage({
      kind: "buttons",
      alt_text: "x",
      title: "หัวข้อ",
      text: "y",
      thumbnail_image_url: "https://example.com/i.jpg",
      actions: [msg("a")],
    });
    const t = m.template as Record<string, unknown>;
    expect(t.title).toBe("หัวข้อ");
    expect(t.thumbnailImageUrl).toBe("https://example.com/i.jpg");
  });

  it("rejects more than 4 actions", () => {
    const actions = Array.from({ length: 5 }, (_, i) => msg(`b${i}`));
    expect(() => buildTemplateMessage({ kind: "buttons", alt_text: "x", text: "y", actions })).toThrow(/4 ปุ่ม/);
  });

  it("enforces 60-char text limit when a title is present", () => {
    expect(() =>
      buildTemplateMessage({ kind: "buttons", alt_text: "x", title: "หัว", text: "a".repeat(61), actions: [msg("a")] }),
    ).toThrow(/60/);
  });

  it("rejects empty actions", () => {
    expect(() => buildTemplateMessage({ kind: "buttons", alt_text: "x", text: "y", actions: [] })).toThrow(/actions/);
  });
});

describe("buildTemplateMessage — confirm", () => {
  it("builds a confirm with exactly 2 actions", () => {
    const m = buildTemplateMessage({
      kind: "confirm",
      alt_text: "ยืนยัน",
      text: "ตกลงไหม",
      actions: [msg("ใช่"), msg("ไม่")],
    });
    expect((m.template as Record<string, unknown>).type).toBe("confirm");
  });

  it("rejects != 2 actions", () => {
    expect(() => buildTemplateMessage({ kind: "confirm", alt_text: "x", text: "y", actions: [msg("a")] })).toThrow(/2 ปุ่ม/);
  });
});

describe("buildTemplateMessage — carousel", () => {
  const col = (text: string) => ({ text, actions: [uri("go")] });

  it("builds a carousel", () => {
    const m = buildTemplateMessage({ kind: "carousel", alt_text: "การ์ด", columns: [col("a"), col("b")] });
    const t = m.template as Record<string, unknown>;
    expect(t.type).toBe("carousel");
    expect(t.columns).toHaveLength(2);
  });

  it("rejects more than 10 columns", () => {
    const columns = Array.from({ length: 11 }, () => col("x"));
    expect(() => buildTemplateMessage({ kind: "carousel", alt_text: "x", columns })).toThrow(/10 columns/);
  });

  it("rejects columns with unequal action counts", () => {
    const c1 = { text: "a", actions: [uri("g")] };
    const c2 = { text: "b", actions: [uri("g"), uri("h")] };
    expect(() => buildTemplateMessage({ kind: "carousel", alt_text: "x", columns: [c1, c2] })).toThrow(/เท่ากัน/);
  });

  it("rejects more than 3 actions per column", () => {
    const c = { text: "a", actions: [uri("1"), uri("2"), uri("3"), uri("4")] };
    expect(() => buildTemplateMessage({ kind: "carousel", alt_text: "x", columns: [c] })).toThrow(/3/);
  });
});

describe("buildTemplateMessage — image_carousel", () => {
  it("builds an image_carousel", () => {
    const m = buildTemplateMessage({
      kind: "image_carousel",
      alt_text: "รูป",
      columns: [{ image_url: "https://example.com/1.jpg", action: uri("go") }],
    });
    expect((m.template as Record<string, unknown>).type).toBe("image_carousel");
  });

  it("rejects a non-https image_url", () => {
    expect(() =>
      buildTemplateMessage({
        kind: "image_carousel",
        alt_text: "x",
        columns: [{ image_url: "http://x/1.jpg", action: uri("g") }],
      }),
    ).toThrow(/HTTPS/);
  });

  it("rejects more than 10 columns", () => {
    const columns = Array.from({ length: 11 }, () => ({ image_url: "https://example.com/1.jpg", action: uri("g") }));
    expect(() => buildTemplateMessage({ kind: "image_carousel", alt_text: "x", columns })).toThrow(/10 columns/);
  });
});

describe("buildTemplateMessage — actions + alt_text", () => {
  it("rejects empty alt_text", () => {
    expect(() => buildTemplateMessage({ kind: "buttons", alt_text: "", text: "y", actions: [msg("a")] })).toThrow(/alt_text/);
  });

  it("rejects an action label over 20 chars", () => {
    expect(() =>
      buildTemplateMessage({ kind: "buttons", alt_text: "x", text: "y", actions: [uri("a".repeat(21))] }),
    ).toThrow(/20/);
  });

  it("maps a postback action with displayText", () => {
    const m = buildTemplateMessage({
      kind: "buttons",
      alt_text: "x",
      text: "y",
      actions: [{ type: "postback", label: "p", data: "action=buy", displayText: "ซื้อ" }],
    });
    const action = (m.template as { actions: Record<string, unknown>[] }).actions[0];
    expect(action?.type).toBe("postback");
    expect(action?.displayText).toBe("ซื้อ");
  });
});
