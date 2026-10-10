import { useEffect, useState } from 'react';
import { addDays } from '../../supabase/functions/_shared/zoned-time.ts';
import { pageStart, shownDate, type CalendarView } from './paged-view';

// The Wall's routes and the dates they put a screen on: reading and writing the address, whether a page holds today, and the date the
// navigation rail opens each view on. The page arithmetic they build on is in paged-view.ts; useWallRoute, at the end, is the thin
// hook that follows the address. All date logic uses the Household Timezone, never the machine's zone, and is pure so it is
// tested without a screen.

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

// Which screen the address names. The wall pages with pushState rather than reloading, so a tap
// never drops the session or the Routines read, and Back returns to the previous page.
export function useWallRoute(): [WallRoute, (view: CalendarView, date: string) => void, () => void, (date: string | null) => void, () => void, () => void] {
  const read = () => parseWallRoute(window.location.pathname, window.location.search);
  const [route, setRoute] = useState<WallRoute>(read);
  useEffect(() => {
    const onPop = () => setRoute(read());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const go = (path: string) => {
    // Today while already on today's page changes nothing: no extra step for Back.
    if (path !== window.location.pathname + window.location.search) window.history.pushState(null, '', path);
    setRoute(read());
  };
  return [route, (view, date) => go(wallPath(view, date)), () => go('/'), (date) => go(mealsPath(date)), () => go('/routines'), () => go('/lists')];
}
