/**
 * Config/environment isolation helpers.
 *
 * `src/config/multi-oa.ts` caches config in module state; these helpers reset
 * it and set up the three real-world config scenarios (env single-OA, explicit
 * config file, default ~/.line-mcp/config.json) without touching the real HOME.
 */

import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resetConfigCache } from "../../src/config/multi-oa.js";

const CONFIG_ENV_VARS = [
  "LINE_CHANNEL_ACCESS_TOKEN",
  "LINE_CHANNEL_SECRET",
  "LINE_MYSHOP_API_KEY",
  "LINE_MCP_CONFIG",
  "LINE_MCP_DEFAULT_OA",
] as const;

/** Snapshot + clear all config-related env vars. Returns a restore function. */
export function isolateConfigEnv(): () => void {
  const saved: Record<string, string | undefined> = {};
  for (const k of CONFIG_ENV_VARS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  const savedHome = process.env.HOME;
  resetConfigCache();
  return () => {
    for (const k of CONFIG_ENV_VARS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
    resetConfigCache();
  };
}

/** Single-OA mode via env var. */
export function useSingleOaEnv(token = "test-channel-token"): void {
  process.env.LINE_CHANNEL_ACCESS_TOKEN = token;
  resetConfigCache();
}

/** Multi-OA mode via an explicit LINE_MCP_CONFIG file. Returns the file path. */
export function useConfigFile(config: object): string {
  const dir = mkdtempSync(join(tmpdir(), "line-mcp-test-"));
  const path = join(dir, "config.json");
  writeFileSync(path, JSON.stringify(config), { mode: 0o600 });
  process.env.LINE_MCP_CONFIG = path;
  resetConfigCache();
  return path;
}

/**
 * Multi-OA mode via the DEFAULT path (~/.line-mcp/config.json) — points HOME
 * at a temp dir so the real user config is never read.
 */
export function useDefaultHomeConfig(config: object): string {
  const home = mkdtempSync(join(tmpdir(), "line-mcp-home-"));
  process.env.HOME = home;
  const dir = join(home, ".line-mcp");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "config.json");
  writeFileSync(path, JSON.stringify(config), { mode: 0o600 });
  resetConfigCache();
  return path;
}

/** A minimal two-OA config for multi-OA tests. */
export function twoOaConfig(overrides: Record<string, unknown> = {}): object {
  return {
    default_oa: "main",
    oas: {
      main: { channel_access_token: "token-main", display_name: "Main OA" },
      shop2: { channel_access_token: "token-shop2", display_name: "Shop 2" },
    },
    ...overrides,
  };
}
