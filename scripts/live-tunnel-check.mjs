#!/usr/bin/env node
/**
 * Live integration check for the local-tunnel provider (no LINE involved):
 * download+verify cloudflared → open a quick tunnel → serve a real resized
 * image set from memory → HEAD-verify all 5 public URLs → clean shutdown.
 *
 * Run AFTER `npm run build`:  node scripts/live-tunnel-check.mjs
 * Exits 0 only when every size is reachable through the public tunnel URL.
 */

import { Resvg } from "@resvg/resvg-js";
import { makeVariants } from "../dist/imagehost/resize.js";
import { imageStore } from "../dist/imagehost/store.js";
import { localTunnelHost, binaryStatus } from "../dist/imagehost/providers/local-tunnel.js";
import { verifyUrls } from "../dist/imagehost/verify.js";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800">
  <rect width="1200" height="800" fill="#06C755"/>
  <rect x="60" y="60" width="1080" height="680" fill="#ffffff" rx="24"/>
</svg>`;

console.log("[1/5] rendering test image…");
const png = new Resvg(svg).render().asPng();

console.log("[2/5] resizing to the 5 imagemap widths…");
const variants = await makeVariants(Buffer.from(png));
console.log(`      baseHeight=${variants.baseHeight}, sizes=${[...variants.sizes.keys()].join(",")}`);

const stored = imageStore.put(variants, 10 * 60 * 1000);
console.log(`[3/5] stored under key ${stored.key.slice(0, 8)}… — binary status: ${binaryStatus()}`);

console.log("[4/5] opening the tunnel (downloads + SHA-256-verifies cloudflared on first run)…");
const t0 = Date.now();
const hosted = await localTunnelHost.put(variants, stored.key, { keepAliveSeconds: 300 });
console.log(`      tunnel up in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${hosted.baseUrl}`);

console.log("[5/5] HEAD-verifying all 5 sizes through the PUBLIC url (with DNS-propagation retries)…");
let report = await verifyUrls(hosted.urls);
for (let attempt = 0; !report.ok && attempt < 4; attempt++) {
  await new Promise((r) => setTimeout(r, 3000));
  report = await verifyUrls(hosted.urls);
}
console.log(`      ${JSON.stringify(report.statuses)}`);
if (!report.ok) {
  // Surface ONE raw fetch error for diagnosis (verify collapses them to "error").
  try {
    await fetch(hosted.urls["1040"], { method: "HEAD" });
  } catch (err) {
    console.log(`      raw fetch error: ${err?.cause?.message ?? err?.message ?? err}`);
  }
}

await localTunnelHost.dispose();
console.log(report.ok ? "RESULT: PASS — all 5 sizes reachable from the internet" : "RESULT: FAIL");
process.exit(report.ok ? 0 : 1);
