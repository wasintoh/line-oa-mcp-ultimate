/**
 * SSRF guard for tools that fetch user-supplied URLs server-side
 * (rich menu images, logo URLs, …).
 *
 * Policy:
 *   - https only
 *   - no loopback / private / link-local / CGNAT / multicast / metadata hosts
 *     (literal IPs AND DNS-resolved addresses; IPv6 handled via full hextet
 *     expansion so non-canonical forms and v4-mapped/NAT64 embeddings are
 *     caught too)
 *   - capped download size (declared Content-Length AND streamed bytes) + timeout
 *   - redirects are followed manually and every hop re-validated
 *
 * NOTE for concurrent workstreams: the exported signatures of
 * `assertPublicHttpUrl` and `fetchPublicImage` are frozen — other tools import
 * them directly.
 */

import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

import { TH } from "../i18n/th.js";

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024; // 10 MB — pre-optimization ceiling
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;

export interface FetchPublicImageOptions {
  maxBytes?: number;
  timeoutMs?: number;
}

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfBlockedError";
  }
}

/**
 * Expand an IPv6 literal into its 8 hextets. Handles `::` compression, zone
 * ids (`%eth0`), and embedded dotted-quad tails (`::ffff:127.0.0.1`).
 * Returns null when the input is not a valid IPv6 address.
 */
function expandIpv6(address: string): number[] | null {
  const noZone = address.split("%")[0] ?? "";
  if (isIP(noZone) !== 6) return null;

  let head = noZone;
  let v4Tail: [number, number] | null = null;
  if (head.includes(".")) {
    const i = head.lastIndexOf(":");
    const quad = head.slice(i + 1).split(".").map(Number);
    const [q0, q1, q2, q3] = [quad[0] ?? 0, quad[1] ?? 0, quad[2] ?? 0, quad[3] ?? 0];
    v4Tail = [(q0 << 8) | q1, (q2 << 8) | q3];
    head = `${head.slice(0, i + 1)}0:0`; // placeholder groups, overwritten below
  }

  let groups: string[];
  if (head.includes("::")) {
    const [left = "", right = ""] = head.split("::");
    const leftGroups = left ? left.split(":") : [];
    const rightGroups = right ? right.split(":") : [];
    const missing = 8 - leftGroups.length - rightGroups.length;
    if (missing < 0) return null;
    groups = [...leftGroups, ...Array<string>(missing).fill("0"), ...rightGroups];
  } else {
    groups = head.split(":");
  }
  if (groups.length !== 8) return null;

  const nums = groups.map((g) => parseInt(g || "0", 16));
  if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 0xffff)) return null;
  if (v4Tail) {
    nums[6] = v4Tail[0];
    nums[7] = v4Tail[1];
  }
  return nums;
}

function isPrivateIpv4(a: number, b: number, c: number): boolean {
  if (a === 127 || a === 10 || a === 0) return true; // loopback / class A private / this-host
  if (a === 169 && b === 254) return true; // link-local + cloud metadata (169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true; // class B private
  if (a === 192 && b === 168) return true; // class C private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0 && c === 0) return true; // IETF protocol assignments (192.0.0.0/24)
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking (198.18.0.0/15)
  if (a >= 224) return true; // multicast (224/4) + reserved (240/4) + broadcast
  return false;
}

/** True when an IPv4/IPv6 address is loopback, private, link-local, multicast, or metadata. */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const parts = address.split(".").map(Number);
    return isPrivateIpv4(parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0);
  }
  if (family === 6) {
    const g = expandIpv6(address);
    if (!g) return true; // valid-looking v6 we cannot parse → fail closed
    const [g0, g1, g2, g3, g4, g5, g6, g7] = [
      g[0] ?? 0, g[1] ?? 0, g[2] ?? 0, g[3] ?? 0, g[4] ?? 0, g[5] ?? 0, g[6] ?? 0, g[7] ?? 0,
    ];
    const firstSixZero = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0;

    if (firstSixZero && g6 === 0 && g7 === 0) return true; // :: unspecified
    if (firstSixZero && g6 === 0 && g7 === 1) return true; // ::1 loopback
    const checkEmbedded = (): boolean =>
      isPrivateIpv4(g6 >> 8, g6 & 0xff, g7 >> 8);
    if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
      return checkEmbedded(); // ::ffff:a.b.c.d — IPv4-mapped
    }
    if (firstSixZero) return checkEmbedded(); // ::a.b.c.d — deprecated v4-compatible
    if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
      return checkEmbedded(); // 64:ff9b::/96 — NAT64
    }
    if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
    if ((g0 & 0xffc0) === 0xfec0) return true; // fec0::/10 deprecated site-local
    if ((g0 & 0xff00) === 0xff00) return true; // ff00::/8 multicast
    return false;
  }
  return false;
}

/** Strip IPv6 URL brackets and any trailing dot so host checks see a canonical name. */
function normalizeHostname(hostname: string): string {
  let host = hostname;
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (host.endsWith(".")) host = host.slice(0, -1);
  return host.toLowerCase();
}

const BLOCKED_NAME_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"];

/**
 * Validate that a URL is https and does not point at a private/internal host.
 * Resolves DNS so `https://internal.corp` tricks are caught too.
 * Throws `SsrfBlockedError` (Thai-friendly message) when blocked.
 */
export async function assertPublicHttpUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError(TH.ssrfInvalidUrl(rawUrl));
  }
  if (url.protocol !== "https:") {
    throw new SsrfBlockedError(TH.ssrfHttpsOnly);
  }
  const host = normalizeHostname(url.hostname);
  if (!host) {
    throw new SsrfBlockedError(TH.ssrfInvalidUrl(rawUrl));
  }
  if (isIP(host)) {
    if (isPrivateAddress(host)) {
      throw new SsrfBlockedError(TH.ssrfPrivateAddress(host));
    }
    return url;
  }
  if (host === "localhost" || BLOCKED_NAME_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new SsrfBlockedError(TH.ssrfInternalHost(host));
  }
  try {
    const results = await lookup(host, { all: true });
    if (!results.length) {
      throw new SsrfBlockedError(TH.ssrfResolveFailed(host));
    }
    for (const r of results) {
      if (isPrivateAddress(r.address)) {
        throw new SsrfBlockedError(TH.ssrfResolvedPrivate(host, r.address));
      }
    }
  } catch (err) {
    if (err instanceof SsrfBlockedError) throw err;
    throw new SsrfBlockedError(TH.ssrfResolveFailed(host));
  }
  return url;
}

/**
 * Fetch an image (or any binary) from a public https URL with SSRF checks,
 * size cap, timeout, and per-hop redirect validation.
 */
export async function fetchPublicImage(
  rawUrl: string,
  opts: FetchPublicImageOptions = {},
): Promise<{ buffer: Buffer; contentType: string; finalUrl: string }> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxMb = (maxBytes / 1024 / 1024).toFixed(0);

  let current = await assertPublicHttpUrl(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(current, { redirect: "manual", signal: controller.signal });
    } catch (err) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      throw new SsrfBlockedError(TH.ssrfDownloadFailed(current.hostname, msg));
    }

    if (res.status >= 300 && res.status < 400) {
      clearTimeout(timer);
      const location = res.headers.get("location");
      if (!location || hop === MAX_REDIRECTS) {
        throw new SsrfBlockedError(TH.ssrfTooManyRedirects);
      }
      // Every redirect hop is re-validated — a public host 302-ing to an
      // internal target (the classic SSRF pivot) is rejected here.
      current = await assertPublicHttpUrl(new URL(location, current).toString());
      continue;
    }

    if (!res.ok) {
      clearTimeout(timer);
      throw new SsrfBlockedError(TH.ssrfHttpError(res.status, current.hostname));
    }

    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > maxBytes) {
      clearTimeout(timer);
      throw new SsrfBlockedError(TH.ssrfFileTooLarge(maxMb));
    }

    const chunks: Uint8Array[] = [];
    let received = 0;
    const reader = res.body?.getReader();
    if (!reader) {
      clearTimeout(timer);
      throw new SsrfBlockedError(TH.ssrfNoBody);
    }
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        // Content-Length lies (or is absent) — enforce the cap on the wire too.
        if (received > maxBytes) {
          controller.abort();
          throw new SsrfBlockedError(TH.ssrfFileTooLarge(maxMb));
        }
        chunks.push(value);
      }
    } finally {
      clearTimeout(timer);
    }
    return {
      buffer: Buffer.concat(chunks),
      contentType: res.headers.get("content-type") ?? "application/octet-stream",
      finalUrl: current.toString(),
    };
  }
  throw new SsrfBlockedError(TH.ssrfTooManyRedirects);
}
