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
    loaded: true,
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

  it('says no routines yet, and where to add some', () => {
    const html = chart(routinesToday([profile('p-ava', 'Ava', 0)], []));
    expect(html).toContain(`<p class="${EMPTY}">No routines yet. Add some on your phone.</p>`);
  });

  it('says what a part holds when it holds nothing, in the same style', () => {
    // Ava's one Routine is in the evening: the morning has none of its own, none left from earlier and none for any time.
    const html = chart(routinesToday([profile('p-ava', 'Ava', 0)], [routine('r-1', 'p-ava', 'Brush teeth')], { part: 'morning' }));
    expect(html).toMatch(new RegExp(`<p class="${EMPTY} px-1">Nothing this morning\\.</p>`));
  });

  it('says "Loading" in the same style until the first read lands, and not "no routines yet"', () => {
    const html = chart(routinesToday([profile('p-ava', 'Ava', 0)], [], { loaded: false, settled: false }));
    expect(html).toContain(`<p class="${EMPTY}">Loading</p>`);
    expect(html).not.toContain('No routines yet');
  });

  it('never says an empty column is a failure: a person with nothing today is "Nothing today", under their name', () => {
    const noWeekday = { ...routine('r-1', 'p-ava', 'Brush teeth'), days_of_week: 0 };
    const html = chart(routinesToday([profile('p-ava', 'Ava', 0)], [noWeekday]));
    expect(html).not.toContain('role="alert"');
  });
});
