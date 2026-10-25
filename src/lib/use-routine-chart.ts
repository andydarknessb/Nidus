import { useEffect, useRef, useState } from 'react';
import { useConnection } from './change-feed';
import { watchMinute } from './household-day';
import type { Profile } from './profiles';
import { holdEndsAt, routineChart, seePart, startChart, tickedRead, type ChartEffects, type ChartRead, type ChartState, type PartSeen, type RoutineChart } from './routine-chart';
import { WALL_ROUTINE_TABLES, completeRoutine, loadCompletions, loadRoutines, partOfDay, uncompleteRoutine, type TimeOfDay } from './routines';
import { supabase } from './supabase';
import { useSyncedRead } from './synced-read';
import { useHouseholdDay } from './wall-hooks';

// The Routine Chart as a hook (routine-chart.ts has the rules), for the Wall's chart, the phone's Routines tab, Up next and the people strip.

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

// The one reader of today's Routines for the whole Wall: the read and what keeps it current, and the tick. The shell calls it once and
// gives the result to whichever screen shows the Routines, so going from Home to the chart and back reads nothing again, and a tap
// still in flight keeps the read that follows it. `screen` names the screen on show: what the chart keeps for a screen (the part it
// shows, the person the phone shows, the bursts, Up next's holds) starts again when the screen changes, as it did when each screen
// kept its own: a Whole-day pick does not outlive the screen, and a burst left unfinished does not replay when it is opened again. A
// tick's problem words stay with the day.
export function useRoutineChart({ timezone, profiles, screen }: { timezone: string | null; profiles: Profile[] | null; screen: string }): RoutineChart {
  // Nothing is read until the Household Timezone is: it names the day. ('UTC' only keeps the hooks in order until then; nothing is read
  // from it.)
  const day = useHouseholdDay(timezone ?? 'UTC');
  const clock = usePartOfDay(timezone ?? 'UTC');
  // Reads and the taps made here take turns (synced-read.ts): a read never lands over a tap in flight, and one follows each tap, so a
  // change from another tablet that arrived meanwhile is shown too.
  const read = useSyncedRead<ChartRead>(
    async () => {
      const [routines, completed] = await Promise.all([loadRoutines(supabase), loadCompletions(supabase, day.date)]);
      return { date: day.date, routines, done: new Set(completed) };
    },
    WALL_ROUTINE_TABLES,
    timezone === null ? null : `${timezone} ${day.date}`,
    // Over Household midnight the old day stays shown (unchecked: it is not settled) until the new day's first read lands.
    { keepAcrossKeys: true },
  );
  // Whether the screen is offline when a tick fails, which decides what that tick says: read when it fails, not when it was made.
  const offline = useRef(false);
  const connection = useConnection();
  useEffect(() => {
    offline.current = connection === 'offline';
  });

  const [held, setHeld] = useState<{ screen: string; state: ChartState }>(() => ({ screen, state: startChart(clock) }));
  const state = held.screen === screen ? held.state : { ...startChart(clock), problems: held.state.problems };
  const effects: ChartEffects = {
    write: (routine, checking, date) =>
      read.write(
        () => (checking ? completeRoutine(supabase, routine.id, date) : uncompleteRoutine(supabase, routine.id, date)),
        // Shown at once on the day it was made on; a failed save takes back this tick and no other.
        (today) => tickedRead(today, routine.id, checking, date),
      ),
    change: (update) => setHeld((was) => ({ ...was, state: update(was.state) })),
    offline: () => offline.current,
    calm: () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    now: () => Date.now(),
  };
  const chart = routineChart(
    { date: timezone === null ? null : day.date, weekday: day.weekday, clock, profiles, read: read.data, readState: read.state, failed: read.failed },
    state,
    effects,
  );
  if (chart.kept !== held.state || held.screen !== screen) setHeld({ screen, state: chart.kept });

  // Up next looks again when the first of its holds ends, and not before.
  const { ticked, now } = held.state;
  useEffect(() => {
    const ends = holdEndsAt(ticked, now);
    if (ends === null) return;
    const timer = setTimeout(() => setHeld((was) => ({ ...was, state: { ...was.state, now: Date.now() } })), Math.max(ends - Date.now(), 0));
    return () => clearTimeout(timer);
  }, [ticked, now]);

  return chart;
}
