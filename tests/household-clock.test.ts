import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, dayStartMs, householdDay, householdTime, instantAt, spanIsOn } from '@shared/zoned-time.ts';
import { loadOccurrences } from '../src/lib/calendar-occurrences';
import { asAnonymous, asHouseholdAccount, createHousehold, destroyHousehold, type HouseholdAccount } from './support/supabase';

// The Household clock (spec 0008): the Household Date and the time of day on it, for the Wall,
// the phone and every Edge Function. Pure, except the table at the foot, which asks the local stack
// for the clock's other half (public.wall_clock_instant). Run with TZ set to an odd zone to see that
// the machine's zone never matters.

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
});

// The clock's one table (spec 0020). A plain time; a time the clocks skip, which moves forward by the
// gap (RFC 5545 3.3.5, as CONTEXT.md's Household Date says); a time that happens twice, which is the
// first of the two. Each row must give the same instant from instantAt and from public.wall_clock_instant,
// the rule native_event_occurrences and reanchor_instant both call.
const CASES: [zone: string, date: string, time: string, instant: string][] = [
  ['America/Chicago', '2026-10-06', '08:30', '2026-10-06T13:30:00Z'],
  ['America/Chicago', '2026-03-08', '02:30', '2026-03-08T08:30:00Z'],
  ['America/Chicago', '2026-11-01', '01:30', '2026-11-01T06:30:00Z'],
  ['Europe/London', '2026-07-01', '07:00', '2026-07-01T06:00:00Z'],
  ['Europe/London', '2026-03-29', '01:30', '2026-03-29T01:30:00Z'],
  ['Europe/London', '2026-10-25', '01:30', '2026-10-25T00:30:00Z'],
  ['Pacific/Auckland', '2026-07-01', '07:00', '2026-06-30T19:00:00Z'],
  ['Pacific/Auckland', '2026-09-27', '02:30', '2026-09-26T14:30:00Z'],
  ['Pacific/Auckland', '2026-04-05', '02:30', '2026-04-04T13:30:00Z'],
  ['Australia/Lord_Howe', '2026-07-01', '07:00', '2026-06-30T20:30:00Z'],
  ['Australia/Lord_Howe', '2026-10-04', '02:15', '2026-10-03T15:45:00Z'],
  ['Australia/Lord_Howe', '2026-04-05', '01:45', '2026-04-04T14:45:00Z'],
];

describe('the Household clock and the database agree on a time of day', () => {
  let account: HouseholdAccount;
  let phone: SupabaseClient;
  beforeAll(async () => {
    account = await createHousehold();
    phone = await asHouseholdAccount(account);
  });
  afterAll(async () => {
    await destroyHousehold(account);
  });

  it.each(CASES)('%s, %s %s, is %s', async (zone, date, time, instant) => {
    expect(instantAt(date, time, zone)).toBe(Date.parse(instant));
    const { data, error } = await phone.rpc('wall_clock_instant', { p_local: `${date} ${time}:00`, p_zone: zone });
    expect(error).toBeNull();
    expect(new Date(data as string).getTime()).toBe(Date.parse(instant));
  });

  it('is not callable with the anon key alone', async () => {
    const { error } = await asAnonymous().rpc('wall_clock_instant', { p_local: '2026-10-06 08:30:00', p_zone: 'America/Chicago' });
    expect(error?.code).toBe('42501');
  });
});

// The callers, not only the function: Lord Howe's clocks go back half an hour, so 1:45 AM on 2026-04-05
// happens at 14:45Z and 15:15Z. A one-hour check would read the later one; the table above never reaches
// native_event_occurrences, and the Repeat and re-anchor tests only use America/Chicago.
describe('a Native Event reads at the Household clock\'s instant', () => {
  it('reads 1:45 AM on the Lord Howe night the clocks go back at the first of the two', async () => {
    const account = await createHousehold();
    try {
      const phone = await asHouseholdAccount(account);
      const { error: zoneError } = await phone.from('households').update({ timezone: 'Australia/Lord_Howe' }).eq('id', account.household.id);
      if (zoneError) throw zoneError;
      const { error } = await phone.rpc('save_native_event', {
        p_id: null,
        p_title: 'Soccer',
        p_location: null,
        p_notes: null,
        p_starts_at: '2026-04-04T14:45:00Z',
        p_ends_at: '2026-04-04T15:15:00Z',
        p_is_all_day: false,
        p_profile_ids: [],
        p_repeat_every: null,
        p_repeat_interval: 1,
        p_repeat_days: null,
        p_repeat_until: null,
        p_skip_event: null,
        p_skip_on: null,
      });
      if (error) throw error;
      const rows = await loadOccurrences(phone, new Date('2026-04-04T00:00:00Z'), new Date('2026-04-06T00:00:00Z'));
      expect(rows.map((row) => new Date(row.starts_at).toISOString())).toEqual(['2026-04-04T14:45:00.000Z']);
    } finally {
      await destroyHousehold(account);
    }
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
