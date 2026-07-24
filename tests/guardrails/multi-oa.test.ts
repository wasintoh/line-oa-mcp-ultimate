/**
 * Guardrail tests — multi-OA config loader (src/config/multi-oa.ts).
 *
 * Load priority (LINE_MCP_CONFIG > ~/.line-mcp/config.json > env token >
 * Thai missingToken error), resolveOa precedence (explicit arg > useOa()
 * active > LINE_MCP_DEFAULT_OA env > cfg.default_oa), listOas is_active,
 * invalid config shapes, and an E2E proof that line_use_oa switches the
 * Bearer token subsequent line_send_message calls carry.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  listOas,
  loadConfig,
  resetConfigCache,
  resolveOa,
  useOa,
} from "../../src/config/multi-oa.js";
import { TH } from "../../src/i18n/th.js";
import {
  isolateConfigEnv,
  twoOaConfig,
  useConfigFile,
  useDefaultHomeConfig,
  useSingleOaEnv,
} from "../helpers/env.js";
import { installFetchMock, type FetchMock } from "../helpers/fetch-mock.js";
import { createTestMcp, firstText, type TestMcp } from "../helpers/mcp.js";

let restoreEnv: () => void;

beforeEach(() => {
  restoreEnv = isolateConfigEnv();
});

afterEach(() => {
  restoreEnv();
});

/** Point HOME at an empty temp dir so the real ~/.line-mcp/config.json can never leak in. */
function useEmptyHome(): void {
  process.env.HOME = mkdtempSync(join(tmpdir(), "line-mcp-empty-home-"));
  resetConfigCache();
}

const THREE_OA_CONFIG = {
  default_oa: "main",
  oas: {
    main: { channel_access_token: "t-main", display_name: "Main" },
    shop2: { channel_access_token: "t-shop2", display_name: "Shop 2" },
    shop3: { channel_access_token: "t-shop3", display_name: "Shop 3" },
  },
};

describe("config load priority", () => {
  it("LINE_MCP_CONFIG beats the default home config AND the env token", () => {
    useSingleOaEnv("env-token");
    useDefaultHomeConfig({
      default_oa: "homeoa",
      oas: { homeoa: { channel_access_token: "token-home" } },
    });
    useConfigFile({
      default_oa: "explicit",
      oas: { explicit: { channel_access_token: "token-explicit" } },
    });

    const { id, config } = resolveOa();
    expect(id).toBe("explicit");
    expect(config.channel_access_token).toBe("token-explicit");
  });

  it("default ~/.line-mcp/config.json beats the env token when LINE_MCP_CONFIG is unset", () => {
    useSingleOaEnv("env-token");
    useDefaultHomeConfig({
      default_oa: "homeoa",
      oas: { homeoa: { channel_access_token: "token-home" } },
    });

    const { id, config } = resolveOa();
    expect(id).toBe("homeoa");
    expect(config.channel_access_token).toBe("token-home");
  });

  it("falls back to LINE_CHANNEL_ACCESS_TOKEN as a single 'default' OA", () => {
    useEmptyHome();
    useSingleOaEnv("env-only-token");

    const { id, config } = resolveOa();
    expect(id).toBe("default");
    expect(config.channel_access_token).toBe("env-only-token");
    expect(config.display_name).toBe("Default OA (from env)");
  });

  it("no source at all → throws the Thai missingToken message", () => {
    useEmptyHome();
    expect(() => loadConfig()).toThrow(TH.missingToken);
    expect(() => resolveOa()).toThrow(TH.missingToken);
  });
});

describe("resolveOa precedence (explicit arg > useOa active > LINE_MCP_DEFAULT_OA > default_oa)", () => {
  beforeEach(() => {
    useConfigFile(THREE_OA_CONFIG);
  });

  it("with nothing set, uses cfg.default_oa", () => {
    const { id, config } = resolveOa();
    expect(id).toBe("main");
    expect(config.channel_access_token).toBe("t-main");
  });

  it("LINE_MCP_DEFAULT_OA env beats cfg.default_oa", () => {
    process.env.LINE_MCP_DEFAULT_OA = "shop3";
    const { id } = resolveOa();
    expect(id).toBe("shop3");
  });

  it("useOa() active switch beats the env default", () => {
    process.env.LINE_MCP_DEFAULT_OA = "shop3";
    useOa("shop2");
    const { id, config } = resolveOa();
    expect(id).toBe("shop2");
    expect(config.channel_access_token).toBe("t-shop2");
  });

  it("explicit argument beats everything", () => {
    process.env.LINE_MCP_DEFAULT_OA = "shop3";
    useOa("shop2");
    const { id, config } = resolveOa("main");
    expect(id).toBe("main");
    expect(config.channel_access_token).toBe("t-main");
  });

  it("unknown explicit id → Thai oaNotFound", () => {
    expect(() => resolveOa("ghost")).toThrow(TH.oaNotFound("ghost"));
  });

  it("unknown LINE_MCP_DEFAULT_OA → Thai oaNotFound naming the bad id", () => {
    process.env.LINE_MCP_DEFAULT_OA = "phantom";
    expect(() => resolveOa()).toThrow(TH.oaNotFound("phantom"));
  });

  it("useOa() with an unknown id → Thai oaNotFound and does NOT change the active OA", () => {
    expect(() => useOa("ghost")).toThrow(TH.oaNotFound("ghost"));
    expect(resolveOa().id).toBe("main");
  });
});

describe("listOas is_active flag", () => {
  it("marks the default OA active before any switch, and follows useOa()", () => {
    useConfigFile(THREE_OA_CONFIG);

    const before = listOas();
    expect(before).toHaveLength(3);
    expect(before.find((o) => o.id === "main")?.is_active).toBe(true);
    expect(before.filter((o) => o.is_active)).toHaveLength(1);

    useOa("shop2");
    const after = listOas();
    expect(after.find((o) => o.id === "shop2")?.is_active).toBe(true);
    expect(after.find((o) => o.id === "main")?.is_active).toBe(false);
    expect(after.filter((o) => o.is_active)).toHaveLength(1);
  });
});

describe("invalid config shapes", () => {
  it("missing 'oas' object → clear error", () => {
    useConfigFile({});
    expect(() => loadConfig()).toThrow(/missing 'oas' object/);
  });

  it("default_oa not present in oas → clear error naming the bad id", () => {
    useConfigFile({ default_oa: "x", oas: { main: { channel_access_token: "t" } } });
    expect(() => loadConfig()).toThrow(/default_oa 'x' not present/);
  });

  it("default_oa absent entirely → default_oa error", () => {
    useConfigFile({ oas: { main: { channel_access_token: "t" } } });
    expect(() => loadConfig()).toThrow(/default_oa/);
  });

  it("an OA without channel_access_token → clear error naming the OA", () => {
    useConfigFile({ default_oa: "main", oas: { main: { display_name: "no token" } } });
    expect(() => loadConfig()).toThrow(/OA 'main' is missing channel_access_token/);
  });

  it("unreadable LINE_MCP_CONFIG path → 'Failed to read config' error", () => {
    process.env.LINE_MCP_CONFIG = "/nonexistent/line-mcp-config.json";
    resetConfigCache();
    expect(() => loadConfig()).toThrow(/Failed to read config at \/nonexistent\/line-mcp-config\.json/);
  });
});

describe("E2E — line_use_oa switches the Bearer token on subsequent sends", () => {
  let api: FetchMock;
  let mcp: TestMcp;

  beforeEach(async () => {
    useConfigFile(twoOaConfig());
    api = installFetchMock();
    // Ample quota so the Quota Guardian passes cleanly (consumption route first — substring routing).
    api.on("/v2/bot/message/quota/consumption", { body: { totalUsage: 0 } });
    api.on("/v2/bot/message/quota", { body: { type: "limited", value: 1000 } }, { method: "GET" });
    mcp = await createTestMcp();
  });

  afterEach(async () => {
    await mcp.close();
    api.uninstall();
  });

  it("default OA sends with token-main; after line_use_oa sends carry token-shop2; explicit oa arg overrides", async () => {
    const send = (extra: Record<string, unknown> = {}) =>
      mcp.callTool("line_send_message", {
        target: { user_id: "U-customer" },
        message: { text: "ทดสอบ" },
        ...extra,
      });

    // 1 — default_oa "main"
    const r1 = await send();
    expect(r1.isError).toBeFalsy();
    let pushes = api.callsTo("/v2/bot/message/push");
    expect(pushes).toHaveLength(1);
    expect(pushes[0]!.headers.authorization).toBe("Bearer token-main");

    // 2 — switch active OA
    const switched = await mcp.callTool("line_use_oa", { oa_id: "shop2" });
    expect(switched.isError).toBeFalsy();
    expect(switched.structuredContent).toEqual({ active_oa: "shop2", display_name: "Shop 2" });

    const r2 = await send();
    expect(r2.isError).toBeFalsy();
    pushes = api.callsTo("/v2/bot/message/push");
    expect(pushes).toHaveLength(2);
    expect(pushes[1]!.headers.authorization).toBe("Bearer token-shop2");

    // 3 — explicit oa param still beats the active switch
    const r3 = await send({ oa: "main" });
    expect(r3.isError).toBeFalsy();
    pushes = api.callsTo("/v2/bot/message/push");
    expect(pushes).toHaveLength(3);
    expect(pushes[2]!.headers.authorization).toBe("Bearer token-main");
  });

  it("line_use_oa with an unknown id returns the Thai oaNotFound error", async () => {
    const result = await mcp.callTool("line_use_oa", { oa_id: "ghost" });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain(TH.oaNotFound("ghost"));
  });

  it("line_send_message with an unknown explicit oa returns the Thai oaNotFound error, zero sends", async () => {
    const result = await mcp.callTool("line_send_message", {
      target: { user_id: "U-customer" },
      message: { text: "ทดสอบ" },
      oa: "ghost",
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain(TH.oaNotFound("ghost"));
    expect(api.callsTo("/v2/bot/message/push")).toHaveLength(0);
  });
});
