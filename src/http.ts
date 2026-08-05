/**
 * Streamable HTTP transport server (extracted from index.ts, Workstream B).
 *
 * Security model:
 *   - Default bind is loopback (127.0.0.1) — nothing leaves the machine.
 *   - `MCP_HTTP_TOKEN` (opts.authToken): when set, EVERY request to the MCP
 *     path must carry `Authorization: Bearer <token>`. The comparison is
 *     timing-safe (sha256 both sides → `crypto.timingSafeEqual`), and a bad or
 *     missing token gets a 401 JSON reply WITHOUT touching the MCP layer.
 *   - Binding a non-loopback host (0.0.0.0 especially) WITHOUT a token is
 *     refused at startup — an unauthenticated network-reachable endpoint could
 *     broadcast to every customer the shop has.
 *   - `/health` stays open in all modes and returns no secrets.
 *   - Origin-header allowlist (DNS-rebinding protection) as before.
 *
 * Concurrency model (v2.2.1):
 *   - STATELESS, one McpServer + one transport PER REQUEST — the official SDK
 *     stateless pattern. v2.2.0 shared a single McpServer across per-request
 *     transports; the SDK allows exactly one transport per server, so any
 *     overlapping request (a real client holds a GET stream while POSTing)
 *     threw "Already connected to a transport" → 500. Building the server
 *     fresh costs ~1ms per request (measured), far below the HTTP round-trip.
 *   - The MCP path speaks POST only. GET would park a server-push SSE stream
 *     per client; vanished peers (NAT timeout, closed laptop) never fire
 *     'close', so parked streams accumulate sockets + servers on a long-lived
 *     VPS. No tool here sends server-initiated notifications, so we answer
 *     405 (the SDK's own stateless example does the same, and clients treat
 *     it as "no push channel" per spec). DELETE is session teardown — there
 *     are no sessions.
 *   - Cross-request state (active OA, prepared images, config) lives at
 *     module level and is deliberately SHARED by all per-request servers.
 *     That also means it is shared by all CLIENTS of one instance — see the
 *     multi-client tripwire below and SECURITY.md known-limitation #4.
 *
 * IMPORTANT: diagnostics only via console.error (stdout is reserved for the
 * MCP protocol in stdio mode; we keep the discipline everywhere).
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { AddressInfo } from "node:net";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { SERVER_NAME, SERVER_VERSION } from "./constants.js";
import { activeOaId } from "./config/multi-oa.js";
import { TH } from "./i18n/th.js";
import { handleImageHostRequest } from "./imagehost/http-route.js";
import { registerSelfHost } from "./imagehost/providers/self.js";
import { redactSecrets, registerSecret } from "./line/redact.js";

export interface StartHttpServerOptions {
  /** Bind address. Default 127.0.0.1. Non-loopback REQUIRES authToken. */
  host?: string;
  /** Listen port. Default 3000. Use 0 for an ephemeral port (tests). */
  port?: number;
  /** URL path serving the MCP endpoint. Default /mcp. */
  path?: string;
  /** MCP_HTTP_TOKEN — when set, the MCP path requires `Authorization: Bearer <token>`. */
  authToken?: string;
  /**
   * Install SIGINT/SIGTERM handlers that close the server and exit the
   * process. index.ts passes true; tests leave it false.
   */
  installSignalHandlers?: boolean;
}

export interface RunningHttpServer {
  httpServer: Server;
  host: string;
  /** Actual bound port (differs from the requested one when 0 was requested). */
  port: number;
  path: string;
  /** Convenience: full MCP endpoint URL. */
  url: string;
  close: () => Promise<void>;
}

/** True for hosts that only ever accept same-machine connections. */
export function isLoopbackHost(host: string): boolean {
  const bare =
    host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  const lower = bare.toLowerCase();
  if (lower === "localhost" || lower === "::1") return true;
  if (isIP(lower) === 4) {
    const first = Number(lower.split(".")[0]);
    return first === 127; // whole 127.0.0.0/8 block is loopback
  }
  return false;
}

/** Timing-safe bearer-token comparison (hash both sides to equalize length). */
function tokenMatches(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

// ---- Multi-client tripwire (warn-only; per-session isolation is a v2.3 item) ----
//
// The active OA set by `line_use_oa` is process-wide module state. With one
// agent per instance that is exactly the UX we want; with SEVERAL clients on
// one instance, client A's switch silently retargets client B's next
// unqualified send — and a broadcast cannot be unsent. We cannot isolate
// state without sessions, but we CAN notice a second distinct client
// initializing while a switch is active, and shout about it in the log.
const seenClientIds = new Set<string>();

function trackClientInitialize(body: unknown): void {
  if (typeof body !== "object" || body === null) return;
  const b = body as {
    method?: unknown;
    params?: { clientInfo?: { name?: unknown; version?: unknown } };
  };
  if (b.method !== "initialize") return;
  const info = b.params?.clientInfo;
  const name = typeof info?.name === "string" ? info.name : "unknown-client";
  const version = typeof info?.version === "string" ? info.version : "?";
  const id = `${name}@${version}`;
  const active = activeOaId();
  if (active !== null && seenClientIds.size > 0 && !seenClientIds.has(id)) {
    console.error(`[${SERVER_NAME}] ${TH.httpMultiClientWarning(id, active)}`);
  }
  // Bounded: ids are tiny strings from authenticated clients only, but a
  // client baking a changing build id into its version string would
  // otherwise grow this set for the life of a long-running process.
  if (seenClientIds.size < 100) seenClientIds.add(id);
}

/** TEST-ONLY seam — reset the multi-client tripwire between tests. */
export function __resetHttpClientTrackingForTests(): void {
  seenClientIds.clear();
}

/**
 * Start the Streamable HTTP server. `buildServerFn` is called once per
 * incoming MCP request to create a fresh McpServer (see the concurrency
 * model in the file header — a shared instance cannot serve overlapping
 * requests). Resolves once listening. Throws (with a Thai console.error)
 * when a non-loopback bind is attempted without an auth token.
 */
export async function startHttpServer(
  buildServerFn: () => McpServer,
  opts: StartHttpServerOptions = {},
): Promise<RunningHttpServer> {
  const host = opts.host ?? "127.0.0.1";
  const requestedPort = opts.port ?? 3000;
  const path = opts.path ?? "/mcp";
  const authToken = opts.authToken;

  if (!isLoopbackHost(host) && !authToken) {
    const message = TH.httpPublicBindNeedsToken(host);
    console.error(`[${SERVER_NAME}] ${message}`);
    throw new Error(message);
  }
  // The HTTP auth token is a secret too — never let it surface in logs.
  registerSecret(authToken);

  // v2.2 self image-host: behind a proxy/tunnel the process cannot discover its
  // own public address — the operator declares it via MCP_PUBLIC_URL. Validated
  // here so a misconfiguration fails at boot, not silently at send time.
  if (process.env.MCP_PUBLIC_URL) {
    registerSelfHost(process.env.MCP_PUBLIC_URL);
    console.error(
      `[${SERVER_NAME}] Image self-host enabled — /i/* served under ${process.env.MCP_PUBLIC_URL}`,
    );
  }

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // DNS-rebinding protection — only accept connections to our host header.
    const originHeader = req.headers.origin;
    if (originHeader) {
      try {
        const originUrl = new URL(originHeader);
        const allowedHosts = new Set(["127.0.0.1", "localhost", host]);
        if (!allowedHosts.has(originUrl.hostname)) {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Origin not allowed" }));
          return;
        }
      } catch {
        /* malformed Origin — fall through; transport will refuse */
      }
    }

    // Simple health check for "is the server up?" — open in all modes, no secrets.
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, name: SERVER_NAME, version: SERVER_VERSION }));
      return;
    }

    // v2.2 image hosting: GET/HEAD /i/:key/:size served from the in-memory
    // store. Deliberately BEFORE the auth gate — LINE's CDN fetches without
    // credentials; unguessable keys (96-bit random + content hash) are the
    // access control here.
    if (handleImageHostRequest(req, res)) return;

    // Route only the MCP path; everything else 404.
    if (req.url !== path) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    // ---- Bearer-token auth gate (BEFORE any MCP processing) ----
    if (authToken) {
      const header = req.headers.authorization ?? "";
      const match = /^Bearer\s+(.+)$/.exec(header);
      const provided = match?.[1];
      if (!provided || !tokenMatches(provided, authToken)) {
        res.writeHead(401, {
          "Content-Type": "application/json",
          "WWW-Authenticate": 'Bearer realm="mcp"',
        });
        res.end(JSON.stringify({ error: TH.httpAuthRequired }));
        return;
      }
    }

    // ---- Method gate: this stateless JSON endpoint speaks POST only ----
    // GET would ask the SDK transport to open a server-push SSE stream per
    // client. Real clients auto-open that stream, and peers that vanish
    // without FIN (NAT timeout, closed laptop) never fire 'close' — parked
    // streams would pile up sockets + per-request servers on a long-running
    // VPS. No tool here pushes server-initiated notifications, so we answer
    // 405 like the SDK's own stateless example; clients treat it as "no push
    // channel" per spec. DELETE is session teardown — there are no sessions.
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json", Allow: "POST" });
      res.end(
        JSON.stringify({ error: "Method not allowed — this stateless MCP endpoint speaks POST only" }),
      );
      return;
    }

    try {
      // Read body (Node http does not parse JSON for us). The read lives
      // INSIDE the try: a client vanishing mid-body (NAT reset, mobile
      // drop) rejects this await — unhandled, that rejection would kill
      // the whole process (verified live; pre-existing before v2.2.1).
      let body: unknown = undefined;
      {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const raw = Buffer.concat(chunks).toString("utf8");
        if (raw) {
          try {
            body = JSON.parse(raw);
          } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid JSON" }));
            return;
          }
        }
      }

      // Warn-only guard: a SECOND distinct client initializing while an OA
      // switch is active is one unqualified send away from broadcasting as
      // the wrong shop.
      trackClientInitialize(body);

      // One fresh McpServer + one transport per request (SDK stateless
      // pattern). Also inside the try: buildServerFn() reads config and
      // throws when none exists (embedders/tests may call startHttpServer
      // without the eager config load that index.ts performs).
      const server = buildServerFn();
      const t = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      // Reclaim BOTH on response close — close() is idempotent in SDK 1.29,
      // and nothing else references the pair, so the whole per-request graph
      // is collectable afterwards.
      res.on("close", () => {
        t.close().catch(() => {
          /* ignore */
        });
        server.close().catch(() => {
          /* ignore */
        });
      });
      await server.connect(t);
      await t.handleRequest(req, res, body);
    } catch (err) {
      const clientVanished =
        err instanceof Error &&
        (err.message === "aborted" || (err as NodeJS.ErrnoException).code === "ECONNRESET");
      if (clientVanished) {
        // Routine on long-lived deployments (NAT reset, mobile drop) — one
        // quiet line, not a stack trace.
        console.error(`[${SERVER_NAME}] HTTP client disconnected mid-request`);
      } else {
        console.error(redactSecrets(`[${SERVER_NAME}] HTTP request error: ${describe(err)}`));
      }
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(requestedPort, host, () => {
      httpServer.removeListener("error", reject);
      resolve();
    });
  });

  const boundPort = (httpServer.address() as AddressInfo).port;
  const displayHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  const url = `http://${displayHost}:${boundPort}${path}`;
  console.error(
    redactSecrets(
      `[${SERVER_NAME}] Ready (http) — ${url}\n` +
        `  Health: http://${displayHost}:${boundPort}/health\n` +
        (authToken
          ? `  Auth: Authorization: Bearer <MCP_HTTP_TOKEN> required on ${path}\n`
          : "") +
        `  Paste the MCP URL into Cowork → Settings → MCPs → Add custom connector.`,
    ),
  );

  const close = (): Promise<void> =>
    new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
      // Sever keep-alive sockets so close() actually completes.
      httpServer.closeAllConnections();
    });

  if (opts.installSignalHandlers) {
    const shutdown = (signal: string): void => {
      console.error(`[${SERVER_NAME}] ${signal} received — shutting down.`);
      httpServer.close(() => process.exit(0));
      // Force exit after 5s if connections hang.
      setTimeout(() => process.exit(1), 5000).unref();
    };
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  }

  return { httpServer, host, port: boundPort, path, url, close };
}

// ---- internals ----

function describe(err: unknown): string {
  if (err instanceof Error) return err.stack ?? err.message;
  return String(err);
}
