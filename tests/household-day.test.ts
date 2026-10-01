import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { msUntilHouseholdMidnight, watchHouseholdDay } from '../src/lib/household-day';
import type { HouseholdDay } from '../src/lib/routines';

// Household midnight, with the clock faked: nothing here waits for a real one.
const CHICAGO = 'America/Chicago';

// Wall-clock instants in Chicago (CDT, UTC-5, in September and October 2026).
const at = (iso: string) => new Date(`${iso}-05:00`);

describe('msUntilHouseholdMidnight', () => {
  it('counts to the end of the Household day, not the machine\'s', () => {
    expect(msUntilHouseholdMidnight(CHICAGO, at('2026-09-30T23:59:50'))).toBe(10_000);
    expect(msUntilHouseholdMidnight(CHICAGO, at('2026-09-30T00:00:00'))).toBe(24 * 3600_000);
    // 06:00 in Chicago is already 00:00 the next day in Auckland (UTC+13): the zone decides.
    expect(msUntilHouseholdMidnight('Pacific/Auckland', at('2026-09-30T06:00:00'))).toBe(24 * 3600_000);
  });

  it('is short on the 23 hour day when clocks go forward and long on the 25 hour day', () => {
    // US clocks go forward on 2027-03-14 and back on 2026-11-01.
    const springStart = new Date('2027-03-14T06:00:00Z'); // 00:00 CST
    expect(msUntilHouseholdMidnight(CHICAGO, springStart)).toBe(23 * 3600_000);
    const fallStart = new Date('2026-11-01T05:00:00Z'); // 00:00 CDT
    expect(msUntilHouseholdMidnight(CHICAGO, fallStart)).toBe(25 * 3600_000);
  });
});

describe('watchHouseholdDay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('announces the new day when Household midnight passes, and only then', () => {
    vi.setSystemTime(at('2026-09-30T23:59:50'));
    const days: HouseholdDay[] = [];
    const stop = watchHouseholdDay(CHICAGO, (day) => days.push(day));

    vi.advanceTimersByTime(9_000);
    expect(days).toEqual([]);
    vi.advanceTimersByTime(1_500);
    expect(days).toEqual([{ date: '2026-10-01', weekday: 4 }]);

    // A whole day later, the next one; nothing in between.
    vi.advanceTimersByTime(23 * 3600_000);
    expect(days).toHaveLength(1);
    vi.advanceTimersByTime(3600_000);
    expect(days.map((day) => day.date)).toEqual(['2026-10-01', '2026-10-02']);
    stop();
  });

  it('notices a clock that jumped past midnight while the tablet slept', () => {
    vi.setSystemTime(at('2026-09-30T22:00:00'));
    const days: HouseholdDay[] = [];
    watchHouseholdDay(CHICAGO, (day) => days.push(day));

    // The machine slept for five hours: timers did not run, then the clock is simply later.
    vi.setSystemTime(at('2026-10-01T03:00:00'));
    vi.advanceTimersByTime(60_000);
    expect(days.map((day) => day.date)).toEqual(['2026-10-01']);
  });

  it('follows a changed Household Timezone from the new zone\'s midnight', () => {
    vi.setSystemTime(new Date('2026-10-01T04:59:50Z')); // 23:59:50 on Sep 30 in Chicago
    const days: string[] = [];
    const stop = watchHouseholdDay('Asia/Tokyo', (day) => days.push(day.date)); // already Oct 1 in Tokyo
    vi.advanceTimersByTime(30_000);
    expect(days).toEqual([]);
    stop();

    const chicago: string[] = [];
    watchHouseholdDay(CHICAGO, (day) => chicago.push(day.date));
    vi.advanceTimersByTime(11_000);
    expect(chicago).toEqual(['2026-10-01']);
  });

  it('stops when told to', () => {
    vi.setSystemTime(at('2026-09-30T23:59:50'));
    const days: HouseholdDay[] = [];
    const stop = watchHouseholdDay(CHICAGO, (day) => days.push(day));
    stop();
    vi.advanceTimersByTime(3600_000);
    expect(days).toEqual([]);
  });
});
