import { afterEach, describe, expect, it } from 'vitest';
import { loadOccurrences, type Occurrence } from '../src/lib/calendar-occurrences';
import { blankEventForm, eventFormToInput, openDraft, pickDate, type Plan } from '../src/lib/event-draft';
import { repeatWords, runPlan, saveNativeEvent, type EventForm, type NativeEventInput, type Repeat } from '../src/lib/native-events';
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

const CHICAGO = 'America/Chicago';
// The Native Event an Occurrence is of: an Occurrence of a Repeat has an id of its own (ADR 0005).
const eventIdOf = (occurrence: Occurrence) => occurrence.event_id ?? occurrence.id;

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
  repeat_every: null,
  repeat_interval: 1,
  repeat_days: null,
  repeat_until: null,
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

    await runPlan(device.client, { kind: 'delete', occurrence: occurrence! }, CHICAGO);
    expect(await loadOccurrences(device.client, WINDOW.from, WINDOW.to)).toEqual([]);
  });

  it('lets a Household Account create, edit and delete a Native Event', async () => {
    const account = await arrange();
    const phone = await asHouseholdAccount(account);

    const id = await saveNativeEvent(phone, { ...plumber, is_all_day: true, starts_at: '2026-10-08T05:00:00Z', ends_at: '2026-10-09T05:00:00Z' });
    expect(await loadOccurrences(phone, WINDOW.from, WINDOW.to)).toMatchObject([{ source: 'native', id, is_all_day: true }]);

    await saveNativeEvent(phone, { ...plumber, title: 'Renamed' }, id);
    const [renamed] = await loadOccurrences(phone, WINDOW.from, WINDOW.to);
    expect(renamed?.title).toBe('Renamed');

    await runPlan(phone, { kind: 'delete', occurrence: renamed! }, CHICAGO);
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
    await runPlan(device.client, { kind: 'delete', occurrence: lunch! }, CHICAGO).catch(() => undefined);
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

    const [row] = await loadOccurrences(device.client, WINDOW.from, WINDOW.to);
    await runPlan(device.client, { kind: 'delete', occurrence: row! }, CHICAGO);
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

// ---- Repeats (spec 0013, ticket #238) ------------------------------------------------------

describe('the words of a Repeat', () => {
  const TODAY = '2026-10-13';
  const MON = 2;
  const TUE = 4;
  const WED = 8;
  const say = (repeat: Partial<Repeat>, firstDate = '2026-10-06') => repeatWords({ every: 'day', interval: 1, days: 0, until: null, ...repeat }, firstDate, TODAY);

  it('says a day, a week, a month and a year', () => {
    expect(say({})).toBe('Every day');
    expect(say({ interval: 2 })).toBe('Every 2 days');
    expect(say({ every: 'week', days: TUE })).toBe('Every week on Tuesday');
    expect(say({ every: 'week', interval: 2, days: MON | WED })).toBe('Every 2 weeks on Monday and Wednesday');
    expect(say({ every: 'week', days: 2 | 4 | 8 | 16 | 32 })).toBe('Every week on Monday, Tuesday, Wednesday, Thursday and Friday');
    expect(say({ every: 'week', days: 1 | 64 })).toBe('Every week on Sunday and Saturday');
    expect(say({ every: 'month' }, '2026-10-15')).toBe('Every month on the 15th');
    expect(say({ every: 'month', interval: 3 }, '2026-10-01')).toBe('Every 3 months on the 1st');
    expect(say({ every: 'year' })).toBe('Every year on Oct 6');
    expect(say({ every: 'year', interval: 2 }, '2028-02-29')).toBe('Every 2 years on Feb 29');
  });

  it('counts the days of a month in ordinals', () => {
    const days: [number, string][] = [[1, '1st'], [2, '2nd'], [3, '3rd'], [4, '4th'], [10, '10th'], [11, '11th'], [12, '12th'], [13, '13th'], [14, '14th'], [21, '21st'], [22, '22nd'], [23, '23rd'], [24, '24th'], [30, '30th'], [31, '31st']];
    for (const [day, ordinal] of days) expect(say({ every: 'month' }, `2026-10-${String(day).padStart(2, '0')}`)).toBe(`Every month on the ${ordinal}`);
  });

  it('ends with the day it ends on, and the year when that is not this year', () => {
    expect(say({ until: '2026-12-20' })).toBe('Every day, until Dec 20');
    expect(say({ every: 'week', days: TUE, until: '2026-12-20' })).toBe('Every week on Tuesday, until Dec 20');
    expect(say({ every: 'year', until: '2027-12-20' })).toBe('Every year on Oct 6, until Dec 20, 2027');
    expect(say({ until: '2025-12-20' })).toBe('Every day, until Dec 20, 2025');
  });

  it('uses no dash of any length', () => {
    expect(say({ every: 'week', interval: 2, days: MON | WED, until: '2027-01-02' })).not.toMatch(/[–—]/);
  });
});

// What the status line says once a plan is written (docs/specs/0015, the plan runner): the event's own day and time, in the Household
// Timezone and never the machine's. The event is written, so these run against the local stack.
describe('what the status line says after an event is added', () => {
  const form = (startTime: string, endTime: string): EventForm => ({ ...blankEventForm('2026-10-02'), startTime, endTime });
  const input = (value: EventForm) => eventFormToInput({ ...value, title: ' Plumber coming ' }, CHICAGO) as NativeEventInput;
  // The sentence of an add, on a Household of its own.
  const saying = async () => {
    const phone = await asHouseholdAccount(await arrange());
    return (value: EventForm, timezone = CHICAGO) => runPlan(phone, { kind: 'add', input: input(value) }, timezone);
  };

  it('names the event, the day and the time, in the Household Timezone', async () => {
    const added = await saying();
    const plumber = form('14:00', '15:00');
    expect(await added(plumber)).toBe('Added Plumber coming: Fri, Oct 2, 2:00 PM');
    // The same instant is another day and time on a clock elsewhere: nothing here reads the machine's zone.
    expect(await added(plumber, 'Pacific/Auckland')).toBe('Added Plumber coming: Sat, Oct 3, 8:00 AM');
  });

  it('says all day for an all-day event, on the Household day it starts', async () => {
    const added = await saying();
    expect(await added({ ...form('14:00', '15:00'), allDay: true })).toBe('Added Plumber coming: Fri, Oct 2, all day');
    // The day clocks go back: a 25 hour day still starts on its own date.
    expect(await added({ ...blankEventForm('2026-11-01'), allDay: true })).toBe('Added Plumber coming: Sun, Nov 1, all day');
  });

  it('keeps midnight and noon straight', async () => {
    const added = await saying();
    expect(await added(form('00:00', '00:15'))).toBe('Added Plumber coming: Fri, Oct 2, 12:00 AM');
    expect(await added(form('12:00', '12:15'))).toBe('Added Plumber coming: Fri, Oct 2, 12:00 PM');
  });

  it('writes the event it names', async () => {
    const phone = await asHouseholdAccount(await arrange());
    await runPlan(phone, { kind: 'add', input: input(form('14:00', '15:00')) }, CHICAGO);
    expect(await loadOccurrences(phone, WINDOW.from, WINDOW.to)).toMatchObject([{ source: 'native', title: 'Plumber coming', starts_at: '2026-10-02T19:00:00+00:00' }]);
  });
});

// An edit that moves an event to another day takes it off the week on screen: the line says when the event is now, in the words of the
// one an added event says, and not only that it was saved.
describe('what the status line says after an event is saved', () => {
  const form = (startTime: string, endTime: string): EventForm => ({ ...blankEventForm('2026-10-02'), startTime, endTime });
  const input = (value: EventForm) => eventFormToInput({ ...value, title: ' Plumber coming ' }, CHICAGO) as NativeEventInput;
  // The sentences of an add and of a save over an event already there, on a Household of its own.
  const saying = async () => {
    const phone = await asHouseholdAccount(await arrange());
    const id = await saveNativeEvent(phone, plumber);
    const [occurrence] = (await loadOccurrences(phone, WINDOW.from, WINDOW.to)).filter((row) => eventIdOf(row) === id);
    return {
      saved: (value: EventForm, timezone = CHICAGO) => runPlan(phone, { kind: 'save', input: input(value), occurrence: occurrence! }, timezone),
      added: (value: EventForm) => runPlan(phone, { kind: 'add', input: input(value) }, CHICAGO),
      phone,
    };
  };

  it('names the event, and the day and the time it is on now, in the Household Timezone', async () => {
    const { saved } = await saying();
    const moved = { ...blankEventForm('2026-10-14'), startTime: '14:00', endTime: '15:00' };
    expect(await saved(moved)).toBe('Saved Plumber coming: Wed, Oct 14, 2:00 PM');
    expect(await saved(moved, 'Pacific/Auckland')).toBe('Saved Plumber coming: Thu, Oct 15, 8:00 AM');
  });

  it('says all day for an all-day event, and keeps midnight and noon straight', async () => {
    const { saved } = await saying();
    expect(await saved({ ...form('14:00', '15:00'), allDay: true })).toBe('Saved Plumber coming: Fri, Oct 2, all day');
    expect(await saved(form('00:00', '00:15'))).toBe('Saved Plumber coming: Fri, Oct 2, 12:00 AM');
    expect(await saved(form('12:00', '12:15'))).toBe('Saved Plumber coming: Fri, Oct 2, 12:00 PM');
  });

  it('is the added sentence with its own first word: one helper builds both', async () => {
    const { saved, added } = await saying();
    for (const value of [form('14:00', '15:00'), { ...form('09:00', '10:00'), allDay: true }, form('23:30', '23:45')]) {
      expect(await saved(value)).toBe((await added(value)).replace(/^Added /, 'Saved '));
    }
  });

  it('uses no dash of any length', async () => {
    const { saved } = await saying();
    expect(await saved(form('14:00', '15:00'))).not.toMatch(/[–—]/);
  });

  it('writes the event over the one there, not beside it', async () => {
    const { saved, phone } = await saying();
    await saved(form('14:00', '15:00'));
    expect(await loadOccurrences(phone, WINDOW.from, WINDOW.to)).toMatchObject([{ title: 'Plumber coming', starts_at: '2026-10-02T19:00:00+00:00' }]);
  });
});

describe('Repeats written by a plan', () => {
  const OCTOBER = { from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-11-01T00:00:00Z') };
  const asInput = (form: EventForm) => {
    const input = eventFormToInput(form, CHICAGO);
    if ('problem' in input) throw new Error(input.problem);
    return input;
  };
  // Soccer on Tuesdays at 3:00 PM from Oct 6.
  const soccer: EventForm = { ...blankEventForm('2026-10-06'), title: 'Soccer', startTime: '15:00', endTime: '16:00', repeat: { every: 'week', interval: 1, days: 4, until: null } };

  it('round-trips through the view: one Occurrence a Tuesday, each read back into the form as a Repeat', async () => {
    const account = await arrange();
    const phone = await asHouseholdAccount(account);
    const id = await saveNativeEvent(phone, asInput({ ...soccer, repeat: { ...soccer.repeat!, until: '2026-10-20' } }));

    const rows = await loadOccurrences(phone, OCTOBER.from, OCTOBER.to);
    expect(rows.map((row) => row.starts_at)).toEqual(['2026-10-06T20:00:00+00:00', '2026-10-13T20:00:00+00:00', '2026-10-20T20:00:00+00:00']);
    expect(rows.every((row) => eventIdOf(row) === id && row.household_id === account.household.id)).toBe(true);
    // Opened from the second Tuesday, the form is on that day with the Repeat the event has.
    expect(openDraft({ occurrence: rows[1]! }, CHICAGO).form).toEqual({ ...soccer, date: '2026-10-13', repeat: { every: 'week', interval: 1, days: 4, until: '2026-10-20' } });
  });

  it('writes "this one" as an event of its own and leaves its day out of the Repeat, in one write', async () => {
    const account = await arrange();
    const phone = await asHouseholdAccount(account);
    const id = await saveNativeEvent(phone, asInput(soccer));
    const second = (await loadOccurrences(phone, OCTOBER.from, OCTOBER.to))[1]!;

    // A new title and time, and a Repeat changed in the same breath, which "this one" drops.
    const form = { ...openDraft({ occurrence: second }, CHICAGO).form, title: 'Soccer, late', startTime: '16:00', endTime: '17:00', repeat: { every: 'day' as const, interval: 1, days: 0, until: null } };
    const said = await runPlan(phone, { kind: 'save-one', form, occurrence: second }, CHICAGO);

    expect(said).toBe('Saved Soccer, late: Tue, Oct 13, 4:00 PM');
    const rows = await loadOccurrences(phone, OCTOBER.from, OCTOBER.to);
    expect(rows.map((row) => [row.title, row.starts_at, row.repeat_every])).toEqual([
      ['Soccer', '2026-10-06T20:00:00+00:00', 'week'],
      ['Soccer, late', '2026-10-13T21:00:00+00:00', null],
      ['Soccer', '2026-10-20T20:00:00+00:00', 'week'],
      ['Soccer', '2026-10-27T20:00:00+00:00', 'week'],
    ]);
    // The new event is not the Repeat's, and the Repeat is as it was.
    expect(eventIdOf(rows[1]!)).not.toBe(id);
    expect(rows.filter((row) => row.title === 'Soccer').every((row) => eventIdOf(row) === id)).toBe(true);
  });

  it('writes nothing of "this one" when the form is refused', async () => {
    const account = await arrange();
    const phone = await asHouseholdAccount(account);
    await saveNativeEvent(phone, asInput(soccer));
    const second = (await loadOccurrences(phone, OCTOBER.from, OCTOBER.to))[1]!;
    const form = { ...openDraft({ occurrence: second }, CHICAGO).form, title: '   ' };
    await expect(runPlan(phone, { kind: 'save-one', form, occurrence: second }, CHICAGO)).rejects.toThrow('Give the event a title.');
    expect(await loadOccurrences(phone, OCTOBER.from, OCTOBER.to)).toHaveLength(4);
  });

  it('lets a Device delete "this one": its day is left out, the rest stay', async () => {
    const account = await arrange();
    const device = await arrangeDevice(account);
    await saveNativeEvent(device.client, asInput(soccer));
    const rows = await loadOccurrences(device.client, OCTOBER.from, OCTOBER.to);
    expect(rows).toHaveLength(4);

    const said = await runPlan(device.client, { kind: 'skip', occurrence: rows[1]! }, CHICAGO);

    expect(said).toBe('Deleted Soccer on Tue, Oct 13');
    const left = await loadOccurrences(device.client, OCTOBER.from, OCTOBER.to);
    expect(left.map((row) => row.starts_at.slice(0, 10))).toEqual(['2026-10-06', '2026-10-20', '2026-10-27']);
  });

  it('writes "every one" by the event id, its first day moved by the days the form moved, its Repeat kept', async () => {
    const account = await arrange();
    const phone = await asHouseholdAccount(account);
    const id = await saveNativeEvent(phone, asInput(soccer));
    const third = (await loadOccurrences(phone, OCTOBER.from, OCTOBER.to))[2]!;
    expect(third.starts_at).toBe('2026-10-20T20:00:00+00:00');

    // Opened on Oct 20 and moved to Wednesday, Oct 21: the series starts on Wednesday, Oct 7, an hour later.
    const moved = pickDate(openDraft({ occurrence: third }, CHICAGO), '2026-10-21').form;
    expect(moved.repeat).toMatchObject({ days: 8 });
    const said = await runPlan(phone, { kind: 'save-every', form: { ...moved, title: 'Soccer, Wednesdays', startTime: '16:00', endTime: '17:00' }, occurrence: third }, CHICAGO);

    expect(said).toBe('Saved Soccer, Wednesdays: Wed, Oct 7, 4:00 PM');
    const rows = await loadOccurrences(phone, OCTOBER.from, OCTOBER.to);
    expect(rows.map((row) => row.starts_at)).toEqual(['2026-10-07T21:00:00+00:00', '2026-10-14T21:00:00+00:00', '2026-10-21T21:00:00+00:00', '2026-10-28T21:00:00+00:00']);
    expect(rows.every((row) => eventIdOf(row) === id && row.title === 'Soccer, Wednesdays' && row.repeat_every === 'week' && row.repeat_days === 8)).toBe(true);
  });

  it("moves a week Repeat's one day with the first day when the form's date moved and its day did not", async () => {
    const account = await arrange();
    const device = await arrangeDevice(account);
    await saveNativeEvent(device.client, asInput(soccer));
    const third = (await loadOccurrences(device.client, OCTOBER.from, OCTOBER.to))[2]!;
    const write = (form: EventForm) => runPlan(device.client, { kind: 'save-every', form, occurrence: third } satisfies Plan, CHICAGO);

    // Opened on Tuesday, Oct 20 and given Thursday, Oct 22 by a form that is not the draft's: Tuesday goes to Thursday with it.
    await write({ ...openDraft({ occurrence: third }, CHICAGO).form, date: '2026-10-22' });

    const moved = await loadOccurrences(device.client, OCTOBER.from, OCTOBER.to);
    expect(moved.map((row) => row.starts_at.slice(0, 10))).toEqual(['2026-10-08', '2026-10-15', '2026-10-22', '2026-10-29']);
    expect(moved.every((row) => row.repeat_every === 'week' && row.repeat_days === 16)).toBe(true);
    // Two days pressed stay as they are.
    await write({ ...openDraft({ occurrence: third }, CHICAGO).form, date: '2026-10-21', repeat: { every: 'week', interval: 1, days: 4 | 16, until: null } });
    expect((await loadOccurrences(device.client, OCTOBER.from, OCTOBER.to)).every((row) => row.repeat_days === (4 | 16))).toBe(true);
  });

  it('keeps the first day when the form did not move', async () => {
    const account = await arrange();
    const phone = await asHouseholdAccount(account);
    await saveNativeEvent(phone, asInput(soccer));
    const third = (await loadOccurrences(phone, OCTOBER.from, OCTOBER.to))[2]!;

    const said = await runPlan(phone, { kind: 'save-every', form: { ...openDraft({ occurrence: third }, CHICAGO).form, title: 'Soccer cup' }, occurrence: third }, CHICAGO);

    expect(said).toBe('Saved Soccer cup: Tue, Oct 6, 3:00 PM');
    expect((await loadOccurrences(phone, OCTOBER.from, OCTOBER.to)).map((row) => row.starts_at.slice(0, 10))).toEqual(['2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27']);
  });

  it('deletes "every one" by the event id, the skipped days with it', async () => {
    const account = await arrange();
    const phone = await asHouseholdAccount(account);
    await saveNativeEvent(phone, asInput(soccer));
    const rows = await loadOccurrences(phone, OCTOBER.from, OCTOBER.to);
    await runPlan(phone, { kind: 'skip', occurrence: rows[1]! }, CHICAGO);

    const said = await runPlan(phone, { kind: 'delete', occurrence: rows[2]! }, CHICAGO);

    expect(said).toBe('Deleted Soccer');
    expect(await loadOccurrences(phone, OCTOBER.from, OCTOBER.to)).toEqual([]);
    const { data } = await asServiceRole().from('native_event_skips').select('skipped_on').eq('household_id', account.household.id);
    expect(data).toEqual([]);
  });
});
