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
  it("gives the Month grid the height of a week's date and the line under it, for every week", () => {
    // A week is 2.625 rem for the date and 1.5 rem for the line under it (MonthCell.tsx), and the grid has a weekday row of 2.5 rem over its weeks.
    const html = renderToStaticMarkup(createElement(PagedCalendar, { timezone, view: 'month', date: null, onNavigate: () => undefined, profiles: null }));
    // The floor is there from the first pixel of larger text and not at 16 px, so a short screen at 16 px text is as it was.
    const rem = Number(/<section aria-label="Calendar" style="min-height:min\(([\d.]+)rem, calc\(\(1rem - 16px\) \* 1000\)\)"/.exec(html)?.[1]);
    expect([4, 5, 6].map((weeks) => 2.5 + weeks * 4.125)).toContain(rem);
    // At 16 px text a six-week month asks for 436 px, which the room under the people strip of a 1280 x 800 Wall (about 520) gives it.
    expect(2.5 + 6 * 4.125).toBeLessThan(520 / 16);
  });

  it("caps the Meals plan's slot column at larger text, so seven days keep their room, and keeps its 7 rem at 16 px", () => {
    const html = renderToStaticMarkup(createElement(MealsScreen, { timezone, date: null, onNavigate: () => undefined }));
    expect(html).toContain('grid-template-columns:min(7rem, max(112px, 11vw)) repeat(7, minmax(3rem, 1fr))');
  });
});
