import { describe, expect, it } from 'vitest';
import { addDays, dayStartMs, householdDay, householdTime, instantAt, spanIsOn } from '../supabase/functions/_shared/zoned-time.ts';

// The Household clock (spec 0008): the Household Date and the time of day on it, for the Wall,
// the phone and every Edge Function. Pure; run with TZ set to an odd zone to see that the machine's
// zone never matters.

const MON = 1;
const TUE = 2;
const WED = 3;

describe('the Household Date at an instant', () => {
  it('is the date and weekday in the Household Timezone, not the machine\'s', () => {
    // 03:30 UTC on Tuesday the 29th is still Monday evening in Chicago (CDT, UTC-5).
    const instant = new Date('2026-09-29T03:30:00Z');
    expect(householdDay('America/Chicago', instant)).toEqual({ date: '2026-09-28', weekday: MON });
    expect(householdDay('UTC', instant)).toEqual({ date: '2026-09-29', weekday: TUE });
    // Auckland is already Wednesday the 30th at 12:00 UTC (NZDT, UTC+13).
    expect(householdDay('Pacific/Auckland', new Date('2026-09-29T12:00:00Z'))).toEqual({ date: '2026-09-30', weekday: WED });
  });

  it('rolls over exactly at Household midnight', () => {
    expect(householdDay('America/Chicago', new Date('2026-09-29T04:59:59Z'))).toEqual({ date: '2026-09-28', weekday: MON });
    expect(householdDay('America/Chicago', new Date('2026-09-29T05:00:00Z'))).toEqual({ date: '2026-09-29', weekday: TUE });
  });

  it('follows daylight saving changes', () => {
    // Chicago falls back on 2026-11-01: 05:30Z is 00:30 CDT, 06:30Z is 00:30 CST, both the 1st.
    expect(householdDay('America/Chicago', new Date('2026-11-01T05:30:00Z')).date).toBe('2026-11-01');
    expect(householdDay('America/Chicago', new Date('2026-11-01T06:30:00Z')).date).toBe('2026-11-01');
    expect(householdDay('America/Chicago', new Date('2026-11-02T05:59:00Z')).date).toBe('2026-11-01');
    expect(householdDay('America/Chicago', new Date('2026-11-02T06:00:00Z')).date).toBe('2026-11-02');
  });

  it('steps by calendar days, where stepping by 24 hours repeats a date on a 25 hour day', () => {
    // 23:30 CST, the last hour of the 25 hour day: 24 hours back is still the 1st, one calendar day back is the 31st.
    const lastHour = new Date('2026-11-02T05:30:00Z');
    expect(householdDay('America/Chicago', lastHour).date).toBe('2026-11-01');
    expect(householdDay('America/Chicago', new Date(lastHour.getTime() - 24 * 60 * 60 * 1000)).date).toBe('2026-11-01');
    expect(addDays('2026-11-01', -1)).toBe('2026-10-31');
  });

  it('carries the minutes since Household midnight', () => {
    // 2026-10-06 is a Tuesday. 13:30Z is 8:30 in Chicago (CDT) and 03:30 the next morning at +14.
    const at = Date.parse('2026-10-06T13:30:00Z');
    expect(householdTime(at, 'America/Chicago')).toEqual({ date: '2026-10-06', minutes: 8 * 60 + 30, weekday: 2 });
    expect(householdTime(at, 'Pacific/Kiritimati')).toEqual({ date: '2026-10-07', minutes: 3 * 60 + 30, weekday: 3 });
    expect(householdTime(at, 'America/Los_Angeles')).toEqual({ date: '2026-10-06', minutes: 6 * 60 + 30, weekday: 2 });
  });

  it('puts 7:00 where the zone puts it across a spring-forward in Chicago', () => {
    // The clocks jump 2:00 to 3:00 on 2026-03-08: 7:00 is 13:00Z the day before, 12:00Z that day.
    expect(householdTime(Date.parse('2026-03-07T13:00:00Z'), 'America/Chicago').minutes).toBe(7 * 60);
    expect(householdTime(Date.parse('2026-03-08T11:59:00Z'), 'America/Chicago').minutes).toBe(6 * 60 + 59);
    expect(householdTime(Date.parse('2026-03-08T12:00:00Z'), 'America/Chicago')).toMatchObject({ date: '2026-03-08', minutes: 7 * 60 });
  });

  it('puts 7:00 where the zone puts it across a fall-back in Auckland, far from UTC', () => {
    // Auckland ends daylight saving at 03:00 on 2026-04-05 (+13 to +12).
    expect(householdTime(Date.parse('2026-04-03T18:00:00Z'), 'Pacific/Auckland')).toMatchObject({ date: '2026-04-04', minutes: 7 * 60 });
    expect(householdTime(Date.parse('2026-04-04T19:00:00Z'), 'Pacific/Auckland')).toMatchObject({ date: '2026-04-05', minutes: 7 * 60 });
    // The UTC hour of "7:00" moved by one, the Household's did not.
    expect(householdTime(Date.parse('2026-04-04T18:00:00Z'), 'Pacific/Auckland')).toMatchObject({ date: '2026-04-05', minutes: 6 * 60 });
  });
});

describe('dates', () => {
  it('add whole days across month and year ends', () => {
    expect(addDays('2026-10-06', 1)).toBe('2026-10-07');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
  });

  it('start a day at its first instant when a zone skips midnight', () => {
    // Santiago's clocks jump from 00:00 to 01:00 on 2026-09-06, so that day starts at 01:00 (-03).
    expect(dayStartMs('2026-09-06', 'America/Santiago')).toBe(Date.parse('2026-09-06T04:00:00Z'));
    expect(dayStartMs('2026-09-05', 'America/Santiago')).toBe(Date.parse('2026-09-05T04:00:00Z'));
  });
});

describe('a time of day on a Household Date', () => {
  it('is that time on the Household\'s wall clock', () => {
    expect(instantAt('2026-10-06', '08:30', 'America/Chicago')).toBe(Date.parse('2026-10-06T13:30:00Z'));
    expect(instantAt('2026-10-07', '03:30', 'Pacific/Kiritimati')).toBe(Date.parse('2026-10-06T13:30:00Z'));
  });

  // RFC 5545 3.3.5, as CONTEXT.md's Household Date says.
  it('moves a time the clocks skip forward by the gap', () => {
    expect(instantAt('2026-03-08', '02:30', 'America/Chicago')).toBe(Date.parse('2026-03-08T08:30:00Z'));
    expect(instantAt('2026-09-27', '02:30', 'Pacific/Auckland')).toBe(Date.parse('2026-09-26T14:30:00Z'));
  });

  it('takes the first of a time that happens twice', () => {
    expect(instantAt('2026-10-25', '01:30', 'Europe/London')).toBe(Date.parse('2026-10-25T00:30:00Z'));
    expect(instantAt('2026-11-01', '01:30', 'America/Chicago')).toBe(Date.parse('2026-11-01T06:30:00Z'));
    expect(instantAt('2026-04-05', '02:30', 'Pacific/Auckland')).toBe(Date.parse('2026-04-04T13:30:00Z'));
  });
});

describe('an event on a Household Date', () => {
  const day = { startMs: Date.parse('2026-10-06T05:00:00Z'), endMs: Date.parse('2026-10-07T05:00:00Z') };
  const at = (iso: string) => Date.parse(iso);

  it('is on the day when it overlaps it', () => {
    expect(spanIsOn(at('2026-10-06T14:00:00Z'), at('2026-10-06T15:00:00Z'), day)).toBe(true);
    expect(spanIsOn(at('2026-10-05T20:00:00Z'), at('2026-10-06T06:00:00Z'), day)).toBe(true);
  });

  it('is not on the next day when it ends at midnight, and is on the day it starts at midnight', () => {
    expect(spanIsOn(at('2026-10-05T05:00:00Z'), day.startMs, day)).toBe(false);
    expect(spanIsOn(day.startMs, at('2026-10-06T06:00:00Z'), day)).toBe(true);
    expect(spanIsOn(at('2026-10-06T23:00:00Z'), day.endMs, day)).toBe(true);
  });

  it('puts an event of no length on the day its instant falls in, midnight included', () => {
    expect(spanIsOn(day.startMs, day.startMs, day)).toBe(true);
    expect(spanIsOn(day.endMs, day.endMs, day)).toBe(false);
  });
});
