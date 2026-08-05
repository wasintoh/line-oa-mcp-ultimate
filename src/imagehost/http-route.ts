/**
 * HTTP route handler for hosted image variants (v2.2 Image Hosting Layer).
 *
 * Serves `GET|HEAD /i/{key}/{size}` straight from the in-memory imageStore —
 * transport-agnostic, so both the self provider (main HTTP transport) and the
 * local-tunnel provider mount the exact same handler.
 *
 * Non-obvious constraint enforced here: the strict path regex IS the
 * path-traversal defense. There is no filesystem behind this route — only the
 * in-memory store — and the single allowed shape ([A-Za-z0-9_-]{10,120} key +
 * 3-4 digit size) rejects "..", "%2e", extra slashes and query strings by
 * construction, so no decoded-path normalization is ever needed.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import { IMAGEMAP_SIZES } from "../constants.js";
import { imageStore } from "./store.js";

/** The ONLY path shape this route serves. Anything else under /i/ is a 404. */
const ROUTE_RE = /^\/i\/([A-Za-z0-9_-]{10,120})\/(\d{3,4})$/;

/**
 * Handle an image-host request. Returns false — with `res` untouched — when
 * the URL is not under /i/, so callers can route everything else themselves.
 * Once it returns true the response is fully written; this never throws.
 */
export function handleImageHostRequest(req: IncomingMessage, res: ServerResponse): boolean {
  const url = req.url ?? "";
  if (!url.startsWith("/i/")) return false;

  try {
    const match = ROUTE_RE.exec(url);
    const key = match?.[1];
    const sizeStr = match?.[2];
    if (key === undefined || sizeStr === undefined) {
      sendJson(res, 404, { error: "not found" });
      return true;
    }

    const method = req.method ?? "";
    if (method !== "GET" && method !== "HEAD") {
      sendJson(res, 405, { error: "method not allowed" }, { Allow: "GET, HEAD" });
      return true;
    }

    // Unknown size and unknown key both answer a plain 404 — do not leak
    // which part of the path failed (the key space must stay unguessable).
    const size = Number(sizeStr);
    if (!(IMAGEMAP_SIZES as readonly number[]).includes(size)) {
      sendJson(res, 404, { error: "not found" });
      return true;
    }

    const bytes = imageStore.getVariant(key, size);
    if (!bytes) {
      sendJson(res, 404, { error: "not found" });
      return true;
    }

    // Caching contract (v2.2.1): a key's bytes can NEVER change — keys are
    // content-hash + 96-bit random, minted fresh on every prepare — so
    // `immutable` + a long max-age is semantically exact. Recipient devices
    // fetch a picture once and never revalidate; reverse proxies / CDNs may
    // cache for the whole send window. The ETag is per (key, size): each size
    // variant has different bytes, and the URL already carries both parts.
    //
    // Two rules that MUST hold (tests enforce them):
    //   1. Only answer 304 to a MATCHING If-None-Match. verify.ts probes with
    //      unconditional HEAD/GET and counts only 200/206 as success — an
    //      unconditional 304 would flip verification to "failed" and tear
    //      down a healthy tunnel.
    //   2. Read the conditional header only AFTER the store lookup: expired
    //      or evicted keys must keep answering 404 (the store is the source
    //      of truth for liveness), and the direct-handler tests hand in
    //      requests without a headers object.
    const cacheControl = "public, max-age=31536000, immutable";
    const etag = `"${key}/${size}"`;
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, { "Cache-Control": cacheControl, ETag: etag });
      res.end();
      return true;
    }

    res.writeHead(200, {
      "Content-Type": "image/png",
      "Content-Length": bytes.length,
      "Cache-Control": cacheControl,
      ETag: etag,
    });
    if (method === "HEAD") {
      res.end();
    } else {
      res.end(bytes);
    }
    return true;
  } catch {
    // Tunnel URLs are public — a crashing handler must never take the whole
    // transport down. Best-effort 500; swallow even failures to respond.
    try {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
      }
      res.end(JSON.stringify({ error: "internal error" }));
    } catch {
      // Socket already gone — nothing left to do.
    }
    return true;
  }
}

function sendJson(res: ServerResponse, status: number, body: object, extraHeaders?: Record<string, string>): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
    ...extraHeaders,
  });
  res.end(payload);
}
