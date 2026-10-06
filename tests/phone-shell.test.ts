import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PhoneHeader as PhoneHeaderType, PhoneShell as PhoneShellType, PhoneTabs as PhoneTabsType } from '../src/components/PhoneShell';
import type { WallRoute } from '../src/lib/calendar-occurrences';
import { ChangeFeedContext } from '../src/lib/change-feed';
import type { ChangeFeed, Connection } from '../src/lib/realtime';
import type { Household } from '../src/lib/household';
import type { Forecast } from '../src/lib/weather';

// The phone's chrome rendered to markup (docs/specs/0004): the tab bar with its five tabs and the one that is current, the header
// with the gear for the Household Account and none for a Device, and Add event. The components import the Supabase client, which is
// built on import and not used to draw: a placeholder URL and key are enough to load them (as tests/wall-page.test.ts does).

let PhoneTabs: typeof PhoneTabsType;
let PhoneHeader: typeof PhoneHeaderType;
let PhoneShell: typeof PhoneShellType;
beforeAll(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', process.env['VITE_SUPABASE_ANON_KEY'] ?? 'placeholder-anon-key');
  ({ PhoneTabs, PhoneHeader, PhoneShell } = await import('../src/components/PhoneShell'));
});
afterAll(() => {
  vi.unstubAllEnvs();
});

const noop = () => undefined;
const CHICAGO = 'America/Chicago';
const words = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const classesOf = (tag: string) => (/class="([^"]*)"/.exec(tag)?.[1] ?? '').replaceAll('&amp;', '&').replaceAll('&gt;', '>').split(' ');

// Every button: its attributes and its words.
function buttons(html: string): { tag: string; words: string }[] {
  return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((match) => ({ tag: match[1]!, words: words(match[2]!) }));
}

const tabs = (route: WallRoute, timezone: string | null = CHICAGO) =>
  renderToStaticMarkup(createElement(PhoneTabs, { route, timezone, onOpen: noop, onHome: noop, onRoutines: noop, onMeals: noop, onLists: noop }));
// The words of the tabs that say they are current.
const current = (html: string) => buttons(html).filter((tab) => tab.tag.includes('aria-current="page"')).map((tab) => tab.words);

describe('the tab bar', () => {
  it('is the nav "Wall sections", fixed at the foot, with five tabs: Home, Calendar, Routines, Meals, Lists', () => {
    const html = tabs({ view: 'home' });
    expect(html).toMatch(/^<nav aria-label="Wall sections"/);
    expect(buttons(html).map((tab) => tab.words)).toEqual(['Home', 'Calendar', 'Routines', 'Meals', 'Lists']);
    expect(classesOf(html.slice(0, html.indexOf('>') + 1))).toEqual(expect.arrayContaining(['fixed', 'bottom-0', 'bg-card', 'border-t', 'gap-2']));
  });

  it('draws each tab 56 tall as an icon over its word, the icon hidden from a screen reader', () => {
    for (const tab of buttons(tabs({ view: 'home' }))) {
      expect(classesOf(tab.tag)).toEqual(expect.arrayContaining(['h-14', 'flex-col', 'flex-1']));
    }
    expect(tabs({ view: 'home' }).split('aria-hidden="true"').length - 1).toBe(5);
  });

  it.each([
    [{ view: 'home' }, ['Home']],
    [{ view: 'routines' }, ['Routines']],
    [{ view: 'meals', date: null }, ['Meals']],
    [{ view: 'lists' }, ['Lists']],
  ] as [WallRoute, string[]][])('marks only the current tab, aria-current="page", on %j', (route, expected) => {
    expect(current(tabs(route))).toEqual(expected);
  });

  it('marks Calendar current on Day, Week and Month', () => {
    for (const view of ['day', 'week', 'month'] as const) {
      expect(current(tabs({ view, date: '2026-10-01' })), view).toEqual(['Calendar']);
      expect(current(tabs({ view, date: null })), view).toEqual(['Calendar']);
    }
  });

  it('draws the current tab in the Selected look, which aria-current gives it', () => {
    expect(classesOf(buttons(tabs({ view: 'lists' }))[4]!.tag)).toEqual(expect.arrayContaining(['selected:bg-accent', 'selected:ring-2', 'selected:ring-foreground']));
  });

  it('switches Calendar off until the Household Timezone is known, as the rail does, and nothing else', () => {
    const waiting = buttons(tabs({ view: 'home' }, null)).map((tab) => tab.tag.includes(' disabled=""'));
    expect(waiting).toEqual([false, true, false, false, false]);
    expect(buttons(tabs({ view: 'home' })).some((tab) => tab.tag.includes(' disabled=""'))).toBe(false);
  });
});

const HOUSEHOLD: Household = { id: 'h1', name: 'The Andersons', timezone: CHICAGO, weather_place: 'Austin', latitude: 30, longitude: -97, temperature_unit: 'fahrenheit', appearance: 'auto' };
const FORECAST: Forecast = { current: { temperature: 72, code: 0, isDay: true }, days: [{ date: '2026-10-01', high: 81, low: 60, code: 0, sunrise: 0, sunset: 1 }] };
const header = (owner: boolean, household: Household | null = HOUSEHOLD) =>
  renderToStaticMarkup(createElement(PhoneHeader, { household, today: household ? '2026-10-01' : null, forecast: FORECAST, owner }));

// A change feed that says what it is told: the Realtime connection is the only thing here that is not the database, and a static
// render never opens one.
function feedThatIs(status: Connection): ChangeFeed {
  return { watch: () => () => undefined, status: () => status, onStatus: () => () => undefined, ready: Promise.resolve(), close: noop };
}
const HOUR = 3_600_000;
const NOW = Date.parse('2026-10-06T15:00:00Z');
const STALE = { accounts: [{ last_synced_at: new Date(NOW - 3 * HOUR - 600_000).toISOString(), created_at: '2026-01-01T00:00:00Z' }], now: NOW };
const withPills = (owner: boolean) =>
  renderToStaticMarkup(
    createElement(ChangeFeedContext.Provider, { value: feedThatIs('offline') }, createElement(PhoneHeader, { household: HOUSEHOLD, today: '2026-10-01', forecast: FORECAST, owner, sync: STALE })),
  );

describe('the phone header', () => {
  it('shows Offline and stale sync as compact pills when they would show on the tablet, the full words for a screen reader', () => {
    const html = withPills(true);
    // Offline: the icon and the word, with the rest of the sentence for a screen reader only.
    expect(html).toMatch(/<p role="status" data-pill="" class="[^"]*bg-muted[^"]*">[\s\S]*<span aria-hidden="true" class="[^"]*">Offline<\/span><span class="sr-only">Offline\. Showing the last update\.<\/span>/);
    // Stale sync: the icon and "3 h", the sentence for a screen reader only.
    expect(html).toMatch(/<span aria-hidden="true" class="[^"]*">3 h<\/span><span class="sr-only">Last synced 3 hours ago<\/span>/);
    // Both come before the gear, and the date is still there.
    expect(html.indexOf('Offline')).toBeLessThan(html.indexOf('3 h'));
    expect(html.indexOf('3 h')).toBeLessThan(html.indexOf('href="/settings"'));
    expect(html).toMatch(/<p class="font-display text-\[26px\][^"]*whitespace-nowrap">/);
  });

  it('shows neither pill while the Wall is online and nothing is behind', () => {
    const html = header(true);
    expect(html).not.toContain('Offline');
    expect(html).not.toContain('Last synced');
  });

  it('lets the name give way and never the date, and none of the pills shrink', () => {
    const html = withPills(false);
    expect(html).toMatch(/<h1 class="[^"]*truncate[^"]*\[contain:inline-size\]/);
    expect(html).toMatch(/<div class="flex min-w-min flex-1 flex-col">/);
    const pills = [...html.matchAll(/<p role="status" data-pill="" class="([^"]*)"/g)].map((match) => match[1]!).filter((classes) => classes.includes('bg-muted'));
    expect(pills).toHaveLength(2);
    for (const classes of pills) expect(classes).toContain('shrink-0');
  });

  it("is one 56 tall row: the Household's name over the date, then the weather now", () => {
    const html = header(true);
    expect(html).toMatch(/^<header/);
    expect(classesOf(html.slice(0, html.indexOf('>') + 1))).toEqual(expect.arrayContaining(['h-14', 'flex', 'items-center']));
    expect(html).toMatch(/<h1[^>]*>The Andersons<\/h1>/);
    // The name is the 13 px secondary words and the date is the display face at 26.
    expect(html).toContain('text-[13px]');
    expect(html).toContain('text-muted-foreground');
    expect(html).toContain('font-display text-[26px]');
    expect(html).toMatch(/aria-label="Clear, 72 degrees Fahrenheit, high 81, low 60"/);
    expect(html.indexOf('The Andersons')).toBeLessThan(html.indexOf('72'));
  });

  it('shows the gear to the Household Account, named "Settings", going where the rail\'s link goes, 48 px round', () => {
    const html = header(true);
    expect(html).toMatch(/<a [^>]*href="\/settings"[^>]*aria-label="Settings"|<a [^>]*aria-label="Settings"[^>]*href="\/settings"/);
    const link = /<a [^>]*>/.exec(html)![0];
    expect(classesOf(link)).toEqual(expect.arrayContaining(['size-12', 'rounded-full', 'bg-card']));
  });

  it('shows no gear to a Device, and nothing else that only the Household Account may open', () => {
    const html = header(false);
    expect(html).not.toContain('/settings');
    expect(html).not.toContain('Settings');
    expect(html).not.toContain('<a ');
  });

  it('has no clock and no next-meal button, for the Household Account and a Device alike', () => {
    for (const owner of [true, false]) {
      const html = header(owner);
      expect(html, `owner ${owner}`).not.toMatch(/\d{1,2}:\d{2}/);
      expect(html, `owner ${owner}`).not.toMatch(/\b(AM|PM)\b/);
      expect(buttons(html), `owner ${owner}`).toEqual([]);
      expect(words(html), `owner ${owner}`).not.toMatch(/meal|dinner|lunch|breakfast/i);
    }
  });

  it('draws the Household not read yet as the gear and what it shows of itself alone: no name, no date, no weather', () => {
    const html = header(true, null);
    expect(html).not.toContain('<h1');
    expect(html).not.toContain('role="img"');
    expect(html).toContain('href="/settings"');
  });

  it('keeps the Offline and stale-sync marks where the tablet has them, as live regions that are quiet while there is nothing to say', () => {
    const html = header(false);
    expect(html).toContain('role="status"');
    expect(html).toContain('sr-only');
  });

  it('says no em-dash', () => {
    expect(header(true)).not.toContain('—');
  });
});

describe('Add event', () => {
  const shell = (timezone: string | null) =>
    renderToStaticMarkup(
      createElement(PhoneShell, {
          owner: false,
          route: { view: 'home' },
          household: timezone ? { ...HOUSEHOLD, timezone } : null,
          today: timezone ? '2026-10-01' : null,
          forecast: null,
          strip: createElement('p', null, 'the strip'),
          onOpen: noop,
          onHome: noop,
          onRoutines: noop,
          onMeals: noop,
          onLists: noop,
          onAdd: noop,
          children: createElement('p', null, 'the screen'),
        }),
    );
  const add = (html: string) => buttons(html).find((button) => button.tag.includes('aria-label="Add event"'))!;

  it('is a 56 px round primary button named "Add event", for a Device as for the Household Account', () => {
    const html = shell(CHICAGO);
    expect(classesOf(add(html).tag)).toEqual(expect.arrayContaining(['size-14', 'rounded-full', 'bg-primary', 'fixed', 'right-4']));
    expect(add(html).tag).toContain('aria-haspopup="dialog"');
    expect(add(html).tag).not.toContain(' disabled=""');
    expect(html).toMatch(/bottom:calc\(4\.5rem \+ 1px \+ 1rem \+ env\(safe-area-inset-bottom\)\)/);
  });

  it('waits for the Household Timezone, as the rail does', () => {
    expect(add(shell(null)).tag).toContain(' disabled=""');
  });

  it('draws the header, then the column with the strip above the screen, then Add event and the tabs; the column leaves room at its foot', () => {
    const html = shell(CHICAGO);
    const order = ['<header', '<main', 'the strip', 'the screen', 'aria-label="Add event"', 'aria-label="Wall sections"'].map((part) => html.indexOf(part));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toMatch(/<main[^>]*padding-bottom:calc\(/);
    expect(html).toMatch(/<main[^>]*class="[^"]*px-4/);
  });
});
