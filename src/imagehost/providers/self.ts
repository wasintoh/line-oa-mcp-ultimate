/**
 * self provider — for deployments that already ARE a public server.
 *
 * When the MCP runs in HTTP-transport mode behind a reverse proxy / tunnel /
 * PaaS, the machine already has a public HTTPS address — but the process
 * cannot discover it (it only knows its loopback bind). The operator tells us
 * via the MCP_PUBLIC_URL env var; http.ts calls registerSelfHost() at startup
 * and serves GET/HEAD /i/:key/:size from the in-memory store on the SAME
 * listener as /mcp (the image route is auth-exempt by design — LINE's CDN
 * fetches without credentials; keys are unguessable random tokens (96-bit entropy + content hash)).
 *
 * This provider is what makes n8n / VPS / agency deployments work with zero
 * extra moving parts: no tunnel needed, the server hosts its own images.
 */

import { IMAGEHOST_DEFAULT_KEEPALIVE_S, IMAGEMAP_SIZES } from "../../constants.js";
import { ImageHostError, type HostResult, type ImageHost, type ImageVariants, type PutOptions } from "../types.js";

let publicBaseUrl: string | null = null;

/**
 * Called by http.ts at startup when MCP_PUBLIC_URL is set. Accepts https URLs
 * (and plain-http loopback for local testing only — LINE itself requires https).
 * Throws on anything else so a misconfiguration is caught at boot, not at send.
 */
export function registerSelfHost(rawUrl: string): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ImageHostError(`MCP_PUBLIC_URL is not a valid URL: ${rawUrl}`, "input-invalid");
  }
  const isLoopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
  if (url.protocol !== "https:" && !isLoopback) {
    throw new ImageHostError(
      `MCP_PUBLIC_URL must be https:// (LINE only fetches images over HTTPS): ${rawUrl}`,
      "input-invalid",
    );
  }
  publicBaseUrl = rawUrl.replace(/\/+$/, "");
}

export function selfHostRegistered(): boolean {
  return publicBaseUrl !== null;
}

export function selfHostPublicUrl(): string | null {
  return publicBaseUrl;
}

/** TEST-ONLY seam. */
export function __resetSelfHostForTests(): void {
  publicBaseUrl = null;
}

export class SelfHost implements ImageHost {
  readonly id = "self" as const;
  readonly supportsImagemap = true;

  async isAvailable(): Promise<boolean> {
    return publicBaseUrl !== null;
  }

  async put(_variants: ImageVariants, key: string, opts?: PutOptions): Promise<HostResult> {
    if (!publicBaseUrl) {
      throw new ImageHostError("self host not registered (MCP_PUBLIC_URL not set / not in HTTP mode)", "provider-unavailable");
    }
    const keepAliveS = opts?.keepAliveSeconds ?? IMAGEHOST_DEFAULT_KEEPALIVE_S;
    const baseUrl = `${publicBaseUrl}/i/${key}`;
    const urls: Record<string, string> = {};
    for (const size of IMAGEMAP_SIZES) urls[String(size)] = `${baseUrl}/${size}`;
    return {
      kind: "hosted",
      providerId: this.id,
      baseUrl,
      imageUrl: urls["1040"],
      previewImageUrl: urls["240"],
      urls,
      expiresAt: new Date(Date.now() + keepAliveS * 1000).toISOString(),
      warnings: [
        "images are served from this server's memory — they survive as long as the process runs and the store entry has not expired",
      ],
    };
  }
}

export const selfHost = new SelfHost();
