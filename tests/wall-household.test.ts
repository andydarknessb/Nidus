import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Household, HouseholdView, householdViewAfter as householdViewAfterFn } from '../src/lib/household';

const home: Household = {
  id: 'h1',
  name: 'Home',
  timezone: 'America/Chicago',
  weather_place: null,
  latitude: null,
  longitude: null,
  temperature_unit: 'fahrenheit',
  appearance: 'auto',
};

// household.ts builds the Supabase client on import; the pure decision under test
// never calls it, so a placeholder URL and key are enough to load the module.
let householdViewAfter: typeof householdViewAfterFn;
beforeAll(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', process.env.VITE_SUPABASE_ANON_KEY ?? 'placeholder-anon-key');
  ({ householdViewAfter } = await import('../src/lib/household'));
});

describe('householdViewAfter', () => {
  it('flags a failed read when no Household has been read yet', () => {
    expect(householdViewAfter({ household: null, failed: false }, { failed: true })).toEqual({
      household: null,
      failed: true,
    });
  });

  it('replaces the failure with the Household once a read succeeds', () => {
    const failedFirst = householdViewAfter({ household: null, failed: false }, { failed: true });
    expect(householdViewAfter(failedFirst, { household: home })).toEqual({ household: home, failed: false });
  });

  it('keeps the last good Household when a later read fails', () => {
    const view = householdViewAfter({ household: home, failed: false }, { failed: true });
    expect(view.household).toEqual(home);
  });

  it('takes a changed Household Timezone from a re-read', () => {
    const view = householdViewAfter({ household: home, failed: false }, { household: { ...home, timezone: 'Europe/London' } });
    expect(view.household?.timezone).toBe('Europe/London');
    expect(view.failed).toBe(false);
  });

  // The Wall reads its Household every 30 seconds. A new view object is a new render of the whole Wall under it, so a read that finds
  // nothing new gives back the view it was given.
  describe('a read that finds nothing new', () => {
    const view: HouseholdView = { household: home, failed: false };

    it('gives back the very view the Wall has, however often it is read', () => {
      expect(householdViewAfter(view, { household: { ...home } })).toBe(view);
      let held = view;
      for (let read = 0; read < 5; read += 1) held = householdViewAfter(held, { household: { ...home } });
      expect(held).toBe(view);
    });

    it('is a new view with the new Household when any one field changed', () => {
      const changes: Partial<Household>[] = [
        { id: 'h2' },
        { name: 'Away' },
        { timezone: 'Europe/London' },
        { weather_place: 'Austin, Texas' },
        { latitude: 30.27 },
        { longitude: -97.74 },
        { temperature_unit: 'celsius' },
        { appearance: 'dark' },
      ];
      expect(changes).toHaveLength(Object.keys(home).length);
      for (const change of changes) {
        const read = { ...home, ...change };
        const next = householdViewAfter(view, { household: read });
        expect(next, JSON.stringify(change)).not.toBe(view);
        expect(next.household, JSON.stringify(change)).toBe(read);
        expect(next.failed).toBe(false);
      }
    });

    it('keeps the Household it has, and not only the view, when the read that follows a failure is the same', () => {
      const failing = householdViewAfter(view, { failed: true });
      expect(failing).toEqual({ household: home, failed: true });
      const recovered = householdViewAfter(failing, { household: { ...home } });
      expect(recovered).toEqual({ household: home, failed: false });
      expect(recovered.household).toBe(home);
    });

    it('gives back the view when a read fails again, so a Wall that stays offline is not drawn again every few seconds', () => {
      const failing = householdViewAfter(view, { failed: true });
      expect(failing).not.toBe(view);
      expect(householdViewAfter(failing, { failed: true })).toBe(failing);
      const never = householdViewAfter({ household: null, failed: false }, { failed: true });
      expect(householdViewAfter(never, { failed: true })).toBe(never);
    });
  });
});
