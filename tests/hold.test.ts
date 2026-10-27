import { describe, expect, it } from 'vitest';
import { HOME_HOLD_MS, holdEndsAt, isHeld, type Holds } from '../src/lib/hold';

// The hold (src/lib/hold.ts) through its interface: four seconds, whether an id is held at a time, and when the first hold ends. The two
// cards that use it keep their other conditions (still ticked, still crossed off) in their own tests.

const t0 = 1_000_000;
const tapped = (entries: Record<string, number>): Holds => new Map(Object.entries(entries));

it('holds for four seconds', () => {
  expect(HOME_HOLD_MS).toBe(4_000);
});

describe('isHeld', () => {
  it('holds an id from the moment it was tapped to the last millisecond before the four seconds are up', () => {
    for (const later of [0, 1, 1_500, HOME_HOLD_MS - 1]) {
      expect(isHeld(tapped({ a: t0 }), 'a', t0 + later), `${later} ms later`).toBe(true);
    }
  });

  it('lets it go at four seconds, however long ago it was tapped', () => {
    for (const later of [HOME_HOLD_MS, HOME_HOLD_MS + 1, 60_000]) {
      expect(isHeld(tapped({ a: t0 }), 'a', t0 + later), `${later} ms later`).toBe(false);
    }
  });

  it('holds a tap later than now, so a tap does not have to move the clock', () => {
    expect(isHeld(tapped({ a: t0 + 1 }), 'a', t0)).toBe(true);
    expect(isHeld(tapped({ a: t0 + 60_000 }), 'a', t0)).toBe(true);
  });

  it('holds only what was tapped, each id for its own four seconds', () => {
    const holds = tapped({ a: t0, b: t0 + 2_000 });
    expect(isHeld(holds, 'c', t0)).toBe(false);
    expect(isHeld(holds, 'a', t0 + 3_000)).toBe(true);
    expect(isHeld(holds, 'b', t0 + 3_000)).toBe(true);
    expect(isHeld(holds, 'a', t0 + 4_500)).toBe(false);
    expect(isHeld(holds, 'b', t0 + 4_500)).toBe(true);
  });

  it('never changes the holds it is given', () => {
    const holds = tapped({ a: t0 });
    isHeld(holds, 'a', t0 + 10);
    expect([...holds]).toEqual([['a', t0]]);
  });
});

describe('when a hold ends', () => {
  it('is when the earliest of the holds ends', () => {
    expect(holdEndsAt(tapped({ a: t0, b: t0 + 1_000 }), t0 + 10)).toBe(t0 + HOME_HOLD_MS);
    expect(holdEndsAt(tapped({ a: t0 + 500 }), t0)).toBe(t0 + 500 + HOME_HOLD_MS);
  });

  it('leaves out the holds that have ended, and is nothing when none is left', () => {
    expect(holdEndsAt(tapped({ a: t0, b: t0 + 3_000 }), t0 + HOME_HOLD_MS)).toBe(t0 + 3_000 + HOME_HOLD_MS);
    expect(holdEndsAt(tapped({ a: t0 }), t0 + HOME_HOLD_MS)).toBeNull();
    expect(holdEndsAt(tapped({}), t0)).toBeNull();
  });
});
