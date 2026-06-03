/**
 * Thin LINE API client.
 *
 * We intentionally avoid `@line/bot-sdk`'s `Client` class for the hot paths
 * and instead call the REST endpoints directly via `fetch`. This gives us:
 *   - Smaller install footprint (no axios chain through SDK)
 *   - Direct control over `X-Line-Retry-Key`, the two API base domains, and
 *     per-call timeouts
 *   - Cleaner typed responses tailored to MCP's structured-content needs
 *
 * The SDK is still listed as a dependency because we re-use its message-object
 * type helpers and (later) its webhook signature verifier.
 */

import { randomUUID } from "node:crypto";

import { LINE_API_BASE, LINE_API_DATA_BASE } from "../constants.js";
import { TH } from "../i18n/th.js";
import type { LineMessage, LineQuota, LineQuotaConsumption } from "../types.js";

export interface LineClientOptions {
  channelAccessToken: string;
  /** Base URL override (used by tests). */
  apiBase?: string;
  /** Base URL for content / file uploads. */
  apiDataBase?: string;
}

export interface LineApiErrorShape {
  message?: string;
  details?: { message: string; property?: string }[];
}

export class LineApiError extends Error {
  public readonly status: number;
  public readonly body: unknown;
  public readonly details: string[];

  constructor(status: number, body: unknown) {
    super(formatMessage(status, body));
    this.status = status;
    this.body = body;
    this.details = collectDetails(body);
    this.name = "LineApiError";
  }
}

function formatMessage(status: number, body: unknown): string {
  if (status === 401) return TH.unauthorized;
  if (status === 403) return TH.forbidden;
  if (status === 429) return TH.rateLimited;
  const b = body as LineApiErrorShape | undefined;
  if (b?.message) return `LINE ${status}: ${b.message}`;
  return `LINE ${status}`;
}

function collectDetails(body: unknown): string[] {
  const b = body as LineApiErrorShape | undefined;
  if (!b?.details) return [];
  return b.details.map((d) => (d.property ? `${d.property}: ${d.message}` : d.message));
}

export class LineClient {
  private readonly token: string;
  private readonly apiBase: string;
  private readonly apiDataBase: string;

  constructor(opts: LineClientOptions) {
    this.token = opts.channelAccessToken;
    this.apiBase = opts.apiBase ?? LINE_API_BASE;
    this.apiDataBase = opts.apiDataBase ?? LINE_API_DATA_BASE;
  }

  // ---- low-level request ----

  async request<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    options: {
      body?: unknown;
      query?: Record<string, string | number | boolean | undefined>;
      retryKey?: string;
      useDataDomain?: boolean;
    } = {},
  ): Promise<T> {
    const base = options.useDataDomain ? this.apiDataBase : this.apiBase;
    const url = new URL(`${base}${path}`);
    if (options.query) {
      for (const [k, v] of Object.entries(options.query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/json",
    };
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    if (options.retryKey) {
      headers["X-Line-Retry-Key"] = options.retryKey;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new LineApiError(0, { message: `Network error: ${msg}` });
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    const body = text ? safeJson(text) : {};
    if (!response.ok) {
      throw new LineApiError(response.status, body);
    }
    return body as T;
  }

  /** Generate an idempotency key suitable for `X-Line-Retry-Key`. */
  retryKey(): string {
    return randomUUID();
  }

  // ---- send endpoints ----

  reply(replyToken: string, messages: LineMessage[]): Promise<unknown> {
    return this.request("POST", "/v2/bot/message/reply", {
      body: { replyToken, messages },
    });
  }

  push(to: string, messages: LineMessage[], retryKey?: string): Promise<unknown> {
    return this.request("POST", "/v2/bot/message/push", {
      body: { to, messages },
      retryKey,
    });
  }

  multicast(to: string[], messages: LineMessage[], retryKey?: string): Promise<unknown> {
    return this.request("POST", "/v2/bot/message/multicast", {
      body: { to, messages },
      retryKey,
    });
  }

  narrowcast(body: Record<string, unknown>, retryKey?: string): Promise<{ requestId?: string }> {
    return this.request("POST", "/v2/bot/message/narrowcast", { body, retryKey });
  }

  broadcast(messages: LineMessage[], retryKey?: string): Promise<unknown> {
    return this.request("POST", "/v2/bot/message/broadcast", {
      body: { messages },
      retryKey,
    });
  }

  // ---- validate endpoints (pre-flight) ----

  validateReply(messages: LineMessage[]): Promise<unknown> {
    return this.request("POST", "/v2/bot/message/validate/reply", { body: { messages } });
  }

  validatePush(messages: LineMessage[]): Promise<unknown> {
    return this.request("POST", "/v2/bot/message/validate/push", { body: { messages } });
  }

  validateMulticast(messages: LineMessage[]): Promise<unknown> {
    return this.request("POST", "/v2/bot/message/validate/multicast", { body: { messages } });
  }

  validateNarrowcast(body: Record<string, unknown>): Promise<unknown> {
    return this.request("POST", "/v2/bot/message/validate/narrowcast", { body });
  }

  validateBroadcast(messages: LineMessage[]): Promise<unknown> {
    return this.request("POST", "/v2/bot/message/validate/broadcast", { body: { messages } });
  }

  // ---- quota / consumption ----

  getQuota(): Promise<LineQuota> {
    return this.request("GET", "/v2/bot/message/quota");
  }

  getConsumption(): Promise<LineQuotaConsumption> {
    return this.request("GET", "/v2/bot/message/quota/consumption");
  }

  // ---- bot info ----

  getBotInfo(): Promise<{
    userId: string;
    basicId: string;
    premiumId?: string;
    displayName: string;
    pictureUrl?: string;
    chatMode: string;
    markAsReadMode: string;
  }> {
    return this.request("GET", "/v2/bot/info");
  }

  // ---- webhook ----

  getWebhookEndpoint(): Promise<{ endpoint: string; active: boolean }> {
    return this.request("GET", "/v2/bot/channel/webhook/endpoint");
  }

  testWebhook(endpoint?: string): Promise<{
    success: boolean;
    timestamp: number;
    statusCode: number;
    reason: string;
    detail: string;
  }> {
    return this.request("POST", "/v2/bot/channel/webhook/test", {
      body: endpoint ? { endpoint } : {},
    });
  }

  // ---- profile ----

  getProfile(userId: string): Promise<{
    userId: string;
    displayName: string;
    pictureUrl?: string;
    statusMessage?: string;
    language?: string;
  }> {
    return this.request("GET", `/v2/bot/profile/${encodeURIComponent(userId)}`);
  }

  // ---- insight ----

  getInsightDemographic(): Promise<unknown> {
    return this.request("GET", "/v2/bot/insight/demographic");
  }

  getInsightFollowers(date: string /* YYYYMMDD */): Promise<unknown> {
    return this.request("GET", "/v2/bot/insight/followers", { query: { date } });
  }

  getInsightDelivery(date: string): Promise<unknown> {
    return this.request("GET", "/v2/bot/insight/message/delivery", { query: { date } });
  }

  getInsightMessageEvent(requestId: string): Promise<unknown> {
    return this.request("GET", "/v2/bot/insight/message/event", { query: { requestId } });
  }

  // ---- rich menu ----

  getDefaultRichMenu(): Promise<{ richMenuId: string } | null> {
    return this.request<{ richMenuId: string }>("GET", "/v2/bot/user/all/richmenu").catch(
      (err: unknown) => {
        if (err instanceof LineApiError && err.status === 404) return null;
        throw err;
      },
    );
  }

  listRichMenus(): Promise<{ richmenus: { richMenuId: string; name: string; selected: boolean; size?: { width: number; height: number }; chatBarText?: string; areas?: unknown[] }[] }> {
    return this.request("GET", "/v2/bot/richmenu/list");
  }

  getRichMenu(richMenuId: string): Promise<{ richMenuId: string; name: string; chatBarText: string; size: { width: number; height: number }; selected: boolean; areas: unknown[] }> {
    return this.request("GET", `/v2/bot/richmenu/${encodeURIComponent(richMenuId)}`);
  }

  deleteRichMenu(richMenuId: string): Promise<unknown> {
    return this.request("DELETE", `/v2/bot/richmenu/${encodeURIComponent(richMenuId)}`);
  }

  getRichMenuOfUser(userId: string): Promise<{ richMenuId: string } | null> {
    return this.request<{ richMenuId: string }>(
      "GET",
      `/v2/bot/user/${encodeURIComponent(userId)}/richmenu`,
    ).catch((err: unknown) => {
      if (err instanceof LineApiError && err.status === 404) return null;
      throw err;
    });
  }

  // ---- chat indicators ----

  showLoading(chatId: string, loadingSeconds: number): Promise<unknown> {
    return this.request("POST", "/v2/bot/chat/loading/start", {
      body: { chatId, loadingSeconds },
    });
  }

  // ---- per-message stats ----

  getMessageEvent(requestId: string): Promise<unknown> {
    return this.request("GET", "/v2/bot/insight/message/event", { query: { requestId } });
  }

  // ---- followers ----

  listFollowerIds(continuationToken?: string, limit?: number): Promise<{
    userIds: string[];
    next?: string;
  }> {
    return this.request("GET", "/v2/bot/followers/ids", {
      query: {
        start: continuationToken,
        limit,
      },
    });
  }

  // ---- audiences ----

  createAudienceFromUserIds(body: {
    description: string;
    audiences: { id: string }[];
    isIfaAudience?: boolean;
    uploadDescription?: string;
  }): Promise<{ audienceGroupId: number; description: string; type: string; created: number }> {
    return this.request("POST", "/v2/bot/audienceGroup/upload", { body });
  }

  createClickAudience(body: {
    description: string;
    requestId: string;
    clickUrl?: string;
  }): Promise<{ audienceGroupId: number }> {
    return this.request("POST", "/v2/bot/audienceGroup/click", { body });
  }

  createImpAudience(body: {
    description: string;
    requestId: string;
  }): Promise<{ audienceGroupId: number }> {
    return this.request("POST", "/v2/bot/audienceGroup/imp", { body });
  }

  getAudienceGroup(audienceGroupId: number): Promise<{
    audienceGroup: { audienceGroupId: number; description: string; status: string; audienceCount?: number; created: number; type?: string };
  }> {
    return this.request("GET", `/v2/bot/audienceGroup/${audienceGroupId}`);
  }

  deleteAudienceGroup(audienceGroupId: number): Promise<unknown> {
    return this.request("DELETE", `/v2/bot/audienceGroup/${audienceGroupId}`);
  }

  // ---- coupons ----

  createCoupon(body: Record<string, unknown>): Promise<{ couponId: string }> {
    return this.request("POST", "/v2/bot/coupon", { body });
  }

  listCoupons(status?: string): Promise<{
    items?: Array<Record<string, unknown>>;
    coupons?: Array<Record<string, unknown>>;
    next?: string;
  }> {
    // LINE returns a pager response: { items: [...], next?: "..." }.
    // Older assumptions used `coupons`; we read either to stay robust.
    return this.request("GET", "/v2/bot/coupon", {
      query: status ? { status } : undefined,
    });
  }

  getCoupon(couponId: string): Promise<Record<string, unknown>> {
    return this.request("GET", `/v2/bot/coupon/${encodeURIComponent(couponId)}`);
  }

  discontinueCoupon(couponId: string): Promise<unknown> {
    return this.request("PUT", `/v2/bot/coupon/${encodeURIComponent(couponId)}/close`);
  }

  // ---- LIFF apps (LIFF Server API v1) ----

  listLiffApps(): Promise<{
    apps: Array<{
      liffId: string;
      view: { type: string; url: string };
      description?: string;
      features?: { ble?: boolean; qrCode?: boolean };
      permanentLinkPattern?: string;
      scope?: string[];
      botPrompt?: string;
    }>;
  }> {
    return this.request("GET", "/liff/v1/apps");
  }

  createLiffApp(body: Record<string, unknown>): Promise<{ liffId: string }> {
    return this.request("POST", "/liff/v1/apps", { body });
  }

  updateLiffApp(liffId: string, body: Record<string, unknown>): Promise<unknown> {
    return this.request("PUT", `/liff/v1/apps/${encodeURIComponent(liffId)}`, { body });
  }

  deleteLiffApp(liffId: string): Promise<unknown> {
    return this.request("DELETE", `/liff/v1/apps/${encodeURIComponent(liffId)}`);
  }

  // ---- rich menu: per-user link (v2) ----

  linkRichMenuToUser(userId: string, richMenuId: string): Promise<unknown> {
    return this.request(
      "POST",
      `/v2/bot/user/${encodeURIComponent(userId)}/richmenu/${encodeURIComponent(richMenuId)}`,
    );
  }

  unlinkRichMenuFromUser(userId: string): Promise<unknown> {
    return this.request("DELETE", `/v2/bot/user/${encodeURIComponent(userId)}/richmenu`);
  }

  bulkLinkRichMenu(richMenuId: string, userIds: string[]): Promise<unknown> {
    return this.request("POST", "/v2/bot/richmenu/bulk/link", {
      body: { richMenuId, userIds },
    });
  }

  bulkUnlinkRichMenu(userIds: string[]): Promise<unknown> {
    return this.request("POST", "/v2/bot/richmenu/bulk/unlink", {
      body: { userIds },
    });
  }

  // ---- rich menu: default (v2) ----

  setDefaultRichMenu(richMenuId: string): Promise<unknown> {
    return this.request(
      "POST",
      `/v2/bot/user/all/richmenu/${encodeURIComponent(richMenuId)}`,
    );
  }

  clearDefaultRichMenu(): Promise<unknown> {
    return this.request("DELETE", "/v2/bot/user/all/richmenu");
  }

  // ---- rich menu: image upload to existing menu (api-data domain, raw body) (v2) ----

  async uploadRichMenuImage(
    richMenuId: string,
    image: Buffer,
    contentType: string,
  ): Promise<void> {
    const url = new URL(
      `/v2/bot/richmenu/${encodeURIComponent(richMenuId)}/content`,
      this.apiDataBase,
    );
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": contentType,
      },
      body: image,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new LineApiError(res.status, text ? safeJson(text) : { message: "upload failed" });
    }
  }

  // ---- rich menu alias (v2) ----

  createRichMenuAlias(richMenuAliasId: string, richMenuId: string): Promise<unknown> {
    return this.request("POST", "/v2/bot/richmenu/alias", {
      body: { richMenuAliasId, richMenuId },
    });
  }

  updateRichMenuAlias(richMenuAliasId: string, richMenuId: string): Promise<unknown> {
    return this.request(
      "POST",
      `/v2/bot/richmenu/alias/${encodeURIComponent(richMenuAliasId)}`,
      { body: { richMenuId } },
    );
  }

  deleteRichMenuAlias(richMenuAliasId: string): Promise<unknown> {
    return this.request(
      "DELETE",
      `/v2/bot/richmenu/alias/${encodeURIComponent(richMenuAliasId)}`,
    );
  }

  getRichMenuAlias(
    richMenuAliasId: string,
  ): Promise<{ richMenuAliasId: string; richMenuId: string }> {
    return this.request(
      "GET",
      `/v2/bot/richmenu/alias/${encodeURIComponent(richMenuAliasId)}`,
    );
  }

  listRichMenuAliases(): Promise<{
    aliases: { richMenuAliasId: string; richMenuId: string }[];
  }> {
    return this.request("GET", "/v2/bot/richmenu/alias/list");
  }

  // ---- audience mutation (v2) ----

  addAudienceUsers(body: {
    audienceGroupId: number;
    audiences: { id: string }[];
    uploadDescription?: string;
  }): Promise<unknown> {
    return this.request("PUT", "/v2/bot/audienceGroup/upload", { body });
  }

  renameAudience(audienceGroupId: number, description: string): Promise<unknown> {
    return this.request(
      "PUT",
      `/v2/bot/audienceGroup/${audienceGroupId}/updateDescription`,
      { body: { description } },
    );
  }

  // ---- webhook endpoint: set (v2; get/test already above) ----

  setWebhookEndpoint(endpoint: string): Promise<unknown> {
    return this.request("PUT", "/v2/bot/channel/webhook/endpoint", {
      body: { endpoint },
    });
  }

  // ---- narrowcast progress (v2) ----

  getNarrowcastProgress(requestId: string): Promise<{
    phase: string;
    successCount?: number;
    failureCount?: number;
    targetCount?: number;
    failedDescription?: string;
    errorCode?: number;
    acceptedTime?: string;
    completedTime?: string;
  }> {
    return this.request("GET", "/v2/bot/message/progress/narrowcast", {
      query: { requestId },
    });
  }

  // ---- account link token (v2) ----

  issueLinkToken(userId: string): Promise<{ linkToken: string }> {
    return this.request("POST", `/v2/bot/user/${encodeURIComponent(userId)}/linkToken`);
  }

  // ---- token verify (v2; access_token as query param, no Bearer) ----

  async verifyAccessToken(accessToken?: string): Promise<{
    client_id: string;
    expires_in: number;
    scope?: string;
  }> {
    const token = accessToken ?? this.token;
    const url = new URL("/oauth2/v2.1/verify", this.apiBase);
    url.searchParams.set("access_token", token);
    const res = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });
    const text = await res.text();
    const body = text ? safeJson(text) : {};
    if (!res.ok) {
      throw new LineApiError(res.status, body);
    }
    return body as { client_id: string; expires_in: number; scope?: string };
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}
