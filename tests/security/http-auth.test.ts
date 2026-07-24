/**
 * HTTP transport auth tests — the headline v2.1 security fix.
 *
 * Starts the REAL http server (port 0 = ephemeral) and talks to it with the
 * REAL global fetch — no fetch mock here, we are testing the wire behavior:
 *   - loopback + no token → MCP responds
 *   - token set → missing/wrong token → 401 without any MCP processing
 *   - token set → correct token → JSON-RPC responds
 *   - non-loopback bind without token → startup refused with a Thai message
 *   - /health open in all modes
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startHttpServer, isLoopbackHost, type RunningHttpServer } from "../../src/http.js";
import { buildServer } from "../../src/server.js";
import { SERVER_NAME } from "../../src/constants.js";
import { isolateConfigEnv, useSingleOaEnv } from "../helpers/env.js";

const TEST_TOKEN = "s3cret-http-token-for-tests";

const INITIALIZE_BODY = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "vitest-http", version: "0.0.0" },
  },
});

function postInitialize(url: string, extraHeaders: Record<string, string> = {}): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...extraHeaders,
    },
    body: INITIALIZE_BODY,
  });
}

describe("HTTP transport auth", () => {
  let restoreEnv: () => void;
  let running: RunningHttpServer | undefined;

  beforeEach(() => {
    restoreEnv = isolateConfigEnv();
    useSingleOaEnv("http-auth-test-line-token");
  });

  afterEach(async () => {
    if (running) {
      await running.close();
      running = undefined;
    }
    restoreEnv();
    vi.restoreAllMocks();
  });

  it("loopback bind without token serves MCP requests (back-compat default)", async () => {
    running = await startHttpServer(buildServer(), { port: 0 });
    expect(running.host).toBe("127.0.0.1");

    const res = await postInitialize(running.url);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { result?: { serverInfo?: { name?: string } } };
    expect(json.result?.serverInfo?.name).toBe(SERVER_NAME);
  });

  it("rejects a missing token with 401 and never reaches the MCP layer", async () => {
    running = await startHttpServer(buildServer(), { port: 0, authToken: TEST_TOKEN });

    const res = await postInitialize(running.url);
    expect(res.status).toBe(401);
    const json = (await res.json()) as Record<string, unknown>;
    // Our own JSON error — not a JSON-RPC envelope (MCP never ran).
    expect(json.error).toContain("Authorization");
    expect(json).not.toHaveProperty("jsonrpc");
    expect(json).not.toHaveProperty("result");
    expect(res.headers.get("www-authenticate")).toContain("Bearer");
  });

  it("rejects a wrong token with 401", async () => {
    running = await startHttpServer(buildServer(), { port: 0, authToken: TEST_TOKEN });

    const res = await postInitialize(running.url, {
      authorization: "Bearer definitely-not-the-token",
    });
    expect(res.status).toBe(401);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).not.toHaveProperty("result");
  });

  it("rejects a same-length wrong token with 401 (timing-safe compare path)", async () => {
    running = await startHttpServer(buildServer(), { port: 0, authToken: TEST_TOKEN });

    const sameLength = "x".repeat(TEST_TOKEN.length);
    const res = await postInitialize(running.url, { authorization: `Bearer ${sameLength}` });
    expect(res.status).toBe(401);
  });

  it("accepts the correct token and answers JSON-RPC", async () => {
    running = await startHttpServer(buildServer(), { port: 0, authToken: TEST_TOKEN });

    const res = await postInitialize(running.url, { authorization: `Bearer ${TEST_TOKEN}` });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { result?: { serverInfo?: { name?: string } } };
    expect(json.result?.serverInfo?.name).toBe(SERVER_NAME);
  });

  it("refuses to start on a non-loopback host without a token (Thai message)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      startHttpServer(buildServer(), { host: "0.0.0.0", port: 0 }),
    ).rejects.toThrow(/MCP_HTTP_TOKEN/);
    const logged = spy.mock.calls.flat().join("\n");
    expect(logged).toContain("MCP_HTTP_TOKEN");
    expect(logged).toContain("ปฏิเสธ"); // Thai refusal explanation
  });

  it("starts on a non-loopback host when a token IS set", async () => {
    running = await startHttpServer(buildServer(), {
      host: "0.0.0.0",
      port: 0,
      authToken: TEST_TOKEN,
    });
    const res = await fetch(`http://127.0.0.1:${running.port}/health`);
    expect(res.status).toBe(200);
  });

  it("keeps /health open (and secret-free) in all modes", async () => {
    running = await startHttpServer(buildServer(), { port: 0, authToken: TEST_TOKEN });

    // No Authorization header at all — still 200.
    const res = await fetch(`http://127.0.0.1:${running.port}/health`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ ok: true, name: SERVER_NAME });
    expect(text).not.toContain(TEST_TOKEN);
    expect(text).not.toContain("http-auth-test-line-token");
  });

  it("still enforces the Origin allowlist (DNS-rebinding protection)", async () => {
    running = await startHttpServer(buildServer(), { port: 0, authToken: TEST_TOKEN });

    const res = await postInitialize(running.url, {
      authorization: `Bearer ${TEST_TOKEN}`,
      origin: "https://evil.example.com",
    });
    expect(res.status).toBe(403);
  });

  it("classifies loopback hosts correctly", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("127.1.2.3")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("[::1]")).toBe(true);
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
    expect(isLoopbackHost("192.168.1.20")).toBe(false);
    expect(isLoopbackHost("::")).toBe(false);
    expect(isLoopbackHost("example.com")).toBe(false);
  });
});
