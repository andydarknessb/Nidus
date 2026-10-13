import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Profile } from '../src/lib/profiles';
import type { RoutineChart } from '../src/lib/routine-chart';
import type { Routine, TimeOfDay } from '../src/lib/routines';
import type { PhoneRoutines as PhoneRoutinesType } from '../src/phone/PhoneRoutines';
import { chartOf, type SceneOptions } from './support/routine-chart';

// The phone's Routines tab, rendered to markup from the real Routine Chart. Who it opens on (the first in the people strip's order with
// something left in the part shown, else the first) and who it keeps is the chart's: tests/routine-chart.test.ts.

const profile = (id: string, sort: number): Profile => ({ id, name: id, color: '#93c5fd', avatar_url: null, sort_order: sort });
const routine = (id: string, profileId: string, timeOfDay: TimeOfDay | null): Routine => ({
  id,
  profile_id: profileId,
  title: id,
  days_of_week: 127,
  time_of_day: timeOfDay,
  picture: null,
  sort_order: 0,
  archived_at: null,
});

// The tab as the phone first draws it, rendered to markup. It imports the Supabase client, which is built on import and not used to
// draw: a placeholder URL and key are enough to load it (as tests/routines-chart.test.ts does).
let PhoneRoutines: typeof PhoneRoutinesType;
beforeAll(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', process.env['VITE_SUPABASE_ANON_KEY'] ?? 'placeholder-anon-key');
  ({ PhoneRoutines } = await import('../src/phone/PhoneRoutines'));
});

// What the Wall's one Routine Chart hands the screen on Thursday (weekday 4), in the evening, from the real core.
const routinesToday = (profiles: Profile[], routines: Routine[], done: string[] = [], more: Partial<SceneOptions> = {}): RoutineChart => chartOf({ profiles, routines, done, ...more });
const screen = (today: RoutineChart, timezone: string | null = 'America/Chicago') =>
  renderToStaticMarkup(createElement(PhoneRoutines, { timezone, view: { household: null, failed: false } as never, routines: today }));
const buttons = (html: string) => [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((match) => ({ tag: match[1]!, words: match[2]!.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() }));
const nameOf = (tag: string) => /aria-label="([^"]*)"/.exec(tag)?.[1];
const pressed = (tag: string) => /aria-pressed="(true|false)"/.exec(tag)?.[1];

describe('the phone Routines tab', () => {
  const people = [profile('ava', 0), profile('ben', 1), profile('cy', 2)];
  const routines = [
    routine('a1', 'ava', 'evening'),
    routine('a2', 'ava', 'evening'),
    routine('b1', 'ben', 'evening'),
    routine('b2', 'ben', 'evening'),
    routine('b3', 'ben', 'evening'),
  ];

  it("says each person's progress in words on their chip, and only people the chart has a column for", () => {
    // Cy has no Routine on any day, so the chart has no column for them.
    const html = screen(routinesToday(people, routines, ['a1', 'a2', 'b1']));
    const chips = buttons(html).filter((button) => nameOf(button.tag) !== undefined);
    expect(chips.map((chip) => [nameOf(chip.tag), chip.words])).toEqual([
      ['ava, 2 of 2 routines done', 'A ava All done'],
      ['ben, 1 of 3 routines done', 'B ben 1 of 3'],
    ]);
  });

  it('opens on the first person with something left, and presses their chip', () => {
    const html = screen(routinesToday(people, routines, ['a1', 'a2']));
    const chips = buttons(html).filter((button) => /ava|ben/.test(nameOf(button.tag) ?? ''));
    expect(chips.map((chip) => pressed(chip.tag))).toEqual(['false', 'true']);
    expect(html).toContain('aria-labelledby="routines-ben"');
    expect(html).not.toContain('aria-labelledby="routines-ava"');
  });

  it('opens on the first person when everyone is done', () => {
    const html = screen(routinesToday(people, routines, ['a1', 'a2', 'b1', 'b2', 'b3']));
    expect(html).toContain('aria-labelledby="routines-ava"');
  });

  it("draws the tablet's part-of-day control, on the part it is now, and the person's tiles 80 tall", () => {
    const html = screen(routinesToday(people, routines));
    const control = buttons(html).filter((button) => ['Morning', 'Afternoon', 'Evening', 'Whole day'].includes(button.words));
    expect(control.map((button) => [button.words, pressed(button.tag)])).toEqual([
      ['Morning', 'false'],
      ['Afternoon', 'false'],
      ['Evening', 'true'],
      ['Whole day', 'false'],
    ]);
    // Ava's two evening tiles, each the whole button at 80 tall.
    expect(html.match(/<button[^>]*class="[^"]*\bh-20\b/g)).toHaveLength(2);
  });

  it("shows the person's progress and what was done earlier, as the chart's column does", () => {
    const early = [routine('a1', 'ava', 'morning'), routine('a2', 'ava', 'evening')];
    const html = screen(routinesToday([profile('ava', 0)], early, ['a1']));
    expect(html).toContain('1 of 2 done');
    expect(html).toContain('1 done earlier today');
  });

  it('says what it holds when nobody has a Routine, and before the Household is read', () => {
    expect(screen(routinesToday(people, []))).toContain('No routines yet. The owner adds them in Settings.');
    expect(screen(routinesToday(people, routines), null)).toContain('Loading');
  });
});

describe('the phone Routines tab after Household midnight', () => {
  const people = [profile('ava', 0), profile('ben', 1)];
  const today = [routine('a1', 'ava', 'evening')];
  const unsettled = (read: { state: 'ready' | 'loading' | 'failed'; failed: boolean }) => routinesToday(people, today, [], { unsettled: true, failed: read.failed, readState: read.state });

  it('says "Loading" while the new day is read', () => {
    const html = screen(unsettled({ state: 'ready', failed: false }));
    expect(html).toContain('Loading');
    expect(html).not.toContain('Could not load');
  });

  it('with a failed read says it could not load routines, and shows the first person rather than "Loading" for ever', () => {
    const html = screen(unsettled({ state: 'ready', failed: true }));
    expect(html).toContain('Could not load routines. Check your connection.');
    expect(html).not.toContain('Loading');
  });
});
