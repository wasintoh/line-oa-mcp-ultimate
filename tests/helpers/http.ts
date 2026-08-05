/**
 * Shared JSON-RPC-over-HTTP helpers for tests that talk to the REAL http
 * transport (src/http.ts) with the REAL global fetch.
 *
 * IMPORTANT: never combine these with installFetchMock() — that helper stubs
 * globalThis.fetch and would swallow the very requests these helpers make.
 * For in-memory tool tests use createTestMcp() instead; it bypasses http.ts
 * entirely and cannot exercise wire behavior.
 */

/** Build a JSON-RPC initialize body (protocol 2025-03-26) for a given client identity. */
export function initializeBody(clientName = "vitest-http", clientVersion = "0.0.0"): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: clientName, version: clientVersion },
    },
  });
}

/** The default initialize body most tests use. */
export const INITIALIZE_BODY = initializeBody();

/** POST a raw JSON-RPC body to the MCP endpoint with MCP-correct headers. */
export function postJsonRpc(
  url: string,
  body: string,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...extraHeaders,
    },
    body,
  });
}

/** POST an initialize request (the classic smoke call). */
export function postInitialize(
  url: string,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  return postJsonRpc(url, INITIALIZE_BODY, extraHeaders);
}

/** POST a tools/call request. */
export function postToolCall(
  url: string,
  name: string,
  args: Record<string, unknown> = {},
  id = 2,
): Promise<Response> {
  return postJsonRpc(
    url,
    JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }),
  );
}
