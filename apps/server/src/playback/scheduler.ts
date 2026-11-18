/**
 * Wakes up at the next schedule boundary (any display) and pushes `manifest_changed`
 * only to the displays whose schedules crossed a boundary since the last run.
 *
 * - The clock is injected; `runDue()` can be called directly in tests.
 * - Sleeps at most an hour, so clock jumps (sleep, NTP, DST) are caught quickly.
 * - Call `reschedule()` after any schedule edit.
 */
import type { Db } from '../db/index.js';
import { listAllSchedules, type ScheduleRecord } from '../db/repos/schedules.js';
import type { Hub } from '../ws/hub.js';
import { nextBoundary } from './schedule.js';

const MAX_SLEEP_MS = 60 * 60_000;
/** Fire slightly after the boundary so `now` is safely past it. */
const MARGIN_MS = 250;

export class Scheduler {
  private timer: NodeJS.Timeout | undefined;
  private lastRun: number;
  private stopped = false;

  constructor(private readonly opts: { db: Db; hub: Hub; timezone: string; now: () => Date }) {
    this.lastRun = opts.now().getTime();
  }

  start(): void {
    this.stopped = false;
    this.reschedule();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  /** Re-arms the timer for the next boundary. */
  reschedule(): void {
    clearTimeout(this.timer);
    if (this.stopped) return;
    const now = this.opts.now().getTime();
    const next = nextBoundary(listAllSchedules(this.opts.db), now, this.opts.timezone);
    const delay = next == null ? MAX_SLEEP_MS : Math.min(MAX_SLEEP_MS, Math.max(0, next - now));
    this.timer = setTimeout(() => {
      this.runDue();
      this.reschedule();
    }, delay + MARGIN_MS);
    this.timer.unref();
  }

  /**
   * Pushes to every display with a schedule boundary in (lastRun, now].
   * Returns the affected display ids.
   */
  runDue(): number[] {
    const now = this.opts.now().getTime();
    const from = this.lastRun;
    this.lastRun = now;
    if (now <= from) return [];

    const byDisplay = new Map<number, ScheduleRecord[]>();
    for (const s of listAllSchedules(this.opts.db)) {
      const list = byDisplay.get(s.displayId) ?? [];
      list.push(s);
      byDisplay.set(s.displayId, list);
    }
    const affected: number[] = [];
    for (const [displayId, rules] of byDisplay) {
      const b = nextBoundary(rules, from, this.opts.timezone);
      if (b != null && b <= now) affected.push(displayId);
    }
    if (affected.length > 0) {
      this.opts.hub.manifestChanged(affected);
      for (const id of affected) this.opts.hub.broadcastDisplay(id);
    }
    return affected;
  }
}
