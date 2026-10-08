import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type Occurrence, type WallRoute } from '../src/lib/calendar-occurrences';
import { monthWeeks, type CalendarView } from '../src/lib/paged-view';
import type { Profile } from '../src/lib/profiles';
import type { PhoneCalendar as PhoneCalendarType } from '../src/phone/PhoneCalendar';
import type { WeekCells as WeekCellsType } from '../src/phone/PhoneMonth';
import { FACE, TOUCHING } from '../src/phone/parts';
import type { PhoneScreenProps } from '../src/PhoneWall';
import { dayEventsOf } from '../src/lib/day-events';

// The phone's Calendar screen rendered to markup (docs/specs/0004, Screens, Calendar): the control with the view pressed, the pager named
// for what it moves by, and the chips or cells of Week and Month. A static render reads nothing, so what the Profile filter does to the
// cells is held against the grid's own week of cells, given the events a read would have brought. The components import the Supabase
// client, which is built on import and not used to draw: a placeholder URL and key are enough to load them (as tests/phone-shell.test.ts does).

let PhoneCalendar: typeof PhoneCalendarType;
let WeekCells: typeof WeekCellsType;
beforeAll(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', process.env['VITE_SUPABASE_ANON_KEY'] ?? 'placeholder-anon-key');
  // Thursday, October 8, 2026, noon in Chicago: the calendar keeps Sep 8 to Apr 8.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-08T17:00:00Z'));
  ({ PhoneCalendar } = await import('../src/phone/PhoneCalendar'));
  ({ WeekCells } = await import('../src/phone/PhoneMonth'));
});
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const CHICAGO = 'America/Chicago';
const noop = () => undefined;
const profile = (id: string, name: string, order: number): Profile => ({ id, name, color: '#93c5fd', avatar_url: null, sort_order: order });
const AVA = profile('a', 'Ava', 0);
const BEN = profile('b', 'Ben', 1);
const CORY = profile('c', 'Cory', 2);

type CalendarRoute = Extract<WallRoute, { view: CalendarView }>;
function screen(view: CalendarView, date: string | null) {
  const route: CalendarRoute = { view, date };
  const props = { route, timezone: CHICAGO, added: 0, profiles: [AVA, BEN, CORY], openView: noop } as unknown as PhoneScreenProps;
  return renderToStaticMarkup(createElement(PhoneCalendar, { ...props, route }));
}

function buttons(html: string): { tag: string; words: string }[] {
  return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((match) => ({ tag: match[1]!, words: match[2]!.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() }));
}
const nameOf = (tag: string) => /aria-label="([^"]*)"/.exec(tag)?.[1];
const pressedOf = (tag: string) => /aria-pressed="(true|false)"/.exec(tag)?.[1];
const named = (html: string, pattern: RegExp) => buttons(html).filter((button) => pattern.test(nameOf(button.tag) ?? ''));
const BEYOND = 'Beyond the calendar&#x27;s range';

describe('the control and the pager', () => {
  it.each([
    ['day', 'Day'],
    ['week', 'Week'],
    ['month', 'Month'],
  ] as const)('%s: the control of three has %s pressed and the pager is named for what it moves by', (view, label) => {
    const html = screen(view, null);
    const control = /<div role="group" aria-label="Calendar view"[\s\S]*?<\/div>/.exec(html)![0];
    expect(buttons(control).map((button) => [button.words, pressedOf(button.tag)])).toEqual(['Day', 'Week', 'Month'].map((word) => [word, String(word === label)]));
    expect(buttons(html).map((button) => nameOf(button.tag))).toEqual(expect.arrayContaining([`Previous ${view}`, `Next ${view}`]));
    // The control comes before the pager, which comes before the view.
    expect(html.indexOf('Calendar view')).toBeLessThan(html.indexOf(`Previous ${view}`));
  });

  it('says the page in short words between the buttons: the week, the day, the month', () => {
    expect(screen('week', null)).toMatch(/<h2[^>]*>Oct 4 to Oct 10<\/h2>/);
    expect(screen('day', '2026-10-08')).toMatch(/<h2[^>]*>Thu, Oct 8<\/h2>/);
    expect(screen('month', null)).toMatch(/<h2[^>]*>October 2026<\/h2>/);
  });

  it('switches off Previous on the first page the calendar keeps, and says why', () => {
    const html = screen('week', '2026-09-06');
    expect(buttons(html).find((button) => nameOf(button.tag) === 'Previous week')!.tag).toContain('disabled=""');
    expect(buttons(html).find((button) => nameOf(button.tag) === 'Next week')!.tag).not.toContain('disabled=""');
    expect(html).toContain('This is as far back as the calendar goes.');
  });
});

describe('Day', () => {
  it('is a card like the others: 12 inside all round, 22 round on the phone and 24 round on the tablet', () => {
    const card = /<section aria-label="Thursday, October 8, today" class="([^"]*)"/.exec(screen('day', '2026-10-08'));
    expect(card).not.toBeNull();
    const classes = card![1]!.split(' ');
    expect(classes).toEqual(expect.arrayContaining(['phone:rounded-[22px]', 'rounded-3xl', 'p-3']));
    // One padding, so the card is even on the tablet too: nothing sets a side of it apart.
    expect(classes.filter((name) => /(^|:)p[xytblr]-/.test(name))).toEqual([]);
  });
});

describe('Week', () => {
  it("heads the picked day with its full date in Lexend 15, weight 500, secondary", () => {
    const heading = /<h3 class="([^"]*)">Thursday, October 8<\/h3>/.exec(screen('week', null));
    expect(heading).not.toBeNull();
    expect(heading![1]!.split(' ')).toEqual(expect.arrayContaining(['text-[15px]', 'font-medium', 'text-muted-foreground']));
    expect(heading![1]).not.toContain('font-display');
  });

  it('draws seven chips, today marked and picked', () => {
    const html = screen('week', null);
    const chips = named(html, /^\w+day \d+/);
    expect(chips.map((chip) => nameOf(chip.tag))).toEqual(['Sunday 4', 'Monday 5', 'Tuesday 6', 'Wednesday 7', 'Thursday 8, today', 'Friday 9', 'Saturday 10']);
    expect(chips.map((chip) => pressedOf(chip.tag))).toEqual(['false', 'false', 'false', 'false', 'true', 'false', 'false']);
    expect(html.split('aria-current="date"').length - 1).toBe(1);
    expect(html).toContain('Thursday, October 8');
  });

  it("picks the Sunday of a week that does not hold today, and has no chip that is today's", () => {
    const html = screen('week', '2026-10-11');
    expect(named(html, /^\w+day \d+/).map((chip) => pressedOf(chip.tag))).toEqual(['true', 'false', 'false', 'false', 'false', 'false', 'false']);
    expect(html).not.toContain('aria-current="date"');
    expect(html).toContain('Sunday, October 11');
  });

  it('picks Sep 8 in the first week, whose first two days are beyond the calendar and are no buttons', () => {
    const html = screen('week', '2026-09-06');
    const chips = named(html, /^\w+day \d+/);
    expect(chips.map((chip) => nameOf(chip.tag))).toEqual(['Tuesday 8', 'Wednesday 9', 'Thursday 10', 'Friday 11', 'Saturday 12']);
    expect(pressedOf(chips[0]!.tag)).toBe('true');
    expect(html).toContain(`Sunday 6, ${BEYOND}`);
    expect(html).toContain(`Monday 7, ${BEYOND}`);
    expect(html).toContain('Tuesday, September 8');
  });
});

describe('Month', () => {
  const cellsOf = (html: string) => named(html, /^\w+day, \w+ \d+/);

  it('heads the grid with the weekdays in three letters at 14 px, secondary, hidden from a screen reader (each cell says its weekday)', () => {
    const row = /<div aria-hidden="true" class="grid grid-cols-7 pb-1">([\s\S]*?)<\/div>/.exec(screen('month', null))![1]!;
    const spans = [...row.matchAll(/<span class="([^"]*)">([^<]*)<\/span>/g)];
    expect(spans.map((span) => span[2])).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    for (const span of spans) expect(span[1]!.split(' ')).toEqual(expect.arrayContaining(['text-sm', 'text-muted-foreground']));
  });

  it('draws a cell from the shared touching target and face, as the day chips are', () => {
    const html = screen('month', null);
    const cell = cellsOf(html)[0]!;
    expect(cell.tag).toContain('h-[58px]');
    expect(cell.tag).toContain(TOUCHING);
    expect(html).toContain(FACE);
  });

  it('draws a button for every day of the grid, today named and marked, and today picked', () => {
    const cells = cellsOf(screen('month', null));
    expect(cells).toHaveLength(35);
    expect(cells.filter((cell) => cell.tag.includes('aria-current="date"')).map((cell) => nameOf(cell.tag))).toEqual(['Thursday, October 8, today']);
    expect(cells.filter((cell) => pressedOf(cell.tag) === 'true').map((cell) => nameOf(cell.tag))).toEqual(['Thursday, October 8, today']);
  });

  it('picks the 1st of a month that does not hold today', () => {
    const cells = cellsOf(screen('month', '2026-11-01'));
    expect(cells.filter((cell) => pressedOf(cell.tag) === 'true').map((cell) => nameOf(cell.tag))).toEqual(['Sunday, November 1']);
  });

  it('picks Sep 8 in the first month, whose days before it are no buttons', () => {
    const html = screen('month', '2026-09-01');
    const cells = cellsOf(html);
    expect(cells.filter((cell) => pressedOf(cell.tag) === 'true').map((cell) => nameOf(cell.tag))).toEqual(['Tuesday, September 8']);
    expect(cells.some((cell) => nameOf(cell.tag)?.startsWith('Monday, September 7'))).toBe(false);
    expect(html).toContain(`Monday, September 7, ${BEYOND}`);
  });
});

describe('the Profile filter reaches the Month cells', () => {
  // The week of Oct 4 to Oct 10, the second of October's grid.
  const WEEK = monthWeeks('2026-10-01', CHICAGO, '2026-10-08')[1];
  const WINDOW = { first: '2026-09-08', last: '2027-04-08' };
  let count = 0;
  const event = (profile_ids: string[]): Occurrence => ({
    source: 'native',
    id: `e${++count}`,
    calendar_id: null,
    calendar_name: 'Nidus',
    title: 'Something',
    description: null,
    location: null,
    starts_at: '2026-10-08T19:00:00Z',
    ends_at: '2026-10-08T20:00:00Z',
    is_all_day: false,
    profile_id: profile_ids[0] ?? null,
    profile_ids,
  });
  // What a read gives the grid: the day events (dayEventsOf) cut it by the Profile filter, and the dots by the pressed people.
  const cells = (occurrences: Occurrence[], pressed: readonly string[]) =>
    renderToStaticMarkup(
      createElement(WeekCells, { days: WEEK!, anchor: '2026-10-01', window: WINDOW, events: dayEventsOf(occurrences, [AVA, BEN, CORY], pressed), picked: '2026-10-08', onPick: noop }),
    );
  const dots = (html: string) => html.match(/bg-person-strong/g)?.length ?? 0;
  const thursday = (html: string) => nameOf(buttons(html).find((button) => nameOf(button.tag)?.startsWith('Thursday, October 8'))!.tag);

  it('draws a dot for each person who has something, and only the pressed people when the filter is on', () => {
    const own = [event(['a']), event(['b']), event(['c'])];
    expect(dots(cells(own, []))).toBe(3);
    expect(dots(cells([own[1]!], ['b']))).toBe(1);
    expect(dots(cells([own[0]!, own[2]!], ['a', 'c']))).toBe(2);
  });

  it('names the cell by what it is given', () => {
    const own = [event(['a']), event(['b']), event(['c'])];
    expect(thursday(cells(own, []))).toBe('Thursday, October 8, 3 events, today');
    expect(thursday(cells([own[1]!], ['b']))).toBe('Thursday, October 8, 1 event, today');
  });

  it('draws one event for two people as a dot for the pressed one alone', () => {
    const shared = [event(['a', 'b'])];
    expect(dots(cells(shared, []))).toBe(2);
    expect(dots(cells(shared, ['b']))).toBe(1);
  });
});
