import { useEffect, useReducer, useRef, useState } from 'react';
import { useConnection, useRefetchOn } from './change-feed';
import { watchMinute } from './household-day';
import { loadProfiles, type Profile } from './profiles';
import {
  ROUTINE_TABLES,
  afterTick,
  celebrate,
  columnsOf,
  completeRoutine,
  finishedProfiles,
  groupByProfile,
  loadCompletions,
  loadRoutines,
  noCelebration,
  noTickProblems,
  partOfDay,
  problemsOn,
  seePart,
  tickOptimistically,
  todaysRoutines,
  uncompleteRoutine,
  type CelebrationEvent,
  type PartSeen,
  type ProfileRoutines,
  type Routine,
  type TickProblems,
  type TimeOfDay,
} from './routines';
import { supabase } from './supabase';
import { createSyncedReader, type SyncedReader } from './synced-reader';
import { useHouseholdDay } from './wall-hooks';

// Changes heard from the server normally refresh the Routines at once; this slow read is the
// backstop for a change that was missed while the connection was down.
const REFRESH_MS = 30_000;

type Today = { date: string; routines: Routine[]; profiles: Profile[]; done: Set<string> };

// Today's Routines as the Wall hands them to the screens that show them: Up next on Home and the Routines chart.
export type RoutinesToday = {
  // The Household day they are for; null until the Household Timezone is known.
  date: string | null;
  loaded: boolean;
  // Whether what was read is for the current Household day, so `done` is what has been ticked today. It is not for a moment
  // at the start (the day is UTC's until the Household Timezone is known) and just after Household midnight, when everything
  // reads unchecked until the new day arrives; the chart keeps nothing in place while it is false.
  settled: boolean;
  failed: boolean;
  // The part of the day it is in the Household Timezone, which changes the minute a part begins. (UTC's until the
  // Household Timezone is known, which is before anything is read, so nothing shows it.)
  part: TimeOfDay;
  // What a tick that did not save says, for each Profile whose last tick did not, by Profile id. None from an earlier day.
  problems: Readonly<Record<string, string>>;
  // The Profiles that have Routines today, each with them, in Profile order.
  groups: ProfileRoutines[];
  // Every Profile that has a Routine on any day, each with the ones scheduled today (none on a day it has none): the chart's
  // columns.
  columns: ProfileRoutines[];
  done: Set<string>;
  // The Profiles whose Routines today are all done.
  finished: ReadonlySet<string>;
  // Ticks the Routine, or unticks it, and says whether that was saved.
  toggle: (routine: Routine) => Promise<boolean>;
};

// The part of the day in `timezone`, drawn again only when a part begins and not on every minute: it looks each minute, but
// seePart hands back the same object while nothing has changed, and a state set to what it already is draws nothing. What was
// seen for another zone is never used, so a Household Timezone that arrives or changes is right on the render it arrives in.
function usePartOfDay(timezone: string): TimeOfDay {
  const [seen, setSeen] = useState<PartSeen | null>(null);
  useEffect(() => {
    const read = () => setSeen((was) => seePart(was, timezone));
    read();
    return watchMinute(read);
  }, [timezone]);
  return seen?.timezone === timezone ? seen.part : partOfDay(timezone);
}

// The one reader of today's Routines for the whole Wall: the read and what keeps it current, and the
// tick. The shell calls it once and gives the result to whichever screen shows the Routines, so going from
// Home to the chart and back reads nothing again, and a tap still in flight keeps the read that follows it.
// "Checked" is derived from the completions of today's Household date: nothing resets at midnight,
// yesterday's just stop matching.
export function useRoutinesToday(timezone: string | null): RoutinesToday {
  // Nothing is read until the Household Timezone is: it names the day. ('UTC' only keeps the hooks in
  // order until then; nothing is read from it.)
  const day = useHouseholdDay(timezone ?? 'UTC');
  const part = usePartOfDay(timezone ?? 'UTC');
  const [loaded, setLoaded] = useState<Today | null>(null);
  const [problems, setProblems] = useState<TickProblems>(noTickProblems);
  const [failed, setFailed] = useState(false);
  // Whether the screen is offline when a tick fails, which decides what that tick says: read when it fails, not when it was made.
  const offline = useRef(false);
  const connection = useConnection();
  useEffect(() => {
    offline.current = connection === 'offline';
  });
  // Reads and the taps made here take turns: a read never lands over a tap in flight, and one
  // follows each tap, so a change from another tablet that arrived meanwhile is shown too.
  const reader = useRef<SyncedReader | null>(null);

  useEffect(() => {
    if (timezone === null) return;
    const date = day.date;
    const next = createSyncedReader(
      async () => {
        const [profiles, routines, completed] = await Promise.all([loadProfiles(supabase), loadRoutines(supabase), loadCompletions(supabase, date)]);
        return { date, profiles, routines, done: new Set(completed) };
      },
      (today) => {
        setLoaded(today);
        setFailed(false);
      },
      () => setFailed(true),
    );
    reader.current = next;
    next.refresh();
    const id = setInterval(() => next.refresh(), REFRESH_MS);
    return () => {
      next.dispose();
      clearInterval(id);
      reader.current = null;
    };
  }, [timezone, day.date]);
  useRefetchOn(ROUTINE_TABLES, () => reader.current?.refresh());

  // Loaded for another day (midnight just passed): everything reads unchecked until the new day arrives.
  const settled = loaded !== null && loaded.date === day.date;
  const done = loaded && settled ? loaded.done : new Set<string>();
  const groups = loaded ? groupByProfile(loaded.profiles, todaysRoutines(loaded.routines, day.weekday)) : [];
  const columns = loaded ? columnsOf(loaded.profiles, loaded.routines, day.weekday) : [];

  async function toggle(routine: Routine): Promise<boolean> {
    const date = day.date;
    const checking = !done.has(routine.id);
    const publish = (update: (ids: Set<string>) => Set<string>) =>
      setLoaded((prev) => (prev && prev.date === date ? { ...prev, done: update(prev.done) } : prev));
    const tap = () =>
      tickOptimistically(publish, routine.id, checking, () =>
        checking ? completeRoutine(supabase, routine.id, date) : uncompleteRoutine(supabase, routine.id, date),
      );
    const stuck = await (reader.current ? reader.current.write(tap) : tap());
    // Said for the day the tick was made on, so one that fails after midnight is never shown on the new day.
    setProblems((current) => afterTick(current, date, routine.profile_id, stuck, offline.current));
    return stuck;
  }

  return {
    date: timezone === null ? null : day.date,
    loaded: loaded !== null,
    settled,
    failed,
    part,
    problems: problemsOn(problems, day.date),
    groups,
    columns,
    done,
    finished: finishedProfiles(groups, done),
    toggle,
  };
}

// The bursts of confetti playing on one screen, which each screen keeps for itself: celebrate() decides when one starts
// and ends. The screen says what it shows on every render, and a burst whose Profile is no longer finished,
// whose group has left the screen, or that began on another day goes in that very render, so not one frame
// of it is drawn over "2 of 3" and it can never play again when a group returns.
export function useCelebration({ date, finished }: Pick<RoutinesToday, 'date' | 'finished'>) {
  const [state, dispatch] = useReducer(celebrate, noCelebration);
  const shown: CelebrationEvent = { type: 'shown', day: date, finished };
  const current = celebrate(state, shown);
  if (current !== state) dispatch(shown);
  return {
    bursts: current.bursts,
    // `at`: how far down its group the Routine that finished the Profile is.
    start(profileId: string, at: number) {
      // Someone who asked for less motion gets "All done" and no burst.
      if (date !== null && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) dispatch({ type: 'finished', profileId, day: date, at });
    },
    land: (profileId: string, id: number) => dispatch({ type: 'landed', profileId, id }),
  };
}
