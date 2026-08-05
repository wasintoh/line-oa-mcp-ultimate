/**
 * Tests for verify.ts (URL verification with a mocked global fetch) and
 * http-route.ts (served through a REAL node:http server on an ephemeral port).
 *
 * The traversal case is checked twice on purpose: once through real fetch
 * (which normalizes "/i/../.." away before the wire) and once by calling the
 * handler directly with a hand-built request, proving the regex itself — not
 * client normalization — rejects traversal paths.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { describe, it, expect, afterEach, vi } from "vitest";

import { IMAGEMAP_SIZES } from "../src/constants.js";
import { handleImageHostRequest } from "../src/imagehost/http-route.js";
import { imageStore } from "../src/imagehost/store.js";
import type { ImageVariants } from "../src/imagehost/types.js";
import { verifyUrls } from "../src/imagehost/verify.js";

// ---------------------------------------------------------------------------
// verifyUrls — mocked global fetch
// ---------------------------------------------------------------------------

const URLS = {
  "1040": "https://host.example.com/i/k/1040",
  "700": "https://host.example.com/i/k/700",
  "240": "https://host.example.com/i/k/240",
};

describe("verifyUrls", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports ok when every HEAD answers 200", async () => {
    const mock = vi.fn(async () => ({ status: 200 }));
    vi.stubGlobal("fetch", mock);

    const report = await verifyUrls(URLS);
    expect(report.ok).toBe(true);
    expect(report.statuses).toEqual({ "1040": 200, "700": 200, "240": 200 });
    expect(report.failedSizes).toEqual([]);
    expect(mock).toHaveBeenCalledTimes(3);
    // Every probe must be a HEAD carrying an abort signal.
    for (const call of mock.mock.calls as unknown as [string, RequestInit][]) {
      expect(call[1]?.method).toBe("HEAD");
      expect(call[1]?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("reports ok=false and lists the failed size when one URL is 404", async () => {
    const mock = vi.fn(async (url: string) => ({ status: url.endsWith("/700") ? 404 : 200 }));
    vi.stubGlobal("fetch", mock);

    const report = await verifyUrls(URLS);
    expect(report.ok).toBe(false);
    expect(report.statuses["700"]).toBe(404);
    expect(report.statuses["1040"]).toBe(200);
    expect(report.failedSizes).toEqual(["700"]);
  });

  it("retries HEAD 405 as a ranged GET and accepts 206", async () => {
    const mock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") return { status: 405 };
      return { status: 206 };
    });
    vi.stubGlobal("fetch", mock);

    const report = await verifyUrls({ "1040": "https://host.example.com/i/k/1040" });
    expect(report.ok).toBe(true);
    expect(report.statuses["1040"]).toBe(206);
    expect(mock).toHaveBeenCalledTimes(2);
    const retry = mock.mock.calls[1] as unknown as [string, RequestInit];
    expect(retry[1].method).toBe("GET");
    expect((retry[1].headers as Record<string, string>).Range).toBe("bytes=0-0");
  });

  it("also retries HEAD 501 as a ranged GET and accepts 200", async () => {
    const mock = vi.fn(async (_url: string, init?: RequestInit) => ({
      status: init?.method === "HEAD" ? 501 : 200,
    }));
    vi.stubGlobal("fetch", mock);

    const report = await verifyUrls({ "240": "https://host.example.com/i/k/240" });
    expect(report.ok).toBe(true);
    expect(report.statuses["240"]).toBe(200);
  });

  it('records "timeout" when the probe exceeds timeoutMs (AbortError)', async () => {
    // Never resolves; rejects with a DOMException named AbortError once the
    // handler's AbortController fires — mirroring undici's abort behavior.
    vi.stubGlobal("fetch", (_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted", "AbortError"));
        });
      });
    });

    const report = await verifyUrls({ "1040": "https://host.example.com/i/k/1040" }, { timeoutMs: 50 });
    expect(report.ok).toBe(false);
    expect(report.statuses["1040"]).toBe("timeout");
    expect(report.failedSizes).toEqual(["1040"]);
  });

  it('records "error" when fetch rejects for a non-abort reason', async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    const report = await verifyUrls({ "300": "https://host.example.com/i/k/300" });
    expect(report.ok).toBe(false);
    expect(report.statuses["300"]).toBe("error");
    expect(report.failedSizes).toEqual(["300"]);
  });

  it("sorts multiple failedSizes deterministically", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 404 })));

    const report = await verifyUrls(URLS);
    expect(report.ok).toBe(false);
    expect(report.failedSizes).toEqual(["1040", "240", "700"].sort());
  });
});

// ---------------------------------------------------------------------------
// handleImageHostRequest — real node:http server, real fetch
// ---------------------------------------------------------------------------

/** Buffer that begins with the 8-byte PNG signature (a plausible fake variant). */
const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(100, 7),
]);

/** Seed the singleton store with PNG_BYTES under every imagemap size; returns the key. */
function seedStore(): string {
  const variants: ImageVariants = {
    sizes: new Map<number, Buffer>(IMAGEMAP_SIZES.map((s) => [s, PNG_BYTES] as [number, Buffer])),
    baseWidth: 1040,
    baseHeight: 520,
    sourceFormat: "png",
    warnings: [],
  };
  return imageStore.put(variants, 60_000).key;
}

let server: Server | undefined;

/** Start a real HTTP server whose only routing is the handler-under-test. */
async function startServer(): Promise<string> {
  server = createServer((req, res) => {
    if (!handleImageHostRequest(req, res)) {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const addr = server?.address() as AddressInfo;
  return `http://127.0.0.1:${addr.port}`;
}

/** Minimal writable-response double for calling the handler without a socket. */
function makeFakeRes(): { res: ServerResponse; state: { statusCode: number; ended: boolean } } {
  const state = { statusCode: 0, ended: false };
  const res = {
    headersSent: false,
    writeHead(code: number) {
      state.statusCode = code;
      (this as { headersSent: boolean }).headersSent = true;
      return this;
    },
    end() {
      state.ended = true;
    },
  } as unknown as ServerResponse;
  return { res, state };
}

describe("handleImageHostRequest", () => {
  afterEach(async () => {
    imageStore.clear();
    if (server) {
      const s = server;
      server = undefined;
      await new Promise<void>((resolve, reject) => s.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it("GET hit returns 200 with the exact PNG bytes and headers", async () => {
    const key = seedStore();
    const base = await startServer();

    const res = await fetch(`${base}/i/${key}/1040`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-length")).toBe(String(PNG_BYTES.length));
    // v2.2.1: bytes per key never change (content-hash + random key), so the
    // route promises immutable caching and a validator.
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("etag")).toBe(`"${key}/1040"`);
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(PNG_BYTES)).toBe(true);
  });

  it("GET with a matching If-None-Match returns 304 with no body (and keeps the cache headers)", async () => {
    const key = seedStore();
    const base = await startServer();

    const res = await fetch(`${base}/i/${key}/700`, {
      headers: { "if-none-match": `"${key}/700"` },
    });
    expect(res.status).toBe(304);
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("etag")).toBe(`"${key}/700"`);
    const body = await res.arrayBuffer();
    expect(body.byteLength).toBe(0);
  });

  it("HEAD with a matching If-None-Match returns 304", async () => {
    const key = seedStore();
    const base = await startServer();

    const res = await fetch(`${base}/i/${key}/240`, {
      method: "HEAD",
      headers: { "if-none-match": `"${key}/240"` },
    });
    expect(res.status).toBe(304);
  });

  it("GET with a NON-matching If-None-Match returns the full 200 (conditional-only 304)", async () => {
    // verify.ts counts only 200/206 as success — a sloppy always-304 would
    // flip verification to "failed" and tear down a healthy tunnel.
    const key = seedStore();
    const base = await startServer();

    const res = await fetch(`${base}/i/${key}/1040`, {
      headers: { "if-none-match": '"someone-elses-etag/1040"' },
    });
    expect(res.status).toBe(200);
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(PNG_BYTES)).toBe(true);
  });

  it("the ETag is per size — one size's validator does not 304 another size", async () => {
    const key = seedStore();
    const base = await startServer();

    const res = await fetch(`${base}/i/${key}/1040`, {
      headers: { "if-none-match": `"${key}/700"` },
    });
    expect(res.status).toBe(200);
  });

  it("an expired key returns 404 even with a matching If-None-Match (store is the source of truth)", async () => {
    const key = seedStore();
    const base = await startServer();
    imageStore.clear(); // simulate expiry/eviction

    const res = await fetch(`${base}/i/${key}/1040`, {
      headers: { "if-none-match": `"${key}/1040"` },
    });
    expect(res.status).toBe(404);
  });

  it("HEAD hit returns 200 with content-length and an empty body", async () => {
    const key = seedStore();
    const base = await startServer();

    const res = await fetch(`${base}/i/${key}/240`, { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-length")).toBe(String(PNG_BYTES.length));
    const body = await res.arrayBuffer();
    expect(body.byteLength).toBe(0);
  });

  it("unknown (well-formed) key returns 404", async () => {
    seedStore();
    const base = await startServer();

    const res = await fetch(`${base}/i/deadbeefdead-AAAAAAAAAAAAAAAA/1040`);
    expect(res.status).toBe(404);
  });

  it("wrong size (999) returns 404 even for a live key", async () => {
    const key = seedStore();
    const base = await startServer();

    const res = await fetch(`${base}/i/${key}/999`);
    expect(res.status).toBe(404);
  });

  it("malformed path under /i/ (key too short) returns 404", async () => {
    seedStore();
    const base = await startServer();

    const res = await fetch(`${base}/i/abc/1040`);
    expect(res.status).toBe(404);
  });

  it("traversal attempt via real fetch returns 404 (client normalizes the path)", async () => {
    seedStore();
    const base = await startServer();

    const res = await fetch(`${base}/i/../../etc/passwd`);
    expect(res.status).toBe(404);
  });

  it("traversal path handed RAW to the handler is rejected by the regex", () => {
    seedStore();
    // No client normalization here — this is the exact string an attacker
    // could push through a tunnel; the regex alone must kill it.
    const req = { url: "/i/../../etc/passwd", method: "GET" } as IncomingMessage;
    const { res, state } = makeFakeRes();
    expect(handleImageHostRequest(req, res)).toBe(true);
    expect(state.statusCode).toBe(404);
    expect(state.ended).toBe(true);
  });

  it("returns false and leaves the response untouched for non-/i/ URLs", () => {
    const req = { url: "/health", method: "GET" } as IncomingMessage;
    const { res, state } = makeFakeRes();
    expect(handleImageHostRequest(req, res)).toBe(false);
    expect(state.statusCode).toBe(0);
    expect(state.ended).toBe(false);
  });

  it("POST to a valid path returns 405 with an Allow header", async () => {
    const key = seedStore();
    const base = await startServer();

    const res = await fetch(`${base}/i/${key}/1040`, { method: "POST" });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, HEAD");
  });
});
