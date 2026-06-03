/**
 * Unit tests for the bulk-chunk helper used by line_link_rich_menu.
 *
 * The 500-id boundary is the highest-risk arithmetic in the v2 rich-menu tools
 * (LINE rejects > 500 user IDs per bulk link/unlink call), so it gets explicit
 * boundary coverage.
 */

import { describe, it, expect } from "vitest";

import { chunk } from "../src/tools/link-rich-menu.js";

const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `U${i}`);

describe("chunk — LINE bulk 500 boundary", () => {
  it("500 ids → exactly 1 chunk of 500", () => {
    const c = chunk(ids(500), 500);
    expect(c).toHaveLength(1);
    expect(c[0]).toHaveLength(500);
  });

  it("501 ids → 2 chunks [500, 1]", () => {
    const c = chunk(ids(501), 500);
    expect(c).toHaveLength(2);
    expect(c[0]).toHaveLength(500);
    expect(c[1]).toHaveLength(1);
  });

  it("1000 ids → 2 chunks of 500", () => {
    expect(chunk(ids(1000), 500).map((x) => x.length)).toEqual([500, 500]);
  });

  it("under the limit → 1 chunk", () => {
    expect(chunk(ids(3), 500)).toHaveLength(1);
  });

  it("empty array → no chunks", () => {
    expect(chunk(ids(0), 500)).toHaveLength(0);
  });

  it("preserves order and completeness across chunks", () => {
    const flat = chunk(ids(750), 500).flat();
    expect(flat).toHaveLength(750);
    expect(flat[0]).toBe("U0");
    expect(flat[749]).toBe("U749");
  });
});
