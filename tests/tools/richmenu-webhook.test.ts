/**
 * Group: Rich-menu + webhook + LIFF + token tools.
 *
 * Exercises the twelve tools through the REAL MCP surface (createTestMcp) with
 * every LINE call intercepted by the fetch mock. Each tool gets:
 *   (a) a happy path hitting the EXACT LINE endpoint/method/body + sane
 *       structuredContent,
 *   (b) a schema rejection (InvalidParams / inline input error, zero network),
 *   (c) a LINE API error (401 / 400-with-details / 404) surfaced in Thai,
 * plus extra cases where the tool has real branching (modes, chunking,
 * confirm gates, SSRF + orphan cleanup).
 *
 * node:dns/promises is mocked so the SSRF guard resolves "public" hostnames
 * deterministically (needed by line_build_rich_menu's image download).
 * Fetch-mock routing is SUBSTRING based — register the more specific path
 * (e.g. "/content") BEFORE the broader one ("/v2/bot/richmenu").
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: lookupMock }));

import { TH } from "../../src/i18n/th.js";
import { installFetchMock, type FetchMock } from "../helpers/fetch-mock.js";
import { isolateConfigEnv, useSingleOaEnv } from "../helpers/env.js";
import { createTestMcp, firstText, type TestMcp } from "../helpers/mcp.js";

let restoreEnv: () => void;
let api: FetchMock;
let mcp: TestMcp;

beforeEach(async () => {
  lookupMock.mockReset();
  lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  restoreEnv = isolateConfigEnv();
  useSingleOaEnv("rmw-token");
  api = installFetchMock();
  mcp = await createTestMcp();
});

afterEach(async () => {
  await mcp.close();
  api.uninstall();
  restoreEnv();
});

/** DELETE calls whose pathname includes the given substring. */
function deletesTo(path: string): number {
  return api.calls.filter((c) => c.method === "DELETE" && c.url.pathname.includes(path)).length;
}

// ===========================================================================
// line_build_rich_menu
// ===========================================================================
describe("line_build_rich_menu", () => {
  const AREA = { bounds: { x: 0, y: 0, width: 1250, height: 1686 }, action: { type: "message", text: "ซ้าย" } };

  it("happy: create → download(SSRF) → upload(api-data) → set default, with exact create body", async () => {
    // "/content" (upload) must be registered BEFORE "/v2/bot/richmenu" (create).
    api.on("/content", {}, { method: "POST" });
    api.on("/menu.png", { text: "PNGDATA", headers: { "Content-Type": "image/png" } });
    api.on("/v2/bot/richmenu", { body: { richMenuId: "richmenu-123" } }, { method: "POST" });

    const result = await mcp.callTool("line_build_rich_menu", {
      name: "เมนูโปรวันแม่",
      chat_bar_text: "เมนู",
      image_url: "https://cdn.example.com/menu.png",
      areas: [AREA],
    });

    expect(result.isError).toBeFalsy();

    const create = api.calls.find((c) => c.url.pathname === "/v2/bot/richmenu" && c.method === "POST");
    expect(create?.body).toEqual({
      size: { width: 2500, height: 1686 }, // large default
      selected: true,
      name: "เมนูโปรวันแม่",
      chatBarText: "เมนู",
      areas: [AREA],
    });
    expect(create?.headers.authorization).toBe("Bearer rmw-token");

    const upload = api.callsTo("/v2/bot/richmenu/richmenu-123/content")[0];
    expect(upload?.url.hostname).toBe("api-data.line.me");
    expect(upload?.headers["content-type"]).toBe("image/png");
    expect(Buffer.from(upload?.rawBody as Buffer).toString()).toBe("PNGDATA");

    // set_as_default defaults true → account-wide default endpoint hit
    expect(api.callsTo("/v2/bot/user/all/richmenu/richmenu-123")).toHaveLength(1);
    expect(deletesTo("/v2/bot/richmenu")).toBe(0);

    expect(result.structuredContent).toMatchObject({
      rich_menu_id: "richmenu-123",
      name: "เมนูโปรวันแม่",
      set_as_default: true,
    });
  });

  it("compact size + set_as_default:false uses 2500x843 and skips the default endpoint", async () => {
    api.on("/content", {}, { method: "POST" });
    api.on("/menu.png", { text: "PNGDATA", headers: { "Content-Type": "image/png" } });
    api.on("/v2/bot/richmenu", { body: { richMenuId: "richmenu-c" } }, { method: "POST" });

    const result = await mcp.callTool("line_build_rich_menu", {
      name: "compact",
      chat_bar_text: "เมนู",
      size: "compact",
      image_url: "https://cdn.example.com/menu.png",
      areas: [{ bounds: { x: 0, y: 0, width: 2500, height: 843 }, action: { type: "message", text: "x" } }],
      set_as_default: false,
    });
    expect(result.isError).toBeFalsy();
    const create = api.calls.find((c) => c.url.pathname === "/v2/bot/richmenu" && c.method === "POST");
    expect((create?.body as { size: unknown }).size).toEqual({ width: 2500, height: 843 });
    expect(api.callsTo("/v2/bot/user/all/richmenu/richmenu-c")).toHaveLength(0);
    expect(result.structuredContent?.set_as_default).toBe(false);
  });

  it("client-side area-overflow rejection: Thai error BEFORE any network call", async () => {
    const result = await mcp.callTool("line_build_rich_menu", {
      name: "overflow",
      chat_bar_text: "เมนู",
      image_url: "https://cdn.example.com/menu.png",
      areas: [{ bounds: { x: 0, y: 0, width: 3000, height: 1686 }, action: { type: "message", text: "x" } }],
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("เกินขอบรูป");
    expect(firstText(result)).toContain("2500x1686");
    expect(api.calls).toHaveLength(0);
  });

  it("SSRF: private image_url is created-then-cleaned-up (DELETE the orphan) with 🚫 Thai error", async () => {
    api.on("/v2/bot/richmenu", { body: { richMenuId: "richmenu-999" } }, { method: "POST" });

    const result = await mcp.callTool("line_build_rich_menu", {
      name: "ssrf",
      chat_bar_text: "เมนู",
      image_url: "https://192.168.1.1/x.png",
      areas: [AREA],
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("🚫");
    expect(firstText(result)).toContain("ตรวจสอบ image_url");
    // create happened, then the orphan was deleted; nothing uploaded
    expect(api.calls.filter((c) => c.url.pathname === "/v2/bot/richmenu" && c.method === "POST")).toHaveLength(1);
    expect(deletesTo("/v2/bot/richmenu/richmenu-999")).toBe(1);
    expect(api.callsTo("/content")).toHaveLength(0);
  });

  it("upload 400 → deletes the orphaned menu and surfaces a Thai cleanup error", async () => {
    api.on("/content", { status: 400, body: { message: "invalid image" } }, { method: "POST" });
    api.on("/menu.png", { text: "PNGDATA", headers: { "Content-Type": "image/png" } });
    api.on("/v2/bot/richmenu", { body: { richMenuId: "richmenu-888" } }, { method: "POST" });

    const result = await mcp.callTool("line_build_rich_menu", {
      name: "upload-fail",
      chat_bar_text: "เมนู",
      image_url: "https://cdn.example.com/menu.png",
      areas: [AREA],
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("Upload image ไม่สำเร็จ");
    expect(firstText(result)).toContain("rich menu ที่ค้างถูกลบให้แล้ว");
    expect(deletesTo("/v2/bot/richmenu/richmenu-888")).toBe(1);
  });

  it("non-image content-type → cleanup + unsupported-format Thai error", async () => {
    api.on("/menu.png", { text: "%PDF-1.4", headers: { "Content-Type": "application/pdf" } });
    api.on("/v2/bot/richmenu", { body: { richMenuId: "richmenu-pdf" } }, { method: "POST" });

    const result = await mcp.callTool("line_build_rich_menu", {
      name: "pdf",
      chat_bar_text: "เมนู",
      image_url: "https://cdn.example.com/menu.png",
      areas: [AREA],
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("ไม่รองรับ");
    expect(deletesTo("/v2/bot/richmenu/richmenu-pdf")).toBe(1);
  });

  it("schema rejection: missing chat_bar_text → InvalidParams, zero network calls", async () => {
    const result = await mcp.callTool("line_build_rich_menu", {
      name: "x",
      image_url: "https://cdn.example.com/menu.png",
      areas: [AREA],
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("Input validation error");
    expect(api.calls).toHaveLength(0);
  });

  it("LINE 401 on create → TH.unauthorized, no menu created, no cleanup", async () => {
    api.onError("/v2/bot/richmenu", 401);
    const result = await mcp.callTool("line_build_rich_menu", {
      name: "x",
      chat_bar_text: "เมนู",
      image_url: "https://cdn.example.com/menu.png",
      areas: [AREA],
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toBe(TH.unauthorized);
    expect(deletesTo("/v2/bot/richmenu")).toBe(0);
  });
});

// ===========================================================================
// line_link_rich_menu
// ===========================================================================
describe("line_link_rich_menu", () => {
  it("single link → per-user endpoint, structured linked_count 1", async () => {
    const result = await mcp.callTool("line_link_rich_menu", {
      mode: "link",
      rich_menu_id: "richmenu-abc",
      user_id: "U1",
    });
    expect(result.isError).toBeFalsy();
    const call = api.callsTo("/v2/bot/user/U1/richmenu/richmenu-abc")[0];
    expect(call?.method).toBe("POST");
    expect(result.structuredContent).toMatchObject({ mode: "link", linked_count: 1, rich_menu_id: "richmenu-abc" });
  });

  it("single unlink → DELETE per-user richmenu, structured unlinked_count 1", async () => {
    const result = await mcp.callTool("line_link_rich_menu", { mode: "unlink", user_id: "U1" });
    expect(result.isError).toBeFalsy();
    const call = api.callsTo("/v2/bot/user/U1/richmenu")[0];
    expect(call?.method).toBe("DELETE");
    expect(result.structuredContent).toMatchObject({ mode: "unlink", unlinked_count: 1 });
  });

  it("bulk link of 600 ids → 2 chunks to /richmenu/bulk/link", async () => {
    const ids = Array.from({ length: 600 }, (_, i) => `U${i}`);
    const result = await mcp.callTool("line_link_rich_menu", { mode: "link", rich_menu_id: "richmenu-b", user_ids: ids });
    expect(result.isError).toBeFalsy();
    const calls = api.callsTo("/v2/bot/richmenu/bulk/link");
    expect(calls).toHaveLength(2);
    expect((calls[0]?.body as { userIds: string[] }).userIds).toHaveLength(500);
    expect((calls[1]?.body as { userIds: string[] }).userIds).toHaveLength(100);
    expect((calls[0]?.body as { richMenuId: string }).richMenuId).toBe("richmenu-b");
    expect(result.structuredContent).toMatchObject({ mode: "link", linked_count: 600, chunks: 2 });
  });

  it("bulk unlink → single chunk to /richmenu/bulk/unlink", async () => {
    const result = await mcp.callTool("line_link_rich_menu", { mode: "unlink", user_ids: ["U1", "U2", "U3"] });
    expect(result.isError).toBeFalsy();
    const calls = api.callsTo("/v2/bot/richmenu/bulk/unlink");
    expect(calls).toHaveLength(1);
    expect((calls[0]?.body as { userIds: string[] }).userIds).toEqual(["U1", "U2", "U3"]);
    expect(result.structuredContent).toMatchObject({ mode: "unlink", unlinked_count: 3, chunks: 1 });
  });

  it("neither user_id nor user_ids → inline Thai error, zero network calls", async () => {
    const result = await mcp.callTool("line_link_rich_menu", { mode: "unlink" });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("ต้องระบุ user_id หรือ user_ids");
    expect(api.calls).toHaveLength(0);
  });

  it("mode=link without rich_menu_id → inline Thai error, zero network calls", async () => {
    const result = await mcp.callTool("line_link_rich_menu", { mode: "link", user_id: "U1" });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("mode='link' ต้องการ rich_menu_id");
    expect(api.calls).toHaveLength(0);
  });

  it("schema rejection: unknown mode → InvalidParams, zero network calls", async () => {
    const result = await mcp.callTool("line_link_rich_menu", { mode: "toggle", user_id: "U1" });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("Input validation error");
    expect(api.calls).toHaveLength(0);
  });

  it("LINE 404 on single link surfaces Thai '404'", async () => {
    api.onError("/v2/bot/user/U1/richmenu/richmenu-x", 404, "rich menu not found");
    const result = await mcp.callTool("line_link_rich_menu", { mode: "link", rich_menu_id: "richmenu-x", user_id: "U1" });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("LINE 404: rich menu not found");
  });
});

// ===========================================================================
// line_set_default_rich_menu
// ===========================================================================
describe("line_set_default_rich_menu", () => {
  it("set → POST /v2/bot/user/all/richmenu/{id}", async () => {
    const result = await mcp.callTool("line_set_default_rich_menu", { mode: "set", rich_menu_id: "richmenu-d" });
    expect(result.isError).toBeFalsy();
    const call = api.callsTo("/v2/bot/user/all/richmenu/richmenu-d")[0];
    expect(call?.method).toBe("POST");
    expect(result.structuredContent).toMatchObject({ mode: "set", rich_menu_id: "richmenu-d" });
  });

  it("clear → DELETE /v2/bot/user/all/richmenu", async () => {
    const result = await mcp.callTool("line_set_default_rich_menu", { mode: "clear" });
    expect(result.isError).toBeFalsy();
    const call = api.callsTo("/v2/bot/user/all/richmenu")[0];
    expect(call?.method).toBe("DELETE");
    expect(result.structuredContent).toMatchObject({ mode: "clear" });
  });

  it("set without rich_menu_id → inline Thai error, zero network calls", async () => {
    const result = await mcp.callTool("line_set_default_rich_menu", { mode: "set" });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("mode='set' ต้องการ rich_menu_id");
    expect(api.calls).toHaveLength(0);
  });

  it("schema rejection: unknown mode → InvalidParams, zero network calls", async () => {
    const result = await mcp.callTool("line_set_default_rich_menu", { mode: "reset" });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("Input validation error");
    expect(api.calls).toHaveLength(0);
  });

  it("LINE 404 surfaces Thai '404'", async () => {
    api.onError("/v2/bot/user/all/richmenu/richmenu-missing", 404, "not found");
    const result = await mcp.callTool("line_set_default_rich_menu", { mode: "set", rich_menu_id: "richmenu-missing" });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("LINE 404: not found");
  });
});

// ===========================================================================
// line_manage_rich_menu_alias
// ===========================================================================
describe("line_manage_rich_menu_alias", () => {
  it("create → POST /v2/bot/richmenu/alias with body {richMenuAliasId, richMenuId}", async () => {
    const result = await mcp.callTool("line_manage_rich_menu_alias", {
      mode: "create",
      alias_id: "tab-a",
      rich_menu_id: "richmenu-a",
    });
    expect(result.isError).toBeFalsy();
    const call = api.calls.find((c) => c.url.pathname === "/v2/bot/richmenu/alias" && c.method === "POST");
    expect(call?.body).toEqual({ richMenuAliasId: "tab-a", richMenuId: "richmenu-a" });
    expect(result.structuredContent).toMatchObject({ mode: "create", alias_id: "tab-a", rich_menu_id: "richmenu-a" });
  });

  it("update → POST /v2/bot/richmenu/alias/{alias_id} with body {richMenuId}", async () => {
    const result = await mcp.callTool("line_manage_rich_menu_alias", {
      mode: "update",
      alias_id: "tab-a",
      rich_menu_id: "richmenu-b",
    });
    expect(result.isError).toBeFalsy();
    const call = api.callsTo("/v2/bot/richmenu/alias/tab-a")[0];
    expect(call?.method).toBe("POST");
    expect(call?.body).toEqual({ richMenuId: "richmenu-b" });
    expect(result.structuredContent).toMatchObject({ mode: "update", alias_id: "tab-a", rich_menu_id: "richmenu-b" });
  });

  it("delete → DELETE /v2/bot/richmenu/alias/{alias_id}", async () => {
    const result = await mcp.callTool("line_manage_rich_menu_alias", { mode: "delete", alias_id: "tab-a" });
    expect(result.isError).toBeFalsy();
    const call = api.callsTo("/v2/bot/richmenu/alias/tab-a")[0];
    expect(call?.method).toBe("DELETE");
    expect(result.structuredContent).toMatchObject({ mode: "delete", alias_id: "tab-a" });
  });

  it("get → GET alias returns {richMenuAliasId, richMenuId}", async () => {
    api.on("/v2/bot/richmenu/alias/tab-a", { body: { richMenuAliasId: "tab-a", richMenuId: "richmenu-z" } });
    const result = await mcp.callTool("line_manage_rich_menu_alias", { mode: "get", alias_id: "tab-a" });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ richMenuAliasId: "tab-a", richMenuId: "richmenu-z" });
  });

  it("list → GET /v2/bot/richmenu/alias/list, structured {aliases}", async () => {
    api.on("/v2/bot/richmenu/alias/list", {
      body: { aliases: [{ richMenuAliasId: "tab-a", richMenuId: "R1" }, { richMenuAliasId: "tab-b", richMenuId: "R2" }] },
    });
    const result = await mcp.callTool("line_manage_rich_menu_alias", { mode: "list" });
    expect(result.isError).toBeFalsy();
    expect((result.structuredContent?.aliases as unknown[])).toHaveLength(2);
    expect(firstText(result)).toContain("tab-a");
  });

  it("create without alias_id → inline Thai error, zero network calls", async () => {
    const result = await mcp.callTool("line_manage_rich_menu_alias", { mode: "create", rich_menu_id: "R1" });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("mode='create' ต้องการ alias_id");
    expect(api.calls).toHaveLength(0);
  });

  it("create with alias_id but no rich_menu_id → inline Thai error, zero network calls", async () => {
    const result = await mcp.callTool("line_manage_rich_menu_alias", { mode: "create", alias_id: "tab-a" });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("mode='create' ต้องการ rich_menu_id");
    expect(api.calls).toHaveLength(0);
  });

  it("schema rejection: unknown mode → InvalidParams, zero network calls", async () => {
    const result = await mcp.callTool("line_manage_rich_menu_alias", { mode: "swap" });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("Input validation error");
    expect(api.calls).toHaveLength(0);
  });

  it("LINE 400-with-details on create surfaces the detail line", async () => {
    api.onError("/v2/bot/richmenu/alias", 400, "conflict richmenu alias id", [
      { message: "already exists", property: "richMenuAliasId" },
    ]);
    const result = await mcp.callTool("line_manage_rich_menu_alias", { mode: "create", alias_id: "tab-a", rich_menu_id: "R1" });
    expect(result.isError).toBe(true);
    const text = firstText(result);
    expect(text).toContain("LINE 400: conflict richmenu alias id");
    expect(text).toContain("richMenuAliasId: already exists");
  });
});

// ===========================================================================
// line_list_rich_menus
// ===========================================================================
describe("line_list_rich_menus", () => {
  it("markdown: lists menus + flags the account default", async () => {
    api.on("/v2/bot/richmenu/list", {
      body: {
        richmenus: [
          { richMenuId: "R1", name: "หลัก", chatBarText: "เมนู", size: { width: 2500, height: 1686 }, selected: true },
          { richMenuId: "R2", name: "รอง", selected: false },
        ],
      },
    });
    api.on("/v2/bot/user/all/richmenu", { body: { richMenuId: "R1" } }, { method: "GET" });

    const result = await mcp.callTool("line_list_rich_menus", {});
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ total: 2, default_id: "R1" });
    const menus = result.structuredContent?.rich_menus as Array<{ rich_menu_id: string; is_default: boolean }>;
    expect(menus.find((m) => m.rich_menu_id === "R1")?.is_default).toBe(true);
    expect(menus.find((m) => m.rich_menu_id === "R2")?.is_default).toBe(false);
    expect(firstText(result)).toContain("⭐ (default)");
  });

  it("json format returns pretty JSON text", async () => {
    api.on("/v2/bot/richmenu/list", { body: { richmenus: [] } });
    api.on("/v2/bot/user/all/richmenu", { status: 404, body: { message: "no default" } }, { method: "GET" });

    const result = await mcp.callTool("line_list_rich_menus", { response_format: "json" });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ total: 0 });
    expect(result.structuredContent?.default_id).toBeUndefined();
    // JSON body parses cleanly
    expect(() => JSON.parse(firstText(result))).not.toThrow();
  });

  it("empty OA renders the 'no rich menu yet' hint", async () => {
    api.on("/v2/bot/richmenu/list", { body: { richmenus: [] } });
    api.on("/v2/bot/user/all/richmenu", { status: 404, body: {} }, { method: "GET" });

    const result = await mcp.callTool("line_list_rich_menus", {});
    expect(result.isError).toBeFalsy();
    expect(firstText(result)).toContain("ยังไม่มี Rich Menu");
  });

  it("schema rejection: unknown response_format → InvalidParams", async () => {
    const result = await mcp.callTool("line_list_rich_menus", { response_format: "xml" });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("Input validation error");
  });
});

// ===========================================================================
// line_delete_rich_menu
// ===========================================================================
describe("line_delete_rich_menu", () => {
  it("confirm:true → DELETE /v2/bot/richmenu/{id}, structured success", async () => {
    const result = await mcp.callTool("line_delete_rich_menu", { rich_menu_id: "richmenu-del", confirm: true });
    expect(result.isError).toBeFalsy();
    const call = api.callsTo("/v2/bot/richmenu/richmenu-del")[0];
    expect(call?.method).toBe("DELETE");
    expect(result.structuredContent).toEqual({ success: true, deleted_id: "richmenu-del" });
  });

  it("confirm gate (default false) → Thai warning, zero network calls", async () => {
    const result = await mcp.callTool("line_delete_rich_menu", { rich_menu_id: "richmenu-del" });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("ต้องตั้ง confirm=true");
    expect(api.calls).toHaveLength(0);
  });

  it("schema rejection: empty rich_menu_id → InvalidParams, zero network calls", async () => {
    const result = await mcp.callTool("line_delete_rich_menu", { rich_menu_id: "", confirm: true });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("Input validation error");
    expect(api.calls).toHaveLength(0);
  });

  it("LINE 404 surfaces Thai '404'", async () => {
    api.onError("/v2/bot/richmenu/richmenu-missing", 404, "not found");
    const result = await mcp.callTool("line_delete_rich_menu", { rich_menu_id: "richmenu-missing", confirm: true });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("LINE 404: not found");
  });
});

// ===========================================================================
// line_audit_user_menu
// ===========================================================================
describe("line_audit_user_menu", () => {
  it("per-user link present → source per_user", async () => {
    api.on("/v2/bot/user/U1/richmenu", { body: { richMenuId: "R-user" } }, { method: "GET" });
    api.on("/v2/bot/user/all/richmenu", { body: { richMenuId: "R-default" } }, { method: "GET" });

    const result = await mcp.callTool("line_audit_user_menu", { user_id: "U1" });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      user_id: "U1",
      visible_rich_menu_id: "R-user",
      source: "per_user",
      per_user_link: "R-user",
      default_id: "R-default",
    });
    expect(firstText(result)).toContain("per-user link");
  });

  it("no per-user link but default set → source default", async () => {
    api.on("/v2/bot/user/U2/richmenu", { status: 404, body: { message: "none" } }, { method: "GET" });
    api.on("/v2/bot/user/all/richmenu", { body: { richMenuId: "R-default" } }, { method: "GET" });

    const result = await mcp.callTool("line_audit_user_menu", { user_id: "U2" });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ source: "default", visible_rich_menu_id: "R-default" });
    expect(result.structuredContent?.per_user_link).toBeUndefined();
  });

  it("neither per-user nor default → source none", async () => {
    api.on("/v2/bot/user/U3/richmenu", { status: 404, body: {} }, { method: "GET" });
    api.on("/v2/bot/user/all/richmenu", { status: 404, body: {} }, { method: "GET" });

    const result = await mcp.callTool("line_audit_user_menu", { user_id: "U3" });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ source: "none" });
    expect(firstText(result)).toContain("ไม่เห็น Rich Menu");
  });

  it("non-404 error on the per-user lookup surfaces Thai 401", async () => {
    api.on("/v2/bot/user/U4/richmenu", { status: 401, body: {} }, { method: "GET" });
    api.on("/v2/bot/user/all/richmenu", { body: { richMenuId: "R-default" } }, { method: "GET" });

    const result = await mcp.callTool("line_audit_user_menu", { user_id: "U4" });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toBe(TH.unauthorized);
  });

  it("schema rejection: missing user_id → InvalidParams, zero network calls", async () => {
    const result = await mcp.callTool("line_audit_user_menu", {});
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("Input validation error");
    expect(api.calls).toHaveLength(0);
  });
});

// ===========================================================================
// line_upload_rich_menu_image  (covering the LineApiError error branch)
// ===========================================================================
describe("line_upload_rich_menu_image (error surfacing)", () => {
  it("LINE 404-with-details on upload surfaces the bulleted detail line", async () => {
    api.on("/banner.png", { text: "PNGDATA", headers: { "Content-Type": "image/png" } });
    api.on("/v2/bot/richmenu/richmenu-x/content", {
      status: 404,
      body: { message: "rich menu not found", details: [{ message: "no such id", property: "richMenuId" }] },
    }, { method: "POST" });

    const result = await mcp.callTool("line_upload_rich_menu_image", {
      rich_menu_id: "richmenu-x",
      image_url: "https://cdn.example.com/banner.png",
    });
    expect(result.isError).toBe(true);
    const text = firstText(result);
    expect(text).toContain("LINE 404: rich menu not found");
    expect(text).toContain("• richMenuId: no such id");
  });

  it("LINE 401 on upload (no details) surfaces the plain Thai unauthorized message", async () => {
    api.on("/banner.png", { text: "PNGDATA", headers: { "Content-Type": "image/png" } });
    api.on("/v2/bot/richmenu/richmenu-y/content", { status: 401, body: {} }, { method: "POST" });

    const result = await mcp.callTool("line_upload_rich_menu_image", {
      rich_menu_id: "richmenu-y",
      image_url: "https://cdn.example.com/banner.png",
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toBe(TH.unauthorized);
  });
});

// ===========================================================================
// line_test_webhook
// ===========================================================================
describe("line_test_webhook", () => {
  it("happy: reads configured endpoint + pings /webhook/test, structured success", async () => {
    api.on("/v2/bot/channel/webhook/endpoint", { body: { endpoint: "https://bot.example.com/hook", active: true } }, { method: "GET" });
    api.on("/v2/bot/channel/webhook/test", { body: { success: true, timestamp: 1, statusCode: 200, reason: "OK", detail: "" } }, { method: "POST" });

    const result = await mcp.callTool("line_test_webhook", {});
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      success: true,
      status_code: 200,
      reason: "OK",
      configured_endpoint: "https://bot.example.com/hook",
      tested_endpoint: "https://bot.example.com/hook",
    });
    expect(firstText(result)).toContain("✅");
  });

  it("override_endpoint is what gets pinged and reported as tested_endpoint", async () => {
    api.on("/v2/bot/channel/webhook/endpoint", { body: { endpoint: "https://old.example.com/hook", active: true } }, { method: "GET" });
    api.on("/v2/bot/channel/webhook/test", { body: { success: false, timestamp: 1, statusCode: 500, reason: "SERVER_ERROR", detail: "boom" } }, { method: "POST" });

    const result = await mcp.callTool("line_test_webhook", { override_endpoint: "https://new.example.com/hook" });
    expect(result.isError).toBeFalsy();
    const testCall = api.callsTo("/v2/bot/channel/webhook/test")[0];
    expect(testCall?.body).toEqual({ endpoint: "https://new.example.com/hook" });
    expect(result.structuredContent).toMatchObject({
      success: false,
      status_code: 500,
      reason: "SERVER_ERROR",
      tested_endpoint: "https://new.example.com/hook",
    });
  });

  it("unreadable configured endpoint (404) + no override → tested_endpoint '(unknown)'", async () => {
    api.on("/v2/bot/channel/webhook/test", { body: { success: false, timestamp: 1, statusCode: 0, reason: "COULD_NOT_CONNECT", detail: "" } }, { method: "POST" });
    api.on("/v2/bot/channel/webhook/endpoint", { status: 404, body: {} }, { method: "GET" });

    const result = await mcp.callTool("line_test_webhook", {});
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ tested_endpoint: "(unknown)" });
    expect(result.structuredContent?.configured_endpoint).toBeUndefined();
  });

  it("schema rejection: non-URL override_endpoint → InvalidParams, zero network calls", async () => {
    const result = await mcp.callTool("line_test_webhook", { override_endpoint: "not-a-url" });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("Input validation error");
    expect(api.calls).toHaveLength(0);
  });

  it("LINE 401 on the test ping surfaces Thai unauthorized", async () => {
    api.on("/v2/bot/channel/webhook/endpoint", { body: { endpoint: "https://bot.example.com/hook", active: true } }, { method: "GET" });
    api.on("/v2/bot/channel/webhook/test", { status: 401, body: {} }, { method: "POST" });

    const result = await mcp.callTool("line_test_webhook", {});
    expect(result.isError).toBe(true);
    expect(firstText(result)).toBe(TH.unauthorized);
  });
});

// ===========================================================================
// line_set_webhook_endpoint
// ===========================================================================
describe("line_set_webhook_endpoint", () => {
  it("set → PUT endpoint then re-reads it, structured {endpoint, active}", async () => {
    api.on("/v2/bot/channel/webhook/endpoint", { body: { endpoint: "https://api.example.com/line", active: true } });

    const result = await mcp.callTool("line_set_webhook_endpoint", { mode: "set", endpoint: "https://api.example.com/line" });
    expect(result.isError).toBeFalsy();
    const put = api.calls.find((c) => c.url.pathname === "/v2/bot/channel/webhook/endpoint" && c.method === "PUT");
    expect(put?.body).toEqual({ endpoint: "https://api.example.com/line" });
    expect(result.structuredContent).toEqual({ endpoint: "https://api.example.com/line", active: true });
    expect(firstText(result)).toContain("ตั้ง webhook สำเร็จ");
  });

  it("get → GET endpoint, structured {endpoint, active}", async () => {
    api.on("/v2/bot/channel/webhook/endpoint", { body: { endpoint: "https://api.example.com/line", active: false } }, { method: "GET" });
    const result = await mcp.callTool("line_set_webhook_endpoint", { mode: "get" });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ endpoint: "https://api.example.com/line", active: false });
  });

  it("set without endpoint → inline Thai error, zero network calls", async () => {
    const result = await mcp.callTool("line_set_webhook_endpoint", { mode: "set" });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("mode='set' ต้องการ endpoint");
    expect(api.calls).toHaveLength(0);
  });

  it("set with http:// endpoint → inline HTTPS-required Thai error, zero network calls", async () => {
    const result = await mcp.callTool("line_set_webhook_endpoint", { mode: "set", endpoint: "http://api.example.com/line" });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("ต้องเป็น HTTPS");
    expect(api.calls).toHaveLength(0);
  });

  it("set with an over-long URL → inline length-limit Thai error, zero network calls", async () => {
    const longUrl = "https://api.example.com/" + "a".repeat(500);
    const result = await mcp.callTool("line_set_webhook_endpoint", { mode: "set", endpoint: longUrl });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("เกิน 500");
    expect(api.calls).toHaveLength(0);
  });

  it("schema rejection: unknown mode → InvalidParams, zero network calls", async () => {
    const result = await mcp.callTool("line_set_webhook_endpoint", { mode: "patch" });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("Input validation error");
    expect(api.calls).toHaveLength(0);
  });

  it("LINE 400-with-details on set surfaces the detail line", async () => {
    api.onError("/v2/bot/channel/webhook/endpoint", 400, "invalid endpoint", [
      { message: "must be reachable", property: "endpoint" },
    ]);
    const result = await mcp.callTool("line_set_webhook_endpoint", { mode: "set", endpoint: "https://api.example.com/line" });
    expect(result.isError).toBe(true);
    const text = firstText(result);
    expect(text).toContain("LINE 400: invalid endpoint");
    expect(text).toContain("endpoint: must be reachable");
  });
});

// ===========================================================================
// line_manage_liff_app
// ===========================================================================
describe("line_manage_liff_app", () => {
  it("create → POST /liff/v1/apps with the view body, structured liff_id + url", async () => {
    api.on("/liff/v1/apps", { body: { liffId: "liff-123" } }, { method: "POST" });
    const result = await mcp.callTool("line_manage_liff_app", {
      mode: "create",
      config: { view: { type: "tall", url: "https://my.app" }, description: "shop" },
    });
    expect(result.isError).toBeFalsy();
    const call = api.calls.find((c) => c.url.pathname === "/liff/v1/apps" && c.method === "POST");
    expect(call?.body).toMatchObject({ view: { type: "tall", url: "https://my.app" }, description: "shop" });
    expect(result.structuredContent).toEqual({ liff_id: "liff-123", liff_url: "https://liff.line.me/liff-123" });
  });

  it("list → GET /liff/v1/apps, structured {apps}", async () => {
    api.on("/liff/v1/apps", { body: { apps: [{ liffId: "liff-1", view: { type: "full", url: "https://a" } }] } }, { method: "GET" });
    const result = await mcp.callTool("line_manage_liff_app", { mode: "list" });
    expect(result.isError).toBeFalsy();
    expect((result.structuredContent?.apps as unknown[])).toHaveLength(1);
  });

  it("update → PUT /liff/v1/apps/{id}", async () => {
    api.on("/liff/v1/apps/liff-9", {}, { method: "PUT" });
    const result = await mcp.callTool("line_manage_liff_app", {
      mode: "update",
      liff_id: "liff-9",
      config: { description: "new" },
    });
    expect(result.isError).toBeFalsy();
    const call = api.callsTo("/liff/v1/apps/liff-9")[0];
    expect(call?.method).toBe("PUT");
    expect(result.structuredContent).toEqual({ success: true, liff_id: "liff-9" });
  });

  it("delete with confirm:true → DELETE /liff/v1/apps/{id}", async () => {
    const result = await mcp.callTool("line_manage_liff_app", { mode: "delete", liff_id: "liff-9", confirm: true });
    expect(result.isError).toBeFalsy();
    const call = api.callsTo("/liff/v1/apps/liff-9")[0];
    expect(call?.method).toBe("DELETE");
    expect(result.structuredContent).toEqual({ success: true, deleted_id: "liff-9" });
  });

  it("delete without confirm → Thai confirm gate, zero network calls", async () => {
    const result = await mcp.callTool("line_manage_liff_app", { mode: "delete", liff_id: "liff-9" });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("ต้องตั้ง confirm=true");
    expect(api.calls).toHaveLength(0);
  });

  it("create without config.view → inline Thai error, zero network calls", async () => {
    const result = await mcp.callTool("line_manage_liff_app", { mode: "create", config: { description: "x" } });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("ต้องการ config.view");
    expect(api.calls).toHaveLength(0);
  });

  it("update without liff_id → inline Thai error, zero network calls", async () => {
    const result = await mcp.callTool("line_manage_liff_app", { mode: "update", config: { description: "x" } });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("ต้องการ liff_id และ config");
    expect(api.calls).toHaveLength(0);
  });

  it("schema rejection: invalid view.type → InvalidParams, zero network calls", async () => {
    const result = await mcp.callTool("line_manage_liff_app", {
      mode: "create",
      config: { view: { type: "huge", url: "https://my.app" } },
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("Input validation error");
    expect(api.calls).toHaveLength(0);
  });

  it("LINE 401 on create surfaces Thai unauthorized", async () => {
    api.on("/liff/v1/apps", { status: 401, body: {} }, { method: "POST" });
    const result = await mcp.callTool("line_manage_liff_app", {
      mode: "create",
      config: { view: { type: "compact", url: "https://my.app" } },
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toBe(TH.unauthorized);
  });
});

// ===========================================================================
// line_check_token
// ===========================================================================
describe("line_check_token", () => {
  it("happy: verifies via /oauth2/v2.1/verify, no warning when >7 days remain", async () => {
    api.on("/oauth2/v2.1/verify", { body: { client_id: "1657000000", expires_in: 2_592_000, scope: "profile chat_message.write" } });

    const result = await mcp.callTool("line_check_token", {});
    expect(result.isError).toBeFalsy();
    const call = api.callsTo("/oauth2/v2.1/verify")[0];
    expect(call?.url.searchParams.get("access_token")).toBe("rmw-token");
    expect(result.structuredContent).toMatchObject({
      valid: true,
      client_id: "1657000000",
      expires_in_seconds: 2_592_000,
      expires_in_days: 30,
      scope: "profile chat_message.write",
    });
    expect(result.structuredContent?.warning).toBeUndefined();
    expect(firstText(result)).toContain("✅ Token ใช้งานได้");
  });

  it("warns when the token expires within 7 days", async () => {
    api.on("/oauth2/v2.1/verify", { body: { client_id: "165", expires_in: 3 * 24 * 60 * 60 } });
    const result = await mcp.callTool("line_check_token", {});
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ expires_in_days: 3 });
    expect(String(result.structuredContent?.warning)).toContain("เหลืออายุ");
    expect(firstText(result)).toContain("เหลืออายุ");
  });

  it("LINE 401 (expired token) surfaces Thai unauthorized", async () => {
    api.on("/oauth2/v2.1/verify", { status: 401, body: {} });
    const result = await mcp.callTool("line_check_token", {});
    expect(result.isError).toBe(true);
    expect(firstText(result)).toBe(TH.unauthorized);
  });

  it("schema rejection: oa given as a number → InvalidParams, zero network calls", async () => {
    const result = await mcp.callTool("line_check_token", { oa: 123 });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("Input validation error");
    expect(api.calls).toHaveLength(0);
  });
});
