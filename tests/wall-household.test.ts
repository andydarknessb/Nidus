import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Household, householdViewAfter as householdViewAfterFn } from '../src/lib/household';

const home: Household = {
  id: 'h1',
  name: 'Home',
  timezone: 'America/Chicago',
  weather_place: null,
  latitude: null,
  longitude: null,
  temperature_unit: 'fahrenheit',
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
});
