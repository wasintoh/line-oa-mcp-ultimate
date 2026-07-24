/**
 * Guardrail tests — Quota Guardian (src/line/quota-guardian.ts).
 *
 * Exercises checkQuota + snapshotQuota through a REAL LineClient against the
 * shared fetch mock: hard block (over_quota), soft block (needs_confirmation
 * at >95% of remaining), confirm override, >50% advisory warning, unlimited
 * passthrough, and snapshot arithmetic incl. rounding.
 *
 * NOTE on route order: the fetch mock matches by pathname SUBSTRING, and
 * "/v2/bot/message/quota" is a prefix of "/v2/bot/message/quota/consumption" —
 * so the consumption route must be registered FIRST.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LineClient } from "../../src/line/client.js";
import { checkQuota, snapshotQuota } from "../../src/line/quota-guardian.js";
import { TH } from "../../src/i18n/th.js";
import { installFetchMock, type FetchMock } from "../helpers/fetch-mock.js";

let api: FetchMock;
let client: LineClient;

beforeEach(() => {
  api = installFetchMock();
  client = new LineClient({ channelAccessToken: "quota-test-token" });
});

afterEach(() => {
  api.uninstall();
});

/** Register quota + consumption responses (consumption FIRST — substring routing). */
function mockQuota(opts: { value?: number; used: number; type?: "limited" | "none" }): void {
  const type = opts.type ?? "limited";
  api.on("/v2/bot/message/quota/consumption", { body: { totalUsage: opts.used } });
  api.on(
    "/v2/bot/message/quota",
    { body: type === "limited" ? { type, value: opts.value } : { type } },
    { method: "GET" },
  );
}

describe("checkQuota — hard block (over_quota)", () => {
  it("blocks when projected > remaining, with the exact Thai message", async () => {
    mockQuota({ value: 1000, used: 900 }); // remaining 100
    const res = await checkQuota({ client, projectedMessages: 150, confirm: false });

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.reason).toBe("over_quota");
    expect(res.message).toBe(TH.quotaExceeded(150, 100));
    expect(res.snapshot).toEqual({ used: 900, total: 1000, remaining: 100, percentage_used: 90 });
  });

  it("blocks even with confirm=true — confirm cannot override a hard block", async () => {
    mockQuota({ value: 1000, used: 900 });
    const res = await checkQuota({ client, projectedMessages: 101, confirm: true });

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.reason).toBe("over_quota");
    expect(res.message).toBe(TH.quotaExceeded(101, 100));
  });

  it("blocks any positive projection when remaining is 0", async () => {
    mockQuota({ value: 1000, used: 1000 });
    const res = await checkQuota({ client, projectedMessages: 1, confirm: false });

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.reason).toBe("over_quota");
    expect(res.message).toBe(TH.quotaExceeded(1, 0));
  });
});

describe("checkQuota — soft block (needs_confirmation)", () => {
  it("requires confirmation when projected > 95% of remaining", async () => {
    mockQuota({ value: 1000, used: 900 }); // remaining 100
    const res = await checkQuota({ client, projectedMessages: 96, confirm: false });

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.reason).toBe("needs_confirmation");
    expect(res.message).toBe(TH.quotaWarning(96, 100, 96));
  });

  it("projected === remaining (100% of remaining) also needs confirmation, not over_quota", async () => {
    mockQuota({ value: 1000, used: 900 });
    const res = await checkQuota({ client, projectedMessages: 100, confirm: false });

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.reason).toBe("needs_confirmation");
    expect(res.message).toBe(TH.quotaWarning(100, 100, 100));
  });

  it("confirm=true converts the soft block into ok (with the >50% advisory warning)", async () => {
    mockQuota({ value: 1000, used: 900 });
    const res = await checkQuota({ client, projectedMessages: 96, confirm: true });

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.warnings).toHaveLength(1);
    expect(res.warnings[0]).toContain("96%");
    expect(res.warnings[0]).toContain("quota ที่เหลือ");
  });

  it("projected at exactly the 95% threshold does NOT soft-block (strict >)", async () => {
    mockQuota({ value: 1000, used: 0 }); // remaining 1000; 950/1000 = exactly 0.95
    const res = await checkQuota({ client, projectedMessages: 950, confirm: false });

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    // still >50%, so the advisory warning fires
    expect(res.warnings).toHaveLength(1);
    expect(res.warnings[0]).toContain("95%");
  });

  it("remaining 0 + projected 0 currently resolves share=1 → needs_confirmation (pinned)", async () => {
    mockQuota({ value: 1000, used: 1000 });
    const res = await checkQuota({ client, projectedMessages: 0, confirm: false });

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.reason).toBe("needs_confirmation");
  });
});

describe("checkQuota — advisory warning band (>50%..95%)", () => {
  it("warns (but passes) when projected uses more than half the remaining quota", async () => {
    mockQuota({ value: 1000, used: 900 }); // remaining 100
    const res = await checkQuota({ client, projectedMessages: 60, confirm: false });

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.warnings).toHaveLength(1);
    expect(res.warnings[0]).toContain("60%");
    expect(res.warnings[0]).toContain("🟡");
  });

  it("exactly 50% produces no warning (strict >)", async () => {
    mockQuota({ value: 1000, used: 900 });
    const res = await checkQuota({ client, projectedMessages: 50, confirm: false });

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.warnings).toEqual([]);
  });

  it("negative projectedMessages is clamped to 0 and passes clean", async () => {
    mockQuota({ value: 1000, used: 900 });
    const res = await checkQuota({ client, projectedMessages: -5, confirm: false });

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.warnings).toEqual([]);
  });
});

describe("checkQuota — unlimited quota passthrough", () => {
  it('type "none" → ok with no warnings even for huge projections', async () => {
    mockQuota({ used: 123_456, type: "none" });
    const res = await checkQuota({ client, projectedMessages: 1_000_000_000, confirm: false });

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.warnings).toEqual([]);
    expect(res.snapshot).toEqual({
      used: 123_456,
      total: "unlimited",
      remaining: "unlimited",
      percentage_used: 0,
    });
  });

  it('type "limited" with value undefined is treated as unlimited', async () => {
    api.on("/v2/bot/message/quota/consumption", { body: { totalUsage: 7 } });
    api.on("/v2/bot/message/quota", { body: { type: "limited" } }, { method: "GET" });

    const res = await checkQuota({ client, projectedMessages: 999_999, confirm: false });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.snapshot.total).toBe("unlimited");
  });
});

describe("snapshotQuota — arithmetic", () => {
  const rows: {
    name: string;
    value: number;
    used: number;
    expected: { used: number; total: number; remaining: number; percentage_used: number };
  }[] = [
    {
      name: "simple thirds round to one decimal",
      value: 1000,
      used: 333,
      expected: { used: 333, total: 1000, remaining: 667, percentage_used: 33.3 },
    },
    {
      name: "rounding down (1234/9999 → 12.3)",
      value: 9999,
      used: 1234,
      expected: { used: 1234, total: 9999, remaining: 8765, percentage_used: 12.3 },
    },
    {
      name: "repeating decimal (1/3 → 33.3)",
      value: 3,
      used: 1,
      expected: { used: 1, total: 3, remaining: 2, percentage_used: 33.3 },
    },
    {
      name: "rounding up (2/3 → 66.7)",
      value: 3,
      used: 2,
      expected: { used: 2, total: 3, remaining: 1, percentage_used: 66.7 },
    },
    {
      name: "overage: used > total clamps remaining to 0, percentage passes 100",
      value: 1000,
      used: 1200,
      expected: { used: 1200, total: 1000, remaining: 0, percentage_used: 120 },
    },
    {
      name: "zero total guards the division",
      value: 0,
      used: 5,
      expected: { used: 5, total: 0, remaining: 0, percentage_used: 0 },
    },
  ];

  it.each(rows)("$name", async ({ value, used, expected }) => {
    mockQuota({ value, used });
    const snap = await snapshotQuota(client);
    expect(snap).toEqual(expected);
  });

  it("hits exactly the two quota endpoints with the Bearer token", async () => {
    mockQuota({ value: 100, used: 10 });
    await snapshotQuota(client);

    expect(api.callsTo("/v2/bot/message/quota")).toHaveLength(2); // quota + consumption
    expect(api.callsTo("/v2/bot/message/quota/consumption")).toHaveLength(1);
    expect(api.calls).toHaveLength(2);
    for (const call of api.calls) {
      expect(call.headers.authorization).toBe("Bearer quota-test-token");
      expect(call.method).toBe("GET");
    }
  });
});
