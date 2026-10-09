import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Profile } from '../src/lib/profiles';
import { columnsOf, finishedProfiles, groupByProfile, todaysRoutines, type Routine } from '../src/lib/routines';
import type { RoutinesToday } from '../src/lib/use-routines-today';
import type { RoutinesChart as RoutinesChartType } from '../src/RoutinesPage';

// The Routines chart as the Wall first draws it, rendered to markup so that what is asserted is what the browser is given: a column
// for each person, its heading, and what the chart says when it holds nothing. It imports the Supabase client, which is built on
// import and not used to draw: a placeholder URL and key are enough to load it (as tests/phone-settings.test.ts does for the phone).

let RoutinesChart: typeof RoutinesChartType;
beforeAll(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', process.env['VITE_SUPABASE_ANON_KEY'] ?? 'placeholder-anon-key');
  ({ RoutinesChart } = await import('../src/RoutinesPage'));
});

const profile = (id: string, name: string, sort: number): Profile => ({ id, name, color: '#93c5fd', avatar_url: null, sort_order: sort });
const routine = (id: string, profileId: string, title: string): Routine => ({ id, profile_id: profileId, title, days_of_week: 127, time_of_day: 'evening', picture: null, sort_order: 0, archived_at: null });

// What the Wall's one reader hands the chart on Thursday, in the evening (weekday 4): every part of it from the pure builders.
function routinesToday(profiles: Profile[], routines: Routine[], more: Partial<RoutinesToday> = {}): RoutinesToday {
  const weekday = 4;
  const groups = groupByProfile(profiles, todaysRoutines(routines, weekday));
  const done = new Set<string>();
  return {
    date: '2026-10-01',
    state: 'ready',
    settled: true,
    failed: false,
    part: 'evening',
    problems: {},
    groups,
    columns: columnsOf(profiles, routines, weekday),
    done,
    finished: finishedProfiles(groups, done),
    toggle: () => Promise.resolve(true),
    ...more,
  };
}
const words = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const chart = (today: RoutinesToday) => renderToStaticMarkup(createElement(RoutinesChart, { routines: today }));

describe("a person's column", () => {
  const column = () => {
    const html = chart(routinesToday([profile('p-bart', 'Bartholomew', 0)], [routine('r-1', 'p-bart', 'Brush teeth')]));
    const heading = /<h3([^>]*)id="routines-p-bart"([^>]*)>([^<]*)<\/h3>/.exec(html);
    const attributes = `${heading?.[1] ?? ''}${heading?.[2] ?? ''}`;
    return { html, name: heading?.[3], attributes, classes: (/class="([^"]*)"/.exec(attributes)?.[1] ?? '').split(' ') };
  };

  it('names the person in a heading the column is labelled by, and says the name whole', () => {
    const { html, name } = column();
    expect(name).toBe('Bartholomew');
    expect(html).toContain('aria-labelledby="routines-p-bart"');
  });

  it('lets a long name hyphenate and wrap as the tiles\' words do, in two lines at most: no letter is cut with nothing to show it', () => {
    // "Bartholomew" in 26 px Young Serif beside a 56 px disc is wider than the 176 px it has: it broke as "Bartholome" over "w".
    const { classes, attributes } = column();
    expect(classes).toEqual(expect.arrayContaining(['min-w-0', 'break-words', 'hyphens-auto', 'line-clamp-2']));
    // The direction is the name's own, so a name written right to left starts at the right and is cut at its end.
    expect(attributes).toContain('dir="auto"');
  });
});

// What a screen says when it holds nothing says what to do, in one style (docs/look.md, Empty states): 16 px in --muted-foreground, a
// sentence and a clause with the way out.
describe('what the chart says when it holds nothing', () => {
  const EMPTY = 'text-base text-muted-foreground';

  it('says no routines yet, and that the owner adds them in Settings', () => {
    const html = chart(routinesToday([profile('p-ava', 'Ava', 0)], []));
    expect(html).toContain(`<p class="${EMPTY}">No routines yet. The owner adds them in Settings.</p>`);
  });

  it('says what a part holds when it holds nothing, in the same style', () => {
    // Ava's one Routine is in the evening: the morning has none of its own, none left from earlier and none for any time.
    const html = chart(routinesToday([profile('p-ava', 'Ava', 0)], [routine('r-1', 'p-ava', 'Brush teeth')], { part: 'morning' }));
    expect(html).toMatch(new RegExp(`<p class="${EMPTY} px-1">Nothing this morning\\.</p>`));
  });

  it('says "Loading" in the same style until the first read lands, and not "no routines yet"', () => {
    const html = chart(routinesToday([profile('p-ava', 'Ava', 0)], [], { state: 'loading', settled: false }));
    expect(html).toContain(`<p class="${EMPTY}">Loading</p>`);
    expect(html).not.toContain('No routines yet');
  });

  it('never says an empty column is a failure: a person with nothing today is "Nothing today", under their name', () => {
    const noWeekday = { ...routine('r-1', 'p-ava', 'Brush teeth'), days_of_week: 0 };
    const html = chart(routinesToday([profile('p-ava', 'Ava', 0)], [noWeekday]));
    expect(html).not.toContain('role="alert"');
  });
});

// The chart's heading row is every screen's: a 28 px title in a 48 px row, and the first card 16 px under it (docs/look.md).
describe("the chart's heading row", () => {
  const html = () => chart(routinesToday([profile('p-ava', 'Ava', 0)], [routine('r-1', 'p-ava', 'Brush teeth')]));

  it('has the 28 px title in a row 48 px tall, and the first card 16 px under it', () => {
    expect(html()).toMatch(/^<section [^>]*class="flex min-h-0 flex-col gap-4"><div class="flex min-h-12 flex-none [^"]*"><h2 [^>]*class="font-display text-\[28px\] leading-\[34px\] outline-none">Routines<\/h2>/);
  });

  it('has a control for the part of the day as tall as the row, its buttons 48 px both ways, 8 px apart', () => {
    const group = /<div role="group" aria-label="Part of the day" class="([^"]*)">/.exec(html())?.[1]?.split(' ') ?? [];
    expect(group).toEqual(expect.arrayContaining(['min-h-12', 'gap-2']));
    // No padding to take the buttons' height from the row: a button is the row.
    expect(group).not.toContain('p-1');
    const buttons = [...html().matchAll(/<button [^>]*class="([^"]*)"[^>]*aria-pressed=/g)].map(([, classes]) => classes?.split(' ') ?? []);
    expect(buttons).toHaveLength(4);
    for (const classes of buttons) expect(classes).toEqual(expect.arrayContaining(['h-12', 'min-w-12']));
  });
});

// A tablet hung upright (docs/specs/0009, decision 6): the columns wrap, each its natural height, and the chart scrolls as one column.
// The "More routines" foot is drawn by the browser's measure, only while the chart holds more than it shows, so a static render shows the
// box it is the foot of, and that nothing else scrolls or says "More".
describe('the chart in portrait', () => {
  const today = () => routinesToday([profile('p-ava', 'Ava', 0), profile('p-ben', 'Ben', 1)], [routine('r-1', 'p-ava', 'Brush teeth'), routine('r-2', 'p-ben', 'Pack bag')]);
  const portrait = () => renderToStaticMarkup(createElement(RoutinesChart, { routines: today(), portrait: true }));
  const columnClasses = (html: string) => [...html.matchAll(/<section aria-labelledby="routines-p-[^"]*" class="([^"]*)"/g)].map(([, classes]) => classes?.split(' ') ?? []);

  it('lays the columns in a grid of at least 17 rem, 12 across and 16 under one another, in a box that scrolls up and down and not sideways', () => {
    const html = portrait();
    expect(html).toContain('<div class="min-h-0 flex-1 overflow-y-auto"><div class="grid grid-cols-[repeat(auto-fit,minmax(min(17rem,100%),1fr))] items-start gap-x-3 gap-y-4 [&amp;_*]:scroll-mb-18">');
    expect(html).not.toContain('flex-wrap items-start');
    expect(html).not.toContain('overflow-x-auto');
  });

  it('keeps the columns between 17 rem and max-w-md, at their natural height with no scrolling box of their own', () => {
    const columns = columnClasses(portrait());
    expect(columns).toHaveLength(2);
    for (const classes of columns) {
      expect(classes).toEqual(expect.arrayContaining(['min-w-[17rem]', 'max-w-md', 'flex-1']));
      expect(classes).not.toContain('max-h-full');
    }
    // The tiles' box is the column's own height, not a box of its own, so it has no foot to measure.
    expect(portrait()).not.toMatch(/<div class="[^"]*overflow-y-auto[^"]*">\s*<div class="flex flex-col gap-2\.5 p-1">/);
    expect(portrait()).toContain('<div class="-m-1"><div class="flex flex-col gap-2.5 p-1">');
  });

  it('has no "More people" in the heading row, and none of any kind until the chart holds more than it shows', () => {
    expect(words(portrait())).not.toContain('More');
  });

  it('leaves landscape as it was: the columns side by side in a row that scrolls sideways, each scrolling its own tiles', () => {
    const landscape = chart(today());
    expect(landscape).toBe(renderToStaticMarkup(createElement(RoutinesChart, { routines: today(), portrait: false })));
    expect(landscape).toContain('<div class="flex min-h-0 flex-1 items-start gap-3 overflow-x-auto"><div class="contents">');
    expect(landscape).toContain('class="-m-1 min-h-0 overflow-y-auto [&amp;_li]:scroll-mb-18 [&amp;_li_button]:scroll-mb-18"');
    // Master's own class string for a column, character for character, and not the code path portrait derives from.
    const master = 'person relative flex max-h-full min-h-0 max-w-md min-w-[17rem] flex-1 flex-col gap-2.5 rounded-3xl bg-person-soft p-3';
    for (const classes of columnClasses(landscape)) expect(classes.join(' ')).toBe(master);
    expect(landscape).not.toContain('flex-wrap items-start');
  });
});
