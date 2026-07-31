#!/usr/bin/env node
/**
 * Live check of the FULL line_prepare_image tool path on a network that blocks
 * the tunnel data plane (like this sandbox): expect tunnel attempt → verify
 * fails → automatic handoff fallback with a zip + Thai steps, no crash, no
 * leftover cloudflared. Run AFTER `npm run build`.
 */

import { existsSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Resvg } from "@resvg/resvg-js";
import { buildServer } from "../dist/server.js";

process.env.LINE_CHANNEL_ACCESS_TOKEN = "live-check-dummy";

const png = new Resvg(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1040" height="1040"><rect width="1040" height="1040" fill="#06C755"/></svg>',
).render().asPng();

const server = buildServer();
const [ct, st] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: "live-check", version: "0" });
await Promise.all([client.connect(ct), server.connect(st)]);

console.log("calling line_prepare_image (tunnel will register but its data plane is blocked here)…");
const t0 = Date.now();
const result = await client.callTool({
  name: "line_prepare_image",
  arguments: { image: { base64: Buffer.from(png).toString("base64") } },
});
const secs = ((Date.now() - t0) / 1000).toFixed(1);

const out = result.structuredContent ?? {};
console.log(`took ${secs}s · isError=${result.isError === true} · provider=${out.provider}`);
console.log(`warnings: ${(out.warnings ?? []).join(" | ").slice(0, 400)}`);

let pass = true;
if (result.isError) { console.log("FAIL: tool returned an error instead of falling back"); pass = false; }
if (out.provider !== "handoff") { console.log("FAIL: expected provider=handoff"); pass = false; }
if (!out.handoff?.zipPath || !existsSync(out.handoff.zipPath)) { console.log("FAIL: handoff zip missing"); pass = false; }

await client.close();
setTimeout(() => {
  console.log(pass ? "RESULT: PASS — graceful fallback, zip ready" : "RESULT: FAIL");
  process.exit(pass ? 0 : 1);
}, 2500);
