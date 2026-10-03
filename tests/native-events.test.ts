import { afterEach, describe, expect, it } from 'vitest';
import { loadOccurrences, type Occurrence } from '../src/lib/calendar-occurrences';
import {
  blankEventForm,
  deleteNativeEvent,
  eventFormFromOccurrence,
  eventFormToInput,
  saveNativeEvent,
  type NativeEventInput,
} from '../src/lib/native-events';
import { PROFILE_PALETTE, createProfile, deleteProfile, type Profile } from '../src/lib/profiles';
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

async function arrangeDevice(account: HouseholdAccount): Promise<Tablet> {
  const device = await asDevice(account);
  tablets.push(device);
  return device;
}

const WINDOW = { from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-11-01T00:00:00Z') };

const plumber: NativeEventInput = {
  title: 'Plumber',
  location: '12 Elm St',
  notes: 'Back door key under the pot',
  starts_at: '2026-10-08T19:00:00Z',
  ends_at: '2026-10-08T20:00:00Z',
  is_all_day: false,
  profile_ids: [],
};

async function profiles(account: HouseholdAccount, ...names: string[]): Promise<Profile[]> {
  const phone = await asHouseholdAccount(account);
  const made: Profile[] = [];
  for (const [index, name] of names.entries()) {
    made.push(await createProfile(phone, account.household.id, { name, color: PROFILE_PALETTE[index]!.hex, avatar_url: null }, index));
  }
  return made;
}

describe('native events', () => {
  it('lets a Device create, edit and delete a Native Event', async () => {
    const account = await arrange();
    const device = await arrangeDevice(account);

    const id = await saveNativeEvent(device.client, plumber);
    let [occurrence] = await loadOccurrences(device.client, WINDOW.from, WINDOW.to);
    expect(occurrence).toMatchObject<Partial<Occurrence>>({
      source: 'native',
      id,
      title: 'Plumber',
      location: '12 Elm St',
      description: 'Back door key under the pot',
      starts_at: '2026-10-08T19:00:00+00:00',
      is_all_day: false,
    });

    await saveNativeEvent(device.client, { ...plumber, title: 'Plumber, moved', starts_at: '2026-10-09T15:00:00Z', ends_at: '2026-10-09T16:30:00Z', location: null }, id);
    const edited = await loadOccurrences(device.client, WINDOW.from, WINDOW.to);
    expect(edited).toHaveLength(1);
    [occurrence] = edited;
    expect(occurrence).toMatchObject({ id, title: 'Plumber, moved', location: null, starts_at: '2026-10-09T15:00:00+00:00' });

    await deleteNativeEvent(device.client, id);
    expect(await loadOccurrences(device.client, WINDOW.from, WINDOW.to)).toEqual([]);
  });

  it('lets a Household Account create, edit and delete a Native Event', async () => {
    const account = await arrange();
    const phone = await asHouseholdAccount(account);

    const id = await saveNativeEvent(phone, { ...plumber, is_all_day: true, starts_at: '2026-10-08T05:00:00Z', ends_at: '2026-10-09T05:00:00Z' });
    expect(await loadOccurrences(phone, WINDOW.from, WINDOW.to)).toMatchObject([{ source: 'native', id, is_all_day: true }]);

    await saveNativeEvent(phone, { ...plumber, title: 'Renamed' }, id);
    expect((await loadOccurrences(phone, WINDOW.from, WINDOW.to))[0]?.title).toBe('Renamed');

    await deleteNativeEvent(phone, id);
    expect(await loadOccurrences(phone, WINDOW.from, WINDOW.to)).toEqual([]);
  });

  it('refuses a blank title and an event that ends before it starts', async () => {
    const account = await arrange();
    const phone = await asHouseholdAccount(account);

    await expect(saveNativeEvent(phone, { ...plumber, title: '   ' })).rejects.toMatchObject({ code: '23514' });
    await expect(saveNativeEvent(phone, { ...plumber, ends_at: '2026-10-08T18:00:00Z' })).rejects.toMatchObject({ code: '23514' });
    expect(await loadOccurrences(phone, WINDOW.from, WINDOW.to)).toEqual([]);
  });

  it('keeps one Household’s Native Events from another’s principals', async () => {
    const account = await arrange();
    const other = await arrange();
    const id = await saveNativeEvent(await asHouseholdAccount(account), plumber);
    const otherPhone = await asHouseholdAccount(other);
    const otherDevice = await arrangeDevice(other);

    for (const client of [otherPhone, otherDevice.client]) {
      expect(await loadOccurrences(client, WINDOW.from, WINDOW.to)).toEqual([]);
      // Neither an edit nor a delete reaches a row the principal cannot see.
      await expect(saveNativeEvent(client, { ...plumber, title: 'Hijacked' }, id)).rejects.toBeTruthy();
      await client.from('native_events').delete().eq('id', id);
      const forged = await client.from('native_events').insert({ household_id: account.household.id, title: 'Forged', starts_at: plumber.starts_at, ends_at: plumber.ends_at });
      expect(forged.error).not.toBeNull();
    }

    const { data } = await asServiceRole().from('native_events').select('title').eq('id', id);
    expect(data).toEqual([{ title: 'Plumber' }]);
  });

  it('is unreadable and unwritable without a session', async () => {
    const account = await arrange();
    await saveNativeEvent(await asHouseholdAccount(account), plumber);
    const anonymous = asAnonymous();

    const { data, error } = await anonymous.from('native_events').select('id');
    expect(error !== null || (data ?? []).length === 0).toBe(true);
    await expect(saveNativeEvent(anonymous, plumber)).rejects.toBeTruthy();
  });

  it('refuses a Profile from another Household', async () => {
    const account = await arrange();
    const other = await arrange();
    const [foreign] = await profiles(other, 'Eve');
    const phone = await asHouseholdAccount(account);

    await expect(saveNativeEvent(phone, { ...plumber, profile_ids: [foreign!.id] })).rejects.toBeTruthy();
    // The event is not left behind, attributed to the whole Household.
    expect(await loadOccurrences(phone, WINDOW.from, WINDOW.to)).toEqual([]);
  });
});

describe('synced events stay untouchable', () => {
  it('a Device cannot modify a Synced Event through any Native Event path', async () => {
    const account = await arrange();
    const { calendarId } = await arrangeCalendar(account);
    await arrangeEvents(calendarId, [{ google_event_id: 'lunch', title: 'Lunch', starts_at: '2026-10-05T17:00:00Z', ends_at: '2026-10-05T18:00:00Z' }]);
    const device = await arrangeDevice(account);
    const [lunch] = await loadOccurrences(device.client, WINDOW.from, WINDOW.to);
    expect(lunch).toMatchObject({ source: 'synced', title: 'Lunch' });

    // The Synced Event's id is not a Native Event's: saving over it finds no row, and nothing is created.
    await expect(saveNativeEvent(device.client, { ...plumber, title: 'Overwritten' }, lunch!.id)).rejects.toBeTruthy();
    await deleteNativeEvent(device.client, lunch!.id).catch(() => undefined);
    await device.client.from('synced_events').update({ title: 'Overwritten' }).eq('id', lunch!.id);
    await device.client.from('synced_events').delete().eq('id', lunch!.id);
    expect((await device.client.from('synced_events').insert({ household_id: account.household.id, mirrored_calendar_id: calendarId, google_event_id: 'x', title: 'x', starts_at: plumber.starts_at, ends_at: plumber.ends_at })).error).not.toBeNull();

    const { data } = await asServiceRole().from('synced_events').select('title').eq('mirrored_calendar_id', calendarId);
    expect(data).toEqual([{ title: 'Lunch' }]);
    expect(await loadOccurrences(device.client, WINDOW.from, WINDOW.to)).toMatchObject([{ source: 'synced', title: 'Lunch' }]);
  });
});

describe('calendar_occurrences attribution of Native Events', () => {
  it('attributes an event with no Profiles to the whole Household', async () => {
    const account = await arrange();
    const phone = await asHouseholdAccount(account);
    await saveNativeEvent(phone, plumber);

    const [occurrence] = await loadOccurrences(phone, WINDOW.from, WINDOW.to);
    expect(occurrence).toMatchObject<Partial<Occurrence>>({ source: 'native', profile_id: null, profile_ids: [] });
  });

  it('attributes an event to its one Profile', async () => {
    const account = await arrange();
    const [ada] = await profiles(account, 'Ada');
    const device = await arrangeDevice(account);
    await saveNativeEvent(device.client, { ...plumber, profile_ids: [ada!.id] });

    const [occurrence] = await loadOccurrences(device.client, WINDOW.from, WINDOW.to);
    expect(occurrence).toMatchObject<Partial<Occurrence>>({ profile_id: ada!.id, profile_ids: [ada!.id] });
  });

  it('attributes an event with two Profiles to both, in Profile order, led by the first', async () => {
    const account = await arrange();
    const [ada, ben] = await profiles(account, 'Ada', 'Ben');
    const phone = await asHouseholdAccount(account);
    // Named in the opposite order: attribution follows the Profiles' own order.
    await saveNativeEvent(phone, { ...plumber, profile_ids: [ben!.id, ada!.id] });

    const [occurrence] = await loadOccurrences(phone, WINDOW.from, WINDOW.to);
    expect(occurrence).toMatchObject<Partial<Occurrence>>({
      profile_id: ada!.id,
      profile_ids: [ada!.id, ben!.id],
    });
  });

  it('replaces the Profiles on an edit, and clears them for the whole Household', async () => {
    const account = await arrange();
    const [ada, ben] = await profiles(account, 'Ada', 'Ben');
    const phone = await asHouseholdAccount(account);
    const id = await saveNativeEvent(phone, { ...plumber, profile_ids: [ada!.id] });

    await saveNativeEvent(phone, { ...plumber, profile_ids: [ben!.id] }, id);
    expect((await loadOccurrences(phone, WINDOW.from, WINDOW.to))[0]?.profile_ids).toEqual([ben!.id]);

    await saveNativeEvent(phone, { ...plumber, profile_ids: [] }, id);
    expect((await loadOccurrences(phone, WINDOW.from, WINDOW.to))[0]).toMatchObject({ profile_ids: [] });
  });

  it('removes a deleted Profile’s attribution and keeps the event, household-attributed', async () => {
    const account = await arrange();
    const [ada] = await profiles(account, 'Ada');
    const phone = await asHouseholdAccount(account);
    const id = await saveNativeEvent(phone, { ...plumber, profile_ids: [ada!.id] });

    await deleteProfile(phone, ada!.id);

    const [occurrence] = await loadOccurrences(phone, WINDOW.from, WINDOW.to);
    expect(occurrence).toMatchObject({ id, title: 'Plumber', profile_id: null, profile_ids: [] });
    const { data } = await asServiceRole().from('native_event_profiles').select('profile_id').eq('native_event_id', id);
    expect(data).toEqual([]);
  });

  it('deletes the join rows with the event', async () => {
    const account = await arrange();
    const [ada] = await profiles(account, 'Ada');
    const device = await arrangeDevice(account);
    const id = await saveNativeEvent(device.client, { ...plumber, profile_ids: [ada!.id] });

    await deleteNativeEvent(device.client, id);
    const { data } = await asServiceRole().from('native_event_profiles').select('profile_id').eq('native_event_id', id);
    expect(data).toEqual([]);
  });

  it('lists Native Events beside Synced Events in start order, marked by their source', async () => {
    const account = await arrange();
    const { calendarId } = await arrangeCalendar(account, { name: 'Family' });
    await arrangeEvents(calendarId, [{ google_event_id: 'lunch', title: 'Lunch', starts_at: '2026-10-08T17:00:00Z', ends_at: '2026-10-08T18:00:00Z' }]);
    const phone = await asHouseholdAccount(account);
    await saveNativeEvent(phone, plumber);

    const rows = await loadOccurrences(phone, WINDOW.from, WINDOW.to);
    expect(rows.map((row) => [row.source, row.title])).toEqual([
      ['synced', 'Lunch'],
      ['native', 'Plumber'],
    ]);
    expect(rows[0]).toMatchObject({ calendar_id: calendarId, profile_ids: [] });
  });
});

// The sheet's form, in the Household Timezone and never the machine's.
describe('the Native Event form', () => {
  const CHICAGO = 'America/Chicago';
  const form = { ...blankEventForm('2026-10-08'), title: ' Plumber ', startTime: '14:00', endTime: '15:30' };

  it('turns wall-clock times into instants in the Household Timezone', () => {
    expect(eventFormToInput(form, CHICAGO)).toEqual({
      title: 'Plumber',
      location: null,
      notes: null,
      starts_at: '2026-10-08T19:00:00.000Z',
      ends_at: '2026-10-08T20:30:00.000Z',
      is_all_day: false,
      profile_ids: [],
    });
    // The same wall time in another zone is another instant: nothing reads the machine's zone.
    expect(eventFormToInput(form, 'Pacific/Auckland')).toMatchObject({ starts_at: '2026-10-08T01:00:00.000Z' });
  });

  it('keeps the wall clock across a daylight saving change', () => {
    // Chicago went back from CDT to CST on 2026-11-01.
    const input = eventFormToInput({ ...form, ...{ date: '2026-11-02' } }, CHICAGO);
    expect(input).toMatchObject({ starts_at: '2026-11-02T20:00:00.000Z' });
  });

  it('is right on the day of a daylight saving change itself', () => {
    const at = (date: string, time: string, zone = CHICAGO) => (eventFormToInput({ ...form, date, startTime: time, endTime: '23:00' }, zone) as NativeEventInput).starts_at;
    // Spring forward (Chicago, 2027-03-14): 02:30 does not exist, and moves on to 03:30 CDT, never back.
    expect(at('2027-03-14', '01:30')).toBe('2027-03-14T07:30:00.000Z');
    expect(at('2027-03-14', '02:30')).toBe('2027-03-14T08:30:00.000Z');
    expect(at('2027-03-14', '03:30')).toBe('2027-03-14T08:30:00.000Z');
    // The same in a zone east of UTC (Berlin, 2027-03-28).
    expect(at('2027-03-28', '02:30', 'Europe/Berlin')).toBe('2027-03-28T01:30:00.000Z');
    // Fall back (Chicago, 2026-11-01): 01:30 happens twice, and the first is meant.
    expect(at('2026-11-01', '01:30')).toBe('2026-11-01T06:30:00.000Z');
    expect(at('2026-11-01', '02:30')).toBe('2026-11-01T08:30:00.000Z');
  });

  it('makes an all-day event the Household day, ending at the next midnight', () => {
    expect(eventFormToInput({ ...form, allDay: true }, CHICAGO)).toMatchObject({
      starts_at: '2026-10-08T05:00:00.000Z',
      ends_at: '2026-10-09T05:00:00.000Z',
      is_all_day: true,
    });
    // On a 25 hour day the next midnight is 25 hours on.
    expect(eventFormToInput({ ...blankEventForm('2026-11-01'), title: 'Clocks', allDay: true }, CHICAGO)).toMatchObject({
      starts_at: '2026-11-01T05:00:00.000Z',
      ends_at: '2026-11-02T06:00:00.000Z',
    });
  });

  it('keeps blank optional fields as none and trims the rest', () => {
    expect(eventFormToInput({ ...form, location: '  ', notes: ' Key under the pot ', profileIds: ['a', 'b'] }, CHICAGO)).toMatchObject({
      location: null,
      notes: 'Key under the pot',
      profile_ids: ['a', 'b'],
    });
  });

  it('says what is wrong instead of saving', () => {
    expect(eventFormToInput({ ...form, title: '  ' }, CHICAGO)).toEqual({ problem: 'Give the event a title.' });
    expect(eventFormToInput({ ...form, date: '' }, CHICAGO)).toEqual({ problem: 'Pick a date.' });
    expect(eventFormToInput({ ...form, startTime: '' }, CHICAGO)).toEqual({ problem: 'Pick a start and end time, or choose all day.' });
    expect(eventFormToInput({ ...form, endTime: '13:00' }, CHICAGO)).toEqual({ problem: 'The event must end after it starts.' });
    // All day needs no times.
    expect(eventFormToInput({ ...form, allDay: true, startTime: '', endTime: '' }, CHICAGO)).toHaveProperty('is_all_day', true);
  });

  it('fills the form from an occurrence, as the Household sees it', () => {
    const occurrence = {
      source: 'native',
      id: 'n1',
      calendar_id: null,
      calendar_name: 'Nidus',
      title: 'Plumber',
      description: 'Key under the pot',
      location: '12 Elm St',
      starts_at: '2026-10-08T19:00:00+00:00',
      ends_at: '2026-10-08T20:30:00+00:00',
      is_all_day: false,
      profile_id: 'a',
      profile_ids: ['a', 'b'],
    } satisfies Occurrence;
    const filled = eventFormFromOccurrence(occurrence, CHICAGO);
    expect(filled).toEqual({
      title: 'Plumber',
      date: '2026-10-08',
      allDay: false,
      startTime: '14:00',
      endTime: '15:30',
      location: '12 Elm St',
      notes: 'Key under the pot',
      profileIds: ['a', 'b'],
    });
    // Saving it unchanged writes the same instants back.
    expect(eventFormToInput(filled, CHICAGO)).toMatchObject({ starts_at: '2026-10-08T19:00:00.000Z', ends_at: '2026-10-08T20:30:00.000Z' });
  });

  it('fills an all-day event with no times', () => {
    const filled = eventFormFromOccurrence(
      { ...({} as Occurrence), title: 'Trip', description: null, location: null, starts_at: '2026-10-08T05:00:00Z', ends_at: '2026-10-09T05:00:00Z', is_all_day: true, profile_ids: [] },
      CHICAGO,
    );
    expect(filled).toMatchObject({ date: '2026-10-08', allDay: true });
    expect(eventFormToInput(filled, CHICAGO)).toMatchObject({ starts_at: '2026-10-08T05:00:00.000Z', ends_at: '2026-10-09T05:00:00.000Z' });
  });
});
