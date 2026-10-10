import { eventCount } from '../../supabase/functions/_shared/event-words.ts';
import type { Occurrence } from './calendar-occurrences';

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
