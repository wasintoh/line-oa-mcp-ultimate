/**
 * Image Hosting Layer — shared contracts (v2.2).
 *
 * WHY THIS EXISTS: LINE's Messaging API is pull-model — image/imagemap messages
 * carry only HTTPS URLs and LINE fetches the bytes when each recipient FIRST
 * VIEWS the message (live-verified 2026-07-31; after that first view LINE's
 * cache serves it permanently). There is NO upload API for message images
 * (rich menu upload exists but returns no URL). So to let non-technical users
 * send Rich Messages, we host the bytes until the audience has viewed them,
 * via a provider chain:
 *
 *   self (HTTP transport + MCP_PUBLIC_URL) → local-tunnel (cloudflared) → handoff (zip + manual)
 *
 * Design rules (do not violate):
 *   - Providers NEVER read the filesystem to serve bytes — everything is served
 *     from the in-memory ImageStore (tunnel URLs are public; path traversal on
 *     a filesystem-backed server would expose the user's machine).
 *   - Every provider failure must fall through to the next; `handoff` never fails.
 *   - All user-facing strings live in i18n/th.ts at the TOOL layer; modules in
 *     this folder throw typed Errors with English messages.
 */

// ---- identifiers ----

export type ImageHostId = "self" | "local-tunnel" | "handoff";

/**
 * What the hosted image will be used for.
 * - "imagemap": LINE Rich Message — needs ALL five width variants served under
 *   `${baseUrl}/{1040|700|460|300|240}` (no file extension).
 * - "image_message": plain image message — needs original + preview URLs only.
 */
export type PreparePurpose = "imagemap" | "image_message";

// ---- image data ----

/** Width-variant PNGs produced by resize.ts. Keys are pixel widths. */
export interface ImageVariants {
  /** width (px) → PNG bytes. Always contains every IMAGEMAP_SIZES entry. */
  sizes: Map<number, Buffer>;
  /** Always 1040 (the LINE imagemap contract). */
  baseWidth: number;
  /** Image height in px when the width is 1040 — used as imagemap base_height. */
  baseHeight: number;
  /** Detected source format (we re-encode everything to PNG). */
  sourceFormat: "png" | "jpeg";
  /** Non-fatal notes collected while decoding/resizing (English, tool layer translates). */
  warnings: string[];
}

// ---- hosting results ----

/** Manual-fallback package returned when no automatic provider is usable. */
export interface HandoffPackage {
  /** Absolute path of the written zip (5 size-named files, no extensions). */
  zipPath: string;
  /** Entry names inside the zip, e.g. ["1040","700","460","300","240"]. */
  fileNames: string[];
  /** Thai step-by-step instructions (≥3 alternatives, copy-paste ready). */
  stepsTh: string[];
}

export interface HostResult {
  kind: "hosted" | "handoff";
  providerId: ImageHostId;
  /** Imagemap base URL — LINE appends /1040 /700 /460 /300 /240 itself. */
  baseUrl?: string;
  /** Full-size image URL (image_message purpose). */
  imageUrl?: string;
  /** Preview/thumbnail URL (image_message purpose — the 240px variant). */
  previewImageUrl?: string;
  /** size (as string) → full URL, for verification and reporting. */
  urls?: Record<string, string>;
  /** ISO timestamp after which URLs may die. null/undefined = no known expiry. */
  expiresAt?: string | null;
  handoff?: HandoffPackage;
  /** Non-fatal notes (English) — e.g. which providers were skipped and why. */
  warnings: string[];
}

export interface PutOptions {
  /** How long the hosting must stay alive after put(). Best-effort for tunnels. */
  keepAliveSeconds?: number;
}

// ---- provider contract ----

export interface ImageHost {
  readonly id: ImageHostId;
  /** false → resolve.ts must never pick this provider for purpose "imagemap". */
  readonly supportsImagemap: boolean;
  /** Cheap availability probe. May be optimistic — put() may still throw. */
  isAvailable(): Promise<boolean>;
  /**
   * Publish the variants stored under `key` (already in the ImageStore) and
   * return reachable URLs. Throws ImageHostError on failure (resolve.ts falls
   * through to the next provider).
   */
  put(variants: ImageVariants, key: string, opts?: PutOptions): Promise<HostResult>;
  /** Tear down any long-lived resources (tunnel process, HTTP server). */
  dispose?(): Promise<void>;
}

// ---- errors ----

/** Base class for provider/module failures. `reason` is a stable machine code. */
export class ImageHostError extends Error {
  constructor(
    message: string,
    public readonly reason:
      | "unsupported-image"
      | "input-too-large"
      | "input-invalid"
      | "store-full"
      | "key-not-found"
      | "provider-unavailable"
      | "tunnel-start-failed"
      | "download-failed"
      | "checksum-mismatch"
      | "verify-failed",
  ) {
    super(message);
    this.name = "ImageHostError";
  }
}
