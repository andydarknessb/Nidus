import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { loadOccurrences } from './calendar-occurrences';
import type { WallDay } from './paged-view';
import { watchHouseholdDay, watchMinute } from './household-day';
import { dayEventsOf, type DayEvents } from './day-events';
import { ProfileFilterContext } from './profile-filter';
import type { Profile } from './profiles';
import { OCCURRENCE_TABLES } from './realtime';
import { supabase } from './supabase';
import { useSyncedRead, type ReadStateName } from './synced-read';
import { type HouseholdDay, householdDay } from '../../supabase/functions/_shared/zoned-time.ts';

// What the wall's screens share: the clock, the current Household day, and the one read every
// calendar view makes of occurrences.

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
// "today" (the Meals screen and the Routines reader) reads it here; the zone changing under a mounted screen moves it too.
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

// The day events of `days` (day-events.ts), read through the synced read: at once, when an event, a calendar or a Profile changes
// anywhere in the Household, every 30 seconds and 5 after a failure. The span read is from the first day's start to the last day's
// end; while a new span's first read is on its way (a turned page, Household midnight) what was read stays, and each day still shows
// only its own events. `version` changes when the screen around the calendar has added an event, so it reads again at once; the event
// sheets read again after an edit (`refresh`). The filter works on what was read, so pressing a chip never reads again. `state` is
// the read's (ReadState draws "failed" for a view while nothing has ever loaded).
export type DayEventsRead = DayEvents & { state: ReadStateName; refresh: () => void };

// What one day (or the span) of `events` says of the read: its own `occurrences` are null until they have been read, even while an
// earlier span's read is kept on screen.
export function dayState(events: Pick<DayEventsRead, 'state'>, occurrences: unknown): ReadStateName {
  return events.state === 'failed' ? 'failed' : occurrences === null ? 'loading' : 'ready';
}

export function useDayEvents(days: WallDay[], version: number, profiles: Profile[] | null): DayEventsRead {
  const { pressed } = useContext(ProfileFilterContext);
  const fromMs = days[0]!.startMs;
  const toMs = days[days.length - 1]!.endMs;
  const read = useSyncedRead(() => loadOccurrences(supabase, new Date(fromMs), new Date(toMs)), OCCURRENCE_TABLES, `${fromMs} ${toMs}`, { keepAcrossKeys: true });
  // A change of `version` after the first render is an event added around the calendar.
  const seen = useRef(version);
  const { refresh } = read;
  useEffect(() => {
    if (seen.current === version) return;
    seen.current = version;
    refresh();
  }, [version, refresh]);
  const events = useMemo(() => dayEventsOf(read.data, profiles, pressed), [read.data, profiles, pressed]);
  return { ...events, state: read.state, refresh };
}
