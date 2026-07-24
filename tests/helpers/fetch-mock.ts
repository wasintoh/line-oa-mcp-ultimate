/**
 * Fetch-boundary mock for the LINE Messaging API and MyShop API.
 *
 * `LineClient` / `MyShopClient` are plain-fetch, so every test intercepts at
 * `globalThis.fetch` — no real network, no extra test dependencies. The mock
 * records every request (URL, method, headers incl. X-Line-Retry-Key, body)
 * and lets tests queue shaped responses / LINE-style errors (401/403/429/400
 * with `details`).
 *
 * Usage:
 *   const api = installFetchMock();            // in beforeEach
 *   api.on("/v2/bot/message/quota", { body: { type: "limited", value: 1000 } });
 *   ... run tool ...
 *   expect(api.callsTo("/v2/bot/message/push")).toHaveLength(1);
 *   api.uninstall();                            // in afterEach
 */

import { vi } from "vitest";

export interface RecordedCall {
  url: URL;
  method: string;
  /** Header names lower-cased. */
  headers: Record<string, string>;
  /** JSON-parsed body when the raw body is valid JSON, otherwise undefined. */
  body: unknown;
  /** Raw request body as given to fetch (string | Buffer | undefined). */
  rawBody: unknown;
}

export interface MockResponseSpec {
  /** HTTP status (default 200). */
  status?: number;
  /** JSON response body (default {}). */
  body?: unknown;
  /** Raw text response body — overrides `body` when set. */
  text?: string;
  headers?: Record<string, string>;
}

type SpecOrFn = MockResponseSpec | ((call: RecordedCall) => MockResponseSpec);

interface Route {
  method?: string;
  match: string | RegExp;
  spec: SpecOrFn;
  once: boolean;
  used: boolean;
}

export class FetchMock {
  public calls: RecordedCall[] = [];
  private routes: Route[] = [];

  /** Respond to any request whose pathname contains / matches `match`. */
  on(match: string | RegExp, spec: SpecOrFn = {}, opts: { method?: string; once?: boolean } = {}): this {
    this.routes.push({ match, spec, method: opts.method?.toUpperCase(), once: opts.once ?? false, used: false });
    return this;
  }

  /** Queue a LINE-style error response for a path. */
  onError(
    match: string | RegExp,
    status: number,
    message = "error",
    details?: { message: string; property?: string }[],
  ): this {
    return this.on(match, { status, body: details ? { message, details } : { message } });
  }

  install(): this {
    vi.stubGlobal("fetch", this.handler);
    return this;
  }

  uninstall(): void {
    vi.unstubAllGlobals();
  }

  callsTo(pathIncludes: string): RecordedCall[] {
    return this.calls.filter((c) => c.url.pathname.includes(pathIncludes));
  }

  lastCall(): RecordedCall | undefined {
    return this.calls[this.calls.length - 1];
  }

  reset(): void {
    this.calls = [];
    this.routes = [];
  }

  private handler = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = toUrl(input);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const headers = normalizeHeaders(input, init);
    const rawBody = init?.body ?? undefined;
    const body = tryParseJson(rawBody);
    const call: RecordedCall = { url, method, headers, body, rawBody };
    this.calls.push(call);

    for (const route of this.routes) {
      if (route.once && route.used) continue;
      if (route.method && route.method !== method) continue;
      const matched =
        typeof route.match === "string" ? url.pathname.includes(route.match) : route.match.test(url.pathname);
      if (!matched) continue;
      route.used = true;
      const spec = typeof route.spec === "function" ? route.spec(call) : route.spec;
      return buildResponse(spec);
    }
    // Default: succeed with an empty JSON object (LINE's usual happy-path shape).
    return buildResponse({});
  };
}

/** Create + install a fresh mock. Call `mock.uninstall()` in afterEach. */
export function installFetchMock(): FetchMock {
  return new FetchMock().install();
}

// ---- internals ----

function toUrl(input: RequestInfo | URL): URL {
  if (input instanceof URL) return input;
  if (typeof input === "string") return new URL(input);
  return new URL(input.url);
}

function normalizeHeaders(input: RequestInfo | URL, init?: RequestInit): Record<string, string> {
  const out: Record<string, string> = {};
  const source = init?.headers ?? (input instanceof Request ? input.headers : undefined);
  if (!source) return out;
  const h = new Headers(source as HeadersInit);
  h.forEach((v, k) => {
    out[k.toLowerCase()] = v;
  });
  return out;
}

function tryParseJson(rawBody: unknown): unknown {
  if (typeof rawBody !== "string") return undefined;
  try {
    return JSON.parse(rawBody);
  } catch {
    return undefined;
  }
}

function buildResponse(spec: MockResponseSpec): Response {
  const status = spec.status ?? 200;
  const text = spec.text ?? JSON.stringify(spec.body ?? {});
  return new Response(text, {
    status,
    headers: { "Content-Type": "application/json", ...(spec.headers ?? {}) },
  });
}
