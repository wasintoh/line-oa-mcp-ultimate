/**
 * Provider chain resolution — picks the best available image host, silently
 * falling through on failure. The user never chooses and never dead-ends:
 *
 *   self (already a public server) → local-tunnel (default for stdio) → handoff (manual, never fails)
 *
 * Every skipped/failed provider leaves an English breadcrumb in the result's
 * warnings so the tool layer can explain WHAT the system already tried —
 * error messages must always say "what broke, what we did, what you do next".
 */

import type { HostResult, ImageHost, ImageVariants, PreparePurpose, PutOptions } from "./types.js";
import { selfHost } from "./providers/self.js";
import { localTunnelHost } from "./providers/local-tunnel.js";
import { HandoffHost } from "./providers/handoff.js";

const handoffHost = new HandoffHost();

/**
 * Direct handoff, bypassing the chain — used when a provider "succeeded" but
 * post-host verification proved its URLs unreachable (e.g. a tunnel whose
 * data plane is blocked by a corporate network). Never fails.
 */
export async function handoffFallback(variants: ImageVariants, key: string): Promise<HostResult> {
  return handoffHost.put(variants, key);
}

/** Ordered chain. v2.3 will insert permanent providers (r2/github/imgbb) before local-tunnel. */
function providerChain(): ImageHost[] {
  return [selfHost, localTunnelHost, handoffHost];
}

export async function hostImage(
  variants: ImageVariants,
  key: string,
  purpose: PreparePurpose,
  opts?: PutOptions,
): Promise<HostResult> {
  return hostImageWith(providerChain(), variants, key, purpose, opts);
}

/** Injectable core — exported so tests can drive the chain with fake hosts. */
export async function hostImageWith(
  chain: ImageHost[],
  variants: ImageVariants,
  key: string,
  purpose: PreparePurpose,
  opts?: PutOptions,
): Promise<HostResult> {
  const breadcrumbs: string[] = [];

  for (const host of chain) {
    if (purpose === "imagemap" && !host.supportsImagemap) {
      breadcrumbs.push(`${host.id}: skipped (cannot serve the 5-size imagemap layout)`);
      continue;
    }
    try {
      if (!(await host.isAvailable())) {
        breadcrumbs.push(`${host.id}: not available in this environment`);
        continue;
      }
      const result = await host.put(variants, key, opts);
      result.warnings = [...breadcrumbs, ...result.warnings];
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      breadcrumbs.push(`${host.id}: failed — ${message}`);
    }
  }

  // Unreachable in practice (handoff never fails), but never return undefined.
  throw new Error(`no image host succeeded: ${breadcrumbs.join(" | ")}`);
}
