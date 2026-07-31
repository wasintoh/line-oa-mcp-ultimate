/**
 * Image input loader (v2.2 Image Hosting Layer) — turns exactly one of
 * { file_path | base64 | source_url } into raw bytes plus an origin label.
 *
 * Non-obvious constraint enforced here: remote URLs are NEVER fetched directly —
 * every network load goes through fetchPublicImage (the SSRF guard), and base64
 * payloads are rejected by character length BEFORE any decode so an oversized
 * payload never allocates a decoded buffer. Magic-byte/format validation is
 * deliberately NOT done here — resize.ts owns that.
 */

import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";

import { IMAGE_BASE64_MAX_CHARS, IMAGE_INPUT_MAX_BYTES } from "../constants.js";
import { fetchPublicImage } from "../line/ssrf-guard.js";
import { ImageHostError } from "./types.js";

export interface LoadedImage {
  buffer: Buffer;
  /** Where the bytes came from: file path, "base64 input", or the final URL. */
  origin: string;
  /** Non-fatal English notes (e.g. share-link rewrites). Tool layer translates. */
  warnings: string[];
}

const GDRIVE_NOTE = "rewrote Google Drive share link to direct-download form";
const DROPBOX_NOTE = "rewrote Dropbox share link (dl=0) to direct-download form (dl=1)";

/** Optional data-URI prefix, e.g. "data:image/png;base64," — stripped before checks. */
const DATA_URI_PREFIX = /^data:image\/[a-zA-Z0-9.+-]+;base64,/;

/** Allowed base64 alphabet (whitespace tolerated — LLMs wrap long payloads). */
const BASE64_CHARSET = /^[A-Za-z0-9+/=\s]+$/;

/**
 * Rewrite well-known "share" URLs into direct-download form so the fetch
 * returns image bytes instead of an HTML viewer page. Unknown URLs (including
 * unparseable ones) pass through unchanged — the SSRF guard validates later.
 */
export function rewriteWellKnownUrl(url: string): { url: string; note?: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { url };
  }

  // Google Drive: /file/d/<ID>/view...  OR  /open?id=<ID>
  if (parsed.hostname === "drive.google.com") {
    const fileMatch = /^\/file\/d\/([^/]+)/.exec(parsed.pathname);
    const id = fileMatch?.[1] ?? (parsed.pathname === "/open" ? parsed.searchParams.get("id") : null);
    if (id) {
      return {
        url: `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`,
        note: GDRIVE_NOTE,
      };
    }
    return { url };
  }

  // Dropbox: ?dl=0 → ?dl=1 (viewer page → direct download)
  const host = parsed.hostname;
  if ((host === "dropbox.com" || host.endsWith(".dropbox.com")) && parsed.searchParams.get("dl") === "0") {
    parsed.searchParams.set("dl", "1");
    return { url: parsed.toString(), note: DROPBOX_NOTE };
  }

  return { url };
}

/** Load image bytes from a local file path (with leading-~ expansion). */
async function loadFromFile(rawPath: string): Promise<LoadedImage> {
  const filePath = rawPath.startsWith("~") ? path.join(os.homedir(), rawPath.slice(1)) : rawPath;

  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    throw new ImageHostError(`file not found or unreadable: ${filePath}`, "input-invalid");
  }
  if (!stat.isFile()) {
    throw new ImageHostError(`not a regular file: ${filePath}`, "input-invalid");
  }
  if (stat.size > IMAGE_INPUT_MAX_BYTES) {
    const actualMb = (stat.size / (1024 * 1024)).toFixed(1);
    const limitMb = (IMAGE_INPUT_MAX_BYTES / (1024 * 1024)).toFixed(0);
    throw new ImageHostError(
      `file is ${actualMb}MB which exceeds the ${limitMb}MB input limit: ${filePath}`,
      "input-too-large",
    );
  }

  const buffer = await fsp.readFile(filePath);
  return { buffer, origin: filePath, warnings: [] };
}

/** Decode a base64 payload — length is checked BEFORE decoding (see header). */
function loadFromBase64(raw: string): LoadedImage {
  const stripped = raw.replace(DATA_URI_PREFIX, "");

  if (stripped.length > IMAGE_BASE64_MAX_CHARS) {
    throw new ImageHostError(
      `base64 payload is ${stripped.length} chars which exceeds the ${IMAGE_BASE64_MAX_CHARS} char limit`,
      "input-too-large",
    );
  }
  if (!BASE64_CHARSET.test(stripped)) {
    throw new ImageHostError("base64 payload contains characters outside the base64 alphabet", "input-invalid");
  }

  const buffer = Buffer.from(stripped.replace(/\s+/g, ""), "base64");
  if (buffer.length === 0) {
    throw new ImageHostError("base64 payload decoded to zero bytes", "input-invalid");
  }
  return { buffer, origin: "base64 input", warnings: [] };
}

/** Fetch image bytes from a public URL — ALWAYS via the SSRF guard. */
async function loadFromUrl(rawUrl: string): Promise<LoadedImage> {
  const warnings: string[] = [];
  const { url, note } = rewriteWellKnownUrl(rawUrl);
  if (note) warnings.push(note);

  const fetched = await fetchPublicImage(url, { maxBytes: IMAGE_INPUT_MAX_BYTES });
  return { buffer: fetched.buffer, origin: fetched.finalUrl, warnings };
}

/**
 * Load image bytes from exactly one of file_path / base64 / source_url.
 * Throws ImageHostError("...", "input-invalid") when zero or multiple
 * fields are provided.
 */
export async function loadImageInput(src: {
  file_path?: string;
  base64?: string;
  source_url?: string;
}): Promise<LoadedImage> {
  const provided = [src.file_path, src.base64, src.source_url].filter((v) => v != null);
  if (provided.length !== 1) {
    throw new ImageHostError("provide exactly one of file_path, base64, source_url", "input-invalid");
  }

  if (src.file_path != null) return loadFromFile(src.file_path);
  if (src.base64 != null) return loadFromBase64(src.base64);
  return loadFromUrl(src.source_url as string);
}
