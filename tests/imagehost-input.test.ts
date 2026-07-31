/**
 * Unit tests for the image input loader (v2.2 Image Hosting Layer).
 *
 * No real network — the SSRF guard is mocked and asserted on (the module must
 * pass the REWRITTEN url and the maxBytes cap). file_path cases use real temp
 * files; the base64 oversize case relies on the length short-circuit that runs
 * BEFORE decoding, so only the error reason is asserted.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

import { IMAGE_BASE64_MAX_CHARS, IMAGE_INPUT_MAX_BYTES } from "../src/constants.js";
import { loadImageInput, rewriteWellKnownUrl } from "../src/imagehost/input.js";
import { ImageHostError } from "../src/imagehost/types.js";
import { fetchPublicImage } from "../src/line/ssrf-guard.js";

vi.mock("../src/line/ssrf-guard.js", () => ({
  fetchPublicImage: vi.fn(async (url: string) => ({
    buffer: Buffer.from("fetched-bytes"),
    contentType: "image/png",
    finalUrl: url,
  })),
}));

/** Await a rejection and assert it is an ImageHostError; return it for checks. */
async function grabError(p: Promise<unknown>): Promise<ImageHostError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(ImageHostError);
    return err as ImageHostError;
  }
  throw new Error("expected promise to reject, but it resolved");
}

const tmpFiles: string[] = [];

function writeTmp(name: string, data: Buffer): string {
  const p = path.join(os.tmpdir(), `imagehost-input-test-${process.pid}-${name}`);
  fs.writeFileSync(p, data);
  tmpFiles.push(p);
  return p;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterAll(() => {
  for (const p of tmpFiles) {
    try {
      fs.unlinkSync(p);
    } catch {
      // already gone — fine
    }
  }
});

describe("rewriteWellKnownUrl", () => {
  it("rewrites a Google Drive /file/d/<ID>/view link to direct-download form", () => {
    const r = rewriteWellKnownUrl("https://drive.google.com/file/d/1AbC_dEf-123/view?usp=sharing");
    expect(r.url).toBe("https://drive.google.com/uc?export=download&id=1AbC_dEf-123");
    expect(r.note).toMatch(/Google Drive/);
  });

  it("rewrites a Google Drive open?id=<ID> link to direct-download form", () => {
    const r = rewriteWellKnownUrl("https://drive.google.com/open?id=XYZ789");
    expect(r.url).toBe("https://drive.google.com/uc?export=download&id=XYZ789");
    expect(r.note).toMatch(/Google Drive/);
  });

  it("rewrites a Dropbox dl=0 link to dl=1 with a note", () => {
    const r = rewriteWellKnownUrl("https://www.dropbox.com/s/abc123/pic.png?dl=0");
    const u = new URL(r.url);
    expect(u.searchParams.get("dl")).toBe("1");
    expect(u.hostname).toBe("www.dropbox.com");
    expect(r.note).toMatch(/Dropbox/);
  });

  it("leaves any other url unchanged with no note", () => {
    const r = rewriteWellKnownUrl("https://cdn.example.com/pic.png?dl=0");
    expect(r.url).toBe("https://cdn.example.com/pic.png?dl=0");
    expect(r.note).toBeUndefined();
  });

  it("leaves an unparseable string unchanged with no note", () => {
    const r = rewriteWellKnownUrl("not a url at all");
    expect(r.url).toBe("not a url at all");
    expect(r.note).toBeUndefined();
  });
});

describe("loadImageInput — field exclusivity", () => {
  it("rejects zero fields", async () => {
    const err = await grabError(loadImageInput({}));
    expect(err.reason).toBe("input-invalid");
    expect(err.message).toBe("provide exactly one of file_path, base64, source_url");
  });

  it("rejects two fields", async () => {
    const err = await grabError(loadImageInput({ file_path: "/tmp/x.png", base64: "aGk=" }));
    expect(err.reason).toBe("input-invalid");
    expect(err.message).toBe("provide exactly one of file_path, base64, source_url");
  });

  it("rejects all three fields", async () => {
    const err = await grabError(
      loadImageInput({ file_path: "/tmp/x.png", base64: "aGk=", source_url: "https://x.com/a.png" }),
    );
    expect(err.reason).toBe("input-invalid");
  });
});

describe("loadImageInput — file_path", () => {
  it("loads an existing file and reports the path as origin", async () => {
    const data = Buffer.from("fake-png-bytes");
    const p = writeTmp("happy.png", data);
    const out = await loadImageInput({ file_path: p });
    expect(out.buffer.equals(data)).toBe(true);
    expect(out.origin).toBe(p);
    expect(out.warnings).toEqual([]);
  });

  it("expands a leading ~ to os.homedir()", async () => {
    const name = `imagehost-input-tilde-${process.pid}-${Date.now()}.bin`;
    const abs = path.join(os.homedir(), name);
    fs.writeFileSync(abs, Buffer.from("tilde-bytes"));
    try {
      const out = await loadImageInput({ file_path: `~/${name}` });
      expect(out.buffer.equals(Buffer.from("tilde-bytes"))).toBe(true);
      expect(out.origin).toBe(abs);
    } finally {
      fs.unlinkSync(abs);
    }
  });

  it("rejects a missing file with input-invalid and includes the path", async () => {
    const missing = path.join(os.tmpdir(), `imagehost-input-missing-${process.pid}-nope.png`);
    const err = await grabError(loadImageInput({ file_path: missing }));
    expect(err.reason).toBe("input-invalid");
    expect(err.message).toContain(missing);
  });

  it("rejects a file over IMAGE_INPUT_MAX_BYTES with input-too-large and MB detail", async () => {
    const p = writeTmp("huge.png", Buffer.alloc(IMAGE_INPUT_MAX_BYTES + 1));
    const err = await grabError(loadImageInput({ file_path: p }));
    expect(err.reason).toBe("input-too-large");
    expect(err.message).toMatch(/10\.0MB/); // actual size
    expect(err.message).toMatch(/10MB/); // limit
    expect(err.message).toContain(p);
  });
});

describe("loadImageInput — base64", () => {
  const payload = Buffer.from("hello image bytes");
  const b64 = payload.toString("base64");

  it("decodes a bare base64 payload", async () => {
    const out = await loadImageInput({ base64: b64 });
    expect(out.buffer.equals(payload)).toBe(true);
    expect(out.origin).toBe("base64 input");
    expect(out.warnings).toEqual([]);
  });

  it("strips a data:image/...;base64, prefix before decoding", async () => {
    const out = await loadImageInput({ base64: `data:image/png;base64,${b64}` });
    expect(out.buffer.equals(payload)).toBe(true);
    expect(out.origin).toBe("base64 input");
  });

  it("short-circuits on length > IMAGE_BASE64_MAX_CHARS before decoding", async () => {
    // Cheap to build via repeat; the length gate must fire before charset/decode.
    const oversized = "A".repeat(IMAGE_BASE64_MAX_CHARS + 4);
    const err = await grabError(loadImageInput({ base64: oversized }));
    expect(err.reason).toBe("input-too-large");
  });

  it("rejects characters outside the base64 alphabet", async () => {
    const err = await grabError(loadImageInput({ base64: "abcd$%^&==" }));
    expect(err.reason).toBe("input-invalid");
  });

  it("rejects a payload that decodes to zero bytes", async () => {
    const err = await grabError(loadImageInput({ base64: "====" }));
    expect(err.reason).toBe("input-invalid");
  });
});

describe("loadImageInput — source_url (SSRF guard mocked)", () => {
  it("calls fetchPublicImage with the REWRITTEN gdrive url and the maxBytes cap", async () => {
    const out = await loadImageInput({
      source_url: "https://drive.google.com/file/d/FILE123/view?usp=sharing",
    });
    expect(vi.mocked(fetchPublicImage)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchPublicImage)).toHaveBeenCalledWith(
      "https://drive.google.com/uc?export=download&id=FILE123",
      { maxBytes: IMAGE_INPUT_MAX_BYTES },
    );
    expect(out.buffer.equals(Buffer.from("fetched-bytes"))).toBe(true);
    expect(out.warnings).toEqual(["rewrote Google Drive share link to direct-download form"]);
    // origin is the final url reported by the guard (mock echoes the input url)
    expect(out.origin).toBe("https://drive.google.com/uc?export=download&id=FILE123");
  });

  it("passes a dropbox dl=0 url through as dl=1 with a warning", async () => {
    const out = await loadImageInput({ source_url: "https://www.dropbox.com/s/abc/pic.png?dl=0" });
    const calledWith = vi.mocked(fetchPublicImage).mock.calls[0];
    expect(new URL(calledWith?.[0] as string).searchParams.get("dl")).toBe("1");
    expect(calledWith?.[1]).toEqual({ maxBytes: IMAGE_INPUT_MAX_BYTES });
    expect(out.warnings).toHaveLength(1);
  });

  it("passes an ordinary url through unchanged with no warnings", async () => {
    const out = await loadImageInput({ source_url: "https://cdn.example.com/pic.png" });
    expect(vi.mocked(fetchPublicImage)).toHaveBeenCalledWith("https://cdn.example.com/pic.png", {
      maxBytes: IMAGE_INPUT_MAX_BYTES,
    });
    expect(out.warnings).toEqual([]);
    expect(out.origin).toBe("https://cdn.example.com/pic.png");
  });
});
