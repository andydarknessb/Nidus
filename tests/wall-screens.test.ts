import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { PagedCalendar as PagedCalendarType } from '../src/components/FiveDayCalendar';
import type { MealsScreen as MealsScreenType } from '../src/MealsPage';

// The screens that page (Meals, and the Day, Week and Month views) as the Wall first draws them, rendered to markup so that what is
// asserted is what the browser is given. They hold what every screen of the Wall holds (docs/look.md): a title at 28 px in the display
// face, in a heading row 48 px tall, with the first card 16 px under the row. The Routines chart and the Lists screen are held to the
// same in tests/routines-chart.test.ts and tests/lists-screen.test.ts. They import the Supabase client, which is built on import and
// not used to draw: a placeholder URL and key are enough to load them (as tests/lists-screen.test.ts does).

let PagedCalendar: typeof PagedCalendarType;
let MealsScreen: typeof MealsScreenType;
beforeAll(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', process.env['VITE_SUPABASE_ANON_KEY'] ?? 'placeholder-anon-key');
  ({ PagedCalendar } = await import('../src/components/FiveDayCalendar'));
  ({ MealsScreen } = await import('../src/MealsPage'));
});

const timezone = 'America/Chicago';
const TITLE = /<h2 [^>]*class="[^"]*\bfont-display text-\[28px\] leading-\[34px\]/;

describe('the Day, Week and Month views', () => {
  const view = (which: 'day' | 'week' | 'month') => renderToStaticMarkup(createElement(PagedCalendar, { timezone, view: which, date: null, onNavigate: () => undefined, profiles: null }));

  it.each(['day', 'week', 'month'] as const)('%s: the paging row is first and the card is 16 px under it, with the 28 px title in the row', (which) => {
    const html = view(which);
    expect(html).toMatch(/^<div class="flex min-h-0 flex-col gap-4"><nav aria-label="Calendar paging" /);
    expect(html).toMatch(TITLE);
  });

  it('has round paging buttons 48 px both ways', () => {
    const html = view('week');
    expect(html.match(/<button [^>]*class="[^"]*\bsize-12\b[^"]*"[^>]*aria-label="(Previous|Next) week"/g)).toHaveLength(2);
    expect(html).toMatch(/<button [^>]*class="[^"]*\bh-12\b[^"]*">Today<\/button>/);
  });
});

describe('the Meals screen', () => {
  const meals = () => renderToStaticMarkup(createElement(MealsScreen, { timezone, date: null, onNavigate: () => undefined }));

  it('has the paging row 48 tall with the 28 px title in it, and the plan 16 px under it', () => {
    const html = meals();
    expect(html).toMatch(/^<div class="flex min-h-0 flex-col gap-4"><nav aria-label="Meals paging" class="flex h-12 /);
    expect(html).toMatch(TITLE);
  });

  it("puts today's date in its 38 px disc at 21 px, as the schedule does, and the other dates at 22", () => {
    const html = meals();
    const number = (heading: string) => /<span class="([^"]*)">\d+<\/span><\/h3>$/.exec(heading)?.[1] ?? '';
    const headings = [...html.matchAll(/<h3 [^>]*aria-label="[A-Z][a-z]+ \d+(, today)?"[^>]*>.*?<\/h3>/g)].map(([heading]) => heading);
    const today = headings.filter((heading) => heading.includes('aria-current="date"'));
    const others = headings.filter((heading) => !heading.includes('aria-current="date"'));
    expect(today).toHaveLength(1);
    expect(others.length).toBeGreaterThan(0);
    expect(number(today[0] ?? '').split(' ')).toEqual(expect.arrayContaining(['size-[38px]', 'rounded-full', 'bg-primary', 'text-[21px]']));
    expect(number(today[0] ?? '')).not.toContain('text-[22px]');
    for (const heading of others) expect(number(heading).split(' ')).toContain('text-[22px]');
  });
});

// Larger text (a root font size above 16 px, which makes every rem box bigger and leaves the screen as it is, issue #69). What is asserted is
// the markup that decides it: nothing here can measure a screen, so each part says what it is held to in its classes.
describe('the Wall at larger text', () => {
  it("gives the Month grid the height of the weekday row and each week's date, and only from larger text", () => {
    // A week is 2.625 rem for its date (MonthCell.tsx's CELL_HEAD_REM) under a weekday row of 2.5 rem; the line under the date is not in it.
    const html = renderToStaticMarkup(createElement(PagedCalendar, { timezone, view: 'month', date: null, onNavigate: () => undefined, profiles: null }));
    // The floor is there from the first pixel of larger text and not at 16 px, so a short screen at 16 px text is as it was.
    const rem = Number(/<section aria-label="Calendar" style="min-height:min\(([\d.]+)rem, calc\(\(1rem - 16px\) \* 1000\)\)"/.exec(html)?.[1]);
    expect([4, 5, 6].map((weeks) => 2.5 + weeks * 2.625)).toContain(rem);
  });

  it("caps the Meals plan's slot column at larger text, so seven days keep their room, and keeps its 7 rem at 16 px", () => {
    const html = renderToStaticMarkup(createElement(MealsScreen, { timezone, date: null, onNavigate: () => undefined }));
    expect(html).toContain('grid-template-columns:min(7rem, max(112px, 11vw)) repeat(7, minmax(3rem, 1fr))');
  });
});

// The Wall in portrait (docs/specs/0009): Meals turns, the slots across the top and the days down the side, and nothing else about it moves.
describe('the Meals screen in portrait', () => {
  const meals = (portrait: boolean) => renderToStaticMarkup(createElement(MealsScreen, { timezone, date: null, onNavigate: () => undefined, portrait }));
  const names = (html: string) => [...html.matchAll(/<button [^>]*><span class="sr-only">([^<]*)<\/span>/g)].map(([, name]) => name);
  const headings = (html: string) => [...html.matchAll(/<h3 [^>]*>/g)].map(([tag]) => /aria-label="([^"]*)"/.exec(tag)?.[1] ?? 'slot');

  it('puts the four slots in the first row and the days in the first column', () => {
    const html = meals(true);
    expect(html).toContain('grid-template-columns:6rem repeat(4, minmax(3rem, 1fr))');
    expect(html).toContain('grid-template-rows:auto repeat(7, minmax(min-content, 1fr))');
    // The slots' names come before every day's heading, each with its picture, and then each day's heading is followed by its four cells.
    const slots = [...html.matchAll(/<h3 [^>]*><span aria-hidden[^>]*><svg[^>]*>.*?<\/svg><\/span>(Breakfast|Lunch|Dinner|Snack)<\/h3>/g)].map(([, label]) => label);
    expect(slots).toEqual(['Breakfast', 'Lunch', 'Dinner', 'Snack']);
    expect(headings(html)).toEqual(['slot', 'slot', 'slot', 'slot', ...Array(7).fill(expect.stringMatching(/^[A-Z][a-z]+ \d+(, today)?$/))]);
    const days = html.split(/<h3 [^>]*aria-label=/).slice(1);
    expect(days).toHaveLength(7);
    for (const day of days) expect(names(day)).toHaveLength(4);
    expect(names(days[0]!)).toEqual(expect.arrayContaining([expect.stringMatching(/^Breakfast, /), expect.stringMatching(/^Snack, /)]));
  });

  it('keeps every cell the same button, at least 48 tall in a track of at least 3 rem, with the name it has in landscape', () => {
    const portrait = meals(true);
    const landscape = meals(false);
    expect(names(portrait)).toHaveLength(28);
    expect([...names(portrait)].sort()).toEqual([...names(landscape)].sort());
    expect(portrait.match(/<button [^>]*class="[^"]*\bmin-h-12\b[^"]*\bmin-w-0\b/g)).toHaveLength(28);
  });

  it('leaves the landscape grid as it is: the days across the top and a row for each slot', () => {
    const html = meals(false);
    expect(html).toContain('grid-template-columns:min(7rem, max(112px, 11vw)) repeat(7, minmax(3rem, 1fr))');
    expect(html).toContain('grid-template-rows:3.875rem repeat(4, minmax(min-content, 1fr))');
    expect(headings(html).slice(0, 7)).toEqual(Array(7).fill(expect.stringMatching(/^[A-Z][a-z]+ \d+(, today)?$/)));
    expect(html).toBe(meals(false));
    expect(html).toBe(renderToStaticMarkup(createElement(MealsScreen, { timezone, date: null, onNavigate: () => undefined })));
  });
});
