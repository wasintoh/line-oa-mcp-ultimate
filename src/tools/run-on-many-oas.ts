/**
 * Tool: line_run_on_many_oas
 *
 * Agency power feature — invoke any other line_* tool across N OAs in
 * parallel, isolate errors per OA, and aggregate results.
 *
 * Implementation note: rather than re-entering the MCP server (which would
 * be reflexive and fragile), we delegate to a small dispatch table that maps
 * tool name → direct LINE API call. V1 supports a curated subset of read-only
 * tools (status/report/list/test). Write operations are intentionally
 * excluded from bulk mode until V1.1 so agencies can't accidentally
 * broadcast to every client.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { listOas, resolveOa } from "../config/multi-oa.js";
import { LineClient } from "../line/client.js";
import { snapshotQuota } from "../line/quota-guardian.js";
import { TH } from "../i18n/th.js";

const SUPPORTED_TOOLS = [
  "line_get_oa_status",
  "line_get_oa_report",
  "line_list_audiences",
  "line_list_rich_menus",
  "line_test_webhook",
] as const;

const InputSchema = z
  .object({
    tool: z
      .enum(SUPPORTED_TOOLS)
      .describe(
        "Read-only tool to run across all selected OAs. Write tools (send/build/delete) are not supported in bulk mode for safety.",
      ),
    oa_ids: z
      .union([z.array(z.string()), z.literal("all")])
      .default("all")
      .describe(
        "Either an array of OA ids or 'all' to use every configured OA. Default 'all'.",
      ),
    parallel: z
      .number()
      .int()
      .min(1)
      .max(10)
      .default(5)
      .describe("Max concurrent OAs (1-10). Default 5."),
    response_format: z.enum(["markdown", "json"]).default("markdown"),
  })
  .strict();

type _Input = z.infer<typeof InputSchema>; // kept for doc purposes

export function registerRunOnManyOasTool(server: McpServer): void {
  server.registerTool(
    "line_run_on_many_oas",
    {
      title: "Run a tool across many LINE OAs",
      description: `Agency feature — run any read-only line_* tool across many OAs in parallel; per-OA errors are isolated (one bad token doesn't break the run). tool must be one of the supported read-only tools below; oa_ids an array or 'all' (default); parallel concurrency 1-10 (default 5).

Supported tools:
  ${SUPPORTED_TOOLS.map((t) => `- ${t}`).join("\n  ")}

Returns { tool, count_ok, count_failed, results[], errors[] }.

Example: "เช็คสถานะทุก OA" → { tool:"line_get_oa_status", oa_ids:"all" }.`,
      inputSchema: InputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (raw: unknown) => {
      try {
        const params = InputSchema.parse(raw);
        const all = listOas();
        const selectedIds = params.oa_ids === "all" ? all.map((o) => o.id) : params.oa_ids;

        const results: Array<{ oa_id: string; oa_name: string; success: boolean; summary: unknown; error?: string }> = [];

        const work = async (id: string): Promise<void> => {
          try {
            const { config } = resolveOa(id);
            const client = new LineClient({ channelAccessToken: config.channel_access_token });
            const summary = await runOne(params.tool, client);
            results.push({
              oa_id: id,
              oa_name: config.display_name ?? id,
              success: true,
              summary,
            });
          } catch (err) {
            results.push({
              oa_id: id,
              oa_name: (resolveOa(id).config.display_name ?? id),
              success: false,
              summary: null,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        };

        // Simple parallel scheduler
        const queue = [...selectedIds];
        const workers: Promise<void>[] = [];
        for (let i = 0; i < params.parallel; i++) {
          workers.push(
            (async () => {
              while (queue.length) {
                const id = queue.shift();
                if (id) await work(id);
              }
            })(),
          );
        }
        await Promise.all(workers);

        const ok = results.filter((r) => r.success);
        const failed = results.filter((r) => !r.success);

        const output = {
          tool: params.tool,
          count_ok: ok.length,
          count_failed: failed.length,
          results: ok,
          errors: failed.map((f) => ({ oa_id: f.oa_id, error: f.error })),
        };

        const text =
          params.response_format === "json"
            ? JSON.stringify(output, null, 2)
            : renderMd(params.tool, output);
        return {
          content: [{ type: "text", text }],
          structuredContent: output as unknown as Record<string, unknown>,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: TH.unknownError(msg) }] };
      }
    },
  );
}

async function runOne(
  tool: (typeof SUPPORTED_TOOLS)[number],
  client: LineClient,
): Promise<unknown> {
  switch (tool) {
    case "line_get_oa_status": {
      const [info, quota, webhook] = await Promise.allSettled([
        client.getBotInfo(),
        snapshotQuota(client),
        client.getWebhookEndpoint(),
      ]);
      return {
        display_name: info.status === "fulfilled" ? info.value.displayName : "?",
        quota: quota.status === "fulfilled" ? quota.value : null,
        webhook_active: webhook.status === "fulfilled" ? webhook.value.active : null,
      };
    }
    case "line_get_oa_report": {
      const quota = await snapshotQuota(client);
      return { quota };
    }
    case "line_list_audiences": {
      const res = await client.request<{ audienceGroups?: unknown[]; totalCount?: number }>(
        "GET",
        "/v2/bot/audienceGroup/list",
        { query: { page: 1, size: 20 } },
      );
      return { total: res.totalCount ?? 0 };
    }
    case "line_list_rich_menus": {
      const res = await client.listRichMenus();
      return { count: res.richmenus.length };
    }
    case "line_test_webhook": {
      const res = await client.testWebhook();
      return { success: res.success, status: res.statusCode, reason: res.reason };
    }
  }
}

function renderMd(
  tool: string,
  o: {
    count_ok: number;
    count_failed: number;
    results: { oa_id: string; oa_name: string; summary: unknown }[];
    errors: { oa_id: string; error?: string }[];
  },
): string {
  const lines = [`# 🏢 \`${tool}\` × ${o.count_ok + o.count_failed} OAs`, ""];
  lines.push(`- ✅ Success: ${o.count_ok}`);
  lines.push(`- ❌ Failed: ${o.count_failed}`);
  lines.push("");
  if (o.results.length) {
    lines.push("## Results");
    for (const r of o.results) {
      lines.push(`### ${r.oa_name} (\`${r.oa_id}\`)`);
      lines.push("```json");
      lines.push(JSON.stringify(r.summary, null, 2));
      lines.push("```");
    }
  }
  if (o.errors.length) {
    lines.push("");
    lines.push("## Errors");
    for (const e of o.errors) {
      lines.push(`- \`${e.oa_id}\`: ${e.error}`);
    }
  }
  return lines.join("\n");
}
