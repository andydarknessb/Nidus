import { useContext, useEffect, useMemo, useState } from 'react';
import { loadOccurrences, type Occurrence, type WallDay } from './calendar-occurrences';
import { useChangeTick } from './change-feed';
import { watchHouseholdDay } from './household-day';
import { filterOccurrences, PressedProfilesContext } from './profile-filter';
import { OCCURRENCE_TABLES } from './realtime';
import { supabase } from './supabase';

// What the wall's screens share: the clock, and the one read every calendar view makes of occurrences.

// The slow read that backs up the change feed, and the sooner one after a read that failed.
const REFRESH_MS = 60_000;
const RETRY_MS = 5_000;
// How often the clock moves on by itself; Household midnight moves it on at once.
const CLOCK_MS = 30_000;

// The clock, ticking along and also the instant Household midnight passes, so the day columns
// and the calendar's read span move on at midnight, not up to a tick later.
export function useNow(timezone: string): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), CLOCK_MS);
    const stop = watchHouseholdDay(timezone, () => setNow(new Date()));
    return () => {
      clearInterval(id);
      stop();
    };
  }, [timezone]);
  return now;
}

// The occurrences of `days` that the Profile filter lets through, null until the first read lands, and
// whether the latest read failed. `version` changes when the screen around the calendar has written an
// event, so it reads again at once. The filter is applied here and nowhere else, so every calendar view
// obeys it; it works on what was read, so pressing a chip never reads again.
export function useOccurrences(days: WallDay[], version: number): { occurrences: Occurrence[] | null; failed: boolean } {
  const [occurrences, setOccurrences] = useState<Occurrence[] | null>(null);
  const [failed, setFailed] = useState(false);
  const pressed = useContext(PressedProfilesContext);
  const shown = useMemo(() => (occurrences ? filterOccurrences(occurrences, pressed) : null), [occurrences, pressed]);

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

  return { occurrences: shown, failed };
}
