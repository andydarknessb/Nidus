import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Occurrence } from '../src/lib/calendar-occurrences';
import { pageDays, pagingWindow } from '../src/lib/paged-view';
import type { Profile } from '../src/lib/profiles';
import { scheduleColumns } from '../src/lib/schedule';
import type { PagedCalendar as PagedCalendarType } from '../src/components/FiveDayCalendar';
import type { DayRows as DayRowsType } from '../src/components/Schedule';

// Week in portrait (docs/specs/0009, Week): seven rows, one a day, drawn from the same columns the landscape Week draws. A static render
// reads nothing, so the rows are given the columns a read would have built, and the Wall's own Week is rendered for the form it takes.
// The components import the Supabase client, which is built on import and not used to draw: a placeholder URL and key are enough to load them.

let DayRows: typeof DayRowsType;
let PagedCalendar: typeof PagedCalendarType;
beforeAll(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', process.env['VITE_SUPABASE_ANON_KEY'] ?? 'placeholder-anon-key');
  // Thursday, October 1, 2026, 7:21 PM in Chicago: the week is Sunday, September 27 to Saturday, October 3.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-02T00:21:00Z'));
  ({ DayRows } = await import('../src/components/Schedule'));
  ({ PagedCalendar } = await import('../src/components/FiveDayCalendar'));
});
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const CHICAGO = 'America/Chicago';
const NOW = new Date('2026-10-02T00:21:00Z');
const noop = () => undefined;
const ava: Profile = { id: 'a', name: 'Ava', color: '#93c5fd', avatar_url: null, sort_order: 0 };

let counter = 0;
function event(title: string, startsAt: string, endsAt: string): Occurrence {
  counter += 1;
  return { source: 'synced', id: `event-${counter}`, calendar_id: 'calendar-1', calendar_name: 'Family', title, description: null, location: null, starts_at: startsAt, ends_at: endsAt, is_all_day: false, profile_id: null, profile_ids: ['a'] };
}

// Two events on Thursday, October 1 (given out of order), one on Saturday, October 3, and nothing on the other days.
const WEEK = pageDays('week', '2026-09-27', CHICAGO, NOW);
const OCCURRENCES = [
  event('Piano', '2026-10-01T22:00:00Z', '2026-10-01T23:00:00Z'),
  event('Standup', '2026-10-01T14:00:00Z', '2026-10-01T14:30:00Z'),
  event('Soccer', '2026-10-03T15:00:00Z', '2026-10-03T16:00:00Z'),
];

function rows(weatherOn = false) {
  return renderToStaticMarkup(
    createElement(DayRows, { columns: scheduleColumns(OCCURRENCES, WEEK, NOW), profiles: [ava], pageWindow: pagingWindow(CHICAGO, NOW), onOpenDay: noop, onOpen: noop, forecast: null, weatherOn }),
  );
}
const sections = (html: string) => [...html.matchAll(/<section aria-label="([^"]*)" class="([^"]*)">([\s\S]*?)<\/section>/g)].map(([, label, classes, inside]) => ({ label: label!, classes: classes!, inside: inside! }));
const pillTitles = (html: string) => [...html.matchAll(/<button [^>]*data-pill[^>]*aria-label="([^"]*)"/g)].map(([, name]) => name!);

describe('Week as rows', () => {
  it('is seven rows, one a day in order, 12 px apart, each with its heading in a 9.6 rem column', () => {
    const html = rows();
    expect(html).toContain('flex flex-col gap-3');
    expect(sections(html).map((row) => row.label)).toEqual(['Sunday, September 27', 'Monday, September 28', 'Tuesday, September 29', 'Wednesday, September 30', 'Thursday, October 1, today', 'Friday, October 2', 'Saturday, October 3']);
    for (const row of sections(html)) {
      expect(row.inside).toMatch(/^<div class="w-\[9\.6rem\] flex-none"><h2[ >]/);
      expect(row.inside.match(/<h2[ >]/g)).toHaveLength(1);
    }
    expect(sections(html).map((row) => /data-day="([^"]*)"/.exec(row.inside)?.[1])).toEqual(WEEK.map((day) => day.date));
  });

  it("holds a day's pills beside its heading, in time order, 220 px wide and wrapping 8 px apart", () => {
    const [, , , , thursday, , saturday] = sections(rows());
    expect(thursday!.inside).toContain('class="flex min-w-0 flex-1 flex-wrap content-start gap-2"');
    expect(pillTitles(thursday!.inside)).toEqual([expect.stringContaining('Standup'), expect.stringContaining('Piano')]);
    expect(pillTitles(saturday!.inside)).toEqual([expect.stringContaining('Soccer')]);
    expect(thursday!.inside.match(/<div class="flex w-\[220px\] flex-none">/g)).toHaveLength(2);
    expect(thursday!.inside).toContain('min-h-13');
  });

  it('says nothing for an empty day', () => {
    const [sunday] = sections(rows());
    expect(pillTitles(sunday!.inside)).toEqual([]);
    expect(sunday!.inside).not.toMatch(/<p\b/);
    expect(sunday!.inside.replace(/<[^>]*>/g, '')).toBe('Sun27');
  });

  it("gives today's row the --muted ground and no other", () => {
    const grounded = sections(rows()).filter((row) => row.classes.split(' ').includes('bg-muted'));
    expect(grounded.map((row) => row.label)).toEqual(['Thursday, October 1, today']);
  });

  it('keeps a line for the weather under each heading while the Household has a place', () => {
    expect(rows(true).match(/<div class="flex h-\[18px\] items-center justify-center">/g)).toHaveLength(7);
    expect(rows()).not.toContain('h-[18px]');
  });

  it('is a column that scrolls', () => {
    expect(rows()).toMatch(/^<div class="min-h-0 flex-1 overflow-y-auto">/);
  });
});

describe('the Week page', () => {
  const week = (portrait?: boolean) => renderToStaticMarkup(createElement(PagedCalendar, { timezone: CHICAGO, view: 'week', date: null, onNavigate: noop, profiles: null, ...(portrait === undefined ? {} : { portrait }) }));

  it('draws seven rows in portrait, under the paging row, which is the same', () => {
    const html = week(true);
    expect(html.match(/<section aria-label="[^"]*" class="flex flex-none gap-2 /g)).toHaveLength(7);
    expect(html).not.toContain('grid-template-columns');
    expect(html.slice(0, html.indexOf('<section aria-label="Calendar"'))).toBe(week(false).slice(0, week(false).indexOf('<section aria-label="Calendar"')));
  });

  it.each([undefined, false])('draws seven columns otherwise (portrait %s)', (portrait) => {
    const html = week(portrait);
    expect(html).toContain('grid-template-columns:repeat(7, minmax(0, 1fr))');
    expect(html).not.toContain('9.6rem');
  });
});
