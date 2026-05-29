/**
 * LINE Webhook Router — Cloudflare Worker template
 *
 * Solves the "1 webhook URL per LINE OA" limitation by fanning out to many
 * downstream services in parallel.
 *
 * Deploy:
 *   1. wrangler init line-webhook-router
 *   2. paste this as src/index.js
 *   3. set env vars (CHANNEL_SECRET, DESTINATION_*)
 *   4. wrangler deploy
 *   5. paste the *.workers.dev URL into LINE Developers Console → Webhook URL
 *
 * Free tier: 100,000 requests/day — more than enough for most Thai SMB OAs.
 */

export default {
  async fetch(request, env) {
    // ---- 1. Only accept POST from LINE ----
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const rawBody = await request.text();

    // ---- 2. Verify LINE signature once (so downstream services can trust) ----
    const signature = request.headers.get("x-line-signature");
    if (env.CHANNEL_SECRET && signature) {
      const valid = await verifyLineSignature(rawBody, signature, env.CHANNEL_SECRET);
      if (!valid) {
        console.error("Invalid LINE signature");
        return new Response("Forbidden", { status: 403 });
      }
    }

    // ---- 3. Parse for logging ----
    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return new Response("Bad request", { status: 400 });
    }

    console.log("LINE event(s):", payload.events?.length ?? 0);

    // ---- 4. Build destination list (configurable via env) ----
    // Add as many destinations as you want — each one runs in parallel.
    const destinations = [
      env.DESTINATION_MCP_WEBHOOK,   // MCP webhook server
      env.DESTINATION_CHATBOT,        // OpenAI / Dialogflow chatbot
      env.DESTINATION_N8N,            // n8n workflow
      env.DESTINATION_CRM,            // CRM webhook
      env.DESTINATION_ANALYTICS,      // analytics pipeline
    ].filter(Boolean); // drop unset env vars

    // ---- 5. Fan-out in parallel, isolate failures ----
    const results = await Promise.allSettled(
      destinations.map((url) =>
        fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Line-Signature": signature ?? "",
            "X-Forwarded-By": "line-webhook-router",
          },
          body: rawBody,
        }),
      ),
    );

    // ---- 6. Log per-destination outcome (Cloudflare Logpush picks this up) ----
    results.forEach((r, i) => {
      const url = destinations[i];
      if (r.status === "rejected") {
        console.error(`Destination ${url} threw:`, r.reason);
      } else if (!r.value.ok) {
        console.warn(`Destination ${url} returned ${r.value.status}`);
      }
    });

    // ---- 7. Always 200 back to LINE quickly (must be within 10s) ----
    return new Response("OK", { status: 200 });
  },
};

// ---- HMAC-SHA256 signature verification ----

async function verifyLineSignature(body, signature, channelSecret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(channelSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return constantTimeEqual(expected, signature);
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
