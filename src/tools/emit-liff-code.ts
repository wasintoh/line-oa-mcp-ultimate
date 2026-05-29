/**
 * Tool: line_emit_liff_code
 *
 * Code emitter — produce a ready-to-paste LIFF SDK init snippet tailored to
 * a target framework + chosen features. This is the developer power tool:
 * one tool replaces 10 SDK-doc-trawl steps with working code.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const FRAMEWORKS = ["vanilla", "react", "next-app-router", "vue", "svelte"] as const;
const FEATURES = [
  "getProfile",
  "scanCode",
  "shareTargetPicker",
  "sendMessages",
  "openWindow",
  "permission",
  "getIDToken",
] as const;

const InputSchema = z
  .object({
    framework: z.enum(FRAMEWORKS).default("vanilla"),
    features: z
      .array(z.enum(FEATURES))
      .default(["getProfile"])
      .describe("LIFF SDK features the generated code should demonstrate / wire up."),
    liff_id_placeholder: z
      .string()
      .default("YOUR_LIFF_ID")
      .describe("Placeholder to use for the LIFF ID in the emitted code."),
    typescript: z.boolean().default(true),
  })
  .strict();

type Input = z.infer<typeof InputSchema>;

export function registerEmitLiffCodeTool(server: McpServer): void {
  server.registerTool(
    "line_emit_liff_code",
    {
      title: "Emit LIFF SDK init code",
      description: `Generate a working LIFF SDK init code snippet for the requested framework and features. The output is paste-ready and includes feature-detection guards (e.g., scanCodeV2 only on LINE 14+, iOS 14.3+).

Args:
  - framework: ${FRAMEWORKS.join(" | ")}. Default 'vanilla'.
  - features: array from [${FEATURES.join(", ")}]. Default ['getProfile'].
  - liff_id_placeholder: string to use where the LIFF ID goes. Default 'YOUR_LIFF_ID'.
  - typescript: emit TypeScript (default) or plain JavaScript.

Returns:
  {
    framework, features, language: 'ts' | 'js',
    code: string,         // copy-paste ready
    install_command: string,
    notes: string[]
  }`,
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
      const code = emit(params);
      const language = params.typescript ? "ts" : "js";
      const output = {
        framework: params.framework,
        features: params.features,
        language,
        install_command: installCmd(params.framework),
        code,
        notes: notesFor(params.features),
      };
      const md = [
        `# ⚡ LIFF code — ${params.framework} (${language})`,
        "",
        `Install: \`${output.install_command}\``,
        "",
        "```" + language,
        code,
        "```",
        "",
        ...(output.notes.length ? ["## Notes", ...output.notes.map((n) => `- ${n}`)] : []),
      ].join("\n");
      return {
        content: [{ type: "text", text: md }],
        structuredContent: output as unknown as Record<string, unknown>,
      };
    },
  );
}

function installCmd(framework: Input["framework"]): string {
  switch (framework) {
    case "next-app-router":
      return "npm install @line/liff";
    default:
      return "npm install @line/liff";
  }
}

function notesFor(features: Input["features"]): string[] {
  const out: string[] = [];
  if (features.includes("scanCode")) {
    out.push("scanCodeV2 ใช้ได้บน LINE ≥14.0 + iOS 14.3+ (LINE in-app browser). External browser ต้องใช้ html5-qrcode fallback");
  }
  if (features.includes("shareTargetPicker")) {
    out.push("shareTargetPicker เปิดได้แค่ภายใน LINE in-app browser");
  }
  if (features.includes("permission")) {
    out.push("permission API ใช้สำหรับ openid + email scopes — ต้อง config scopes ใน LINE Developers Console");
  }
  if (features.includes("getIDToken")) {
    out.push("ID Token (JWT, HS256 with channel secret) — verify server-side ก่อนใช้ในการ auth");
  }
  return out;
}

function emit(p: Input): string {
  if (p.framework === "vanilla") return vanilla(p);
  if (p.framework === "react") return react(p);
  if (p.framework === "next-app-router") return next(p);
  if (p.framework === "vue") return vue(p);
  return svelte(p);
}

function featureBlock(features: Input["features"]): string {
  const lines: string[] = [];
  if (features.includes("getProfile")) {
    lines.push(
      `  if (liff.isLoggedIn()) {
    const profile = await liff.getProfile();
    console.log("Hello,", profile.displayName);
  }`,
    );
  }
  if (features.includes("scanCode")) {
    lines.push(
      `  // scanCodeV2 only works on iOS 14.3+ inside LINE
  if (liff.isApiAvailable && liff.isApiAvailable("scanCodeV2")) {
    // const { value } = await liff.scanCodeV2();
  }`,
    );
  }
  if (features.includes("shareTargetPicker")) {
    lines.push(
      `  // share LINE picker (requires login + scope)
  // await liff.shareTargetPicker([{ type: "text", text: "Hello" }]);`,
    );
  }
  if (features.includes("sendMessages")) {
    lines.push(
      `  // send messages to the chat the LIFF was opened from
  // await liff.sendMessages([{ type: "text", text: "Sent from LIFF" }]);`,
    );
  }
  if (features.includes("openWindow")) {
    lines.push(`  // liff.openWindow({ url: "https://example.com", external: true });`);
  }
  if (features.includes("getIDToken")) {
    lines.push(
      `  // ID Token (JWT HS256) — verify server-side
  // const idToken = liff.getIDToken();
  // (send idToken to your backend → POST /oauth2/v2.1/verify on LINE)`,
    );
  }
  if (features.includes("permission")) {
    lines.push(
      `  // check / request granted permissions (openid, email, etc.)
  // const granted = await liff.permission.getGrantedAll();`,
    );
  }
  return lines.join("\n\n");
}

function vanilla(p: Input): string {
  const ext = p.typescript ? "ts" : "js";
  return `// liff-init.${ext}
import liff from "@line/liff";

const LIFF_ID = "${p.liff_id_placeholder}";

export async function initLiff() {
  await liff.init({ liffId: LIFF_ID });

${featureBlock(p.features)}
}

initLiff().catch((err) => {
  console.error("[LIFF] init failed:", err);
});`;
}

function react(p: Input): string {
  return `// useLiff.${p.typescript ? "ts" : "js"}
import { useEffect, useState } from "react";
import liff from "@line/liff";

const LIFF_ID = "${p.liff_id_placeholder}";

export function useLiff() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    liff
      .init({ liffId: LIFF_ID })
      .then(async () => {
${featureBlock(p.features)
  .split("\n")
  .map((l) => `        ${l}`)
  .join("\n")}
        setReady(true);
      })
      .catch((err) => console.error("[LIFF] init failed:", err));
  }, []);

  return { ready, liff };
}`;
}

function next(p: Input): string {
  return `// app/components/LiffProvider.${p.typescript ? "tsx" : "jsx"}
"use client";
import { createContext, useContext, useEffect, useState } from "react";
import liff from "@line/liff";

const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID ?? "${p.liff_id_placeholder}";
const LiffContext = createContext${p.typescript ? "<{ ready: boolean; liff: typeof liff }>" : ""}({ ready: false, liff });

export function LiffProvider({ children }${p.typescript ? ": { children: React.ReactNode }" : ""}) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    liff
      .init({ liffId: LIFF_ID })
      .then(async () => {
${featureBlock(p.features)
  .split("\n")
  .map((l) => `        ${l}`)
  .join("\n")}
        setReady(true);
      })
      .catch((err) => console.error("[LIFF] init failed:", err));
  }, []);

  return <LiffContext.Provider value={{ ready, liff }}>{children}</LiffContext.Provider>;
}

export const useLiff = () => useContext(LiffContext);`;
}

function vue(p: Input): string {
  return `<!-- composables/useLiff.${p.typescript ? "ts" : "js"} -->
<script setup>
import { onMounted, ref } from "vue";
import liff from "@line/liff";

const LIFF_ID = "${p.liff_id_placeholder}";
const ready = ref(false);

onMounted(async () => {
  try {
    await liff.init({ liffId: LIFF_ID });
${featureBlock(p.features)
  .split("\n")
  .map((l) => `    ${l}`)
  .join("\n")}
    ready.value = true;
  } catch (err) {
    console.error("[LIFF] init failed:", err);
  }
});
</script>`;
}

function svelte(p: Input): string {
  return `<!-- routes/+layout.svelte -->
<script ${p.typescript ? 'lang="ts"' : ""}>
import { onMount } from "svelte";
import liff from "@line/liff";

const LIFF_ID = "${p.liff_id_placeholder}";
let ready = false;

onMount(async () => {
  try {
    await liff.init({ liffId: LIFF_ID });
${featureBlock(p.features)
  .split("\n")
  .map((l) => `    ${l}`)
  .join("\n")}
    ready = true;
  } catch (err) {
    console.error("[LIFF] init failed:", err);
  }
});
</script>`;
}
