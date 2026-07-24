/**
 * line_design_rich_menu_image end-to-end through the REAL MCP surface
 * (createTestMcp) + fetch mock: preview returns a decodable PNG image block,
 * deploy sends EXACT template-geometry areas + binary upload, cleans up the
 * orphaned menu when upload fails, and handles alias conflicts by updating.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { installFetchMock, type FetchMock } from "../helpers/fetch-mock.js";
import { isolateConfigEnv, useSingleOaEnv } from "../helpers/env.js";
import { createTestMcp, firstText, type TestMcp } from "../helpers/mcp.js";
import { getTemplate, templateAreaBounds } from "../../src/richmenu/templates.js";

const RENDER_TIMEOUT = 60_000;

// satori initializes its yoga WASM via fetch(data:) on first render — warm it
// up BEFORE the fetch mock is installed so the mock never corrupts the wasm.
beforeAll(async () => {
  const { renderRichMenuPng } = await import("../../src/richmenu/renderer.js");
  await renderRichMenuPng({
    template: getTemplate("compact_1"),
    cells: [{ label: "warmup" }],
    brand: { font: "prompt" },
  });
}, RENDER_TIMEOUT);

const SIX_CELLS = [
  { label: "สั่งซื้อ", action: { type: "uri", uri: "https://shop.line.me/@cafe" } },
  { label: "โปรโมชั่นพิเศษ", action: { type: "message", text: "ขอดูโปร" } },
  { label: "สะสมแต้ม", action: { type: "postback", data: "points", display_text: "ดูแต้ม" } },
  { label: "น้ำดื่มเย็นๆ", action: { type: "message", text: "เมนูน้ำ" } },
  { label: "ที่อยู่ร้าน", action: { type: "message", text: "ร้านอยู่ไหน" } },
  { label: "ติดต่อร้าน", action: { type: "uri", uri: "https://lin.ee/contact" } },
] as const;

const EXPECTED_AREAS = templateAreaBounds("grid_6").map((bounds, i) => ({
  bounds,
  action: [
    { type: "uri", uri: "https://shop.line.me/@cafe" },
    { type: "message", text: "ขอดูโปร" },
    { type: "postback", data: "points", displayText: "ดูแต้ม" },
    { type: "message", text: "เมนูน้ำ" },
    { type: "message", text: "ร้านอยู่ไหน" },
    { type: "uri", uri: "https://lin.ee/contact" },
  ][i],
}));

function expectPng(buf: Buffer, width: number, height: number): void {
  expect(buf.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  expect(buf.readUInt32BE(16)).toBe(width);
  expect(buf.readUInt32BE(20)).toBe(height);
}

describe("line_design_rich_menu_image (e2e)", () => {
  let restoreEnv: () => void;
  let api: FetchMock;
  let mcp: TestMcp;

  beforeEach(async () => {
    restoreEnv = isolateConfigEnv();
    useSingleOaEnv("richmenu-test-token");
    api = installFetchMock();
    mcp = await createTestMcp();
  });

  afterEach(async () => {
    await mcp.close();
    api.uninstall();
    restoreEnv();
  });

  it(
    "preview returns an image content block whose base64 decodes to a 2500×1686 PNG",
    async () => {
      const result = await mcp.callTool("line_design_rich_menu_image", {
        template: "grid_6",
        cells: SIX_CELLS.map(({ label }) => ({ label })),
        brand: { primary: "#06C755", font: "prompt" },
      });
      expect(result.isError).toBeFalsy();
      const image = result.content?.find((c) => c.type === "image") as
        | { type: string; data?: string; mimeType?: string }
        | undefined;
      expect(image).toBeDefined();
      expect(image?.mimeType).toBe("image/png");
      expectPng(Buffer.from(image?.data ?? "", "base64"), 2500, 1686);

      expect(result.structuredContent?.mode).toBe("preview");
      expect(result.structuredContent?.width).toBe(2500);
      expect(result.structuredContent?.height).toBe(1686);
      expect(result.structuredContent?.font_used).toBe("prompt");
      // no LINE API calls in preview mode
      expect(api.callsTo("/v2/bot/richmenu")).toHaveLength(0);
    },
    RENDER_TIMEOUT,
  );

  it(
    "default font (line-seed) degrades to Prompt with a Thai warning when the CDN is mocked away",
    async () => {
      // Point HOME at an empty temp dir — a previously cached LINE Seed on
      // this machine must not defeat the offline-degradation scenario.
      // (isolateConfigEnv snapshots HOME; restoreEnv puts it back.)
      const { mkdtempSync } = await import("node:fs");
      const { tmpdir } = await import("node:os");
      const { join } = await import("node:path");
      process.env.HOME = mkdtempSync(join(tmpdir(), "rm-nofonts-"));

      const result = await mcp.callTool("line_design_rich_menu_image", {
        template: "compact_1",
        cells: [{ label: "โปรโมชั่นพิเศษ" }],
      });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent?.font_used).toBe("prompt");
      const warnings = result.structuredContent?.warnings as string[];
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain("ฟอนต์");
    },
    RENDER_TIMEOUT,
  );

  it(
    "deploy: creates with EXACT template-geometry areas, uploads binary PNG, sets default + alias",
    async () => {
      api.on("/content", {}, { method: "POST" });
      api.on("/v2/bot/richmenu", { body: { richMenuId: "richmenu-123" } }, { method: "POST" });

      const result = await mcp.callTool("line_design_rich_menu_image", {
        template: "grid_6",
        cells: SIX_CELLS.map((c) => ({ ...c })),
        brand: { primary: "#06C755", style: "solid", font: "prompt" },
        chat_bar_text: "เมนูร้าน",
        mode: "deploy",
        deploy: { name: "เมนูหลัก ร้านกาแฟ", set_default: true, alias: "main" },
      });
      expect(result.isError).toBeFalsy();

      // 1 — create body carries the EXACT areas derived from templates.ts
      const create = api.calls.find(
        (c) => c.url.pathname === "/v2/bot/richmenu" && c.method === "POST",
      );
      expect(create?.body).toEqual({
        size: { width: 2500, height: 1686 },
        selected: false,
        name: "เมนูหลัก ร้านกาแฟ",
        chatBarText: "เมนูร้าน",
        areas: EXPECTED_AREAS,
      });
      expect(create?.headers.authorization).toBe("Bearer richmenu-test-token");

      // 2 — upload got the raw PNG bytes on the api-data domain
      const upload = api.callsTo("/v2/bot/richmenu/richmenu-123/content")[0];
      expect(upload).toBeDefined();
      expect(upload?.url.hostname).toBe("api-data.line.me");
      expect(upload?.headers["content-type"]).toBe("image/png");
      expectPng(Buffer.from(upload?.rawBody as Buffer), 2500, 1686);

      // 3 — default + alias
      expect(api.callsTo("/v2/bot/user/all/richmenu/richmenu-123")).toHaveLength(1);
      const aliasCreate = api.calls.find(
        (c) => c.url.pathname === "/v2/bot/richmenu/alias" && c.method === "POST",
      );
      expect(aliasCreate?.body).toEqual({ richMenuAliasId: "main", richMenuId: "richmenu-123" });

      // 4 — nothing deleted, structured output complete
      expect(api.calls.filter((c) => c.method === "DELETE")).toHaveLength(0);
      expect(result.structuredContent).toMatchObject({
        mode: "deploy",
        rich_menu_id: "richmenu-123",
        set_default: true,
        alias: "main",
        areas_count: 6,
      });
      expect(result.structuredContent?.image_bytes).toBeGreaterThan(10_000);
    },
    RENDER_TIMEOUT,
  );

  it(
    "deploy: upload failure deletes the orphaned menu and surfaces a Thai error",
    async () => {
      api.on("/content", { status: 400, body: { message: "invalid image" } }, { method: "POST" });
      api.on("/v2/bot/richmenu", { body: { richMenuId: "richmenu-999" } }, { method: "POST" });

      const result = await mcp.callTool("line_design_rich_menu_image", {
        template: "compact_2",
        cells: [
          { label: "สั่งซื้อ", action: { type: "message", text: "สั่ง" } },
          { label: "ติดต่อร้าน", action: { type: "message", text: "ติดต่อ" } },
        ],
        brand: { font: "prompt" },
        mode: "deploy",
        deploy: { name: "ทดสอบ" },
      });
      expect(result.isError).toBe(true);
      const deletes = api.calls.filter(
        (c) => c.method === "DELETE" && c.url.pathname === "/v2/bot/richmenu/richmenu-999",
      );
      expect(deletes).toHaveLength(1);
      const text = firstText(result);
      expect(text).toContain("ลบ Rich Menu ที่สร้างค้างไว้"); // Thai cleanup message
    },
    RENDER_TIMEOUT,
  );

  it(
    "deploy: alias conflict (400 conflict) falls back to alias UPDATE",
    async () => {
      api.on("/v2/bot/richmenu/alias/main", {}, { method: "POST" });
      api.on(
        "/v2/bot/richmenu/alias",
        { status: 400, body: { message: "conflict richmenu alias id" } },
        { method: "POST" },
      );
      api.on("/content", {}, { method: "POST" });
      api.on("/v2/bot/richmenu", { body: { richMenuId: "richmenu-777" } }, { method: "POST" });

      const result = await mcp.callTool("line_design_rich_menu_image", {
        template: "compact_1",
        cells: [{ label: "เมนูเดียว", action: { type: "message", text: "กด" } }],
        brand: { font: "prompt" },
        mode: "deploy",
        deploy: { name: "alias-conflict", alias: "main" },
      });
      expect(result.isError).toBeFalsy();
      const updates = api.callsTo("/v2/bot/richmenu/alias/main");
      expect(updates).toHaveLength(1);
      expect(updates[0]?.body).toEqual({ richMenuId: "richmenu-777" });
      expect(result.structuredContent?.alias).toBe("main");
      // conflict was recovered — menu must NOT have been deleted
      expect(api.calls.filter((c) => c.method === "DELETE")).toHaveLength(0);
    },
    RENDER_TIMEOUT,
  );

  it("rejects a cell-count mismatch with a Thai error (no render, no API calls)", async () => {
    const result = await mcp.callTool("line_design_rich_menu_image", {
      template: "grid_6",
      cells: [{ label: "น้อยไป" }],
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("ต้องมี 6 cells");
    expect(api.calls).toHaveLength(0);
  });

  it("rejects deploy when any cell lacks an action (Thai error)", async () => {
    const result = await mcp.callTool("line_design_rich_menu_image", {
      template: "compact_2",
      cells: [{ label: "มี action", action: { type: "message", text: "ok" } }, { label: "ไม่มี" }],
      mode: "deploy",
      deploy: { name: "x" },
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("ยังไม่มี action");
  });

  it("rejects a size/template contradiction with a Thai error", async () => {
    const result = await mcp.callTool("line_design_rich_menu_image", {
      template: "compact_3",
      size: "2500x1686",
      cells: [{ label: "a" }, { label: "b" }, { label: "c" }],
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("2500x843");
  });

  it("rejects deploy without a deploy config (Thai error)", async () => {
    const result = await mcp.callTool("line_design_rich_menu_image", {
      template: "compact_1",
      cells: [{ label: "เมนู", action: { type: "message", text: "กด" } }],
      mode: "deploy",
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain('mode="deploy"');
  });
});
