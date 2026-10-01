import type { SupabaseClient } from '@supabase/supabase-js';
import { byPosition, movedIds, type Profile } from './profiles';

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
  sort_order: number;
  archived_at: string | null;
};

// What a Household Account chooses when it makes a Routine. Leaving out time_of_day is the same
// as null: any time.
export type RoutineInput = { title: string; days_of_week: number; time_of_day?: TimeOfDay | null };

// What an edit writes: all three fields, the time of day included (null is any time). An edit that
// left it out would clear it, so the type does not allow one.
export type RoutineEdit = Required<RoutineInput>;

// A calendar day in the Household Timezone: 'YYYY-MM-DD' and its weekday (Sunday = 0).
export type HouseholdDay = { date: string; weekday: number };

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

const columns = 'id, profile_id, title, days_of_week, time_of_day, sort_order, archived_at';

// ---- Pure helpers -------------------------------------------------------------

export function maskOf(weekdays: readonly number[]): number {
  return weekdays.reduce((mask, weekday) => mask | (1 << weekday), 0);
}

export function isScheduledOn(mask: number, weekday: number): boolean {
  return (mask & (1 << weekday)) !== 0;
}

// The date and weekday at `now` in the Household Timezone. Never the machine's zone.
export function householdDay(timezone: string, now: Date = new Date()): HouseholdDay {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const [year, month, day] = [Number(part('year')), Number(part('month')), Number(part('day'))];
  const date = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  // The weekday of a calendar date does not depend on any zone, so read it in UTC.
  return { date, weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay() };
}

// The unarchived Routines scheduled for `weekday`, in their order.
export function todaysRoutines(routines: Routine[], weekday: number): Routine[] {
  return byPosition(routines.filter((routine) => routine.archived_at === null && isScheduledOn(routine.days_of_week, weekday)));
}

export type ProfileRoutines = { profile: Profile; routines: Routine[] };

// Routines grouped under their Profile, Profiles in their own order. A Profile with
// nothing to show is left out.
export function groupByProfile(profiles: Profile[], routines: Routine[]): ProfileRoutines[] {
  return byPosition(profiles)
    .map((profile) => ({ profile, routines: byPosition(routines.filter((routine) => routine.profile_id === profile.id)) }))
    .filter((group) => group.routines.length > 0);
}

export type TimeOfDayRoutines = { value: TimeOfDay | null; label: string; routines: Routine[] };

// Routines under Morning, Afternoon, Evening and Any time, in that order, each group in its
// Routines' own order. A group with nothing in it is left out.
export function groupByTimeOfDay(routines: Routine[]): TimeOfDayRoutines[] {
  return TIME_OF_DAY_GROUPS
    .map((group) => ({ ...group, routines: byPosition(routines.filter((routine) => routine.time_of_day === group.value)) }))
    .filter((group) => group.routines.length > 0);
}

// Whether a Profile's Routines get group headings. Not when every one is Any time, so a Household
// that never sets a time of day sees the Routines rail as it always was.
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
      sort_order: sortOrder,
    })
    .select(columns)
    .single();
  if (error) throw error;
  return data as Routine;
}

// Writes a Routine's title, days and time of day, always all three; its position, owner and Routine
// Completions stay as they are. An archived Routine is not edited, and row-level security refuses a
// Device, or another Household's account, by matching no row rather than by raising, so the row is
// asked for back and none means refused.
export async function updateRoutine(client: SupabaseClient, id: string, input: RoutineEdit): Promise<void> {
  const { data, error } = await client
    .from('routines')
    .update({ title: input.title.trim(), days_of_week: input.days_of_week, time_of_day: input.time_of_day })
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

// ---- Optimistic updates ----------------------------------------------------------

type Publish = (update: (checked: Set<string>) => Set<string>) => void;

// Shows the tick (or untick) at once, then asks the server. If the server says no,
// only that Routine goes back; other changes made meanwhile stay. Returns whether it stuck.
export async function tickOptimistically(publish: Publish, routineId: string, checked: boolean, write: () => Promise<void>): Promise<boolean> {
  const set = (value: boolean) => (current: Set<string>) => {
    const next = new Set(current);
    if (value) next.add(routineId);
    else next.delete(routineId);
    return next;
  };
  publish(set(checked));
  try {
    await write();
    return true;
  } catch {
    publish(set(!checked));
    return false;
  }
}
