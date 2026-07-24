/**
 * E2E tool tests — Audiences + Insights + Ops + Design + Coupons group.
 *
 * Every tool is driven through the real MCP client (tests/helpers/mcp.ts) with
 * all LINE traffic intercepted at globalThis.fetch. Per tool we assert:
 *   (a) happy path hits the EXACT LINE endpoint/method with the right body/query
 *       and returns sane structuredContent,
 *   (b) at least one invalid input is rejected by the schema (isError /
 *       InvalidParams) with ZERO network calls,
 *   (c) at least one LINE API error (401 / 403 / 404 / 400-with-details) surfaces
 *       the Thai message — OR, for tools that degrade via Promise.allSettled
 *       (get_oa_status, get_coupon_stats), the degradation branch is pinned.
 *
 * Fetch-mock routing is SUBSTRING based, first-match-in-registration-order — the
 * more specific path (e.g. "/v2/bot/message/quota/consumption") must be
 * registered BEFORE the shorter one ("/v2/bot/message/quota").
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TH } from "../../src/i18n/th.js";
import { STICKER_CATALOG } from "../../src/resources/sticker-catalog.js";
import { FLEX_TEMPLATE_CATALOG } from "../../src/line/flex-templates.js";
import { installFetchMock, type FetchMock } from "../helpers/fetch-mock.js";
import { isolateConfigEnv, useConfigFile, useSingleOaEnv, twoOaConfig } from "../helpers/env.js";
import { createTestMcp, firstText, type TestMcp } from "../helpers/mcp.js";

let restoreEnv: () => void;
let api: FetchMock;
let mcp: TestMcp;

/** Boot the fetch mock + real MCP server after installing the given config env. */
async function boot(setupEnv: () => void): Promise<void> {
  restoreEnv = isolateConfigEnv();
  setupEnv();
  api = installFetchMock();
  mcp = await createTestMcp();
}

afterEach(async () => {
  if (mcp) await mcp.close();
  if (api) api.uninstall();
  if (restoreEnv) restoreEnv();
});

/** Register quota + consumption (consumption FIRST — substring routing). */
function mockQuota(value: number, used: number): void {
  api.on("/v2/bot/message/quota/consumption", { body: { totalUsage: used } });
  api.on("/v2/bot/message/quota", { body: { type: "limited", value } }, { method: "GET" });
}

// ============================================================================
// line_get_oa_status
// ============================================================================
describe("line_get_oa_status", () => {
  beforeEach(async () => {
    await boot(() => useSingleOaEnv("status-token"));
  });

  function mockAllOk(): void {
    api.on("/v2/bot/info", {
      body: {
        userId: "U-bot",
        basicId: "@mainoa",
        displayName: "ร้านหลัก",
        pictureUrl: "https://cdn.example.com/p.png",
        chatMode: "bot",
        markAsReadMode: "auto",
      },
    });
    mockQuota(1000, 300);
    api.on("/v2/bot/channel/webhook/endpoint", {
      body: { endpoint: "https://hook.example.com/line", active: true },
    });
    api.on("/v2/bot/user/all/richmenu", { body: { richMenuId: "rm-abc" } });
  }

  it("aggregates bot info + quota + webhook + default rich menu into one OK card", async () => {
    mockAllOk();

    const res = await mcp.callTool("line_get_oa_status", {});
    expect(res.isError).toBeFalsy();

    // Every endpoint was hit exactly once (quota = quota + consumption)
    expect(api.callsTo("/v2/bot/info")).toHaveLength(1);
    expect(api.callsTo("/v2/bot/message/quota")).toHaveLength(2);
    expect(api.callsTo("/v2/bot/channel/webhook/endpoint")).toHaveLength(1);
    expect(api.callsTo("/v2/bot/user/all/richmenu")).toHaveLength(1);

    const sc = res.structuredContent!;
    expect(sc.oa).toEqual({
      id: "@mainoa",
      display_name: "ร้านหลัก",
      picture_url: "https://cdn.example.com/p.png",
    });
    expect(sc.quota).toEqual({ used: 300, total: 1000, remaining: 700, percentage_used: 30 });
    expect(sc.webhook).toEqual({ active: true, url: "https://hook.example.com/line" });
    expect(sc.default_rich_menu).toEqual({ id: "rm-abc" });
    expect(sc.chat_mode).toBe("bot");
    expect(sc.health).toBe("OK");
    expect(sc.warnings).toEqual([]);
    expect(firstText(res)).toContain("✅");
    expect(firstText(res)).toContain("ร้านหลัก");
  });

  it("json response_format returns the same object serialized", async () => {
    mockAllOk();
    const res = await mcp.callTool("line_get_oa_status", { response_format: "json" });
    expect(res.isError).toBeFalsy();
    expect(firstText(res)).toContain('"health": "OK"');
  });

  it("degrades when quota fails — warning + WARNING health, quota falls back to unlimited", async () => {
    api.on("/v2/bot/info", { body: { userId: "U", basicId: "@x", displayName: "X", chatMode: "bot", markAsReadMode: "auto" } });
    api.on("/v2/bot/message/quota/consumption", { body: { totalUsage: 0 } });
    api.onError("/v2/bot/message/quota", 401);
    api.on("/v2/bot/channel/webhook/endpoint", { body: { endpoint: "https://h", active: true } });
    api.on("/v2/bot/user/all/richmenu", { body: { richMenuId: "rm" } });

    const res = await mcp.callTool("line_get_oa_status", {});
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent!;
    expect(sc.health).toBe("WARNING");
    expect(sc.warnings as string[]).toContain("⚠️ ดึง quota ไม่ได้");
    expect(sc.quota).toEqual({ used: 0, total: "unlimited", remaining: "unlimited", percentage_used: 0 });
  });

  it("rejects an invalid response_format with zero network calls", async () => {
    const res = await mcp.callTool("line_get_oa_status", { response_format: "xml" });
    expect(res.isError).toBe(true);
    expect(firstText(res)).toContain("Input validation error");
    expect(api.calls).toHaveLength(0);
  });

  it("unknown oa surfaces the Thai oaNotFound message via errorReply", async () => {
    const res = await mcp.callTool("line_get_oa_status", { oa: "ghost" });
    expect(res.isError).toBe(true);
    expect(firstText(res)).toContain(TH.oaNotFound("ghost"));
  });
});

// ============================================================================
// line_list_oas  (pure config, multi-OA)
// ============================================================================
describe("line_list_oas", () => {
  beforeEach(async () => {
    await boot(() => useConfigFile(twoOaConfig()));
  });

  it("lists both OAs with the default one flagged active (json)", async () => {
    const res = await mcp.callTool("line_list_oas", { response_format: "json" });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent!;
    expect(sc.active_oa).toBe("main");
    const oas = sc.oas as { id: string; display_name?: string; is_active: boolean }[];
    expect(oas).toHaveLength(2);
    expect(oas.find((o) => o.id === "main")?.is_active).toBe(true);
    expect(oas.find((o) => o.id === "shop2")?.is_active).toBe(false);
    expect(api.calls).toHaveLength(0); // pure config — no network
  });

  it("markdown default renders the active marker", async () => {
    const res = await mcp.callTool("line_list_oas", {});
    expect(res.isError).toBeFalsy();
    expect(firstText(res)).toContain("Active: **main**");
  });

  it("rejects an invalid response_format with zero network calls", async () => {
    const res = await mcp.callTool("line_list_oas", { response_format: "yaml" });
    expect(res.isError).toBe(true);
    expect(api.calls).toHaveLength(0);
  });
});

// ============================================================================
// line_run_on_many_oas  (agency fan-out, multi-OA)
// ============================================================================
describe("line_run_on_many_oas", () => {
  beforeEach(async () => {
    await boot(() => useConfigFile(twoOaConfig()));
  });

  it("fans a read-only tool out across every OA and carries each OA's token", async () => {
    api.on("/v2/bot/info", { body: { displayName: "N", chatMode: "bot", markAsReadMode: "auto" } });
    mockQuota(1000, 0);
    api.on("/v2/bot/channel/webhook/endpoint", { body: { endpoint: "https://h", active: true } });

    const res = await mcp.callTool("line_run_on_many_oas", { tool: "line_get_oa_status" });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent!;
    expect(sc.count_ok).toBe(2);
    expect(sc.count_failed).toBe(0);
    expect(sc.results as unknown[]).toHaveLength(2);

    // Both OAs were actually contacted with their own bearer token
    const tokens = new Set(api.calls.map((c) => c.headers.authorization));
    expect(tokens.has("Bearer token-main")).toBe(true);
    expect(tokens.has("Bearer token-shop2")).toBe(true);
  });

  it("isolates a per-OA failure — one bad token does not sink the whole run", async () => {
    // Respond per-token: shop2 gets 401, main succeeds.
    api.on("/v2/bot/richmenu/list", (call) =>
      call.headers.authorization === "Bearer token-shop2"
        ? { status: 401, body: { message: "bad token" } }
        : { body: { richmenus: [{ richMenuId: "r1", name: "menu", selected: true }] } },
    );

    const res = await mcp.callTool("line_run_on_many_oas", { tool: "line_list_rich_menus" });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent!;
    expect(sc.count_ok).toBe(1);
    expect(sc.count_failed).toBe(1);
    const errors = sc.errors as { oa_id: string; error: string }[];
    expect(errors).toHaveLength(1);
    expect(errors[0]!.oa_id).toBe("shop2");
    expect(errors[0]!.error).toContain(TH.unauthorized);
  });

  it("honors an explicit oa_ids array + json format", async () => {
    api.on("/v2/bot/channel/webhook/test", { body: { success: true, statusCode: 200, reason: "OK" } });
    const res = await mcp.callTool("line_run_on_many_oas", {
      tool: "line_test_webhook",
      oa_ids: ["main"],
      response_format: "json",
    });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent!.count_ok).toBe(1);
    expect((res.structuredContent!.results as unknown[])).toHaveLength(1);
  });

  it("rejects a non-whitelisted (write) tool at the schema boundary — zero network", async () => {
    const res = await mcp.callTool("line_run_on_many_oas", { tool: "line_send_message" });
    expect(res.isError).toBe(true);
    expect(firstText(res)).toContain("Input validation error");
    expect(api.calls).toHaveLength(0);
  });
});

// ============================================================================
// line_get_user_profile
// ============================================================================
describe("line_get_user_profile", () => {
  beforeEach(async () => {
    await boot(() => useSingleOaEnv("profile-token"));
  });

  it("fetches a profile via GET /v2/bot/profile/{id}", async () => {
    api.on("/v2/bot/profile/", {
      body: {
        userId: "U123",
        displayName: "สมชาย",
        pictureUrl: "https://cdn/x.png",
        statusMessage: "hello",
        language: "th",
      },
    });

    const res = await mcp.callTool("line_get_user_profile", { user_id: "U123" });
    expect(res.isError).toBeFalsy();
    const call = api.callsTo("/v2/bot/profile/")[0]!;
    expect(call.method).toBe("GET");
    expect(call.url.pathname).toBe("/v2/bot/profile/U123");
    expect(res.structuredContent).toMatchObject({
      user_id: "U123",
      display_name: "สมชาย",
      language: "th",
    });
  });

  it("404 surfaces the specialized 4-cause Thai explanation", async () => {
    api.onError("/v2/bot/profile/", 404);
    const res = await mcp.callTool("line_get_user_profile", { user_id: "U-missing" });
    expect(res.isError).toBe(true);
    expect(firstText(res)).toContain("ไม่พบ user profile");
  });

  it("401 surfaces the Thai unauthorized message", async () => {
    api.onError("/v2/bot/profile/", 401);
    const res = await mcp.callTool("line_get_user_profile", { user_id: "U-401" });
    expect(res.isError).toBe(true);
    expect(firstText(res)).toContain(TH.unauthorized);
  });

  it("rejects an empty user_id with zero network calls", async () => {
    const res = await mcp.callTool("line_get_user_profile", { user_id: "" });
    expect(res.isError).toBe(true);
    expect(api.calls).toHaveLength(0);
  });
});

// ============================================================================
// line_list_audiences
// ============================================================================
describe("line_list_audiences", () => {
  beforeEach(async () => {
    await boot(() => useSingleOaEnv("aud-token"));
  });

  it("lists audiences via GET /v2/bot/audienceGroup/list with page+size query", async () => {
    api.on("/v2/bot/audienceGroup/list", {
      body: {
        totalCount: 3,
        audienceGroups: [
          { audienceGroupId: 1, description: "vip", status: "READY", audienceCount: 120, created: 1, type: "UPLOAD" },
          { audienceGroupId: 2, description: "buyers", status: "IN_PROGRESS", created: 2 },
        ],
      },
    });

    const res = await mcp.callTool("line_list_audiences", {});
    expect(res.isError).toBeFalsy();
    const call = api.callsTo("/v2/bot/audienceGroup/list")[0]!;
    expect(call.method).toBe("GET");
    expect(call.url.searchParams.get("page")).toBe("1");
    expect(call.url.searchParams.get("size")).toBe("20");

    const sc = res.structuredContent!;
    expect(sc.total).toBe(3);
    expect(sc.count).toBe(2);
    expect(sc.has_more).toBe(false);
    const audiences = sc.audiences as { audience_group_id: number; name: string }[];
    expect(audiences[0]).toMatchObject({ audience_group_id: 1, name: "vip", status: "READY" });
  });

  it("passes status + name_contains through as query params", async () => {
    api.on("/v2/bot/audienceGroup/list", { body: { totalCount: 0, audienceGroups: [] } });
    await mcp.callTool("line_list_audiences", { status_filter: "READY", name_contains: "vip" });
    const call = api.callsTo("/v2/bot/audienceGroup/list")[0]!;
    expect(call.url.searchParams.get("status")).toBe("READY");
    expect(call.url.searchParams.get("description")).toBe("vip");
  });

  it("rejects a limit above MAX_PAGE_LIMIT with zero network calls", async () => {
    const res = await mcp.callTool("line_list_audiences", { limit: 5000 });
    expect(res.isError).toBe(true);
    expect(api.calls).toHaveLength(0);
  });

  it("401 surfaces the Thai unauthorized message", async () => {
    api.onError("/v2/bot/audienceGroup/list", 401);
    const res = await mcp.callTool("line_list_audiences", {});
    expect(res.isError).toBe(true);
    expect(firstText(res)).toBe(TH.unauthorized);
  });
});

// ============================================================================
// line_list_followers  (cursor pagination)
// ============================================================================
describe("line_list_followers", () => {
  beforeEach(async () => {
    await boot(() => useSingleOaEnv("fol-token"));
  });

  it("first page: GET /v2/bot/followers/ids with limit, next token → has_more", async () => {
    api.on("/v2/bot/followers/ids", { body: { userIds: ["U1", "U2"], next: "cursor-2" } });

    const res = await mcp.callTool("line_list_followers", {});
    expect(res.isError).toBeFalsy();
    const call = api.callsTo("/v2/bot/followers/ids")[0]!;
    expect(call.method).toBe("GET");
    expect(call.url.searchParams.get("limit")).toBe("300");
    expect(call.url.searchParams.get("start")).toBeNull();

    expect(res.structuredContent).toMatchObject({
      user_ids: ["U1", "U2"],
      count: 2,
      has_more: true,
      next_continuation_token: "cursor-2",
    });
  });

  it("subsequent page: continuation_token flows through as start", async () => {
    api.on("/v2/bot/followers/ids", { body: { userIds: ["U3"] } });
    const res = await mcp.callTool("line_list_followers", {
      continuation_token: "cursor-2",
      page_size: 50,
    });
    expect(res.isError).toBeFalsy();
    const call = api.callsTo("/v2/bot/followers/ids")[0]!;
    expect(call.url.searchParams.get("start")).toBe("cursor-2");
    expect(call.url.searchParams.get("limit")).toBe("50");
    expect(res.structuredContent!.has_more).toBe(false);
  });

  it("rejects a page_size above 1000 with zero network calls", async () => {
    const res = await mcp.callTool("line_list_followers", { page_size: 5000 });
    expect(res.isError).toBe(true);
    expect(api.calls).toHaveLength(0);
  });

  it("403 (region-gated) surfaces the Thai forbidden message", async () => {
    api.onError("/v2/bot/followers/ids", 403);
    const res = await mcp.callTool("line_list_followers", {});
    expect(res.isError).toBe(true);
    expect(firstText(res)).toBe(TH.forbidden);
  });
});

// ============================================================================
// line_build_audience_from_csv  (schema takes user_ids inline, not raw CSV)
// ============================================================================
describe("line_build_audience_from_csv", () => {
  beforeEach(async () => {
    await boot(() => useSingleOaEnv("csv-token"));
  });

  it("uploads user IDs via POST /v2/bot/audienceGroup/upload", async () => {
    api.on(
      "/v2/bot/audienceGroup/upload",
      { body: { audienceGroupId: 909, description: "buyers", type: "UPLOAD", created: 1717000000000 } },
      { method: "POST" },
    );

    const res = await mcp.callTool("line_build_audience_from_csv", {
      name: "buyers",
      user_ids: ["U1", "U2", "U3"],
    });
    expect(res.isError).toBeFalsy();
    const call = api.callsTo("/v2/bot/audienceGroup/upload")[0]!;
    expect(call.method).toBe("POST");
    const body = call.body as { description: string; audiences: { id: string }[]; isIfaAudience: boolean };
    expect(body.description).toBe("buyers");
    expect(body.audiences).toHaveLength(3);
    expect(body.isIfaAudience).toBe(false);

    expect(res.structuredContent).toMatchObject({
      audience_group_id: 909,
      name: "buyers",
      type: "UPLOAD",
    });
  });

  it("rejects an empty user_ids array with zero network calls", async () => {
    const res = await mcp.callTool("line_build_audience_from_csv", { name: "x", user_ids: [] });
    expect(res.isError).toBe(true);
    expect(api.calls).toHaveLength(0);
  });

  it("401 surfaces the Thai unauthorized message", async () => {
    api.onError("/v2/bot/audienceGroup/upload", 401, "no", undefined);
    const res = await mcp.callTool("line_build_audience_from_csv", { name: "x", user_ids: ["U1"] });
    expect(res.isError).toBe(true);
    expect(firstText(res)).toBe(TH.unauthorized);
  });
});

// ============================================================================
// line_build_audience_from_engagement
// ============================================================================
describe("line_build_audience_from_engagement", () => {
  beforeEach(async () => {
    await boot(() => useSingleOaEnv("eng-token"));
  });

  it("clicks → POST /v2/bot/audienceGroup/click with requestId + clickUrl", async () => {
    api.on("/v2/bot/audienceGroup/click", { body: { audienceGroupId: 111 } }, { method: "POST" });
    const res = await mcp.callTool("line_build_audience_from_engagement", {
      name: "clickers",
      source_request_id: "req-abc",
      type: "clicks",
      click_url: "https://shop.example.com/promo",
    });
    expect(res.isError).toBeFalsy();
    const call = api.callsTo("/v2/bot/audienceGroup/click")[0]!;
    const body = call.body as { description: string; requestId: string; clickUrl?: string };
    expect(body).toMatchObject({
      description: "clickers",
      requestId: "req-abc",
      clickUrl: "https://shop.example.com/promo",
    });
    expect(res.structuredContent).toMatchObject({ audience_group_id: 111, type: "clicks" });
  });

  it("opens → POST /v2/bot/audienceGroup/imp", async () => {
    api.on("/v2/bot/audienceGroup/imp", { body: { audienceGroupId: 222 } }, { method: "POST" });
    const res = await mcp.callTool("line_build_audience_from_engagement", {
      name: "openers",
      source_request_id: "req-xyz",
      type: "opens",
    });
    expect(res.isError).toBeFalsy();
    expect(api.callsTo("/v2/bot/audienceGroup/imp")).toHaveLength(1);
    expect(res.structuredContent).toMatchObject({ audience_group_id: 222, type: "opens" });
  });

  it("rejects a missing source_request_id with zero network calls", async () => {
    const res = await mcp.callTool("line_build_audience_from_engagement", { name: "x" });
    expect(res.isError).toBe(true);
    expect(api.calls).toHaveLength(0);
  });

  it("400-with-details surfaces the LINE message", async () => {
    api.onError("/v2/bot/audienceGroup/click", 400, "bad request");
    const res = await mcp.callTool("line_build_audience_from_engagement", {
      name: "x",
      source_request_id: "req-1",
    });
    expect(res.isError).toBe(true);
    expect(firstText(res)).toContain("LINE 400: bad request");
  });
});

// ============================================================================
// line_update_audience  (two modes)
// ============================================================================
describe("line_update_audience", () => {
  beforeEach(async () => {
    await boot(() => useSingleOaEnv("upd-token"));
  });

  it("add_users → PUT /v2/bot/audienceGroup/upload with audienceGroupId + audiences", async () => {
    api.on("/v2/bot/audienceGroup/upload", {}, { method: "PUT" });
    const res = await mcp.callTool("line_update_audience", {
      mode: "add_users",
      audience_group_id: 500,
      user_ids: ["U1", "U2"],
    });
    expect(res.isError).toBeFalsy();
    const call = api.callsTo("/v2/bot/audienceGroup/upload")[0]!;
    expect(call.method).toBe("PUT");
    const body = call.body as { audienceGroupId: number; audiences: { id: string }[] };
    expect(body.audienceGroupId).toBe(500);
    expect(body.audiences).toHaveLength(2);
    expect(res.structuredContent).toMatchObject({ mode: "add_users", added_count: 2 });
  });

  it("rename → PUT /v2/bot/audienceGroup/{id}/updateDescription", async () => {
    api.on("/v2/bot/audienceGroup/500/updateDescription", {}, { method: "PUT" });
    const res = await mcp.callTool("line_update_audience", {
      mode: "rename",
      audience_group_id: 500,
      description: "VIP มิ.ย.",
    });
    expect(res.isError).toBeFalsy();
    const call = api.callsTo("/updateDescription")[0]!;
    expect(call.method).toBe("PUT");
    expect((call.body as { description: string }).description).toBe("VIP มิ.ย.");
    expect(res.structuredContent).toMatchObject({ mode: "rename", new_description: "VIP มิ.ย." });
  });

  it("add_users without user_ids → inline error, zero network calls", async () => {
    const res = await mcp.callTool("line_update_audience", { mode: "add_users", audience_group_id: 1 });
    expect(res.isError).toBe(true);
    expect(firstText(res)).toContain("ต้องการ user_ids");
    expect(api.calls).toHaveLength(0);
  });

  it("rename without description → inline error, zero network calls", async () => {
    const res = await mcp.callTool("line_update_audience", { mode: "rename", audience_group_id: 1 });
    expect(res.isError).toBe(true);
    expect(firstText(res)).toContain("ต้องการ description");
    expect(api.calls).toHaveLength(0);
  });

  it("400-with-details on a non-upload audience surfaces LINE's per-field breakdown", async () => {
    api.onError("/v2/bot/audienceGroup/upload", 400, "The request body has 1 error(s)", [
      { message: "not an upload audience", property: "audienceGroupId" },
    ]);
    const res = await mcp.callTool("line_update_audience", {
      mode: "add_users",
      audience_group_id: 7,
      user_ids: ["U1"],
    });
    expect(res.isError).toBe(true);
    const text = firstText(res);
    expect(text).toContain("LINE 400: The request body has 1 error(s)");
    expect(text).toContain("audienceGroupId: not an upload audience");
  });
});

// ============================================================================
// line_delete_audience  (confirm gate)
// ============================================================================
describe("line_delete_audience", () => {
  beforeEach(async () => {
    await boot(() => useSingleOaEnv("del-token"));
  });

  it("without confirm → blocked, zero network calls", async () => {
    const res = await mcp.callTool("line_delete_audience", { audience_group_id: 42 });
    expect(res.isError).toBe(true);
    expect(firstText(res)).toContain("confirm=true");
    expect(api.calls).toHaveLength(0);
  });

  it("with confirm → DELETE /v2/bot/audienceGroup/{id}", async () => {
    api.on("/v2/bot/audienceGroup/42", {}, { method: "DELETE" });
    const res = await mcp.callTool("line_delete_audience", { audience_group_id: 42, confirm: true });
    expect(res.isError).toBeFalsy();
    const call = api.callsTo("/v2/bot/audienceGroup/42")[0]!;
    expect(call.method).toBe("DELETE");
    expect(res.structuredContent).toEqual({ success: true, deleted_id: 42 });
  });

  it("rejects a non-positive audience_group_id with zero network calls", async () => {
    const res = await mcp.callTool("line_delete_audience", { audience_group_id: -1, confirm: true });
    expect(res.isError).toBe(true);
    expect(api.calls).toHaveLength(0);
  });

  it("404 surfaces the LINE error message", async () => {
    api.onError("/v2/bot/audienceGroup/99", 404, "not found");
    const res = await mcp.callTool("line_delete_audience", { audience_group_id: 99, confirm: true });
    expect(res.isError).toBe(true);
    expect(firstText(res)).toContain("LINE 404");
  });
});

// ============================================================================
// line_get_oa_report  (multi-day digest)
// ============================================================================
describe("line_get_oa_report", () => {
  beforeEach(async () => {
    await boot(() => useSingleOaEnv("report-token"));
  });

  it("builds a one-day digest from delivery + followers + demographic + quota", async () => {
    api.on("/v2/bot/insight/message/delivery", { body: { broadcast: 10, multicast: 5, push: 3, reply: 2 } });
    api.on("/v2/bot/insight/demographic", { body: { available: true } });
    api.on("/v2/bot/insight/followers", { body: { followers: 1500 } });
    mockQuota(1000, 100);

    const res = await mcp.callTool("line_get_oa_report", {
      range: { from: "2026-05-01", to: "2026-05-01" },
    });
    expect(res.isError).toBeFalsy();

    // Delivery insight was queried with the YYYYMMDD date
    const del = api.callsTo("/v2/bot/insight/message/delivery")[0]!;
    expect(del.method).toBe("GET");
    expect(del.url.searchParams.get("date")).toBe("20260501");

    const sc = res.structuredContent!;
    expect(sc.range).toEqual({ from: "2026-05-01", to: "2026-05-01" });
    const delivery = sc.delivery as { total: number; daily: { total: number }[] };
    expect(delivery.total).toBe(20);
    expect(delivery.daily).toHaveLength(1);
    expect(delivery.daily[0]!.total).toBe(20);
    expect(sc.followers).toMatchObject({ latest_count: 1500 });
    expect(sc.demographic_available).toBe(true);
    expect(sc.quota).toMatchObject({ used: 100, total: 1000 });
    expect((sc.notes as string[]).some((n) => n.includes("T-2"))).toBe(true);
  });

  it("rejects an invalid response_format with zero network calls", async () => {
    const res = await mcp.callTool("line_get_oa_report", { response_format: "csv" });
    expect(res.isError).toBe(true);
    expect(api.calls).toHaveLength(0);
  });
});

// ============================================================================
// line_get_message_stats
// ============================================================================
describe("line_get_message_stats", () => {
  beforeEach(async () => {
    await boot(() => useSingleOaEnv("stats-token"));
  });

  it("computes CTR from GET /v2/bot/insight/message/event", async () => {
    api.on("/v2/bot/insight/message/event", {
      body: {
        overview: { delivered: 1000, uniqueImpression: 800, uniqueClick: 40 },
        clicks: [{ seq: 1, url: "https://a", click: 60, uniqueClick: 40 }],
      },
    });

    const res = await mcp.callTool("line_get_message_stats", { request_id: "req-1" });
    expect(res.isError).toBeFalsy();
    const call = api.callsTo("/v2/bot/insight/message/event")[0]!;
    expect(call.method).toBe("GET");
    expect(call.url.searchParams.get("requestId")).toBe("req-1");

    const sc = res.structuredContent!;
    expect(sc).toMatchObject({
      request_id: "req-1",
      delivered: 1000,
      unique_impression: 800,
      unique_click: 40,
      ctr_percent: 5,
    });
    expect(sc.per_url_clicks as unknown[]).toHaveLength(1);
  });

  it("below the privacy floor → null impressions + privacy note, ctr null", async () => {
    api.on("/v2/bot/insight/message/event", { body: { overview: { delivered: 5 }, clicks: [] } });
    const res = await mcp.callTool("line_get_message_stats", { request_id: "req-small" });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent!;
    expect(sc.unique_impression).toBeNull();
    expect(sc.ctr_percent).toBeNull();
    expect((sc.notes as string[]).some((n) => n.includes("privacy floor"))).toBe(true);
  });

  it("rejects an empty request_id with zero network calls", async () => {
    const res = await mcp.callTool("line_get_message_stats", { request_id: "" });
    expect(res.isError).toBe(true);
    expect(api.calls).toHaveLength(0);
  });

  it("401 surfaces the Thai unauthorized message", async () => {
    api.onError("/v2/bot/insight/message/event", 401);
    const res = await mcp.callTool("line_get_message_stats", { request_id: "req-401" });
    expect(res.isError).toBe(true);
    expect(firstText(res)).toBe(TH.unauthorized);
  });
});

// ============================================================================
// line_estimate_send_cost  (reads quota + audience info)
// ============================================================================
describe("line_estimate_send_cost", () => {
  beforeEach(async () => {
    await boot(() => useSingleOaEnv("cost-token"));
  });

  it("user_ids: exact recipients × message_count against remaining quota", async () => {
    mockQuota(1000, 0);
    const res = await mcp.callTool("line_estimate_send_cost", {
      target: { user_ids: ["U1", "U2", "U3"] },
      message_count: 2,
    });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent!;
    expect(sc.estimated_recipients).toBe(3);
    expect(sc.estimated_cost_messages).toBe(6);
    expect(sc.quota).toMatchObject({ remaining: 1000 });
    expect(sc.cost_share_percent).toBe(0.6);
  });

  it("audience (numeric id): looks up audienceCount via GET /v2/bot/audienceGroup/{id}", async () => {
    api.on("/v2/bot/audienceGroup/555", {
      body: { audienceGroup: { audienceGroupId: 555, description: "vip", status: "READY", audienceCount: 200, created: 1 } },
    });
    mockQuota(10000, 0);
    const res = await mcp.callTool("line_estimate_send_cost", { target: { audience: "555" } });
    expect(res.isError).toBeFalsy();
    expect(api.callsTo("/v2/bot/audienceGroup/555")).toHaveLength(1);
    expect(res.structuredContent!.estimated_recipients).toBe(200);
  });

  it("everyone: recipients unknown, still reads quota + advises a dry_run", async () => {
    mockQuota(1000, 0);
    const res = await mcp.callTool("line_estimate_send_cost", { target: { everyone: true } });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent!;
    expect(sc.estimated_recipients).toBeUndefined();
    expect(sc.estimated_cost_messages).toBeUndefined();
    expect((sc.notes as string[]).some((n) => n.includes("Broadcast"))).toBe(true);
  });

  it("rejects an unrecognized target shape with zero network calls", async () => {
    const res = await mcp.callTool("line_estimate_send_cost", { target: { bogus: 1 } });
    expect(res.isError).toBe(true);
    expect(api.calls).toHaveLength(0);
  });
});

// ============================================================================
// line_get_narrowcast_progress
// ============================================================================
describe("line_get_narrowcast_progress", () => {
  beforeEach(async () => {
    await boot(() => useSingleOaEnv("narrow-token"));
  });

  it("polls GET /v2/bot/message/progress/narrowcast and maps phase → Thai", async () => {
    api.on("/v2/bot/message/progress/narrowcast", {
      body: {
        phase: "succeeded",
        successCount: 120,
        failureCount: 0,
        targetCount: 120,
        acceptedTime: "2026-05-01T10:00:00Z",
        completedTime: "2026-05-01T10:05:00Z",
      },
    });

    const res = await mcp.callTool("line_get_narrowcast_progress", { request_id: "r-1" });
    expect(res.isError).toBeFalsy();
    const call = api.callsTo("/v2/bot/message/progress/narrowcast")[0]!;
    expect(call.method).toBe("GET");
    expect(call.url.searchParams.get("requestId")).toBe("r-1");

    const sc = res.structuredContent!;
    expect(sc.phase).toBe("succeeded");
    expect(sc.status_text).toContain("ส่งเสร็จสมบูรณ์");
    expect(sc.success_count).toBe(120);
    expect(sc.target_count).toBe(120);
  });

  it("rejects a missing request_id with zero network calls", async () => {
    const res = await mcp.callTool("line_get_narrowcast_progress", {});
    expect(res.isError).toBe(true);
    expect(api.calls).toHaveLength(0);
  });

  it("400-with-details surfaces LINE's message + per-field breakdown", async () => {
    api.onError("/v2/bot/message/progress/narrowcast", 400, "bad request", [
      { message: "expired", property: "requestId" },
    ]);
    const res = await mcp.callTool("line_get_narrowcast_progress", { request_id: "gone" });
    expect(res.isError).toBe(true);
    const text = firstText(res);
    expect(text).toContain("LINE 400: bad request");
    expect(text).toContain("requestId: expired");
  });
});

// ============================================================================
// line_find_sticker  (local catalog — no network)
// ============================================================================
describe("line_find_sticker", () => {
  beforeEach(async () => {
    await boot(() => useSingleOaEnv("sticker-token"));
  });

  it("matches by Thai mood keyword and exposes package/sticker IDs", async () => {
    const res = await mcp.callTool("line_find_sticker", { query: "ขอบคุณ" });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent!;
    expect(sc.total_in_catalog).toBe(STICKER_CATALOG.length);
    const stickers = sc.stickers as { package_id: string; sticker_id: string; moods: string[] }[];
    expect(stickers.length).toBeGreaterThan(0);
    expect(stickers[0]!.package_id).toBeTruthy();
    expect(stickers.some((s) => s.moods.includes("thanks"))).toBe(true);
    expect(api.calls).toHaveLength(0);
  });

  it("no match → count 0 with a friendly Thai note", async () => {
    const res = await mcp.callTool("line_find_sticker", { query: "zxqwv-nomatch" });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent!.count).toBe(0);
    expect(firstText(res)).toContain("ไม่พบ sticker");
  });

  it("rejects a limit above 20 with zero network calls", async () => {
    const res = await mcp.callTool("line_find_sticker", { query: "hi", limit: 50 });
    expect(res.isError).toBe(true);
    expect(api.calls).toHaveLength(0);
  });
});

// ============================================================================
// line_design_flex  (local builder — no network)
// ============================================================================
describe("line_design_flex", () => {
  beforeEach(async () => {
    await boot(() => useSingleOaEnv("flex-token"));
  });

  it("template mode renders a bubble with a preview URL and size", async () => {
    const res = await mcp.callTool("line_design_flex", {
      template: "promo_simple",
      data: {
        title: "ลด 50%",
        subtitle: "เฉพาะวันนี้",
        image_url: "https://cdn/p.jpg",
        cta_label: "ช้อปเลย",
        cta_url: "https://shop/x",
      },
    });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent!;
    expect(sc.template).toBe("promo_simple");
    expect((sc.flex_json as Record<string, unknown>).type).toBe("bubble");
    expect(sc.alt_text as string).toContain("ลด 50%");
    expect(String(sc.preview_url)).toMatch(/^https:\/\/developers\.line\.biz\/flex-simulator\/\?json=/);
    expect(typeof sc.size_bytes).toBe("number");
    expect(sc.warnings).toEqual([]);
    expect(api.calls).toHaveLength(0);
  });

  it("list_templates returns the full catalog", async () => {
    const res = await mcp.callTool("line_design_flex", { list_templates: true });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent!.templates as unknown[]).toHaveLength(FLEX_TEMPLATE_CATALOG.length);
  });

  it("raw flex_json mode passes contents through with a custom alt_text", async () => {
    const res = await mcp.callTool("line_design_flex", {
      flex_json: { type: "bubble", body: { type: "box", layout: "vertical", contents: [] } },
      alt_text: "งานเทศกาล",
    });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent!;
    expect(sc.alt_text).toBe("งานเทศกาล");
    expect((sc.flex_json as Record<string, unknown>).type).toBe("bubble");
  });

  it("neither template/flex_json/list_templates → inline Thai error", async () => {
    const res = await mcp.callTool("line_design_flex", {});
    expect(res.isError).toBe(true);
    expect(firstText(res)).toContain("ต้องระบุอย่างใดอย่างหนึ่ง");
  });

  it("rejects an unknown template name with zero network calls", async () => {
    const res = await mcp.callTool("line_design_flex", { template: "nope", data: {} });
    expect(res.isError).toBe(true);
    expect(api.calls).toHaveLength(0);
  });
});

// ============================================================================
// line_design_card  (local template builder — no network)
// ============================================================================
describe("line_design_card", () => {
  beforeEach(async () => {
    await boot(() => useSingleOaEnv("card-token"));
  });

  it("confirm card builds a type=template/confirm message object", async () => {
    const res = await mcp.callTool("line_design_card", {
      kind: "confirm",
      alt_text: "ยืนยันการจอง",
      text: "ยืนยันการจองคิว 14:00 ไหม?",
      actions: [
        { type: "postback", label: "ตกลง", data: "confirm=1" },
        { type: "message", label: "ยกเลิก", text: "ยกเลิก" },
      ],
    });
    expect(res.isError).toBeFalsy();
    const message = res.structuredContent!.message as Record<string, unknown>;
    expect(message.type).toBe("template");
    expect(message.altText).toBe("ยืนยันการจอง");
    expect((message.template as Record<string, unknown>).type).toBe("confirm");
    expect(res.structuredContent!.usage_hint).toBeTruthy();
    expect(api.calls).toHaveLength(0);
  });

  it("buttons card builds a type=buttons template", async () => {
    const res = await mcp.callTool("line_design_card", {
      kind: "buttons",
      alt_text: "เมนูร้าน",
      title: "ร้านกาแฟ",
      text: "เลือกเมนู",
      actions: [{ type: "uri", label: "ดูเมนู", uri: "https://shop/menu" }],
    });
    expect(res.isError).toBeFalsy();
    const message = res.structuredContent!.message as Record<string, unknown>;
    expect((message.template as Record<string, unknown>).type).toBe("buttons");
  });

  it("carousel with unequal action counts → builder rejects (LINE rule)", async () => {
    const res = await mcp.callTool("line_design_card", {
      kind: "carousel",
      alt_text: "สินค้า",
      columns: [
        {
          text: "A",
          actions: [
            { type: "message", label: "x", text: "x" },
            { type: "message", label: "y", text: "y" },
          ],
        },
        { text: "B", actions: [{ type: "message", label: "z", text: "z" }] },
      ],
    });
    expect(res.isError).toBe(true);
    expect(firstText(res)).toContain("เท่ากัน");
    expect(api.calls).toHaveLength(0);
  });

  it("rejects a missing kind with zero network calls", async () => {
    const res = await mcp.callTool("line_design_card", { alt_text: "x" });
    expect(res.isError).toBe(true);
    expect(api.calls).toHaveLength(0);
  });
});

// ============================================================================
// line_design_imagemap  (local builder — no network)
// ============================================================================
describe("line_design_imagemap", () => {
  beforeEach(async () => {
    await boot(() => useSingleOaEnv("imap-token"));
  });

  it("builds a type=imagemap message with baseSize.width forced to 1040", async () => {
    const res = await mcp.callTool("line_design_imagemap", {
      base_url: "https://cdn.example.com/promo",
      alt_text: "โปรโมชั่นเดือนนี้",
      base_height: 1040,
      areas: [
        { bounds: { x: 0, y: 0, width: 1040, height: 520 }, action: { type: "uri", uri: "https://shop/a" } },
        { bounds: { x: 0, y: 520, width: 1040, height: 520 }, action: { type: "message", text: "สนใจ" } },
      ],
    });
    expect(res.isError).toBeFalsy();
    const message = res.structuredContent!.message as Record<string, unknown>;
    expect(message.type).toBe("imagemap");
    expect(message.baseUrl).toBe("https://cdn.example.com/promo");
    expect((message.baseSize as { width: number }).width).toBe(1040);
    expect(message.actions as unknown[]).toHaveLength(2);
    expect(api.calls).toHaveLength(0);
  });

  it("an area past the image bounds → builder rejects", async () => {
    const res = await mcp.callTool("line_design_imagemap", {
      base_url: "https://cdn.example.com/promo",
      alt_text: "x",
      base_height: 100,
      areas: [{ bounds: { x: 0, y: 0, width: 1040, height: 200 }, action: { type: "uri", uri: "https://a" } }],
    });
    expect(res.isError).toBe(true);
    expect(firstText(res)).toContain("เกินขอบรูป");
    expect(api.calls).toHaveLength(0);
  });

  it("rejects a non-URL base_url with zero network calls", async () => {
    const res = await mcp.callTool("line_design_imagemap", {
      base_url: "not-a-url",
      alt_text: "x",
      base_height: 100,
      areas: [{ bounds: { x: 0, y: 0, width: 10, height: 10 }, action: { type: "uri", uri: "https://a" } }],
    });
    expect(res.isError).toBe(true);
    expect(api.calls).toHaveLength(0);
  });
});

// ============================================================================
// line_manage_coupon  (4 modes + confirm gate)
// ============================================================================
describe("line_manage_coupon", () => {
  beforeEach(async () => {
    await boot(() => useSingleOaEnv("coupon-token"));
  });

  it("create maps friendly inputs → POST /v2/bot/coupon with the LINE schema", async () => {
    api.on("/v2/bot/coupon", { body: { couponId: "C-new" } }, { method: "POST" });
    const res = await mcp.callTool("line_manage_coupon", {
      mode: "create",
      data: {
        title: "Early Bird",
        discount_type: "percentage",
        discount_value: 20,
        valid_from: "2026-06-01",
        valid_to: "2026-06-08",
        coupon_code: "EARLYBIRD",
      },
    });
    expect(res.isError).toBeFalsy();
    const call = api.callsTo("/v2/bot/coupon")[0]!;
    expect(call.method).toBe("POST");
    const body = call.body as Record<string, unknown>;
    expect(body.title).toBe("Early Bird");
    expect(body.reward).toEqual({ type: "discount", priceInfo: { type: "percentage", percentage: 20 } });
    expect(body.timezone).toBe("ASIA_BANGKOK");
    expect(body.visibility).toBe("UNLISTED");
    expect(res.structuredContent!.coupon_id).toBe("C-new");
  });

  it("list → GET /v2/bot/coupon reading the items pager", async () => {
    api.on("/v2/bot/coupon", { body: { items: [{ couponId: "C1", title: "A" }, { couponId: "C2", title: "B" }] } }, { method: "GET" });
    const res = await mcp.callTool("line_manage_coupon", { mode: "list" });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent!.total).toBe(2);
    expect((res.structuredContent!.coupons as unknown[])).toHaveLength(2);
  });

  it("get → GET /v2/bot/coupon/{id}", async () => {
    api.on("/v2/bot/coupon/C9", { body: { couponId: "C9", title: "Z" } }, { method: "GET" });
    const res = await mcp.callTool("line_manage_coupon", { mode: "get", coupon_id: "C9" });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toMatchObject({ couponId: "C9", title: "Z" });
  });

  it("discontinue without confirm → blocked, zero network calls", async () => {
    const res = await mcp.callTool("line_manage_coupon", { mode: "discontinue", coupon_id: "C5" });
    expect(res.isError).toBe(true);
    expect(firstText(res)).toContain("confirm=true");
    expect(api.calls).toHaveLength(0);
  });

  it("discontinue with confirm → PUT /v2/bot/coupon/{id}/close", async () => {
    api.on("/v2/bot/coupon/C5/close", {}, { method: "PUT" });
    const res = await mcp.callTool("line_manage_coupon", { mode: "discontinue", coupon_id: "C5", confirm: true });
    expect(res.isError).toBeFalsy();
    const call = api.callsTo("/v2/bot/coupon/C5/close")[0]!;
    expect(call.method).toBe("PUT");
    expect(res.structuredContent).toEqual({ success: true, discontinued_id: "C5" });
  });

  it("create without a title → inline error, zero network calls", async () => {
    const res = await mcp.callTool("line_manage_coupon", { mode: "create", data: { discount_value: 20 } });
    expect(res.isError).toBe(true);
    expect(firstText(res)).toContain("data.title");
    expect(api.calls).toHaveLength(0);
  });

  it("create surfaces a LINE 400-with-details breakdown", async () => {
    api.onError("/v2/bot/coupon", 400, "The request body has 1 error(s)", [
      { message: "must be in the future", property: "startTimestamp" },
    ]);
    const res = await mcp.callTool("line_manage_coupon", {
      mode: "create",
      data: { title: "x", discount_type: "fixed", discount_value: 50, valid_from: "2026-06-01", valid_to: "2026-06-30" },
    });
    expect(res.isError).toBe(true);
    const text = firstText(res);
    expect(text).toContain("LINE 400: The request body has 1 error(s)");
    expect(text).toContain("startTimestamp: must be in the future");
  });

  it("rejects an unknown mode with zero network calls", async () => {
    const res = await mcp.callTool("line_manage_coupon", { mode: "frobnicate" });
    expect(res.isError).toBe(true);
    expect(api.calls).toHaveLength(0);
  });
});

// ============================================================================
// line_get_coupon_stats
// ============================================================================
describe("line_get_coupon_stats", () => {
  beforeEach(async () => {
    await boot(() => useSingleOaEnv("cstats-token"));
  });

  it("reads raw coupon detail and notes the missing click-audience", async () => {
    api.on("/v2/bot/coupon/C1", { body: { couponId: "C1", title: "โปร" } });
    const res = await mcp.callTool("line_get_coupon_stats", { coupon_id: "C1" });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent!;
    expect(sc.coupon_id).toBe("C1");
    expect(sc.raw).toMatchObject({ couponId: "C1", title: "โปร" });
    expect(sc.estimated_redemptions).toBeUndefined();
    expect((sc.notes as string[]).some((n) => n.includes("click_audience_id"))).toBe(true);
  });

  it("enriches with a click-audience size → estimated_redemptions", async () => {
    api.on("/v2/bot/coupon/C2", { body: { couponId: "C2" } });
    api.on("/v2/bot/audienceGroup/42", {
      body: { audienceGroup: { audienceGroupId: 42, description: "clickers", status: "READY", audienceCount: 88 } },
    });
    const res = await mcp.callTool("line_get_coupon_stats", { coupon_id: "C2", click_audience_id: 42 });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent!;
    expect(sc.estimated_redemptions).toBe(88);
    expect(sc.click_audience).toMatchObject({ id: 42, name: "clickers", audience_count: 88 });
  });

  it("degrades (not isError) when the coupon fetch fails — note + null raw", async () => {
    api.onError("/v2/bot/coupon/Cbad", 401);
    const res = await mcp.callTool("line_get_coupon_stats", { coupon_id: "Cbad" });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent!;
    expect(sc.raw).toBeNull();
    expect((sc.notes as string[]).some((n) => n.includes("ดึง coupon detail ไม่ได้"))).toBe(true);
  });

  it("rejects an empty coupon_id with zero network calls", async () => {
    const res = await mcp.callTool("line_get_coupon_stats", { coupon_id: "" });
    expect(res.isError).toBe(true);
    expect(api.calls).toHaveLength(0);
  });
});
