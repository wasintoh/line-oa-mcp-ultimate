/**
 * E2E tests — the Image Hosting Layer through the real MCP surface:
 * line_prepare_image → line_design_imagemap (prepared_key) → message JSON,
 * plus line_image_host_status and every guard rail between them.
 *
 * The tunnel provider is disabled via LINE_MCP_TUNNEL=off (no network in CI);
 * the "hosted" path is exercised with the REAL self provider serving from the
 * in-memory store over a real loopback http server — so store, route, verify,
 * resolve and both tools run together exactly as in production.
 */

import { createServer, type Server } from "node:http";
import { existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { Resvg } from "@resvg/resvg-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestMcp, firstText, type TestMcp } from "./helpers/mcp.js";
import { isolateConfigEnv, useSingleOaEnv } from "./helpers/env.js";
import { handleImageHostRequest } from "../src/imagehost/http-route.js";
import { imageStore } from "../src/imagehost/store.js";
import { registerSelfHost, __resetSelfHostForTests } from "../src/imagehost/providers/self.js";

let mcp: TestMcp;
let restoreEnv: () => void;
let savedTunnelEnv: string | undefined;
let savedPublicUrlEnv: string | undefined;
let loopback: Server | null = null;

function tinyPngBase64(): string {
  const png = new Resvg(
    '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#ff0000"/></svg>',
  )
    .render()
    .asPng();
  return Buffer.from(png).toString("base64");
}

beforeEach(async () => {
  restoreEnv = isolateConfigEnv();
  useSingleOaEnv("e2e-token"); // buildServer() needs a config even though these tools never touch LINE
  savedTunnelEnv = process.env.LINE_MCP_TUNNEL;
  savedPublicUrlEnv = process.env.MCP_PUBLIC_URL;
  process.env.LINE_MCP_TUNNEL = "off"; // never spawn cloudflared in tests
  delete process.env.MCP_PUBLIC_URL;
  __resetSelfHostForTests();
  imageStore.clear();
  mcp = await createTestMcp();
});

afterEach(async () => {
  await mcp?.close();
  if (loopback) {
    await new Promise<void>((resolve) => loopback!.close(() => resolve()));
    loopback = null;
  }
  imageStore.clear();
  __resetSelfHostForTests();
  if (savedTunnelEnv === undefined) delete process.env.LINE_MCP_TUNNEL;
  else process.env.LINE_MCP_TUNNEL = savedTunnelEnv;
  if (savedPublicUrlEnv === undefined) delete process.env.MCP_PUBLIC_URL;
  else process.env.MCP_PUBLIC_URL = savedPublicUrlEnv;
  restoreEnv();
});

describe("line_prepare_image — no automatic provider available", () => {
  it("falls back to a handoff zip with Thai instructions (never a dead end)", async () => {
    const result = await mcp.callTool("line_prepare_image", {
      image: { base64: tinyPngBase64() },
    });

    expect(result.isError).toBeFalsy();
    const out = result.structuredContent!;
    expect(out.provider).toBe("handoff");
    expect(typeof out.prepared_key).toBe("string");
    const handoff = out.handoff as { zipPath: string; fileNames: string[] };
    expect(existsSync(handoff.zipPath)).toBe(true);
    expect(handoff.fileNames).toEqual(["1040", "700", "460", "300", "240"]);
    expect(firstText(result)).toContain("app.netlify.com/drop");
  });

  it("rejects when zero or multiple image sources are provided", async () => {
    const none = await mcp.callTool("line_prepare_image", { image: {} });
    expect(none.isError).toBe(true);

    const both = await mcp.callTool("line_prepare_image", {
      image: { base64: tinyPngBase64(), source_url: "https://example.com/a.png" },
    });
    expect(both.isError).toBe(true);
    expect(firstText(both)).toContain("1 อย่าง");
  });

  it("rejects non-image bytes with an actionable error", async () => {
    const result = await mcp.callTool("line_prepare_image", {
      image: { base64: Buffer.from("definitely not an image").toString("base64") },
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("PNG");
  });
});

describe("line_prepare_image → line_design_imagemap happy path (self provider)", () => {
  it("hosts, verifies all 5 sizes, and design-imagemap auto-fills base_url + base_height", async () => {
    // Real loopback server serving the imagehost route (what http.ts does in HTTP mode).
    loopback = createServer((req, res) => {
      if (!handleImageHostRequest(req, res)) {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => loopback!.listen(0, "127.0.0.1", resolve));
    const port = (loopback!.address() as AddressInfo).port;
    registerSelfHost(`http://127.0.0.1:${port}`); // loopback http allowed for tests only

    const prepared = await mcp.callTool("line_prepare_image", {
      image: { base64: tinyPngBase64() },
    });
    expect(prepared.isError).toBeFalsy();
    const out = prepared.structuredContent!;
    expect(out.provider).toBe("self");
    expect(out.base_url).toContain(`127.0.0.1:${port}/i/`);
    expect(out.base_height).toBe(1040); // 8x8 square → 1040 at width 1040
    const verified = out.verified as Record<string, number>;
    for (const size of ["1040", "700", "460", "300", "240"]) {
      expect(verified[size]).toBe(200);
    }

    // The imagemap builder (correctly) refuses non-https base URLs per LINE's
    // contract. Production self/tunnel URLs are always https; the loopback test
    // server is plain http, so rewrite the RECORDED hosting to https before the
    // design step — verification already ran over the real http listener above.
    const hosting = imageStore.getHosting(out.prepared_key as string)!;
    const httpsBase = (hosting.baseUrl as string).replace("http://", "https://");
    imageStore.setHosting(out.prepared_key as string, { ...hosting, baseUrl: httpsBase });

    const designed = await mcp.callTool("line_design_imagemap", {
      prepared_key: out.prepared_key,
      alt_text: "โปรเดือนนี้",
      areas: [
        { bounds: { x: 0, y: 0, width: 1040, height: 1040 }, action: { type: "message", text: "สนใจ" } },
      ],
    });
    expect(designed.isError).toBeFalsy();
    const message = (designed.structuredContent as { message: Record<string, unknown> }).message;
    expect(message.type).toBe("imagemap");
    expect(message.baseUrl).toBe(httpsBase);
    expect((message.baseSize as { width: number; height: number }).height).toBe(1040);
  });
});

describe("line_design_imagemap — prepared_key guard rails", () => {
  it("errors helpfully on an unknown/expired key", async () => {
    const result = await mcp.callTool("line_design_imagemap", {
      prepared_key: "does-not-exist",
      alt_text: "x",
      areas: [{ bounds: { x: 0, y: 0, width: 10, height: 10 }, action: { type: "message", text: "y" } }],
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("line_prepare_image");
  });

  it("errors when both prepared_key and base_url are given", async () => {
    const result = await mcp.callTool("line_design_imagemap", {
      prepared_key: "k",
      base_url: "https://cdn.example.com/x",
      alt_text: "x",
      base_height: 1040,
      areas: [{ bounds: { x: 0, y: 0, width: 10, height: 10 }, action: { type: "message", text: "y" } }],
    });
    expect(result.isError).toBe(true);
  });

  it("still supports the classic base_url path but requires base_height (regression)", async () => {
    const missing = await mcp.callTool("line_design_imagemap", {
      base_url: "https://cdn.example.com/x",
      alt_text: "x",
      areas: [{ bounds: { x: 0, y: 0, width: 10, height: 10 }, action: { type: "message", text: "y" } }],
    });
    expect(missing.isError).toBe(true);
    expect(firstText(missing)).toContain("base_height");

    const ok = await mcp.callTool("line_design_imagemap", {
      base_url: "https://cdn.example.com/x",
      alt_text: "x",
      base_height: 1040,
      areas: [{ bounds: { x: 0, y: 0, width: 1040, height: 1040 }, action: { type: "message", text: "y" } }],
    });
    expect(ok.isError).toBeFalsy();
    const message = (ok.structuredContent as { message: Record<string, unknown> }).message;
    expect(message.baseUrl).toBe("https://cdn.example.com/x");
  });
});

describe("line_image_host_status", () => {
  it("reports the provider states truthfully", async () => {
    const result = await mcp.callTool("line_image_host_status", {});
    expect(result.isError).toBeFalsy();
    const out = result.structuredContent as {
      providers: {
        self: { available: boolean };
        local_tunnel: { disabled_by_env: boolean };
        handoff: { available: boolean };
      };
      tunnel: { active: boolean };
    };
    expect(out.providers.handoff.available).toBe(true);
    expect(out.providers.local_tunnel.disabled_by_env).toBe(true);
    expect(out.providers.self.available).toBe(false);
    expect(out.tunnel.active).toBe(false);
  });
});
