import { afterEach, describe, expect, it } from 'vitest';
import { loadOccurrences, readPages, type Occurrence } from '../src/lib/calendar-occurrences';
import { loadUpcomingNativeEvents, saveNativeEvent } from '../src/lib/native-events';
import { addDays, householdDay, instantAt } from '../supabase/functions/_shared/zoned-time.ts';
import { PROFILE_PALETTE, createProfile } from '../src/lib/profiles';
import { arrangeCalendar, arrangeEvents, type EventInput } from './support/calendar';
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

const WINDOW = { from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-11-01T00:00:00Z') };

const lunch = {
  google_event_id: 'lunch',
  title: 'Lunch',
  starts_at: '2026-10-05T17:00:00Z',
  ends_at: '2026-10-05T18:00:00Z',
};

describe('synced_events', () => {
  it('is read-only for a Household Account and for a Device', async () => {
    const account = await arrange();
    const { calendarId } = await arrangeCalendar(account);
    await arrangeEvents(calendarId, [lunch]);
    const device = await asDevice(account);
    tablets.push(device);
    const phone = await asHouseholdAccount(account);

    for (const client of [phone, device.client]) {
      const row = {
        household_id: account.household.id,
        mirrored_calendar_id: calendarId,
        google_event_id: 'forged',
        title: 'Forged',
        starts_at: lunch.starts_at,
        ends_at: lunch.ends_at,
      };
      expect((await client.from('synced_events').insert(row)).error).not.toBeNull();
      await client.from('synced_events').update({ title: 'Changed' }).eq('google_event_id', 'lunch');
      await client.from('synced_events').delete().eq('google_event_id', 'lunch');
    }

    const { data } = await asServiceRole().from('synced_events').select('title').eq('mirrored_calendar_id', calendarId);
    expect(data).toEqual([{ title: 'Lunch' }]);
  });

  it('cannot be rewritten through the sync function by any client', async () => {
    const account = await arrange();
    const { calendarId } = await arrangeCalendar(account);
    await arrangeEvents(calendarId, [lunch]);
    const device = await asDevice(account);
    tablets.push(device);
    const forged = [{ google_event_id: 'forged', title: 'Forged', description: null, location: null, starts_at: lunch.starts_at, ends_at: lunch.ends_at, is_all_day: false }];

    for (const client of [asAnonymous(), await asHouseholdAccount(account), device.client]) {
      const { error } = await client.rpc('replace_synced_events', {
        p_mirrored_calendar_id: calendarId,
        p_events: forged,
        p_sync_token: 'forged',
        p_synced_at: new Date().toISOString(),
      });
      // 42501: refused for want of permission, not a missing function or a bad argument.
      expect(error?.code).toBe('42501');
      const { error: deltaError } = await client.rpc('apply_synced_event_changes', {
        p_mirrored_calendar_id: calendarId,
        p_upserts: forged,
        p_deleted_ids: [lunch.google_event_id],
        p_sync_token: 'forged',
      });
      expect(deltaError?.code).toBe('42501');
      expect((await client.rpc('invoke_calendar_sync')).error?.code).toBe('42501');
    }

    const { data } = await asServiceRole().from('synced_events').select('title').eq('mirrored_calendar_id', calendarId);
    expect(data).toEqual([{ title: 'Lunch' }]);
    const { data: calendar } = await asServiceRole().from('mirrored_calendars').select('sync_token').eq('id', calendarId).single<{ sync_token: string | null }>();
    expect(calendar?.sync_token).toBeNull();
  });

  it('keeps one row per Google event in a calendar', async () => {
    const account = await arrange();
    const { calendarId } = await arrangeCalendar(account);
    await arrangeEvents(calendarId, [lunch]);
    const { error } = await asServiceRole()
      .from('synced_events')
      .insert({ household_id: account.household.id, mirrored_calendar_id: calendarId, ...lunch });
    expect(error?.code).toBe('23505');
  });

  it('refuses a row whose household is not its calendar’s', async () => {
    const account = await arrange();
    const other = await arrange();
    const { calendarId } = await arrangeCalendar(account);
    const { error } = await asServiceRole()
      .from('synced_events')
      .insert({ household_id: other.household.id, mirrored_calendar_id: calendarId, ...lunch });
    expect(error).not.toBeNull();
  });

  it('is unreadable without a session', async () => {
    const account = await arrange();
    const { calendarId } = await arrangeCalendar(account);
    await arrangeEvents(calendarId, [lunch]);
    const { data, error } = await asAnonymous().from('synced_events').select('id');
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });
});

describe('calendar_occurrences', () => {
  it('attributes an event to its Mirrored Calendar’s Profile', async () => {
    const account = await arrange();
    const phone = await asHouseholdAccount(account);
    const profile = await createProfile(phone, account.household.id, { name: 'Ada', color: PROFILE_PALETTE[0].hex, avatar_url: null }, 0);
    const { calendarId } = await arrangeCalendar(account, { name: 'Ada’s work', profileId: profile.id });
    await arrangeEvents(calendarId, [{ ...lunch, description: 'Bring the plans', location: 'Cafe' }]);

    const occurrences = await loadOccurrences(phone, WINDOW.from, WINDOW.to);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]).toMatchObject<Partial<Occurrence>>({
      source: 'synced',
      title: 'Lunch',
      description: 'Bring the plans',
      location: 'Cafe',
      calendar_name: 'Ada’s work',
      profile_id: profile.id,
      is_all_day: false,
    });
  });

  it('shows a whole-Household calendar with no Profile', async () => {
    const account = await arrange();
    const { calendarId } = await arrangeCalendar(account);
    await arrangeEvents(calendarId, [lunch]);

    const [occurrence] = await loadOccurrences(await asHouseholdAccount(account), WINDOW.from, WINDOW.to);
    expect(occurrence).toMatchObject({ profile_id: null });
  });

  it('leaves out a calendar that is not selected', async () => {
    const account = await arrange();
    const { calendarId } = await arrangeCalendar(account, { selected: false });
    await arrangeEvents(calendarId, [lunch]);

    expect(await loadOccurrences(await asHouseholdAccount(account), WINDOW.from, WINDOW.to)).toEqual([]);
  });

  it('is readable by a Device of the Household, and only that Household’s', async () => {
    const account = await arrange();
    const other = await arrange();
    await arrangeEvents((await arrangeCalendar(account)).calendarId, [lunch]);
    await arrangeEvents((await arrangeCalendar(other)).calendarId, [{ ...lunch, google_event_id: 'secret', title: 'Not yours' }]);
    const device = await asDevice(account);
    tablets.push(device);

    const titles = (await loadOccurrences(device.client, WINDOW.from, WINDOW.to)).map((occurrence) => occurrence.title);
    expect(titles).toEqual(['Lunch']);
  });

  it('returns what overlaps the window, in start order, including a multi-day event that began before it', async () => {
    const account = await arrange();
    const { calendarId } = await arrangeCalendar(account);
    await arrangeEvents(calendarId, [
      { google_event_id: 'late', title: 'Late', starts_at: '2026-10-20T10:00:00Z', ends_at: '2026-10-20T11:00:00Z' },
      { google_event_id: 'trip', title: 'Trip', starts_at: '2026-09-29T05:00:00Z', ends_at: '2026-10-02T05:00:00Z', is_all_day: true },
      { google_event_id: 'early', title: 'Before', starts_at: '2026-09-01T10:00:00Z', ends_at: '2026-09-01T11:00:00Z' },
      { google_event_id: 'after', title: 'After', starts_at: '2026-11-03T10:00:00Z', ends_at: '2026-11-03T11:00:00Z' },
    ]);

    const titles = (await loadOccurrences(await asHouseholdAccount(account), WINDOW.from, WINDOW.to)).map((occurrence) => occurrence.title);
    expect(titles).toEqual(['Trip', 'Late']);
  });
});

// The same event in two Mirrored Calendars reads as one Occurrence naming everyone whose calendar holds a copy (#244).
describe('calendar_occurrences: duplicate Synced Events', () => {
  async function arrangeProfiles(account: HouseholdAccount, names: string[]) {
    const phone = await asHouseholdAccount(account);
    const profiles = [];
    for (const [index, name] of names.entries()) {
      profiles.push(await createProfile(phone, account.household.id, { name, color: PROFILE_PALETTE[index]!.hex, avatar_url: null }, index));
    }
    return { phone, profiles };
  }

  const copy = (id: string, extra: Partial<EventInput> = {}): EventInput => ({ ...lunch, google_event_id: id, ...extra });
  const read = (client: Awaited<ReturnType<typeof asHouseholdAccount>>) => loadOccurrences(client, WINDOW.from, WINDOW.to);

  // The client does not read colour, so these tests ask the view for it directly.
  async function loadOccurrencesWithColors(client: Awaited<ReturnType<typeof asHouseholdAccount>>) {
    const { data, error } = await client.from('calendar_occurrences').select('title, color, colors, profile_ids').order('starts_at').order('title');
    if (error) throw error;
    return data as { title: string; color: string | null; colors: string[]; profile_ids: string[] }[];
  }

  it('reads one row for two Profiles’ copies, naming both and the calendars', async () => {
    const account = await arrange();
    const { phone, profiles } = await arrangeProfiles(account, ['Mom', 'Dad']);
    const mom = await arrangeCalendar(account, { name: 'Mom', profileId: profiles[0]!.id });
    const dad = await arrangeCalendar(account, { name: 'Dad', profileId: profiles[1]!.id });
    await arrangeEvents(mom.calendarId, [copy('a', { description: 'Bring snacks', location: 'Room 4' })]);
    await arrangeEvents(dad.calendarId, [copy('b', { description: 'Other notes', location: 'Elsewhere' })]);

    const rows = await read(phone);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.profile_ids.slice().sort()).toEqual([profiles[0]!.id, profiles[1]!.id].sort());
    expect(rows[0]!.calendar_name).toBe('Dad, Mom');
    // Notes and location come from one copy, never joined.
    expect(['Bring snacks', 'Other notes']).toContain(rows[0]!.description);
    expect(['Room 4', 'Elsewhere']).toContain(rows[0]!.location);
  });

  it('takes the first non-empty notes and location when the representative has none', async () => {
    const account = await arrange();
    const a = await arrangeCalendar(account, { name: 'A' });
    const b = await arrangeCalendar(account, { name: 'B' });
    await arrangeEvents(a.calendarId, [copy('a')]);
    await arrangeEvents(b.calendarId, [copy('b', { description: 'Notes', location: 'Hall' })]);
    // Whichever copy is the representative, the row carries the one non-empty value.
    expect(await read(await asHouseholdAccount(account))).toMatchObject([{ description: 'Notes', location: 'Hall' }]);
  });

  it('merges titles that differ only in case and spacing, and keeps the representative’s own title', async () => {
    const account = await arrange();
    const a = await arrangeCalendar(account, { name: 'A' });
    const b = await arrangeCalendar(account, { name: 'B' });
    await arrangeEvents(a.calendarId, [copy('a', { title: 'No   Daycare' })]);
    await arrangeEvents(b.calendarId, [copy('b', { title: '  no daycare ' })]);

    const rows = await read(await asHouseholdAccount(account));
    expect(rows).toHaveLength(1);
    expect(['No   Daycare', '  no daycare ']).toContain(rows[0]!.title);
  });

  it('does not merge copies that differ in start, end or all-day', async () => {
    const account = await arrange();
    const a = await arrangeCalendar(account, { name: 'A' });
    const b = await arrangeCalendar(account, { name: 'B' });
    const day = { starts_at: '2026-10-05T05:00:00Z', ends_at: '2026-10-06T05:00:00Z' };
    await arrangeEvents(a.calendarId, [copy('base'), copy('start', { title: 'S' }), copy('end', { title: 'E' }), copy('day', { title: 'D', ...day })]);
    await arrangeEvents(b.calendarId, [
      copy('base'),
      copy('start', { title: 'S', starts_at: '2026-10-05T17:30:00Z' }),
      copy('end', { title: 'E', ends_at: '2026-10-05T18:30:00Z' }),
      copy('day', { title: 'D', ...day, is_all_day: true }),
    ]);

    const rows = await read(await asHouseholdAccount(account));
    expect(rows.map((row) => row.title).sort()).toEqual(['D', 'D', 'E', 'E', 'Lunch', 'S', 'S']);
  });

  it('is whole-Household (no Profiles) when any copy is on a whole-Household calendar', async () => {
    const account = await arrange();
    const { phone, profiles } = await arrangeProfiles(account, ['Mom']);
    const mom = await arrangeCalendar(account, { name: 'Mom', profileId: profiles[0]!.id });
    const family = await arrangeCalendar(account, { name: 'Family' });
    await arrangeEvents(mom.calendarId, [copy('a')]);
    await arrangeEvents(family.calendarId, [copy('b')]);

    const rows = await read(phone);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ profile_ids: [], profile_id: null });
  });

  it('names a Profile once when two of their calendars hold the event', async () => {
    const account = await arrange();
    const { phone, profiles } = await arrangeProfiles(account, ['Mom']);
    const work = await arrangeCalendar(account, { name: 'Work', profileId: profiles[0]!.id });
    const home = await arrangeCalendar(account, { name: 'Home', profileId: profiles[0]!.id });
    await arrangeEvents(work.calendarId, [copy('a')]);
    await arrangeEvents(home.calendarId, [copy('b')]);

    const rows = await read(phone);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.profile_ids).toEqual([profiles[0]!.id]);
    expect(rows[0]!.profile_id).toBe(profiles[0]!.id);
  });

  it('keeps untitled events separate, since a missing title says nothing about being the same event', async () => {
    const account = await arrange();
    const { phone, profiles } = await arrangeProfiles(account, ['Mom', 'Dad']);
    const mom = await arrangeCalendar(account, { name: 'Mom', profileId: profiles[0]!.id });
    const dad = await arrangeCalendar(account, { name: 'Dad', profileId: profiles[1]!.id });
    // Both providers store an event with no title as '(No title)'.
    await arrangeEvents(mom.calendarId, [copy('a', { title: '(No title)' })]);
    await arrangeEvents(dad.calendarId, [copy('b', { title: ' (no  title) ' })]);

    const rows = await read(phone);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.profile_ids).sort()).toEqual([[profiles[0]!.id], [profiles[1]!.id]].sort());
  });

  it('keeps a Native Event with the same title and time separate', async () => {
    const account = await arrange();
    const a = await arrangeCalendar(account, { name: 'A' });
    await arrangeEvents(a.calendarId, [copy('a')]);
    const { error } = await asServiceRole()
      .from('native_events')
      .insert({ household_id: account.household.id, title: lunch.title, starts_at: lunch.starts_at, ends_at: lunch.ends_at });
    if (error) throw error;

    const rows = await read(await asHouseholdAccount(account));
    expect(rows.map((row) => row.source).sort()).toEqual(['native', 'synced']);
  });

  it('keeps the merged id when the sync writes the copies again, and when the other copy goes', async () => {
    const account = await arrange();
    const phone = await asHouseholdAccount(account);
    const a = await arrangeCalendar(account, { name: 'A' });
    const b = await arrangeCalendar(account, { name: 'B' });
    await arrangeEvents(a.calendarId, [copy('a')]);
    await arrangeEvents(b.calendarId, [copy('b')]);
    const [first] = await read(phone);

    await arrangeEvents(b.calendarId, [copy('b')]);
    await arrangeEvents(a.calendarId, [copy('a')]);
    const [again] = await read(phone);
    expect(again!.id).toBe(first!.id);

    // The id is the representative copy's own, so it survives when the other copy goes.
    const { data: rows } = await asServiceRole().from('synced_events').select('id, mirrored_calendar_id').eq('household_id', account.household.id);
    const kept = rows!.find((row) => row.id === first!.id)!;
    await arrangeEvents(kept.mirrored_calendar_id === a.calendarId ? b.calendarId : a.calendarId, []);
    const [alone] = await read(phone);
    expect(alone!.id).toBe(first!.id);
  });

  it('keeps the merged id when a copy with a lower id arrives later', async () => {
    const account = await arrange();
    const phone = await asHouseholdAccount(account);
    const mom = await arrangeCalendar(account, { name: 'Mom' });
    const dad = await arrangeCalendar(account, { name: 'Dad' });
    await arrangeEvents(mom.calendarId, [copy('a')]);
    const [first] = await read(phone);

    // Dad accepts the invite later, and his copy happens to draw the lowest id there is.
    const { error } = await asServiceRole()
      .from('synced_events')
      .insert({ id: '00000000-0000-0000-0000-000000000001', created_at: new Date(Date.now() + 60_000).toISOString(), household_id: account.household.id, mirrored_calendar_id: dad.calendarId, ...copy('b') });
    if (error) throw error;

    const rows = await read(phone);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.calendar_name).toBe('Dad, Mom');
    expect(rows[0]!.id).toBe(first!.id);
  });

  it('lines the colors up with the Profiles, and has none for a whole-Household merge', async () => {
    const account = await arrange();
    const phone = await asHouseholdAccount(account);
    // The lower id has the higher hex, so sorting colors on their own would put them out of step.
    const low = { id: '00000000-0000-0000-0000-0000000000a1', color: '#ffaa00' };
    const high = { id: 'ffffffff-0000-0000-0000-0000000000a2', color: '#00aaff' };
    for (const [index, profile] of [low, high].entries()) {
      const { error } = await asServiceRole().from('profiles').insert({ ...profile, household_id: account.household.id, name: `P${index}`, sort_order: index });
      if (error) throw error;
    }
    const a = await arrangeCalendar(account, { name: 'A', profileId: low.id });
    const b = await arrangeCalendar(account, { name: 'B', profileId: high.id });
    const family = await arrangeCalendar(account, { name: 'Family' });
    await arrangeEvents(a.calendarId, [copy('a')]);
    await arrangeEvents(b.calendarId, [copy('b')]);

    const [merged] = await loadOccurrencesWithColors(phone);
    expect(merged!.profile_ids).toEqual([low.id, high.id]);
    expect(merged!.colors).toEqual([low.color, high.color]);

    await arrangeEvents(family.calendarId, [copy('c')]);
    const [whole] = await loadOccurrencesWithColors(phone);
    expect(whole).toMatchObject({ profile_ids: [], colors: [] });
  });

  it('gives a single copy the colors it always had', async () => {
    const account = await arrange();
    const { phone, profiles } = await arrangeProfiles(account, ['Mom']);
    const mom = await arrangeCalendar(account, { name: 'Mom', profileId: profiles[0]!.id, color: '#123456' });
    const family = await arrangeCalendar(account, { name: 'Family', color: '#654321' });
    const plain = await arrangeCalendar(account, { name: 'Plain' });
    await arrangeEvents(mom.calendarId, [copy('a', { title: 'One' })]);
    await arrangeEvents(family.calendarId, [copy('b', { title: 'Two' })]);
    await arrangeEvents(plain.calendarId, [copy('c', { title: 'Three' })]);

    const rows = await loadOccurrencesWithColors(phone);
    const by = (title: string) => rows.find((row) => row.title === title)!;
    expect(by('One')).toMatchObject({ color: '#123456', colors: ['#123456'] });
    expect(by('Two')).toMatchObject({ color: '#654321', colors: ['#654321'], profile_ids: [] });
    expect(by('Three')).toMatchObject({ color: null, colors: [] });
  });

  it('does not count a copy on a deselected calendar', async () => {
    const account = await arrange();
    const { phone, profiles } = await arrangeProfiles(account, ['Mom', 'Dad']);
    const mom = await arrangeCalendar(account, { name: 'Mom', profileId: profiles[0]!.id });
    const dad = await arrangeCalendar(account, { name: 'Dad', profileId: profiles[1]!.id, selected: false });
    await arrangeEvents(mom.calendarId, [copy('a')]);
    const { error } = await asServiceRole().from('synced_events').insert({ household_id: account.household.id, mirrored_calendar_id: dad.calendarId, ...copy('b') });
    if (error) throw error;

    const rows = await read(phone);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ profile_ids: [profiles[0]!.id], calendar_name: 'Mom' });
  });

  it('never merges across Households', async () => {
    const account = await arrange();
    const other = await arrange();
    await arrangeEvents((await arrangeCalendar(account)).calendarId, [copy('a')]);
    await arrangeEvents((await arrangeCalendar(other)).calendarId, [copy('b')]);

    expect(await read(await asHouseholdAccount(account))).toHaveLength(1);
    expect(await read(await asHouseholdAccount(other))).toHaveLength(1);
  });
});

// The phone's list reads Occurrences, a Repeat's included, so it is read a page at a time like a month is.
describe('reading the view a page at a time', () => {
  const row = (n: number) => ({ source: 'native', id: `row-${String(n).padStart(5, '0')}` });

  it('asks for the next 1000 rows until a page comes back short', async () => {
    const asked: [number, number][] = [];
    const rows = await readPages(async (first, last) => {
      asked.push([first, last]);
      return { data: Array.from({ length: Math.min(last, 2499) - first + 1 }, (_, index) => row(first + index)), error: null };
    });
    expect(asked).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    expect(rows).toHaveLength(2500);
  });

  it('keeps an occurrence that moved between two requests once', async () => {
    const rows = await readPages(async (first) => ({ data: first === 0 ? Array.from({ length: 1000 }, (_, index) => row(index)) : [row(999), row(1000)], error: null }));
    expect(rows.map((found) => found.id)).toHaveLength(1001);
    expect(new Set(rows.map((found) => found.id)).size).toBe(1001);
  });

  it('is one request for a short answer, and none is lost when a page is exactly full', async () => {
    const asked: [number, number][] = [];
    expect(await readPages(async (first, last) => (asked.push([first, last]), { data: [row(0)], error: null }))).toHaveLength(1);
    expect(asked).toEqual([[0, 999]]);
    const full = await readPages(async (first) => ({ data: first === 0 ? Array.from({ length: 1000 }, (_, index) => row(index)) : [], error: null }));
    expect(full).toHaveLength(1000);
  });

  it('throws what the database said', async () => {
    await expect(readPages(async () => ({ data: null, error: new Error('no') }))).rejects.toThrow('no');
  });

  it('reads the phone\'s whole upcoming list, past the 1000 rows one request gives, in start order', async () => {
    const account = await arrange();
    const phone = await asHouseholdAccount(account);
    const CHICAGO = 'America/Chicago';
    // Two events every day from tomorrow: about 730 Occurrences each, two years ahead.
    const first = addDays(householdDay(CHICAGO).date, 1);
    const at = (time: string) => new Date(instantAt(first, time, CHICAGO)).toISOString();
    for (const [title, start, end] of [['Pills', '08:00', '08:15'], ['Walk', '17:00', '17:30']] as const) {
      await saveNativeEvent(phone, {
        title, location: null, notes: null, starts_at: at(start), ends_at: at(end), is_all_day: false, profile_ids: [],
        repeat_every: 'day', repeat_interval: 1, repeat_days: null, repeat_until: null,
      });
    }
    await saveNativeEvent(phone, { title: 'Dentist', location: null, notes: null, starts_at: at('12:00'), ends_at: at('13:00'), is_all_day: false, profile_ids: [], repeat_every: null, repeat_interval: 1, repeat_days: null, repeat_until: null });

    const upcoming = await loadUpcomingNativeEvents(phone, new Date());

    const { count } = await asServiceRole().from('calendar_occurrences').select('id', { count: 'exact', head: true }).eq('household_id', account.household.id);
    expect(count).toBeGreaterThan(1400);
    expect(upcoming).toHaveLength(count!);
    expect(new Set(upcoming.map((found) => found.id)).size).toBe(count);
    const starts = upcoming.map((found) => Date.parse(found.starts_at));
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    // The far end of the two years is there, which one request would have cut off.
    expect(upcoming.at(-1)!.starts_at.slice(0, 4)).toBe(String(Number(first.slice(0, 4)) + 2));
  });
});
