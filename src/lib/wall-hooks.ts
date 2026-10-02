import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { loadOccurrences, type Occurrence, type WallDay } from './calendar-occurrences';
import { useRefetchOn } from './change-feed';
import { watchHouseholdDay, watchMinute } from './household-day';
import { filterOccurrences, ProfileFilterContext } from './profile-filter';
import { startReadLoop, type ReadLoop } from './read-loop';
import { OCCURRENCE_TABLES } from './realtime';
import { householdDay, type HouseholdDay } from './routines';
import { supabase } from './supabase';

// What the wall's screens share: the clock, the current Household day, and the one read every
// calendar view makes of occurrences.

// The slow read that backs up the change feed, and the sooner one after a read that failed.
const REFRESH_MS = 60_000;
const RETRY_MS = 5_000;

// The clock, ticking at the start of each minute and also the instant Household midnight passes, so
// a clock on the wall turns on the minute and the day columns and the calendar's read span move on
// at midnight, not up to a tick later.
export function useNow(timezone: string): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const stopMinute = watchMinute(() => setNow(new Date()));
    const stopDay = watchHouseholdDay(timezone, () => setNow(new Date()));
    return () => {
      stopMinute();
      stopDay();
    };
  }, [timezone]);
  return now;
}

// The current Household day, moved on at Household midnight with no refresh. A screen that follows
// "today" (Meals and its card) reads it here; the zone changing under a mounted screen moves it too.
export function useHouseholdDay(timezone: string): HouseholdDay {
  const [day, setDay] = useState(() => householdDay(timezone));
  useEffect(() => {
    // A day that has not changed is the same state, so a screen that mounts on today is not drawn twice.
    setDay((prev) => {
      const next = householdDay(timezone);
      return prev.date === next.date ? prev : next;
    });
    return watchHouseholdDay(timezone, setDay);
  }, [timezone]);
  return day;
}

// The occurrences of `days` that the Profile filter lets through, null until the first read lands, and
// whether the latest read failed. `version` changes when the screen around the calendar has written an
// event, so it reads again at once. The filter is applied here and nowhere else, so every calendar view
// obeys it; it works on what was read, so pressing a chip never reads again.
export function useOccurrences(days: WallDay[], version: number): { occurrences: Occurrence[] | null; failed: boolean } {
  const [occurrences, setOccurrences] = useState<Occurrence[] | null>(null);
  const [failed, setFailed] = useState(false);
  const { pressed } = useContext(ProfileFilterContext);
  const shown = useMemo(() => (occurrences ? filterOccurrences(occurrences, pressed) : null), [occurrences, pressed]);

  // The span to read: from the first day's start to the last day's end. Read again when it changes
  // (the day rolls over, the Household Timezone changes, a page is turned), and on a timer for new events.
  const fromMs = days[0]!.startMs;
  const toMs = days[days.length - 1]!.endMs;
  // Read again the moment an event, a calendar or a Profile's colour changes anywhere in the Household.
  // A change pokes the loop instead of restarting it, so a read in flight lands and one more follows.
  const loop = useRef<ReadLoop | null>(null);
  useRefetchOn(OCCURRENCE_TABLES, () => loop.current?.poke());
  useEffect(() => {
    loop.current = startReadLoop({
      read: () => loadOccurrences(supabase, new Date(fromMs), new Date(toMs)),
      onResult: (rows) => {
        setOccurrences(rows);
        setFailed(false);
      },
      onFail: () => setFailed(true),
      refreshMs: REFRESH_MS,
      retryMs: RETRY_MS,
    });
    return () => {
      loop.current?.stop();
      loop.current = null;
    };
  }, [fromMs, toMs, version]);

  return { occurrences: shown, failed };
}
