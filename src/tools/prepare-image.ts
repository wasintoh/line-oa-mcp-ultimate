/**
 * Tool: line_prepare_image
 *
 * Turns ANY image the user has (a local file, pasted base64, or a public URL)
 * into LINE-ready hosted URLs — resized to the 5 imagemap widths, hosted via
 * the best available provider (self → local-tunnel → handoff), and VERIFIED
 * reachable before we ever say "success". Pairs with line_design_imagemap and
 * line_send_message, which both accept the returned `prepared_key`.
 *
 * IMPORTANT: LINE has NO upload API for message images (pull model — LINE
 * fetches from public HTTPS at send time and copies to its own CDN). This tool
 * exists so non-technical users never have to know that. `success: true` from
 * the send API does NOT mean the image renders (LINE only acked the request) —
 * which is why the per-size HEAD verification here is non-negotiable.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { IMAGEHOST_DEFAULT_KEEPALIVE_S } from "../constants.js";
import { TH } from "../i18n/th.js";
import { loadImageInput } from "../imagehost/input.js";
import { makeVariants } from "../imagehost/resize.js";
import { imageStore } from "../imagehost/store.js";
import { handoffFallback, hostImage } from "../imagehost/resolve.js";
import { localTunnelHost } from "../imagehost/providers/local-tunnel.js";
import { verifyUrls } from "../imagehost/verify.js";
import { ImageHostError, type HostResult } from "../imagehost/types.js";

const InputSchema = z
  .object({
    image: z
      .object({
        file_path: z
          .string()
          .optional()
          .describe("Absolute path of a PNG/JPEG on the machine running this MCP (≤10MB). e.g. /Users/me/promo.png or ~/Desktop/sale.jpg"),
        base64: z
          .string()
          .optional()
          .describe("Base64 image content (data: prefix allowed). LAST RESORT ONLY: long base64 hand-carried through an LLM can corrupt silently and produce a BLANK (transparent) image — ALWAYS prefer file_path or source_url when either exists. ≤~3MB decoded."),
        source_url: z
          .string()
          .url()
          .optional()
          .describe("Public HTTPS URL of the image. Google Drive/Dropbox share links are rewritten to direct-download automatically."),
      })
      .strict()
      .describe("The source image. Provide EXACTLY ONE of file_path | base64 | source_url."),
    purpose: z
      .enum(["imagemap", "image_message"])
      .default("imagemap")
      .describe('"imagemap" (default) = Rich Message with tappable areas (needs 5 hosted sizes). "image_message" = plain image bubble (needs full + preview).'),
    keep_alive_hours: z
      .number()
      .min(0.1)
      .max(720)
      .default(IMAGEHOST_DEFAULT_KEEPALIVE_S / 3600)
      .describe("How long to keep the hosting alive (default 24h). Must cover the window until recipients FIRST VIEW the message (that's when LINE fetches); hosting also ends if this MCP process exits."),
  })
  .strict();

export function registerPrepareImageTool(server: McpServer): void {
  server.registerTool(
    "line_prepare_image",
    {
      title: "Prepare an image for LINE (resize + host + verify)",
      description: `Make any image sendable to LINE with ZERO hosting knowledge: resizes to the imagemap widths (1040/700/460/300/240), hosts them via the best available provider, HEAD-verifies every size, and returns a \`prepared_key\` that line_design_imagemap / line_send_message accept directly.

Provider chain (auto-selected, user never configures): self (HTTP deployments with MCP_PUBLIC_URL) → local-tunnel (default for stdio installs; free cloudflared quick tunnel, outbound-only so it works behind NAT) → handoff (a zip + Thai step-by-step manual instructions — nobody dead-ends).

Why this exists: LINE has no upload API for message images; they must sit on public HTTPS. IMPORTANT (live-verified 2026-07-31): LINE fetches the image when each recipient FIRST VIEWS the message — NOT at send time. Keep this MCP process (and the machine) running until most recipients have opened the message; once viewed, LINE's cache serves the image permanently (survives host shutdown and even device restarts). Default keep-alive: 24h.

Returns { prepared_key, provider, base_url?, image_url?, preview_image_url?, verified, expires_at?, handoff?, warnings }. NEVER claims false success: every returned URL was verified reachable; if verification fails (e.g. the network blocks the tunnel), the tool automatically tears the tunnel down and returns the handoff package instead.

Example: "ส่งรูปนี้เป็น Rich Message" → 1) line_prepare_image { image: { file_path: "/Users/me/promo.png" } } → 2) line_design_imagemap { prepared_key, alt_text, areas } → 3) line_send_message { message: { message_json } }.`,
      inputSchema: InputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (raw: unknown) => {
      try {
        const params = InputSchema.parse(raw);

        const provided = [params.image.file_path, params.image.base64, params.image.source_url].filter(
          (v) => v !== undefined,
        );
        if (provided.length !== 1) {
          return { isError: true, content: [{ type: "text", text: TH.imgExactlyOneSource }] };
        }

        // 1) Load bytes (SSRF-guarded for URLs) and 2) build the 5 PNG variants.
        const loaded = await loadImageInput(params.image);
        if (params.image.base64) {
          // A corrupted-in-transit base64 body decodes past the header sniff but
          // rasterizes to a silent BLANK canvas (live incident 2026-07-31).
          loaded.warnings.push(
            "input arrived as base64 — if the sent image renders blank, the base64 was corrupted in transit; re-run with file_path or source_url instead",
          );
        }
        const variants = await makeVariants(loaded.buffer);

        // 3) Park them in the in-memory store under an unguessable key.
        const keepAliveMs = params.keep_alive_hours * 3600 * 1000;
        const stored = imageStore.put(variants, keepAliveMs);

        // 4) Host via the provider chain (never dead-ends: handoff catches all).
        const hosted = await hostImage(variants, stored.key, params.purpose, {
          keepAliveSeconds: params.keep_alive_hours * 3600,
        });
        imageStore.setHosting(stored.key, hosted);

        const allWarnings = [...loaded.warnings, ...variants.warnings, ...hosted.warnings];

        // ---- handoff path: manual package, still a useful (non-error) outcome ----
        if (hosted.kind === "handoff" || !hosted.urls) {
          return handoffResponse(stored.key, params.purpose, hosted, allWarnings);
        }

        // ---- hosted path: verify EVERY size before claiming success (F5) ----
        const urlsToVerify: Record<string, string> =
          params.purpose === "imagemap"
            ? hosted.urls
            : { "1040": hosted.urls["1040"]!, "240": hosted.urls["240"]! };
        // Fresh tunnel hostnames take a few seconds to propagate through DNS /
        // Cloudflare's edge — retry briefly before declaring failure.
        let verification = await verifyUrls(urlsToVerify);
        for (let attempt = 0; !verification.ok && attempt < 4; attempt++) {
          await new Promise((r) => setTimeout(r, 4_000));
          verification = await verifyUrls(urlsToVerify);
        }

        if (!verification.ok) {
          // The provider CLAIMED success but the URLs are dead from the outside
          // (classic case: corporate network lets the tunnel register its URL
          // but blocks the data plane). Tear the useless tunnel down and fall
          // back to handoff — the user must never dead-end.
          const statuses = Object.entries(verification.statuses)
            .map(([size, st]) => `${size}→${st}`)
            .join(", ");
          if (hosted.providerId === "local-tunnel") {
            await localTunnelHost.dispose().catch(() => {
              /* best-effort teardown */
            });
          }
          const fallback = await handoffFallback(variants, stored.key);
          // (handoff has no keep-alive concept — the zip lives in tmpdir)
          imageStore.setHosting(stored.key, fallback);
          return handoffResponse(stored.key, params.purpose, fallback, [
            ...allWarnings,
            `${hosted.providerId}: hosted but verification failed (${statuses}) — likely blocked by the network; fell back to handoff`,
          ]);
        }

        const output = {
          prepared_key: stored.key,
          purpose: params.purpose,
          provider: hosted.providerId,
          base_url: hosted.baseUrl,
          image_url: hosted.imageUrl,
          preview_image_url: hosted.previewImageUrl,
          base_height: variants.baseHeight,
          verified: verification.statuses,
          expires_at: hosted.expiresAt ?? null,
          warnings: allWarnings,
        };

        const verifiedScope =
          params.purpose === "imagemap" ? "ครบทั้ง 5 ขนาด" : "ทั้งรูปเต็ม (1040) และรูป preview (240)";
        const text = `${TH.imgPreparedReady(hosted.providerId, hosted.baseUrl ?? "-", params.keep_alive_hours, verifiedScope)}\n${TH.imgPreparedNextStep(stored.key, params.purpose)}`;
        return {
          content: [{ type: "text", text }],
          structuredContent: output as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return errorReply(err);
      }
    },
  );
}

function handoffResponse(
  preparedKey: string,
  purpose: "imagemap" | "image_message",
  result: HostResult,
  warnings: string[],
): { content: { type: "text"; text: string }[]; structuredContent: Record<string, unknown> } {
  const reasons = warnings.filter((w) => w.includes(":")).join(" · ") || "-";
  const steps = result.handoff?.stepsTh ?? [];
  // The zip steps are written for the imagemap flow; a plain image message
  // needs a different final call — say so explicitly (QC catch).
  const purposeNote = purpose === "image_message" ? `\n${TH.imgHandoffImageMessageNote}` : "";
  const text = `${TH.imgHandoffReady(result.handoff?.zipPath ?? "-", reasons)}\n${steps.join("\n")}${purposeNote}`;
  const output = {
    prepared_key: preparedKey,
    purpose,
    provider: result.providerId,
    handoff: result.handoff,
    warnings,
  };
  return {
    content: [{ type: "text", text }],
    structuredContent: output as unknown as Record<string, unknown>,
  };
}

function errorReply(err: unknown): { content: { type: "text"; text: string }[]; isError: true } {
  if (err instanceof ImageHostError) {
    // Reasons map to actionable Thai hints (centralized in i18n/th.ts);
    // the message keeps the technical detail.
    const hint =
      err.reason === "input-too-large"
        ? TH.imgHintTooLarge
        : err.reason === "unsupported-image"
          ? TH.imgHintUnsupported
          : err.reason === "store-full"
            ? TH.imgHintStoreFull
            : TH.imgHintGeneric;
    return { isError: true, content: [{ type: "text", text: `❌ ${err.message}${hint}` }] };
  }
  if (err instanceof z.ZodError) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `❌ Invalid input:\n${err.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n")}`,
        },
      ],
    };
  }
  const msg = err instanceof Error ? err.message : String(err);
  return { isError: true, content: [{ type: "text", text: TH.unknownError(msg) }] };
}
