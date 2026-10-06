import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PeopleStrip } from '../src/components/PeopleStrip';
import { createProfileFilter } from '../src/lib/profile-filter';
import type { Profile } from '../src/lib/profiles';
import type { RoutinesToday } from '../src/lib/use-routines-today';
import type { PhoneHome as PhoneHomeType } from '../src/phone/PhoneHome';

// The phone's Home rendered to markup (docs/specs/0004): its cards in order, the Today card's words, and the people strip's phone
// classes. The components import the Supabase client, which is built on import and not used to draw: a placeholder URL and key are
// enough to load them (as tests/phone-shell.test.ts does). How the column and the strip sit at 390 px is looked at in a browser.

let PhoneHome: typeof PhoneHomeType;
beforeAll(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', process.env['VITE_SUPABASE_ANON_KEY'] ?? 'placeholder-anon-key');
  ({ PhoneHome } = await import('../src/phone/PhoneHome'));
});
afterAll(() => {
  vi.unstubAllEnvs();
});

const noop = () => undefined;
const classesOf = (tag: string) => (/class="([^"]*)"/.exec(tag)?.[1] ?? '').replaceAll('&amp;', '&').replaceAll('&gt;', '>').split(' ');

const routines: RoutinesToday = { date: '2026-10-01', loaded: true, settled: true, failed: false, part: 'evening', problems: {}, groups: [], columns: [], done: new Set(), finished: new Set(), toggle: async () => true };

const home = (timezone: string | null) =>
  renderToStaticMarkup(
    createElement(PhoneHome, {
      route: { view: 'home' },
      timezone,
      view: { household: null, failed: false },
      added: 0,
      forecast: null,
      weatherOn: false,
      profiles: [],
      routines,
      openView: noop,
      openRoutines: noop,
      openLists: noop,
      openMeals: noop,
    }),
  );

describe('the phone Home', () => {
  it('is Today, Up next and the Pinned List, in that order, one card under another', () => {
    const html = home('America/Chicago');
    const at = ['aria-label="Today"', 'aria-label="Up next"', 'aria-label="Pinned list"'].map((part) => html.indexOf(part));
    expect(at.every((index) => index >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('draws the Today card as a 22 round card with its disc and "Today", and waits for the day to be read', () => {
    const html = home('America/Chicago');
    expect(classesOf(/<section aria-label="Today"[^>]*>/.exec(html)![0])).toEqual(expect.arrayContaining(['rounded-[22px]', 'bg-card', 'p-3']));
    expect(html).toMatch(/<h2[^>]*aria-label="Today, [A-Z][a-z]+, [A-Z][a-z]+ \d+"[^>]*>Today<\/h2>/);
    expect(html).toContain('bg-primary');
    expect(html).toContain('Loading');
  });

  it('keeps a frame that says Loading in place of the Today card until the Household is read, and still draws the other two', () => {
    const html = home(null);
    expect(html).not.toContain('aria-label="Today"');
    expect(html).toContain('aria-label="Calendar"');
    expect(html).toContain('aria-label="Up next"');
    expect(html).toContain('aria-label="Pinned list"');
  });

  it('draws the frame before the Household is read 22 round on a phone, like the cards', () => {
    expect(home(null)).toContain('<section aria-label="Calendar" class="rounded-3xl bg-card max-[768px]:rounded-[22px]">');
  });

  it('shows Up next at 22 round, and says no em-dash anywhere', () => {
    const html = home('America/Chicago');
    expect(html).toMatch(/aria-label="Up next" class="[^"]*max-\[768px\]:rounded-\[22px\]/);
    expect(html).not.toContain('—');
  });
});

describe('the people strip on a phone', () => {
  const profile = (id: string, name: string, sort: number, color: string): Profile => ({ id, name, color, avatar_url: null, sort_order: sort });
  const strip = (profiles: Profile[]) => renderToStaticMarkup(createElement(PeopleStrip, { profiles, routines, filter: createProfileFilter(), pressed: [] }));
  const family = [profile('p-a', 'Ava', 0, '#fcd34d'), profile('p-b', 'Ben', 1, '#6ee7b7')];
  const pills = (html: string) => [...html.matchAll(/<button\b[^>]*>/g)].map((match) => match[0]);

  it('is one row that scrolls sideways with no scroll bar, 52 tall', () => {
    const html = strip(family);
    const row = classesOf(html.slice(0, html.indexOf('>') + 1));
    expect(row).toEqual(expect.arrayContaining(['max-[768px]:overflow-x-auto', 'max-[768px]:h-13', 'max-[768px]:[scrollbar-width:none]']));
  });

  it('bleeds the row to the screen edge with the gutter as its own padding, so the last pill is cut at the screen edge', () => {
    const html = strip(family);
    expect(classesOf(html.slice(0, html.indexOf('>') + 1))).toEqual(expect.arrayContaining(['max-[768px]:-mx-4', 'max-[768px]:px-4', 'max-[768px]:scroll-px-4']));
  });

  it('keeps the row height while the Profiles are read, on a phone too, and gives Everyone a least width, not a fixed one', () => {
    expect(renderToStaticMarkup(createElement(PeopleStrip, { profiles: null, routines, filter: createProfileFilter(), pressed: [] }))).toContain('max-[768px]:h-13');
    const everyone = pills(strip(family))[0]!;
    expect(classesOf(everyone)).toEqual(expect.arrayContaining(['max-[768px]:min-w-[132px]']));
    expect(classesOf(everyone)).not.toContain('max-[768px]:w-[132px]');
  });

  it('has every pill 132 wide and 52 tall that does not shrink, Everyone first, and the name\'s minimum width gives way to it', () => {
    const [everyone, ...people] = pills(strip(family));
    expect(everyone).toContain('aria-pressed');
    expect(classesOf(everyone!)).toEqual(expect.arrayContaining(['max-[768px]:h-13', 'max-[768px]:min-w-[132px]']));
    expect(people).toHaveLength(2);
    for (const pill of people) {
      expect(classesOf(pill)).toEqual(expect.arrayContaining(['max-[768px]:h-13', 'max-[768px]:w-[132px]', 'max-[768px]:min-w-[132px]!', 'max-[768px]:flex-none']));
    }
  });

  it('draws a 36 px disc and shows the pips, and has no "More people" button below 768', () => {
    const html = strip(family);
    expect(html).toContain('max-[768px]:size-9!');
    expect(html).not.toContain('More people');
    const ava = family[0]!;
    const withRoutines: RoutinesToday = { ...routines, groups: [{ profile: ava, routines: [{ id: 'r1', profile_id: ava.id, title: 'Teeth', days_of_week: 127, time_of_day: null, sort_order: 0, archived_at: null, picture: null }] }] };
    const progress = renderToStaticMarkup(createElement(PeopleStrip, { profiles: family, routines: withRoutines, filter: createProfileFilter(), pressed: [] }));
    expect(progress).toContain('hidden @min-[9.6rem]:block max-[768px]:block');
    expect(progress).toContain('role="progressbar"');
  });

  it('puts no phone class on an element with an sm: or md: class of the same kind, which would win between 640 and 767 px', () => {
    for (const tag of strip(family).match(/<[a-z][^>]*>/g) ?? []) {
      const classes = classesOf(tag);
      if (classes.some((name) => name.startsWith('max-[768px]:'))) expect(classes.filter((name) => /^(sm|md|lg):/.test(name))).toEqual([]);
    }
  });
});
