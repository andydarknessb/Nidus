import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it } from 'vitest';
import { addDays, dayStartMs, householdDay } from '../supabase/functions/_shared/zoned-time.ts';
import { loadOccurrences, type Occurrence } from '../src/lib/calendar-occurrences';
import { arrangeCalendar, arrangeEvents } from './support/calendar';
import {
  asAnonymous,
  asDevice,
  asHouseholdAccount,
  asServiceRole,
  createHousehold,
  destroyHousehold,
  destroyTablet,
  type HouseholdAccount,
  type Tablet,
} from './support/supabase';

// Repeats (spec 0013, ticket #237; ADR 0005): a Native Event's Repeat is columns, the view
// `calendar_occurrences` expands it as it is read, and `native_event_skips` takes days out. Every test is
// a real principal against the local stack, a Household Account and a Device alike; the test Household's
// Household Timezone is America/Chicago, the one with clocks that change on 2026-03-08 and 2026-11-01.

let households: HouseholdAccount[] = [];
let tablets: Tablet[] = [];

afterEach(async () => {
  for (const tablet of tablets) await destroyTablet(tablet);
  for (const account of households) await destroyHousehold(account);
  households = [];
  tablets = [];
});

async function arrange(): Promise<HouseholdAccount> {
  const account = await createHousehold();
  households.push(account);
  return account;
}

type Principal = { name: string; client: (account: HouseholdAccount) => Promise<SupabaseClient> };
const PRINCIPALS: Principal[] = [
  { name: 'a Household Account', client: (account) => asHouseholdAccount(account) },
  {
    name: 'a Device',
    client: async (account) => {
      const device = await asDevice(account);
      tablets.push(device);
      return device.client;
    },
  },
];

type Shape = {
  every?: 'day' | 'week' | 'month' | 'year' | null;
  interval?: number;
  days?: number | null;
  until?: string | null;
  skipEvent?: string | null;
  skipOn?: string | null;
};

type Event = { title?: string; starts_at: string; ends_at: string; is_all_day?: boolean; profile_ids?: string[] };

// save_native_event with the Repeat; throws what the database said when it refuses.
async function save(client: SupabaseClient, event: Event, shape: Shape = {}, id: string | null = null): Promise<string> {
  const { data, error } = await client.rpc('save_native_event', {
    p_id: id,
    p_title: event.title ?? 'Soccer',
    p_location: null,
    p_notes: null,
    p_starts_at: event.starts_at,
    p_ends_at: event.ends_at,
    p_is_all_day: event.is_all_day ?? false,
    p_profile_ids: event.profile_ids ?? [],
    p_repeat_every: shape.every ?? null,
    p_repeat_interval: shape.interval ?? 1,
    p_repeat_days: shape.days ?? null,
    p_repeat_until: shape.until ?? null,
    p_skip_event: shape.skipEvent ?? null,
    p_skip_on: shape.skipOn ?? null,
  });
  if (error) throw error;
  return data as string;
}

const window = (from: string, to: string) => ({ from: new Date(from), to: new Date(to) });
async function read(client: SupabaseClient, from: string, to: string): Promise<Occurrence[]> {
  const range = window(from, to);
  return loadOccurrences(client, range.from, range.to);
}
const instant = (iso: string) => new Date(iso).toISOString();
const starts = (rows: Occurrence[]) => rows.map((row) => instant(row.starts_at));
const ends = (rows: Occurrence[]) => rows.map((row) => instant(row.ends_at));

const SUN = 1;
const TUE = 4;
const THU = 16;

// Tuesday 2026-10-06, 3:00 to 4:00 PM in Chicago (CDT).
const TUESDAY: Event = { starts_at: '2026-10-06T20:00:00Z', ends_at: '2026-10-06T21:00:00Z' };

describe.each(PRINCIPALS)('Repeats, as $name', ({ client: principal }) => {
  it('expands a weekly Repeat on two days into one Occurrence a day, each with its own id and the event\'s id', async () => {
    const account = await arrange();
    const client = await principal(account);
    const eventId = await save(client, TUESDAY, { every: 'week', days: TUE | THU });

    const rows = await read(client, '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z');

    expect(starts(rows)).toEqual(
      ['06', '08', '13', '15', '20', '22', '27', '29'].map((day) => `2026-10-${day}T20:00:00.000Z`),
    );
    expect(ends(rows)).toEqual(
      ['06', '08', '13', '15', '20', '22', '27', '29'].map((day) => `2026-10-${day}T21:00:00.000Z`),
    );
    expect(new Set(rows.map((row) => row.id)).size).toBe(8);
    expect(rows.every((row) => row.event_id === eventId && row.id !== eventId)).toBe(true);
    expect(rows[0]).toMatchObject({ source: 'native', title: 'Soccer', repeat_every: 'week', repeat_interval: 1, repeat_days: TUE | THU, repeat_until: null });
  });

  it('counts an every-2-weeks Repeat in weeks that start on Sunday, from the first day\'s week', async () => {
    const account = await arrange();
    const client = await principal(account);
    await save(client, TUESDAY, { every: 'week', interval: 2, days: TUE });
    // Tue, Oct 6 then Oct 20, then Nov 3 (3 PM is CST by then, 9 PM UTC): the week between has none.
    expect(starts(await read(client, '2026-10-01T00:00:00Z', '2026-11-08T00:00:00Z'))).toEqual([
      '2026-10-06T20:00:00.000Z',
      '2026-10-20T20:00:00.000Z',
      '2026-11-03T21:00:00.000Z',
    ]);

    const other = await arrange();
    const otherClient = await principal(other);
    await save(otherClient, TUESDAY, { every: 'week', interval: 2, days: SUN | TUE });
    // The Sunday before the first Tuesday is not an Occurrence (before the first day); Sunday Oct 11 is the odd week.
    expect(starts(await read(otherClient, '2026-10-01T00:00:00Z', '2026-11-08T00:00:00Z'))).toEqual([
      '2026-10-06T20:00:00.000Z',
      '2026-10-18T20:00:00.000Z',
      '2026-10-20T20:00:00.000Z',
      '2026-11-01T21:00:00.000Z',
      '2026-11-03T21:00:00.000Z',
    ]);

    const third = await arrange();
    const thirdClient = await principal(third);
    // Saturday, Oct 10 at 3 PM, every 2 weeks on Monday: Saturday ends its week, so the Monday two days on is the
    // week between and the first Occurrence is Monday, Oct 19.
    await save(thirdClient, { starts_at: '2026-10-10T20:00:00Z', ends_at: '2026-10-10T21:00:00Z' }, { every: 'week', interval: 2, days: 2 });
    expect(starts(await read(thirdClient, '2026-10-01T00:00:00Z', '2026-11-08T00:00:00Z'))).toEqual(['2026-10-19T20:00:00.000Z', '2026-11-02T21:00:00.000Z']);
  });

  it('keeps every N days and every N months and leaves out the month without the date', async () => {
    const account = await arrange();
    const client = await principal(account);
    await save(client, TUESDAY, { every: 'day', interval: 3 });
    expect(starts(await read(client, '2026-10-01T00:00:00Z', '2026-10-16T00:00:00Z'))).toEqual(
      ['06', '09', '12', '15'].map((day) => `2026-10-${day}T20:00:00.000Z`),
    );

    const other = await arrange();
    const otherClient = await principal(other);
    // Sunday, May 31, 2026 at 3 PM CDT: June has no 31st.
    await save(otherClient, { starts_at: '2026-05-31T20:00:00Z', ends_at: '2026-05-31T21:00:00Z' }, { every: 'month' });
    expect(starts(await read(otherClient, '2026-05-01T00:00:00Z', '2026-10-01T00:00:00Z'))).toEqual([
      '2026-05-31T20:00:00.000Z',
      '2026-07-31T20:00:00.000Z',
      '2026-08-31T20:00:00.000Z',
    ]);
  });

  it('lands a yearly Repeat on Feb 29 only in a leap year', async () => {
    const account = await arrange();
    const client = await principal(account);
    // Thursday, Feb 29, 2024 at noon CST.
    await save(client, { starts_at: '2024-02-29T18:00:00Z', ends_at: '2024-02-29T19:00:00Z' }, { every: 'year', until: '2028-12-31' });

    expect(starts(await read(client, '2024-01-01T00:00:00Z', '2030-01-01T00:00:00Z'))).toEqual([
      '2024-02-29T18:00:00.000Z',
      '2028-02-29T18:00:00.000Z',
    ]);
  });

  it('makes repeat_until the last day an Occurrence may land on', async () => {
    const account = await arrange();
    const client = await principal(account);
    await save(client, TUESDAY, { every: 'day', until: '2026-10-09' });

    expect(starts(await read(client, '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z'))).toEqual(
      ['06', '07', '08', '09'].map((day) => `2026-10-${day}T20:00:00.000Z`),
    );
  });

  it('takes a skipped day out, the same on every read, and takes the skip with its event', async () => {
    const account = await arrange();
    const client = await principal(account);
    const eventId = await save(client, TUESDAY, { every: 'week', days: TUE });
    const { error } = await client.from('native_event_skips').insert({ native_event_id: eventId, household_id: account.household.id, skipped_on: '2026-10-13' });
    expect(error).toBeNull();

    const first = await read(client, '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z');
    const second = await read(client, '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z');

    expect(starts(first)).toEqual(['06', '20', '27'].map((day) => `2026-10-${day}T20:00:00.000Z`));
    expect(second).toEqual(first);

    const { error: unskip } = await client.from('native_event_skips').delete().eq('native_event_id', eventId).eq('skipped_on', '2026-10-13');
    expect(unskip).toBeNull();
    expect(await read(client, '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z')).toHaveLength(4);

    await client.from('native_event_skips').insert({ native_event_id: eventId, household_id: account.household.id, skipped_on: '2026-10-20' });
    const { error: deleted } = await client.from('native_events').delete().eq('id', eventId);
    expect(deleted).toBeNull();
    const { data: left } = await asServiceRole().from('native_event_skips').select('skipped_on').eq('native_event_id', eventId);
    expect(left).toEqual([]);
  });

  it('keeps an all-day Repeat\'s days, whatever the clocks do between them', async () => {
    const account = await arrange();
    const client = await principal(account);
    // Saturday Oct 31 and Sunday Nov 1, all day (the end is the midnight after Sunday); the clocks go back on the Sunday.
    await save(client, { starts_at: '2026-10-31T05:00:00Z', ends_at: '2026-11-02T06:00:00Z', is_all_day: true }, { every: 'week', days: 64 });

    const rows = await read(client, '2026-10-30T00:00:00Z', '2026-11-15T00:00:00Z');

    expect(starts(rows)).toEqual(['2026-10-31T05:00:00.000Z', '2026-11-07T06:00:00.000Z', '2026-11-14T06:00:00.000Z']);
    expect(ends(rows)).toEqual(['2026-11-02T06:00:00.000Z', '2026-11-09T06:00:00.000Z', '2026-11-16T06:00:00.000Z']);
    expect(rows.every((row) => row.is_all_day)).toBe(true);
  });

  it('moves a time the clocks skip forward by the gap, and takes the first of a time struck twice (America/Chicago)', async () => {
    const account = await arrange();
    expect(account.household.timezone).toBe('America/Chicago');
    const client = await principal(account);
    // Daily at 2:30 AM CST from Sat, Mar 7: on Mar 8 the clocks jump from 2:00 to 3:00, so 2:30 lands at 3:30 CDT.
    await save(client, { starts_at: '2026-03-07T08:30:00Z', ends_at: '2026-03-07T09:00:00Z' }, { every: 'day', until: '2026-03-10' });
    const spring = await read(client, '2026-03-07T00:00:00Z', '2026-03-11T00:00:00Z');
    expect(starts(spring)).toEqual(['2026-03-07T08:30:00.000Z', '2026-03-08T08:30:00.000Z', '2026-03-09T07:30:00.000Z', '2026-03-10T07:30:00.000Z']);
    expect(ends(spring)).toEqual(['2026-03-07T09:00:00.000Z', '2026-03-08T09:00:00.000Z', '2026-03-09T08:00:00.000Z', '2026-03-10T08:00:00.000Z']);

    const other = await arrange();
    const otherClient = await principal(other);
    // Daily at 1:30 AM CDT from Sat, Oct 31: on Nov 1 the clocks go back from 2:00 to 1:00, so 1:30 happens twice. The first (CDT) wins.
    await save(otherClient, { starts_at: '2026-10-31T06:30:00Z', ends_at: '2026-10-31T07:00:00Z' }, { every: 'day', until: '2026-11-02' });
    const fall = await read(otherClient, '2026-10-31T00:00:00Z', '2026-11-03T00:00:00Z');
    expect(starts(fall)).toEqual(['2026-10-31T06:30:00.000Z', '2026-11-01T06:30:00.000Z', '2026-11-02T07:30:00.000Z']);
    expect(ends(fall)).toEqual(['2026-10-31T07:00:00.000Z', '2026-11-01T07:00:00.000Z', '2026-11-02T08:00:00.000Z']);
  });

  it('gives an Occurrence of a Repeat an id that is the same on every read, and an event without a Repeat its own', async () => {
    const account = await arrange();
    const client = await principal(account);
    const repeating = await save(client, TUESDAY, { every: 'week', days: TUE });
    const once = await save(client, { title: 'Dentist', starts_at: '2026-10-08T15:00:00Z', ends_at: '2026-10-08T16:00:00Z' });

    const first = await read(client, '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z');
    const second = await read(client, '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z');

    expect(second.map((row) => row.id)).toEqual(first.map((row) => row.id));
    const md5 = (text: string) => createHash('md5').update(text).digest('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
    const tuesday = first.find((row) => instant(row.starts_at) === '2026-10-13T20:00:00.000Z');
    expect(tuesday).toMatchObject({ event_id: repeating, id: md5(`${repeating}2026-10-13 20:00:00`) });
    const dentist = first.find((row) => row.title === 'Dentist');
    expect(dentist).toMatchObject({ id: once, event_id: once, repeat_every: null, repeat_interval: 1, repeat_days: null, repeat_until: null });
  });

  it('gives a Synced Event no event_id and no Repeat', async () => {
    const account = await arrange();
    const client = await principal(account);
    const calendar = await arrangeCalendar(account);
    await arrangeEvents(calendar.calendarId, [{ google_event_id: 'g1', title: 'Swim', starts_at: '2026-10-08T20:00:00Z', ends_at: '2026-10-08T21:00:00Z' }]);

    const [swim] = await read(client, '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z');

    expect(swim).toMatchObject({ source: 'synced', title: 'Swim', event_id: null, repeat_every: null, repeat_interval: null, repeat_days: null, repeat_until: null });
  });

  it('expands two years ahead of the Household\'s clock, and not a day further', async () => {
    const account = await arrange();
    const client = await principal(account);
    const timezone = account.household.timezone;
    const today = householdDay(timezone, new Date()).date;
    const [year, month, date] = today.split('-').map(Number) as [number, number, number];
    // Postgres adds two years to a date and clamps Feb 29 to Feb 28.
    const lastDay = new Date(Date.UTC(year + 2, month - 1, Math.min(date, new Date(Date.UTC(year + 2, month, 0)).getUTCDate()))).toISOString().slice(0, 10);
    const yesterdayNoon = dayStartMs(addDays(today, -1), timezone) + 12 * 3_600_000;
    await save(client, { starts_at: new Date(yesterdayNoon).toISOString(), ends_at: new Date(yesterdayNoon + 3_600_000).toISOString() }, { every: 'day' });

    const onLastDay = await read(client, new Date(dayStartMs(lastDay, timezone)).toISOString(), new Date(dayStartMs(addDays(lastDay, 1), timezone)).toISOString());
    const afterIt = await read(client, new Date(dayStartMs(addDays(lastDay, 1), timezone)).toISOString(), new Date(dayStartMs(addDays(lastDay, 2), timezone)).toISOString());
    const yesterday = await read(client, new Date(dayStartMs(addDays(today, -1), timezone)).toISOString(), new Date(dayStartMs(today, timezone)).toISOString());

    expect(onLastDay).toHaveLength(1);
    expect(afterIt).toEqual([]);
    expect(yesterday).toHaveLength(1);
  });

  it('writes a skip and a standalone event in one transaction, and rolls the skip back with a refused write', async () => {
    const account = await arrange();
    const client = await principal(account);
    const eventId = await save(client, TUESDAY, { every: 'week', days: TUE });

    const moved = await save(client, { title: 'Soccer, late', starts_at: '2026-10-13T22:00:00Z', ends_at: '2026-10-13T23:00:00Z' }, { skipEvent: eventId, skipOn: '2026-10-13' });

    const rows = await read(client, '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z');
    expect(rows.filter((row) => row.title === 'Soccer').map((row) => instant(row.starts_at))).toEqual(
      ['06', '20', '27'].map((day) => `2026-10-${day}T20:00:00.000Z`),
    );
    expect(rows.find((row) => row.title === 'Soccer, late')).toMatchObject({ id: moved, event_id: moved, repeat_every: null });

    await expect(save(client, { title: '   ', starts_at: '2026-10-20T22:00:00Z', ends_at: '2026-10-20T23:00:00Z' }, { skipEvent: eventId, skipOn: '2026-10-20' })).rejects.toMatchObject({ code: '23514' });
    expect(await read(client, '2026-10-20T00:00:00Z', '2026-10-21T00:00:00Z')).toHaveLength(1);
  });

  it('refuses a Repeat that ends before it starts and a week with no days, and writes nothing', async () => {
    const account = await arrange();
    const client = await principal(account);

    await expect(save(client, TUESDAY, { every: 'day', until: '2026-10-05' })).rejects.toMatchObject({ code: '23514' });
    await expect(save(client, TUESDAY, { every: 'week' })).rejects.toMatchObject({ code: '23514' });
    // The last day may be the first day, and the date is the Household's: 3 PM on Oct 6 is Oct 6.
    await expect(save(client, TUESDAY, { every: 'day', until: '2026-10-06' })).resolves.toEqual(expect.any(String));
    // A late evening start is the next day in UTC and the same day in Chicago.
    await expect(save(client, { starts_at: '2026-10-07T03:00:00Z', ends_at: '2026-10-07T04:00:00Z' }, { every: 'day', until: '2026-10-06' })).resolves.toEqual(expect.any(String));
    expect(await read(client, '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z')).toHaveLength(2);
  });

  it('refuses a Repeat the table does not allow', async () => {
    const account = await arrange();
    const client = await principal(account);
    const eventId = await save(client, TUESDAY);
    const update = async (fields: Record<string, unknown>) => (await client.from('native_events').update(fields).eq('id', eventId)).error;

    expect(await update({ repeat_every: 'week', repeat_days: null })).toMatchObject({ code: '23514' });
    expect(await update({ repeat_every: 'month', repeat_days: 4 })).toMatchObject({ code: '23514' });
    expect(await update({ repeat_every: null, repeat_days: 4 })).toMatchObject({ code: '23514' });
    expect(await update({ repeat_every: null, repeat_interval: 2 })).toMatchObject({ code: '23514' });
    expect(await update({ repeat_every: null, repeat_until: '2026-12-01' })).toMatchObject({ code: '23514' });
    expect(await update({ repeat_every: 'day', repeat_interval: 0 })).toMatchObject({ code: '23514' });
    expect(await update({ repeat_every: 'day', repeat_interval: 100 })).toMatchObject({ code: '23514' });
    expect(await update({ repeat_every: 'week', repeat_days: 128 })).toMatchObject({ code: '23514' });
    expect(await update({ repeat_every: 'fortnight' })).toMatchObject({ code: '23514' });
    expect(await update({ repeat_every: 'week', repeat_interval: 99, repeat_days: 127 })).toBeNull();
  });

  it('turns an event into a Repeat and back by saving it', async () => {
    const account = await arrange();
    const client = await principal(account);
    const eventId = await save(client, TUESDAY);
    expect(await read(client, '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z')).toHaveLength(1);

    await save(client, TUESDAY, { every: 'week', days: TUE }, eventId);
    expect(await read(client, '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z')).toHaveLength(4);

    await save(client, TUESDAY, {}, eventId);
    expect(await read(client, '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z')).toMatchObject([{ id: eventId, event_id: eventId, repeat_every: null }]);
  });

  it('keeps another Household from reading a Repeat, its Occurrences or its skips, and from skipping its days', async () => {
    const account = await arrange();
    const client = await principal(account);
    const eventId = await save(client, TUESDAY, { every: 'week', days: TUE });
    await client.from('native_event_skips').insert({ native_event_id: eventId, household_id: account.household.id, skipped_on: '2026-10-13' });

    const other = await arrange();
    const stranger = await principal(other);

    expect(await read(stranger, '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z')).toEqual([]);
    const { data: skips } = await stranger.from('native_event_skips').select('skipped_on');
    expect(skips).toEqual([]);
    // Neither as a row of its own Household nor as the owner's.
    expect((await stranger.from('native_event_skips').insert({ native_event_id: eventId, household_id: other.household.id, skipped_on: '2026-10-20' })).error).not.toBeNull();
    expect((await stranger.from('native_event_skips').insert({ native_event_id: eventId, household_id: account.household.id, skipped_on: '2026-10-20' })).error).not.toBeNull();
    await expect(save(stranger, { title: 'Mine', starts_at: '2026-10-20T22:00:00Z', ends_at: '2026-10-20T23:00:00Z' }, { skipEvent: eventId, skipOn: '2026-10-20' })).rejects.toMatchObject({ code: 'P0002' });
    expect((await stranger.from('native_event_skips').delete().eq('native_event_id', eventId).select()).data).toEqual([]);

    expect(await read(stranger, '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z')).toEqual([]);
    expect(starts(await read(client, '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z'))).toHaveLength(3);
  });
});

describe('Repeats, as no one', () => {
  it('cannot read a skip or call the expansion', async () => {
    const anon = asAnonymous();
    expect((await anon.from('native_event_skips').select('skipped_on')).error).toMatchObject({ code: '42501' });
    expect((await anon.rpc('native_event_occurrences', { e: {} })).error).toMatchObject({ code: '42501', message: expect.stringContaining('function') });
  });
});
