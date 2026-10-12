import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Profile } from '../src/lib/profiles';
import { columnsOf, finishedProfiles, firstPick, groupByProfile, pickedPerson, routinesState, todaysRoutines, type ProfileRoutines, type Routine, type TimeOfDay } from '../src/lib/routines';
import type { RoutinesToday } from '../src/lib/use-routines-today';
import type { PhoneRoutines as PhoneRoutinesType } from '../src/phone/PhoneRoutines';

// The phone's Routines tab opens on one person: the first in the people strip's order with something left in the part shown, else the
// first. Pure, so it is tested here with no screen.

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
const column = (id: string, sort: number, routines: Routine[]): ProfileRoutines => ({ profile: profile(id, sort), routines });

describe('firstPick', () => {
  it('is nobody when there are no people', () => {
    expect(firstPick([], new Set(), 'morning')).toBeNull();
  });

  it('is the first person with something left in the part shown', () => {
    const columns = [
      column('ava', 0, [routine('a1', 'ava', 'morning')]),
      column('ben', 1, [routine('b1', 'ben', 'morning')]),
      column('cy', 2, [routine('c1', 'cy', 'morning')]),
    ];
    expect(firstPick(columns, new Set(['a1']), 'morning')).toBe('ben');
    expect(firstPick(columns, new Set(), 'morning')).toBe('ava');
  });

  it('is the first person when everyone is done, or has nothing today', () => {
    const columns = [column('ava', 0, [routine('a1', 'ava', 'morning')]), column('ben', 1, [])];
    expect(firstPick(columns, new Set(['a1']), 'morning')).toBe('ava');
    expect(firstPick([column('ben', 0, []), column('ava', 1, [])], new Set(), 'morning')).toBe('ben');
  });

  it('looks only at the part shown: a Routine of a later part is not left yet', () => {
    const columns = [column('ava', 0, [routine('a1', 'ava', 'evening')]), column('ben', 1, [routine('b1', 'ben', 'morning')])];
    expect(firstPick(columns, new Set(), 'morning')).toBe('ben');
    expect(firstPick(columns, new Set(), 'evening')).toBe('ava');
  });

  it('counts what is left from an earlier part, and Routines for any time', () => {
    const columns = [
      column('ava', 0, [routine('a1', 'ava', 'morning'), routine('a2', 'ava', 'evening')]),
      column('ben', 1, [routine('b1', 'ben', null)]),
    ];
    // Ava's evening is done, but her morning is left from earlier.
    expect(firstPick(columns, new Set(['a2']), 'evening')).toBe('ava');
    // Ava's morning is done and her evening is not in the afternoon; Ben's any-time Routine belongs to every part.
    expect(firstPick(columns, new Set(['a1']), 'afternoon')).toBe('ben');
  });

  it('looks at every Routine of the day on the whole day', () => {
    const columns = [column('ava', 0, [routine('a1', 'ava', 'morning')]), column('ben', 1, [routine('b1', 'ben', 'evening')])];
    expect(firstPick(columns, new Set(['a1']), 'whole')).toBe('ben');
    expect(firstPick(columns, new Set(), 'whole')).toBe('ava');
  });
});

// The tab as the phone first draws it, rendered to markup. It imports the Supabase client, which is built on import and not used to
// draw: a placeholder URL and key are enough to load it (as tests/routines-chart.test.ts does).
let PhoneRoutines: typeof PhoneRoutinesType;
beforeAll(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', process.env['VITE_SUPABASE_ANON_KEY'] ?? 'placeholder-anon-key');
  ({ PhoneRoutines } = await import('../src/phone/PhoneRoutines'));
});

// What the Wall's one reader hands the screen on Thursday (weekday 4), in the evening.
function routinesToday(profiles: Profile[], routines: Routine[], done: string[] = [], more: Partial<RoutinesToday> = {}): RoutinesToday {
  const groups = groupByProfile(profiles, todaysRoutines(routines, 4));
  const ticked = new Set(done);
  return {
    date: '2026-10-01',
    state: 'ready',
    settled: true,
    failed: false,
    part: 'evening',
    problems: {},
    groups,
    columns: columnsOf(profiles, routines, 4),
    done: ticked,
    finished: finishedProfiles(groups, ticked),
    toggle: () => Promise.resolve(true),
    ...more,
  };
}
const screen = (today: RoutinesToday, timezone: string | null = 'America/Chicago') =>
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

describe('pickedPerson', () => {
  const columns = [column('ava', 0, [routine('a1', 'ava', 'morning')]), column('ben', 1, [routine('b1', 'ben', 'morning')])];
  const base = { picked: null, columns, done: new Set<string>(), part: 'morning' as const, settled: true, failed: false };

  it('picks by the first-pick rule once today is read, and waits before that', () => {
    expect(pickedPerson({ ...base, done: new Set(['a1']) })).toBe('ben');
    expect(pickedPerson({ ...base, settled: false })).toBeNull();
  });

  it('is nobody when the chart has nobody', () => {
    expect(pickedPerson({ ...base, columns: [], settled: false, failed: true })).toBeNull();
    expect(pickedPerson({ ...base, columns: [] })).toBeNull();
  });

  it('keeps the person picked while they are on the chart', () => {
    expect(pickedPerson({ ...base, picked: 'ava', done: new Set(['a1']) })).toBe('ava');
  });

  it('does not yank the card from a person who finishes mid-use', () => {
    // Ava was picked with one thing left; ticking it leaves nobody with anything in the morning, and then Ben's is ticked too.
    expect(pickedPerson({ ...base, picked: 'ava', done: new Set(['a1']) })).toBe('ava');
    expect(pickedPerson({ ...base, picked: 'ava', done: new Set(['a1', 'b1']) })).toBe('ava');
  });

  it('keeps the person through a refetch, which brings the same people as new objects with new ticks', () => {
    const refetched = columns.map(({ profile, routines }) => ({ profile: { ...profile }, routines: [...routines] }));
    expect(pickedPerson({ ...base, picked: 'ben', columns: refetched, done: new Set(['b1']) })).toBe('ben');
  });

  it('keeps the person across Household midnight, when what was read is for another day and nothing is settled', () => {
    expect(pickedPerson({ ...base, picked: 'ben', settled: false })).toBe('ben');
    expect(pickedPerson({ ...base, picked: 'ben', settled: true })).toBe('ben');
  });

  it('picks again, by the rule, when the person leaves the chart', () => {
    const gone = [columns[1]!];
    expect(pickedPerson({ ...base, picked: 'ava', columns: gone })).toBe('ben');
    // And waits for today's ticks to be read, as the first pick does.
    expect(pickedPerson({ ...base, picked: 'ava', columns: gone, settled: false })).toBeNull();
  });

  it('with a failed read and nothing settled picks the first person, so the tab never waits on a read that is not coming', () => {
    expect(pickedPerson({ ...base, settled: false, failed: true })).toBe('ava');
    expect(pickedPerson({ ...base, picked: 'ben', settled: false, failed: true })).toBe('ben');
  });
});

// The Routines map their own `settled` onto the synced read's state (spec 0011): the Wall's `loaded` and the phone's `settled` are one.
describe('routinesState', () => {
  it('is the read\'s own state once what was read is for today', () => {
    expect(routinesState(true, { state: 'ready', failed: false })).toBe('ready');
    // Ready but the last read failed: what was read stays on screen, and the header says the connection is lost.
    expect(routinesState(true, { state: 'ready', failed: true })).toBe('ready');
  });

  it('is loading just after Household midnight, while what was read is for yesterday', () => {
    expect(routinesState(false, { state: 'ready', failed: false })).toBe('loading');
    expect(routinesState(false, { state: 'loading', failed: false })).toBe('loading');
  });

  it('stays failed when nothing for today is read and the read is failing', () => {
    expect(routinesState(false, { state: 'failed', failed: true })).toBe('failed');
    expect(routinesState(false, { state: 'ready', failed: true })).toBe('failed');
  });
});

describe('the phone Routines tab after Household midnight', () => {
  const people = [profile('ava', 0), profile('ben', 1)];
  const today = [routine('a1', 'ava', 'evening')];
  const unsettled = (read: { state: 'ready' | 'loading' | 'failed'; failed: boolean }) => routinesToday(people, today, [], { settled: false, failed: read.failed, state: routinesState(false, read) });

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
