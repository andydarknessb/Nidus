import type { SupabaseClient } from '@supabase/supabase-js';
import { offsetMs } from '../../supabase/functions/_shared/zoned-time.ts';
import { addDays, dayStartMs, occurrenceColumns, type Occurrence } from './calendar-occurrences';
import { householdDay } from './routines';

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

// The instant `time` on `date` is on the wall clock of `timezone` (the offset is read at the
// first guess and again at the corrected one, so a daylight saving change on the day is right).
function wallMs(date: string, time: string, timezone: string): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const first = wall - offsetMs(wall, timezone);
  return wall - offsetMs(first, timezone);
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
    if (endsAt <= startsAt) return { problem: 'The event must end after it starts.' };
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
