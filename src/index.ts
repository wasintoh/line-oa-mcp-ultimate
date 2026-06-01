#!/usr/bin/env node
/**
 * Entry point for `line-oa-mcp-ultimate`.
 *
 * Runs an MCP server in one of two transports — chosen via the
 * MCP_TRANSPORT env var (or --http / --stdio CLI flag):
 *
 *   - stdio (default): subprocess transport used by Claude Code, Cursor,
 *     ChatGPT desktop, and Claude Desktop's classic MCP config.
 *
 *   - http: Streamable HTTP transport used by Claude Cowork's "Add custom
 *     connector" UI (which accepts a remote MCP URL).
 *
 * IMPORTANT for stdio: NEVER write to stdout (it carries the MCP protocol).
 * All diagnostics go through console.error.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { SERVER_NAME, SERVER_VERSION } from "./constants.js";
import { loadConfig } from "./config/multi-oa.js";
import { buildServer } from "./server.js";

type Transport = "stdio" | "http";

function pickTransport(): Transport {
  const argv = process.argv.slice(2);
  if (argv.includes("--http")) return "http";
  if (argv.includes("--stdio")) return "stdio";
  const env = (process.env.MCP_TRANSPORT ?? "").toLowerCase();
  if (env === "http") return "http";
  if (env === "stdio") return "stdio";
  return "stdio";
}

async function main(): Promise<void> {
  // Validate config eagerly so users see "missing token" early.
  try {
    const cfg = loadConfig();
    const oaCount = Object.keys(cfg.oas).length;
    console.error(
      `[${SERVER_NAME} v${SERVER_VERSION}] Loaded ${oaCount} OA(s). Default: "${cfg.default_oa}".`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${SERVER_NAME}] FATAL: ${message}`);
    process.exit(1);
  }

  const transport = pickTransport();
  const server = buildServer();

  if (transport === "stdio") {
    const t = new StdioServerTransport();
    await server.connect(t);
    console.error(`[${SERVER_NAME}] Ready (stdio).`);
    return;
  }

  // ---- HTTP mode (Streamable HTTP — stateless per-request) ----
  const host = process.env.MCP_HTTP_HOST ?? "127.0.0.1";
  const port = parseInt(process.env.MCP_HTTP_PORT ?? "3000", 10);
  const path = process.env.MCP_HTTP_PATH ?? "/mcp";

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

    // Simple health check for "is the server up?"
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
      console.error(`[${SERVER_NAME}] HTTP request error:`, err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
    }
  });

  httpServer.listen(port, host, () => {
    console.error(
      `[${SERVER_NAME}] Ready (http) — http://${host}:${port}${path}\n` +
        `  Health: http://${host}:${port}/health\n` +
        `  Paste the MCP URL into Cowork → Settings → MCPs → Add custom connector.`,
    );
  });

  // Graceful shutdown
  const shutdown = (signal: string): void => {
    console.error(`[${SERVER_NAME}] ${signal} received — shutting down.`);
    httpServer.close(() => process.exit(0));
    // Force exit after 5s if connections hang.
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error(`[${SERVER_NAME}] Unhandled error:`, err);
  process.exit(1);
});
