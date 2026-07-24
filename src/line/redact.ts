/**
 * Token-hygiene: secret redaction for anything that might reach a log line,
 * an MCP error reply, or a crash report.
 *
 * A LINE channel access token can message every follower the shop has, so a
 * token echoed back by an API error body (LINE 400s sometimes quote the
 * Authorization header) must NEVER surface verbatim. Config load registers
 * every channel_access_token / channel_secret / myshop_api_key here, and the
 * error constructors + console.error paths route their strings through
 * `redactSecrets()`.
 *
 * Handles secrets appearing:
 *   - raw                         ("abc123…")
 *   - inside a Bearer header      ("Bearer abc123…" — raw substring match)
 *   - inside a JSON string        ("{\"auth\":\"abc\\t123\"}" — JSON-escaped form)
 */

const REDACTED = "***REDACTED***";

/**
 * Secrets shorter than this are ignored — registering e.g. "a" would shred
 * every message. Real LINE tokens are 100+ chars; MyShop keys 30+.
 */
const MIN_SECRET_LENGTH = 4;

const _secrets = new Set<string>();

/** Register a secret for redaction. Empty / nullish / trivially short values are ignored. */
export function registerSecret(secret: string | undefined | null): void {
  if (!secret || secret.length < MIN_SECRET_LENGTH) return;
  _secrets.add(secret);
}

/** Replace every registered secret (raw or JSON-escaped) with `***REDACTED***`. */
export function redactSecrets(text: string): string {
  if (!text || _secrets.size === 0) return text;
  // Longest first so an overlapping shorter secret can't leave fragments of a
  // longer one behind (e.g. secrets "abc" and "abcdef" in the same text).
  const ordered = [..._secrets].sort((a, b) => b.length - a.length);
  let out = text;
  for (const secret of ordered) {
    out = out.split(secret).join(REDACTED);
    // JSON-escaped form (quotes/backslashes/control chars escaped) — catches
    // secrets embedded inside serialized JSON bodies.
    const jsonEscaped = JSON.stringify(secret).slice(1, -1);
    if (jsonEscaped !== secret) {
      out = out.split(jsonEscaped).join(REDACTED);
    }
  }
  return out;
}

/**
 * TEST-ONLY seam — forget all registered secrets. Called by
 * `resetConfigCache()` so config-isolated tests start with a clean registry.
 */
export function clearRegisteredSecrets(): void {
  _secrets.clear();
}
