import { afterEach, describe, expect, it } from 'vitest';
import { loadOccurrences, type Occurrence } from '../src/lib/calendar-occurrences';
import { PROFILE_PALETTE, createProfile } from '../src/lib/profiles';
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
      const { error } = await client.rpc('replace_synced_events', { p_mirrored_calendar_id: calendarId, p_events: forged, p_sync_token: 'forged' });
      // 42501: refused for want of permission, not a missing function or a bad argument.
      expect(error?.code).toBe('42501');
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
  it('attributes an event to its Mirrored Calendar’s Profile and colour', async () => {
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
      color: profile.color,
      is_all_day: false,
    });
  });

  it('prefers the calendar’s own colour over its Profile’s', async () => {
    const account = await arrange();
    const phone = await asHouseholdAccount(account);
    const profile = await createProfile(phone, account.household.id, { name: 'Ada', color: PROFILE_PALETTE[0].hex, avatar_url: null }, 0);
    const { calendarId } = await arrangeCalendar(account, { profileId: profile.id, color: '#abcdef' });
    await arrangeEvents(calendarId, [lunch]);

    const [occurrence] = await loadOccurrences(phone, WINDOW.from, WINDOW.to);
    expect(occurrence).toMatchObject({ profile_id: profile.id, color: '#abcdef' });
  });

  it('shows a whole-Household calendar with no Profile and no colour', async () => {
    const account = await arrange();
    const { calendarId } = await arrangeCalendar(account);
    await arrangeEvents(calendarId, [lunch]);

    const [occurrence] = await loadOccurrences(await asHouseholdAccount(account), WINDOW.from, WINDOW.to);
    expect(occurrence).toMatchObject({ profile_id: null, color: null });
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
