/**
 * Unit tests for the LINE Coupon create-body mapper.
 *
 * These verify that friendly inputs are mapped to the exact schema required by
 * POST /v2/bot/coupon — i.e. all 8 required fields, timestamps in UNIX seconds,
 * and the correct reward.priceInfo shape. No network calls.
 */

import { describe, it, expect } from "vitest";

import {
  buildCouponCreateBody,
  buildCouponPriceInfo,
  toUnixSeconds,
} from "../src/tools/manage-coupon.js";

const REQUIRED_FIELDS = [
  "title",
  "reward",
  "acquisitionCondition",
  "startTimestamp",
  "endTimestamp",
  "timezone",
  "visibility",
  "maxUseCountPerTicket",
] as const;

describe("toUnixSeconds", () => {
  it("converts a YYYY-MM-DD start date to BKK 00:00:00 in seconds", () => {
    expect(toUnixSeconds("2026-06-01", { timezone: "ASIA_BANGKOK" })).toBe(1780246800);
  });

  it("converts a YYYY-MM-DD end date to BKK 23:59:59 in seconds", () => {
    expect(toUnixSeconds("2026-06-08", { endOfDay: true, timezone: "ASIA_BANGKOK" })).toBe(
      1780937999,
    );
  });

  it("passes through second-scale numbers unchanged", () => {
    expect(toUnixSeconds(1780246800)).toBe(1780246800);
  });

  it("auto-divides millisecond-scale numbers", () => {
    expect(toUnixSeconds(1780246800000)).toBe(1780246800);
  });

  it("throws on garbage input", () => {
    expect(() => toUnixSeconds("not-a-date")).toThrow();
  });
});

describe("buildCouponPriceInfo", () => {
  it("builds a percentage reward", () => {
    expect(buildCouponPriceInfo({ discount_type: "percentage", discount_value: 20 })).toEqual({
      type: "percentage",
      percentage: 20,
    });
  });

  it("builds a fixed reward", () => {
    expect(buildCouponPriceInfo({ discount_type: "fixed", discount_value: 100 })).toEqual({
      type: "fixed",
      fixedAmount: 100,
    });
  });

  it("builds an explicit reward", () => {
    expect(
      buildCouponPriceInfo({ discount_type: "explicit", price_before: 1200, price_after: 900 }),
    ).toEqual({ type: "explicit", priceBeforeDiscount: 1200, priceAfterDiscount: 900 });
  });

  it("defaults to percentage and requires a value", () => {
    expect(() => buildCouponPriceInfo({})).toThrow(/discount_value/);
  });
});

describe("buildCouponCreateBody — Early Bird (พี่โต) percentage coupon", () => {
  const body = buildCouponCreateBody({
    title: "Early Bird คอร์สจารโต",
    discount_type: "percentage",
    discount_value: 20,
    valid_from: "2026-06-01",
    valid_to: "2026-06-08",
    coupon_code: "EARLYBIRD",
    description: "ลงทะเบียนช่วง Early Bird รับส่วนลด 20%",
  });

  it("includes every LINE-required field", () => {
    for (const f of REQUIRED_FIELDS) {
      expect(body, `missing required field: ${f}`).toHaveProperty(f);
    }
  });

  it("uses UNIX seconds (10-digit), not milliseconds", () => {
    expect(String(body.startTimestamp)).toMatch(/^\d{10}$/);
    expect(String(body.endTimestamp)).toMatch(/^\d{10}$/);
    expect(body.startTimestamp as number).toBe(1780246800);
    expect(body.endTimestamp as number).toBe(1780937999);
  });

  it("builds the correct reward + acquisition + defaults", () => {
    expect(body.reward).toEqual({ type: "discount", priceInfo: { type: "percentage", percentage: 20 } });
    expect(body.acquisitionCondition).toEqual({ type: "normal" });
    expect(body.timezone).toBe("ASIA_BANGKOK");
    expect(body.visibility).toBe("UNLISTED");
    expect(body.maxUseCountPerTicket).toBe(1);
    expect(body.couponCode).toBe("EARLYBIRD");
  });

  it("does NOT emit the old wrong field names", () => {
    expect(body).not.toHaveProperty("startTime");
    expect(body).not.toHaveProperty("endTime");
    expect(body).not.toHaveProperty("code");
    expect(body).not.toHaveProperty("maxRedemptions");
    expect(body).not.toHaveProperty("termsUrl");
  });
});

describe("buildCouponCreateBody — validation", () => {
  it("requires a title", () => {
    expect(() => buildCouponCreateBody({ valid_from: 1, valid_to: 2 })).toThrow(/title/);
  });

  it("requires validity dates", () => {
    expect(() => buildCouponCreateBody({ title: "x" })).toThrow(/valid_from/);
  });

  it("rejects an end before start", () => {
    expect(() =>
      buildCouponCreateBody({
        title: "x",
        discount_type: "percentage",
        discount_value: 10,
        valid_from: "2026-06-08",
        valid_to: "2026-06-01",
      }),
    ).toThrow(/valid_to/);
  });
});
