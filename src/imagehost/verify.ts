/**
 * Post-host URL verification for the Image Hosting Layer (v2.2).
 *
 * Probes every hosted variant URL concurrently so callers know the URLs are
 * actually reachable BEFORE handing them to LINE (LINE is pull-model — a dead
 * URL means a silently broken Rich Message on the user's phone).
 *
 * Non-obvious constraint enforced here: a HEAD that comes back 405 or 501 is
 * retried as `GET Range: bytes=0-0` — some static hosts refuse HEAD entirely,
 * and treating that as failure would wrongly discard a working provider. Both
 * attempts share one AbortController, so the per-URL timeout bounds the total
 * probe time, not each attempt separately.
 */

import { IMAGEHOST_VERIFY_TIMEOUT_MS } from "../constants.js";

/** Outcome of probing one batch of hosted URLs. */
export interface VerifyReport {
  /** true only when EVERY entry answered 200 or 206. */
  ok: boolean;
  /** size (as string) → HTTP status, or "timeout"/"error" when no response arrived. */
  statuses: Record<string, number | "timeout" | "error">;
  /** Sizes that did not succeed, sorted for deterministic reporting. */
  failedSizes: string[];
}

/**
 * Probe every URL in `urls` concurrently and report per-size outcomes.
 * Never throws — network failure is data here, not an exception.
 */
export async function verifyUrls(
  urls: Record<string, string>,
  opts?: { timeoutMs?: number },
): Promise<VerifyReport> {
  const timeoutMs = opts?.timeoutMs ?? IMAGEHOST_VERIFY_TIMEOUT_MS;
  const statuses: Record<string, number | "timeout" | "error"> = {};

  await Promise.all(
    Object.entries(urls).map(async ([size, url]) => {
      statuses[size] = await probeUrl(url, timeoutMs);
    }),
  );

  const failedSizes = Object.entries(statuses)
    .filter(([, status]) => status !== 200 && status !== 206)
    .map(([size]) => size)
    .sort();

  return { ok: failedSizes.length === 0, statuses, failedSizes };
}

/**
 * Probe one URL: HEAD first; on 405/501 (host refuses HEAD) retry as a
 * 1-byte ranged GET. Returns the final HTTP status, or "timeout" when the
 * shared AbortController fired, or "error" for any other network failure.
 */
async function probeUrl(url: string, timeoutMs: number): Promise<number | "timeout" | "error"> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response = await fetch(url, { method: "HEAD", signal: controller.signal });
    if (response.status === 405 || response.status === 501) {
      response = await fetch(url, {
        method: "GET",
        headers: { Range: "bytes=0-0" },
        signal: controller.signal,
      });
    }
    return response.status;
  } catch (err) {
    return isAbortError(err) ? "timeout" : "error";
  } finally {
    clearTimeout(timer);
  }
}

/** fetch abort surfaces as a DOMException named "AbortError" (duck-typed — no DOM lib needed). */
function isAbortError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { name?: unknown }).name === "AbortError";
}
