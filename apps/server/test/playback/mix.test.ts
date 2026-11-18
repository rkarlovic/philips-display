import { describe, expect, it } from 'vitest';
import { mixInto } from '../../src/playback/mix.js';

const base = ['a1', 'a2', 'a3', 'a4', 'a5'];

describe('mixInto', () => {
  it('no mix-ins: unchanged', () => {
    expect(mixInto(base, [])).toEqual(base);
    expect(mixInto(base, [{ items: [], everyN: 2 }])).toEqual(base);
  });

  it('once per loop (everyN null): appended after the last item', () => {
    expect(mixInto(base, [{ items: ['U'], everyN: null }])).toEqual([...base, 'U']);
  });

  it('every N items', () => {
    expect(mixInto(base, [{ items: ['U'], everyN: 2 }])).toEqual([
      'a1',
      'a2',
      'U',
      'a3',
      'a4',
      'U',
      'a5',
    ]);
    expect(mixInto(base, [{ items: ['U1', 'U2'], everyN: 5 }])).toEqual([...base, 'U1', 'U2']);
  });

  it('every N larger than the loop: once per loop', () => {
    expect(mixInto(['a1', 'a2'], [{ items: ['U'], everyN: 10 }])).toEqual(['a1', 'a2', 'U']);
  });

  it('several mix-ins keep their order at the same point', () => {
    expect(
      mixInto(
        ['a1', 'a2'],
        [
          { items: ['X'], everyN: 1 },
          { items: ['Y'], everyN: null },
        ],
      ),
    ).toEqual(['a1', 'X', 'a2', 'X', 'Y']);
  });

  it('nothing of its own: just the mix-ins', () => {
    expect(
      mixInto(
        [],
        [
          { items: ['U'], everyN: 3 },
          { items: ['V'], everyN: null },
        ],
      ),
    ).toEqual(['U', 'V']);
  });
});
