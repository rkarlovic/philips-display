/**
 * Schedule rules (CLAUDE.md §7, step 2). Pure functions with an injected instant.
 *
 * A schedule is active on each listed weekday from `startTime` to `endTime` (local time in
 * the configured zone), optionally only between `dateFrom` and `dateTo`.
 * - `endTime` ≤ `startTime` means the window crosses midnight and ends the next day
 *   (22:00–02:00). Weekdays and dates refer to the day the window STARTS.
 * - `startTime` = `endTime` means a full 24 hours (00:00–00:00 = the whole day).
 * - Windows are computed as real instants, so DST days are naturally shorter/longer.
 * - Several active: highest `priority` wins; ties → the most recently created.
 */
import { addDays, isoWeekday, localDate, parseTime, zonedInstant } from './time.js';

export interface ScheduleRule {
  id: number;
  /** ISO weekdays 1 (Mon) … 7 (Sun). */
  weekdays: number[];
  startTime: string;
  endTime: string;
  dateFrom: string | null;
  dateTo: string | null;
  priority: number;
  /** For tie-breaking: later wins. */
  createdAt: string;
}

interface Window {
  start: number;
  end: number;
}

/** The window of `rule` that starts on local `date`, if the rule runs that day. */
export function windowOn(rule: ScheduleRule, date: string, tz: string): Window | null {
  if (!rule.weekdays.includes(isoWeekday(date))) return null;
  if (rule.dateFrom && date < rule.dateFrom) return null;
  if (rule.dateTo && date > rule.dateTo) return null;
  const s = parseTime(rule.startTime);
  const e = parseTime(rule.endTime);
  const start = zonedInstant(date, s, tz);
  const end = zonedInstant(date, e > s ? e : e + 24 * 60, tz);
  return { start, end };
}

export function isActive(rule: ScheduleRule, t: number, tz: string): boolean {
  const today = localDate(t, tz);
  // A window that started yesterday may still be running (crosses midnight).
  for (const date of [today, addDays(today, -1)]) {
    const w = windowOn(rule, date, tz);
    if (w && w.start <= t && t < w.end) return true;
  }
  return false;
}

/** The winning active rule at instant t, or undefined. */
export function activeRule<R extends ScheduleRule>(
  rules: R[],
  t: number,
  tz: string,
): R | undefined {
  let best: R | undefined;
  for (const r of rules) {
    if (!isActive(r, t, tz)) continue;
    if (
      !best ||
      r.priority > best.priority ||
      (r.priority === best.priority &&
        (r.createdAt > best.createdAt || (r.createdAt === best.createdAt && r.id > best.id)))
    ) {
      best = r;
    }
  }
  return best;
}

/** How far ahead boundaries are searched; the scheduler re-checks at least hourly anyway. */
const HORIZON_DAYS = 8;

/** The next instant after t at which any rule starts or ends (when the result may change). */
export function nextBoundary(rules: ScheduleRule[], t: number, tz: string): number | null {
  const today = localDate(t, tz);
  let next: number | null = null;
  for (const r of rules) {
    for (let i = -1; i <= HORIZON_DAYS; i++) {
      const w = windowOn(r, addDays(today, i), tz);
      if (!w) continue;
      for (const b of [w.start, w.end]) {
        if (b > t && (next === null || b < next)) next = b;
      }
    }
  }
  return next;
}

/** When the currently active rule stops being active (ignoring other rules). */
export function activeUntil(rule: ScheduleRule, t: number, tz: string): number | null {
  const today = localDate(t, tz);
  for (const date of [today, addDays(today, -1)]) {
    const w = windowOn(rule, date, tz);
    if (w && w.start <= t && t < w.end) return w.end;
  }
  return null;
}
