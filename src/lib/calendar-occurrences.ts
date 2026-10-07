import type { SupabaseClient } from '@supabase/supabase-js';
import { addDays, dayStartMs, householdDay, offsetMs, spanIsOn } from '../../supabase/functions/_shared/zoned-time.ts';


// Occurrences on the wall (CONTEXT.md: Synced Event, Native Event). The `calendar_occurrences`
// view unions every source with the Profile it is attributed to; everything below is what the
// wall's calendar does with them: the five days of the home screen, the week, day and month views
// and the routes between them, which events are on a day and where the Day view's grid puts them
// (day-view.ts), and the words that say when. All date logic uses the Household Timezone, never the
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

export type WallDay = {
  date: string;
  weekday: number;
  startMs: number;
  // The start of the next day, so the day's length is right on a DST change.
  endMs: number;
  isToday: boolean;
  timezone: string;
};

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

function wallDays(dates: string[], today: string, timezone: string): WallDay[] {
  return dates.map((date) => ({
    date,
    weekday: householdDay(timezone, new Date(dayStartMs(date, timezone))).weekday,
    startMs: dayStartMs(date, timezone),
    endMs: dayStartMs(addDays(date, 1), timezone),
    isToday: date === today,
    timezone,
  }));
}

// Today and the next four days in the Household Timezone.
export function fiveDays(timezone: string, now: Date = new Date()): WallDay[] {
  const today = householdDay(timezone, now).date;
  return wallDays(Array.from({ length: 5 }, (_, index) => addDays(today, index)), today, timezone);
}

// ---- Week, day and month views ---------------------------------------------------------

export type CalendarView = 'week' | 'day' | 'month';

// The week runs Sunday to Saturday, as WEEKDAYS does.
export function weekStart(date: string): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return addDays(date, -new Date(Date.UTC(year, month - 1, day)).getUTCDay());
}

// `date` moved by whole calendar months, stopping at the end of a shorter month (Mar 31 less a
// month is Feb 28), the way the sync window is cut.
export function addMonths(date: string, months: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const lastDay = new Date(Date.UTC(year, month - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month - 1 + months, Math.min(day, lastDay))).toISOString().slice(0, 10);
}

// The first and last Household dates the wall can page to: the mirror holds a month back and six
// months ahead of today (PLAN.md: Calendar), so nothing beyond them has events to show.
export type PagingWindow = { first: string; last: string };

export function pagingWindow(timezone: string, now: Date = new Date()): PagingWindow {
  return pagingWindowAround(householdDay(timezone, now).date);
}

// The same window around a Household date that is already known.
export function pagingWindowAround(today: string): PagingWindow {
  return { first: addMonths(today, -1), last: addMonths(today, 6) };
}

export function clampToWindow(date: string, window: PagingWindow): string {
  return date < window.first ? window.first : date > window.last ? window.last : date;
}

// The date a page's address puts it on, as the page shows it: the address's date (today when it has
// none) pulled to the nearest end of the window. The page drawn and every rule about it read it here,
// so they agree on an address outside the window (old history, a Wall left on a week for a month).
export function shownDate(date: string | null, today: string): string {
  return clampToWindow(date ?? today, pagingWindowAround(today));
}

// Whether a day can be opened as itself. A day outside the window opens its nearest end instead, so
// the week view's days beyond the window are headings and the month view's are plain cells, not buttons.
export function canOpenDay(date: string, window: PagingWindow): boolean {
  return clampToWindow(date, window) === date;
}

// The date a page is anchored on: the Sunday of a week page, the 1st of a month page, the day itself
// on a day page.
export function pageStart(view: CalendarView, date: string): string {
  return view === 'week' ? weekStart(date) : view === 'month' ? `${date.slice(0, 8)}01` : date;
}

// The seven days of a week page, or the one day of a day page, in the Household Timezone. A month page
// is a grid of weeks: see monthWeeks.
export function pageDays(view: 'week' | 'day', anchor: string, timezone: string, now: Date = new Date()): WallDay[] {
  const first = pageStart(view, anchor);
  const today = householdDay(timezone, now).date;
  return wallDays(Array.from({ length: view === 'week' ? 7 : 1 }, (_, index) => addDays(first, index)), today, timezone);
}

// The weeks of a month page: whole Sunday-to-Saturday weeks from the one holding the 1st to the one
// holding the last day, four to six of them, each seven days in the Household Timezone. The days either
// side of the month belong to its neighbours and are only shown. It takes today's date, not the instant,
// because building 42 days is slow enough that the screen builds them once a day, not on every tick.
export function monthWeeks(anchor: string, timezone: string, today: string): WallDay[][] {
  const first = pageStart('month', anchor);
  const last = addDays(addMonths(first, 1), -1);
  const weeks: WallDay[][] = [];
  for (let start = weekStart(first); start <= last; start = addDays(start, 7)) {
    weeks.push(wallDays(Array.from({ length: 7 }, (_, index) => addDays(start, index)), today, timezone));
  }
  return weeks;
}

// The anchor of the page `count` pages on from the page anchored on `anchor`.
function pageBy(view: CalendarView, anchor: string, count: number): string {
  return view === 'month' ? addMonths(anchor, count) : addDays(anchor, count * (view === 'week' ? 7 : 1));
}

// The anchors of the pages either side of `anchor`, or null at the end of the window: a page is
// reachable while any of its days falls inside it, so a week or a month that only partly overlaps is kept.
export function paging(view: CalendarView, anchor: string, window: PagingWindow): { previous: string | null; next: string | null } {
  const current = pageStart(view, anchor);
  const previous = pageBy(view, current, -1);
  const next = pageBy(view, current, 1);
  return {
    // The page before ends on the day before this one starts.
    previous: addDays(current, -1) >= window.first ? previous : null,
    next: next <= window.last ? next : null,
  };
}

// A calendar date ('YYYY-MM-DD') in words. Calendar dates carry no zone, so they are formatted in UTC.
function formatCalendarDate(date: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options }).format(new Date(`${date}T00:00:00Z`));
}

// A page's title: "Wed, Sep 30, 2026" for a day, "Sep 27 to Oct 3, 2026" for a week.
export function describePage(days: WallDay[]): string {
  const first = days[0]!.date;
  const last = days[days.length - 1]!.date;
  if (first === last) return formatCalendarDate(first, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const sameYear = first.slice(0, 4) === last.slice(0, 4);
  return `${formatCalendarDate(first, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })} to ${formatCalendarDate(last, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

// A month page's title: "October 2026".
export function describeMonth(date: string): string {
  return formatCalendarDate(date, { month: 'long', year: 'numeric' });
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

// ---- Words --------------------------------------------------------------------------

// "no events", "1 event", "3 events".
function eventCount(count: number): string {
  return count === 0 ? 'no events' : count === 1 ? '1 event' : `${count} events`;
}

// What a screen reader hears of a month cell: "Thursday, October 1, 3 events". Until its day has been read
// there is no count to give, and "no events" would call a day free that may not be.
export function describeCell(date: string, count: number | null): string {
  const day = formatCalendarDate(date, { weekday: 'long', month: 'long', day: 'numeric' });
  return count === null ? day : `${day}, ${eventCount(count)}`;
}

export function formatClock(ms: number, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' }).format(new Date(ms));
}

// "1:00 AM CDT": a time with the zone's short name, for the night the clocks go back, when one clock time is two instants.
export function formatClockWithZone(ms: number, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(ms));
}

// Whether an event that starts and ends on one day (one that ends at midnight ends on the next) reads backwards, or as no time at all, on the clock: it lasts, but its end shows
// the same time as its start or an earlier one, because the clocks went back inside it ("1:00 to 1:00 AM"). Such an event says its
// times with their zones (formatClockWithZone), so the two are told apart.
export function clocksRepeat(start: number, end: number, timezone: string): boolean {
  const minutes = (ms: number) => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hourCycle: 'h23', hour: 'numeric', minute: 'numeric' }).formatToParts(new Date(ms));
    const part = (type: string) => Number(parts.find((each) => each.type === type)?.value);
    return part('hour') * 60 + part('minute');
  };
  const sameDay = householdDay(timezone, new Date(start)).date === householdDay(timezone, new Date(end)).date;
  return end > start && sameDay && minutes(end) <= minutes(start);
}

// "10 AM" on the hour and "9:30 AM" otherwise: the time without its ":00", for a month line, which has
// room for little else than a few letters of the title after it.
export function formatCompactClock(ms: number, timezone: string): string {
  return formatClock(ms, timezone).replace(':00', '');
}

// "Thu, Oct 1": the date as the details sheet and the header show it.
export function formatDate(ms: number, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(ms));
}

// "Oct 1, 2026": a date that may be a year or more ago, as "Since" says it in Settings.
export const formatDateWithYear = (ms: number, timezone: string): string => new Intl.DateTimeFormat('en-US', { timeZone: timezone, month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(ms));

// "Tue, Sep 30, 9:00 AM to 10:00 AM", or "Tue, Sep 30, all day": the time as the details sheet shows it.
export function describeWhen(occurrence: Occurrence, timezone: string): string {
  const start = startOf(occurrence);
  const end = Date.parse(occurrence.ends_at);
  if (occurrence.is_all_day) {
    const lastDay = Math.max(start, end - 1);
    const sameDay = householdDay(timezone, new Date(start)).date === householdDay(timezone, new Date(lastDay)).date;
    return sameDay ? `${formatDate(start, timezone)}, all day` : `${formatDate(start, timezone)} to ${formatDate(lastDay, timezone)}, all day`;
  }
  const sameDay = householdDay(timezone, new Date(start)).date === householdDay(timezone, new Date(end)).date;
  if (sameDay) {
    if (end === start) return `${formatDate(start, timezone)}, ${formatClock(start, timezone)}`;
    const clock = clocksRepeat(start, end, timezone) ? formatClockWithZone : formatClock;
    return `${formatDate(start, timezone)}, ${clock(start, timezone)} to ${clock(end, timezone)}`;
  }
  return `${formatDate(start, timezone)}, ${formatClock(start, timezone)} to ${formatDate(end, timezone)}, ${formatClock(end, timezone)}`;
}
