/**
 * Unit tests for the in-memory ImageStore (v2.2 Image Hosting Layer).
 *
 * Pure logic — no network, no filesystem, no resize.ts import. Fake
 * ImageVariants are built inline from plain Buffers, and time is faked
 * (the store reads Date.now() directly).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { IMAGEHOST_STORE_MAX_BYTES } from "../src/constants.js";
import { ImageStore, imageStore, type StoredImage } from "../src/imagehost/store.js";
import { ImageHostError, type HostResult, type ImageVariants } from "../src/imagehost/types.js";

/** Build a fake variants object with two small buffers (content driven by `fill`). */
function makeVariants(fill: number, bytesPerVariant = 64): ImageVariants {
  return {
    sizes: new Map<number, Buffer>([
      [1040, Buffer.alloc(bytesPerVariant, fill)],
      [240, Buffer.alloc(bytesPerVariant, (fill + 1) % 256)],
    ]),
    baseWidth: 1040,
    baseHeight: 520,
    sourceFormat: "png",
    warnings: [],
  };
}

/** Build a fake variants object with a single buffer of an exact byte size. */
function makeSizedVariants(fill: number, bytes: number): ImageVariants {
  return {
    sizes: new Map<number, Buffer>([[1040, Buffer.alloc(bytes, fill)]]),
    baseWidth: 1040,
    baseHeight: 520,
    sourceFormat: "png",
    warnings: [],
  };
}

function fakeHosting(): HostResult {
  return {
    kind: "hosted",
    providerId: "self",
    baseUrl: "https://host.example.com/i/abc",
    urls: { "1040": "https://host.example.com/i/abc/1040" },
    expiresAt: null,
    warnings: [],
  };
}

let store: ImageStore;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
  store = new ImageStore();
});

afterEach(() => {
  imageStore.clear();
  vi.useRealTimers();
});

describe("ImageStore — put/get roundtrip", () => {
  it("returns a StoredImage whose fields reflect the input", () => {
    const entry = store.put(makeVariants(1), 60_000);
    expect(entry.totalBytes).toBe(128); // 2 variants x 64 bytes
    expect(entry.createdAt).toBe(Date.now());
    expect(entry.expiresAt).toBe(Date.now() + 60_000);
    expect(entry.hosting).toBeUndefined();
  });

  it("get() returns the same live entry", () => {
    const entry = store.put(makeVariants(2), 60_000);
    expect(store.get(entry.key)).toBe(entry);
  });

  it("get() returns undefined for an unknown key", () => {
    expect(store.get("no-such-key")).toBeUndefined();
  });

  it("getVariant() returns the exact bytes for a stored size", () => {
    const entry = store.put(makeVariants(3), 60_000);
    const buf = store.getVariant(entry.key, 1040);
    expect(buf).toEqual(Buffer.alloc(64, 3));
  });

  it("getVariant() returns undefined for an unknown size or key", () => {
    const entry = store.put(makeVariants(4), 60_000);
    expect(store.getVariant(entry.key, 999)).toBeUndefined();
    expect(store.getVariant("missing", 1040)).toBeUndefined();
  });

  it("stats() counts entries and bytes", () => {
    store.put(makeVariants(5), 60_000);
    store.put(makeVariants(6), 60_000);
    expect(store.stats()).toEqual({ count: 2, totalBytes: 256 });
  });
});

describe("ImageStore — key format", () => {
  it("matches ^[A-Za-z0-9_-]+$", () => {
    const entry = store.put(makeVariants(7), 60_000);
    expect(entry.key).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("is 12 hex chars, a dash, then 16 base64url chars", () => {
    const entry = store.put(makeVariants(8), 60_000);
    expect(entry.key).toMatch(/^[0-9a-f]{12}-[A-Za-z0-9_-]{16}$/);
  });

  it("two puts of IDENTICAL content produce DIFFERENT keys", () => {
    const a = store.put(makeVariants(9), 60_000);
    const b = store.put(makeVariants(9), 60_000);
    expect(a.key).not.toBe(b.key);
    // Same content → same sha256 prefix; only the random suffix differs.
    expect(a.key.slice(0, 12)).toBe(b.key.slice(0, 12));
  });
});

describe("ImageStore — expiry (lazy)", () => {
  it("stays alive just before the TTL elapses", () => {
    const entry = store.put(makeVariants(1), 60_000);
    vi.advanceTimersByTime(59_999);
    expect(store.get(entry.key)).toBeDefined();
  });

  it("get() reports undefined after the TTL and stats shrink", () => {
    const entry = store.put(makeVariants(1), 60_000);
    vi.advanceTimersByTime(60_001);
    expect(store.get(entry.key)).toBeUndefined();
    expect(store.stats()).toEqual({ count: 0, totalBytes: 0 });
  });

  it("sweep() removes only the expired entries", () => {
    const short = store.put(makeVariants(1), 1_000);
    const long = store.put(makeVariants(2), 100_000);
    vi.advanceTimersByTime(5_000);
    expect(store.sweep()).toBe(1);
    expect(store.get(short.key)).toBeUndefined();
    expect(store.get(long.key)).toBeDefined();
  });
});

describe("ImageStore — extendExpiry", () => {
  it("keeps an entry alive past its original TTL", () => {
    const entry = store.put(makeVariants(1), 1_000);
    vi.advanceTimersByTime(500);
    store.extendExpiry(entry.key, 2_000); // new expiry = t0 + 2500
    vi.advanceTimersByTime(1_000); // t0 + 1500 — past the original expiry
    expect(store.get(entry.key)).toBeDefined();
    vi.advanceTimersByTime(1_000); // t0 + 2500 — extended expiry reached
    expect(store.get(entry.key)).toBeUndefined();
  });

  it("never shortens the expiry (max of current and now+keepAliveMs)", () => {
    const entry = store.put(makeVariants(1), 100_000);
    const original = entry.expiresAt;
    store.extendExpiry(entry.key, 1_000);
    expect(entry.expiresAt).toBe(original);
  });

  it("is a no-op for an unknown key", () => {
    expect(() => store.extendExpiry("missing", 1_000)).not.toThrow();
  });
});

describe("ImageStore — capacity and eviction", () => {
  const half = IMAGEHOST_STORE_MAX_BYTES / 2; // 64MB — exact integer

  it("evicts the OLDEST entries until the new item fits", () => {
    const a = store.put(makeSizedVariants(1, half), 60_000);
    vi.advanceTimersByTime(10);
    const b = store.put(makeSizedVariants(2, half), 60_000);
    // a + b fill the budget exactly — no eviction yet.
    expect(store.stats()).toEqual({ count: 2, totalBytes: IMAGEHOST_STORE_MAX_BYTES });

    vi.advanceTimersByTime(10);
    const c = store.put(makeSizedVariants(3, half), 60_000);
    // Over budget by half → only the oldest (a) is evicted.
    expect(store.get(a.key)).toBeUndefined();
    expect(store.get(b.key)).toBeDefined();
    expect(store.get(c.key)).toBeDefined();
    expect(store.stats()).toEqual({ count: 2, totalBytes: IMAGEHOST_STORE_MAX_BYTES });

    vi.advanceTimersByTime(10);
    const d = store.put(makeSizedVariants(4, IMAGEHOST_STORE_MAX_BYTES), 60_000);
    // A full-budget item forces multiple evictions (b then c).
    expect(store.get(b.key)).toBeUndefined();
    expect(store.get(c.key)).toBeUndefined();
    expect(store.get(d.key)).toBeDefined();
    expect(store.stats()).toEqual({ count: 1, totalBytes: IMAGEHOST_STORE_MAX_BYTES });
  });

  it("sweeps expired entries before evicting live ones", () => {
    const expired = store.put(makeSizedVariants(1, half), 1_000);
    vi.advanceTimersByTime(5_000);
    const live = store.put(makeSizedVariants(2, half), 60_000);
    vi.advanceTimersByTime(10);
    // Fits once the expired entry is swept — the live one must survive.
    const next = store.put(makeSizedVariants(3, half), 60_000);
    expect(store.get(expired.key)).toBeUndefined();
    expect(store.get(live.key)).toBeDefined();
    expect(store.get(next.key)).toBeDefined();
  });

  it('throws ImageHostError("store-full") when a single item exceeds the cap', () => {
    let err: unknown;
    try {
      store.put(makeSizedVariants(9, IMAGEHOST_STORE_MAX_BYTES + 1), 60_000);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ImageHostError);
    expect((err as ImageHostError).reason).toBe("store-full");
  });

  it("does not evict existing entries when rejecting an oversized item", () => {
    const kept = store.put(makeVariants(1), 60_000);
    expect(() => store.put(makeSizedVariants(9, IMAGEHOST_STORE_MAX_BYTES + 1), 60_000)).toThrow(ImageHostError);
    expect(store.get(kept.key)).toBeDefined();
  });
});

describe("ImageStore — hosting record", () => {
  it("setHosting/getHosting roundtrip and shows up on the entry", () => {
    const entry = store.put(makeVariants(1), 60_000);
    const hosting = fakeHosting();
    store.setHosting(entry.key, hosting);
    expect(store.getHosting(entry.key)).toBe(hosting);
    expect(store.get(entry.key)?.hosting).toBe(hosting);
  });

  it('setHosting on an unknown key throws "key-not-found"', () => {
    let err: unknown;
    try {
      store.setHosting("missing", fakeHosting());
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ImageHostError);
    expect((err as ImageHostError).reason).toBe("key-not-found");
  });

  it("getHosting returns undefined for a key with no hosting yet", () => {
    const entry = store.put(makeVariants(1), 60_000);
    expect(store.getHosting(entry.key)).toBeUndefined();
  });
});

describe("ImageStore — delete and clear", () => {
  it("delete() removes an entry and reports whether it existed", () => {
    const entry = store.put(makeVariants(1), 60_000);
    expect(store.delete(entry.key)).toBe(true);
    expect(store.get(entry.key)).toBeUndefined();
    expect(store.delete(entry.key)).toBe(false);
  });

  it("clear() empties the store (test-only seam)", () => {
    store.put(makeVariants(1), 60_000);
    store.put(makeVariants(2), 60_000);
    store.clear();
    expect(store.stats()).toEqual({ count: 0, totalBytes: 0 });
  });
});

describe("imageStore singleton", () => {
  it("is a shared ImageStore instance", () => {
    expect(imageStore).toBeInstanceOf(ImageStore);
    const entry: StoredImage = imageStore.put(makeVariants(1), 60_000);
    expect(imageStore.get(entry.key)).toBe(entry);
  });
});
