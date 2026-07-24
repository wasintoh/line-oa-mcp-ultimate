/**
 * Smoke test for the shared test harness (fetch mock + in-memory MCP pair).
 * If this file fails, every other tool test is built on sand — fix here first.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installFetchMock, type FetchMock } from "./helpers/fetch-mock.js";
import { isolateConfigEnv, useSingleOaEnv } from "./helpers/env.js";
import { createTestMcp, type TestMcp } from "./helpers/mcp.js";

describe("test harness smoke", () => {
  let restoreEnv: () => void;
  let api: FetchMock;
  let mcp: TestMcp;

  beforeEach(async () => {
    restoreEnv = isolateConfigEnv();
    useSingleOaEnv("smoke-token");
    api = installFetchMock();
    mcp = await createTestMcp();
  });

  afterEach(async () => {
    await mcp.close();
    api.uninstall();
    restoreEnv();
  });

  it("lists the 35 messaging tools when no MyShop key is configured", async () => {
    const { tools } = await mcp.client.listTools();
    expect(tools.length).toBe(35); // 34 v2.0 tools + line_design_rich_menu_image (v2.1)
    expect(tools.map((t) => t.name)).toContain("line_send_message");
    expect(tools.map((t) => t.name)).toContain("line_design_rich_menu_image");
  });

  it("dry_run hits /validate + quota endpoints and consumes nothing", async () => {
    // Register the more specific path FIRST — routes match by pathname
    // substring, so /quota would otherwise shadow /quota/consumption.
    api.on("/v2/bot/message/quota/consumption", { body: { totalUsage: 100 } });
    api.on("/v2/bot/message/quota", { body: { type: "limited", value: 1000 } }, { method: "GET" });

    const result = await mcp.callTool("line_send_message", {
      target: { user_id: "U1234567890" },
      message: { text: "สวัสดีค่ะ" },
      mode: "dry_run",
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent?.dry_run).toBe(true);
    expect(api.callsTo("/v2/bot/message/validate/push")).toHaveLength(1);
    expect(api.callsTo("/v2/bot/message/push")).toHaveLength(0);
    // Bearer token flows through to the LINE API
    expect(api.lastCall()?.headers.authorization).toBe("Bearer smoke-token");
  });
});
