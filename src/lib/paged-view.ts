import { addDays, dayStartMs, householdDay } from '../../supabase/functions/_shared/zoned-time.ts';

// A page of days and where focus goes when it turns (CONTEXT.md: Household Timezone). One module serves the Wall's calendar, the phone's
// calendar and the Meals week on both: given the view, the date the person asked for and the instant, it answers today, the days of the
// page, the pages either side (null beyond the limit) and the words that say where the limit is; and it decides whether focus goes to the
// page's title after a page turns or Household midnight passes. It is plain TypeScript, with no screen and no database, so it is tested
// with a fixed `now`; use-paged-view.ts is the thin hook that performs the focus. The date arithmetic is the Household clock's
// (supabase/functions/_shared/zoned-time.ts); what is here is the arithmetic of pages.

// ---- Days -------------------------------------------------------------------------

export type WallDay = {
  date: string;
  weekday: number;
  startMs: number;
  // The start of the next day, so the day's length is right on a DST change.
  endMs: number;
  isToday: boolean;
  timezone: string;
};

export function wallDays(dates: string[], today: string, timezone: string): WallDay[] {
  return dates.map((date) => ({
    date,
    weekday: householdDay(timezone, new Date(dayStartMs(date, timezone))).weekday,
    startMs: dayStartMs(date, timezone),
    endMs: dayStartMs(addDays(date, 1), timezone),
    isToday: date === today,
    timezone,
  }));
}

// ---- Pages ------------------------------------------------------------------------

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

// What a screen needs to draw a page.
export type PagedView<V extends CalendarView = CalendarView> = {
  today: string;
  window: PagingWindow;
  // The date the page is anchored on, as it is shown: the date asked for, pulled into the window and snapped to the page's start.
  anchor: string;
  // A week's seven days or a day's one; null for a month, which is a grid of weeks of its own (monthWeeks). A screen that is only ever on
  // a week (Meals) is told it has days.
  days: V extends 'month' ? null : WallDay[];
  // The anchors of the pages either side, or null beyond the limit.
  previous: string | null;
  next: string | null;
};

// The page for `date` (null for today's) in `view`, at the instant `now`. A screen that wants its page laid out from the start of today
// passes that instant (the Meals screens do, so they redraw only when the date turns), and gets the same page.
export function pagedView<V extends CalendarView>(view: V, date: string | null, now: Date, timezone: string): PagedView<V> {
  const today = householdDay(timezone, now).date;
  const window = pagingWindowAround(today);
  const anchor = pageStart(view, shownDate(date, today));
  return {
    today,
    window,
    anchor,
    days: view === 'month' ? null : pageDays(view, anchor, timezone, now),
    ...paging(view, anchor, window),
  } as PagedView<V>;
}

// The words at the ends of the window, one sentence for each end, as a screen words them.
export type LimitWords = { back: string; ahead: string };

// The calendar keeps one month of past events and six of upcoming ones, and says so.
export const CALENDAR_LIMITS: LimitWords = {
  back: 'This is as far back as the calendar goes. It keeps one month of past events.',
  ahead: 'This is as far ahead as the calendar goes. It keeps six months of upcoming events.',
};

// Meals page within the calendar's window but are not what the mirror keeps, so these say only where the plan ends.
export const MEAL_PLAN_LIMITS: LimitWords = {
  back: 'This is as far back as the meal plan goes.',
  ahead: 'This is as far ahead as the meal plan goes.',
};

// The sentence for a page at an end of the window, or '' between the ends.
export function limitWords(page: Pick<PagedView, 'previous' | 'next'>, words: LimitWords): string {
  return page.previous === null ? words.back : page.next === null ? words.ahead : '';
}

// ---- Where focus goes -------------------------------------------------------------

// What the person has open: the view and the date they asked for (null for today), and where the page is anchored, which also moves
// by itself while the page follows today (at Household midnight, at the start of a week or a month).
export type PageOpen = { view: string; date: string | null; anchor: string };

export type FocusAt = 'title' | 'nowhere';

export type PageFocus = {
  // Where focus goes now that `open` is on the screen. `focusLost` says whether focus was lost with the page (see focusIsLost in
  // focus.ts). Called each time the view, the date or the anchor changes, and once when the screen opens.
  after(open: PageOpen, focusLost: boolean): FocusAt;
};

// Paging may disable or remove the button that was pressed, and a page's contents are keyed on its anchor, so when the page turns or
// moves by itself whatever had focus in them is gone. Focus then goes to the title; but focus that is anywhere else (a keyboard on the
// button that was pressed, a Profile's chip) is left alone, and so it is at midnight, when the page moves under a person who is not
// on it. Only a person's choice of another view can take focus that was not lost, and only on a screen that says so:
// `takesFocusOnArrival` is the Wall's, where arriving (from the navigation rail, or a day opened from the week or the month) puts focus on
// the title, as on the other screens. The phone does not take it, since that would scroll the page, and its control for another view
// keeps focus. The anchor moving by itself is never an arrival: it is told from the person's choice by the view staying the same.
export function createPageFocus({ takesFocusOnArrival }: { takesFocusOnArrival: boolean }): PageFocus {
  // The view last seen, or null before the screen has drawn once. Kept so that an effect that runs twice (StrictMode) is not an arrival.
  let seenView: string | null = null;
  return {
    after(open, focusLost) {
      const arrived = takesFocusOnArrival && open.view !== seenView;
      seenView = open.view;
      return arrived || focusLost ? 'title' : 'nowhere';
    },
  };
}
