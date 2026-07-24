/**
 * Guardrail tests — Bangkok quiet hours (src/line/quiet-hours.ts).
 *
 * Boundary matrix on the explicit `now` seam (no wall-clock dependence):
 * 21:59 BKK not quiet, 22:00 quiet, 07:59 quiet, 08:00 not quiet; `force`
 * suppresses; the warning is TH.quietHoursWarning with the BKK hour baked in.
 * BKK = UTC+7, so 22:00 BKK = 15:00 UTC.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { bkkHour, isQuietHoursBkk, quietHoursCheck } from "../../src/line/quiet-hours.js";
import { TH } from "../../src/i18n/th.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("quiet hours boundary matrix (BKK = UTC+7)", () => {
  const rows: { utc: string; bkkLabel: string; hour: number; quiet: boolean }[] = [
    { utc: "2026-07-24T14:59:59Z", bkkLabel: "21:59:59", hour: 21, quiet: false },
    { utc: "2026-07-24T15:00:00Z", bkkLabel: "22:00:00", hour: 22, quiet: true },
    { utc: "2026-07-24T16:00:00Z", bkkLabel: "23:00:00", hour: 23, quiet: true },
    { utc: "2026-07-23T17:00:00Z", bkkLabel: "00:00:00", hour: 0, quiet: true },
    { utc: "2026-07-24T00:59:59Z", bkkLabel: "07:59:59", hour: 7, quiet: true },
    { utc: "2026-07-24T01:00:00Z", bkkLabel: "08:00:00", hour: 8, quiet: false },
    { utc: "2026-07-24T05:00:00Z", bkkLabel: "12:00:00", hour: 12, quiet: false },
    { utc: "2026-07-24T14:00:00Z", bkkLabel: "21:00:00", hour: 21, quiet: false },
  ];

  it.each(rows)("$bkkLabel BKK → quiet=$quiet (hour $hour)", ({ utc, hour, quiet }) => {
    const now = new Date(utc);
    expect(bkkHour(now)).toBe(hour);
    expect(isQuietHoursBkk(now)).toBe(quiet);

    const check = quietHoursCheck(false, now);
    expect(check.is_quiet).toBe(quiet);
    if (quiet) {
      expect(check.warning).toBe(TH.quietHoursWarning(hour));
      expect(check.warning).toContain(`${hour}:00 BKK`);
    } else {
      expect(check.warning).toBeUndefined();
    }
  });
});

describe("force override", () => {
  it("force=true suppresses the warning inside quiet hours (23:00 BKK)", () => {
    const now = new Date("2026-07-24T16:00:00Z"); // 23:00 BKK
    const check = quietHoursCheck(true, now);
    expect(check).toEqual({ is_quiet: false });
    expect(check.warning).toBeUndefined();
  });

  it("force=true at the 22:00 boundary also suppresses", () => {
    const check = quietHoursCheck(true, new Date("2026-07-24T15:00:00Z"));
    expect(check.is_quiet).toBe(false);
  });

  it("force=true outside quiet hours is a no-op passthrough", () => {
    const check = quietHoursCheck(true, new Date("2026-07-24T05:00:00Z")); // noon BKK
    expect(check).toEqual({ is_quiet: false });
  });
});

describe("default `now` seam (fake Date only — timers stay real)", () => {
  it("uses the current system time when `now` is omitted", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-24T16:00:00Z")); // 23:00 BKK

    expect(isQuietHoursBkk()).toBe(true);
    expect(bkkHour()).toBe(23);
    const check = quietHoursCheck(false);
    expect(check.is_quiet).toBe(true);
    expect(check.warning).toBe(TH.quietHoursWarning(23));
  });

  it("daytime system time reports not quiet", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-24T03:30:00Z")); // 10:30 BKK

    expect(isQuietHoursBkk()).toBe(false);
    expect(quietHoursCheck(false)).toEqual({ is_quiet: false });
  });
});
