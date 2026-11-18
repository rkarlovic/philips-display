/**
 * Wall-clock ↔ instant conversion for one IANA time zone, DST-safe, no dependencies.
 * Everything here is pure: callers pass the instant (from an injected clock).
 *
 * Local dates are 'YYYY-MM-DD' strings; times of day are minutes after local midnight.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
}

interface Wall {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

function wall(t: number, tz: string): Wall {
  const out: Record<string, number> = {};
  for (const p of formatter(tz).formatToParts(new Date(t))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return {
    y: out['year']!,
    m: out['month']!,
    d: out['day']!,
    h: out['hour']! % 24,
    mi: out['minute']!,
    s: out['second']!,
  };
}

/** UTC offset (ms) of the zone at instant t. */
function offsetAt(t: number, tz: string): number {
  const w = wall(t, tz);
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s) - Math.floor(t / 1000) * 1000;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar date at instant t. */
export function localDate(t: number, tz: string): string {
  const w = wall(t, tz);
  return `${w.y}-${pad(w.m)}-${pad(w.d)}`;
}

/** Minutes after local midnight at instant t. */
export function localMinutes(t: number, tz: string): number {
  const w = wall(t, tz);
  return w.h * 60 + w.mi;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** ISO weekday of a local date: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return js === 0 ? 7 : js;
}

/**
 * The instant at which the local wall clock in `tz` shows `date` + `minutes`.
 * - Times skipped by a spring-forward jump map forward by the gap (02:30 → 03:30).
 * - Times that occur twice in autumn resolve to the later occurrence.
 * `minutes` may be ≥ 1440 (rolls into following days).
 */
export function zonedInstant(date: string, minutes: number, tz: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const local = Date.UTC(y, m - 1, d) + minutes * 60_000;
  const t1 = local - offsetAt(local, tz);
  const o1 = offsetAt(t1, tz);
  if (local - o1 === t1) return t1;
  const t2 = local - o1;
  if (offsetAt(t2, tz) === o1) return t2;
  return Math.max(t1, t2); // in the gap: the first valid instant after it
}

export function parseTime(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

/** Throws on an unknown IANA zone (used to validate config at startup). */
export function assertTimeZone(tz: string): void {
  formatter(tz);
}

/** '2026-03-02T08:00' (local wall time in tz) → UTC ISO instant. */
export function localDateTimeToIso(local: string, tz: string): string {
  const [date, time] = local.split('T') as [string, string];
  return new Date(zonedInstant(date, parseTime(time), tz)).toISOString();
}

/** UTC ISO instant → '2026-03-02T08:00' local wall time in tz. */
export function isoToLocalDateTime(iso: string, tz: string): string {
  const t = Date.parse(iso);
  const m = localMinutes(t, tz);
  return `${localDate(t, tz)}T${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}
