/**
 * Tool: line_emit_login_snippet
 *
 * Code emitter for a full LINE Login OAuth flow. The "10 tools → 1 codegen"
 * pattern: devs integrating LINE Login don't want 10 separate OAuth tool
 * calls — they want a working scaffold.
 *
 * Output covers:
 *   - authorize URL builder (with optional PKCE)
 *   - token exchange
 *   - access token verification
 *   - userinfo fetch
 *   - refresh token flow
 *   - (optional) friendship status check
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const FRAMEWORKS = ["express", "nextjs-route-handlers", "fastify", "hono"] as const;

const InputSchema = z
  .object({
    framework: z.enum(FRAMEWORKS).default("express"),
    scopes: z
      .array(z.enum(["profile", "openid", "email"]))
      .default(["profile", "openid"]),
    with_pkce: z.boolean().default(true).describe("Use PKCE S256 (recommended)."),
    with_friendship_check: z.boolean().default(false),
    with_refresh: z.boolean().default(true),
    typescript: z.boolean().default(true),
  })
  .strict();

type Input = z.infer<typeof InputSchema>;

export function registerEmitLoginSnippetTool(server: McpServer): void {
  server.registerTool(
    "line_emit_login_snippet",
    {
      title: "Emit LINE Login OAuth code scaffold",
      description: `Generate a working LINE Login OAuth 2.1 flow scaffold (authorize URL + token exchange + verify + userinfo + optional refresh + optional friendship check) for your backend framework.

This replaces 10 separate OAuth tool calls with one paste-ready code block — Claude Code's superpower.

Args:
  - framework: ${FRAMEWORKS.join(" | ")}. Default 'express'.
  - scopes: ['profile', 'openid', 'email']. Default ['profile', 'openid'].
  - with_pkce: emit PKCE S256 helpers (recommended; default true).
  - with_friendship_check: include /friendship/v1/status call (default false).
  - with_refresh: include refresh-token route (default true).
  - typescript: emit TypeScript (default) or JavaScript.

Returns:
  {
    framework, scopes, code: string, env_vars_required: string[], notes: string[]
  }

The emitted code uses placeholders:
  - LINE_LOGIN_CHANNEL_ID
  - LINE_LOGIN_CHANNEL_SECRET
  - REDIRECT_URI`,
      inputSchema: InputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (raw: unknown) => {
      const params = InputSchema.parse(raw);
      const ext = params.typescript ? "ts" : "js";
      const code = emit(params);
      const envVars = ["LINE_LOGIN_CHANNEL_ID", "LINE_LOGIN_CHANNEL_SECRET", "REDIRECT_URI"];
      const notes: string[] = [
        "ใช้ LINE Login channel — แยกจาก Messaging API channel (สร้างเพิ่มใน LINE Developers Console)",
        "ID Token ใช้ HS256 ด้วย channel_secret (ไม่ใช่ RS256/JWKS แบบ OIDC ทั่วไป) — verify ผ่าน /oauth2/v2.1/verify endpoint",
        "Access token อายุ 30 วัน, refresh token อายุ 90 วันจาก issue, code อายุ 10 นาที single-use",
      ];
      if (params.with_friendship_check) {
        notes.push("friendship/v1/status ใช้ดู user เพิ่ม OA เป็นเพื่อนแล้วหรือยัง (ต้อง pair LINE Login channel กับ Messaging API channel ใน Console)");
      }
      const output = { framework: params.framework, scopes: params.scopes, code, env_vars_required: envVars, notes };
      const md = [
        `# 🔐 LINE Login scaffold — ${params.framework} (${ext})`,
        "",
        `Scopes: ${params.scopes.join(", ")}${params.with_pkce ? " + PKCE" : ""}`,
        "",
        `Env vars: ${envVars.map((v) => `\`${v}\``).join(", ")}`,
        "",
        "```" + ext,
        code,
        "```",
        "",
        "## Notes",
        ...notes.map((n) => `- ${n}`),
      ].join("\n");
      return {
        content: [{ type: "text", text: md }],
        structuredContent: output as unknown as Record<string, unknown>,
      };
    },
  );
}

// ---- emitters ----

function emit(p: Input): string {
  if (p.framework === "express") return express(p);
  if (p.framework === "hono") return hono(p);
  if (p.framework === "fastify") return fastify(p);
  return nextRoutes(p);
}

function pkceBlock(p: Input): string {
  if (!p.with_pkce) return "";
  return `import { randomBytes, createHash } from "node:crypto";

function makePkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}
`;
}

function authUrlBlock(p: Input): string {
  const scope = p.scopes.join(" ");
  if (p.with_pkce) {
    return `function buildAuthorizeUrl(state, codeChallenge) {
  const u = new URL("https://access.line.me/oauth2/v2.1/authorize");
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", process.env.LINE_LOGIN_CHANNEL_ID);
  u.searchParams.set("redirect_uri", process.env.REDIRECT_URI);
  u.searchParams.set("state", state);
  u.searchParams.set("scope", "${scope}");
  u.searchParams.set("code_challenge", codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}`;
  }
  return `function buildAuthorizeUrl(state) {
  const u = new URL("https://access.line.me/oauth2/v2.1/authorize");
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", process.env.LINE_LOGIN_CHANNEL_ID);
  u.searchParams.set("redirect_uri", process.env.REDIRECT_URI);
  u.searchParams.set("state", state);
  u.searchParams.set("scope", "${scope}");
  return u.toString();
}`;
}

function tokenExchangeBlock(p: Input): string {
  return `async function exchangeCode(code${p.with_pkce ? ", codeVerifier" : ""}) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: process.env.REDIRECT_URI,
    client_id: process.env.LINE_LOGIN_CHANNEL_ID,
    client_secret: process.env.LINE_LOGIN_CHANNEL_SECRET,
    ${p.with_pkce ? "code_verifier: codeVerifier," : ""}
  });
  const res = await fetch("https://api.line.me/oauth2/v2.1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error("Token exchange failed: " + (await res.text()));
  return res.json(); // { access_token, refresh_token, id_token?, expires_in, scope }
}`;
}

function userinfoBlock(): string {
  return `async function getUserProfile(accessToken) {
  const res = await fetch("https://api.line.me/v2/profile", {
    headers: { Authorization: "Bearer " + accessToken },
  });
  if (!res.ok) throw new Error("Profile fetch failed");
  return res.json(); // { userId, displayName, pictureUrl, statusMessage }
}`;
}

function refreshBlock(p: Input): string {
  if (!p.with_refresh) return "";
  return `async function refreshAccessToken(refreshToken) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: process.env.LINE_LOGIN_CHANNEL_ID,
    client_secret: process.env.LINE_LOGIN_CHANNEL_SECRET,
  });
  const res = await fetch("https://api.line.me/oauth2/v2.1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error("Refresh failed");
  return res.json();
}`;
}

function friendshipBlock(p: Input): string {
  if (!p.with_friendship_check) return "";
  return `async function checkFriendship(accessToken) {
  const res = await fetch("https://api.line.me/friendship/v1/status", {
    headers: { Authorization: "Bearer " + accessToken },
  });
  if (!res.ok) throw new Error("Friendship check failed");
  return res.json(); // { friendFlag: boolean }
}`;
}

function express(p: Input): string {
  const ts = p.typescript;
  return `// line-login.${ts ? "ts" : "js"}
${pkceBlock(p)}
${authUrlBlock(p)}

${tokenExchangeBlock(p)}

${userinfoBlock()}

${refreshBlock(p)}

${friendshipBlock(p)}

// --- Express routes ---
// app.get("/auth/line/start", (req, res) => {
//   const state = crypto.randomBytes(16).toString("base64url");
//   ${p.with_pkce ? "const pkce = makePkce(); req.session.codeVerifier = pkce.verifier;" : ""}
//   req.session.state = state;
//   res.redirect(buildAuthorizeUrl(state${p.with_pkce ? ", pkce.challenge" : ""}));
// });
//
// app.get("/auth/line/callback", async (req, res) => {
//   if (req.query.state !== req.session.state) return res.status(400).send("Bad state");
//   const token = await exchangeCode(req.query.code${p.with_pkce ? ", req.session.codeVerifier" : ""});
//   const profile = await getUserProfile(token.access_token);
//   // store profile + token in session/db, redirect, etc.
// });`;
}

function hono(p: Input): string {
  return `// line-login.${p.typescript ? "ts" : "js"} (Hono)
${pkceBlock(p)}
${authUrlBlock(p)}
${tokenExchangeBlock(p)}
${userinfoBlock()}
${refreshBlock(p)}
${friendshipBlock(p)}
// Wire up with app.get("/auth/line/start", ...) etc.`;
}

function fastify(p: Input): string {
  return `// line-login.${p.typescript ? "ts" : "js"} (Fastify)
${pkceBlock(p)}
${authUrlBlock(p)}
${tokenExchangeBlock(p)}
${userinfoBlock()}
${refreshBlock(p)}
${friendshipBlock(p)}
// fastify.get("/auth/line/start", async (req, reply) => { ... })`;
}

function nextRoutes(p: Input): string {
  return `// app/api/auth/line/start/route.${p.typescript ? "ts" : "js"}
${pkceBlock(p)}
${authUrlBlock(p)}

// export async function GET(req) {
//   const state = crypto.randomBytes(16).toString("base64url");
//   ${p.with_pkce ? "const { verifier, challenge } = makePkce(); cookies().set('line_code_verifier', verifier, { httpOnly: true });" : ""}
//   cookies().set('line_state', state, { httpOnly: true });
//   return Response.redirect(buildAuthorizeUrl(state${p.with_pkce ? ", challenge" : ""}));
// }

// app/api/auth/line/callback/route.${p.typescript ? "ts" : "js"}
${tokenExchangeBlock(p)}
${userinfoBlock()}
${refreshBlock(p)}
${friendshipBlock(p)}`;
}
