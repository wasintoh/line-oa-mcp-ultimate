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
import { TH } from "./i18n/th.js";
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

/**
 * Start the Streamable HTTP server for an already-built MCP server.
 * Resolves once listening. Throws (with a Thai console.error) when a
 * non-loopback bind is attempted without an auth token.
 */
export async function startHttpServer(
  server: McpServer,
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

    // Read body (Node http does not parse JSON for us).
    let body: unknown = undefined;
    if (req.method === "POST") {
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

    // One transport per request (stateless mode — recommended by MCP docs).
    const t = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      t.close().catch(() => {
        /* ignore */
      });
    });
    try {
      await server.connect(t);
      await t.handleRequest(req, res, body);
    } catch (err) {
      console.error(redactSecrets(`[${SERVER_NAME}] HTTP request error: ${describe(err)}`));
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
