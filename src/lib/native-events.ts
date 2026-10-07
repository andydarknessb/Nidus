import type { SupabaseClient } from '@supabase/supabase-js';
import { wallClockMs } from '../../supabase/functions/_shared/zoned-time.ts';
import { addDays, dayStartMs, formatClock, formatDate, occurrenceColumns, type Occurrence } from './calendar-occurrences';
import { householdDay, WEEKDAYS } from './routines';

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
};

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
};

export function blankEventForm(date: string): EventForm {
  return { title: '', date, allDay: false, startTime: '09:00', endTime: '10:00', location: '', notes: '', profileIds: [] };
}

// The instant `time` on `date` is on the wall clock of `timezone`, by the same rule as an iPhone
// calendar's floating times (wallClockMs).
export function wallMs(date: string, time: string, timezone: string): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  return wallClockMs(Date.UTC(year, month - 1, day, hour, minute), timezone);
}

export function eventFormToInput(form: EventForm, timezone: string): NativeEventInput | { problem: string } {
  const title = form.title.trim();
  if (title === '') return { problem: 'Give the event a title.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date) || addDays(form.date, 0) !== form.date) return { problem: 'Pick a date.' };
  let startsAt: number;
  let endsAt: number;
  if (form.allDay) {
    startsAt = dayStartMs(form.date, timezone);
    endsAt = dayStartMs(addDays(form.date, 1), timezone);
  } else {
    if (!/^\d{2}:\d{2}$/.test(form.startTime) || !/^\d{2}:\d{2}$/.test(form.endTime)) {
      return { problem: 'Pick a start and end time, or choose all day.' };
    }
    startsAt = wallMs(form.date, form.startTime, timezone);
    endsAt = wallMs(form.date, form.endTime, timezone);
    if (endsAt <= startsAt) {
      // An end after its start on the clock can still be at or before it here: a time inside the hour the clocks skip does
      // not exist, and moves on by the hour (wallMs). Say which time that is, not that the end is before the start.
      const skipped = form.endTime > form.startTime ? [form.startTime, form.endTime].find((time) => clock(wallMs(form.date, time, timezone), timezone) !== time) : undefined;
      return { problem: skipped ? `The clocks go forward on this day, so there is no ${clockWords(skipped)}. Pick another time.` : 'The event must end after it starts.' };
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
  };
}

// ---- What the sheet does with the form -------------------------------------------------
// Starts and Ends are steppers of a quarter hour that stay on the chosen date: Starts stops at 11:30 PM and Ends at
// 11:45 PM, and Ends is always at least 15 minutes after Starts (an event that runs past midnight belongs in Google).
// So a form the steppers made never has an end at or before its start. eventFormToInput still checks, for an event made
// before the steppers and for a wall time that does not exist on the day clocks go forward.

const QUARTER = 15;
const LAST_START = 23 * 60 + 30;
const LAST_END = 23 * 60 + 45;

// Minutes into the day for an 'HH:MM', or null when it is not one.
function minutesOf(time: string): number | null {
  const found = /^(\d{2}):(\d{2})$/.exec(time);
  return found ? Number(found[1]) * 60 + Number(found[2]) : null;
}

const timeOf = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const within = (value: number, least: number, most: number) => Math.min(Math.max(value, least), most);

// Where a step lands: a full quarter hour from a time on the quarter hour, the next quarter hour that way from one off it.
const quarterFrom = (minutes: number, direction: 1 | -1) => (direction > 0 ? Math.floor(minutes / QUARTER) + 1 : Math.ceil(minutes / QUARTER) - 1) * QUARTER;

// A step of Starts, and Ends by the same amount, as far as the limits let it. At a limit it is the same form.
export function stepStart(form: EventForm, direction: 1 | -1): EventForm {
  const start = minutesOf(form.startTime);
  const end = minutesOf(form.endTime);
  if (start === null || end === null || (direction > 0 ? start >= LAST_START : start <= 0)) return form;
  const next = within(quarterFrom(start, direction), 0, LAST_START);
  return { ...form, startTime: timeOf(next), endTime: timeOf(within(end + next - start, next + QUARTER, LAST_END)) };
}

// A step of Ends on its own, never to less than 15 minutes after Starts (the first quarter hour that is, when Starts is
// off the quarter hour). At a limit it is the same form.
export function stepEnd(form: EventForm, direction: 1 | -1): EventForm {
  const start = minutesOf(form.startTime);
  const end = minutesOf(form.endTime);
  if (start === null || end === null) return form;
  const earliest = Math.ceil((start + QUARTER) / QUARTER) * QUARTER;
  if (direction > 0 ? end >= LAST_END : end <= earliest) return form;
  return { ...form, endTime: timeOf(within(quarterFrom(end, direction), earliest, LAST_END)) };
}

// 'HH:MM' on the wall clock as a stepper shows it: "2:00 PM".
export function clockWords(time: string): string {
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

// The form with its date moved to `date`. A new event whose times no stepper has moved takes that day's opening times (today
// at the next whole hour, any other day at 9:00 AM); once a stepper has moved them, and always for an event being edited
// (`keepTimes`), they stay as they are.
export function moveToDay(form: EventForm, date: string, keepTimes: boolean, timezone: string, now: Date = new Date()): EventForm {
  return { ...form, date, ...(keepTimes ? {} : openingTimes(date, timezone, now)) };
}

// Whether nothing has been typed or changed since the form `opened`: the one question that decides whether a tap outside
// the sheet may close it. The same people pressed in another order are the same people.
export function isUntouched(form: EventForm, opened: EventForm): boolean {
  const { profileIds, ...fields } = form;
  const { profileIds: openedIds, ...openedFields } = opened;
  return (
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
  return `${verb} ${input.title}: ${formatDate(start, timezone)}, ${input.is_all_day ? 'all day' : formatClock(start, timezone)}`;
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
  });
  if (error) throw error;
  return data as string;
}

// The Native Events that have not finished by `from`, in start order: what the phone's list shows.
export async function loadUpcomingNativeEvents(client: SupabaseClient, from: Date): Promise<Occurrence[]> {
  const { data, error } = await client
    .from('calendar_occurrences')
    .select(occurrenceColumns)
    .eq('source', 'native')
    .gte('ends_at', from.toISOString())
    .order('starts_at')
    .order('id');
  if (error) throw error;
  return data as Occurrence[];
}

// Its Profile rows go with it.
export async function deleteNativeEvent(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from('native_events').delete().eq('id', id);
  if (error) throw error;
}
