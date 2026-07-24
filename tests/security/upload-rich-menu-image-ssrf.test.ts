/**
 * E2E: line_upload_rich_menu_image now downloads through the SSRF guard.
 *
 * - A public https image URL still flows end-to-end: download → validate →
 *   upload to api-data.line.me (same response shape as before).
 * - A private/metadata target is refused with a Thai error BEFORE any fetch.
 *
 * DNS is mocked so "public" hostnames resolve deterministically.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: lookupMock }));

import { installFetchMock, type FetchMock } from "../helpers/fetch-mock.js";
import { isolateConfigEnv, useSingleOaEnv } from "../helpers/env.js";
import { createTestMcp, firstText, type TestMcp } from "../helpers/mcp.js";

describe("line_upload_rich_menu_image + SSRF guard (e2e)", () => {
  let restoreEnv: () => void;
  let api: FetchMock;
  let mcp: TestMcp;

  beforeEach(async () => {
    lookupMock.mockReset();
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    restoreEnv = isolateConfigEnv();
    useSingleOaEnv("upload-test-token");
    api = installFetchMock();
    mcp = await createTestMcp();
  });

  afterEach(async () => {
    await mcp.close();
    api.uninstall();
    restoreEnv();
  });

  it("uploads a public https image through the guard (response shape preserved)", async () => {
    api.on("/banner.png", { text: "PNGDATA", headers: { "Content-Type": "image/png" } });

    const result = await mcp.callTool("line_upload_rich_menu_image", {
      rich_menu_id: "richmenu-abc123",
      image_url: "https://cdn.example.com/banner.png",
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      rich_menu_id: "richmenu-abc123",
      uploaded: true,
      bytes: 7,
    });
    expect(firstText(result)).toContain("สำเร็จ");

    // The actual upload hit the api-data content endpoint with the raw bytes.
    const uploads = api.callsTo("/v2/bot/richmenu/richmenu-abc123/content");
    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.headers["content-type"]).toBe("image/png");
    expect(uploads[0]?.headers.authorization).toBe("Bearer upload-test-token");
  });

  it("refuses image_url=https://169.254.169.254/x with a Thai error and no fetch", async () => {
    const result = await mcp.callTool("line_upload_rich_menu_image", {
      rich_menu_id: "richmenu-abc123",
      image_url: "https://169.254.169.254/x",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("ไม่อนุญาต");
    // The metadata host was never contacted, and nothing was uploaded.
    expect(api.calls.some((c) => c.url.hostname === "169.254.169.254")).toBe(false);
    expect(api.callsTo("/content")).toHaveLength(0);
  });

  it("refuses an http:// image_url (schema + guard both say https only)", async () => {
    const result = await mcp.callTool("line_upload_rich_menu_image", {
      rich_menu_id: "richmenu-abc123",
      image_url: "http://cdn.example.com/banner.png",
    });

    expect(result.isError).toBe(true);
    expect(api.callsTo("/content")).toHaveLength(0);
  });

  it("refuses a hostname that resolves to a private address", async () => {
    lookupMock.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);

    const result = await mcp.callTool("line_upload_rich_menu_image", {
      rich_menu_id: "richmenu-abc123",
      image_url: "https://sneaky.example.com/banner.png",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("ไม่อนุญาต");
    expect(api.callsTo("/content")).toHaveLength(0);
  });

  it("still rejects unsupported formats with the original Thai error", async () => {
    api.on("/doc.pdf", { text: "%PDF-1.4", headers: { "Content-Type": "application/pdf" } });

    const result = await mcp.callTool("line_upload_rich_menu_image", {
      rich_menu_id: "richmenu-abc123",
      image_url: "https://cdn.example.com/doc.pdf",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("ไม่รองรับ");
    expect(api.callsTo("/content")).toHaveLength(0);
  });

  it("still rejects >1MB images with the original Thai size error", async () => {
    api.on("/huge.png", {
      text: "x".repeat(1_000_001),
      headers: { "Content-Type": "image/png" },
    });

    const result = await mcp.callTool("line_upload_rich_menu_image", {
      rich_menu_id: "richmenu-abc123",
      image_url: "https://cdn.example.com/huge.png",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("บีบอัดก่อนอัปโหลด");
    expect(api.callsTo("/content")).toHaveLength(0);
  });
});
