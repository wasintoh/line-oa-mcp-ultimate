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
 *     connector" UI (which accepts a remote MCP URL). The HTTP server itself
 *     lives in `src/http.ts` (auth, origin check, health, shutdown) — this
 *     file only parses env and hands off.
 *
 * IMPORTANT for stdio: NEVER write to stdout (it carries the MCP protocol).
 * All diagnostics go through console.error.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { SERVER_NAME, SERVER_VERSION } from "./constants.js";
import { loadConfig } from "./config/multi-oa.js";
import { redactSecrets } from "./line/redact.js";
import { buildServer } from "./server.js";
import { startHttpServer } from "./http.js";

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
      redactSecrets(
        `[${SERVER_NAME} v${SERVER_VERSION}] Loaded ${oaCount} OA(s). Default: "${cfg.default_oa}".`,
      ),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(redactSecrets(`[${SERVER_NAME}] FATAL: ${message}`));
    process.exit(1);
  }

  const transport = pickTransport();

  if (transport === "stdio") {
    const server = buildServer();
    const t = new StdioServerTransport();
    await server.connect(t);
    console.error(`[${SERVER_NAME}] Ready (stdio).`);
    return;
  }

  // ---- HTTP mode (Streamable HTTP — stateless, per-request server) ----
  // http.ts builds a FRESH McpServer for every request (the official SDK
  // stateless pattern): a single shared instance throws "Already connected
  // to a transport" the moment a real client overlaps requests (v2.2.0 bug).
  // Auth (MCP_HTTP_TOKEN), loopback-bind enforcement, origin check, /health,
  // and graceful shutdown all live in http.ts.
  await startHttpServer(buildServer, {
    host: process.env.MCP_HTTP_HOST ?? "127.0.0.1",
    port: parseInt(process.env.MCP_HTTP_PORT ?? "3000", 10),
    path: process.env.MCP_HTTP_PATH ?? "/mcp",
    authToken: process.env.MCP_HTTP_TOKEN,
    installSignalHandlers: true,
  });
}

main().catch((err) => {
  const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
  console.error(redactSecrets(`[${SERVER_NAME}] Unhandled error: ${message}`));
  process.exit(1);
});
