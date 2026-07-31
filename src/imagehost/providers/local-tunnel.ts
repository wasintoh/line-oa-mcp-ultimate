/**
 * local-tunnel provider — the default image host for stdio users.
 *
 * Turns the user's own machine into a temporary public host:
 *   1. a loopback-only node:http server serves /i/:key/:size from the
 *      in-memory ImageStore (NEVER from the filesystem — the tunnel makes this
 *      path internet-reachable, so memory-only serving is the traversal defense),
 *   2. a cloudflared "quick tunnel" (TryCloudflare, free, no account) dials OUT
 *      to Cloudflare and relays inbound fetches — works behind NAT with zero
 *      router configuration because the connection is outbound-only.
 *
 * LINE fetches the image when each recipient FIRST VIEWS the message — NOT at
 * send time (verified live 2026-07-31; a never-viewed message's image died with
 * the tunnel, a viewed one survived tunnel death and a device restart). So the
 * tunnel must live until the audience has opened the message; keep_alive
 * (default 24h) is that window, best-effort within the MCP process lifetime.
 *
 * Binary management: we look for `cloudflared` on PATH first (user-managed,
 * trusted as-is), then in our cache dir; otherwise we download the PINNED
 * release below and verify its SHA-256 against checksums recorded from the
 * official release page. A mismatch aborts — no unverified binary ever runs.
 *
 * TryCloudflare limits we knowingly accept (documented for users): no SLA,
 * "testing and development" positioning, 200 concurrent in-flight requests.
 * Acceptable here because LINE's CDN takes over right after the send.
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { Resolver } from "node:dns/promises";
import { chmodSync, createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { get as httpsGet } from "node:https";
import { homedir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { AddressInfo } from "node:net";

import { IMAGEHOST_DEFAULT_KEEPALIVE_S, IMAGEMAP_SIZES, TUNNEL_START_TIMEOUT_MS } from "../../constants.js";
import { handleImageHostRequest } from "../http-route.js";
import { ImageHostError, type HostResult, type ImageHost, type ImageVariants, type PutOptions } from "../types.js";

// ---- pinned cloudflared release (checksums from the official release page) ----

export const CLOUDFLARED_VERSION = "2026.7.3";

/**
 * SHA-256 pins from the official release page. IMPORTANT SEMANTICS (QC catch):
 * Cloudflare publishes the darwin checksums for the BINARY INSIDE the .tgz,
 * not the archive itself — so for .tgz assets we gunzip+extract FIRST and hash
 * the inner binary; for the raw linux/windows assets we hash the file as-is
 * (the linux-amd64 pin was verified against a live download).
 */
const ASSET_CHECKSUMS: Record<string, string> = {
  "cloudflared-darwin-amd64.tgz": "e88fe5874d42a94f49a7ea59cabc3722d2962d0449232b0f3b1a426a712e275c",
  "cloudflared-darwin-arm64.tgz": "f35c50089cd25f77a4cb5a2152036bc26db15aa31fbe11f7995d2e42a4ed6257",
  "cloudflared-linux-amd64": "9d71c677db00134c1bd4144b7783486b654ad281b1ea62b4972098d19f770f17",
  "cloudflared-linux-arm64": "65259e652a7bea08bf5df603233ab22b8bf3116af8df9f9206209af6a1b955c0",
  "cloudflared-windows-amd64.exe": "8635da433b6df8194746e88ed9d2589566c20e38bfc2a80e431a348b7c765841",
};

const DOWNLOAD_MAX_BYTES = 200 * 1024 * 1024; // hard cap while streaming
const DOWNLOAD_TIMEOUT_MS = 180_000; // overall budget — black-holing proxies must not hang the tool forever
const TUNNEL_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

/** Which release asset fits this machine. null → unsupported platform. */
export function assetForPlatform(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string | null {
  if (platform === "darwin" && arch === "x64") return "cloudflared-darwin-amd64.tgz";
  if (platform === "darwin" && arch === "arm64") return "cloudflared-darwin-arm64.tgz";
  if (platform === "linux" && arch === "x64") return "cloudflared-linux-amd64";
  if (platform === "linux" && arch === "arm64") return "cloudflared-linux-arm64";
  if (platform === "win32" && arch === "x64") return "cloudflared-windows-amd64.exe";
  return null;
}

function cacheDir(): string {
  return join(homedir(), ".cache", "line-oa-mcp-ultimate");
}

function cachedBinaryPath(): string {
  const ext = process.platform === "win32" ? ".exe" : "";
  return join(cacheDir(), `cloudflared-${CLOUDFLARED_VERSION}${ext}`);
}

/** For line_image_host_status: how would we obtain the binary right now? */
export function binaryStatus(): "env-override" | "on-path" | "cached" | "needs-download" | "unsupported-platform" {
  if (process.env.LINE_MCP_CLOUDFLARED_PATH) return "env-override";
  if (onPathBinary()) return "on-path";
  if (existsSync(cachedBinaryPath())) return "cached";
  return assetForPlatform() ? "needs-download" : "unsupported-platform";
}

function onPathBinary(): string | null {
  try {
    const probe = spawnSync("cloudflared", ["--version"], { timeout: 5_000, stdio: "ignore" });
    return probe.error ? null : "cloudflared";
  } catch {
    return null;
  }
}

// ---- download + verify ----

/** Follow redirects (GitHub → objects.githubusercontent.com) with a hop cap and an overall deadline. */
function fetchToFile(url: string, dest: string, hops = 0, deadline = Date.now() + DOWNLOAD_TIMEOUT_MS): Promise<void> {
  return new Promise((resolve, reject) => {
    if (hops > 5) return reject(new ImageHostError("too many redirects downloading cloudflared", "download-failed"));
    if (Date.now() > deadline) {
      return reject(new ImageHostError("cloudflared download timed out", "download-failed"));
    }
    const req = httpsGet(url, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        return fetchToFile(new URL(res.headers.location, url).toString(), dest, hops + 1, deadline).then(
          resolve,
          reject,
        );
      }
      if (status !== 200) {
        res.resume();
        return reject(new ImageHostError(`cloudflared download failed (HTTP ${status})`, "download-failed"));
      }
      let received = 0;
      const out = createWriteStream(dest);
      res.on("data", (chunk: Buffer) => {
        received += chunk.length;
        if (received > DOWNLOAD_MAX_BYTES) {
          res.destroy();
          out.destroy();
          reject(new ImageHostError("cloudflared download exceeded the size cap", "download-failed"));
        }
      });
      res.pipe(out);
      out.on("finish", () => resolve());
      out.on("error", reject);
      res.on("error", reject);
    }).on("error", (err) => reject(new ImageHostError(`cloudflared download failed: ${err.message}`, "download-failed")));
    // Socket-level inactivity timeout (node:https has none by default).
    req.setTimeout(60_000, () => {
      req.destroy(new Error("socket inactivity timeout"));
    });
  });
}

async function sha256File(path: string): Promise<string> {
  const buf = await readFile(path);
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Minimal tar reader — enough to pull the single `cloudflared` entry out of
 * the official darwin .tgz. 512-byte headers, octal sizes, no pax/longname
 * support needed for this archive; fails loudly otherwise.
 */
export function extractTarEntry(tar: Buffer, wanted: string): Buffer | null {
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const name = tar.toString("utf8", offset, offset + 100).replace(/\0.*$/, "");
    if (!name) break; // two zero-blocks terminate the archive
    const sizeOctal = tar.toString("utf8", offset + 124, offset + 136).replace(/\0.*$/, "").trim();
    const size = parseInt(sizeOctal, 8);
    if (Number.isNaN(size)) throw new ImageHostError("corrupt tar header in cloudflared archive", "download-failed");
    const dataStart = offset + 512;
    const base = name.split("/").pop();
    if (base === wanted) return Buffer.from(tar.subarray(dataStart, dataStart + size));
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return null;
}

/** Ensure a runnable cloudflared binary; download + SHA-256-verify if needed. */
export async function ensureBinary(): Promise<string> {
  const override = process.env.LINE_MCP_CLOUDFLARED_PATH;
  if (override) {
    if (!existsSync(override)) {
      throw new ImageHostError(`LINE_MCP_CLOUDFLARED_PATH points to a missing file: ${override}`, "provider-unavailable");
    }
    return override;
  }
  const fromPath = onPathBinary();
  if (fromPath) return fromPath;

  const cached = cachedBinaryPath();
  if (existsSync(cached)) return cached;

  const asset = assetForPlatform();
  if (!asset) {
    throw new ImageHostError(
      `no cloudflared build for ${process.platform}/${process.arch} — install cloudflared manually and set LINE_MCP_CLOUDFLARED_PATH`,
      "provider-unavailable",
    );
  }
  const expected = ASSET_CHECKSUMS[asset];
  if (!expected) {
    throw new ImageHostError(`no pinned checksum for ${asset} — refusing to auto-download`, "provider-unavailable");
  }

  mkdirSync(cacheDir(), { recursive: true });
  // Random suffix: two MCP processes downloading concurrently must never
  // interleave writes into the same tmp file (same pid+ms is possible via npx).
  const tmp = join(cacheDir(), `.download-${process.pid}-${randomBytes(6).toString("hex")}`);
  try {
    const url = `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/${asset}`;
    await fetchToFile(url, tmp);

    // For .tgz assets, extract FIRST — the pinned checksum is of the inner
    // binary (Cloudflare's publishing convention), not the archive bytes.
    if (asset.endsWith(".tgz")) {
      const tar = gunzipSync(await readFile(tmp));
      const bin = extractTarEntry(tar, "cloudflared");
      if (!bin) throw new ImageHostError("cloudflared binary not found inside the .tgz archive", "download-failed");
      await writeFile(tmp, bin);
    }

    const actual = await sha256File(tmp);
    if (actual !== expected) {
      throw new ImageHostError(
        `cloudflared checksum mismatch for ${asset} (expected ${expected.slice(0, 12)}…, got ${actual.slice(0, 12)}…) — refusing to run it. If your platform genuinely differs, install cloudflared yourself and set LINE_MCP_CLOUDFLARED_PATH`,
        "checksum-mismatch",
      );
    }

    chmodSync(tmp, 0o755);
    renameSync(tmp, cached); // atomic within the same dir
    return cached;
  } finally {
    try { rmSync(tmp, { force: true }); } catch { /* already renamed or never written */ }
  }
}

// ---- tunnel + server lifecycle (module singleton) ----

interface TunnelState {
  server: Server;
  port: number;
  proc: ChildProcess;
  url: string;
  expiresAtMs: number;
  shutdownTimer?: NodeJS.Timeout;
}

let state: TunnelState | null = null;
/** In-flight startup memo — overlapping put() calls must share ONE tunnel. */
let starting: Promise<TunnelState> | null = null;
let exitHooksInstalled = false;

/**
 * A proc killed by signal has exitCode === null but signalCode set — checking
 * only exitCode would treat a SIGKILLed cloudflared as alive (QC catch).
 */
function procIsLive(proc: ChildProcess): boolean {
  return proc.exitCode === null && proc.signalCode === null;
}

function installExitHooks(): void {
  if (exitHooksInstalled) return;
  exitHooksInstalled = true;
  // 'exit' runs synchronously — proc.kill is a sync syscall, safe here.
  process.on("exit", () => {
    if (state?.proc && procIsLive(state.proc)) state.proc.kill("SIGTERM");
  });
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      if (state?.proc && procIsLive(state.proc)) state.proc.kill("SIGTERM");
      state?.server.close();
      // If we are the only listener the default terminate behavior is gone —
      // restore it. (http.ts installs its own exit-ing handlers in HTTP mode.)
      if (process.listenerCount(sig) === 1) process.exit(sig === "SIGINT" ? 130 : 143);
    });
  }
}

function startLocalServer(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      if (!handleImageHostRequest(req, res)) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
      }
    });
    server.once("error", reject);
    // Port 0 = kernel-assigned free port; loopback bind ONLY (the tunnel is the sole public door).
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve({ server, port: (server.address() as AddressInfo).port });
    });
  });
}

function startCloudflared(bin: string, port: number): Promise<ChildProcess & { tunnelUrl: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, ["tunnel", "--url", `http://127.0.0.1:${port}`, "--no-autoupdate"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let logTail = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill("SIGTERM");
      reject(new ImageHostError(
        `cloudflared did not report a tunnel URL within ${TUNNEL_START_TIMEOUT_MS / 1000}s (network may block it). Last output: ${logTail.slice(-300)}`,
        "tunnel-start-failed",
      ));
    }, TUNNEL_START_TIMEOUT_MS);
    timer.unref();

    // Readiness = URL printed AND the data-plane connection registered.
    // The URL appears seconds BEFORE the tunnel can actually carry traffic —
    // settling on the URL alone made verification race the edge (live catch).
    let url: string | null = null;
    let registered = false;
    const scan = (chunk: Buffer): void => {
      const text = chunk.toString("utf8");
      logTail = (logTail + text).slice(-2000);
      if (!url) {
        const m = TUNNEL_URL_RE.exec(text);
        if (m) url = m[0];
      }
      if (!registered && text.includes("Registered tunnel connection")) registered = true;
      if (url && registered && !settled) {
        settled = true;
        clearTimeout(timer);
        resolve(Object.assign(proc, { tunnelUrl: url }));
      }
    };
    proc.stdout?.on("data", scan);
    proc.stderr?.on("data", scan);
    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new ImageHostError(`failed to launch cloudflared: ${err.message}`, "tunnel-start-failed"));
    });
    proc.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new ImageHostError(
        `cloudflared exited early (code ${code}). Last output: ${logTail.slice(-300)}`,
        "tunnel-start-failed",
      ));
    });
  });
}

async function ensureTunnel(): Promise<TunnelState> {
  if (state && procIsLive(state.proc)) return state; // reuse the live tunnel
  // Reentrancy memo: startup takes seconds, and MCP hosts DO issue parallel
  // tool calls. Without this, overlapping prepares each spawn a cloudflared,
  // the second overwrites `state` (orphaning the first, unkillable forever),
  // and the first caller's keep-alive timer later tears down the LIVE tunnel.
  starting ??= startTunnelExclusive().finally(() => {
    starting = null;
  });
  return starting;
}

async function startTunnelExclusive(): Promise<TunnelState> {
  if (state && procIsLive(state.proc)) return state; // raced: someone finished first
  if (state) await disposeTunnel(); // crashed proc — clean the leftovers first

  const bin = await ensureBinary();
  const { server, port } = await startLocalServer();
  let proc: (ChildProcess & { tunnelUrl: string }) | undefined;
  try {
    proc = await startCloudflared(bin, port);
    await waitForTunnelDns(new URL(proc.tunnelUrl).hostname);
  } catch (err) {
    server.close();
    proc?.kill("SIGTERM");
    throw err;
  }
  state = { server, port, proc, url: proc.tunnelUrl, expiresAtMs: 0 };
  installExitHooks();
  return state;
}

/**
 * Wait until the fresh *.trycloudflare.com name is actually resolvable.
 *
 * WHY DIRECT DNS QUERIES: the record is created at registration and takes a
 * few seconds to propagate. If the first lookup goes through getaddrinfo (what
 * fetch uses) too early, macOS's mDNSResponder CACHES THE NEGATIVE ANSWER and
 * every verification retry keeps failing with ENOTFOUND even after the record
 * exists — the exact failure we reproduced live. resolve4 against public
 * resolvers bypasses (and never seeds) the OS cache; only after it succeeds do
 * we let fetch touch the name.
 */
async function waitForTunnelDns(host: string): Promise<void> {
  const resolver = new Resolver();
  resolver.setServers(["1.1.1.1", "8.8.8.8"]);
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const addrs = await resolver.resolve4(host);
      if (addrs.length > 0) {
        await sleep(1_500); // small grace so the OS resolver also gets a positive answer
        return;
      }
    } catch {
      /* not propagated yet */
    }
    await sleep(2_000);
  }
  // Give up waiting — verification (with its own retries) is the final judge.
}

async function disposeTunnel(): Promise<void> {
  const s = state;
  state = null;
  if (!s) return;
  if (s.shutdownTimer) clearTimeout(s.shutdownTimer);
  if (procIsLive(s.proc)) {
    s.proc.kill("SIGTERM");
    // Give it 2s to exit cleanly, then force-kill. The force timer must NOT be
    // unref'd: during an active dispose it may be the only thing keeping the
    // event loop alive, and an unref'd timer lets node exit BEFORE the SIGKILL
    // fires — leaving an orphaned cloudflared (caught by the live check).
    await new Promise<void>((resolve) => {
      const force = setTimeout(() => {
        if (procIsLive(s.proc)) s.proc.kill("SIGKILL");
        resolve();
      }, 2_000);
      s.proc.once("exit", () => {
        clearTimeout(force);
        resolve();
      });
    });
  }
  await new Promise<void>((resolve) => {
    s.server.close(() => resolve());
    s.server.closeAllConnections?.();
  });
}

const MAX_TIMER_MS = 2 ** 31 - 1; // setTimeout is 32-bit; larger delays fire after 1ms (!)

function scheduleShutdown(s: TunnelState): void {
  if (s.shutdownTimer) clearTimeout(s.shutdownTimer);
  const delay = Math.max(0, s.expiresAtMs - Date.now());
  s.shutdownTimer = setTimeout(() => {
    // Re-arm when the remaining time exceeded the 32-bit cap (keep_alive_hours
    // up to 720h ≈ 2.59e9 ms > 2^31-1 — without this the tunnel would be torn
    // down 1ms after put() and the user told the network blocked it).
    if (Date.now() < s.expiresAtMs) scheduleShutdown(s);
    else void disposeTunnel();
  }, Math.min(delay, MAX_TIMER_MS));
  s.shutdownTimer.unref(); // never keep the process alive just for the timer
}

// ---- the provider ----

export class LocalTunnelHost implements ImageHost {
  readonly id = "local-tunnel" as const;
  readonly supportsImagemap = true;

  async isAvailable(): Promise<boolean> {
    if (process.env.LINE_MCP_TUNNEL === "off") return false;
    return binaryStatus() !== "unsupported-platform";
  }

  async put(variants: ImageVariants, key: string, opts?: PutOptions): Promise<HostResult> {
    const s = await ensureTunnel();
    const keepAliveMs = (opts?.keepAliveSeconds ?? IMAGEHOST_DEFAULT_KEEPALIVE_S) * 1000;
    s.expiresAtMs = Math.max(s.expiresAtMs, Date.now() + keepAliveMs);
    scheduleShutdown(s);

    const baseUrl = `${s.url}/i/${key}`;
    const urls: Record<string, string> = {};
    for (const size of IMAGEMAP_SIZES) urls[String(size)] = `${baseUrl}/${size}`;
    return {
      kind: "hosted",
      providerId: this.id,
      baseUrl,
      imageUrl: urls["1040"],
      previewImageUrl: urls["240"],
      urls,
      expiresAt: new Date(s.expiresAtMs).toISOString(),
      warnings: [
        "hosting is best-effort: the tunnel lives only while this MCP process runs — LINE fetches the image when each recipient FIRST VIEWS the message (live-verified), so keep this process running until the audience has opened it; once viewed, LINE's cache serves it permanently",
        "TryCloudflare is a free dev service with no SLA — for long-lived campaigns use a permanent host",
      ],
    };
  }

  async dispose(): Promise<void> {
    await disposeTunnel();
  }
}

export const localTunnelHost = new LocalTunnelHost();

/** For line_image_host_status: current tunnel facts without side effects. */
export function tunnelStatus(): { active: boolean; url?: string; expiresAt?: string } {
  if (!state || !procIsLive(state.proc)) return { active: false };
  return { active: true, url: state.url, expiresAt: new Date(state.expiresAtMs).toISOString() };
}

/** TEST-ONLY seam: tear down the singleton between tests. */
export async function __resetLocalTunnelForTests(): Promise<void> {
  await disposeTunnel();
}
