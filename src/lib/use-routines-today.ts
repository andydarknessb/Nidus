import { useEffect, useReducer, useRef, useState } from 'react';
import { useConnection } from './change-feed';
import { watchMinute } from './household-day';
import type { Profile } from './profiles';
import {
  WALL_ROUTINE_TABLES,
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
import { useSyncedRead } from './synced-read';
import { useHouseholdDay } from './wall-hooks';

type Today = { date: string; routines: Routine[]; done: Set<string> };

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
export function useRoutinesToday(timezone: string | null, profiles: Profile[] | null): RoutinesToday {
  // Nothing is read until the Household Timezone is: it names the day. ('UTC' only keeps the hooks in
  // order until then; nothing is read from it.)
  const day = useHouseholdDay(timezone ?? 'UTC');
  const part = usePartOfDay(timezone ?? 'UTC');
  const date = day.date;
  // Reads and the taps made here take turns (synced-read.ts): a read never lands over a tap in flight, and one follows each
  // tap, so a change from another tablet that arrived meanwhile is shown too.
  const read = useSyncedRead<Today>(
    async () => {
      const [routines, completed] = await Promise.all([loadRoutines(supabase), loadCompletions(supabase, date)]);
      return { date, routines, done: new Set(completed) };
    },
    WALL_ROUTINE_TABLES,
    timezone === null ? null : `${timezone} ${date}`,
  );
  const loaded = read.data;
  const [problems, setProblems] = useState<TickProblems>(noTickProblems);
  // Whether the screen is offline when a tick fails, which decides what that tick says: read when it fails, not when it was made.
  const offline = useRef(false);
  const connection = useConnection();
  useEffect(() => {
    offline.current = connection === 'offline';
  });

  // Loaded for another day (midnight just passed): everything reads unchecked until the new day arrives.
  const settled = loaded !== null && loaded.date === day.date;
  const done = loaded && settled ? loaded.done : new Set<string>();
  // Empty until both the Routines and the Profiles are read, as the people strip is.
  const groups = loaded && profiles ? groupByProfile(profiles, todaysRoutines(loaded.routines, day.weekday)) : [];
  const columns = loaded && profiles ? columnsOf(profiles, loaded.routines, day.weekday) : [];

  async function toggle(routine: Routine): Promise<boolean> {
    const date = day.date;
    const checking = !done.has(routine.id);
    // Shown at once on the day it was made on; a failed save takes back this tick and no other.
    const tick = (today: Today) => {
      if (today.date !== date) return today;
      const next = new Set(today.done);
      if (checking) next.add(routine.id);
      else next.delete(routine.id);
      return { ...today, done: next };
    };
    let stuck = true;
    try {
      await read.write(() => (checking ? completeRoutine(supabase, routine.id, date) : uncompleteRoutine(supabase, routine.id, date)), tick);
    } catch {
      stuck = false;
    }
    // Said for the day the tick was made on, so one that fails after midnight is never shown on the new day.
    setProblems((current) => afterTick(current, date, routine.profile_id, stuck, offline.current));
    return stuck;
  }

  return {
    date: timezone === null ? null : day.date,
    loaded: loaded !== null,
    settled,
    failed: read.failed,
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
