/** Pure schedule/time logic. Europe/Zagreb: DST 2026-03-29 02:00→03:00, 2026-10-25 03:00→02:00. */
import { describe, expect, it } from 'vitest';
import {
  activeRule,
  activeUntil,
  isActive,
  nextBoundary,
  windowOn,
  type ScheduleRule,
} from '../../src/playback/schedule.js';
import { isoWeekday, localDate, localMinutes, zonedInstant } from '../../src/playback/time.js';

const TZ = 'Europe/Zagreb';
const at = (iso: string) => Date.parse(iso);
const H = 3600_000;
const ALL = [1, 2, 3, 4, 5, 6, 7];

let ids = 0;
const rule = (over: Partial<ScheduleRule>): ScheduleRule => ({
  id: ++ids,
  weekdays: ALL,
  startTime: '08:00',
  endTime: '16:00',
  dateFrom: null,
  dateTo: null,
  priority: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

describe('time helpers', () => {
  it('converts wall time to instants in winter and summer', () => {
    expect(new Date(zonedInstant('2026-01-15', 8 * 60, TZ)).toISOString()).toBe(
      '2026-01-15T07:00:00.000Z',
    );
    expect(new Date(zonedInstant('2026-07-15', 8 * 60, TZ)).toISOString()).toBe(
      '2026-07-15T06:00:00.000Z',
    );
  });

  it('maps a skipped spring-forward time to just after the gap', () => {
    // 02:30 does not exist on 2026-03-29; it becomes 03:30 CEST (01:30Z).
    expect(new Date(zonedInstant('2026-03-29', 150, TZ)).toISOString()).toBe(
      '2026-03-29T01:30:00.000Z',
    );
  });

  it('resolves a repeated autumn time to the later occurrence', () => {
    // 02:30 happens twice on 2026-10-25: 00:30Z (CEST) and 01:30Z (CET).
    expect(new Date(zonedInstant('2026-10-25', 150, TZ)).toISOString()).toBe(
      '2026-10-25T01:30:00.000Z',
    );
  });

  it('local date/minutes/weekday', () => {
    const t = at('2026-03-01T23:30:00Z'); // Monday 00:30 local
    expect(localDate(t, TZ)).toBe('2026-03-02');
    expect(localMinutes(t, TZ)).toBe(30);
    expect(isoWeekday('2026-03-02')).toBe(1);
    expect(isoWeekday('2026-03-08')).toBe(7);
  });
});

describe('isActive', () => {
  const weekdays = rule({ weekdays: [1, 2, 3, 4, 5] }); // Mon–Fri 08–16

  it('respects the window and weekdays', () => {
    expect(isActive(weekdays, at('2026-03-02T07:00:00Z'), TZ)).toBe(true); // Mon 08:00 — start is inclusive
    expect(isActive(weekdays, at('2026-03-02T14:59:59Z'), TZ)).toBe(true); // Mon 15:59:59
    expect(isActive(weekdays, at('2026-03-02T15:00:00Z'), TZ)).toBe(false); // Mon 16:00 — end is exclusive
    expect(isActive(weekdays, at('2026-03-07T09:00:00Z'), TZ)).toBe(false); // Saturday
  });

  it('respects the date range (inclusive)', () => {
    const exams = rule({ dateFrom: '2026-06-01', dateTo: '2026-06-30' });
    expect(isActive(exams, at('2026-05-31T08:00:00Z'), TZ)).toBe(false);
    expect(isActive(exams, at('2026-06-01T08:00:00Z'), TZ)).toBe(true);
    expect(isActive(exams, at('2026-06-30T08:00:00Z'), TZ)).toBe(true);
    expect(isActive(exams, at('2026-07-01T08:00:00Z'), TZ)).toBe(false);
  });

  it('crosses midnight; weekday is the day the window starts', () => {
    const friNight = rule({ weekdays: [5], startTime: '22:00', endTime: '02:00' });
    expect(isActive(friNight, at('2026-03-06T21:30:00Z'), TZ)).toBe(true); // Fri 22:30
    expect(isActive(friNight, at('2026-03-07T00:30:00Z'), TZ)).toBe(true); // Sat 01:30
    expect(isActive(friNight, at('2026-03-07T01:30:00Z'), TZ)).toBe(false); // Sat 02:30
    expect(isActive(friNight, at('2026-03-07T21:30:00Z'), TZ)).toBe(false); // Sat 22:30
    expect(isActive(friNight, at('2026-03-05T23:30:00Z'), TZ)).toBe(false); // Fri 00:30 (Thu night)
  });

  it('dateTo applies to the start day of an overnight window', () => {
    const r = rule({ startTime: '22:00', endTime: '02:00', dateTo: '2026-03-06' });
    expect(isActive(r, at('2026-03-07T00:30:00Z'), TZ)).toBe(true); // started on the 6th
    expect(isActive(r, at('2026-03-07T21:30:00Z'), TZ)).toBe(false);
  });

  it('00:00–00:00 is the whole day', () => {
    const allDay = rule({ weekdays: [1], startTime: '00:00', endTime: '00:00' });
    expect(isActive(allDay, at('2026-03-01T23:00:00Z'), TZ)).toBe(true); // Mon 00:00
    expect(isActive(allDay, at('2026-03-02T22:59:00Z'), TZ)).toBe(true); // Mon 23:59
    expect(isActive(allDay, at('2026-03-02T23:00:00Z'), TZ)).toBe(false); // Tue 00:00
  });
});

describe('DST', () => {
  it('a window over the spring-forward jump is one hour shorter', () => {
    const night = rule({ startTime: '01:00', endTime: '04:00' });
    const w = windowOn(night, '2026-03-29', TZ)!;
    expect((w.end - w.start) / H).toBe(2);
    expect(isActive(night, at('2026-03-29T00:59:00Z'), TZ)).toBe(true); // 01:59 CET
    expect(isActive(night, at('2026-03-29T01:00:00Z'), TZ)).toBe(true); // 03:00 CEST
    expect(isActive(night, at('2026-03-29T02:00:00Z'), TZ)).toBe(false); // 04:00 CEST
  });

  it('a window over the fall-back jump is one hour longer', () => {
    const night = rule({ startTime: '01:00', endTime: '04:00' });
    const w = windowOn(night, '2026-10-25', TZ)!;
    expect((w.end - w.start) / H).toBe(4);
    expect(isActive(night, at('2026-10-25T02:30:00Z'), TZ)).toBe(true); // 03:30 CET
    expect(isActive(night, at('2026-10-25T03:00:00Z'), TZ)).toBe(false); // 04:00 CET
  });

  it('a daytime schedule keeps its local hours across the change', () => {
    const r = rule({});
    expect(new Date(windowOn(r, '2026-03-28', TZ)!.start).toISOString()).toBe(
      '2026-03-28T07:00:00.000Z',
    );
    expect(new Date(windowOn(r, '2026-03-30', TZ)!.start).toISOString()).toBe(
      '2026-03-30T06:00:00.000Z',
    );
  });

  it('the whole-day window on DST days is 23 h and 25 h', () => {
    const allDay = rule({ startTime: '00:00', endTime: '00:00' });
    const spring = windowOn(allDay, '2026-03-29', TZ)!;
    const autumn = windowOn(allDay, '2026-10-25', TZ)!;
    expect((spring.end - spring.start) / H).toBe(23);
    expect((autumn.end - autumn.start) / H).toBe(25);
  });
});

describe('activeRule', () => {
  const t = at('2026-03-02T09:00:00Z');

  it('highest priority wins', () => {
    const low = rule({ priority: 0 });
    const high = rule({ priority: 5 });
    expect(activeRule([low, high], t, TZ)).toBe(high);
    expect(activeRule([high, low], t, TZ)).toBe(high);
  });

  it('ties → the most recently created', () => {
    const older = rule({ createdAt: '2026-01-01T00:00:00.000Z' });
    const newer = rule({ createdAt: '2026-02-01T00:00:00.000Z' });
    expect(activeRule([newer, older], t, TZ)).toBe(newer);
  });

  it('ignores inactive rules, and returns undefined when none is active', () => {
    const inactive = rule({ priority: 99, weekdays: [6, 7] });
    const active = rule({ priority: 0 });
    expect(activeRule([inactive, active], t, TZ)).toBe(active);
    expect(activeRule([inactive], t, TZ)).toBeUndefined();
    expect(activeRule([], t, TZ)).toBeUndefined();
  });
});

describe('nextBoundary / activeUntil', () => {
  it('finds the next start or end', () => {
    const r = rule({ weekdays: [1, 2, 3, 4, 5] });
    const before = at('2026-03-02T05:00:00Z'); // Mon 06:00
    expect(new Date(nextBoundary([r], before, TZ)!).toISOString()).toBe('2026-03-02T07:00:00.000Z');
    const during = at('2026-03-02T09:00:00Z');
    expect(new Date(nextBoundary([r], during, TZ)!).toISOString()).toBe('2026-03-02T15:00:00.000Z');
    expect(new Date(activeUntil(r, during, TZ)!).toISOString()).toBe('2026-03-02T15:00:00.000Z');
    const friEvening = at('2026-03-06T17:00:00Z'); // next is Monday 08:00
    expect(new Date(nextBoundary([r], friEvening, TZ)!).toISOString()).toBe(
      '2026-03-09T07:00:00.000Z',
    );
  });

  it('picks the earliest across rules, and null when there is nothing ahead', () => {
    const a = rule({ startTime: '12:00', endTime: '13:00' });
    const b = rule({ startTime: '10:00', endTime: '11:00' });
    expect(new Date(nextBoundary([a, b], at('2026-03-02T07:00:00Z'), TZ)!).toISOString()).toBe(
      '2026-03-02T09:00:00.000Z',
    );
    const past = rule({ dateTo: '2026-01-01' });
    expect(nextBoundary([past], at('2026-03-02T07:00:00Z'), TZ)).toBeNull();
    expect(nextBoundary([], at('2026-03-02T07:00:00Z'), TZ)).toBeNull();
  });
});
