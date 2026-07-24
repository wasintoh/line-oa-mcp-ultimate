/**
 * Config file permission checks — ~/.line-mcp/config.json holds LIVE channel
 * tokens, so a group/other-readable file gets a one-time Thai warning with a
 * chmod 600 suggestion. A 0600 file loads silently.
 */

import { chmodSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadConfig, resetConfigCache } from "../../src/config/multi-oa.js";
import { isolateConfigEnv, twoOaConfig, useConfigFile, useDefaultHomeConfig } from "../helpers/env.js";

describe("config file permissions", () => {
  let restoreEnv: () => void;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    restoreEnv = isolateConfigEnv();
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    restoreEnv();
  });

  function loggedText(): string {
    return errorSpy.mock.calls.flat().map(String).join("\n");
  }

  it("warns (Thai, chmod 600 suggestion) when an explicit config file is 0644", () => {
    const path = useConfigFile(twoOaConfig());
    chmodSync(path, 0o644);
    resetConfigCache(); // useConfigFile already reset; be explicit after chmod

    loadConfig();

    const logged = loggedText();
    expect(logged).toContain(`chmod 600 ${path}`);
    expect(logged).toContain("token"); // explains WHY it matters
  });

  it("warns for the default ~/.line-mcp/config.json path too", () => {
    const path = useDefaultHomeConfig(twoOaConfig());
    chmodSync(path, 0o604); // other-readable
    resetConfigCache();

    loadConfig();

    expect(loggedText()).toContain(`chmod 600 ${path}`);
  });

  it("stays silent for a 0600 config file", () => {
    useConfigFile(twoOaConfig()); // helper writes with mode 0600

    loadConfig();

    expect(loggedText()).not.toContain("chmod 600");
  });

  it("warns only once per process (until the test-only cache reset)", () => {
    const path = useConfigFile(twoOaConfig());
    chmodSync(path, 0o644);
    resetConfigCache();

    loadConfig();
    loadConfig();
    loadConfig();

    const occurrences = loggedText().split("chmod 600").length - 1;
    expect(occurrences).toBe(1);
  });

  it("group-readable (0640) also triggers the warning", () => {
    const path = useConfigFile(twoOaConfig());
    chmodSync(path, 0o640);
    resetConfigCache();

    loadConfig();

    expect(loggedText()).toContain(`chmod 600 ${path}`);
  });
});
