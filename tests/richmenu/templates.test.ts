/**
 * Template geometry proofs: for EVERY template × size the cell boxes must
 * tile the canvas EXACTLY — full coverage, no overlaps, no gaps, integer
 * pixels, bounds inside the canvas — because the SAME boxes become both the
 * rendered cells and the LINE tap areas.
 */

import { describe, expect, it } from "vitest";

import {
  RICH_MENU_TEMPLATES,
  TEMPLATE_IDS,
  templateAreaBounds,
  getTemplate,
  type CellBox,
} from "../../src/richmenu/templates.js";

function overlaps(a: CellBox, b: CellBox): boolean {
  return (
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
  );
}

describe("rich menu templates — geometry", () => {
  it("ships the 8+ required templates across both sizes", () => {
    expect(TEMPLATE_IDS.length).toBeGreaterThanOrEqual(8);
    const large = TEMPLATE_IDS.filter((id) => RICH_MENU_TEMPLATES[id].size === "2500x1686");
    const compact = TEMPLATE_IDS.filter((id) => RICH_MENU_TEMPLATES[id].size === "2500x843");
    expect(large).toEqual(
      expect.arrayContaining(["grid_6", "grid_4", "hero_top_3", "hero_left_2", "split_2", "full_1"]),
    );
    expect(compact).toEqual(expect.arrayContaining(["compact_3", "compact_2", "compact_1"]));
  });

  for (const id of TEMPLATE_IDS) {
    const tpl = RICH_MENU_TEMPLATES[id];

    describe(`${id} (${tpl.size})`, () => {
      it("declares canvas dimensions matching its size tag", () => {
        const [w, h] = tpl.size.split("x").map(Number);
        expect(tpl.width).toBe(w);
        expect(tpl.height).toBe(h);
      });

      it("uses integer pixel boxes fully inside the canvas", () => {
        for (const c of tpl.cells) {
          expect(Number.isInteger(c.x)).toBe(true);
          expect(Number.isInteger(c.y)).toBe(true);
          expect(Number.isInteger(c.width)).toBe(true);
          expect(Number.isInteger(c.height)).toBe(true);
          expect(c.x).toBeGreaterThanOrEqual(0);
          expect(c.y).toBeGreaterThanOrEqual(0);
          expect(c.width).toBeGreaterThan(0);
          expect(c.height).toBeGreaterThan(0);
          expect(c.x + c.width).toBeLessThanOrEqual(tpl.width);
          expect(c.y + c.height).toBeLessThanOrEqual(tpl.height);
        }
      });

      it("has no overlapping cells", () => {
        for (let i = 0; i < tpl.cells.length; i++) {
          for (let j = i + 1; j < tpl.cells.length; j++) {
            expect(overlaps(tpl.cells[i]!, tpl.cells[j]!)).toBe(false);
          }
        }
      });

      it("covers the canvas exactly (no gaps) — area sum + point-in-exactly-one-cell", () => {
        const areaSum = tpl.cells.reduce((s, c) => s + c.width * c.height, 0);
        expect(areaSum).toBe(tpl.width * tpl.height);

        // Every sub-rectangle of the edge grid must be owned by exactly 1 cell.
        const xs = [...new Set(tpl.cells.flatMap((c) => [c.x, c.x + c.width]))].sort((a, b) => a - b);
        const ys = [...new Set(tpl.cells.flatMap((c) => [c.y, c.y + c.height]))].sort((a, b) => a - b);
        expect(xs[0]).toBe(0);
        expect(xs[xs.length - 1]).toBe(tpl.width);
        expect(ys[0]).toBe(0);
        expect(ys[ys.length - 1]).toBe(tpl.height);
        for (let i = 0; i + 1 < xs.length; i++) {
          for (let j = 0; j + 1 < ys.length; j++) {
            const px = (xs[i]! + xs[i + 1]!) / 2;
            const py = (ys[j]! + ys[j + 1]!) / 2;
            const owners = tpl.cells.filter(
              (c) => px >= c.x && px < c.x + c.width && py >= c.y && py < c.y + c.height,
            );
            expect(owners.length).toBe(1);
          }
        }
      });

      it("templateAreaBounds returns the same boxes as fresh copies (areas_count === cells)", () => {
        const bounds = templateAreaBounds(id);
        expect(bounds).toEqual(tpl.cells);
        expect(bounds.length).toBe(tpl.cells.length);
        // fresh objects — mutating the return must not corrupt the source
        bounds[0]!.x = 99999;
        expect(getTemplate(id).cells[0]!.x).not.toBe(99999);
      });
    });
  }
});
