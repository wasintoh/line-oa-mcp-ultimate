/**
 * Shared helpers for the v2.0 LINE Shopping (MyShop) tools.
 *
 * Keeps the 13 shopping tools DRY: a single error formatter that maps
 * MyShopApiError (and anything else) into the MCP tool-result envelope, plus
 * the result type the handlers return.
 */

import { MyShopApiError } from "../line/myshop-client.js";
import { TH } from "../i18n/th.js";

export interface ToolTextResult {
  // Index signature required to match the MCP SDK's CallToolResult shape.
  [x: string]: unknown;
  isError?: boolean;
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
}

/** Map any thrown error into a Thai-friendly MCP error result. */
export function myShopError(err: unknown): ToolTextResult {
  if (err instanceof MyShopApiError) {
    return { isError: true, content: [{ type: "text", text: err.message }] };
  }
  const msg = err instanceof Error ? err.message : String(err);
  return { isError: true, content: [{ type: "text", text: TH.unknownError(msg) }] };
}

/** Convenience: a plain text + structured success result. */
export function ok(text: string, structured?: Record<string, unknown>): ToolTextResult {
  return { content: [{ type: "text", text }], structuredContent: structured };
}

/** Convenience: a plain text error (validation, missing arg) without an exception. */
export function fail(text: string): ToolTextResult {
  return { isError: true, content: [{ type: "text", text }] };
}
