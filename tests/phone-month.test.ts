import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { WeekCells as WeekCellsType } from '../src/components/MonthGrid';
import { type Occurrence } from '../src/lib/calendar-occurrences';
import { dayEventsOf } from '../src/lib/day-events';
import { monthCells } from '../src/lib/month-grid';
import { monthWeeks } from '../src/lib/paged-view';
import type { Profile } from '../src/lib/profiles';

// A Month cell on the phone rendered to markup: its name (the full date and how many events), its marks and the sizes the look gives it. The cell
// is fed from the core (monthCells) and drawn by the week's part (WeekCells), as the phone's Month does it. What the core decides, the name and who
// the dots are for, is held in tests/month-grid.test.ts (and monthDots in phone-calendar.test.ts); how the grid sits in a 390 px column is looked
// at in a browser.

// WeekCells' module imports the Supabase client, which is built on import and not used to draw: a placeholder URL and key are enough to load it
// (as tests/phone-home.test.ts does), so CI, which has no .env.local, loads it the same way.
let WeekCells: typeof WeekCellsType;
beforeAll(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', process.env['VITE_SUPABASE_ANON_KEY'] ?? 'placeholder-anon-key');
  ({ WeekCells } = await import('../src/components/MonthGrid'));
});
afterAll(() => {
  vi.unstubAllEnvs();
});

const noop = () => undefined;
const WINDOW = { first: '2026-09-01', last: '2027-04-01' };
// The window of a calendar that begins after Oct 4, so Oct 2 is a day beyond its range.
const LATER_WINDOW = { first: '2026-10-05', last: '2027-04-01' };
const profile = (id: string, name: string): Profile => ({ id, name, color: '#93c5fd', avatar_url: null, sort_order: 0 });
const AVA = profile('a', 'Ava');
const BEN = profile('b', 'Ben');

let count = 0;
// Piano, 10:00 to 11:00 AM on Fri Oct 2, New York.
const event = (profile_ids: string[]): Occurrence => ({
  source: 'synced',
  id: `e${++count}`,
  calendar_id: 'cal',
  calendar_name: 'Calendar',
  title: 'Piano',
  description: null,
  location: null,
  starts_at: '2026-10-02T14:00:00Z',
  ends_at: '2026-10-02T15:00:00Z',
  is_all_day: false,
  profile_id: profile_ids[0] ?? null,
  profile_ids,
  household_id: 'household-1', event_id: null, repeat_every: null, repeat_interval: null, repeat_days: null, repeat_until: null,
});
// The same occurrences, on `date`.
const on = (date: string, occurrences: Occurrence[]): Occurrence[] => occurrences.map((each) => ({ ...each, starts_at: `${date}T14:00:00Z`, ends_at: `${date}T15:00:00Z` }));

type Options = { occurrences?: Occurrence[] | null; profiles?: Profile[]; pressed?: string[]; picked?: boolean; beyond?: boolean };

// A cell as the month draws it: the core's cell for `date` (its dots are the day events', from the Profiles and the people pressed), drawn by the
// week's part with the week's wrapper cut off. Today is Oct 2 unless `today` says otherwise.
function cell(date: string, { occurrences = [], profiles = [AVA, BEN], pressed = [], picked = false, beyond = false }: Options = {}, today = '2026-10-02') {
  const events = dayEventsOf(occurrences, profiles, pressed);
  const weeks = monthWeeks('2026-10-01', 'America/New_York', today);
  const one = monthCells(weeks, '2026-10-01', beyond ? LATER_WINDOW : WINDOW, events, 'dots').flat().find((each) => each.day.date === date)!;
  const html = renderToStaticMarkup(createElement(WeekCells, { form: 'dots', cells: [one], picked: picked ? date : '', onOpen: noop }));
  return html.slice(html.indexOf('>') + 1, html.length - '</div>'.length);
}
const tagOf = (html: string) => html.slice(0, html.indexOf('>') + 1);
const classesOf = (html: string) => (/class="([^"]*)"/.exec(html)?.[1] ?? '').replaceAll('&amp;', '&').replaceAll('&gt;', '>').split(' ');

describe('a phone Month cell', () => {
  it("is a button named by the core's name: the full date and how many events it has", () => {
    const four = cell('2026-10-02', { occurrences: [event([]), event(['a']), event(['b']), event(['a', 'b'])] });
    expect(tagOf(four)).toMatch(/^<button\b/);
    expect(tagOf(four)).toContain('aria-label="2, Friday, October 2, 4 events, today"');
    expect(tagOf(cell('2026-10-03', { occurrences: on('2026-10-03', [event(['a'])]) }))).toContain('aria-label="3, Saturday, October 3, 1 event"');
    expect(tagOf(cell('2026-10-01'))).toContain('aria-label="1, Thursday, October 1, no events"');
  });

  it('marks today alone as the date, in a 30 px --primary disc', () => {
    const today = cell('2026-10-02');
    expect(tagOf(today)).toContain('aria-current="date"');
    expect(today).toContain('bg-primary');
    expect(today).toContain('size-[30px]');
    // The digit stays on a line as tall as the disc (cn would drop leading-none if it came before the text size), so at larger text it does not run out of it.
    expect(classesOf(today.slice(today.indexOf('<span aria-hidden')))).toEqual(expect.arrayContaining(['text-lg', 'leading-none']));
    expect(tagOf(cell('2026-10-03'))).not.toContain('aria-current');
  });

  it('presses the picked day alone, and draws the Selected look 2 px inside the button', () => {
    expect(tagOf(cell('2026-10-02', { picked: true }))).toContain('aria-pressed="true"');
    expect(tagOf(cell('2026-10-03'))).toContain('aria-pressed="false"');
    const html = cell('2026-10-03', { picked: true });
    const button = classesOf(tagOf(html));
    expect(button).toContain('p-0.5');
    expect(button).not.toContain('selected:bg-accent');
    expect(html).toContain('group-aria-pressed:bg-accent');
    expect(html).toContain('group-aria-pressed:ring-2');
    expect(html).toContain('group-aria-pressed:ring-foreground');
  });

  it('is 58 tall and at least 48 wide, with the date in the display face at 18', () => {
    const html = cell('2026-10-03');
    expect(classesOf(tagOf(html))).toEqual(expect.arrayContaining(['h-[58px]', 'min-w-12']));
    expect(html).toContain('font-display text-lg');
  });

  it('dims the dates of the neighbouring months with the muted colour, never a lighter one', () => {
    const dateOf = (html: string, number: number) => new RegExp(`<span aria-hidden="true" class="([^"]*)">${number}</span>`).exec(html)![1]!.split(' ');
    expect(dateOf(cell('2026-09-27'), 27)).toContain('text-muted-foreground');
    expect(dateOf(cell('2026-10-03'), 3)).toContain('text-foreground');
  });

  it('draws a 7 px dot for each person and the Household, in --primary for the Household, hidden from a screen reader', () => {
    const html = cell('2026-10-02', { occurrences: [event([]), event(['a']), event(['b'])] });
    expect(html.match(/size-\[7px\]/g)).toHaveLength(3);
    expect(html).toContain('size-[7px] rounded-full bg-primary');
    expect(html.match(/bg-person-strong/g)).toHaveLength(2);
    expect(html).toMatch(/<span aria-hidden="true" class="flex h-\[7px\] gap-1">/);
  });

  it('draws at most three dots', () => {
    const many = [event([]), event(['a']), event(['b']), event(['c']), event(['d'])];
    const html = cell('2026-10-02', { occurrences: many, profiles: [AVA, BEN, profile('c', 'Cory'), profile('d', 'Dee')] });
    expect(html.match(/size-\[7px\]/g)).toHaveLength(3);
  });

  it('draws no dot for a day that has not been read, and none for a free one', () => {
    expect(cell('2026-10-02', { occurrences: null })).not.toContain('size-[7px] rounded-full');
    expect(cell('2026-10-02')).not.toContain('size-[7px] rounded-full');
  });

  it('draws only the dots the Profile filter lets through', () => {
    // An event for two of three people: with Ava pressed it is on the day for her, and Ben has no dot for it.
    const profiles = [AVA, BEN, profile('c', 'Cory')];
    const shared = [event(['a', 'b'])];
    expect(cell('2026-10-02', { occurrences: shared, profiles, pressed: ['a'] }).match(/bg-person-strong/g)).toHaveLength(1);
    expect(cell('2026-10-02', { occurrences: shared, profiles }).match(/bg-person-strong/g)).toHaveLength(2);
  });

  it('is no button beyond the range the calendar keeps, and says so with its date', () => {
    const html = cell('2026-10-02', { beyond: true });
    expect(html).not.toContain('<button');
    expect(html).toContain("Beyond the calendar's range".replace("'", '&#x27;'));
    expect(html).toContain('Friday, October 2, Beyond');
  });
});
