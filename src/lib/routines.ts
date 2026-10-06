import type { SupabaseClient } from '@supabase/supabase-js';
import { offsetMs } from '../../supabase/functions/_shared/zoned-time.ts';
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
// Routines today (todaysRoutines), so an archived Routine, one not scheduled today and a completion
// of either are never counted, whatever `doneIds` holds.
export function routineProgress(routines: Routine[], doneIds: ReadonlySet<string>): RoutineProgress {
  return { done: routines.filter((routine) => doneIds.has(routine.id)).length, total: routines.length };
}

// Whether a tap finishes the Profile: it ticks (never unticks) a Routine and so takes the Profile's
// Routines today from not all done to all done. `routines` are that Profile's Routines today and
// `doneBefore` the ids done before the tap. The last tick of a Profile finishes it; a Profile with
// no Routines today is never finished.
export function tapFinishesProfile(routines: Routine[], doneBefore: ReadonlySet<string>, routineId: string, checked: boolean): boolean {
  if (!checked) return false;
  const before = routineProgress(routines, doneBefore);
  const after = routineProgress(routines, new Set(doneBefore).add(routineId));
  return before.done < before.total && after.done === after.total;
}

// The ids of the Profiles whose Routines today are all done, the ones that read "All done". A Profile
// with no Routines today is not among them.
export function finishedProfiles(groups: readonly ProfileRoutines[], doneIds: ReadonlySet<string>): Set<string> {
  return new Set(
    groups
      .filter(({ routines }) => {
        const { done, total } = routineProgress(routines, doneIds);
        return total > 0 && done === total;
      })
      .map(({ profile }) => profile.id),
  );
}

// ---- The parts of the day ---------------------------------------------------------------------

// The parts of the day, in the order the day happens. Any time is not one.
export const PARTS: readonly TimeOfDay[] = ['morning', 'afternoon', 'evening'];

// Where the afternoon and the evening begin, as the hour of the Household's wall clock. The morning begins at midnight,
// not at 5:00, so nothing of a new day is ever "left from earlier".
const AFTERNOON_FROM = 12;
const EVENING_FROM = 17;

// The hour of the Household's wall clock at `now`, 0 to 23, daylight saving included. Never the machine's zone.
function householdHour(timezone: string, now: Date): number {
  return new Date(now.getTime() + offsetMs(now.getTime(), timezone)).getUTCHours();
}

// The part of the day `now` is in, by the Household's wall clock. On a 23 or 25 hour day it follows the clock on the wall
// and not the hours that have passed, so the afternoon still begins at 12:00.
export function partOfDay(timezone: string, now: Date = new Date()): TimeOfDay {
  const hour = householdHour(timezone, now);
  return hour >= EVENING_FROM ? 'evening' : hour >= AFTERNOON_FROM ? 'afternoon' : 'morning';
}

// The part of the day a screen last looked at, and in which zone.
export type PartSeen = { timezone: string; part: TimeOfDay };

// What a screen keeps after it looks at the part of the day again: the very same object while it is still the part it saw, in the
// same zone, so a screen that holds it in state is not drawn again every minute for nothing, only when a part begins.
export function seePart(was: PartSeen | null, timezone: string, now: Date = new Date()): PartSeen {
  const part = partOfDay(timezone, now);
  return was !== null && was.timezone === timezone && was.part === part ? was : { timezone, part };
}

// What the chart shows one Profile for one part of the day.
export type PartView = {
  // The part's own Routines, ticked or not.
  own: Routine[];
  // "Left from earlier": Routines of earlier parts that are not ticked, and the ones that were not when the chart showed
  // them (`held`), which stay where they are, done, until the part changes. The morning's first, each part in its order.
  earlier: Routine[];
  // Routines with no time of day, ticked or not: they belong to every part.
  anytime: Routine[];
  // Routines of earlier parts that are ticked and not shown: what the foot line counts.
  doneEarlier: number;
};

// What a part shows a Profile: its own Routines, then what is left from earlier, then Any time. `routines` are that
// Profile's Routines today and `done` the ids ticked today.
export function partView(routines: Routine[], done: ReadonlySet<string>, part: TimeOfDay, held: ReadonlySet<string> = new Set()): PartView {
  const of = (timeOfDay: TimeOfDay | null) => byPosition(routines.filter((routine) => routine.time_of_day === timeOfDay));
  const before = PARTS.slice(0, PARTS.indexOf(part)).flatMap(of);
  const earlier = before.filter((routine) => !done.has(routine.id) || held.has(routine.id));
  return { own: of(part), earlier, anytime: of(null), doneEarlier: before.length - earlier.length };
}

// Whether the part is done: everything it shows is ticked, and it shows something.
export function partDone(view: PartView, done: ReadonlySet<string>): boolean {
  const shown = [...view.own, ...view.earlier, ...view.anytime];
  return shown.length > 0 && shown.every((routine) => done.has(routine.id));
}

// ---- The chart: which part it shows -------------------------------------------------------------

// What the Routines chart is showing: a part of the day, or the whole day. `clock` is the part the clock was in when the
// chart last looked, so it can tell a new part has begun; `held` is what the part has shown as not ticked, to keep in place.
export type ChartPart = TimeOfDay | 'whole';
export type Chart = { part: ChartPart; clock: TimeOfDay; held: ReadonlySet<string> };

const nothingHeld: ReadonlySet<string> = new Set();

// A chart opens on the part it is now.
export const openChart = (clock: TimeOfDay): Chart => ({ part: clock, clock, held: nothingHeld });

// A part picked by hand holds until a new part begins. Moving to another part lets go of what the last one held.
export const pickPart = (chart: Chart, part: ChartPart): Chart => (part === chart.part ? chart : { ...chart, part, held: nothingHeld });

// An open chart moves to a new part when that part begins, whatever was picked.
export const followClock = (chart: Chart, clock: TimeOfDay): Chart => (clock === chart.clock ? chart : openChart(clock));

// Keeps in place the Routines the part has shown as not ticked, so one ticked while it is shown stays where it is, done,
// until the part changes. It is the same chart when there is nothing new to keep.
export function holdShown(chart: Chart, shown: Iterable<string>): Chart {
  const fresh = [...shown].filter((id) => !chart.held.has(id));
  return fresh.length === 0 ? chart : { ...chart, held: new Set([...chart.held, ...fresh]) };
}

// A column for every Profile that has a Routine on any day, in Profile order, so a child's column never moves. Each holds the
// Routines scheduled for `weekday`, which are none on a day its Profile has none.
export function columnsOf(profiles: Profile[], routines: Routine[], weekday: number): ProfileRoutines[] {
  return groupByProfile(
    profiles,
    routines.filter((routine) => routine.archived_at === null),
  ).map(({ profile, routines: own }) => ({ profile, routines: todaysRoutines(own, weekday) }));
}

// The person the phone's Routines tab opens on: the first, in the people strip's order, with something left in the part shown
// (its own Routines, what is left from earlier and Routines for any time, or on the whole day any at all), else the first person.
// Nobody when there are no people. `columns` are the chart's, in Profile order.
export function firstPick(columns: readonly ProfileRoutines[], done: ReadonlySet<string>, part: ChartPart): string | null {
  const left = ({ routines }: ProfileRoutines) => {
    if (part === 'whole') return routines.some((routine) => !done.has(routine.id));
    const view = partView(routines, done, part);
    return [...view.own, ...view.earlier, ...view.anytime].some((routine) => !done.has(routine.id));
  };
  return (columns.find(left) ?? columns[0])?.profile.id ?? null;
}

// Whom the phone's Routines tab shows: the person picked while they are still on the chart, so a tick that finishes them, a refetch
// that brings new data, Household midnight (when `settled` drops for a moment) and a failed read never move the card. Only when there
// is no pick, or the person has left the chart, is someone picked again: by firstPick once today's ticks are read (`settled`, since
// it looks for what is left), else the first person when the read has failed, so the tab is never waiting on a read that is not
// coming. Null while there is nobody, or the read is still on its way.
export function pickedPerson(input: {
  picked: string | null;
  columns: readonly ProfileRoutines[];
  done: ReadonlySet<string>;
  part: ChartPart;
  settled: boolean;
  failed: boolean;
}): string | null {
  const { picked, columns, done, part, settled, failed } = input;
  if (picked !== null && columns.some(({ profile }) => profile.id === picked)) return picked;
  if (columns.length === 0) return null;
  if (settled) return firstPick(columns, done, part);
  return failed ? columns[0]!.profile.id : null;
}

// ---- Up next -------------------------------------------------------------------------------------

// Up next on Home shows a tile for this many people at most, unless the screen is too short for that many (home-layout.ts).
export const UP_NEXT_TILES = 3;

// How long Up next keeps a Routine that was ticked on it where it is, in the done look, before it gives way to what that
// person has next: long enough for a second tap to take the tick back, so a double tap never ticks the one that follows, and
// for the celebration to play where the tile was.
export const HOME_HOLD_MS = 4_000;

// What was ticked on Up next and when (epoch milliseconds), by Routine id.
export type TickedHere = Readonly<Record<string, number>>;

// `done` says the tile is in the done look: a Routine ticked on Up next a moment ago, held where it is.
type UpNextTile = { profile: Profile; routine: Routine; done: boolean };

// `tiles`: one for each of the first Profiles in order that have a tile to show, each showing the Routine of theirs that was
// ticked on Up next less than HOME_HOLD_MS ago and still is (the latest, held in the done look), else their first Routine not
// ticked among the part's own, what is left from earlier, and Any time. So a person's last Routine goes only once its hold
// has ended, and keeps its place among the tiles until then. `more`: today's Routines not ticked that no tile shows, which
// include a later part's. `groups` are the Profiles' Routines today; `ticked` is what was ticked on Up next and when, and `now`
// is the time, in the same milliseconds.
export function upNext(
  groups: readonly ProfileRoutines[],
  done: ReadonlySet<string>,
  part: TimeOfDay,
  ticked: TickedHere,
  now: number,
  limit = UP_NEXT_TILES,
): { tiles: UpNextTile[]; more: number } {
  const tiles = groups
    .flatMap(({ profile, routines }): UpNextTile[] => {
      const held = routines.reduce<Routine | undefined>((latest, candidate) => {
        const at = ticked[candidate.id];
        if (at === undefined || now - at >= HOME_HOLD_MS || !done.has(candidate.id)) return latest;
        return latest === undefined || at > (ticked[latest.id] ?? 0) ? candidate : latest;
      }, undefined);
      const view = partView(routines, done, part);
      const next = [...view.own, ...view.earlier, ...view.anytime].find((candidate) => !done.has(candidate.id));
      const routine = held ?? next;
      return routine ? [{ profile, routine, done: held !== undefined }] : [];
    })
    .slice(0, limit);
  const left = groups.reduce((count, { routines }) => count + routines.filter((routine) => !done.has(routine.id)).length, 0);
  return { tiles, more: left - tiles.filter((tile) => !tile.done).length };
}

// When the first of the holds that have not ended ends, or nothing when none is left: when Up next has to look again.
export function holdEndsAt(ticked: TickedHere, now: number): number | null {
  const ends = Object.values(ticked)
    .map((at) => at + HOME_HOLD_MS)
    .filter((end) => end > now);
  return ends.length === 0 ? null : Math.min(...ends);
}

// The link in Up next's heading to the chart: "All routines", or, when the tiles do not show all that is left today, how many
// more there are ("5 more"). Its name always says where it goes, and starts with what is read, so the two agree.
export function upNextLink(more: number): { words: string; name: string } {
  return more > 0 ? { words: `${more} more`, name: `${more} more. All routines` } : { words: 'All routines', name: 'All routines' };
}

// ---- A tick that did not save ---------------------------------------------------------------------

export const TICK_FAILED = 'That did not save. Try again.';
export const TICK_OFFLINE = 'No internet, so that did not save. Try again soon.';

// What each Profile's last tick, if it did not save, says (by Profile id), and the Household day those lines were said on.
export type TickProblems = { day: string; says: Readonly<Record<string, string>> };

export const noTickProblems: TickProblems = { day: '', says: {} };

const noLines: Readonly<Record<string, string>> = {};

// The lines that stand on `day`: a line does not outlive the Household day it was said on, so none from an earlier day.
export function problemsOn(problems: TickProblems, day: string): Readonly<Record<string, string>> {
  return problems.day === day ? problems.says : noLines;
}

// Said under a person's column, or tile, when their tick did not save, in words for the screen being offline or not; `day` is the
// Household day the tick was made on. It goes at that person's next tick that saves. Nothing else takes it away: not another
// person's tick, and not coming back online; only the day ending does (problemsOn).
export function afterTick(problems: TickProblems, day: string, profileId: string, saved: boolean, offline: boolean): TickProblems {
  const says = problemsOn(problems, day);
  if (!saved) return { day, says: { ...says, [profileId]: offline ? TICK_OFFLINE : TICK_FAILED } };
  if (says[profileId] === undefined) return problems;
  return { day, says: Object.fromEntries(Object.entries(says).filter(([id]) => id !== profileId)) };
}

// ---- The celebration ------------------------------------------------------------------------

// One burst of confetti over a Profile's group. Its id is new for each burst, so a Profile that finishes
// twice plays it again, and the landing of an older burst ends nothing. `at` is how far down the group (px)
// the Routine that finished the Profile is: where the burst starts.
export type Burst = { id: number; at: number };

// The bursts playing on one screen, by Profile id; the Household day they started on; and how many have
// been started, which is where the next id comes from.
export type Celebration = { day: string | null; bursts: Readonly<Record<string, Burst>>; issued: number };

export const noCelebration: Celebration = { day: null, bursts: {}, issued: 0 };

export type CelebrationEvent =
  // A tap on this screen finished the Profile; the Routine tapped is `at` px down its group.
  | { type: 'finished'; profileId: string; day: string; at: number }
  // The last piece of the Profile's burst `id` landed.
  | { type: 'landed'; profileId: string; id: number }
  // What the screen shows now: the Household day, and the Profiles whose groups are on it and all done.
  | { type: 'shown'; day: string | null; finished: ReadonlySet<string> };

const withoutBursts = (state: Celebration, profileIds: string[]): Celebration => ({
  ...state,
  bursts: Object.fromEntries(Object.entries(state.bursts).filter(([id]) => !profileIds.includes(id))),
});

// The life of the bursts on one screen, so that a burst is only ever over a group that is on the screen
// and finished, on the day it began. A tap that finishes a Profile starts its burst, and its last piece
// landing ends it. The screen says what it shows after every change, and a burst whose Profile is no longer
// finished (an untick, a tick put back), whose group has left the screen, or that began on another
// Household day is gone: it never comes back when a group does, and nothing falls over "2 of 3".
export function celebrate(state: Celebration, event: CelebrationEvent): Celebration {
  switch (event.type) {
    case 'finished': {
      const issued = state.issued + 1;
      // A burst left from another day is not this tap's to keep.
      const kept = event.day === state.day ? state.bursts : {};
      return { day: event.day, bursts: { ...kept, [event.profileId]: { id: issued, at: event.at } }, issued };
    }
    case 'landed':
      return state.bursts[event.profileId]?.id === event.id ? withoutBursts(state, [event.profileId]) : state;
    case 'shown': {
      const playing = Object.keys(state.bursts);
      const gone = event.day === state.day ? playing.filter((id) => !event.finished.has(id)) : playing;
      return gone.length === 0 ? state : withoutBursts(state, gone);
    }
  }
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
