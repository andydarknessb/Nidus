import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { UpNext as UpNextType } from '../src/components/UpNext';
import type { Profile } from '../src/lib/profiles';
import { columnsOf, finishedProfiles, groupByProfile, todaysRoutines, type Routine } from '../src/lib/routines';
import type { RoutinesToday } from '../src/lib/use-routines-today';

// Up next as the Wall draws it on Home (docs/look.md, A Routine tile; spec 0003, Up next), rendered to markup so that what is asserted
// is what the browser is given. It imports the Supabase client, which is built on import and not used to draw: a placeholder URL and
// key are enough to load it.

let UpNext: typeof UpNextType;
beforeAll(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', process.env['VITE_SUPABASE_ANON_KEY'] ?? 'placeholder-anon-key');
  ({ UpNext } = await import('../src/components/UpNext'));
});

const profile = (id: string, name: string, sort: number, color: string): Profile => ({ id, name, color, avatar_url: null, sort_order: sort });
const routine = (id: string, profileId: string, title: string): Routine => ({ id, profile_id: profileId, title, days_of_week: 127, time_of_day: 'evening', picture: null, sort_order: 0, archived_at: null });

const CORY = profile('p-cory', 'Cory', 0, '#93c5fd');
const SAM = profile('p-sam', 'Sam', 1, '#f9a8d4');
const AVA = profile('p-ava', 'Ava', 2, '#fcd34d');
const FAMILY = [CORY, SAM, AVA];
const ROUTINES = [routine('r-bins', 'p-cory', 'Take out the bins'), routine('r-stretch', 'p-sam', 'Stretch'), routine('r-dog', 'p-ava', 'Feed the dog')];

// What the Wall's one reader hands Up next on Thursday, in the evening (weekday 4): every part of it from the pure builders.
function routinesToday(more: Partial<RoutinesToday> = {}, profiles: Profile[] = FAMILY, routines: Routine[] = ROUTINES): RoutinesToday {
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
const card = (today: RoutinesToday, failed = false, tiles?: number) =>
  renderToStaticMarkup(createElement(UpNext, { routines: today, failed, onOpenRoutines: () => undefined, ...(tiles === undefined ? {} : { tiles }) }));
// One tile: the button named for it, whole.
const tile = (html: string, name: string) => new RegExp(`<button[^>]*aria-label="${name}"[^>]*>[\\s\\S]*?</button>`).exec(html)?.[0] ?? '';
const words = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

describe("a person's tile", () => {
  it('names the Routine and the person, for a screen reader', () => {
    const html = card(routinesToday());
    for (const name of ['Mark Take out the bins done for Cory', 'Mark Stretch done for Sam', 'Mark Feed the dog done for Ava']) expect(tile(html, name), name).not.toBe('');
  });

  it("carries the person's initial before their name, so a child tells their tile from a sibling's by more than its colour and picture", () => {
    const sam = tile(card(routinesToday()), 'Mark Stretch done for Sam');
    // A 24 px disc with the initial (11 px, the smallest an initial may be), then the name, under the Routine's words.
    expect(sam).toMatch(/<span aria-hidden="true" class="person [^"]*bg-person-strong[^"]*" style="[^"]*width:24px;height:24px;font-size:11px">S<\/span>/);
    expect(words(sam)).toContain('Stretch S Sam');
    expect(sam.indexOf('>S</span>')).toBeLessThan(sam.indexOf('>Sam</span>'));
  });
});

describe('a tick that did not save', () => {
  const SAID = 'No internet, so that did not save. Try again soon.';
  const html = () => card(routinesToday({ problems: { 'p-sam': SAID } }));

  it('is said inside the tile, in place of the name line, so nothing under it moves from under a finger', () => {
    const sam = tile(html(), 'Mark Stretch done for Sam');
    expect(words(sam)).toContain(SAID);
    // The name line (the initial and the name) is what it takes the place of.
    expect(sam).not.toContain('>Sam</span>');
    expect(sam).not.toMatch(/>S<\/span>/);
    // The Routine's own words keep a line, and the tile is as tall as ever.
    expect(words(sam)).toContain('Stretch');
    expect(sam).toMatch(/class="[^"]*\bh-20\b/);
  });

  it("is not a line of its own between the tiles: the next person's tile is where it was", () => {
    const list = html();
    expect(list).not.toMatch(/<p role="alert" class="px-1/);
    // The other tiles are untouched: they still carry their person's initial and name.
    expect(words(tile(list, 'Mark ' + 'Feed the dog' + ' done for Ava'))).toContain('Feed the dog A Ava');
  });

  it("is still read out: a live region beside the tile, off screen, because a button's insides are not announced", () => {
    const list = html();
    expect(list).toContain(`<p role="alert" class="sr-only">${SAID}</p>`);
    // It is after the tile of the person it is about, and says nothing for the others.
    expect(list.indexOf('<p role="alert" class="sr-only">')).toBeGreaterThan(list.indexOf('Mark Stretch done for Sam'));
    expect(list.indexOf('<p role="alert" class="sr-only">')).toBeLessThan(list.indexOf('Mark Feed the dog done for Ava'));
    expect(list.match(/role="alert"/g)).toHaveLength(1);
  });

  it('says nothing at all when every tick saved', () => {
    const list = card(routinesToday());
    expect(list).not.toContain('role="alert"');
    expect(list).not.toContain('did not save');
  });
});

describe('when Up next has nothing to show', () => {
  // The words, and the one style every empty state has: 16 px in --muted-foreground (docs/look.md, Empty states).
  const said = (html: string, text: string) => new RegExp(`<p class="([^"]*)">${text}</p>`).exec(html)?.[1]?.split(' ');

  it('says nothing is scheduled when nobody has a Routine today', () => {
    const html = card(routinesToday({}, FAMILY, []));
    expect(said(html, 'Nothing scheduled today.')).toEqual(expect.arrayContaining(['px-1', 'text-base', 'text-muted-foreground']));
  });

  it('says nobody has anything left when every Routine is done', () => {
    const done = new Set(ROUTINES.map((each) => each.id));
    const html = card(routinesToday({ done }));
    expect(said(html, 'Nobody has anything left right now.')).toEqual(expect.arrayContaining(['px-1', 'text-base', 'text-muted-foreground']));
    expect(html).not.toContain('Mark ');
  });

  it('says "Loading" in the same style until the first read lands', () => {
    const html = card(routinesToday({ loaded: false }));
    expect(said(html, 'Loading')).toEqual(expect.arrayContaining(['px-1', 'text-base', 'text-muted-foreground']));
  });
});

describe('Up next while it loads', () => {
  // The height of the tiles it will show: 80 each and 8 between, 256 px (16 rem) for three and 168 px (10.5 rem) for two. Home's list
  // card under it would otherwise jump when the read lands.
  const reserved = (html: string) => /min-height:([0-9.]+)rem/.exec(html)?.[1];

  it('holds the height of three tiles until the first read has landed', () => {
    expect(reserved(card(routinesToday({ loaded: false })))).toBe('16');
    // Also when the read failed and nothing has been read: the card does not give the room up and take it back.
    expect(reserved(card(routinesToday({ loaded: false, failed: true }), true))).toBe('16');
  });

  it('holds the height of two tiles when the screen shows two', () => {
    expect(reserved(card(routinesToday({ loaded: false }), false, 2))).toBe('10.5');
    expect(reserved(card(routinesToday({ loaded: false, failed: true }), true, 2))).toBe('10.5');
  });

  it('takes the height it needs once it has: the tiles, or a line of words', () => {
    expect(reserved(card(routinesToday()))).toBeUndefined();
    expect(reserved(card(routinesToday({}, FAMILY, [])))).toBeUndefined();
  });

  it('keeps its heading row where it was, above the reserved room', () => {
    const html = card(routinesToday({ loaded: false }));
    expect(html.indexOf('Up next</h2>')).toBeLessThan(html.indexOf('min-height'));
  });
});
