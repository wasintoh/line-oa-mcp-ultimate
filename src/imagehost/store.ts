/**
 * In-memory image store for the Image Hosting Layer (v2.2).
 *
 * Holds the resized PNG variants of prepared images under unguessable keys so
 * hosting providers serve bytes from RAM only — never the filesystem (tunnel
 * URLs are public; a filesystem-backed server would risk path traversal into
 * the user's machine).
 *
 * Non-obvious constraint enforced here: the global byte budget
 * (IMAGEHOST_STORE_MAX_BYTES) is enforced at put() time — expired entries are
 * swept first, then the OLDEST live entries are evicted until the new item
 * fits; an item that alone exceeds the budget is rejected with reason
 * "store-full" WITHOUT evicting anything. Expiry is lazy (get()/sweep());
 * there is deliberately NO setInterval here — callers drive sweeps so this
 * module never keeps an event-loop handle alive under stdio transport.
 */

import { createHash, randomBytes } from "node:crypto";

import { IMAGEHOST_STORE_MAX_BYTES } from "../constants.js";
import { ImageHostError, type HostResult, type ImageVariants } from "./types.js";

/** One stored prepared image: all width variants plus lifecycle metadata. */
export interface StoredImage {
  key: string;
  variants: ImageVariants;
  /** Epoch ms when the entry was inserted (eviction picks the smallest). */
  createdAt: number;
  /** Epoch ms after which the entry is dead. `now >= expiresAt` → expired. */
  expiresAt: number;
  /** Sum of all variant buffer lengths (what counts against the budget). */
  totalBytes: number;
  /** Set by setHosting() once a provider has published this key. */
  hosting?: HostResult;
}

export class ImageStore {
  /** Insertion-ordered; ties on createdAt resolve to insertion order. */
  private readonly entries = new Map<string, StoredImage>();

  /**
   * Insert variants under a fresh key and return the stored entry.
   *
   * Key shape: sha256(all variant buffers concatenated) hex, first 12 chars,
   * then "-", then 12 random bytes as base64url — content-addressed prefix for
   * debuggability, random suffix so the URL stays unguessable even when the
   * image content is publicly known. Matches ^[A-Za-z0-9_-]+$.
   */
  put(variants: ImageVariants, keepAliveMs: number): StoredImage {
    let newBytes = 0;
    for (const buf of variants.sizes.values()) newBytes += buf.length;

    this.sweep();

    // An item that alone exceeds the budget can never fit — reject before
    // evicting anything (evicting first would destroy data for nothing).
    if (newBytes > IMAGEHOST_STORE_MAX_BYTES) {
      throw new ImageHostError(
        `Image variants total ${newBytes} bytes, exceeding the store budget of ${IMAGEHOST_STORE_MAX_BYTES} bytes`,
        "store-full",
      );
    }

    while (this.currentTotalBytes() + newBytes > IMAGEHOST_STORE_MAX_BYTES) {
      this.evictOldest();
    }

    const now = Date.now();
    const entry: StoredImage = {
      key: this.makeKey(variants),
      variants,
      createdAt: now,
      expiresAt: now + keepAliveMs,
      totalBytes: newBytes,
    };
    this.entries.set(entry.key, entry);
    return entry;
  }

  /** Fetch an entry. Expired entries are deleted and reported as undefined. */
  get(key: string): StoredImage | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (Date.now() >= entry.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }

  /** Fetch one width variant's bytes. undefined if key or size is unknown/expired. */
  getVariant(key: string, size: number): Buffer | undefined {
    return this.get(key)?.variants.sizes.get(size);
  }

  /**
   * Record the hosting result for a stored key. Throws "key-not-found" if the
   * key is unknown or already expired — publishing a dead key is a caller bug.
   */
  setHosting(key: string, hosting: HostResult): void {
    const entry = this.get(key);
    if (!entry) {
      throw new ImageHostError(`Cannot record hosting for unknown or expired key "${key}"`, "key-not-found");
    }
    entry.hosting = hosting;
  }

  /** Hosting result previously stored via setHosting(), if the key is alive. */
  getHosting(key: string): HostResult | undefined {
    return this.get(key)?.hosting;
  }

  /**
   * Push the expiry out to max(current, now + keepAliveMs) — never shortens.
   * Unknown/already-expired keys are a no-op (an expired entry is gone; this
   * may race URL hits, so it must not throw).
   */
  extendExpiry(key: string, keepAliveMs: number): void {
    const entry = this.get(key);
    if (!entry) return;
    entry.expiresAt = Math.max(entry.expiresAt, Date.now() + keepAliveMs);
  }

  /** Remove one entry. Returns true if it existed. */
  delete(key: string): boolean {
    return this.entries.delete(key);
  }

  /** Drop every expired entry. Returns how many were removed. Callers drive this — no timer in here. */
  sweep(): number {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (now >= entry.expiresAt) {
        this.entries.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /** Live entry count and byte total (sweeps first so numbers reflect reality). */
  stats(): { count: number; totalBytes: number } {
    this.sweep();
    return { count: this.entries.size, totalBytes: this.currentTotalBytes() };
  }

  /** TEST-ONLY seam: drop every stored entry. */
  clear(): void {
    this.entries.clear();
  }

  // ---- internals ----

  private currentTotalBytes(): number {
    let total = 0;
    for (const entry of this.entries.values()) total += entry.totalBytes;
    return total;
  }

  /** Evict the entry with the smallest createdAt (insertion order breaks ties). */
  private evictOldest(): void {
    let oldest: StoredImage | undefined;
    for (const entry of this.entries.values()) {
      if (!oldest || entry.createdAt < oldest.createdAt) oldest = entry;
    }
    // Callers guarantee non-emptiness (put() rejects oversize before looping),
    // but stay defensive against future misuse.
    if (oldest) this.entries.delete(oldest.key);
  }

  private makeKey(variants: ImageVariants): string {
    const hash = createHash("sha256");
    // Streaming updates hash the exact concatenation of all variant buffers.
    for (const buf of variants.sizes.values()) hash.update(buf);
    const contentPrefix = hash.digest("hex").slice(0, 12);
    const randomSuffix = randomBytes(12).toString("base64url");
    return `${contentPrefix}-${randomSuffix}`;
  }
}

/** Process-wide singleton — providers and the HTTP server share this instance. */
export const imageStore = new ImageStore();
