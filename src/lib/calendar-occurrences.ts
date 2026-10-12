import type { SupabaseClient } from '@supabase/supabase-js';
import { dateWords } from '../../supabase/functions/_shared/event-words.ts';
import { addDays, householdDay, offsetMs, spanIsOn } from '../../supabase/functions/_shared/zoned-time.ts';
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
};

export const occurrenceColumns =
  'source, id, calendar_id, calendar_name, title, description, location, starts_at, ends_at, is_all_day, profile_id, profile_ids';

// What one request returns at most: the API stops there without saying so.
const PAGE = 1000;

// Household Account or Device. Everything that overlaps [from, to), in start order, read a page at a time until a page comes back
// short, so a month of a busy Household is all there however many occurrences it holds. An occurrence that moves between two pages'
// requests is kept once.
export async function loadOccurrences(client: SupabaseClient, from: Date, to: Date): Promise<Occurrence[]> {
  const found = new Map<string, Occurrence>();
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await client
      .from('calendar_occurrences')
      .select(occurrenceColumns)
      .lt('starts_at', to.toISOString())
      // Inclusive so an event of no length at `from` is kept; dayOccurrences is the exact overlap test.
      .gte('ends_at', from.toISOString())
      .order('starts_at')
      .order('source')
      .order('id')
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    const page = data as Occurrence[];
    for (const occurrence of page) found.set(`${occurrence.source} ${occurrence.id}`, occurrence);
    if (page.length < PAGE) return [...found.values()];
  }
}

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

// A page's title: "Wed, Sep 30, 2026" for a day, "Sep 27 to Oct 3, 2026" for a week.
export function describePage(days: WallDay[]): string {
  const first = days[0]!.date;
  const last = days[days.length - 1]!.date;
  if (first === last) return dateWords.calendar(first, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const sameYear = first.slice(0, 4) === last.slice(0, 4);
  return `${dateWords.calendar(first, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })} to ${dateWords.calendar(last, { month: 'short', day: 'numeric', year: 'numeric' })}`;
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
