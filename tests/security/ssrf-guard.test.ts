/**
 * SSRF guard tests — assertPublicHttpUrl / fetchPublicImage / isPrivateAddress.
 *
 * DNS is mocked at the module boundary (node:dns/promises) so hostname tests
 * are deterministic and never touch the network. HTTP behavior (redirects,
 * caps, happy path) goes through the shared FetchMock or targeted stubs.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: lookupMock }));

import {
  SsrfBlockedError,
  assertPublicHttpUrl,
  fetchPublicImage,
  isPrivateAddress,
} from "../../src/line/ssrf-guard.js";
import { installFetchMock, type FetchMock } from "../helpers/fetch-mock.js";

const PUBLIC_IP = "93.184.216.34";

beforeEach(() => {
  lookupMock.mockReset();
  lookupMock.mockImplementation(async (host: string) => {
    if (host.includes("private") || host.includes("internal.example.com")) {
      return [{ address: "10.0.0.5", family: 4 }];
    }
    if (host.includes("metadata")) {
      return [{ address: "169.254.169.254", family: 4 }];
    }
    if (host.includes("unresolvable")) {
      throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
    }
    if (host.includes("empty-answer")) {
      return [];
    }
    return [{ address: PUBLIC_IP, family: 4 }];
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isPrivateAddress", () => {
  it("blocks IPv4 loopback / private / link-local / metadata / CGNAT / special ranges", () => {
    for (const ip of [
      "127.0.0.1",
      "127.255.255.254",
      "10.0.0.1",
      "10.255.255.255",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.0.1",
      "192.168.255.255",
      "169.254.169.254", // cloud metadata!
      "169.254.0.1",
      "0.0.0.0",
      "0.1.2.3",
      "100.64.0.1", // CGNAT
      "100.127.255.255",
      "192.0.0.1", // IETF protocol assignments
      "198.18.0.1", // benchmarking
      "224.0.0.1", // multicast
      "255.255.255.255", // broadcast
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it("allows public IPv4", () => {
    for (const ip of ["93.184.216.34", "8.8.8.8", "172.15.0.1", "172.32.0.1", "100.63.0.1", "1.1.1.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it("blocks IPv6 loopback/unspecified in canonical AND expanded forms", () => {
    expect(isPrivateAddress("::1")).toBe(true);
    expect(isPrivateAddress("0:0:0:0:0:0:0:1")).toBe(true);
    expect(isPrivateAddress("::")).toBe(true);
    expect(isPrivateAddress("0:0:0:0:0:0:0:0")).toBe(true);
  });

  it("blocks IPv6 link-local / ULA / site-local / multicast", () => {
    expect(isPrivateAddress("fe80::1")).toBe(true);
    expect(isPrivateAddress("fe80::1%eth0")).toBe(true);
    expect(isPrivateAddress("fc00::1")).toBe(true);
    expect(isPrivateAddress("fd12:3456::1")).toBe(true);
    expect(isPrivateAddress("fec0::1")).toBe(true);
    expect(isPrivateAddress("ff02::1")).toBe(true);
  });

  it("blocks v4-mapped/compatible/NAT64 IPv6 embedding a private IPv4", () => {
    expect(isPrivateAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateAddress("::ffff:7f00:1")).toBe(true); // hex form of 127.0.0.1
    expect(isPrivateAddress("::ffff:169.254.169.254")).toBe(true);
    expect(isPrivateAddress("::ffff:10.0.0.1")).toBe(true);
    expect(isPrivateAddress("64:ff9b::10.0.0.1")).toBe(true); // NAT64
  });

  it("allows v4-mapped IPv6 embedding a public IPv4, and plain public IPv6", () => {
    expect(isPrivateAddress("::ffff:93.184.216.34")).toBe(false);
    expect(isPrivateAddress("2606:4700::1111")).toBe(false);
    expect(isPrivateAddress("2001:4860:4860::8888")).toBe(false);
  });
});

describe("assertPublicHttpUrl", () => {
  it("rejects non-https schemes (http://, ftp://, file://)", async () => {
    for (const url of ["http://example.com/a.png", "ftp://example.com/a", "file:///etc/passwd"]) {
      await expect(assertPublicHttpUrl(url), url).rejects.toThrow(SsrfBlockedError);
      await expect(assertPublicHttpUrl(url), url).rejects.toThrow(/https/);
    }
  });

  it("rejects malformed URLs", async () => {
    await expect(assertPublicHttpUrl("not a url")).rejects.toThrow(SsrfBlockedError);
  });

  it("rejects literal private IPv4 targets (incl. metadata + 0.0.0.0)", async () => {
    for (const url of [
      "https://127.0.0.1/x",
      "https://10.1.2.3/x",
      "https://172.16.0.9/x",
      "https://172.31.9.9/x",
      "https://192.168.1.1/x",
      "https://169.254.169.254/latest/meta-data/",
      "https://0.0.0.0/x",
    ]) {
      await expect(assertPublicHttpUrl(url), url).rejects.toThrow(/ไม่อนุญาต/);
    }
  });

  it("rejects literal IPv6 loopback and v4-mapped loopback (bracketed)", async () => {
    await expect(assertPublicHttpUrl("https://[::1]/x")).rejects.toThrow(/ไม่อนุญาต/);
    await expect(assertPublicHttpUrl("https://[::ffff:127.0.0.1]/x")).rejects.toThrow(/ไม่อนุญาต/);
    await expect(assertPublicHttpUrl("https://[0:0:0:0:0:0:0:1]/x")).rejects.toThrow(/ไม่อนุญาต/);
    await expect(assertPublicHttpUrl("https://[fe80::1]/x")).rejects.toThrow(/ไม่อนุญาต/);
  });

  it("rejects blocked hostnames without needing DNS (localhost, *.internal, *.local)", async () => {
    for (const url of [
      "https://localhost/x",
      "https://sub.localhost/x",
      "https://foo.internal/x",
      "https://printer.local/x",
      "https://router.home.arpa/x",
      "https://localhost./x", // trailing-dot evasion
    ]) {
      await expect(assertPublicHttpUrl(url), url).rejects.toThrow(/internal host/);
    }
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("rejects a DNS name that resolves to a private address", async () => {
    await expect(assertPublicHttpUrl("https://internal.example.com/x")).rejects.toThrow(
      /internal address \(10\.0\.0\.5\)/,
    );
    await expect(assertPublicHttpUrl("https://metadata.example.com/x")).rejects.toThrow(
      /169\.254\.169\.254/,
    );
  });

  it("rejects hosts that fail to resolve or resolve to nothing", async () => {
    await expect(assertPublicHttpUrl("https://unresolvable.example.com/x")).rejects.toThrow(
      /Resolve/,
    );
    await expect(assertPublicHttpUrl("https://empty-answer.example.com/x")).rejects.toThrow(
      /Resolve/,
    );
  });

  it("accepts a public https URL (DNS resolves public)", async () => {
    const url = await assertPublicHttpUrl("https://cdn.example.com/banner.png");
    expect(url.hostname).toBe("cdn.example.com");
  });

  it("accepts a literal public IP", async () => {
    const url = await assertPublicHttpUrl(`https://${PUBLIC_IP}/img.png`);
    expect(url.hostname).toBe(PUBLIC_IP);
  });
});

describe("fetchPublicImage", () => {
  let api: FetchMock;

  afterEach(() => {
    api?.uninstall();
  });

  it("happy path returns buffer + contentType + finalUrl", async () => {
    api = installFetchMock();
    api.on("/banner.png", {
      text: "PNG-BYTES",
      headers: { "Content-Type": "image/png" },
    });

    const out = await fetchPublicImage("https://cdn.example.com/banner.png");
    expect(out.buffer.toString("utf8")).toBe("PNG-BYTES");
    expect(out.contentType).toBe("image/png");
    expect(out.finalUrl).toBe("https://cdn.example.com/banner.png");
  });

  it("follows a public→public redirect and returns the final hop", async () => {
    api = installFetchMock();
    api.on("/start.png", {
      status: 302,
      headers: { location: "https://cdn2.example.com/final.png" },
    });
    api.on("/final.png", { text: "FINAL", headers: { "Content-Type": "image/jpeg" } });

    const out = await fetchPublicImage("https://cdn.example.com/start.png");
    expect(out.buffer.toString("utf8")).toBe("FINAL");
    expect(out.finalUrl).toBe("https://cdn2.example.com/final.png");
  });

  it("rejects a 302 redirect hop that targets a private host (the classic pivot)", async () => {
    api = installFetchMock();
    api.on("/pivot.png", {
      status: 302,
      headers: { location: "https://internal.example.com/secret" },
    });

    await expect(fetchPublicImage("https://cdn.example.com/pivot.png")).rejects.toThrow(
      /internal address/,
    );
  });

  it("rejects a redirect hop to a literal metadata IP", async () => {
    api = installFetchMock();
    api.on("/meta.png", {
      status: 302,
      headers: { location: "https://169.254.169.254/latest/meta-data/" },
    });

    await expect(fetchPublicImage("https://cdn.example.com/meta.png")).rejects.toThrow(
      /ไม่อนุญาต/,
    );
  });

  it("rejects a redirect loop after MAX_REDIRECTS hops", async () => {
    api = installFetchMock();
    api.on("/loop.png", {
      status: 302,
      headers: { location: "https://cdn.example.com/loop.png" },
    });

    await expect(fetchPublicImage("https://cdn.example.com/loop.png")).rejects.toThrow(
      /Redirect เกินจำนวน/,
    );
  });

  it("rejects when the declared Content-Length exceeds the cap (before reading the body)", async () => {
    const read = vi.fn();
    vi.stubGlobal("fetch", async () => ({
      status: 200,
      ok: true,
      headers: { get: (k: string) => (k.toLowerCase() === "content-length" ? "999999999" : null) },
      body: { getReader: () => ({ read }) },
    }));

    await expect(
      fetchPublicImage("https://cdn.example.com/huge.png", { maxBytes: 1000 }),
    ).rejects.toThrow(/ไฟล์ใหญ่เกิน/);
    expect(read).not.toHaveBeenCalled();
  });

  it("rejects when the streamed body exceeds the cap (Content-Length absent or lying)", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(600));
        controller.enqueue(new Uint8Array(600)); // 1200 total > 1000 cap
        controller.close();
      },
    });
    vi.stubGlobal("fetch", async () => new Response(stream, { status: 200 }));

    await expect(
      fetchPublicImage("https://cdn.example.com/lying.png", { maxBytes: 1000 }),
    ).rejects.toThrow(/ไฟล์ใหญ่เกิน/);
  });

  it("accepts a body exactly at the cap", async () => {
    vi.stubGlobal("fetch", async () => new Response(new Uint8Array(1000), { status: 200 }));

    const out = await fetchPublicImage("https://cdn.example.com/exact.png", { maxBytes: 1000 });
    expect(out.buffer.byteLength).toBe(1000);
  });

  it("rejects HTTP error statuses with a Thai message", async () => {
    api = installFetchMock();
    api.on("/gone.png", { status: 404, body: { message: "not found" } });

    await expect(fetchPublicImage("https://cdn.example.com/gone.png")).rejects.toThrow(
      /HTTP 404/,
    );
  });

  it("never issues a fetch for a blocked URL (guard runs first)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(fetchPublicImage("https://169.254.169.254/x")).rejects.toThrow(SsrfBlockedError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
