/**
 * Quota Guardian — pre-flight quota check that runs before every send.
 *
 * Thai SMBs care a lot about LINE plan quota because the standard plan charges
 * per message above the included allotment. We refuse sends that would consume
 * more than QUOTA_WARN_THRESHOLD of remaining quota unless the caller passes
 * `confirm: true`.
 */

import { QUOTA_WARN_THRESHOLD } from "../constants.js";
import { TH } from "../i18n/th.js";
import type { LineClient } from "./client.js";
import type { QuotaSnapshot } from "../types.js";

export interface QuotaGuardInput {
  client: LineClient;
  projectedMessages: number;
  confirm: boolean;
}

export interface QuotaGuardOk {
  ok: true;
  snapshot: QuotaSnapshot;
  warnings: string[];
}

export interface QuotaGuardBlock {
  ok: false;
  reason: "needs_confirmation" | "over_quota";
  snapshot: QuotaSnapshot;
  message: string;
}

export type QuotaGuardResult = QuotaGuardOk | QuotaGuardBlock;

export async function checkQuota(input: QuotaGuardInput): Promise<QuotaGuardResult> {
  const snapshot = await snapshotQuota(input.client);
  const warnings: string[] = [];

  if (snapshot.total === "unlimited") {
    return { ok: true, snapshot, warnings };
  }

  const remaining = typeof snapshot.remaining === "number" ? snapshot.remaining : 0;
  const projected = Math.max(0, input.projectedMessages);

  // Hard block — projected > remaining quota
  if (projected > remaining) {
    return {
      ok: false,
      reason: "over_quota",
      snapshot,
      message: TH.quotaExceeded(projected, remaining),
    };
  }

  // Soft block — projected uses more than warn threshold (default 95%)
  const projectedShare = remaining > 0 ? projected / remaining : 1;
  if (projectedShare > QUOTA_WARN_THRESHOLD && !input.confirm) {
    return {
      ok: false,
      reason: "needs_confirmation",
      snapshot,
      message: TH.quotaWarning(projected, remaining, Math.round(projectedShare * 100)),
    };
  }

  if (projectedShare > 0.5) {
    warnings.push(
      `🟡 ใช้ ${Math.round(projectedShare * 100)}% ของ quota ที่เหลือ — ระวังจนถึงสิ้นเดือน`,
    );
  }

  return { ok: true, snapshot, warnings };
}

export async function snapshotQuota(client: LineClient): Promise<QuotaSnapshot> {
  const [quota, consumption] = await Promise.all([
    client.getQuota(),
    client.getConsumption(),
  ]);

  if (quota.type !== "limited" || quota.value === undefined) {
    return {
      used: consumption.totalUsage,
      total: "unlimited",
      remaining: "unlimited",
      percentage_used: 0,
    };
  }
  const total = quota.value;
  const used = consumption.totalUsage;
  const remaining = Math.max(0, total - used);
  return {
    used,
    total,
    remaining,
    percentage_used: total > 0 ? Math.round((used / total) * 1000) / 10 : 0,
  };
}
