import { describe, expect, it } from 'vitest';
import type { Occurrence } from '../src/lib/calendar-occurrences';
import { dayEventsOf } from '../src/lib/day-events';
import { cellLines, cellName, isTightCell, linesPerCell, monthCells, monthMinRem, type CellForm, type MonthCell } from '../src/lib/month-grid';
import { monthWeeks, pagingWindowAround, type PagingWindow } from '../src/lib/paged-view';
import type { Profile } from '../src/lib/profiles';

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
    event_id: null, repeat_every: null, repeat_interval: 1, repeat_days: null, repeat_until: null,
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

describe("a cell's name", () => {
  it("is the date, the day in full and its count, with \", today\" last on today's", () => {
    expect(cellName('2026-10-01', true, 5)).toBe('1, Thursday, October 1, 5 events, today');
    expect(cellName('2026-10-03', false, 1)).toBe('3, Saturday, October 3, 1 event');
    expect(cellName('2026-10-03', false, 0)).toBe('3, Saturday, October 3, no events');
  });

  it("gives the date alone, and no count, until the day's week has been read", () => {
    expect(cellName('2026-10-02', false, null)).toBe('2, Friday, October 2');
    expect(cellName('2026-10-01', true, null)).toBe('1, Thursday, October 1, today');
  });
});

// ---- The Month Cells (spec 0012): what every cell of a month says, for the Wall (lines) and the phone (dots) -----------------------------------

describe('the month cells', () => {
  const CHICAGO = 'America/Chicago';
  const TODAY = '2026-10-01';
  const ANCHOR = '2026-10-01';
  const WEEKS = monthWeeks(ANCHOR, CHICAGO, TODAY);
  const WINDOW = pagingWindowAround(TODAY);
  // A calendar that begins on Oct 11, so the whole week of Oct 4 to Oct 10 is beyond its range, and Oct 11 is the first day it keeps.
  const LATER: PagingWindow = { first: '2026-10-11', last: '2027-04-01' };
  // A calendar that begins on Oct 5, so Oct 2 and Oct 3 are beyond its range in a week that is partly kept.
  const MIDWEEK: PagingWindow = { first: '2026-10-05', last: '2027-04-01' };

  const person = (id: string, name: string, sort: number): Profile => ({ id, name, color: '#93c5fd', avatar_url: null, sort_order: sort });
  const AVA = person('a', 'Ava', 0);
  const BEN = person('b', 'Ben', 1);
  const CORY = person('c', 'Cory', 2);
  const DEE = person('d', 'Dee', 3);
  const FAMILY = [AVA, BEN, CORY];

  // 9:00 to 10:00 AM on `date`, Chicago, for the Profiles `ids` (none: the whole Household's).
  function on(date: string, ids: string[] = [], title = 'Piano'): Occurrence {
    return { ...event(title, `${date}T14:00:00Z`, `${date}T15:00:00Z`), profile_id: ids[0] ?? null, profile_ids: ids };
  }

  type Given = { occurrences?: Occurrence[] | null; profiles?: Profile[]; pressed?: string[]; window?: PagingWindow; today?: string };
  function cells<Form extends CellForm>(form: Form, { occurrences = [], profiles = FAMILY, pressed = [], window = WINDOW, today = TODAY }: Given = {}): MonthCell<Form>[][] {
    return monthCells(monthWeeks(ANCHOR, CHICAGO, today), ANCHOR, window, dayEventsOf(occurrences, profiles, pressed), form);
  }
  function cell<Form extends CellForm>(form: Form, date: string, given: Given = {}): MonthCell<Form> {
    return cells(form, given).flat().find((each) => each.day.date === date)!;
  }
  const dotWords = (given: Given, date = '2026-10-02') => cell('dots', date, given).dots.map((dot) => (dot.kind === 'household' ? 'house' : dot.profile.name));

  it('is the month in weeks of seven, the days monthWeeks gives, in order, with each day as it is', () => {
    const grid = cells('lines');
    expect(grid).toHaveLength(WEEKS.length);
    expect(grid.map((week) => week.map((each) => each.day))).toEqual(WEEKS);
    expect(grid.every((week) => week.length === 7)).toBe(true);
  });

  it('knows the days of the neighbouring months, to be dimmed, and the days of this one', () => {
    expect(cell('lines', '2026-09-28').inMonth).toBe(false);
    expect(cell('lines', '2026-09-27').inMonth).toBe(false);
    expect(cell('lines', '2026-10-02').inMonth).toBe(true);
    expect(cell('dots', '2026-09-28').inMonth).toBe(false);
  });

  it('knows today, and a day it is not', () => {
    expect(cell('lines', '2026-10-01').day.isToday).toBe(true);
    expect(cell('dots', '2026-10-02').day.isToday).toBe(false);
  });

  describe("a cell's name", () => {
    it('is the date, then the day in full and how many events it holds', () => {
      expect(cell('lines', '2026-10-22').name).toBe('22, Thursday, October 22, no events');
      expect(cell('lines', '2026-10-03', { occurrences: [on('2026-10-03', [], 'A')] }).name).toBe('3, Saturday, October 3, 1 event');
      expect(cell('lines', '2026-10-02', { occurrences: ['A', 'B', 'C'].map((title) => on('2026-10-02', [], title)) }).name).toBe('2, Friday, October 2, 3 events');
      expect(cell('dots', '2026-10-01').name).toBe('1, Thursday, October 1, no events, today');
    });

    it('is the date alone until its week has been read, so a day not yet known is never called free', () => {
      expect(cell('lines', '2026-10-02', { occurrences: null }).name).toBe('2, Friday, October 2');
      expect(cell('dots', '2026-10-02', { occurrences: null }).name).toBe('2, Friday, October 2');
    });

    it('says "today" last on today\'s cell, which the disc says to the eye, and on no other', () => {
      const five = ['A', 'B', 'C', 'D', 'E'].map((title) => on('2026-10-01', [], title));
      expect(cell('lines', '2026-10-01', { occurrences: five }).name).toBe('1, Thursday, October 1, 5 events, today');
      expect(cell('dots', '2026-10-01', { occurrences: five }).name).toBe('1, Thursday, October 1, 5 events, today');
      expect(cell('lines', '2026-10-01', { occurrences: null }).name).toBe('1, Thursday, October 1, today');
      expect(cell('dots', '2026-10-01', { occurrences: null }).name).toBe('1, Thursday, October 1, today');
      expect(cell('dots', '2026-10-03', { occurrences: [on('2026-10-03', [], 'A')] }).name).toBe('3, Saturday, October 3, 1 event');
      expect(cell('lines', '2026-10-02', { occurrences: five }).name).not.toContain('today');
    });

    it('is one rule: the Wall and the phone name every cell the same, and the rule is cellName', () => {
      const occurrences = [on('2026-10-01', [], 'A'), on('2026-10-02', [], 'B'), on('2026-10-02', [], 'C')];
      const lines = cells('lines', { occurrences }).flat();
      const dots = cells('dots', { occurrences }).flat();
      expect(lines.map((each) => each.name)).toEqual(dots.map((each) => each.name));
      expect(lines.map((each) => each.name)).toEqual(lines.map((each) => cellName(each.day.date, each.day.isToday, each.count)));
    });

    it('counts what the Profile Filter lets through', () => {
      const occurrences = [on('2026-10-02', ['a'], 'A'), on('2026-10-02', ['b'], 'B'), on('2026-10-02', [], 'C')];
      expect(cell('lines', '2026-10-02', { occurrences, pressed: ['a'] }).name).toBe('2, Friday, October 2, 2 events');
      expect(cell('dots', '2026-10-02', { occurrences, pressed: ['a'] }).count).toBe(2);
    });
  });

  describe("a cell's count", () => {
    it('is how many events the day holds: none for a free day, null until the week has been read', () => {
      expect(cell('lines', '2026-10-02').count).toBe(0);
      expect(cell('lines', '2026-10-01', { occurrences: ['A', 'B', 'C'].map((title) => on('2026-10-01', [], title)) }).count).toBe(3);
      expect(cell('lines', '2026-10-02', { occurrences: null }).count).toBeNull();
      expect(cell('dots', '2026-10-02', { occurrences: null }).count).toBeNull();
    });
  });

  describe('the Wall (lines)', () => {
    it("has the day's own occurrences, in the day's order: all-day first, then by start", () => {
      const late = on('2026-10-02', [], 'Late');
      const early = { ...on('2026-10-02', [], 'Early'), starts_at: '2026-10-02T12:00:00Z', ends_at: '2026-10-02T13:00:00Z' };
      const allDay = { ...on('2026-10-02', [], 'Photo day'), is_all_day: true, starts_at: '2026-10-02T05:00:00Z', ends_at: '2026-10-03T05:00:00Z' };
      const titles = cell('lines', '2026-10-02', { occurrences: [late, early, allDay] }).lines!.map((each) => each.title);
      expect(titles).toEqual(['Photo day', 'Early', 'Late']);
    });

    it('has the events of its own day alone, and none until its week has been read', () => {
      const occurrences = [on('2026-10-01', [], 'A'), on('2026-10-02', [], 'B')];
      expect(cell('lines', '2026-10-01', { occurrences }).lines!.map((each) => each.title)).toEqual(['A']);
      expect(cell('lines', '2026-10-02', { occurrences: null }).lines).toBeNull();
      expect(cell('lines', '2026-10-02').lines).toEqual([]);
    });

    it('has what the Profile Filter lets through: the pressed people\'s events and the whole Household\'s', () => {
      const occurrences = [on('2026-10-02', ['a'], 'Ava'), on('2026-10-02', ['b'], 'Ben'), on('2026-10-02', [], 'Everyone')];
      expect(cell('lines', '2026-10-02', { occurrences, pressed: ['a'] }).lines!.map((each) => each.title).sort()).toEqual(['Ava', 'Everyone']);
      expect(cell('lines', '2026-10-02', { occurrences }).lines).toHaveLength(3);
    });

    it('has no dots', () => {
      expect(cell('lines', '2026-10-02', { occurrences: [on('2026-10-02', ['a'])] })).not.toHaveProperty('dots');
    });
  });

  describe('the phone (dots)', () => {
    it('has a dot for each person who has something, and the Household\'s first when anything is for it', () => {
      expect(dotWords({ occurrences: [on('2026-10-02', []), on('2026-10-02', ['a']), on('2026-10-02', ['b'])] })).toEqual(['house', 'Ava', 'Ben']);
      expect(cell('dots', '2026-10-02', { occurrences: [on('2026-10-02', [])] }).dots).toEqual([{ kind: 'household' }]);
      expect(cell('dots', '2026-10-02', { occurrences: [on('2026-10-02', ['b'])] }).dots).toEqual([{ kind: 'person', profile: BEN }]);
    });

    it('has at most three dots', () => {
      const many = ['', 'a', 'b', 'c', 'd'].map((id) => on('2026-10-02', id ? [id] : []));
      expect(dotWords({ occurrences: many, profiles: [AVA, BEN, CORY, DEE] })).toEqual(['house', 'Ava', 'Ben']);
    });

    it('has no dot for a day that has not been read, and none for a free one', () => {
      expect(cell('dots', '2026-10-02', { occurrences: null }).dots).toEqual([]);
      expect(cell('dots', '2026-10-02').dots).toEqual([]);
    });

    it('has only the dots the Profile Filter lets through', () => {
      // An event for two of three people: with Ava pressed it is on the day for her, and Ben has no dot for it.
      const shared = [on('2026-10-02', ['a', 'b'])];
      expect(dotWords({ occurrences: shared, pressed: ['a'] })).toEqual(['Ava']);
      expect(dotWords({ occurrences: shared })).toEqual(['Ava', 'Ben']);
    });

    it('has no lines', () => {
      expect(cell('dots', '2026-10-02', { occurrences: [on('2026-10-02', ['a'])] })).not.toHaveProperty('lines');
    });
  });

  describe("a day beyond the calendar's range", () => {
    const given: Given = { occurrences: [on('2026-10-02', ['a']), on('2026-10-02', [])], window: MIDWEEK };

    it('is beyond when the window does not keep it, wherever its week falls, and not otherwise', () => {
      expect(cell('lines', '2026-10-02', { window: MIDWEEK }).beyond).toBe(true);
      expect(cell('dots', '2026-10-04', { window: MIDWEEK }).beyond).toBe(true);
      expect(cell('lines', '2026-10-05', { window: MIDWEEK }).beyond).toBe(false);
      expect(cell('lines', '2026-10-02').beyond).toBe(false);
      expect(cell('lines', '2026-10-28', { window: { first: '2026-09-01', last: '2026-10-27' } }).beyond).toBe(true);
    });

    it('holds nothing to read whatever it is given: no count, no lines, no dots', () => {
      const wall = cell('lines', '2026-10-02', given);
      expect(wall.count).toBeNull();
      expect(wall.lines).toBeNull();
      expect(cell('dots', '2026-10-02', given).dots).toEqual([]);
      expect(cell('dots', '2026-10-02', given).count).toBeNull();
    });

    it('says it is beyond the range in its name, with the date and no count', () => {
      expect(cell('dots', '2026-10-02', given).name).toBe("Friday, October 2, Beyond the calendar's range");
    });

    it('makes a week wholly beyond one that holds nothing, though the month is read', () => {
      const week = cells('lines', { occurrences: [on('2026-10-05', [])], window: LATER })[1]!;
      expect(week.map((each) => each.day.date)).toEqual(['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10']);
      expect(week.every((each) => each.beyond && each.count === null && each.lines === null)).toBe(true);
      expect(cells('lines', { window: LATER })[2]!.every((each) => !each.beyond && each.count === 0)).toBe(true);
    });
  });
});
