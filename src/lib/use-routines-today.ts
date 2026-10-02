import { useEffect, useRef, useState } from 'react';
import { useRefetchOn } from './change-feed';
import { loadProfiles, type Profile } from './profiles';
import {
  ROUTINE_TABLES,
  completeRoutine,
  finishedProfiles,
  groupByProfile,
  loadCompletions,
  loadRoutines,
  tickOptimistically,
  todaysRoutines,
  uncompleteRoutine,
  type ProfileRoutines,
  type Routine,
} from './routines';
import { supabase } from './supabase';
import { createSyncedReader, type SyncedReader } from './synced-reader';
import { useHouseholdDay } from './wall-hooks';

// Changes heard from the server normally refresh the Routines at once; this slow read is the
// backstop for a change that was missed while the connection was down.
const REFRESH_MS = 30_000;

type Today = { date: string; routines: Routine[]; profiles: Profile[]; done: Set<string> };

// Today's Routines as the Wall hands them to the screens that show them: the Routines rail on Home and
// the Routines chart.
export type RoutinesToday = {
  // The Household day they are for; null until the Household Timezone is known.
  date: string | null;
  loaded: boolean;
  failed: boolean;
  // Why the last tick was put back, in words; empty when it was not.
  problem: string;
  groups: ProfileRoutines[];
  done: Set<string>;
  // The Profiles whose Routines today are all done.
  finished: ReadonlySet<string>;
  toggle: (routine: Routine) => Promise<void>;
};

// The one reader of today's Routines for the whole Wall: the read and what keeps it current, and the
// tick. The shell calls it once and gives the result to whichever screen shows the Routines, so going from
// Home to the chart and back reads nothing again, and a tap still in flight keeps the read that follows it.
// "Checked" is derived from the completions of today's Household date: nothing resets at midnight,
// yesterday's just stop matching.
export function useRoutinesToday(timezone: string | null): RoutinesToday {
  // Nothing is read until the Household Timezone is: it names the day. ('UTC' only keeps the hooks in
  // order until then; nothing is read from it.)
  const day = useHouseholdDay(timezone ?? 'UTC');
  const [loaded, setLoaded] = useState<Today | null>(null);
  const [problem, setProblem] = useState('');
  const [failed, setFailed] = useState(false);
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
  const done = loaded && loaded.date === day.date ? loaded.done : new Set<string>();
  const groups = loaded ? groupByProfile(loaded.profiles, todaysRoutines(loaded.routines, day.weekday)) : [];

  async function toggle(routine: Routine) {
    const date = day.date;
    const checking = !done.has(routine.id);
    const publish = (update: (ids: Set<string>) => Set<string>) =>
      setLoaded((prev) => (prev && prev.date === date ? { ...prev, done: update(prev.done) } : prev));
    const tap = () =>
      tickOptimistically(publish, routine.id, checking, () =>
        checking ? completeRoutine(supabase, routine.id, date) : uncompleteRoutine(supabase, routine.id, date),
      );
    const stuck = await (reader.current ? reader.current.write(tap) : tap());
    setProblem(stuck ? '' : 'Could not save that tick. It has been put back.');
  }

  return { date: timezone === null ? null : day.date, loaded: loaded !== null, failed, problem, groups, done, finished: finishedProfiles(groups, done), toggle };
}
