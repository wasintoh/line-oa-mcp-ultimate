/**
 * Tool: line_get_oa_report
 *
 * Markdown report bundling delivery, follower, and demographic insights for a
 * given date range. Built specifically for the daily "สรุปสัปดาห์ที่แล้ว" ask
 * from Thai SMB owners — the LINE OA Manager dashboard is 4 clicks deep and
 * not easily exportable.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveOa } from "../config/multi-oa.js";
import { LineApiError, LineClient } from "../line/client.js";
import { snapshotQuota } from "../line/quota-guardian.js";
import { TH } from "../i18n/th.js";

const RangeSchema = z.union([
  z.enum(["today", "yesterday", "this-week", "last-week", "this-month", "last-month"]),
  z.object({ from: z.string(), to: z.string() }).strict(),
]);

const InputSchema = z
  .object({
    range: RangeSchema.default("last-week").describe(
      "Date range. Preset strings or { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }.",
    ),
    oa: z.string().optional(),
    response_format: z.enum(["markdown", "json"]).default("markdown"),
  })
  .strict();

type Input = z.infer<typeof InputSchema>;

interface DeliveryAggregate {
  date: string;
  broadcast: number;
  multicast: number;
  push: number;
  reply: number;
  total: number;
}

interface ReportOutput {
  oa_id: string;
  range: { from: string; to: string; preset?: string };
  delivery: {
    total: number;
    daily: DeliveryAggregate[];
  };
  followers: {
    latest_count?: number;
    follow?: number;
    unfollow?: number;
    net_gain?: number;
  };
  demographic_available: boolean;
  quota: { used: number; total: number | "unlimited"; percentage_used: number };
  notes: string[];
}

export function registerGetOaReportTool(server: McpServer): void {
  server.registerTool(
    "line_get_oa_report",
    {
      title: "Get LINE OA Report (multi-day digest)",
      description: `Digest of LINE OA performance over a date range — bundles 8+ Insight API calls into one Thai-friendly markdown report. range: a preset ('today'|'yesterday'|'this-week'|'last-week'|'this-month'|'last-month', default 'last-week') or { from, to } as YYYY-MM-DD. LINE insight data lags T-2 (yesterday is the latest reliable date) and is masked below the ~20-user privacy floor; demographics populate only with enough consented friends (report surfaces these in notes).

Returns { oa_id, range, delivery{total,daily[]}, followers, demographic_available, quota, notes[] }.`,
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
        const { id: oaId, config } = resolveOa(params.oa);
        const client = new LineClient({ channelAccessToken: config.channel_access_token });

        const { from, to, preset } = resolveRange(params.range);
        const dates = listDates(from, to);

        const [deliveryRes, demographicRes, followersLatest, quotaSnap] = await Promise.allSettled([
          Promise.all(dates.map((d) => fetchDeliveryForDate(client, d))),
          client.getInsightDemographic(),
          fetchLatestFollowers(client, to),
          snapshotQuota(client),
        ]);

        const dailyRaw =
          deliveryRes.status === "fulfilled" ? deliveryRes.value : dates.map((d) => emptyDay(d));

        const total = dailyRaw.reduce((acc, d) => acc + d.total, 0);

        const notes: string[] = [];
        if (deliveryRes.status === "rejected") {
          notes.push("⚠️ Delivery insight partial fetch failure — some days may be zero");
        }
        if (demographicRes.status === "rejected") {
          notes.push("⚠️ Demographic insight unavailable (อาจต่ำกว่า 20-user privacy floor)");
        }
        notes.push("ℹ️ LINE insight data มี T-2 lag — ข้อมูลของวันนี้+เมื่อวานอาจยังไม่ครบ");

        const followersOut =
          followersLatest.status === "fulfilled" ? followersLatest.value : {};

        const quotaOut =
          quotaSnap.status === "fulfilled"
            ? {
                used: quotaSnap.value.used,
                total: quotaSnap.value.total,
                percentage_used: quotaSnap.value.percentage_used,
              }
            : { used: 0, total: "unlimited" as const, percentage_used: 0 };

        const output: ReportOutput = {
          oa_id: oaId,
          range: { from, to, preset },
          delivery: { total, daily: dailyRaw },
          followers: followersOut,
          demographic_available: demographicRes.status === "fulfilled",
          quota: quotaOut,
          notes,
        };

        const text =
          params.response_format === "json"
            ? JSON.stringify(output, null, 2)
            : renderReportMarkdown(output);

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

// ---- date helpers (Bangkok time) ----

function resolveRange(
  range: Input["range"],
): { from: string; to: string; preset?: string } {
  if (typeof range === "object") {
    return { from: range.from, to: range.to };
  }
  const now = bkkNow();
  switch (range) {
    case "today":
      return { from: toYMD(now), to: toYMD(now), preset: range };
    case "yesterday": {
      const d = addDays(now, -1);
      return { from: toYMD(d), to: toYMD(d), preset: range };
    }
    case "this-week": {
      const dayOfWeek = (now.getUTCDay() + 6) % 7; // Monday=0
      const start = addDays(now, -dayOfWeek);
      return { from: toYMD(start), to: toYMD(now), preset: range };
    }
    case "last-week": {
      const dayOfWeek = (now.getUTCDay() + 6) % 7;
      const thisMonday = addDays(now, -dayOfWeek);
      const lastMonday = addDays(thisMonday, -7);
      const lastSunday = addDays(thisMonday, -1);
      return { from: toYMD(lastMonday), to: toYMD(lastSunday), preset: range };
    }
    case "this-month": {
      const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      return { from: toYMD(first), to: toYMD(now), preset: range };
    }
    case "last-month": {
      const firstThis = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const lastPrev = addDays(firstThis, -1);
      const firstPrev = new Date(
        Date.UTC(lastPrev.getUTCFullYear(), lastPrev.getUTCMonth(), 1),
      );
      return { from: toYMD(firstPrev), to: toYMD(lastPrev), preset: range };
    }
    default:
      throw new Error(`Unknown range preset: ${range as string}`);
  }
}

function bkkNow(): Date {
  return new Date(Date.now() + 7 * 60 * 60 * 1000);
}
function addDays(d: Date, n: number): Date {
  const out = new Date(d.getTime());
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}
function toYMD(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function ymdToYyyymmdd(ymd: string): string {
  return ymd.replace(/-/g, "");
}
function listDates(from: string, to: string): string[] {
  const out: string[] = [];
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(toYMD(d));
  return out;
}

// ---- fetch helpers ----

async function fetchDeliveryForDate(client: LineClient, ymd: string): Promise<DeliveryAggregate> {
  const date = ymdToYyyymmdd(ymd);
  try {
    const data = (await client.getInsightDelivery(date)) as {
      status?: string;
      broadcast?: number;
      multicast?: number;
      push?: number;
      reply?: number;
    };
    const broadcast = data.broadcast ?? 0;
    const multicast = data.multicast ?? 0;
    const push = data.push ?? 0;
    const reply = data.reply ?? 0;
    return { date: ymd, broadcast, multicast, push, reply, total: broadcast + multicast + push + reply };
  } catch {
    return emptyDay(ymd);
  }
}

function emptyDay(date: string): DeliveryAggregate {
  return { date, broadcast: 0, multicast: 0, push: 0, reply: 0, total: 0 };
}

async function fetchLatestFollowers(
  client: LineClient,
  ymd: string,
): Promise<ReportOutput["followers"]> {
  try {
    const data = (await client.getInsightFollowers(ymdToYyyymmdd(ymd))) as {
      status?: string;
      followers?: number;
      targetedReaches?: number;
      blocks?: number;
    };
    return {
      latest_count: data.followers,
      // LINE returns aggregates differently per region; we surface the headline number only.
    };
  } catch {
    return {};
  }
}

// ---- markdown rendering ----

function renderReportMarkdown(r: ReportOutput): string {
  const lines: string[] = [];
  lines.push(`# 📊 LINE OA Report — ${r.range.from} ถึง ${r.range.to}`);
  if (r.range.preset) lines.push(`_Range preset: \`${r.range.preset}\`_`);
  lines.push("");

  lines.push("## Delivery (จำนวนข้อความที่ส่ง)");
  lines.push(`- **รวม:** ${r.delivery.total.toLocaleString()} ข้อความ`);
  if (r.delivery.daily.length) {
    lines.push("");
    lines.push("| วันที่ | Broadcast | Multicast | Push | Reply | รวม |");
    lines.push("|---|---:|---:|---:|---:|---:|");
    for (const d of r.delivery.daily) {
      lines.push(
        `| ${d.date} | ${d.broadcast.toLocaleString()} | ${d.multicast.toLocaleString()} | ${d.push.toLocaleString()} | ${d.reply.toLocaleString()} | ${d.total.toLocaleString()} |`,
      );
    }
  }

  lines.push("");
  lines.push("## Followers");
  if (typeof r.followers.latest_count === "number") {
    lines.push(`- **ล่าสุด:** ${r.followers.latest_count.toLocaleString()} คน`);
  } else {
    lines.push("- (ไม่มีข้อมูล follower สำหรับช่วงนี้)");
  }

  lines.push("");
  lines.push("## Quota");
  const totalStr = r.quota.total === "unlimited" ? "ไม่จำกัด" : r.quota.total.toLocaleString();
  lines.push(`- ใช้ ${r.quota.used.toLocaleString()} / ${totalStr} (${r.quota.percentage_used}%)`);

  lines.push("");
  lines.push("## Demographic");
  lines.push(
    r.demographic_available
      ? "- ✅ Demographic data available (ใช้ line_get_message_stats ดูรายละเอียดต่อ broadcast)"
      : "- ⛔ ไม่มี demographic data — OA อาจมี friend ที่ consent ต่ำกว่า 20 คน",
  );

  if (r.notes.length) {
    lines.push("");
    lines.push("## Notes");
    for (const n of r.notes) lines.push(`- ${n}`);
  }

  return lines.join("\n");
}

function errorReply(err: unknown): { content: { type: "text"; text: string }[]; isError: true } {
  if (err instanceof LineApiError) {
    return { isError: true, content: [{ type: "text", text: err.message }] };
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
