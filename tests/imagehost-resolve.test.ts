/**
 * Provider-chain resolution tests — fake hosts drive hostImageWith to prove
 * ordering, fall-through on failure/unavailability, the imagemap capability
 * filter, and breadcrumb propagation into the winning result's warnings.
 */

import { describe, expect, it } from "vitest";

import { hostImageWith } from "../src/imagehost/resolve.js";
import { ImageHostError, type HostResult, type ImageHost, type ImageVariants } from "../src/imagehost/types.js";

function fakeVariants(): ImageVariants {
  return {
    sizes: new Map([[1040, Buffer.from("x")]]),
    baseWidth: 1040,
    baseHeight: 1040,
    sourceFormat: "png",
    warnings: [],
  };
}

interface FakeSpec {
  id: ImageHost["id"];
  available?: boolean;
  failWith?: string;
  supportsImagemap?: boolean;
}

function fakeHost(spec: FakeSpec, calls: string[]): ImageHost {
  return {
    id: spec.id,
    supportsImagemap: spec.supportsImagemap ?? true,
    async isAvailable() {
      calls.push(`${spec.id}:isAvailable`);
      return spec.available ?? true;
    },
    async put(_v, key): Promise<HostResult> {
      calls.push(`${spec.id}:put`);
      if (spec.failWith) throw new ImageHostError(spec.failWith, "provider-unavailable");
      return {
        kind: "hosted",
        providerId: spec.id,
        baseUrl: `https://${spec.id}.example/i/${key}`,
        urls: { "1040": `https://${spec.id}.example/i/${key}/1040` },
        warnings: [],
      };
    },
  };
}

describe("hostImageWith — provider chain", () => {
  it("picks the first available provider and stops there", async () => {
    const calls: string[] = [];
    const chain = [fakeHost({ id: "self" }, calls), fakeHost({ id: "local-tunnel" }, calls)];
    const result = await hostImageWith(chain, fakeVariants(), "k1", "imagemap");
    expect(result.providerId).toBe("self");
    expect(calls).toEqual(["self:isAvailable", "self:put"]);
  });

  it("skips unavailable providers with a breadcrumb", async () => {
    const calls: string[] = [];
    const chain = [
      fakeHost({ id: "self", available: false }, calls),
      fakeHost({ id: "local-tunnel" }, calls),
    ];
    const result = await hostImageWith(chain, fakeVariants(), "k2", "imagemap");
    expect(result.providerId).toBe("local-tunnel");
    expect(result.warnings.some((w) => w.startsWith("self:"))).toBe(true);
  });

  it("falls through when put() throws, carrying the failure reason forward", async () => {
    const calls: string[] = [];
    const chain = [
      fakeHost({ id: "local-tunnel", failWith: "network blocked cloudflared" }, calls),
      fakeHost({ id: "handoff" }, calls),
    ];
    const result = await hostImageWith(chain, fakeVariants(), "k3", "imagemap");
    expect(result.providerId).toBe("handoff");
    expect(result.warnings.join(" ")).toContain("network blocked cloudflared");
  });

  it("filters providers that cannot serve imagemap when purpose is imagemap", async () => {
    const calls: string[] = [];
    const chain = [
      fakeHost({ id: "self", supportsImagemap: false }, calls),
      fakeHost({ id: "handoff" }, calls),
    ];
    const result = await hostImageWith(chain, fakeVariants(), "k4", "imagemap");
    expect(result.providerId).toBe("handoff");
    expect(calls).not.toContain("self:put"); // capability filter runs before availability probe
  });

  it("allows imagemap-incapable providers for image_message purpose", async () => {
    const calls: string[] = [];
    const chain = [fakeHost({ id: "self", supportsImagemap: false }, calls)];
    const result = await hostImageWith(chain, fakeVariants(), "k5", "image_message");
    expect(result.providerId).toBe("self");
  });

  it("throws (never returns undefined) when every provider fails", async () => {
    const calls: string[] = [];
    const chain = [fakeHost({ id: "self", failWith: "a" }, calls), fakeHost({ id: "handoff", failWith: "b" }, calls)];
    await expect(hostImageWith(chain, fakeVariants(), "k6", "imagemap")).rejects.toThrow(/no image host succeeded/);
  });
});
