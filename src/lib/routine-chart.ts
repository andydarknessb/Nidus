import { Moon, Sun, Sunrise, type LucideIcon } from 'lucide-react';
import { byPosition } from './ordering';
import type { Profile } from './profiles';
import { TIME_OF_DAY_GROUPS, isScheduledOn, partOfDay, routineProgress, type Routine, type RoutineProgress, type TimeOfDay } from './routines';
import type { ReadStateName } from './synced-read';
import { NOT_SAVED, NOT_SAVED_OFFLINE } from './write-failure';

// The Routine Chart (CONTEXT.md): the Household's Routines for one Household Date, one column per Profile with a Routine that day, grouped by
// time of day. The Wall's chart screen draws every column, the phone's Routines tab one picked column, Up next on Home the next Routine of
// each person, and the people strip a count. This is the plain core, with no screen and no database: it takes the facts (what the read holds,
// the clock, the Profiles) and what the chart keeps between renders (ChartState), and answers every screen's questions, so each rule is
// written once. tests/routine-chart.test.ts drives it; use-routine-chart.ts is the hook that reads the facts and holds the state.
//
// "Checked" is never stored per day by a job: a Routine is checked today when a Routine Completion exists for today's Household date, so at
// Household midnight the Wall reads unchecked again with nothing to reset (src/lib/routines.ts).

// ---- The parts of the day -----------------------------------------------------------------------

// The parts of the day, in the order the day happens. Any time is not one.
const PARTS: readonly TimeOfDay[] = ['morning', 'afternoon', 'evening'];

// The part of the day a screen last looked at, and in which zone.
export type PartSeen = { timezone: string; part: TimeOfDay };

// What a screen keeps after it looks at the part of the day again: the very same object while it is still the part it saw, in the
// same zone, so a screen that holds it in state is not drawn again every minute for nothing, only when a part begins.
export function seePart(was: PartSeen | null, timezone: string, now: Date = new Date()): PartSeen {
  const part = partOfDay(timezone, now);
  return was !== null && was.timezone === timezone && was.part === part ? was : { timezone, part };
}

// What the chart is showing: a part of the day, or the whole day.
export type ChartPart = TimeOfDay | 'whole';

// The words and icon on the chart's control, one choice for each part of the day and one for all of it.
export const CHART_CHOICES: { part: ChartPart; label: string; icon?: LucideIcon }[] = [
  { part: 'morning', label: 'Morning', icon: Sunrise },
  { part: 'afternoon', label: 'Afternoon', icon: Sun },
  { part: 'evening', label: 'Evening', icon: Moon },
  { part: 'whole', label: 'Whole day' },
];

// The word for a time of day. Any time has none: it is the absence of one.
export function timeWord(timeOfDay: TimeOfDay | null): string | undefined {
  return TIME_OF_DAY_GROUPS.find((group) => group.value !== null && group.value === timeOfDay)?.label;
}

// What the chart shows one Profile for one part of the day.
type PartView = {
  // The part's own Routines, ticked or not.
  own: Routine[];
  // "Left from earlier": Routines of earlier parts that are not ticked, and the ones that were not when the chart showed them (`held`),
  // which stay where they are, done, until the part changes. The morning's first, each part in its order.
  earlier: Routine[];
  // Routines with no time of day, ticked or not: they belong to every part.
  anytime: Routine[];
  // Routines of earlier parts that are ticked and not shown: what the foot line counts.
  doneEarlier: number;
  // Everything the part shows, in the order it shows it: own, earlier, then anytime. On the whole day, every Routine.
  visible: Routine[];
};

// What a part shows a Profile: its own Routines, then what is left from earlier, then Any time. `routines` are that Profile's Routines
// today and `done` the ids ticked today. The whole day shows them all, with nothing "left from earlier".
function partView(routines: Routine[], done: ReadonlySet<string>, part: ChartPart, held: ReadonlySet<string> = new Set()): PartView {
  if (part === 'whole') return { own: [], earlier: [], anytime: [], doneEarlier: 0, visible: routines };
  const of = (timeOfDay: TimeOfDay | null) => byPosition(routines.filter((routine) => routine.time_of_day === timeOfDay));
  const before = PARTS.slice(0, PARTS.indexOf(part)).flatMap(of);
  const earlier = before.filter((routine) => !done.has(routine.id) || held.has(routine.id));
  const own = of(part);
  const anytime = of(null);
  return { own, earlier, anytime, doneEarlier: before.length - earlier.length, visible: [...own, ...earlier, ...anytime] };
}

// ---- Which part the chart shows -------------------------------------------------------------------

// `clock` is the part the clock was in when the chart last looked, so it can tell a new part has begun; `held` is what the part has shown
// as not ticked, to keep in place.
type Chart = { part: ChartPart; clock: TimeOfDay; held: ReadonlySet<string> };

const nothingHeld: ReadonlySet<string> = new Set();

// A chart opens on the part it is now.
const openChart = (clock: TimeOfDay): Chart => ({ part: clock, clock, held: nothingHeld });

// A part picked by hand holds until a new part begins. Moving to another part lets go of what the last one held.
const pickedPart = (chart: Chart, part: ChartPart): Chart => (part === chart.part ? chart : { ...chart, part, held: nothingHeld });

// An open chart moves to a new part when that part begins, whatever was picked.
const followClock = (chart: Chart, clock: TimeOfDay): Chart => (clock === chart.clock ? chart : openChart(clock));

// Keeps in place the Routines the part has shown as not ticked, so one ticked while it is shown stays where it is, done, until the part
// changes. It is the same chart when there is nothing new to keep.
function holdShown(chart: Chart, shown: Iterable<string>): Chart {
  const fresh = [...shown].filter((id) => !chart.held.has(id));
  return fresh.length === 0 ? chart : { ...chart, held: new Set([...chart.held, ...fresh]) };
}

// ---- The columns ------------------------------------------------------------------------------------

type ProfileRoutines = { profile: Profile; routines: Routine[] };

// A column for every Profile that has a Routine on any day, in Profile order, so a child's column never moves. Each holds the Routines
// scheduled for `weekday`, which are none on a day its Profile has none.
function columnsOf(profiles: Profile[], routines: Routine[], weekday: number): ProfileRoutines[] {
  return byPosition(profiles)
    .map((profile) => ({ profile, routines: routines.filter((routine) => routine.profile_id === profile.id && routine.archived_at === null) }))
    .filter((column) => column.routines.length > 0)
    .map(({ profile, routines: own }) => ({ profile, routines: byPosition(own.filter((routine) => isScheduledOn(routine.days_of_week, weekday))) }));
}

// Whether a Profile is finished: everything it has today is done, and it has something. The one place that says so.
const isFinished = ({ done, total }: RoutineProgress): boolean => total > 0 && done === total;

// ---- Who the phone shows --------------------------------------------------------------------------

// The person the phone's Routines tab opens on: the first, in the people strip's order, with something left in the part shown
// (what it shows, or on the whole day any at all), else the first person. Nobody when there are no people. `columns` are the chart's,
// in Profile order.
function firstPick(columns: readonly ProfileRoutines[], done: ReadonlySet<string>, part: ChartPart): string | null {
  const left = ({ routines }: ProfileRoutines) => partView(routines, done, part).visible.some((routine) => !done.has(routine.id));
  return (columns.find(left) ?? columns[0])?.profile.id ?? null;
}

// Whom the phone's Routines tab shows: the person picked while they are still on the chart, so a tick that finishes them, a refetch
// that brings new data, Household midnight (when `settled` drops for a moment) and a failed read never move the card. Only when there
// is no pick, or the person has left the chart, is someone picked again: by firstPick once today's ticks are read (`settled`, since
// it looks for what is left), else the first person when the read has failed, so the tab is never waiting on a read that is not
// coming. Null while there is nobody, or the read is still on its way.
function pickedPerson(input: {
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

// What the Routines say of their read, for ReadState (spec 0011). The synced read stays date-agnostic, so the Routines map their own
// `settled` onto the state they hand on: what was read for another day (just after Household midnight, or before the Household
// Timezone names the day) is not ready, it is loading; and a read that is failing with nothing for today is failed, so the screens say
// so rather than leave "Loading" for ever.
function routinesState(settled: boolean, read: { state: ReadStateName; failed: boolean }): ReadStateName {
  if (settled) return read.state;
  return read.failed ? 'failed' : 'loading';
}

// ---- Up next -------------------------------------------------------------------------------------

// Up next on Home shows a tile for this many people at most, unless the screen is too short for that many (home-layout.ts).
export const UP_NEXT_TILES = 3;

// How long Up next keeps a Routine that was ticked on it where it is, in the done look, before it gives way to what that
// person has next: long enough for a second tap to take the tick back, so a double tap never ticks the one that follows, and
// for the celebration to play where the tile was.
export const HOME_HOLD_MS = 4_000;

// What was ticked and when (epoch milliseconds), by Routine id.
export type TickedHere = Readonly<Record<string, number>>;

// `done` says the tile is in the done look: a Routine ticked a moment ago, held where it is.
type UpNextTile = { profile: Profile; routine: Routine; done: boolean };

// `tiles`: one for each of the first Profiles in order that have a tile to show, each showing the Routine of theirs that was
// ticked less than HOME_HOLD_MS ago and still is (the latest, held in the done look), else their first Routine not
// ticked among the part's own, what is left from earlier, and Any time. So a person's last Routine goes only once its hold
// has ended, and keeps its place among the tiles until then. `more`: today's Routines not ticked that no tile shows, which
// include a later part's. `groups` are the Profiles' Routines today; `ticked` is what was ticked and when, and `now`
// is the time, in the same milliseconds.
function upNextTiles(
  groups: readonly ProfileRoutines[],
  done: ReadonlySet<string>,
  part: TimeOfDay,
  ticked: TickedHere,
  now: number,
  limit: number,
): { tiles: UpNextTile[]; more: number } {
  const tiles = groups
    .flatMap(({ profile, routines }): UpNextTile[] => {
      const held = routines.reduce<Routine | undefined>((latest, candidate) => {
        const at = ticked[candidate.id];
        if (at === undefined || now - at >= HOME_HOLD_MS || !done.has(candidate.id)) return latest;
        return latest === undefined || at > (ticked[latest.id] ?? 0) ? candidate : latest;
      }, undefined);
      const next = partView(routines, done, part).visible.find((candidate) => !done.has(candidate.id));
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
function upNextLink(more: number): { words: string; name: string } {
  return more > 0 ? { words: `${more} more`, name: `${more} more. All routines` } : { words: 'All routines', name: 'All routines' };
}

// ---- A tick that did not save ---------------------------------------------------------------------
// (its two sentences are write-failure.ts's, the Wall's as the phone's)

// What each Profile's last tick, if it did not save, says (by Profile id), and the Household day those lines were said on.
type TickProblems = { day: string; says: Readonly<Record<string, string>> };

const noTickProblems: TickProblems = { day: '', says: {} };

const noLines: Readonly<Record<string, string>> = {};

// The lines that stand on `day`: a line does not outlive the Household day it was said on, so none from an earlier day.
function problemsOn(problems: TickProblems, day: string): Readonly<Record<string, string>> {
  return problems.day === day ? problems.says : noLines;
}

// Said under a person's column, or tile, when their tick did not save, in words for the screen being offline or not; `day` is the
// Household day the tick was made on. It goes at that person's next tick that saves. Nothing else takes it away: not another
// person's tick, and not coming back online; only the day ending does (problemsOn).
function afterTick(problems: TickProblems, day: string, profileId: string, saved: boolean, offline: boolean): TickProblems {
  const says = problemsOn(problems, day);
  if (!saved) return { day, says: { ...says, [profileId]: offline ? NOT_SAVED_OFFLINE : NOT_SAVED } };
  if (says[profileId] === undefined) return problems;
  return { day, says: Object.fromEntries(Object.entries(says).filter(([id]) => id !== profileId)) };
}

// ---- The celebration ------------------------------------------------------------------------

// One burst of confetti over a Profile's group. Its id is new for each burst, so a Profile that finishes
// twice plays it again, and the landing of an older burst ends nothing. `at` is how far down the group (px)
// the Routine that finished the Profile is: where the burst starts.
type Burst = { id: number; at: number };

// The bursts playing, by Profile id; the Household day they started on; and how many have been started, which is where the next id
// comes from.
type Celebration = { day: string | null; bursts: Readonly<Record<string, Burst>>; issued: number };

const noCelebration: Celebration = { day: null, bursts: {}, issued: 0 };

type CelebrationEvent =
  // A tap finished the Profile; the Routine tapped is `at` px down its group.
  | { type: 'finished'; profileId: string; day: string; at: number }
  // The last piece of the Profile's burst `id` landed.
  | { type: 'landed'; profileId: string; id: number }
  // What the chart shows now: the Household day, and the Profiles whose groups are on it and all done.
  | { type: 'shown'; day: string | null; finished: ReadonlySet<string> };

const withoutBursts = (state: Celebration, profileIds: string[]): Celebration => ({
  ...state,
  bursts: Object.fromEntries(Object.entries(state.bursts).filter(([id]) => !profileIds.includes(id))),
});

// The life of the bursts, so that a burst is only ever over a group that is on the screen and finished, on the day it began. A tap that
// finishes a Profile starts its burst, and its last piece landing ends it. The chart says what it shows after every change, and a burst
// whose Profile is no longer finished (an untick, a tick put back), whose group has left the screen, or that began on another
// Household day is gone: it never comes back when a group does, and nothing falls over "2 of 3".
function celebrate(state: Celebration, event: CelebrationEvent): Celebration {
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

// ---- A tap ------------------------------------------------------------------------------------------

// The parts of an element a tap reads, so a test hands it plain numbers and the page hands it the element itself.
export type Measured = { getBoundingClientRect(): { top: number; height: number } };
export type Frame = Measured & { clientTop: number };

// What a tap on a Routine does, the same for a Profile's column on the Wall, its card on the phone and Up next: it ticks the Routine or
// takes the tick back, and when it ticks the Profile's last one, a burst of confetti starts where the finger was. `routines` are the
// Profile's Routines today and `done` the ids done before the tap. `frame` is the column or card the burst is drawn over, null before it
// is on the page; there is no burst without one. The burst starts at the middle of the button, measured from the frame's padding edge,
// which is the burst's own top.
function tapOutcome(
  routines: Routine[],
  done: ReadonlySet<string>,
  routineId: string,
  button: Measured,
  frame: Frame | null,
): { checking: boolean; finishes: boolean; burstAt: number | null } {
  const checking = !done.has(routineId);
  const after = new Set(done);
  if (checking) after.add(routineId);
  else after.delete(routineId);
  const finishes = checking && !isFinished(routineProgress(routines, done)) && isFinished(routineProgress(routines, after));
  if (frame === null || !finishes) return { checking, finishes: false, burstAt: null };
  const box = button.getBoundingClientRect();
  const top = frame.getBoundingClientRect().top + frame.clientTop;
  return { checking, finishes: true, burstAt: box.top + box.height / 2 - top };
}

// ---- The chart ------------------------------------------------------------------------------------

// What a read of Routines and Routine Completions holds: the Household day the ticks are for, today's Routines and the ids ticked.
export type ChartRead = { date: string; routines: Routine[]; done: Set<string> };

// The read shown with a tick made at once: on the day it was made on, and no other.
export function tickedRead(read: ChartRead, routineId: string, checking: boolean, date: string): ChartRead {
  if (read.date !== date) return read;
  const done = new Set(read.done);
  if (checking) done.add(routineId);
  else done.delete(routineId);
  return { ...read, done };
}

// What the chart is told by the world: the Household day (null until the Household Timezone is known, when nothing is read) and its
// weekday, the part of the day the clock is in, the Profiles (null until read), the Routines read (null until a read lands, and then for
// the day it was made on, which is not the current one just after Household midnight) and the synced read's own state.
export type ChartFacts = {
  date: string | null;
  weekday: number;
  clock: TimeOfDay;
  profiles: Profile[] | null;
  read: ChartRead | null;
  readState: ReadStateName;
  failed: boolean;
};

// What the chart keeps between renders, which a screen that is left starts again: the part shown (and what it holds in place), the bursts
// playing, the person the phone shows, and what was ticked and when for Up next's holds (`now` is when it last looked). The lines for
// ticks that did not save are the Household's, not a screen's: they stay while the day does.
export type ChartState = {
  chart: Chart;
  celebration: Celebration;
  problems: TickProblems;
  picked: string | null;
  ticked: TickedHere;
  now: number;
};

export const startChart = (clock: TimeOfDay): ChartState => ({ chart: openChart(clock), celebration: noCelebration, problems: noTickProblems, picked: null, ticked: {}, now: 0 });

// What the chart does in the world: the Routine Completion write (rejecting when it did not save), a change to what it keeps, whether the
// screen is offline (read when a tick fails, which decides what that tick says), whether someone asked for less motion (no burst) and the time.
export type ChartEffects = {
  write(routine: Routine, checking: boolean, date: string): Promise<void>;
  change(update: (state: ChartState) => ChartState): void;
  offline(): boolean;
  calm(): boolean;
  now(): number;
};

// A burst over a column, and the way to say its last piece has landed.
export type ChartBurst = Burst & { land: () => void };

// One Profile's column: the part shown, the Routines in it, how far the Profile is and what is said under it.
export type ChartColumn = {
  profile: Profile;
  // The part shown, the Routines it holds in place (they are ticked and stay where they are), and the way to move to another part.
  part: ChartPart;
  held: ReadonlySet<string>;
  pickPart: (part: ChartPart) => void;
  routines: {
    // The Profile's Routines today, in order.
    all: Routine[];
    own: Routine[];
    earlier: Routine[];
    anytime: Routine[];
    // What the part shows: own, earlier, anytime; on the whole day, all.
    visible: Routine[];
    doneEarlier: number;
  };
  // The ids ticked today.
  done: ReadonlySet<string>;
  progress: RoutineProgress;
  finished: boolean;
  // Whether the part is done: it shows something and everything it shows is ticked.
  partDone: boolean;
  // What the last tick of this Profile's that did not save says; nothing when it was saved.
  problem: string | undefined;
  // Set while a burst plays over this column.
  burst: ChartBurst | undefined;
};

export type Tap = { saved: boolean; finished: boolean };

export type RoutineChart = {
  // The Household day; null until the Household Timezone is known.
  date: string | null;
  // The read's state, for today: 'ready' once what was read is for the current Household day (routinesState).
  state: ReadStateName;
  // The part shown and the way to move to another, for the control over the columns (which holds even with no column).
  part: ChartPart;
  pickPart: (part: ChartPart) => void;
  // A column for every Profile that has a Routine on any day, in Profile order; empty until both the Routines and the Profiles are read.
  columns: ChartColumn[];
  columnFor: (profileId: string) => ChartColumn | undefined;
  // Ticks the Routine, or unticks it: starts the burst first when that finishes the Profile, shows the tick at once, writes it, and says
  // under the Profile's column when it did not save. Says whether it saved, and whether the tap finished the Profile.
  tap: (routine: Routine, measured: { button: Measured; frame: Frame | null }) => Promise<Tap>;
  // The person the phone shows, and the way to pick another (a pick lets go of every other person's burst); null while nobody is.
  picked: string | null;
  pick: (profileId: string) => void;
  // Up next: a tile for each of the first `limit` people with something left, how many Routines left they do not show, the link's words,
  // and whether anyone has a Routine today.
  upNext: (limit?: number) => { tiles: (UpNextTile & { problem: string | undefined })[]; more: number; link: { words: string; name: string }; scheduled: boolean };
  // What the hook keeps for the next render: `state` itself when nothing moved (the clock began a part, the Routines left the chart).
  kept: ChartState;
};

const none: ReadonlySet<string> = new Set();

export function routineChart(facts: ChartFacts, state: ChartState, effects: ChartEffects): RoutineChart {
  const { date, clock, profiles, read } = facts;
  // Loaded for another day (midnight just passed): everything reads unchecked until the new day arrives.
  const settled = read !== null && read.date === date;
  const done: ReadonlySet<string> = read && settled ? read.done : none;
  // Empty until both the Routines and the Profiles are read, as the people strip is.
  const days = read && profiles ? columnsOf(profiles, read.routines, facts.weekday) : [];

  // The part follows the clock; what is shown before the day's ticks have been read is not kept: it is not what is left.
  const followed = followClock(state.chart, clock);
  const part = followed.part;
  const chart = holdShown(
    followed,
    part === 'whole' || !settled ? [] : days.flatMap(({ routines }) => partView(routines, done, part).earlier.map((routine) => routine.id)),
  );
  const finished = new Set(days.filter(({ routines }) => isFinished(routineProgress(routines, done))).map(({ profile }) => profile.id));
  const celebration = celebrate(state.celebration, { type: 'shown', day: date, finished });
  const picked = pickedPerson({ picked: state.picked, columns: days, done, part, settled, failed: facts.failed });
  const kept = chart === state.chart && celebration === state.celebration && (picked === null || picked === state.picked) ? state : { ...state, chart, celebration, picked: picked ?? state.picked };

  const says = problemsOn(state.problems, date ?? '');
  const pickPart = (next: ChartPart) => effects.change((was) => ({ ...was, chart: pickedPart(was.chart, next) }));
  const columns = days.map(({ profile, routines }): ChartColumn => {
    const view = partView(routines, done, part, chart.held);
    const progress = routineProgress(routines, done);
    const burst = celebration.bursts[profile.id];
    return {
      profile,
      part,
      held: chart.held,
      pickPart,
      routines: { all: routines, own: view.own, earlier: view.earlier, anytime: view.anytime, visible: view.visible, doneEarlier: view.doneEarlier },
      done,
      progress,
      finished: isFinished(progress),
      partDone: view.visible.length > 0 && view.visible.every((routine) => done.has(routine.id)),
      problem: says[profile.id],
      burst: burst && { ...burst, land: () => effects.change((was) => ({ ...was, celebration: celebrate(was.celebration, { type: 'landed', profileId: profile.id, id: burst.id }) })) },
    };
  });

  async function save(routine: Routine, checking: boolean, on: string, finishes: boolean): Promise<Tap> {
    let saved = true;
    try {
      await effects.write(routine, checking, on);
    } catch {
      saved = false;
    }
    // Said for the day the tick was made on, so one that fails after midnight is never shown on the new day.
    const offline = effects.offline();
    effects.change((was) => ({ ...was, problems: afterTick(was.problems, on, routine.profile_id, saved, offline) }));
    return { saved, finished: finishes };
  }

  return {
    date,
    state: routinesState(settled, { state: facts.readState, failed: facts.failed }),
    part,
    pickPart,
    columns,
    columnFor: (profileId) => columns.find(({ profile }) => profile.id === profileId),
    tap(routine, { button, frame }) {
      if (date === null) return Promise.resolve({ saved: false, finished: false });
      const mine = days.find(({ profile }) => profile.id === routine.profile_id)?.routines ?? [];
      const { checking, finishes, burstAt } = tapOutcome(mine, done, routine.id, button, frame);
      // Someone who asked for less motion gets "All done" and no burst.
      const burst = burstAt !== null && !effects.calm() ? burstAt : null;
      const at = effects.now();
      // A tick is held in its place from now (Up next); a tap on a Routine that is held takes the tick back, and the hold with it.
      effects.change((was) => ({
        ...was,
        celebration: burst === null ? was.celebration : celebrate(was.celebration, { type: 'finished', profileId: routine.profile_id, day: date, at: burst }),
        ticked: checking ? { ...was.ticked, [routine.id]: at } : Object.fromEntries(Object.entries(was.ticked).filter(([id]) => id !== routine.id)),
        now: at,
      }));
      return save(routine, checking, date, finishes);
    },
    picked,
    pick: (profileId) =>
      effects.change((was) => ({
        ...was,
        picked: profileId,
        celebration: celebrate(was.celebration, { type: 'shown', day: was.celebration.day, finished: new Set([profileId]) }),
      })),
    upNext(limit = UP_NEXT_TILES) {
      const groups = days.filter(({ routines }) => routines.length > 0);
      const { tiles, more } = upNextTiles(groups, done, clock, state.ticked, state.now, limit);
      return { tiles: tiles.map((tile) => ({ ...tile, problem: says[tile.profile.id] })), more, link: upNextLink(more), scheduled: groups.length > 0 };
    },
    kept,
  };
}
