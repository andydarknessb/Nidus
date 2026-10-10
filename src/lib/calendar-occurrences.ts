import type { SupabaseClient } from '@supabase/supabase-js';
import { dateWords, eventCount } from '../../supabase/functions/_shared/event-words.ts';
import { addDays, householdDay, offsetMs, spanIsOn } from '../../supabase/functions/_shared/zoned-time.ts';
import { pageStart, shownDate, wallDays, type CalendarView, type WallDay } from './paged-view';


// Occurrences on the wall (CONTEXT.md: Synced Event, Native Event). The `calendar_occurrences`
// view unions every source with the Profile it is attributed to; everything below is what the
// wall's calendar does with them: the five days of the home screen, the week, day and month views
// and the routes between them, and which events are on a day and where the Day view's grid puts them
// (day-view.ts); the words that say when are in _shared/event-words.ts. All date logic uses the Household Timezone, never the
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

// The wall's routes: "/" is the home screen, "/week", "/day" and "/month" the secondary views, "/meals"
// the Meals screen, "/routines" the Routines chart and "/lists" the Lists screen. The calendar views and
// Meals are anchored by "?date=YYYY-MM-DD" (today's page, or for Meals this week, when it is missing or
// not a date); the Routines chart and the Lists screen are always today's. Only the calendar views keep a
// date; any other screen (the home screen, Meals, the Routines chart, Lists) is today's page when it is left.
export type WallRoute =
  | { view: 'home' }
  | { view: 'routines' }
  | { view: 'lists' }
  | { view: CalendarView; date: string | null }
  | { view: 'meals'; date: string | null };

export function parseWallRoute(pathname: string, search: string): WallRoute {
  if (pathname === '/routines') return { view: 'routines' };
  if (pathname === '/lists') return { view: 'lists' };
  const view = (['day', 'week', 'month', 'meals'] as const).find((candidate) => pathname === `/${candidate}`);
  if (!view) return { view: 'home' };
  const date = new URLSearchParams(search).get('date');
  const valid = date !== null && /^\d{4}-\d{2}-\d{2}$/.test(date) && addDays(date, 0) === date;
  return { view, date: valid ? date : null };
}

export function wallPath(view: CalendarView, date: string): string {
  return `/${view}?date=${date}`;
}

// Whether `view` shows the calendar's events: Home, Day, Week and Month. The people strip is on these and on no other screen, and so
// is what the Profile filter says (profile-filter.ts): Meals, Routines and Lists have no events for it to hide.
export function onCalendarScreen(view: WallRoute['view']): boolean {
  return view === 'home' || view === 'day' || view === 'week' || view === 'month';
}

// The Meals screen's address: no date for this week, which the screen then follows as the weeks turn
// (a Wall left on it moves on at Saturday midnight), else the Sunday its week is anchored on.
export function mealsPath(date: string | null): string {
  return date === null ? '/meals' : `/meals?date=${date}`;
}

// The date the Meals screen puts in its address to open the week anchored on the Sunday `week`: none
// for the week that holds `today`, so paging back onto it is the following address, the same as
// Today, and any other week names itself.
export function mealsPageDate(week: string, today: string): string | null {
  return week === pageStart('week', today) ? null : week;
}

// Whether `route` is a page of the calendar, which keeps a date. Every other screen is today's page
// when it is left, whatever its address carries (Meals has a date and is still one of these).
function isCalendarRoute(route: WallRoute): route is Extract<WallRoute, { view: CalendarView }> {
  return route.view === 'day' || route.view === 'week' || route.view === 'month';
}

// Whether the page `route` shows holds `today`. A screen that is not a calendar view is today's page,
// so it always does. A calendar page holds it when today falls on the page its address shows, which
// each view decides through its own anchor (pageStart): a day when it is today, a week when today is
// in it, and a month when today is in that month, not when it only shows today as a dimmed day of the
// month beside it.
export function holdsToday(route: WallRoute, today: string): boolean {
  if (!isCalendarRoute(route)) return true;
  return pageStart(route.view, shownDate(route.date, today)) === pageStart(route.view, today);
}

// The Household date the wall is on: today when the page shown holds it, otherwise the page's first
// day, or the window's first day when the page starts before it (the Sunday of the first week, the 1st of
// the first month): the grids mark those days as beyond the range, and an event added there is one the
// wall could not show. Add event starts on it, and the navigation rail opens its views from it.
export function wallDate(route: WallRoute, today: string): string {
  if (!isCalendarRoute(route) || holdsToday(route, today)) return today;
  return shownDate(pageStart(route.view, shownDate(route.date, today)), today);
}

// The date the navigation rail opens `view` on, so each of its views keeps the date the wall is on:
// the page holding today when the page being left holds it (a screen that is not a calendar view
// always does), otherwise the page holding the left page's date. It returns the page's own anchor as
// it is shown (the Sunday for Week, the 1st for Month, a day inside the window for Day), so a page
// already open is the same address and a tap adds no step for Back. Everything goes through
// pageStart, so a month is one more anchor there and one more calendar view above, and other screens
// are already covered.
export function navigationRailDate(view: CalendarView, route: WallRoute, today: string): string {
  return pageStart(view, shownDate(wallDate(route, today), today));
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

// ---- Month cells --------------------------------------------------------------------

// The occurrences on `day` in the order a month cell, a schedule column and the Day view list them: all-day first,
// then by start, then by title. A multi-day event is on every day it covers, by what the event really lasts
// (spanIsOn): nothing is added to a short event to give it something to tap, so none is carried from a day's last
// minutes onto the next day.
export function dayOccurrences(occurrences: Occurrence[], day: WallDay): Occurrence[] {
  return occurrences
    .filter((occurrence) => spanIsOn(startOf(occurrence), Date.parse(occurrence.ends_at), day))
    .sort((a, b) => Number(b.is_all_day) - Number(a.is_all_day) || startOf(a) - startOf(b) || a.title.localeCompare(b.title));
}

// What a cell shows: the occurrences that get a line of their own, and the words for the rest.
export type CellLines = { shown: Occurrence[]; more: string | null };

// What a cell shows when `lines` lines fit: every occurrence if they all do; otherwise all but the last
// line's worth, and "+N more" on that line with N counting the ones left out; and when only one line
// fits, just the count.
export function cellLines(occurrences: Occurrence[], lines: number): CellLines {
  if (occurrences.length <= lines) return { shown: occurrences, more: null };
  if (lines <= 1) return { shown: [], more: eventCount(occurrences.length) };
  const shown = occurrences.slice(0, lines - 1);
  return { shown, more: `+${occurrences.length - shown.length} more` };
}

// How many lines of `linePx` fit in a day cell `rowPx` tall once `headPx` is taken for its padding and its
// date: at least one, so a cell can always say how many events it holds.
export function linesPerCell(rowPx: number, headPx: number, linePx: number): number {
  return Math.max(1, Math.floor((rowPx - headPx) / linePx));
}

// Whether a day cell `rowPx` tall is too short for its date and one line of words under it (`headPx` and `linePx`, as for linesPerCell),
// at larger text (`rem`, the root font size, above 16 px: a cell at 16 px is drawn as it always was). Such a cell shows its date and, beside
// it, how many events the day holds as a number, and no lines: the line under the date would be cut off.
export function isTightCell(rowPx: number, headPx: number, linePx: number, rem: number): boolean {
  return rem > 16 && rowPx < headPx + linePx;
}

// The weekday names' row of the month grid, in rem (py-2 and a line of text-sm, and the border under it).
const WEEKDAYS_ROW_REM = 2.5;

// The least height of the month grid in rem: the weekday row and, for each of `weeks`, its date (`headRem`, CELL_HEAD_REM). The line under the
// date is not in it: a week the room leaves no line for is drawn without one (isTightCell), so a six-week month at 130 percent text fits the
// 1280 x 800 Wall, where date and line would need 567 px of the 492 it has.
export function monthMinRem(weeks: number, headRem: number): number {
  return WEEKDAYS_ROW_REM + weeks * headRem;
}
