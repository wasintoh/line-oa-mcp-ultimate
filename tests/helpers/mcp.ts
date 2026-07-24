/**
 * In-memory MCP client/server pair for end-to-end tool tests.
 *
 * Tests exercise the REAL MCP surface (schema validation included) by calling
 * tools through the SDK's InMemoryTransport instead of poking handlers
 * directly. Combine with `installFetchMock()` so no LINE call leaves the test.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { buildServer } from "../../src/server.js";

export interface TestMcp {
  client: Client;
  close: () => Promise<void>;
  /** Call a tool and return the full result (content + structuredContent + isError). */
  callTool: (name: string, args: Record<string, unknown>) => Promise<ToolResult>;
}

export interface ToolResult {
  content?: { type: string; text?: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/** Build the real server (with current env/config) and connect a client to it. */
export async function createTestMcp(): Promise<TestMcp> {
  const server = buildServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "vitest", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return {
    client,
    close: async () => {
      await client.close();
    },
    callTool: async (name, args) =>
      (await client.callTool({ name, arguments: args })) as ToolResult,
  };
}

/** First text block of a tool result ("" when absent). */
export function firstText(result: ToolResult): string {
  return result.content?.find((c) => c.type === "text")?.text ?? "";
}
