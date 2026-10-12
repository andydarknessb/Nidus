import { describe, expect, it } from 'vitest';
import type { Occurrence } from '../src/lib/calendar-occurrences';
import { cellLines, isTightCell, linesPerCell, monthMinRem } from '../src/lib/month-grid';

let counter = 0;
function event(title: string, startsAt: string, endsAt: string, allDay = false): Occurrence {
  counter += 1;
  return {
    source: 'synced',
    id: `event-${counter}`,
    calendar_id: 'calendar-1',
    calendar_name: 'Family',
    title,
    description: null,
    location: null,
    starts_at: startsAt,
    ends_at: endsAt,
    is_all_day: allDay,
    profile_id: null,
    profile_ids: [],
  };
}

describe('what a cell shows', () => {
  const some = (count: number) => ['A', 'B', 'C', 'D', 'E', 'F'].slice(0, count).map((title) => event(title, '2026-10-01T14:00:00Z', '2026-10-01T15:00:00Z'));
  const shown = (occurrences: Occurrence[], lines: number) => cellLines(occurrences, lines).shown.map((occurrence) => occurrence.title);

  it('shows every occurrence when they fit', () => {
    const three = some(3);
    expect(cellLines(three, 3)).toEqual({ shown: three, more: null });
    expect(shown(three, 4)).toEqual(['A', 'B', 'C']);
    expect(shown(some(1), 1)).toEqual(['A']);
    expect(cellLines(some(1), 1).more).toBeNull();
    expect(cellLines([], 3)).toEqual({ shown: [], more: null });
  });

  it('shows all but one line\'s worth and "+N more" when they do not', () => {
    const three = cellLines(some(5), 3);
    expect(three.shown.map((occurrence) => occurrence.title)).toEqual(['A', 'B']);
    expect(three.more).toBe('+3 more');
    const four = cellLines(some(6), 4);
    expect(four.shown.map((occurrence) => occurrence.title)).toEqual(['A', 'B', 'C']);
    expect(four.more).toBe('+3 more');
  });

  it('counts the ones not shown, so the lines shown and N add up to the day', () => {
    for (const total of [3, 4, 5, 6]) {
      for (const lines of [2, 3]) {
        if (total <= lines) continue;
        const { shown: lineEvents, more } = cellLines(some(total), lines);
        expect(lineEvents).toHaveLength(lines - 1);
        expect(more).toBe(`+${total - (lines - 1)} more`);
      }
    }
  });

  it('with two lines shows the first occurrence and "+N more"', () => {
    expect(shown(some(3), 2)).toEqual(['A']);
    expect(cellLines(some(3), 2).more).toBe('+2 more');
    expect(shown(some(2), 2)).toEqual(['A', 'B']);
    expect(cellLines(some(2), 2).more).toBeNull();
  });

  it('with only one line says just how many there are', () => {
    expect(cellLines(some(2), 1)).toEqual({ shown: [], more: '2 events' });
    expect(cellLines(some(5), 1)).toEqual({ shown: [], more: '5 events' });
  });
});

describe('how many lines fit', () => {
  // 32 px above the first line (padding and the date), 24 px a line.
  const fit = (rowPx: number) => linesPerCell(rowPx, 32, 24);

  it('is the lines that fit under the date', () => {
    expect(fit(32 + 24 * 2)).toBe(2);
    expect(fit(32 + 24 * 3)).toBe(3);
    expect(fit(32 + 24 * 4)).toBe(4);
  });

  it('rounds down to a whole line', () => {
    expect(fit(32 + 24 * 3 - 1)).toBe(2);
    expect(fit(97.67)).toBe(2);
    expect(fit(116.9)).toBe(3);
  });

  it('fits fewer lines when the text is larger, a cell drawn in rem growing with the root font size', () => {
    // The month draws a cell as 2.25 rem above its lines and 1.5 rem for each, so both grow with the root size.
    const at = (rootPx: number) => linesPerCell(118, 2.25 * rootPx, 1.5 * rootPx);
    expect(at(16)).toBe(3);
    expect(at(20)).toBe(2);
    expect(at(24)).toBe(1);
    expect(at(32)).toBe(1);
  });

  it('is at least one, so a cell can always say how many events it holds', () => {
    expect(fit(32 + 24)).toBe(1);
    expect(fit(32 + 24 - 1)).toBe(1);
    expect(fit(32)).toBe(1);
    expect(fit(0)).toBe(1);
  });
});

// A six-week month at larger text (issue #69). On the 1280 x 800 Wall at 130 percent text (a root of 20.8 px) the grid has about 492 px under the
// people strip and paging row, 52 of them the weekday row. A date needs 2.625 rem and the line under it 1.5 rem, so six weeks of both need 567 px,
// 75 more than the room: a week the room leaves no line for is drawn as its date and a count beside it, and the month fits and does not scroll.
describe('a month at larger text', () => {
  const REM = 20.8;
  const HEAD = 2.625;
  const LINE = 1.5;
  const ROOM = 492;
  const WEEKDAYS = 2.5 * REM;
  const row = (weeks: number) => (ROOM - WEEKDAYS) / weeks;

  it('asks for the weekday row and a date for each week, and no line', () => {
    expect(monthMinRem(6, HEAD)).toBeCloseTo(2.5 + 6 * 2.625, 9);
    expect(monthMinRem(5, HEAD)).toBeCloseTo(2.5 + 5 * 2.625, 9);
    expect(monthMinRem(4, HEAD)).toBeCloseTo(2.5 + 4 * 2.625, 9);
  });

  it('fits six weeks in the room at a 20.8 px root, though a date and a line for each would not', () => {
    expect(monthMinRem(6, HEAD) * REM).toBeLessThan(ROOM);
    expect((2.5 + 6 * (HEAD + LINE)) * REM).toBeGreaterThan(ROOM);
    expect(isTightCell(row(6), HEAD * REM, LINE * REM, REM)).toBe(true);
    // The date fits its row, which is what tight cells are drawn with.
    expect(row(6)).toBeGreaterThan(HEAD * REM);
  });

  it('leaves five weeks as they are: a date and a line, not tight', () => {
    expect(isTightCell(row(5), HEAD * REM, LINE * REM, REM)).toBe(false);
    expect(linesPerCell(row(5), HEAD * REM, LINE * REM)).toBe(1);
    expect(isTightCell(row(4), HEAD * REM, LINE * REM, REM)).toBe(false);
  });

  it('is never tight at 16 px text, however short the row is, so a screen at 16 px is as it was', () => {
    expect(isTightCell(40, HEAD * 16, LINE * 16, 16)).toBe(false);
    expect(isTightCell(59, HEAD * 16, LINE * 16, 16)).toBe(false);
  });

  it('is tight at 200 percent text when the row has no room for a line under the date', () => {
    expect(isTightCell(110, HEAD * 32, LINE * 32, 32)).toBe(true);
    expect(isTightCell(140, HEAD * 32, LINE * 32, 32)).toBe(false);
  });
});
