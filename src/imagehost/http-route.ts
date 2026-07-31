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

    res.writeHead(200, {
      "Content-Type": "image/png",
      "Content-Length": bytes.length,
      "Cache-Control": "public, max-age=86400",
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
