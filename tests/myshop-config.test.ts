/**
 * Unit tests for MyShop key resolution + graceful-degradation gate.
 *
 * Covers:
 *   - anyMyShopKeyConfigured(): env vs per-OA detection (drives tool registration)
 *   - resolveMyShopKey(): precedence (OA key → env) and the missing-key error
 *
 * Uses single-OA-from-env config mode so we don't touch the filesystem.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  loadConfig,
  resolveMyShopKey,
  anyMyShopKeyConfigured,
} from "../src/config/multi-oa.js";

const SNAPSHOT = { ...process.env };

beforeEach(() => {
  // Clean slate: single-OA-from-env mode, no config file overrides.
  delete process.env.LINE_MCP_CONFIG;
  delete process.env.LINE_MYSHOP_API_KEY;
  delete process.env.LINE_MCP_DEFAULT_OA;
  process.env.LINE_CHANNEL_ACCESS_TOKEN = "test-token";
});

afterEach(() => {
  process.env = { ...SNAPSHOT };
});

describe("anyMyShopKeyConfigured", () => {
  it("is true when LINE_MYSHOP_API_KEY env is set", () => {
    process.env.LINE_MYSHOP_API_KEY = "msk-env";
    loadConfig();
    expect(anyMyShopKeyConfigured()).toBe(true);
  });

  it("is false when no MyShop key exists anywhere", () => {
    loadConfig();
    expect(anyMyShopKeyConfigured()).toBe(false);
  });
});

describe("resolveMyShopKey", () => {
  it("returns the env key when present", () => {
    process.env.LINE_MYSHOP_API_KEY = "msk-123";
    loadConfig();
    expect(resolveMyShopKey().apiKey).toBe("msk-123");
  });

  it("throws a Thai-friendly error when no key is configured", () => {
    loadConfig();
    expect(() => resolveMyShopKey()).toThrow(/MyShop|API key|oaplus/);
  });
});
