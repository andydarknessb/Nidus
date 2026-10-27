import type { SupabaseClient } from '@supabase/supabase-js';
import { occurrenceColumns, readPages, type Occurrence } from './calendar-occurrences';
import { eventFormToInput, moveToDay, type Plan } from './event-draft';
import { formatClock, dateWords } from '@shared/event-words.ts';
import { WEEKDAYS } from './routines';
import { addDays, householdDay } from '@shared/zoned-time.ts';

// Native Events (CONTEXT.md): created in Nidus, living only in Nidus. A Household Account (the
// phone) or a Device (the wall) writes them. Every function takes the client so the same code
// runs in the app and in tests, against the local stack. The form's rules are the event draft's
// (event-draft.ts); this is the database half: `runPlan` writes what a draft comes to.

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

// (The time field's words live with the time sheet's parsing, which the draft shares.)
export { timeInputWords } from './time-picker';

// What the status line says of an event once it is written, and when it is, in the Household Timezone: "Added Plumber coming: Fri,
// Oct 2, 2:00 PM", or "…, all day". The day and the time are the event's own, so an edit that moves it to another day, which takes it
// off the week on screen, says where it went.
type EventWhen = Pick<NativeEventInput, 'title' | 'starts_at' | 'is_all_day'>;
const whenSentence = (verb: 'Added' | 'Saved', input: EventWhen, timezone: string): string => {
  const start = Date.parse(input.starts_at);
  return `${verb} ${input.title}: ${dateWords.day(start, timezone)}, ${input.is_all_day ? 'all day' : formatClock(start, timezone)}`;
};

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
const eventIdOf = (occurrence: Pick<Occurrence, 'id' | 'event_id'>): string => occurrence.event_id ?? occurrence.id;

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
async function saveThisOne(client: SupabaseClient, form: EventForm, occurrence: Occurrence, timezone: string): Promise<NativeEventInput> {
  const input = eventFormToInput({ ...form, repeat: null }, timezone);
  if ('problem' in input) throw new Error(input.problem);
  const written = { ...input, skip: { event: eventIdOf(occurrence), on: occurrenceDate(occurrence, timezone) } };
  await saveNativeEvent(client, written);
  return written;
}

// "Change every one": the Native Event itself, written by its own id. The form is of one Occurrence, so its day is that Occurrence's
// day moved: the event's first day moves by as many days as the form's date is from the Occurrence's, and the times are the form's.
// A week Repeat whose one day is the Occurrence's weekday moves that day with the date, as moveToDay does in the draft (a form the draft
// moved has it moved already, and is left as it is); several days stay. Returns what was written, for its sentence.
async function saveEveryOne(client: SupabaseClient, form: EventForm, occurrence: Occurrence, timezone: string): Promise<NativeEventInput> {
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

// Writes what an event draft came to, and returns the sentence the status line says. A write that does not go through throws.
export async function runPlan(client: SupabaseClient, plan: Plan, timezone: string): Promise<string> {
  switch (plan.kind) {
    case 'add':
      await saveNativeEvent(client, plan.input);
      return whenSentence('Added', plan.input, timezone);
    case 'save':
      await saveNativeEvent(client, plan.input, eventIdOf(plan.occurrence));
      return whenSentence('Saved', plan.input, timezone);
    case 'save-one':
      return whenSentence('Saved', await saveThisOne(client, plan.form, plan.occurrence, timezone), timezone);
    case 'save-every':
      return whenSentence('Saved', await saveEveryOne(client, plan.form, plan.occurrence, timezone), timezone);
    case 'skip': {
      // "Delete this one": the Occurrence's day is left out of its Repeat, and nothing else changes.
      const { occurrence } = plan;
      const { error } = await client
        .from('native_event_skips')
        .insert({ native_event_id: eventIdOf(occurrence), household_id: occurrence.household_id, skipped_on: occurrenceDate(occurrence, timezone) });
      if (error) throw error;
      return `Deleted ${occurrence.title} on ${dateWords.day(Date.parse(occurrence.starts_at), timezone)}`;
    }
    case 'delete': {
      // Its Profile rows go with it, and a Repeat's skipped days.
      const { error } = await client.from('native_events').delete().eq('id', eventIdOf(plan.occurrence));
      if (error) throw error;
      return `Deleted ${plan.occurrence.title}`;
    }
  }
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
