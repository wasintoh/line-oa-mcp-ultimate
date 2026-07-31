/**
 * E2E tests — line_send_message through the real MCP client (tests/helpers/mcp.ts)
 * with all LINE traffic intercepted by the fetch mock.
 *
 * Proves the guardrail pipeline end-to-end: validate-before-send ordering,
 * retry-key header, dry_run isolation, draft zero-send guarantee, broadcast
 * confirm gate, quota soft-block + confirm override, quiet-hours warning
 * (fake Date, timers stay real), LINE error surfacing (400 details / 401 /
 * 429 in Thai), schema rejection with zero network calls, quiet_push, and
 * the reply_to no-fallback gap (pinned as current behavior).
 *
 * Fetch-mock routing is SUBSTRING based — "/v2/bot/message/quota" must be
 * registered AFTER "/v2/bot/message/quota/consumption".
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TH } from "../src/i18n/th.js";
import { installFetchMock, type FetchMock } from "./helpers/fetch-mock.js";
import { isolateConfigEnv, useSingleOaEnv } from "./helpers/env.js";
import { createTestMcp, firstText, type TestMcp } from "./helpers/mcp.js";

const SEND_PATHS = [
  "/v2/bot/message/push",
  "/v2/bot/message/multicast",
  "/v2/bot/message/broadcast",
  "/v2/bot/message/narrowcast",
] as const;

let restoreEnv: () => void;
let api: FetchMock;
let mcp: TestMcp;

beforeEach(async () => {
  restoreEnv = isolateConfigEnv();
  useSingleOaEnv("e2e-token");
  api = installFetchMock();
  mcp = await createTestMcp();
});

afterEach(async () => {
  vi.useRealTimers();
  await mcp.close();
  api.uninstall();
  restoreEnv();
});

/** Register quota + consumption (consumption FIRST — substring routing). */
function mockQuota(value: number, used: number): void {
  api.on("/v2/bot/message/quota/consumption", { body: { totalUsage: used } });
  api.on("/v2/bot/message/quota", { body: { type: "limited", value } }, { method: "GET" });
}

function sendPathCallCounts(): Record<string, number> {
  return Object.fromEntries(SEND_PATHS.map((p) => [p, api.callsTo(p).length]));
}

describe("send_now — push happy path", () => {
  it("validates BEFORE sending, carries x-line-retry-key, returns success structured content", async () => {
    // Pin the clock to 12:00 BKK — otherwise this test fails between 22:00-08:00
    // BKK when the (correct) quiet-hours warning appears. Timers stay real.
    vi.useFakeTimers({ now: new Date("2026-01-15T05:00:00Z"), toFake: ["Date"] });
    mockQuota(1000, 100); // remaining 900

    const result = await mcp.callTool("line_send_message", {
      target: { user_id: "U-happy" },
      message: { text: "สวัสดีตอนเที่ยง" },
    });

    expect(result.isError).toBeFalsy();

    // /validate/push called exactly once, BEFORE /push
    const validateIdx = api.calls.findIndex((c) =>
      c.url.pathname.includes("/v2/bot/message/validate/push"),
    );
    const pushIdx = api.calls.findIndex(
      (c) => c.url.pathname === "/v2/bot/message/push",
    );
    expect(validateIdx).toBeGreaterThanOrEqual(0);
    expect(pushIdx).toBeGreaterThanOrEqual(0);
    expect(validateIdx).toBeLessThan(pushIdx);
    expect(api.callsTo("/v2/bot/message/validate/push")).toHaveLength(1);

    // The send carries a UUID retry key; the validate call does not
    const push = api.callsTo("/v2/bot/message/push")[0]!;
    expect(push.headers["x-line-retry-key"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(push.headers.authorization).toBe("Bearer e2e-token");
    expect(push.body).toEqual({ to: "U-happy", messages: [{ type: "text", text: "สวัสดีตอนเที่ยง" }] });
    const validate = api.callsTo("/v2/bot/message/validate/push")[0]!;
    expect(validate.headers["x-line-retry-key"]).toBeUndefined();

    // Structured output
    expect(result.structuredContent).toMatchObject({
      success: true,
      transport: "push",
      recipient_count_estimated: 1,
      quota: { used: 100, total: 1000, remaining: 900, percentage_used: 10 },
      warnings: [],
    });
    expect(firstText(result)).toContain("✅");
  });
});

describe("mode: dry_run", () => {
  it("hits /validate + quota endpoints ONLY — zero send calls", async () => {
    mockQuota(1000, 250);

    const result = await mcp.callTool("line_send_message", {
      target: { user_id: "U-dry" },
      message: { text: "ทดสอบ dry run" },
      mode: "dry_run",
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      dry_run: true,
      transport: "push",
      validated: true,
      projected_recipients: 1,
      projected_cost_messages: 1,
      quota: { used: 250, total: 1000, remaining: 750, percentage_used: 25 },
    });

    expect(api.callsTo("/v2/bot/message/validate/push")).toHaveLength(1);
    expect(api.callsTo("/v2/bot/message/quota")).toHaveLength(2); // quota + consumption
    expect(sendPathCallCounts()).toEqual({
      "/v2/bot/message/push": 0,
      "/v2/bot/message/multicast": 0,
      "/v2/bot/message/broadcast": 0,
      "/v2/bot/message/narrowcast": 0,
    });
    // Exactly validate + quota + consumption — nothing else left the process
    expect(api.calls).toHaveLength(3);
  });
});

describe("mode: draft", () => {
  it("never touches a send endpoint and returns oa_manager_url + 6 copy_paste_steps", async () => {
    const result = await mcp.callTool("line_send_message", {
      target: { audience: "7777" },
      message: { text: "โปรวันแม่" },
      mode: "draft",
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent!;
    expect(sc.draft).toBe(true);
    expect(sc.oa_manager_url).toBe("https://manager.line.biz/account/@default/broadcast/");
    expect(sc.copy_paste_steps).toHaveLength(6);
    expect(sc.audience_summary).toEqual({ id: "7777", name: "7777" });

    // ZERO send effects; the only network the code performs is the pre-flight validate
    expect(sendPathCallCounts()).toEqual({
      "/v2/bot/message/push": 0,
      "/v2/bot/message/multicast": 0,
      "/v2/bot/message/broadcast": 0,
      "/v2/bot/message/narrowcast": 0,
    });
    expect(api.callsTo("/v2/bot/message/quota")).toHaveLength(0);
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]!.url.pathname).toBe("/v2/bot/message/validate/narrowcast");
  });

  it("flex template message → flex_json_pretty + flex_preview_url present", async () => {
    const result = await mcp.callTool("line_send_message", {
      target: { audience: "7777" },
      message: {
        template: "promo_simple",
        data: {
          title: "ลด 50%",
          subtitle: "เฉพาะวันนี้",
          image_url: "https://example.com/promo.jpg",
          cta_label: "ช้อปเลย",
          cta_url: "https://example.com/shop",
        },
      },
      mode: "draft",
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent!;
    expect(typeof sc.flex_json_pretty).toBe("string");
    expect(sc.flex_json_pretty).toContain("ลด 50%");
    expect(String(sc.flex_preview_url)).toMatch(
      /^https:\/\/developers\.line\.biz\/flex-simulator\/\?json=/,
    );
    expect(sc.copy_paste_steps).toHaveLength(6);
    // Step 4 tells the user to paste the Flex JSON
    expect((sc.copy_paste_steps as string[])[3]).toContain("Flex");
    expect(sendPathCallCounts()).toEqual({
      "/v2/bot/message/push": 0,
      "/v2/bot/message/multicast": 0,
      "/v2/bot/message/broadcast": 0,
      "/v2/bot/message/narrowcast": 0,
    });
  });
});

describe("broadcast confirm gate (everyone: true)", () => {
  it("without confirm → isError with Thai text mentioning confirm; /broadcast never called", async () => {
    mockQuota(1000, 0);

    const result = await mcp.callTool("line_send_message", {
      target: { everyone: true },
      message: { text: "ประกาศ" },
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("confirm=true");
    expect(firstText(result)).toContain("Broadcast ถึงทุกคน");
    expect(api.callsTo("/v2/bot/message/broadcast")).toHaveLength(0);
  });

  it("with confirm + quota ok → /broadcast called with retry key", async () => {
    mockQuota(1000, 0);

    const result = await mcp.callTool("line_send_message", {
      target: { everyone: true },
      message: { text: "ประกาศ" },
      confirm: true,
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ success: true, transport: "broadcast" });
    const casts = api.callsTo("/v2/bot/message/broadcast");
    expect(casts).toHaveLength(1);
    expect(casts[0]!.headers["x-line-retry-key"]).toBeTruthy();
    expect(api.callsTo("/v2/bot/message/validate/broadcast")).toHaveLength(1);
  });
});

describe("quota soft-block (Quota Guardian through the tool)", () => {
  it("99 recipients against remaining 100 → needs-confirmation error, zero multicast calls", async () => {
    mockQuota(1000, 900); // remaining 100
    const userIds = Array.from({ length: 99 }, (_, i) => `U${i}`);

    const result = await mcp.callTool("line_send_message", {
      target: { user_ids: userIds },
      message: { text: "โปรใหญ่" },
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toBe(TH.quotaWarning(99, 100, 99));
    expect(firstText(result)).toContain("confirm=true");
    expect(api.callsTo("/v2/bot/message/multicast")).toHaveLength(0);
  });

  it("same send passes with confirm:true and surfaces the >50% advisory warning", async () => {
    mockQuota(1000, 900);
    const userIds = Array.from({ length: 99 }, (_, i) => `U${i}`);

    const result = await mcp.callTool("line_send_message", {
      target: { user_ids: userIds },
      message: { text: "โปรใหญ่" },
      confirm: true,
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      success: true,
      transport: "multicast",
      recipient_count_estimated: 99,
    });
    const warnings = result.structuredContent!.warnings as string[];
    expect(warnings.some((w) => w.includes("99%"))).toBe(true);

    const casts = api.callsTo("/v2/bot/message/multicast");
    expect(casts).toHaveLength(1); // 99 ≤ 500 → single chunk
    expect((casts[0]!.body as { to: string[] }).to).toHaveLength(99);
  });

  it("hard over-quota (projected > remaining) blocks even WITH confirm:true", async () => {
    mockQuota(1000, 950); // remaining 50
    const userIds = Array.from({ length: 51 }, (_, i) => `U${i}`);

    const result = await mcp.callTool("line_send_message", {
      target: { user_ids: userIds },
      message: { text: "เกิน quota" },
      confirm: true,
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toBe(TH.quotaExceeded(51, 50));
    expect(api.callsTo("/v2/bot/message/multicast")).toHaveLength(0);
  });
});

describe("quiet hours (23:00 BKK = 16:00 UTC, fake Date only)", () => {
  it("warning present without force — but the message still sends (warning-only)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-24T16:00:00Z"));
    mockQuota(1000, 0);

    const result = await mcp.callTool("line_send_message", {
      target: { user_id: "U-night" },
      message: { text: "ดึกแล้วนะ" },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ success: true, transport: "push" });
    const warnings = result.structuredContent!.warnings as string[];
    expect(warnings).toContain(TH.quietHoursWarning(23));
    expect(firstText(result)).toContain("quiet hours");
    expect(api.callsTo("/v2/bot/message/push")).toHaveLength(1);
  });

  it("force:true suppresses the warning entirely", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-24T16:00:00Z"));
    mockQuota(1000, 0);

    const result = await mcp.callTool("line_send_message", {
      target: { user_id: "U-night" },
      message: { text: "ดึกแล้วนะ" },
      force: true,
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent!.warnings).toEqual([]);
    expect(api.callsTo("/v2/bot/message/push")).toHaveLength(1);
  });

  it("daytime (12:00 BKK) has no quiet-hours warning", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-24T05:00:00Z"));
    mockQuota(1000, 0);

    const result = await mcp.callTool("line_send_message", {
      target: { user_id: "U-day" },
      message: { text: "สวัสดีตอนเที่ยง" },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent!.warnings).toEqual([]);
  });
});

describe("LINE error surfacing (Thai)", () => {
  it("/validate/push 400 with details[] → isError with each detail line surfaced", async () => {
    api.onError("/v2/bot/message/validate/push", 400, "The request body has 2 error(s)", [
      { message: "May not be empty", property: "messages[0].text" },
      { message: "Invalid type", property: "messages[0].type" },
    ]);

    const result = await mcp.callTool("line_send_message", {
      target: { user_id: "U-bad" },
      message: { text: "x" },
    });

    expect(result.isError).toBe(true);
    const text = firstText(result);
    expect(text).toContain("LINE 400: The request body has 2 error(s)");
    expect(text).toContain("messages[0].text: May not be empty");
    expect(text).toContain("messages[0].type: Invalid type");
    expect(api.callsTo("/v2/bot/message/push")).toHaveLength(0);
  });

  it("401 → the exact Thai TH.unauthorized message", async () => {
    api.onError("/v2/bot/message/validate/push", 401);

    const result = await mcp.callTool("line_send_message", {
      target: { user_id: "U-401" },
      message: { text: "token เสีย" },
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toBe(TH.unauthorized);
  });

  it("429 → the exact Thai TH.rateLimited message", async () => {
    api.onError("/v2/bot/message/validate/push", 429);

    const result = await mcp.callTool("line_send_message", {
      target: { user_id: "U-429" },
      message: { text: "เร็วไป" },
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toBe(TH.rateLimited);
  });
});

describe("schema rejection — invalid input never reaches the network", () => {
  it("unknown message key is rejected with input issues, zero network calls", async () => {
    // The MCP SDK validates the input schema before the handler runs; the
    // high-level client surfaces that as an isError result carrying the
    // InvalidParams (-32602) validation report.
    const result = await mcp.callTool("line_send_message", {
      target: { user_id: "U-x" },
      message: { bogus_key: "??" },
    });

    expect(result.isError).toBe(true);
    const text = firstText(result);
    expect(text).toContain("Input validation error");
    expect(text).toContain("line_send_message");
    expect(text).toContain("bogus_key");
    expect(api.calls).toHaveLength(0);
  });

  it("missing target is rejected, zero network calls", async () => {
    const result = await mcp.callTool("line_send_message", {
      message: { text: "ไม่มี target" },
    });

    expect(result.isError).toBe(true);
    const text = firstText(result);
    expect(text).toContain("Input validation error");
    expect(text).toContain("target");
    expect(text).toContain("Required");
    expect(api.calls).toHaveLength(0);
  });

  it("PINNED GAP: unknown top-level keys are silently STRIPPED, not rejected", async () => {
    // InputSchema is .strict(), but registerTool receives InputSchema.shape and
    // the SDK re-wraps it in a non-strict z.object() — so top-level strictness
    // is lost at the MCP boundary (nested schemas stay strict). Pinned so a
    // future fix must consciously flip this assertion.
    mockQuota(1000, 0);
    const result = await mcp.callTool("line_send_message", {
      target: { user_id: "U-x" },
      message: { text: "ok" },
      not_a_param: true,
    });

    expect(result.isError).toBeFalsy();
    expect(api.callsTo("/v2/bot/message/push")).toHaveLength(1);
  });
});

describe("quiet_push (silent send)", () => {
  it("quiet_push:true → every message in the push body carries notificationDisabled:true", async () => {
    mockQuota(1000, 0);

    const result = await mcp.callTool("line_send_message", {
      target: { user_id: "U-silent" },
      message: { text: "เงียบๆ" },
      quiet_push: true,
    });

    expect(result.isError).toBeFalsy();
    const push = api.callsTo("/v2/bot/message/push")[0]!;
    const body = push.body as { messages: Record<string, unknown>[] };
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]!.notificationDisabled).toBe(true);

    // default (quiet_push omitted) → flag absent
    const r2 = await mcp.callTool("line_send_message", {
      target: { user_id: "U-loud" },
      message: { text: "ดังๆ" },
    });
    expect(r2.isError).toBeFalsy();
    const push2 = api.callsTo("/v2/bot/message/push")[1]!;
    const body2 = push2.body as { messages: Record<string, unknown>[] };
    expect(body2.messages[0]!.notificationDisabled).toBeUndefined();
  });
});

describe("v2.1 FIX — target.reply_to without a usable token returns an honest Thai error", () => {
  it("reply_to surfaces TH.replyTokenUnavailable early, with zero network calls", async () => {
    mockQuota(1000, 0);

    const result = await mcp.callTool("line_send_message", {
      target: { reply_to: "evt-webhook-1" },
      message: { text: "ตอบกลับ" },
    });

    // v2.0 threw a generic English error wrapped in TH.unknownError and made a
    // pointless /validate/push [] call. v2.1 returns an actionable Thai error
    // BEFORE any network traffic (a push fallback is impossible — we only have
    // a webhookEventId, not a user id).
    expect(result.isError).toBe(true);
    const text = firstText(result);
    expect(text).toContain("ใช้ reply token ไม่ได้");
    expect(text).toContain("user_id"); // actionable next step
    expect(api.callsTo("/v2/bot/message")).toHaveLength(0); // no reply/push/validate at all
  });
});
