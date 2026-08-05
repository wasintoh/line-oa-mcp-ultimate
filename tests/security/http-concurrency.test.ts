/**
 * HTTP transport concurrency + method-gate + multi-client-tripwire tests
 * (v2.2.1 regression suite).
 *
 * v2.2.0 built a fresh StreamableHTTPServerTransport per request but connected
 * every one of them to a SINGLE shared McpServer. Real MCP clients open a GET
 * (SSE) stream after initialize and POST while it is pending — the second
 * connect() then threw the SDK's "Already connected to a transport" and the
 * POST got a 500. T1 reproduces exactly that shape and fails on v2.2.0.
 *
 * NOTE (measured, 2026-08-05): plain concurrent POSTs do NOT trip the old bug
 * on loopback — the connect→respond→close cycle of a JSON POST never yields
 * between two POSTs (16/16 attempts passed on v2.2.0). The deterministic
 * killer is the held GET in T1. Do not "simplify" T1 into a Promise.all of
 * POSTs; it would stop guarding the regression.
 */

import { connect } from "node:net";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  startHttpServer,
  __resetHttpClientTrackingForTests,
  type RunningHttpServer,
} from "../../src/http.js";
import { buildServer } from "../../src/server.js";
import { isolateConfigEnv, twoOaConfig, useConfigFile, useSingleOaEnv } from "../helpers/env.js";
import { initializeBody, postInitialize, postJsonRpc, postToolCall } from "../helpers/http.js";

const WARNING_MARKER = "1 instance = 1 agent";

describe("HTTP transport concurrency (per-request server)", () => {
  let restoreEnv: () => void;
  let running: RunningHttpServer | undefined;

  beforeEach(() => {
    restoreEnv = isolateConfigEnv();
    useSingleOaEnv("http-concurrency-test-token");
    __resetHttpClientTrackingForTests();
  });

  afterEach(async () => {
    if (running) {
      await running.close();
      running = undefined;
    }
    restoreEnv();
    vi.restoreAllMocks();
  });

  const start = (): Promise<RunningHttpServer> => startHttpServer(buildServer, { port: 0 });

  it("T1: answers a POST while a GET request is being held open (the v2.2.0 killer)", async () => {
    running = await start();

    // Hold a GET open the way a real MCP client holds its SSE stream…
    const controller = new AbortController();
    try {
      const getRes = await fetch(running.url, {
        method: "GET",
        headers: { accept: "text/event-stream" },
        signal: controller.signal,
      });
      // …then POST while it is pending. On v2.2.0 this returned 500
      // ("Already connected to a transport").
      const postRes = await postInitialize(running.url);
      expect(postRes.status).toBe(200);

      // Stateless JSON mode has no push channel — the GET itself must be
      // answered 405 (never parked as a live stream: vanished peers would
      // leak a socket + per-request server per stream on a long-lived VPS).
      expect(getRes.status).toBe(405);
      expect(getRes.headers.get("allow")).toBe("POST");
    } finally {
      controller.abort();
    }
  });

  it("T2: two concurrent initialize POSTs both succeed (smoke — see header note)", async () => {
    running = await start();
    const [a, b] = await Promise.all([postInitialize(running.url), postInitialize(running.url)]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
  });

  it("T3: sequential requests keep working (this always worked — guard it anyway)", async () => {
    running = await start();
    for (let i = 0; i < 3; i++) {
      const res = await postInitialize(running.url);
      expect(res.status).toBe(200);
    }
  });

  it("T4: line_use_oa persists across separate HTTP requests (module-level state)", async () => {
    useConfigFile(twoOaConfig()); // ids: main (default) + shop2
    running = await start();

    const switched = await postToolCall(running.url, "line_use_oa", { oa_id: "shop2" });
    expect(switched.status).toBe(200);

    // A SEPARATE request — served by a brand-new per-request McpServer —
    // must still see the switch (active OA is module state by design).
    const listed = await postToolCall(running.url, "line_list_oas", {}, 3);
    expect(listed.status).toBe(200);
    const json = (await listed.json()) as {
      result?: { structuredContent?: { active_oa?: string } };
    };
    expect(json.result?.structuredContent?.active_oa).toBe("shop2");
  });

  it("T5: non-POST methods on the MCP path get 405 with Allow: POST", async () => {
    running = await start();
    for (const method of ["DELETE", "PUT"]) {
      const res = await fetch(running.url, { method });
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("POST");
    }
  });

  it("T6: warns (once) when a second distinct client joins while an OA switch is active", async () => {
    useConfigFile(twoOaConfig());
    running = await start();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Client A initializes, then switches the active OA.
    await postJsonRpc(running.url, initializeBody("agent-a", "1.0.0"));
    await postToolCall(running.url, "line_use_oa", { oa_id: "shop2" });

    // A DIFFERENT client joins mid-switch → the tripwire must fire.
    await postJsonRpc(running.url, initializeBody("agent-b", "1.0.0"));
    const warningsAfterB = spy.mock.calls.flat().filter(
      (m) => typeof m === "string" && m.includes(WARNING_MARKER),
    );
    expect(warningsAfterB).toHaveLength(1);

    // The SAME client re-initializing must NOT warn again.
    await postJsonRpc(running.url, initializeBody("agent-b", "1.0.0"));
    const warningsAfterRepeat = spy.mock.calls.flat().filter(
      (m) => typeof m === "string" && m.includes(WARNING_MARKER),
    );
    expect(warningsAfterRepeat).toHaveLength(1);
  });

  it("T8: a client aborting mid-POST-body does not kill the server", async () => {
    // A NAT reset / mobile drop mid-upload rejects the async request handler
    // where the body is read; unhandled, that rejection terminates the whole
    // process (verified: pre-existing on v2.2.0). The body read must live
    // inside the handler's try/catch.
    running = await start();

    await new Promise<void>((resolve) => {
      const sock = connect(running!.port, "127.0.0.1", () => {
        sock.write(
          "POST /mcp HTTP/1.1\r\n" +
            "Host: 127.0.0.1\r\n" +
            "Content-Type: application/json\r\n" +
            "Content-Length: 100000\r\n" +
            "\r\n" +
            '{"partial',
        );
        // Vanish mid-body without finishing the request.
        setTimeout(() => {
          sock.destroy();
          resolve();
        }, 120);
      });
    });
    // Give a would-be unhandled rejection time to surface (vitest fails on it).
    await new Promise((r) => setTimeout(r, 150));

    // The server must still be alive and serving.
    const res = await postInitialize(running.url);
    expect(res.status).toBe(200);
  });

  it("T7: no warning when only one client is present, even with a switch active", async () => {
    useConfigFile(twoOaConfig());
    running = await start();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    await postJsonRpc(running.url, initializeBody("agent-solo", "1.0.0"));
    await postToolCall(running.url, "line_use_oa", { oa_id: "shop2" });
    await postJsonRpc(running.url, initializeBody("agent-solo", "1.0.0"));

    const warnings = spy.mock.calls.flat().filter(
      (m) => typeof m === "string" && m.includes(WARNING_MARKER),
    );
    expect(warnings).toHaveLength(0);
  });
});
