import { describe, expect, it } from 'vitest';
import { fiveDays, nowHour } from '../src/lib/calendar-occurrences';
import { dayStartMs } from '../supabase/functions/_shared/zoned-time.ts';

const CHICAGO = 'America/Chicago';
const TOKYO = 'Asia/Tokyo';
const SANTIAGO = 'America/Santiago';

// Tue 2026-09-29 .. Sat 2026-10-03 in Chicago (CDT, UTC-5), now being Tuesday 10:30 local.
const NOW = new Date('2026-09-29T15:30:00Z');
const days = fiveDays(CHICAGO, NOW);

describe('the five days', () => {
  it('are today and the next four in the Household Timezone', () => {
    expect(days.map((day) => day.date)).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03']);
    expect(days.map((day) => day.weekday)).toEqual([2, 3, 4, 5, 6]);
    expect(days.map((day) => day.isToday)).toEqual([true, false, false, false, false]);
  });

  it('start at Household midnight, not UTC midnight', () => {
    expect(days[0]!.startMs).toBe(Date.parse('2026-09-29T05:00:00Z'));
    expect(days[0]!.endMs).toBe(days[1]!.startMs);
  });

  it('take today from the Household Timezone, not the machine’s', () => {
    // 02:00 UTC on the 30th is still the evening of the 29th in Chicago and already the 30th in Tokyo.
    const instant = new Date('2026-09-30T02:00:00Z');
    expect(fiveDays(CHICAGO, instant)[0]!.date).toBe('2026-09-29');
    expect(fiveDays(TOKYO, instant)[0]!.date).toBe('2026-09-30');
  });

  it('keep the right length across a daylight saving change', () => {
    // US clocks go back on 2026-11-01: that day has 25 hours.
    const fall = fiveDays(CHICAGO, new Date('2026-10-31T17:00:00Z'));
    expect(fall.map((day) => (day.endMs - day.startMs) / 3_600_000)).toEqual([24, 25, 24, 24, 24]);
    expect(dayStartMs('2026-11-02', CHICAGO)).toBe(Date.parse('2026-11-02T06:00:00Z'));
  });


});

describe('where now is', () => {
  it('puts the current-time line only inside today', () => {
    expect(nowHour(days[0]!, NOW)).toBeCloseTo(10.5);
    expect(nowHour(days[1]!, NOW)).toBeNull();
  });

  it('puts it on the wall-clock time on a 25 hour day', () => {
    const fall = fiveDays(CHICAGO, new Date('2026-11-01T18:00:00Z'));
    // 18:00Z on the 1st is 12:00 noon CST, 13 real hours after midnight.
    expect(nowHour(fall[0]!, new Date('2026-11-01T18:00:00Z'))).toBeCloseTo(12);
  });

  it('counts from the wall clock on a day that skips midnight', () => {
    // Santiago's clocks jump 00:00 to 01:00 on Sun 2026-09-06: that day starts at 01:00, 04:00Z.
    const skipped = fiveDays(SANTIAGO, new Date('2026-09-06T15:00:00Z'));
    expect(skipped[0]!.date).toBe('2026-09-06');
    expect(nowHour(skipped[0]!, new Date('2026-09-06T15:00:00Z'))).toBeCloseTo(12);
  });
});
