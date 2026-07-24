/**
 * Guardrail tests — transport picker (src/line/transports.ts).
 *
 * pickTransport with a REAL LineClient over the fetch mock. Every one of the
 * six target shapes must hit its exact LINE endpoint with the exact body:
 * reply / push / multicast (500-per-call chunking) / narrowcast by audience
 * (audienceGroupId as number) / narrowcast by demographic filter (single
 * condition unwrapped vs multiple wrapped in {operator:{and:[...]}}) /
 * broadcast. Validate closures must hit the matching /validate/* endpoints.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LineClient } from "../../src/line/client.js";
import { pickTransport } from "../../src/line/transports.js";
import type { LineMessage } from "../../src/types.js";
import { installFetchMock, type FetchMock } from "../helpers/fetch-mock.js";

const MESSAGES: LineMessage[] = [{ type: "text", text: "สวัสดีค่ะ" }];

let api: FetchMock;
let client: LineClient;

beforeEach(() => {
  api = installFetchMock();
  client = new LineClient({ channelAccessToken: "transport-token" });
});

afterEach(() => {
  api.uninstall();
});

describe("reply transport", () => {
  it("send hits /v2/bot/message/reply with the resolved token", async () => {
    const picked = pickTransport({
      client,
      target: { reply_to: "evt-abc" },
      resolveReplyToken: (id) => (id === "evt-abc" ? "RTOKEN-1" : undefined),
    });

    expect(picked.transport).toBe("reply");
    expect(picked.estimatedRecipients).toBe(1);

    await picked.send(MESSAGES);
    const calls = api.callsTo("/v2/bot/message/reply");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.body).toEqual({ replyToken: "RTOKEN-1", messages: MESSAGES });
    expect(calls[0]!.headers.authorization).toBe("Bearer transport-token");
  });

  it("validate hits /v2/bot/message/validate/reply", async () => {
    const picked = pickTransport({
      client,
      target: { reply_to: "evt-abc" },
      resolveReplyToken: () => "RTOKEN-1",
    });
    await picked.validate(MESSAGES);
    const calls = api.callsTo("/v2/bot/message/validate/reply");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toEqual({ messages: MESSAGES });
  });

  it("WITHOUT resolveReplyToken exposes unavailableReason and send() rejects in Thai (v2.1)", async () => {
    const picked = pickTransport({ client, target: { reply_to: "evt-gone" } });

    expect(picked.transport).toBe("reply");
    expect(picked.estimatedRecipients).toBe(1);
    expect(picked.unavailableReason).toContain("ใช้ reply token ไม่ได้");
    await expect(picked.send(MESSAGES)).rejects.toThrow("ใช้ reply token ไม่ได้");
    // Nothing was sent anywhere.
    expect(api.callsTo("/v2/bot/message/reply")).toHaveLength(0);
    expect(api.callsTo("/v2/bot/message/push")).toHaveLength(0);
  });

  it("WITHOUT resolveReplyToken validate() now validates the real messages via /validate/reply (v2.1)", async () => {
    const picked = pickTransport({ client, target: { reply_to: "evt-gone" } });
    await picked.validate(MESSAGES);
    const calls = api.callsTo("/v2/bot/message/validate/reply");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toEqual({ messages: MESSAGES });
  });
});

describe("push transport (user_id)", () => {
  it("send hits /v2/bot/message/push with retry key; validate hits /validate/push", async () => {
    const picked = pickTransport({ client, target: { user_id: "U-one" } });

    expect(picked.transport).toBe("push");
    expect(picked.estimatedRecipients).toBe(1);

    await picked.validate(MESSAGES);
    await picked.send(MESSAGES, { retryKey: "retry-123" });

    const validates = api.callsTo("/v2/bot/message/validate/push");
    expect(validates).toHaveLength(1);
    expect(validates[0]!.body).toEqual({ messages: MESSAGES });

    const sends = api.callsTo("/v2/bot/message/push");
    expect(sends).toHaveLength(1);
    expect(sends[0]!.body).toEqual({ to: "U-one", messages: MESSAGES });
    expect(sends[0]!.headers["x-line-retry-key"]).toBe("retry-123");
  });
});

describe("multicast transport (user_ids) — exact 500-chunking", () => {
  it("1200 ids → exactly 3 calls of 500/500/200 preserving id order", async () => {
    const ids = Array.from({ length: 1200 }, (_, i) => `U${String(i).padStart(4, "0")}`);
    const picked = pickTransport({ client, target: { user_ids: ids } });

    expect(picked.transport).toBe("multicast");
    expect(picked.estimatedRecipients).toBe(1200);

    await picked.send(MESSAGES, { retryKey: "retry-multi" });

    const calls = api.callsTo("/v2/bot/message/multicast");
    expect(calls).toHaveLength(3);

    const bodies = calls.map((c) => c.body as { to: string[]; messages: LineMessage[] });
    expect(bodies[0]!.to).toHaveLength(500);
    expect(bodies[1]!.to).toHaveLength(500);
    expect(bodies[2]!.to).toHaveLength(200);

    // Exact chunk contents + order
    expect(bodies[0]!.to).toEqual(ids.slice(0, 500));
    expect(bodies[1]!.to).toEqual(ids.slice(500, 1000));
    expect(bodies[2]!.to).toEqual(ids.slice(1000, 1200));

    // Boundary spot checks
    expect(bodies[0]!.to[0]).toBe("U0000");
    expect(bodies[0]!.to[499]).toBe("U0499");
    expect(bodies[1]!.to[0]).toBe("U0500");
    expect(bodies[2]!.to[199]).toBe("U1199");

    // Every chunk carries the same messages and the same retry key
    for (const call of calls) {
      expect((call.body as { messages: LineMessage[] }).messages).toEqual(MESSAGES);
      expect(call.headers["x-line-retry-key"]).toBe("retry-multi");
    }
  });

  it("exactly 500 ids → a single call (no off-by-one split)", async () => {
    const ids = Array.from({ length: 500 }, (_, i) => `U${i}`);
    const picked = pickTransport({ client, target: { user_ids: ids } });
    await picked.send(MESSAGES);
    const calls = api.callsTo("/v2/bot/message/multicast");
    expect(calls).toHaveLength(1);
    expect((calls[0]!.body as { to: string[] }).to).toEqual(ids);
  });

  it("501 ids → 500 + 1", async () => {
    const ids = Array.from({ length: 501 }, (_, i) => `U${i}`);
    const picked = pickTransport({ client, target: { user_ids: ids } });
    await picked.send(MESSAGES);
    const calls = api.callsTo("/v2/bot/message/multicast");
    expect(calls).toHaveLength(2);
    expect((calls[0]!.body as { to: string[] }).to).toHaveLength(500);
    expect((calls[1]!.body as { to: string[] }).to).toEqual(["U500"]);
  });

  it("validate hits /v2/bot/message/validate/multicast once (no chunk fan-out)", async () => {
    const ids = Array.from({ length: 1200 }, (_, i) => `U${i}`);
    const picked = pickTransport({ client, target: { user_ids: ids } });
    await picked.validate(MESSAGES);
    expect(api.callsTo("/v2/bot/message/validate/multicast")).toHaveLength(1);
    expect(api.callsTo("/v2/bot/message/multicast")).toHaveLength(0);
  });
});

describe("narrowcast transport (audience)", () => {
  it("send hits /narrowcast with recipient.audienceGroupId as a NUMBER and surfaces requestId", async () => {
    api.on("/v2/bot/message/narrowcast", { body: { requestId: "req-777" } }, { method: "POST" });
    const picked = pickTransport({ client, target: { audience: "12345" } });

    expect(picked.transport).toBe("narrowcast");
    expect(picked.estimatedRecipients).toBeUndefined();

    const result = await picked.send(MESSAGES, { retryKey: "retry-nc" });
    expect(result.request_id).toBe("req-777");

    const calls = api.callsTo("/v2/bot/message/narrowcast");
    expect(calls).toHaveLength(1);
    const body = calls[0]!.body as { messages: unknown; recipient: Record<string, unknown> };
    expect(body.messages).toEqual(MESSAGES);
    expect(body.recipient).toEqual({ type: "audience", audienceGroupId: 12345 });
    expect(typeof body.recipient.audienceGroupId).toBe("number");
    expect(calls[0]!.headers["x-line-retry-key"]).toBe("retry-nc");
  });

  it("resolvedAudienceId (from a name lookup) overrides target.audience", async () => {
    const picked = pickTransport({
      client,
      target: { audience: "ลูกค้าประจำ" },
      resolvedAudienceId: "999",
    });
    await picked.send(MESSAGES);
    const body = api.callsTo("/v2/bot/message/narrowcast")[0]!.body as {
      recipient: { audienceGroupId: number };
    };
    expect(body.recipient.audienceGroupId).toBe(999);
  });

  it("validate hits /validate/narrowcast with the same recipient", async () => {
    const picked = pickTransport({ client, target: { audience: "12345" } });
    await picked.validate(MESSAGES);
    const calls = api.callsTo("/v2/bot/message/validate/narrowcast");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toEqual({
      messages: MESSAGES,
      recipient: { type: "audience", audienceGroupId: 12345 },
    });
  });
});

describe("narrowcast transport (demographic filter)", () => {
  it("single condition is unwrapped (no operator wrapper)", async () => {
    const picked = pickTransport({ client, target: { filter: { genders: ["female"] } } });

    expect(picked.transport).toBe("narrowcast");
    await picked.send(MESSAGES);

    const body = api.callsTo("/v2/bot/message/narrowcast")[0]!.body as {
      filter: { demographic: Record<string, unknown> };
    };
    expect(body.filter.demographic).toEqual({ type: "gender", oneOf: ["female"] });
  });

  it("multiple conditions wrap in {operator:{and:[...]}} and map every filter key", async () => {
    const picked = pickTransport({
      client,
      target: {
        filter: {
          genders: ["female", "male"],
          ages: ["age_25", "age_30"],
          areas: ["bangkok", "chiangmai"],
          app_types: ["ios", "android"],
          subscription_periods: ["day_30"],
        },
      },
    });

    await picked.send(MESSAGES);

    const body = api.callsTo("/v2/bot/message/narrowcast")[0]!.body as {
      filter: { demographic: { operator: { and: Record<string, unknown>[] } } };
    };
    expect(body.filter.demographic).toEqual({
      operator: {
        and: [
          { type: "gender", oneOf: ["female", "male"] },
          { type: "age", oneOf: ["age_25", "age_30"] },
          { type: "area", oneOf: ["bangkok", "chiangmai"] },
          { type: "appType", oneOf: ["ios", "android"] },
          { type: "subscriptionPeriod", oneOf: ["day_30"] },
        ],
      },
    });
  });

  it("validate hits /validate/narrowcast with the identical demographic mapping", async () => {
    const picked = pickTransport({
      client,
      target: { filter: { ages: ["age_20"], areas: ["bangkok"] } },
    });
    await picked.validate(MESSAGES);
    const calls = api.callsTo("/v2/bot/message/validate/narrowcast");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toEqual({
      messages: MESSAGES,
      filter: {
        demographic: {
          operator: {
            and: [
              { type: "age", oneOf: ["age_20"] },
              { type: "area", oneOf: ["bangkok"] },
            ],
          },
        },
      },
    });
  });
});

describe("broadcast transport (everyone)", () => {
  it("send hits /v2/bot/message/broadcast; validate hits /validate/broadcast", async () => {
    const picked = pickTransport({ client, target: { everyone: true } });

    expect(picked.transport).toBe("broadcast");
    expect(picked.estimatedRecipients).toBeUndefined();

    await picked.validate(MESSAGES);
    await picked.send(MESSAGES, { retryKey: "retry-bc" });

    const validates = api.callsTo("/v2/bot/message/validate/broadcast");
    expect(validates).toHaveLength(1);
    expect(validates[0]!.body).toEqual({ messages: MESSAGES });

    const sends = api.callsTo("/v2/bot/message/broadcast");
    expect(sends).toHaveLength(1);
    expect(sends[0]!.body).toEqual({ messages: MESSAGES });
    expect(sends[0]!.headers["x-line-retry-key"]).toBe("retry-bc");
  });
});
