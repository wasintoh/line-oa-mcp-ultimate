/**
 * Rich Menu Studio — template geometry (single source of truth).
 *
 * Every template defines its cell boxes in absolute canvas pixels. The SAME
 * boxes are used for (a) rendering the menu image and (b) the LINE tap areas
 * sent to POST /v2/bot/richmenu — image and areas can therefore never drift.
 *
 * This module is PURE DATA — no satori/resvg imports — so the tool layer can
 * statically import it for validation without paying any renderer cold-start
 * cost. The heavy renderer is lazy-loaded on first render only.
 *
 * All templates tile their canvas EXACTLY (no gaps, no overlaps, integer
 * pixels); `tests/richmenu/templates.test.ts` proves it for every template.
 */

export type RichMenuSize = "2500x1686" | "2500x843";

export interface CellBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Per-template type scale (px) + inner padding used by the renderer. */
export interface CellScale {
  label: number;
  sublabel: number;
  icon: number;
  padding: number;
}

export type TemplateId =
  | "grid_6"
  | "grid_4"
  | "hero_top_3"
  | "hero_left_2"
  | "split_2"
  | "full_1"
  | "compact_3"
  | "compact_2"
  | "compact_1";

export interface RichMenuTemplate {
  id: TemplateId;
  size: RichMenuSize;
  width: number;
  height: number;
  /** Cell boxes in reading order (left→right, top→bottom). */
  cells: CellBox[];
  /** Type scale for regular cells. */
  scale: CellScale;
  /** Optional hero treatment: which cell indexes get the larger hero scale. */
  hero?: { indexes: number[]; scale: CellScale };
  /** One-line English description (for the tool description / docs). */
  description: string;
}

export const LARGE_WIDTH = 2500;
export const LARGE_HEIGHT = 1686;
export const COMPACT_HEIGHT = 843;

// Column split for 3-across rows: 833 + 833 + 834 = 2500 (exact tiling).
const THIRDS = [833, 833, 834] as const;

function threeAcross(y: number, height: number): CellBox[] {
  const out: CellBox[] = [];
  let x = 0;
  for (const w of THIRDS) {
    out.push({ x, y, width: w, height });
    x += w;
  }
  return out;
}

// ---- shared type scales ----

const SCALE_SMALL_CELL: CellScale = { label: 92, sublabel: 54, icon: 150, padding: 48 }; // 833×843
const SCALE_MEDIUM_CELL: CellScale = { label: 108, sublabel: 60, icon: 170, padding: 56 }; // 1250×843
const SCALE_WIDE_HERO: CellScale = { label: 140, sublabel: 72, icon: 200, padding: 64 }; // 2500×843
const SCALE_TALL_HERO: CellScale = { label: 128, sublabel: 68, icon: 210, padding: 64 }; // 1250×1686
const SCALE_FULL: CellScale = { label: 168, sublabel: 84, icon: 260, padding: 96 }; // 2500×1686

export const RICH_MENU_TEMPLATES = {
  // ---- large 2500×1686 ----
  grid_6: {
    id: "grid_6",
    size: "2500x1686",
    width: LARGE_WIDTH,
    height: LARGE_HEIGHT,
    cells: [...threeAcross(0, 843), ...threeAcross(843, 843)],
    scale: SCALE_SMALL_CELL,
    description: "3×2 grid, 6 equal cells — the classic LINE OA menu",
  },
  grid_4: {
    id: "grid_4",
    size: "2500x1686",
    width: LARGE_WIDTH,
    height: LARGE_HEIGHT,
    cells: [
      { x: 0, y: 0, width: 1250, height: 843 },
      { x: 1250, y: 0, width: 1250, height: 843 },
      { x: 0, y: 843, width: 1250, height: 843 },
      { x: 1250, y: 843, width: 1250, height: 843 },
    ],
    scale: SCALE_MEDIUM_CELL,
    description: "2×2 grid, 4 large cells",
  },
  hero_top_3: {
    id: "hero_top_3",
    size: "2500x1686",
    width: LARGE_WIDTH,
    height: LARGE_HEIGHT,
    cells: [{ x: 0, y: 0, width: 2500, height: 843 }, ...threeAcross(843, 843)],
    scale: SCALE_SMALL_CELL,
    hero: { indexes: [0], scale: SCALE_WIDE_HERO },
    description: "full-width hero banner on top + 3 cells below",
  },
  hero_left_2: {
    id: "hero_left_2",
    size: "2500x1686",
    width: LARGE_WIDTH,
    height: LARGE_HEIGHT,
    cells: [
      { x: 0, y: 0, width: 1250, height: 1686 },
      { x: 1250, y: 0, width: 1250, height: 843 },
      { x: 1250, y: 843, width: 1250, height: 843 },
    ],
    scale: SCALE_MEDIUM_CELL,
    hero: { indexes: [0], scale: SCALE_TALL_HERO },
    description: "left-half hero + 2 stacked cells on the right",
  },
  split_2: {
    id: "split_2",
    size: "2500x1686",
    width: LARGE_WIDTH,
    height: LARGE_HEIGHT,
    cells: [
      { x: 0, y: 0, width: 1250, height: 1686 },
      { x: 1250, y: 0, width: 1250, height: 1686 },
    ],
    scale: SCALE_TALL_HERO,
    description: "two tall vertical halves",
  },
  full_1: {
    id: "full_1",
    size: "2500x1686",
    width: LARGE_WIDTH,
    height: LARGE_HEIGHT,
    cells: [{ x: 0, y: 0, width: 2500, height: 1686 }],
    scale: SCALE_FULL,
    description: "one full-canvas cell (single campaign banner)",
  },

  // ---- compact 2500×843 ----
  compact_3: {
    id: "compact_3",
    size: "2500x843",
    width: LARGE_WIDTH,
    height: COMPACT_HEIGHT,
    cells: threeAcross(0, COMPACT_HEIGHT),
    scale: SCALE_SMALL_CELL,
    description: "compact 1×3 row",
  },
  compact_2: {
    id: "compact_2",
    size: "2500x843",
    width: LARGE_WIDTH,
    height: COMPACT_HEIGHT,
    cells: [
      { x: 0, y: 0, width: 1250, height: 843 },
      { x: 1250, y: 0, width: 1250, height: 843 },
    ],
    scale: SCALE_MEDIUM_CELL,
    description: "compact 1×2 row",
  },
  compact_1: {
    id: "compact_1",
    size: "2500x843",
    width: LARGE_WIDTH,
    height: COMPACT_HEIGHT,
    cells: [{ x: 0, y: 0, width: 2500, height: 843 }],
    scale: SCALE_WIDE_HERO,
    description: "compact single full-width cell",
  },
} satisfies Record<TemplateId, RichMenuTemplate>;

export const TEMPLATE_IDS = Object.keys(RICH_MENU_TEMPLATES) as [TemplateId, ...TemplateId[]];

export function getTemplate(id: TemplateId): RichMenuTemplate {
  return RICH_MENU_TEMPLATES[id];
}

/**
 * LINE tap-area bounds for a template — the SAME cell boxes the renderer
 * paints. Returned as fresh objects so callers can't mutate the source.
 */
export function templateAreaBounds(id: TemplateId): CellBox[] {
  return RICH_MENU_TEMPLATES[id].cells.map((c) => ({ ...c }));
}
