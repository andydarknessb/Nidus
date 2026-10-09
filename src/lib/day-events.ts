import { dayOccurrences, type Occurrence } from './calendar-occurrences';
import type { WallDay } from './paged-view';
import { monthDots, type MonthDot } from './phone-calendar';
import { filterOccurrences } from './profile-filter';
import type { Profile } from './profiles';

// The day events (spec 0008): which Synced and Native Events are on which Household Date, in what order, for whom. Every calendar view
// asks this and only draws the answer. The read itself is useDayEvents (wall-hooks.ts), through the synced read; this is the part
// that needs no screen and no server, so it is tested against what the real database returns.
//
// The Profile Filter (CONTEXT.md) decides two things here. Which events show: those for a pressed person or for the whole Household,
// everything when none is pressed. And who a day's summary names: the phone month's dots name only the pressed. An event that shows
// still names all its people (pillPeople), so nothing here changes what an event says of itself.

export type DayEvents = {
  // What the filter lets through, in start order; null until both the events and the Profiles are read.
  occurrences: Occurrence[] | null;
  // The events on `day`: all-day first, then by start, then by title (dayOccurrences). Null until read.
  on(day: WallDay): Occurrence[] | null;
  // The dots of `day` on the phone's month: the whole Household's, then each pressed person who has something.
  dots(day: WallDay): MonthDot[];
};

export function dayEventsOf(read: Occurrence[] | null, profiles: readonly Profile[] | null, pressed: readonly string[]): DayEvents {
  const occurrences = read === null || profiles === null ? null : filterOccurrences(read, pressed);
  const on = (day: WallDay) => (occurrences === null ? null : dayOccurrences(occurrences, day));
  return {
    occurrences,
    on,
    dots: (day) => monthDots(on(day) ?? [], profiles ?? [], pressed),
  };
}
