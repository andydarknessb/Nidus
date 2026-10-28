import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it } from 'vitest';
import { handleCalendarSync, type SyncDeps } from '../supabase/functions/calendar-sync/handler';
import { loadOccurrences } from '../src/lib/calendar-occurrences';
import { PROFILE_PALETTE, createProfile } from '../src/lib/profiles';
import { arrangeCalendar, arrangeEvents } from './support/calendar';
import { eventCalls, fakeGoogle } from './support/google';
import {
  asDevice,
  asHouseholdAccount,
  asServiceRole,
  createHousehold,
  destroyHousehold,
  destroyTablet,
  type HouseholdAccount,
  type Tablet,
} from './support/supabase';

// A time zone change re-anchors Native Events (spec 0016, ticket #271): each keeps the Household Date and
// clock time it was entered with, so its instants move. Every test is a real principal against the local
// stack; the only fake is Google. createHousehold starts in America/Chicago, so each test first moves its
// Household (still empty) to the zone the story starts in.

const NEW_YORK = 'America/New_York';
const LOS_ANGELES = 'America/Los_Angeles';

let households: HouseholdAccount[] = [];
let tablets: Tablet[] = [];

afterEach(async () => {
  for (const tablet of tablets) await destroyTablet(tablet);
  for (const account of households) await destroyHousehold(account);
  households = [];
  tablets = [];
});

async function arrange(timezone: string): Promise<HouseholdAccount> {
  const account = await createHousehold();
  households.push(account);
  await setZone(account, timezone);
  return account;
}

// Settings' save: a Household Account updates its own Household.
async function setZone(account: HouseholdAccount, timezone: string): Promise<void> {
  const phone = await asHouseholdAccount(account);
  const { error } = await phone.from('households').update({ timezone }).eq('id', account.household.id);
  if (error) throw error;
}

type Event = { title?: string; starts_at: string; ends_at: string; is_all_day?: boolean; profile_ids?: string[] };
type Shape = { every?: 'day' | 'week' | 'month' | 'year'; until?: string; skipOn?: string };

async function save(client: SupabaseClient, householdId: string, event: Event, shape: Shape = {}): Promise<string> {
  const { data, error } = await client.rpc('save_native_event', {
    p_id: null,
    p_title: event.title ?? 'Soccer',
    p_location: null,
    p_notes: null,
    p_starts_at: event.starts_at,
    p_ends_at: event.ends_at,
    p_is_all_day: event.is_all_day ?? false,
    p_profile_ids: event.profile_ids ?? [],
    p_repeat_every: shape.every ?? null,
    p_repeat_interval: 1,
    p_repeat_days: null,
    p_repeat_until: shape.until ?? null,
    p_skip_event: null,
    p_skip_on: null,
  });
  if (error) throw error;
  const id = data as string;
  if (shape.skipOn) {
    const { error: skipError } = await client
      .from('native_event_skips')
      .insert({ native_event_id: id, household_id: householdId, skipped_on: shape.skipOn });
    if (skipError) throw skipError;
  }
  return id;
}

async function read(client: SupabaseClient, from: string, to: string) {
  const rows = await loadOccurrences(client, new Date(from), new Date(to));
  return rows.map((row) => ({ title: row.title, starts: new Date(row.starts_at).toISOString(), ends: new Date(row.ends_at).toISOString(), profile_ids: row.profile_ids }));
}

// The raw instants of a Household's Native Events, as the service role sees them.
async function instants(account: HouseholdAccount): Promise<string[]> {
  const { data, error } = await asServiceRole()
    .from('native_events')
    .select('starts_at, ends_at')
    .eq('household_id', account.household.id)
    .order('starts_at');
  if (error) throw error;
  return (data as { starts_at: string; ends_at: string }[]).map((row) => `${new Date(row.starts_at).toISOString()} ${new Date(row.ends_at).toISOString()}`);
}

describe('a time zone change re-anchors Native Events', () => {
  it('keeps an all-day one-off, a yearly Repeat and a timed event on their Household Date and clock time', async () => {
    const account = await arrange(NEW_YORK);
    const phone = await asHouseholdAccount(account);
    const ada = await createProfile(phone, account.household.id, { name: 'Ada', color: PROFILE_PALETTE[0]!.hex, avatar_url: null }, 0);
    const ben = await createProfile(phone, account.household.id, { name: 'Ben', color: PROFILE_PALETTE[1]!.hex, avatar_url: null }, 1);

    // Oct 15 all-day; Mar 15 every year (2027 skipped, ends 2028-03-15); Oct 20, 9:00 to 10:00 AM for Ada and Ben.
    await save(phone, account.household.id, { title: 'Holiday', starts_at: '2026-10-15T04:00:00Z', ends_at: '2026-10-16T04:00:00Z', is_all_day: true });
    await save(phone, account.household.id, { title: 'Birthday', starts_at: '2026-03-15T04:00:00Z', ends_at: '2026-03-16T04:00:00Z', is_all_day: true }, { every: 'year', until: '2028-03-15', skipOn: '2027-03-15' });
    await save(phone, account.household.id, { title: 'Dentist', starts_at: '2026-10-20T13:00:00Z', ends_at: '2026-10-20T14:00:00Z', profile_ids: [ada.id, ben.id] });

    await setZone(account, LOS_ANGELES);

    const rows = await read(phone, '2026-01-01T00:00:00Z', '2029-01-01T00:00:00Z');
    expect(rows.map((row) => `${row.title} ${row.starts} ${row.ends}`)).toEqual([
      'Birthday 2026-03-15T07:00:00.000Z 2026-03-16T07:00:00.000Z',
      'Holiday 2026-10-15T07:00:00.000Z 2026-10-16T07:00:00.000Z',
      'Dentist 2026-10-20T16:00:00.000Z 2026-10-20T17:00:00.000Z',
      'Birthday 2028-03-15T07:00:00.000Z 2028-03-16T07:00:00.000Z',
    ]);
    expect(rows.find((row) => row.title === 'Dentist')!.profile_ids).toEqual([ada.id, ben.id]);

    // A Device in the same Household reads the same Occurrences.
    const device = await asDevice(account);
    tablets.push(device);
    expect(await read(device.client, '2026-01-01T00:00:00Z', '2029-01-01T00:00:00Z')).toEqual(rows);
  });

  it('puts a time the new zone passes twice on the first of the two, and moves a time it skips forward by the gap', async () => {
    const account = await arrange('UTC');
    const phone = await asHouseholdAccount(account);
    await save(phone, account.household.id, { title: 'Twice', starts_at: '2026-11-01T01:30:00Z', ends_at: '2026-11-01T02:30:00Z' });
    await save(phone, account.household.id, { title: 'Skipped', starts_at: '2026-03-08T02:30:00Z', ends_at: '2026-03-08T03:30:00Z' });

    await setZone(account, LOS_ANGELES);

    // 1:30 AM on Nov 1 happens at 08:30Z (PDT) and 09:30Z (PST); 2:30 AM on Mar 8 is skipped, so 3:30 AM PDT.
    expect(await instants(account)).toEqual([
      '2026-03-08T10:30:00.000Z 2026-03-08T10:30:00.000Z',
      '2026-11-01T08:30:00.000Z 2026-11-01T10:30:00.000Z',
    ]);
  });

  it('never ends an event before it starts, when only its start falls in the skipped hour', async () => {
    const account = await arrange('UTC');
    const phone = await asHouseholdAccount(account);
    await save(phone, account.household.id, { starts_at: '2026-03-08T02:45:00Z', ends_at: '2026-03-08T03:15:00Z' });

    await setZone(account, LOS_ANGELES);

    // The start moves forward to 3:45 AM PDT; the end is already past it, so the event shrinks to nothing.
    expect(await instants(account)).toEqual(['2026-03-08T10:45:00.000Z 2026-03-08T10:45:00.000Z']);
  });

  it('makes the next sync run read every Mirrored Calendar of the Household in full, and writes no Synced Event', async () => {
    const account = await arrange(NEW_YORK);
    const other = await arrange(NEW_YORK);
    const now = Date.now();
    const earlier = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const event = { google_event_id: 'a', title: 'A', starts_at: '2026-10-05T14:00:00Z', ends_at: '2026-10-05T15:00:00Z' };

    const first = await arrangeCalendar(account, { googleCalendarId: 'cal-1' });
    const second = await arrangeCalendar(account, { googleCalendarId: 'cal-2', selected: false });
    const foreign = await arrangeCalendar(other, { googleCalendarId: 'cal-3' });
    for (const { calendarId } of [first, second, foreign]) {
      await arrangeEvents(calendarId, calendarId === second.calendarId ? [] : [event], { syncToken: `tok-${calendarId}`, fullSyncAt: earlier });
    }

    await setZone(account, LOS_ANGELES);

    const admin = asServiceRole();
    const state = async (ids: string[]) => {
      const { data, error } = await admin.from('mirrored_calendars').select('id, last_full_sync_at').in('id', ids);
      if (error) throw error;
      return Object.fromEntries((data as { id: string; last_full_sync_at: string | null }[]).map((row) => [row.id, row.last_full_sync_at]));
    };
    expect(await state([first.calendarId, second.calendarId])).toEqual({ [first.calendarId]: null, [second.calendarId]: null });
    expect(Object.values(await state([foreign.calendarId]))[0]).not.toBeNull();
    const { count } = await admin.from('synced_events').select('id', { count: 'exact', head: true }).eq('mirrored_calendar_id', first.calendarId);
    expect(count).toBe(1);

    const google = fakeGoogle({ events: { 'cal-1': [] } });
    const sync: SyncDeps = {
      env: { syncSecret: 'sync-secret-that-is-long-enough-to-matter', googleClientId: 'client-id', googleClientSecret: 'client-secret' },
      admin,
      fetch: google.fetch,
      now: () => now,
      householdId: account.household.id,
    };
    const response = await handleCalendarSync(
      new Request('https://nidus.test/functions/v1/calendar-sync', { method: 'POST', headers: { 'x-sync-secret': sync.env.syncSecret } }),
      sync,
    );
    expect(response.status).toBe(200);
    const requests = eventCalls(google);
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((call) => !call.url.searchParams.has('syncToken'))).toBe(true);
  });

  it('moves nothing when only the name or Appearance changes, and nothing of another Household', async () => {
    const account = await arrange(NEW_YORK);
    const other = await arrange(NEW_YORK);
    const phone = await asHouseholdAccount(account);
    const stranger = await asHouseholdAccount(other);
    await save(phone, account.household.id, { starts_at: '2026-10-20T13:00:00Z', ends_at: '2026-10-20T14:00:00Z' });
    await save(stranger, other.household.id, { starts_at: '2026-10-21T13:00:00Z', ends_at: '2026-10-21T14:00:00Z' });
    const calendar = await arrangeCalendar(account);
    const fullSyncAt = new Date().toISOString();
    await arrangeEvents(calendar.calendarId, [], { syncToken: 'tok', fullSyncAt });
    const before = await instants(account);
    const foreignBefore = await instants(other);

    const { error } = await phone.from('households').update({ name: 'Renamed', appearance: 'dark' }).eq('id', account.household.id);
    expect(error).toBeNull();
    expect(await instants(account)).toEqual(before);
    const { data } = await asServiceRole().from('mirrored_calendars').select('last_full_sync_at').eq('id', calendar.calendarId).single<{ last_full_sync_at: string | null }>();
    expect(data!.last_full_sync_at).not.toBeNull();

    await setZone(account, LOS_ANGELES);
    expect(await instants(account)).not.toEqual(before);
    expect(await instants(other)).toEqual(foreignBefore);
  });
});
