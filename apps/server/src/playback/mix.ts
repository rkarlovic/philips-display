/**
 * Step 5 of the resolver: insert mix-in announcements into a display's loop.
 *
 * - `everyN` set: the announcement's items go after every N items of the loop
 *   (and once at the end if the loop has fewer than N items).
 * - `everyN` null: once per loop, after the last item.
 * - Several mix-ins at the same point keep their given order (oldest start first).
 * - An empty loop (nothing of its own) plays just the mix-ins.
 */
export interface MixIn<T> {
  items: T[];
  everyN: number | null;
}

export function mixInto<T>(base: T[], mixes: MixIn<T>[]): T[] {
  const active = mixes.filter((m) => m.items.length > 0);
  if (active.length === 0) return base;
  if (base.length === 0) return active.flatMap((m) => m.items);

  const out: T[] = [];
  base.forEach((item, i) => {
    out.push(item);
    for (const m of active) {
      if (m.everyN != null && m.everyN <= base.length && (i + 1) % m.everyN === 0) {
        out.push(...m.items);
      }
    }
  });
  for (const m of active) {
    if (m.everyN == null || m.everyN > base.length) out.push(...m.items);
  }
  return out;
}
