/**
 * Multi-OA configuration loader.
 *
 * Loading priority (first match wins):
 *   1. `LINE_MCP_CONFIG` env var pointing to a JSON file
 *   2. `~/.line-mcp/config.json` if it exists
 *   3. `LINE_CHANNEL_ACCESS_TOKEN` env var (single-OA mode)
 *   4. Error
 *
 * The active OA in a session can be switched at runtime via `line_use_oa`.
 * That switch is in-memory only — it does not modify the config file.
 */

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { TH } from "../i18n/th.js";
import type { MultiOaConfig, OaConfig } from "../types.js";

let _activeConfig: MultiOaConfig | null = null;
let _activeOaId: string | null = null;

/**
 * Load (or reload) the multi-OA configuration into module-level state.
 * Throws if no valid source is found.
 */
export function loadConfig(): MultiOaConfig {
  // 1 — explicit config file
  const explicitPath = process.env.LINE_MCP_CONFIG;
  if (explicitPath) {
    return _setConfig(readJson(explicitPath));
  }

  // 2 — default config file
  const defaultPath = join(homedir(), ".line-mcp", "config.json");
  if (existsSync(defaultPath)) {
    return _setConfig(readJson(defaultPath));
  }

  // 3 — single-OA env var fallback
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (token) {
    const oa: OaConfig = {
      channel_access_token: token,
      channel_secret: process.env.LINE_CHANNEL_SECRET,
      display_name: "Default OA (from env)",
      region: "TH",
    };
    return _setConfig({
      default_oa: "default",
      oas: { default: oa },
    });
  }

  // 4 — no config
  throw new Error(TH.missingToken);
}

/** Switch the active OA for the rest of the session. */
export function useOa(oaId: string): OaConfig {
  const cfg = getConfig();
  const oa = cfg.oas[oaId];
  if (!oa) {
    throw new Error(TH.oaNotFound(oaId));
  }
  _activeOaId = oaId;
  return oa;
}

/** Resolve the OA config to use for a tool call (explicit > active > default). */
export function resolveOa(oaIdArg?: string): { id: string; config: OaConfig } {
  const cfg = getConfig();
  const id =
    oaIdArg ??
    _activeOaId ??
    process.env.LINE_MCP_DEFAULT_OA ??
    cfg.default_oa;

  const config = cfg.oas[id];
  if (!config) {
    throw new Error(TH.oaNotFound(id));
  }
  return { id, config };
}

/** List all OAs in config (for line_list_oas). */
export function listOas(): { id: string; config: OaConfig; is_active: boolean }[] {
  const cfg = getConfig();
  const active = _activeOaId ?? cfg.default_oa;
  return Object.entries(cfg.oas).map(([id, config]) => ({
    id,
    config,
    is_active: id === active,
  }));
}

/** Return the cached config (loads if not loaded yet). */
export function getConfig(): MultiOaConfig {
  if (!_activeConfig) {
    return loadConfig();
  }
  return _activeConfig;
}

// ---- internals ----

function _setConfig(cfg: MultiOaConfig): MultiOaConfig {
  // Basic validation
  if (!cfg.oas || typeof cfg.oas !== "object") {
    throw new Error("Invalid config: missing 'oas' object");
  }
  if (!cfg.default_oa || !cfg.oas[cfg.default_oa]) {
    throw new Error(
      `Invalid config: default_oa '${cfg.default_oa}' not present in oas`,
    );
  }
  for (const [id, oa] of Object.entries(cfg.oas)) {
    if (!oa.channel_access_token) {
      throw new Error(`Invalid config: OA '${id}' is missing channel_access_token`);
    }
  }
  _activeConfig = cfg;
  return cfg;
}

function readJson(path: string): MultiOaConfig {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as MultiOaConfig;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read config at ${path}: ${msg}`);
  }
}
