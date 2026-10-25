import type { SupabaseClient } from '@supabase/supabase-js';
import { householdTime } from '@shared/zoned-time.ts';
import { byPosition, movedIds } from './ordering';

// Routines and Routine Completions (CONTEXT.md). Every function takes the client
// so the same code runs in the app (the global client) and in tests (a Household
// Account or a Device, against the local stack).
//
// "Checked" is never stored per day by a job: a Routine is checked today when a
// Routine Completion exists for today's Household date, so at Household midnight
// the wall reads unchecked again with nothing to reset.

// When in the day a Routine belongs. A Routine with none (null) is any time.
export type TimeOfDay = 'morning' | 'afternoon' | 'evening';

export type Routine = {
  id: string;
  profile_id: string;
  title: string;
  // Bit n set: scheduled on weekday n, Sunday = 0 (the order of Date#getDay).
  days_of_week: number;
  time_of_day: TimeOfDay | null;
  // A key of docs/look.md's pictures (src/lib/routine-pictures.tsx), at most 32 characters, or null. The database does not
  // check it against the set, so it may be a key this build does not know: that draws a plain circle.
  picture: string | null;
  sort_order: number;
  archived_at: string | null;
};

// What a Household Account chooses when it makes a Routine. Leaving out time_of_day or picture is the same
// as null: any time, no picture.
export type RoutineInput = { title: string; days_of_week: number; time_of_day?: TimeOfDay | null; picture?: string | null };

// What an edit writes: all four fields, the time of day and the picture included (null is any time, and no picture). An
// edit that left one out would clear it, so the type does not allow one.
export type RoutineEdit = Required<RoutineInput>;

export const WEEKDAYS = [
  { bit: 0, name: 'Sunday', short: 'Sun' },
  { bit: 1, name: 'Monday', short: 'Mon' },
  { bit: 2, name: 'Tuesday', short: 'Tue' },
  { bit: 3, name: 'Wednesday', short: 'Wed' },
  { bit: 4, name: 'Thursday', short: 'Thu' },
  { bit: 5, name: 'Friday', short: 'Fri' },
  { bit: 6, name: 'Saturday', short: 'Sat' },
] as const;

// The groups a Profile's Routines fall into, in the order the day happens, with their words.
// Any time (null) is last: it is not a part of the day.
export const TIME_OF_DAY_GROUPS: readonly { value: TimeOfDay | null; label: string }[] = [
  { value: 'morning', label: 'Morning' },
  { value: 'afternoon', label: 'Afternoon' },
  { value: 'evening', label: 'Evening' },
  { value: null, label: 'Any time' },
];

const columns = 'id, profile_id, title, days_of_week, time_of_day, picture, sort_order, archived_at';

// What the Wall's Routines reader listens to: a change to either reads them again. Profiles are not here: the shell reads them
// once and hands them to the reader.
export const WALL_ROUTINE_TABLES = ['routines', 'routine_completions'] as const;

// What the Routines page listens to: the same two, and Profiles too, because the page reads Profiles for itself.
export const ROUTINE_TABLES = [...WALL_ROUTINE_TABLES, 'profiles'] as const;

// ---- Pure helpers -------------------------------------------------------------

export function maskOf(weekdays: readonly number[]): number {
  return weekdays.reduce((mask, weekday) => mask | (1 << weekday), 0);
}

export function isScheduledOn(mask: number, weekday: number): boolean {
  return (mask & (1 << weekday)) !== 0;
}

type TimeOfDayRoutines = { value: TimeOfDay | null; label: string; routines: Routine[] };

// Routines under Morning, Afternoon, Evening and Any time, in that order, each group in its
// Routines' own order. A group with nothing in it is left out.
export function groupByTimeOfDay(routines: Routine[]): TimeOfDayRoutines[] {
  return TIME_OF_DAY_GROUPS
    .map((group) => ({ ...group, routines: byPosition(routines.filter((routine) => routine.time_of_day === group.value)) }))
    .filter((group) => group.routines.length > 0);
}

// Whether a Profile's Routines get group headings on the phone's list. Not when every one is Any time, so a Household
// that never sets a time of day sees the list as it always was.
export function showsTimeOfDayHeadings(routines: Routine[]): boolean {
  return routines.some((routine) => routine.time_of_day !== null);
}

// A Profile's Routine ids in the order the phone lists them (grouped by time of day) once `id`
// has moved `offset` places inside its own group. A Routine never crosses into another group,
// and at the edge of its group the order stays as it was. The whole list is what gets written,
// so sort_order always equals the order on screen.
export function movedIdsInGroup(routines: Routine[], id: string, offset: number): string[] {
  return groupByTimeOfDay(routines).flatMap((group) => movedIds(group.routines.map((routine) => routine.id), id, offset));
}

export type RoutineProgress = { done: number; total: number };

// How many of a Profile's Routines today are done, out of how many. `routines` are that Profile's
// Routines today (src/lib/routine-chart.ts), so an archived Routine, one not scheduled today and a completion
// of either are never counted, whatever `doneIds` holds.
export function routineProgress(routines: Routine[], doneIds: ReadonlySet<string>): RoutineProgress {
  return { done: routines.filter((routine) => doneIds.has(routine.id)).length, total: routines.length };
}

// ---- The part of the day ---------------------------------------------------------------------

// Where the afternoon and the evening begin, as the hour of the Household's wall clock. The morning begins at midnight,
// not at 5:00, so nothing of a new day is ever "left from earlier".
const AFTERNOON_FROM = 12;
const EVENING_FROM = 17;

// The part of the day `now` is in, by the Household's wall clock. On a 23 or 25 hour day it follows the clock on the wall
// and not the hours that have passed, so the afternoon still begins at 12:00.
export function partOfDay(timezone: string, now: Date = new Date()): TimeOfDay {
  const hour = Math.floor(householdTime(now.getTime(), timezone).minutes / 60);
  return hour >= EVENING_FROM ? 'evening' : hour >= AFTERNOON_FROM ? 'afternoon' : 'morning';
}

// ---- Household Account writes; Household Account or Device reads ----------------

// Unarchived Routines, every Profile, in order. Archived ones have no screen.
export async function loadRoutines(client: SupabaseClient): Promise<Routine[]> {
  const { data, error } = await client
    .from('routines')
    .select(columns)
    .is('archived_at', null)
    .order('sort_order')
    .order('created_at');
  if (error) throw error;
  return data as Routine[];
}

export async function createRoutine(
  client: SupabaseClient,
  householdId: string,
  profileId: string,
  input: RoutineInput,
  sortOrder: number,
): Promise<Routine> {
  const { data, error } = await client
    .from('routines')
    .insert({
      household_id: householdId,
      profile_id: profileId,
      title: input.title.trim(),
      days_of_week: input.days_of_week,
      time_of_day: input.time_of_day ?? null,
      picture: input.picture ?? null,
      sort_order: sortOrder,
    })
    .select(columns)
    .single();
  if (error) throw error;
  return data as Routine;
}

// Writes a Routine's title, days, time of day and picture, always all four; its position, owner and Routine
// Completions stay as they are. An archived Routine is not edited, and row-level security refuses a
// Device, or another Household's account, by matching no row rather than by raising, so the row is
// asked for back and none means refused.
export async function updateRoutine(client: SupabaseClient, id: string, input: RoutineEdit): Promise<void> {
  const { data, error } = await client
    .from('routines')
    .update({ title: input.title.trim(), days_of_week: input.days_of_week, time_of_day: input.time_of_day, picture: input.picture })
    .eq('id', id)
    .is('archived_at', null)
    .select('id');
  if (error) throw error;
  if (data.length === 0) throw new Error('No Routine was updated.');
}

// Archiving keeps the Routine and every Completion; it just leaves the wall.
export async function archiveRoutine(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from('routines').update({ archived_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

// Writes positions 0..n-1 in the order given, all or nothing: the database
// refuses the whole reorder if any id is not a Routine the caller may move.
export async function reorderRoutines(client: SupabaseClient, orderedIds: string[]): Promise<void> {
  const { error } = await client.rpc('reorder_routines', { ids: orderedIds });
  if (error) throw error;
}

// ---- Routine Completions (Household Account or Device) --------------------------

// The ids of the Routines completed on `date`: what is checked that day.
export async function loadCompletions(client: SupabaseClient, date: string): Promise<string[]> {
  const { data, error } = await client.from('routine_completions').select('routine_id').eq('completed_on', date);
  if (error) throw error;
  return (data as { routine_id: string }[]).map((row) => row.routine_id);
}

// Ticking twice is one completion: a second tablet that ticked first is not an error.
export async function completeRoutine(client: SupabaseClient, routineId: string, date: string): Promise<void> {
  const { error } = await client.from('routine_completions').insert({ routine_id: routineId, completed_on: date });
  if (error && error.code !== '23505') throw error;
}

export async function uncompleteRoutine(client: SupabaseClient, routineId: string, date: string): Promise<void> {
  const { error } = await client.from('routine_completions').delete().eq('routine_id', routineId).eq('completed_on', date);
  if (error) throw error;
}
