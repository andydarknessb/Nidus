import { dateWords, eventCount } from '../../supabase/functions/_shared/event-words.ts';
import type { Occurrence } from './calendar-occurrences';
import type { DayEvents } from './day-events';
import { canOpenDay, type PagingWindow, type WallDay } from './paged-view';
import type { MonthDot } from './phone-calendar';

// The Month Cells (spec 0012): what every day cell of a month says, for the Wall's grid and the phone's alike, decided once and drawn by
// components/MonthCell.tsx. Pure, so it is tested without a screen (tests/month-grid.test.ts).

// The words a day beyond the range the calendar keeps is told by, to a screen reader; the eye has the hatch (components/MonthCell.tsx).
export const BEYOND_RANGE = "Beyond the calendar's range";

// What a month cell is called, on the Wall and on the phone alike: the date's number first, so a name spoken from the screen ("22")
// finds it, then the day in full and how many events it holds, then ", today" on today's (which the disc says to the eye), at the end
// as the week's chips and the schedule's day headings have it. `occurrenceCount` is null until the day's week has been read: there is
// no count to give then, and "no events" would call a day free that may not be.
export function cellName(date: string, isToday: boolean, occurrenceCount: number | null): string {
  return `${Number(date.slice(8))}, ${dateWords.cell(date, occurrenceCount)}${isToday ? ', today' : ''}`;
}

// One day of the month. `day` is the Household day itself (an event line tells its time by it); `inMonth` is false for a day of the
// neighbouring month, drawn dimmed; `beyond` is a day past the range, which has nothing to open and nothing known about it, so it has no
// count, no lines and no dots, and its name says so. `count` is how many events the day holds, null until its week has been read (and
// for a day beyond the range). The Wall's cell (form `lines`) has the day's occurrences, in order and after the Profile Filter, which the
// room turns into lines (cellLines); the phone's (form `dots`) has its dots, who has something that day (monthDots: the pressed
// people only, CONTEXT.md, Profile Filter).
type CellForms = { lines: { lines: Occurrence[] | null }; dots: { dots: MonthDot[] } };
export type CellForm = keyof CellForms;
export type MonthCell<Form extends CellForm = CellForm> = {
  day: WallDay;
  name: string;
  inMonth: boolean;
  beyond: boolean;
  count: number | null;
} & CellForms[Form];

// The weeks of `weeks` (monthWeeks) as cells, from the day events read for them (`events`: the Profile Filter is already in them). A day
// outside `window` is `beyond`, wherever its week falls, so a week wholly beyond holds nothing to read.
export function monthCells<Form extends CellForm>(weeks: readonly (readonly WallDay[])[], anchor: string, window: PagingWindow, events: DayEvents, form: Form): MonthCell<Form>[][];
export function monthCells(weeks: readonly (readonly WallDay[])[], anchor: string, window: PagingWindow, events: DayEvents, form: CellForm): MonthCell[][] {
  return weeks.map((days) =>
    days.map((day) => {
      const beyond = !canOpenDay(day.date, window);
      const occurrences = beyond ? null : events.on(day);
      const count = occurrences === null ? null : occurrences.length;
      const cell = {
        day,
        name: beyond ? `${dateWords.cell(day.date, null)}, ${BEYOND_RANGE}` : cellName(day.date, day.isToday, count),
        inMonth: day.date.slice(0, 7) === anchor.slice(0, 7),
        beyond,
        count,
      };
      return form === 'lines' ? { ...cell, lines: occurrences } : { ...cell, dots: beyond ? [] : events.dots(day) };
    }),
  );
}

// How a month's day cells are fitted to the room the grid has (CONTEXT.md: Wall; docs/look.md "Month"): how many event lines a cell
// can hold, what it says of the ones it has no line for, and the least height a month asks of the screen. Pure, so it is tested
// without a screen; the cell that draws it is components/MonthCell.tsx.

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
