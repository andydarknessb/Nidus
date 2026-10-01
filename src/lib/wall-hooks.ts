import { useEffect, useState } from 'react';
import { loadOccurrences, type Occurrence, type WallDay } from './calendar-occurrences';
import { useChangeTick } from './change-feed';
import { watchHouseholdDay, watchMinute } from './household-day';
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

// The occurrences of `days`, null until the first read lands, and whether the latest read failed.
// `version` changes when the screen around the calendar has written an event, so it reads again at once.
export function useOccurrences(days: WallDay[], version: number): { occurrences: Occurrence[] | null; failed: boolean } {
  const [occurrences, setOccurrences] = useState<Occurrence[] | null>(null);
  const [failed, setFailed] = useState(false);

  // The span to read: from the first day's start to the last day's end. Read again when it changes
  // (the day rolls over, the Household Timezone changes, a page is turned), and on a timer for new events.
  const fromMs = days[0]!.startMs;
  const toMs = days[days.length - 1]!.endMs;
  // Read again the moment an event, a calendar or a Profile's colour changes anywhere in the Household.
  const changes = useChangeTick(OCCURRENCE_TABLES);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function read() {
      let delay = REFRESH_MS;
      try {
        const rows = await loadOccurrences(supabase, new Date(fromMs), new Date(toMs));
        if (live) {
          setOccurrences(rows);
          setFailed(false);
        }
      } catch {
        // Keep what the wall shows and try again sooner.
        if (live) setFailed(true);
        delay = RETRY_MS;
      }
      if (live) timer = setTimeout(() => void read(), delay);
    }

    void read();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [fromMs, toMs, version, changes]);

  return { occurrences, failed };
}
