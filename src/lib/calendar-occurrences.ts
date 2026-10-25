import type { SupabaseClient } from '@supabase/supabase-js';
import { dateWords } from '@shared/event-words.ts';
import { addDays, householdDay, offsetMs, spanIsOn } from '@shared/zoned-time.ts';
import { wallDays, type WallDay } from './paged-view';

// Occurrences on the wall (CONTEXT.md: Synced Event, Native Event). The `calendar_occurrences`
// view unions every source with the Profile it is attributed to; everything below is what the
// wall's calendar does with them: the five days of the home screen, the week, day and month pages'
// titles, and which events are on a day and where the Day view's grid puts them (day-view.ts). The
// routes between the views are in wall-routes.ts, the month cell's fitting in month-grid.ts, and the
// words that say when are in _shared/event-words.ts. All date logic uses the Household Timezone, never the
// machine's zone, and is pure so it is tested without a screen.

export type Occurrence = {
  source: 'synced' | 'native';
  id: string;
  // The Household it belongs to: what a skipped day of a Repeat is written under (skipNativeOccurrence).
  household_id: string;
  // The Mirrored Calendar a Synced Event came from; null for a Native Event, which has none.
  calendar_id: string | null;
  // A Native Event's is "Nidus".
  calendar_name: string;
  title: string;
  description: string | null;
  location: string | null;
  // ISO instants. For an all-day event, Household-Timezone midnights, the end being the
  // midnight after its last day.
  starts_at: string;
  ends_at: string;
  is_all_day: boolean;
  // The first of profile_ids, which is all a Synced Event has; null for the whole Household.
  profile_id: string | null;
  // Every Profile the occurrence is attributed to, in the Profiles' own order; empty for the whole Household.
  profile_ids: string[];
  // A Native Event's own id, which an Occurrence of a Repeat does not share (its `id` is its own); null for a Synced Event.
  // Edit and delete a Native Event by this, never by `id`.
  event_id: string | null;
  // The event's Repeat (CONTEXT.md: Repeat); all null, bar the interval's 1, when a Native Event does not repeat. A Synced
  // Event has none, its interval null too: it repeats in its source and arrives expanded.
  repeat_every: 'day' | 'week' | 'month' | 'year' | null;
  repeat_interval: number | null;
  // The weekdays of a weekly Repeat as a bitmask, Sunday = bit 0 (the Routines' days_of_week).
  repeat_days: number | null;
  // A Household Date, the last day an Occurrence may land on; null for forever.
  repeat_until: string | null;
};

export const occurrenceColumns =
  'source, id, household_id, calendar_id, calendar_name, title, description, location, starts_at, ends_at, is_all_day, profile_id, profile_ids, event_id, repeat_every, repeat_interval, repeat_days, repeat_until';

// What one request returns at most: the API stops there without saying so.
const PAGE = 1000;

// Reads a query of the view a page at a time until a page comes back short, so the answer is all there however many occurrences it
// holds. `page` asks for rows `first` to `last`, both included, in an order that does not change. An occurrence that moves between
// two pages' requests is kept once.
export async function readPages(page: (first: number, last: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<Occurrence[]> {
  const found = new Map<string, Occurrence>();
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await page(offset, offset + PAGE - 1);
    if (error) throw error;
    const rows = data as Occurrence[];
    for (const occurrence of rows) found.set(`${occurrence.source} ${occurrence.id}`, occurrence);
    if (rows.length < PAGE) return [...found.values()];
  }
}

// Household Account or Device. Everything that overlaps [from, to), in start order, so a month of a busy Household is all there.
export const loadOccurrences = (client: SupabaseClient, from: Date, to: Date): Promise<Occurrence[]> =>
  readPages((first, last) =>
    client
      .from('calendar_occurrences')
      .select(occurrenceColumns)
      .lt('starts_at', to.toISOString())
      // Inclusive so an event of no length at `from` is kept; dayOccurrences is the exact overlap test.
      .gte('ends_at', from.toISOString())
      .order('starts_at')
      .order('source')
      .order('id')
      .range(first, last),
  );

// ---- Household Timezone arithmetic ------------------------------------------------

const HOUR_MS = 60 * 60 * 1000;

// An instant as hours on the day's wall clock (0 to 24): what the hour lines and labels show. On a
// 23 or 25 hour day this is not the share of the day that has passed, so positions never use the
// latter. Measured from the wall clock's own midnight, so a day that skips midnight (Santiago)
// starts at hour 1. On a 25 hour day the repeated hour maps to the same place twice; planDay
// (day-view.ts) keeps such blocks from disappearing or overlapping.
export function wallHour(ms: number, day: WallDay): number {
  const [year, month, date] = day.date.split('-').map(Number) as [number, number, number];
  const hour = (ms + offsetMs(ms, day.timezone) - Date.UTC(year, month - 1, date)) / HOUR_MS;
  return Math.min(Math.max(hour, 0), 24);
}

// Today and the next four days in the Household Timezone.
export function fiveDays(timezone: string, now: Date = new Date()): WallDay[] {
  const today = householdDay(timezone, now).date;
  return wallDays(Array.from({ length: 5 }, (_, index) => addDays(today, index)), today, timezone);
}

// ---- Week, day and month views ---------------------------------------------------------

// The pager's words for a Day or Week page, in two forms. The Wall's title (`wall`) always has the year: "Wed, Sep 30, 2026" for a day,
// "Sep 27 to Oct 3, 2026" for a week. The phone's (`phone`) is short enough for its 22 px line between the two buttons, so it has the year
// ("Wed, Sep 30, 2027") only when the page is not in the Household's current year, `today`'s.
export type PageForm = 'wall' | 'phone';
export function pageWords(days: readonly WallDay[], today: string, form: PageForm): string {
  const first = days[0]!.date;
  const last = days[days.length - 1]!.date;
  const words =
    first === last
      ? dateWords.calendar(first, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
      : `${dateWords.calendar(first, first.slice(0, 4) === last.slice(0, 4) ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })} to ${dateWords.calendar(last, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  // "Wed, Sep 30, 2026" and "Oct 4 to Oct 10, 2026" without the year they end in.
  return form === 'phone' && first.slice(0, 4) === today.slice(0, 4) && last.slice(0, 4) === today.slice(0, 4) ? words.replace(/, \d{4}$/, '') : words;
}

// A month page's title: "October 2026".
export function describeMonth(date: string): string {
  return dateWords.calendar(date, { month: 'long', year: 'numeric' });
}

// ---- Where an event is on a day ----------------------------------------------------

function startOf(occurrence: Occurrence): number {
  return Date.parse(occurrence.starts_at);
}

// Where the current time falls in `day`'s hour grid, as a wall-clock hour; null if `now` is not
// within the day.
export function nowHour(day: WallDay, now: Date): number | null {
  const at = now.getTime();
  return at >= day.startMs && at < day.endMs ? wallHour(at, day) : null;
}

// The occurrences on `day` in the order a month cell, a schedule column and the Day view list them: all-day first,
// then by start, then by title. A multi-day event is on every day it covers, by what the event really lasts
// (spanIsOn): nothing is added to a short event to give it something to tap, so none is carried from a day's last
// minutes onto the next day.
export function dayOccurrences(occurrences: Occurrence[], day: WallDay): Occurrence[] {
  return occurrences
    .filter((occurrence) => spanIsOn(startOf(occurrence), Date.parse(occurrence.ends_at), day))
    .sort((a, b) => Number(b.is_all_day) - Number(a.is_all_day) || startOf(a) - startOf(b) || a.title.localeCompare(b.title));
}
