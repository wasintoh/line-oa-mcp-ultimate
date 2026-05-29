/**
 * Bangkok quiet-hours helper.
 *
 * Thai customers strongly dislike LINE OAs that push during the night.
 * We surface a warning whenever a send is requested between 22:00 and 08:00
 * BKK time, and let the caller override with `force: true`.
 */

import {
  BKK_TIMEZONE_OFFSET_MIN,
  QUIET_HOURS_END_HOUR_BKK,
  QUIET_HOURS_START_HOUR_BKK,
} from "../constants.js";
import { TH } from "../i18n/th.js";

export function isQuietHoursBkk(now: Date = new Date()): boolean {
  const hour = bkkHour(now);
  // 22, 23, 0..7 are quiet
  return hour >= QUIET_HOURS_START_HOUR_BKK || hour < QUIET_HOURS_END_HOUR_BKK;
}

export function bkkHour(now: Date = new Date()): number {
  const bkkMs = now.getTime() + BKK_TIMEZONE_OFFSET_MIN * 60_000;
  return new Date(bkkMs).getUTCHours();
}

export interface QuietHoursCheckOutput {
  is_quiet: boolean;
  warning?: string;
}

export function quietHoursCheck(force: boolean, now: Date = new Date()): QuietHoursCheckOutput {
  if (!isQuietHoursBkk(now) || force) {
    return { is_quiet: false };
  }
  return { is_quiet: true, warning: TH.quietHoursWarning(bkkHour(now)) };
}
