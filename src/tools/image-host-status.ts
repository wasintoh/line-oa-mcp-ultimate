/**
 * Tool: line_image_host_status
 *
 * Read-only diagnostics for the Image Hosting Layer: which providers are
 * usable right now, whether a tunnel is live, and what is sitting in the
 * in-memory store. The go-to tool when line_prepare_image fell back to
 * handoff or a verification failed — it tells the user what to configure
 * to unlock a better provider.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { imageStore } from "../imagehost/store.js";
import { selfHostRegistered, selfHostPublicUrl } from "../imagehost/providers/self.js";
import { binaryStatus, tunnelStatus, CLOUDFLARED_VERSION } from "../imagehost/providers/local-tunnel.js";

const InputSchema = z.object({}).strict();

export function registerImageHostStatusTool(server: McpServer): void {
  server.registerTool(
    "line_image_host_status",
    {
      title: "Image hosting status (providers, tunnel, store)",
      description: `Report the Image Hosting Layer's current state: which provider line_prepare_image would use (self / local-tunnel / handoff), whether a cloudflared tunnel is live (URL + expiry), how the cloudflared binary would be obtained, and in-memory store usage. READ-ONLY — never starts a tunnel or downloads anything.

Use when line_prepare_image fell back to handoff, a verify failed, or the user asks "why can't it host automatically?". Returns { providers, tunnel, store }.`,
      inputSchema: InputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const self = { registered: selfHostRegistered(), public_url: selfHostPublicUrl() };
      const bin = binaryStatus();
      const tunnel = tunnelStatus();
      const tunnelDisabled = process.env.LINE_MCP_TUNNEL === "off";
      const store = imageStore.stats();

      const output = {
        providers: {
          self: { available: self.registered, public_url: self.public_url },
          local_tunnel: {
            available: !tunnelDisabled && bin !== "unsupported-platform",
            disabled_by_env: tunnelDisabled,
            binary: bin,
            cloudflared_version: CLOUDFLARED_VERSION,
          },
          handoff: { available: true },
        },
        tunnel: tunnel.active
          ? { active: true, url: tunnel.url, expires_at: tunnel.expiresAt }
          : { active: false },
        store: { prepared_images: store.count, total_bytes: store.totalBytes },
      };

      const lines: string[] = ["🔎 สถานะระบบโฮสต์รูป (Image Hosting Layer)", ""];
      lines.push(
        self.registered
          ? `✅ self: พร้อมใช้ — เสิร์ฟรูปจากเซิร์ฟเวอร์นี้เองที่ ${self.public_url}/i/...`
          : "⚪ self: ไม่พร้อม (ใช้ได้เมื่อรันแบบ HTTP transport และตั้ง env MCP_PUBLIC_URL เป็น URL สาธารณะของเซิร์ฟเวอร์)",
      );
      if (tunnelDisabled) {
        lines.push("⛔ local-tunnel: ถูกปิดด้วย env LINE_MCP_TUNNEL=off");
      } else if (bin === "unsupported-platform") {
        lines.push(`⚠️ local-tunnel: ไม่มี cloudflared สำหรับเครื่องนี้ (${process.platform}/${process.arch}) — ติดตั้งเองแล้วตั้ง LINE_MCP_CLOUDFLARED_PATH ได้`);
      } else {
        const binTh =
          bin === "on-path" ? "พบ cloudflared ในเครื่องแล้ว"
          : bin === "cached" ? "มี cloudflared ที่ดาวน์โหลดไว้แล้ว"
          : bin === "env-override" ? "ใช้ cloudflared ตาม LINE_MCP_CLOUDFLARED_PATH"
          : `จะดาวน์โหลด cloudflared ${CLOUDFLARED_VERSION} อัตโนมัติครั้งแรกที่ใช้ (ตรวจ SHA-256 ก่อนรันเสมอ)`;
        lines.push(`✅ local-tunnel: พร้อมใช้ — ${binTh}`);
      }
      lines.push(
        tunnel.active
          ? `🌐 สะพานตอนนี้: เปิดอยู่ที่ ${tunnel.url} (ปิดอัตโนมัติ ~${tunnel.expiresAt})`
          : "🌐 สะพานตอนนี้: ยังไม่ได้เปิด (จะเปิดเองตอนเรียก line_prepare_image)",
      );
      lines.push("✅ handoff: พร้อมเสมอ — ถ้าทุกทางอัตโนมัติล้มเหลว จะได้ zip + คู่มือทำเองใน 1 นาที");
      lines.push(`🗂️ รูปที่พักไว้ในหน่วยความจำ: ${store.count} ชุด (${(store.totalBytes / 1024 / 1024).toFixed(1)} MB)`);

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        structuredContent: output as unknown as Record<string, unknown>,
      };
    },
  );
}
