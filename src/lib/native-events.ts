import type { SupabaseClient } from '@supabase/supabase-js';
import { occurrenceColumns, readPages, type Occurrence } from './calendar-occurrences';
import { formatClock, dateWords } from '../../supabase/functions/_shared/event-words.ts';
import { WEEKDAYS } from './routines';
import { minutesOf } from './time-picker';
import { addDays, dayStartMs, householdDay, instantAt } from '../../supabase/functions/_shared/zoned-time.ts';

// Native Events (CONTEXT.md): created in Nidus, living only in Nidus. A Household Account (the
// phone) or a Device (the wall) writes them. Every function takes the client so the same code
// runs in the app and in tests, against the local stack.

export type NativeEventInput = {
  title: string;
  location: string | null;
  notes: string | null;
  // ISO instants. For an all-day event, Household-Timezone midnights, the end being the
  // midnight after its last day.
  starts_at: string;
  ends_at: string;
  is_all_day: boolean;
  // Zero means the whole Household.
  profile_ids: string[];
  // The event's Repeat (CONTEXT.md: Repeat): null, 1, null, null when it does not repeat.
  repeat_every: Repeat['every'] | null;
  repeat_interval: number;
  repeat_days: number | null;
  repeat_until: string | null;
  // A day of another Native Event to leave out, written in the same transaction: "change this one" on an Occurrence of a Repeat.
  skip?: { event: string; on: string };
};

// A Repeat as the form holds it: every `interval` days, weeks, months or years. `days` is the weekdays of a week as the Routines'
// bitmask (Sunday = bit 0) and means nothing for the others; `until` is a Household Date, or null for forever.
export type Repeat = { every: 'day' | 'week' | 'month' | 'year'; interval: number; days: number; until: string | null };

// ---- The sheet's form ---------------------------------------------------------------
// What the create/edit sheet holds: a Household date and wall-clock times, never instants.
// Turning them into instants uses the Household Timezone, so a tablet or phone in another zone
// writes the same event.

export type EventForm = {
  title: string;
  // 'YYYY-MM-DD', a Household date.
  date: string;
  allDay: boolean;
  // 'HH:MM' on the Household's wall clock; ignored when allDay.
  startTime: string;
  endTime: string;
  location: string;
  notes: string;
  profileIds: string[];
  repeat: Repeat | null;
};

export function blankEventForm(date: string): EventForm {
  return { title: '', date, allDay: false, startTime: '09:00', endTime: '10:00', location: '', notes: '', profileIds: [], repeat: null };
}

// The Routines' bit for the weekday of a Household date (Sunday = bit 0); 0 for a date that is not one.
export function weekdayBit(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return Number.isNaN(day) ? 0 : 1 << day;
}

export function eventFormToInput(form: EventForm, timezone: string): NativeEventInput | { problem: string } {
  const title = form.title.trim();
  if (title === '') return { problem: 'Give the event a title.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date) || addDays(form.date, 0) !== form.date) return { problem: 'Pick a date.' };
  const repeat = form.repeat;
  if (repeat) {
    if (!Number.isInteger(repeat.interval) || repeat.interval < 1 || repeat.interval > 99) return { problem: 'Repeat every 1 to 99.' };
    if (repeat.every === 'week' && (repeat.days & 127) === 0) return { problem: 'Pick at least one day.' };
    if (repeat.until !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(repeat.until) || addDays(repeat.until, 0) !== repeat.until)) return { problem: 'Pick the day the repeat ends.' };
    if (repeat.until !== null && repeat.until < form.date) return { problem: 'The repeat ends before it starts.' };
  }
  let startsAt: number;
  let endsAt: number;
  if (form.allDay) {
    startsAt = dayStartMs(form.date, timezone);
    endsAt = dayStartMs(addDays(form.date, 1), timezone);
  } else {
    if (!/^\d{2}:\d{2}$/.test(form.startTime) || !/^\d{2}:\d{2}$/.test(form.endTime)) {
      return { problem: 'Pick a start and end time, or choose all day.' };
    }
    startsAt = instantAt(form.date, form.startTime, timezone);
    endsAt = instantAt(form.date, form.endTime, timezone);
    if (endsAt <= startsAt) {
      // An end after its start on the clock can still be at or before it here: a time inside the hour the clocks skip does
      // not exist, and moves on by the hour (wallMs). Say which time that is, not that the end is before the start.
      const skipped = form.endTime > form.startTime ? [form.startTime, form.endTime].find((time) => clock(instantAt(form.date, time, timezone), timezone) !== time) : undefined;
      return { problem: skipped ? `The clocks go forward on this day, so there is no ${timeInputWords(skipped)}. Pick another time.` : 'The event must end after it starts.' };
    }
  }
  return {
    title,
    location: cleanOptional(form.location),
    notes: cleanOptional(form.notes),
    starts_at: new Date(startsAt).toISOString(),
    ends_at: new Date(endsAt).toISOString(),
    is_all_day: form.allDay,
    profile_ids: form.profileIds,
    repeat_every: repeat?.every ?? null,
    repeat_interval: repeat?.interval ?? 1,
    repeat_days: repeat?.every === 'week' ? repeat.days & 127 : null,
    repeat_until: repeat?.until ?? null,
  };
}

function clock(ms: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ms));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${part('hour')}:${part('minute')}`;
}

// The form an existing Native Event opens with, as the Household's wall clock reads it.
export function eventFormFromOccurrence(occurrence: Occurrence, timezone: string): EventForm {
  const start = Date.parse(occurrence.starts_at);
  const blank = blankEventForm(householdDay(timezone, new Date(start)).date);
  return {
    ...blank,
    title: occurrence.title,
    allDay: occurrence.is_all_day,
    ...(occurrence.is_all_day ? {} : { startTime: clock(start, timezone), endTime: clock(Date.parse(occurrence.ends_at), timezone) }),
    location: occurrence.location ?? '',
    notes: occurrence.description ?? '',
    profileIds: occurrence.profile_ids,
    repeat: occurrence.repeat_every ? { every: occurrence.repeat_every, interval: occurrence.repeat_interval ?? 1, days: occurrence.repeat_days ?? 0, until: occurrence.repeat_until } : null,
  };
}

// ---- What the sheet does with the form -------------------------------------------------
// Starts and Ends are set in the time sheet (lib/time-picker.ts): Starts moves Ends with it to keep the event's length, and Ends
// must be after Starts. An event ends on its own day (one that runs past midnight belongs in Google). So a form the sheet made
// never has an end at or before its start. eventFormToInput still checks, for an event made before the time sheet and for a
// wall time that does not exist on the day clocks go forward.

// The value of a time input, 'HH:MM', as the time field shows it: "2:00 PM". (An event's own time is said by event words.)
export function timeInputWords(time: string): string {
  return formatClock(Date.UTC(1970, 0, 1, 0, minutesOf(time) ?? 0), 'UTC');
}

// The days the sheet offers with one tap, from the Household's `today`: today and the next two ("Today", "Fri 2", "Sat 3").
// Any other day is "Another day", which shows the date field.
export type DayChoice = { date: string; label: string };

export function dayChoices(today: string): DayChoice[] {
  return [0, 1, 2].map((offset) => {
    const date = addDays(today, offset);
    const weekday = WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]!.short;
    return { date, label: offset === 0 ? 'Today' : `${weekday} ${Number(date.slice(8))}` };
  });
}

const HOUR_MS = 60 * 60 * 1000;

// The times a new event on `date` opens with. When `date` is today in the Household Timezone, the next whole hour for an
// hour; on any other day, 9:00 AM to 10:00 AM. The hour comes from the instant: `now` moved on to the start of the next hour
// on the Household's clock, then read there, never from adding to a time written as text, so the night the clocks go
// forward cannot give a time that does not exist. It stays inside the day: Starts is 11:00 PM at the latest, and Ends is an
// hour after it or 11:45 PM, whichever comes first.
export function openingTimes(date: string, timezone: string, now: Date = new Date()): { startTime: string; endTime: string } {
  if (householdDay(timezone, now).date !== date) return { startTime: '09:00', endTime: '10:00' };
  // How far into its hour `now` is on the Household's clock. Every zone is a whole number of minutes from UTC, so the
  // seconds and milliseconds are UTC's.
  const intoHour = (Number(clock(now.getTime(), timezone).slice(3)) * 60 + now.getUTCSeconds()) * 1000 + now.getUTCMilliseconds();
  const startsAt = now.getTime() - intoHour + HOUR_MS;
  // `at` as the Household's clock reads it while that is still today and before `last`; otherwise `last`.
  const readOr = (at: number, last: string) => (householdDay(timezone, new Date(at)).date === date && clock(at, timezone) < last ? clock(at, timezone) : last);
  return { startTime: readOr(startsAt, '23:00'), endTime: readOr(startsAt + HOUR_MS, '23:45') };
}

// The form with its date moved to `date`. A new event whose times no one has set takes that day's opening times (today
// at the next whole hour, any other day at 9:00 AM); once a time has been set, and always for an event being edited
// (`keepTimes`), they stay as they are.
// A week Repeat that has only the old date's weekday pressed moves its day with the date.
export function moveToDay(form: EventForm, date: string, keepTimes: boolean, timezone: string, now: Date = new Date()): EventForm {
  const { repeat } = form;
  const follows = repeat?.every === 'week' && repeat.days === weekdayBit(form.date) && weekdayBit(date) !== 0;
  return { ...form, date, ...(follows ? { repeat: { ...repeat, days: weekdayBit(date) } } : {}), ...(keepTimes ? {} : openingTimes(date, timezone, now)) };
}

// Whether nothing has been typed or changed since the form `opened`: the one question that decides whether a tap outside
// the sheet may close it. The same people pressed in another order are the same people.
export function isUntouched(form: EventForm, opened: EventForm): boolean {
  const { profileIds, repeat, ...fields } = form;
  const { profileIds: openedIds, repeat: openedRepeat, ...openedFields } = opened;
  // The Repeat is an object: the same Repeat is one with the same fields.
  const sameRepeat = repeat === openedRepeat || (repeat !== null && openedRepeat !== null && (Object.keys(repeat) as (keyof Repeat)[]).every((key) => repeat[key] === openedRepeat[key]));
  return (
    sameRepeat &&
    (Object.keys(fields) as (keyof typeof fields)[]).every((key) => fields[key] === openedFields[key]) &&
    profileIds.length === openedIds.length &&
    profileIds.every((id) => openedIds.includes(id))
  );
}

// What the status line says of an event once it is written, and when it is, in the Household Timezone: "Added Plumber coming: Fri,
// Oct 2, 2:00 PM", or "…, all day". The day and the time are the event's own, so an edit that moves it to another day, which takes it
// off the week on screen, says where it went.
type EventWhen = Pick<NativeEventInput, 'title' | 'starts_at' | 'is_all_day'>;
const whenSentence = (verb: 'Added' | 'Saved', input: EventWhen, timezone: string): string => {
  const start = Date.parse(input.starts_at);
  return `${verb} ${input.title}: ${dateWords.day(start, timezone)}, ${input.is_all_day ? 'all day' : formatClock(start, timezone)}`;
};

// ...once an event is added.
export const addedSentence = (input: EventWhen, timezone: string): string => whenSentence('Added', input, timezone);

// ...once an event is saved after an edit: "Saved Plumber coming: Wed, Oct 14, 2:00 PM".
export const savedSentence = (input: EventWhen, timezone: string): string => whenSentence('Saved', input, timezone);

// A blank optional field means none.
export function cleanOptional(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

// What an Occurrence of a Repeat says of its Repeat: "Every week on Tuesday", "Every 2 weeks on Monday and Wednesday", "Every month on
// the 15th", "Every year on Oct 6", with ", until Dec 20" when it ends (", until Dec 20, 2027" when that is not `today`'s year).
// `firstDate` is a Household Date the Repeat lands on, which gives a month its day and a year its date.
export function repeatWords(repeat: Repeat, firstDate: string, today: string): string {
  const { every, interval } = repeat;
  const unit = interval === 1 ? every : `${interval} ${every}s`;
  const names = WEEKDAYS.filter((day) => (repeat.days & (1 << day.bit)) !== 0).map((day) => day.name);
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names.join('');
  const on =
    every === 'week' ? (list === '' ? '' : ` on ${list}`)
    : every === 'month' ? ` on the ${ordinal(Number(firstDate.slice(8)))}`
    : every === 'year' ? ` on ${dateWords.calendar(firstDate, { month: 'short', day: 'numeric' })}`
    : '';
  const until =
    repeat.until === null ? '' : `, until ${dateWords.calendar(repeat.until, repeat.until.slice(0, 4) === today.slice(0, 4) ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })}`;
  return `Every ${unit}${on}${until}`;
}

// 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st.
function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${n}${teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}

// The Household Date an Occurrence is on.
export const occurrenceDate = (occurrence: Pick<Occurrence, 'starts_at'>, timezone: string): string => householdDay(timezone, new Date(occurrence.starts_at)).date;

// The Native Event itself: an Occurrence of a Repeat has an id of its own (ADR 0005), so it is edited and deleted by this.
export const eventIdOf = (occurrence: Pick<Occurrence, 'id' | 'event_id'>): string => occurrence.event_id ?? occurrence.id;

// ...once one day of a Repeat is deleted on its own: "Deleted Soccer on Tue, Oct 6".
export const deletedOnSentence = (occurrence: Pick<Occurrence, 'title' | 'starts_at'>, timezone: string): string =>
  `Deleted ${occurrence.title} on ${dateWords.day(Date.parse(occurrence.starts_at), timezone)}`;

// Creates the event (no `id`) or edits it, with its Profiles, in one transaction. Returns its id.
export async function saveNativeEvent(client: SupabaseClient, input: NativeEventInput, id?: string): Promise<string> {
  const { data, error } = await client.rpc('save_native_event', {
    p_id: id ?? null,
    p_title: input.title.trim(),
    p_location: input.location,
    p_notes: input.notes,
    p_starts_at: input.starts_at,
    p_ends_at: input.ends_at,
    p_is_all_day: input.is_all_day,
    p_profile_ids: input.profile_ids,
    p_repeat_every: input.repeat_every,
    p_repeat_interval: input.repeat_interval,
    p_repeat_days: input.repeat_days,
    p_repeat_until: input.repeat_until,
    p_skip_event: input.skip?.event ?? null,
    p_skip_on: input.skip?.on ?? null,
  });
  if (error) throw error;
  return data as string;
}

// "Change this one" on an Occurrence of a Repeat: the form's event on its own, with no Repeat, and the Occurrence's day left out of
// the Repeat, in one transaction. A change to the form's Repeat is dropped with it. Returns what was written, for its sentence.
export async function saveThisOne(client: SupabaseClient, form: EventForm, occurrence: Occurrence, timezone: string): Promise<NativeEventInput> {
  const input = eventFormToInput({ ...form, repeat: null }, timezone);
  if ('problem' in input) throw new Error(input.problem);
  const written = { ...input, skip: { event: eventIdOf(occurrence), on: occurrenceDate(occurrence, timezone) } };
  await saveNativeEvent(client, written);
  return written;
}

// "Change every one": the Native Event itself, written by its own id. The form is of one Occurrence, so its day is that Occurrence's
// day moved: the event's first day moves by as many days as the form's date is from the Occurrence's, and the times are the form's.
// A week Repeat whose one day is the Occurrence's weekday moves that day with the date, as moveToDay does in the sheet (a form the sheet
// moved has it moved already, and is left as it is); several days stay. Returns what was written, for its sentence.
export async function saveEveryOne(client: SupabaseClient, form: EventForm, occurrence: Occurrence, timezone: string): Promise<NativeEventInput> {
  const id = eventIdOf(occurrence);
  const { data, error } = await client.from('native_events').select('starts_at').eq('id', id).single();
  if (error) throw error;
  const on = occurrenceDate(occurrence, timezone);
  const moved = moveToDay({ ...form, date: on }, form.date, true, timezone);
  const delta = (Date.parse(`${form.date}T00:00:00Z`) - Date.parse(`${on}T00:00:00Z`)) / 86_400_000;
  const input = eventFormToInput({ ...moved, date: addDays(householdDay(timezone, new Date(data.starts_at as string)).date, delta) }, timezone);
  if ('problem' in input) throw new Error(input.problem);
  await saveNativeEvent(client, input, id);
  return input;
}

// "Delete this one": the Occurrence's day is left out of its Repeat, and nothing else changes.
export async function skipNativeOccurrence(client: SupabaseClient, occurrence: Occurrence, timezone: string): Promise<void> {
  const { error } = await client
    .from('native_event_skips')
    .insert({ native_event_id: eventIdOf(occurrence), household_id: occurrence.household_id, skipped_on: occurrenceDate(occurrence, timezone) });
  if (error) throw error;
}

// The Occurrences of Native Events that have not finished by `from`, in start order: what the phone's list shows. A Repeat is one for
// every day it lands on, two years ahead, so this is read a page at a time.
export const loadUpcomingNativeEvents = (client: SupabaseClient, from: Date): Promise<Occurrence[]> =>
  readPages((first, last) =>
    client
      .from('calendar_occurrences')
      .select(occurrenceColumns)
      .eq('source', 'native')
      .gte('ends_at', from.toISOString())
      .order('starts_at')
      .order('id')
      .range(first, last),
  );

// Its Profile rows go with it, and a Repeat's skipped days. `id` is the event's: `eventIdOf(occurrence)`.
export async function deleteNativeEvent(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from('native_events').delete().eq('id', id);
  if (error) throw error;
}
