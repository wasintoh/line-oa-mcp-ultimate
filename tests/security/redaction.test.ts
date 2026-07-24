/**
 * Token-hygiene tests: registered secrets must never surface in tool error
 * text, LineApiError/MyShopApiError messages, or details — even when the LINE
 * API echoes the Authorization header back in an error body.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearRegisteredSecrets,
  redactSecrets,
  registerSecret,
} from "../../src/line/redact.js";
import { LineApiError } from "../../src/line/client.js";
import { MyShopApiError } from "../../src/line/myshop-client.js";
import { installFetchMock, type FetchMock } from "../helpers/fetch-mock.js";
import { isolateConfigEnv, useConfigFile, useSingleOaEnv } from "../helpers/env.js";
import { createTestMcp, firstText, type TestMcp } from "../helpers/mcp.js";

const REDACTED = "***REDACTED***";

describe("redactSecrets (unit)", () => {
  beforeEach(() => clearRegisteredSecrets());
  afterEach(() => clearRegisteredSecrets());

  it("returns text unchanged when no secrets are registered", () => {
    expect(redactSecrets("hello Bearer abc123")).toBe("hello Bearer abc123");
  });

  it("handles empty text and ignores empty/nullish/short secrets", () => {
    registerSecret("");
    registerSecret(undefined);
    registerSecret(null);
    registerSecret("ab"); // below minimum length — would shred normal text
    expect(redactSecrets("")).toBe("");
    expect(redactSecrets("abc ab")).toBe("abc ab");
  });

  it("redacts a raw secret and a secret inside a Bearer header", () => {
    registerSecret("tok-ABC-123456");
    const out = redactSecrets("auth failed for Bearer tok-ABC-123456 (raw: tok-ABC-123456)");
    expect(out).toBe(`auth failed for Bearer ${REDACTED} (raw: ${REDACTED})`);
    expect(out).not.toContain("tok-ABC-123456");
  });

  it("redacts overlapping secrets without leaving fragments (longest first)", () => {
    registerSecret("secret");
    registerSecret("secret-extended-form");
    const out = redactSecrets("a secret-extended-form and a bare secret here");
    expect(out).not.toContain("secret");
    expect(out).toBe(`a ${REDACTED} and a bare ${REDACTED} here`);
  });

  it("redacts a secret embedded inside a JSON string (escaped form)", () => {
    const secret = 'to"k\\en\twith-specials-123';
    registerSecret(secret);
    const jsonBody = JSON.stringify({ message: `bad auth: Bearer ${secret}` });
    const out = redactSecrets(jsonBody);
    expect(out).toContain(REDACTED);
    expect(out).not.toContain(JSON.stringify(secret).slice(1, -1));
    // Raw form is also gone.
    expect(redactSecrets(`raw: ${secret}`)).toBe(`raw: ${REDACTED}`);
  });

  it("redacts multiple registered secrets in one pass", () => {
    registerSecret("channel-token-AAA");
    registerSecret("channel-secret-BBB");
    registerSecret("myshop-key-CCC");
    const out = redactSecrets("t=channel-token-AAA s=channel-secret-BBB k=myshop-key-CCC");
    expect(out).toBe(`t=${REDACTED} s=${REDACTED} k=${REDACTED}`);
  });
});

describe("error classes redact registered secrets", () => {
  beforeEach(() => clearRegisteredSecrets());
  afterEach(() => clearRegisteredSecrets());

  it("LineApiError message + details are redacted", () => {
    registerSecret("line-token-xyz-7890");
    const err = new LineApiError(400, {
      message: "Invalid Authorization: Bearer line-token-xyz-7890",
      details: [{ message: "token line-token-xyz-7890 rejected", property: "header" }],
    });
    expect(err.message).toContain(REDACTED);
    expect(err.message).not.toContain("line-token-xyz-7890");
    expect(err.details.join(" ")).toContain(REDACTED);
    expect(err.details.join(" ")).not.toContain("line-token-xyz-7890");
  });

  it("MyShopApiError message is redacted", () => {
    registerSecret("myshop-api-key-9999");
    const err = new MyShopApiError(400, {
      code: "BAD_REQUEST",
      message: "key myshop-api-key-9999 is not valid",
    });
    expect(err.message).toContain(REDACTED);
    expect(err.message).not.toContain("myshop-api-key-9999");
  });
});

describe("end-to-end: LINE 400 echoing the Authorization header", () => {
  const SECRET_TOKEN = "super-secret-channel-token-abc123";
  let restoreEnv: () => void;
  let api: FetchMock;
  let mcp: TestMcp;

  beforeEach(() => {
    restoreEnv = isolateConfigEnv();
  });

  afterEach(async () => {
    await mcp?.close();
    api?.uninstall();
    restoreEnv();
  });

  it("tool error text contains ***REDACTED*** and not the token (env single-OA)", async () => {
    useSingleOaEnv(SECRET_TOKEN);
    api = installFetchMock();
    // LINE sometimes echoes the offending header back in 400 bodies.
    api.on("/v2/bot/message/validate/push", (call) => ({
      status: 400,
      body: {
        message: `invalid request. authorization=${call.headers.authorization}`,
        details: [
          { message: `the token ${SECRET_TOKEN} was rejected`, property: "Authorization" },
        ],
      },
    }));
    mcp = await createTestMcp();

    const result = await mcp.callTool("line_send_message", {
      target: { user_id: "U1234567890abcdef" },
      message: { text: "สวัสดีค่ะ" },
    });

    expect(result.isError).toBe(true);
    const text = firstText(result);
    expect(text).toContain(REDACTED);
    expect(text).not.toContain(SECRET_TOKEN);
    // The real request DID carry the real token (redaction is output-only).
    expect(api.lastCall()?.headers.authorization).toBe(`Bearer ${SECRET_TOKEN}`);
  });

  it("registers every OA token from a multi-OA config file (incl. secrets/myshop keys)", async () => {
    useConfigFile({
      default_oa: "main",
      oas: {
        main: {
          channel_access_token: "cfg-token-main-111111",
          channel_secret: "cfg-channel-secret-222222",
          myshop_api_key: "cfg-myshop-key-333333",
        },
        second: { channel_access_token: "cfg-token-second-444444" },
      },
    });
    api = installFetchMock();
    api.on("/v2/bot/message/validate/push", {
      status: 400,
      body: {
        message:
          "echo cfg-token-main-111111 cfg-channel-secret-222222 cfg-myshop-key-333333 cfg-token-second-444444",
      },
    });
    mcp = await createTestMcp();

    const result = await mcp.callTool("line_send_message", {
      target: { user_id: "U1234567890abcdef" },
      message: { text: "ทดสอบ" },
      oa: "second",
    });

    expect(result.isError).toBe(true);
    const text = firstText(result);
    expect(text).toContain(REDACTED);
    expect(text).not.toContain("cfg-token-main-111111");
    expect(text).not.toContain("cfg-channel-secret-222222");
    expect(text).not.toContain("cfg-myshop-key-333333");
    expect(text).not.toContain("cfg-token-second-444444");
  });
});
