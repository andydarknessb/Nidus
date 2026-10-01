import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatClock, formatDate } from '../src/lib/calendar-occurrences';
import { msUntilHouseholdMidnight, watchHouseholdDay, watchMinute } from '../src/lib/household-day';
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

  it('rolls over at the Household Timezone\'s midnight, whatever the machine\'s zone says', () => {
    vi.setSystemTime(new Date('2026-09-30T14:59:50Z')); // 23:59:50 in Tokyo, 09:59:50 in Chicago
    const tokyo: string[] = [];
    const chicago: string[] = [];
    watchHouseholdDay('Asia/Tokyo', (day) => tokyo.push(day.date));
    watchHouseholdDay(CHICAGO, (day) => chicago.push(day.date));
    vi.advanceTimersByTime(30_000);
    expect(tokyo).toEqual(['2026-10-01']);
    expect(chicago).toEqual([]);
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

describe('watchMinute', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // The fake clock's time of day, to the millisecond.
  const clock = () => new Date().toISOString().slice(11, 23);

  it('calls back at the start of each minute, wherever in a minute it was started', () => {
    vi.setSystemTime(new Date('2026-09-30T20:42:30.250Z'));
    const minutes: string[] = [];
    const stop = watchMinute(() => minutes.push(clock()));

    // Not every 30 seconds from the start: nothing until the minute turns.
    vi.advanceTimersByTime(29_749);
    expect(minutes).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(minutes).toEqual(['20:43:00.000']);
    vi.advanceTimersByTime(120_000);
    expect(minutes).toEqual(['20:43:00.000', '20:44:00.000', '20:45:00.000']);
    stop();
  });

  it('lands on the minute again after the clock was corrected', () => {
    vi.setSystemTime(new Date('2026-09-30T20:42:30.000Z'));
    const minutes: string[] = [];
    const stop = watchMinute(() => minutes.push(clock()));

    // The clock moves 20 seconds on; timers keep their own pace, so this one is late, but the next is not.
    vi.setSystemTime(new Date('2026-09-30T20:42:50.000Z'));
    vi.advanceTimersByTime(30_000);
    expect(minutes).toEqual(['20:43:20.000']);
    vi.advanceTimersByTime(40_000);
    expect(minutes).toEqual(['20:43:20.000', '20:44:00.000']);
    stop();
  });

  it('stops when told to', () => {
    vi.setSystemTime(new Date('2026-09-30T20:42:30.000Z'));
    const minutes: string[] = [];
    const stop = watchMinute(() => minutes.push(clock()));
    stop();
    vi.advanceTimersByTime(300_000);
    expect(minutes).toEqual([]);
  });
});

describe('the header clock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // The time and date the header shows at this instant, in the Household Timezone.
  const header = (timezone: string) => `${formatClock(Date.now(), timezone)} ${formatDate(Date.now(), timezone)}`;

  it('turns its minute on the minute, not up to half a minute late', () => {
    vi.setSystemTime(at('2026-09-30T14:42:30'));
    const shown = [header(CHICAGO)];
    // useNow hands the header a new instant at each minute.
    const stop = watchMinute(() => shown.push(header(CHICAGO)));

    vi.advanceTimersByTime(29_999);
    expect(shown).toEqual(['2:42 PM Wed, Sep 30']);
    vi.advanceTimersByTime(1);
    expect(shown).toEqual(['2:42 PM Wed, Sep 30', '2:43 PM Wed, Sep 30']);
    stop();
  });

  it('turns its date at Household midnight with no reload', () => {
    // 04:59:50 UTC, already Oct 1 there: a header on UTC's date would be a day early.
    vi.setSystemTime(at('2026-09-30T23:59:50'));
    const shown = [header(CHICAGO)];
    // useNow hands the header a new instant when the Household day changes.
    const stop = watchHouseholdDay(CHICAGO, () => shown.push(header(CHICAGO)));

    vi.advanceTimersByTime(9_000);
    expect(shown).toEqual(['11:59 PM Wed, Sep 30']);
    vi.advanceTimersByTime(1_500);
    expect(shown).toEqual(['11:59 PM Wed, Sep 30', '12:00 AM Thu, Oct 1']);
    stop();
  });

  it('follows the Household Timezone either side of UTC', () => {
    // 15:00 UTC is midnight in Tokyo and 10:00 in Chicago.
    vi.setSystemTime(new Date('2026-09-30T14:59:50Z'));
    expect([header('Asia/Tokyo'), header(CHICAGO)]).toEqual(['11:59 PM Wed, Sep 30', '9:59 AM Wed, Sep 30']);
    vi.advanceTimersByTime(11_000);
    expect([header('Asia/Tokyo'), header(CHICAGO)]).toEqual(['12:00 AM Thu, Oct 1', '10:00 AM Wed, Sep 30']);
  });
});
