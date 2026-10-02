import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { TOKENS } from '../src/lib/look';
import { MODE_KEY, OVERRIDE_KEY, nextBoundary, readLastMode, readOverride, resolveMode, writeLastMode, writeOverride, type ModeStore } from '../src/lib/mode';

// Every instant is written in UTC and every Household Timezone is named, so no test reads the machine's zone.
const at = (iso: string) => Date.parse(`${iso}Z`);
const CHICAGO = 'America/Chicago';

describe('resolveMode: Auto, with no sunrise and sunset to go on', () => {
  // 2026-10-01 in Chicago is on daylight time (UTC-5): 7:00 is 12:00 UTC and 19:00 is 00:00 UTC the next day.
  it('is light from 7:00 to 19:00 Household time and dark otherwise, changing over at the minute', () => {
    const mode = (iso: string) => resolveMode({ now: at(iso), timezone: CHICAGO });
    expect(mode('2026-10-01T11:59:59.999')).toBe('dark');
    expect(mode('2026-10-01T12:00:00.000')).toBe('light');
    expect(mode('2026-10-01T18:00:00')).toBe('light');
    expect(mode('2026-10-01T23:59:59.999')).toBe('light');
    expect(mode('2026-10-02T00:00:00.000')).toBe('dark');
    expect(mode('2026-10-02T09:00:00')).toBe('dark');
  });

  it("is in the Household Timezone, whatever zone the machine is in", () => {
    // 12:30 UTC is 7:30 in Chicago, 21:30 in Tokyo and 2:30 in Honolulu.
    const now = at('2026-10-01T12:30:00');
    expect(resolveMode({ now, timezone: CHICAGO })).toBe('light');
    expect(resolveMode({ now, timezone: 'Asia/Tokyo' })).toBe('dark');
    expect(resolveMode({ now, timezone: 'Pacific/Honolulu' })).toBe('dark');
    // 22:00 UTC the day before is 7:00 on Tokyo's wall clock.
    expect(resolveMode({ now: at('2026-09-30T22:00:00'), timezone: 'Asia/Tokyo' })).toBe('light');
    expect(resolveMode({ now: at('2026-09-30T21:59:59.999'), timezone: 'Asia/Tokyo' })).toBe('dark');
  });

  it('follows the clock across a daylight saving change: 7:00 and 19:00 move in UTC and not on the wall', () => {
    const mode = (iso: string) => resolveMode({ now: at(iso), timezone: CHICAGO });
    // Spring forward, Sunday 2026-03-08 (a 23 hour day): 7:00 is 12:00 UTC, not the 13:00 of the day before.
    expect(mode('2026-03-07T12:59:00')).toBe('dark');
    expect(mode('2026-03-07T13:00:00')).toBe('light');
    expect(mode('2026-03-08T11:59:00')).toBe('dark');
    expect(mode('2026-03-08T12:00:00')).toBe('light');
    expect(mode('2026-03-08T23:59:00')).toBe('light');
    expect(mode('2026-03-09T00:00:00')).toBe('dark');
    // Fall back, Sunday 2026-11-01 (a 25 hour day): 7:00 is 13:00 UTC, not the 12:00 of the day before.
    expect(mode('2026-10-31T11:59:00')).toBe('dark');
    expect(mode('2026-10-31T12:00:00')).toBe('light');
    expect(mode('2026-11-01T12:59:00')).toBe('dark');
    expect(mode('2026-11-01T13:00:00')).toBe('light');
    expect(mode('2026-11-02T00:59:00')).toBe('light');
    expect(mode('2026-11-02T01:00:00')).toBe('dark');
  });
});

describe('resolveMode: sunrise and sunset', () => {
  // Today's sunrise at 6:12 and sunset at 19:48 in Chicago.
  const sun = { sunrise: at('2026-10-01T11:12:00'), sunset: at('2026-10-02T00:48:00') };

  it('uses them in place of 7:00 and 19:00', () => {
    const mode = (iso: string) => resolveMode({ now: at(iso), timezone: CHICAGO, ...sun });
    expect(mode('2026-10-01T11:11:59.999')).toBe('dark');
    expect(mode('2026-10-01T11:12:00')).toBe('light');
    expect(mode('2026-10-01T12:00:00')).toBe('light');
    expect(mode('2026-10-02T00:47:59.999')).toBe('light');
    expect(mode('2026-10-02T00:48:00')).toBe('dark');
  });

  it('can be given one at a time, the other keeping its fallback hour', () => {
    // Sunrise given: 6:12 local, and the 19:00 default sunset.
    expect(resolveMode({ now: at('2026-10-01T11:30:00'), timezone: CHICAGO, sunrise: sun.sunrise })).toBe('light');
    expect(resolveMode({ now: at('2026-10-01T23:59:00'), timezone: CHICAGO, sunrise: sun.sunrise })).toBe('light');
    expect(resolveMode({ now: at('2026-10-02T00:00:00'), timezone: CHICAGO, sunrise: sun.sunrise })).toBe('dark');
    // Sunset given: 19:48 local, and the 7:00 default sunrise.
    expect(resolveMode({ now: at('2026-10-01T11:59:00'), timezone: CHICAGO, sunset: sun.sunset })).toBe('dark');
    expect(resolveMode({ now: at('2026-10-02T00:30:00'), timezone: CHICAGO, sunset: sun.sunset })).toBe('light');
  });
});

describe('resolveMode: the Appearance', () => {
  it('Light and Dark hold at any hour', () => {
    for (const iso of ['2026-10-01T04:00:00', '2026-10-01T18:00:00']) {
      expect(resolveMode({ now: at(iso), timezone: CHICAGO, appearance: 'light' })).toBe('light');
      expect(resolveMode({ now: at(iso), timezone: CHICAGO, appearance: 'dark' })).toBe('dark');
    }
  });

  it('Auto is the default', () => {
    expect(resolveMode({ now: at('2026-10-01T18:00:00'), timezone: CHICAGO, appearance: 'auto' })).toBe('light');
    expect(resolveMode({ now: at('2026-10-01T04:00:00'), timezone: CHICAGO })).toBe('dark');
  });
});

describe('resolveMode: the screen\'s override', () => {
  const noon = at('2026-10-01T18:00:00');
  const until = at('2026-10-02T00:00:00');

  it('wins until the instant it ends, over Auto, Light and Dark alike', () => {
    for (const appearance of ['auto', 'light', 'dark'] as const) {
      expect(resolveMode({ now: noon, timezone: CHICAGO, appearance, override: { mode: 'dark', until } })).toBe('dark');
      expect(resolveMode({ now: until - 1, timezone: CHICAGO, appearance, override: { mode: 'dark', until } })).toBe('dark');
    }
  });

  it('is gone at the instant it ends and after it, and the Appearance and the clock take over again', () => {
    expect(resolveMode({ now: until, timezone: CHICAGO, override: { mode: 'light', until } })).toBe('dark');
    expect(resolveMode({ now: until + 60_000, timezone: CHICAGO, override: { mode: 'light', until } })).toBe('dark');
    expect(resolveMode({ now: until, timezone: CHICAGO, appearance: 'light', override: { mode: 'dark', until } })).toBe('light');
    expect(resolveMode({ now: noon, timezone: CHICAGO, override: null })).toBe('light');
  });
});

describe('resolveMode: before the Household is known', () => {
  it('keeps the mode the screen last resolved, light when it has none', () => {
    expect(resolveMode({ now: at('2026-10-01T18:00:00'), timezone: null })).toBe('light');
    expect(resolveMode({ now: at('2026-10-01T18:00:00'), timezone: null, last: 'dark' })).toBe('dark');
    expect(resolveMode({ now: at('2026-10-01T04:00:00'), timezone: null, last: 'light' })).toBe('light');
  });

  it('is not moved by the Appearance, the override or the sun until the Household is read', () => {
    const until = at('2026-10-02T00:00:00');
    expect(resolveMode({ now: at('2026-10-01T18:00:00'), timezone: null, last: 'dark', appearance: 'light', override: { mode: 'light', until } })).toBe('dark');
  });
});

describe('nextBoundary: when the switch\'s override ends', () => {
  const boundary = (iso: string, more = {}) => nextBoundary({ now: at(iso), timezone: CHICAGO, ...more });

  it('is the next sunrise or sunset, 7:00 or 19:00 without them', () => {
    expect(boundary('2026-10-01T09:00:00')).toBe(at('2026-10-01T12:00:00'));
    expect(boundary('2026-10-01T12:00:00')).toBe(at('2026-10-02T00:00:00'));
    expect(boundary('2026-10-01T18:00:00')).toBe(at('2026-10-02T00:00:00'));
    expect(boundary('2026-10-02T00:00:00')).toBe(at('2026-10-02T12:00:00'));
    expect(boundary('2026-10-02T03:00:00')).toBe(at('2026-10-02T12:00:00'));
  });

  it("is the Household's 7:00 the next morning when it is after sunset, across a daylight saving change", () => {
    // Saturday 2026-03-07 at 20:00 in Chicago is 02:00 UTC: the next 7:00 is on daylight time, ten hours on.
    expect(boundary('2026-03-08T02:00:00')).toBe(at('2026-03-08T12:00:00'));
    // Saturday 2026-10-31 at 20:00 is 01:00 UTC on the 1st: the next 7:00 is on standard time, twelve hours on.
    expect(boundary('2026-11-01T01:00:00')).toBe(at('2026-11-01T13:00:00'));
  });

  it("is the sun's own instants when it has them, and the day's sunrise when it comes next", () => {
    const sun = { sunrise: at('2026-10-01T11:12:00'), sunset: at('2026-10-02T00:48:00') };
    expect(boundary('2026-10-01T10:00:00', sun)).toBe(sun.sunrise);
    expect(boundary('2026-10-01T15:00:00', sun)).toBe(sun.sunset);
    const nextSunrise = at('2026-10-02T11:13:00');
    expect(boundary('2026-10-02T01:00:00', { ...sun, nextSunrise })).toBe(nextSunrise);
  });

  it('is never before now', () => {
    for (const iso of ['2026-10-01T11:59:59.999', '2026-10-01T12:00:00', '2026-10-01T23:59:59.999', '2026-10-02T00:00:00']) {
      expect(boundary(iso)).toBeGreaterThan(at(iso));
    }
  });
});

// ---- What the screen keeps in localStorage ----------------------------------------------------

function fakeStore(initial: Record<string, string> = {}): ModeStore & { items: Map<string, string> } {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

// A store the browser will not let a page use (blocked site data): every use throws.
const blocked: ModeStore = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('SecurityError');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
};

describe('the mode a screen last resolved', () => {
  it('is light when nothing is stored, when what is stored is not a mode, and when there is no storage', () => {
    expect(readLastMode(fakeStore())).toBe('light');
    expect(readLastMode(fakeStore({ [MODE_KEY]: 'purple' }))).toBe('light');
    expect(readLastMode(null)).toBe('light');
    expect(readLastMode(blocked)).toBe('light');
  });

  it('comes back as it was kept', () => {
    const store = fakeStore();
    writeLastMode(store, 'dark');
    expect(readLastMode(store)).toBe('dark');
    writeLastMode(store, 'light');
    expect(readLastMode(store)).toBe('light');
  });

  it('is kept quietly when there is nowhere to keep it', () => {
    expect(() => writeLastMode(blocked, 'dark')).not.toThrow();
    expect(() => writeLastMode(null, 'dark')).not.toThrow();
  });
});

describe('the override a screen keeps', () => {
  const now = at('2026-10-01T18:00:00');
  const until = at('2026-10-02T00:00:00');

  it('comes back with the instant it ends, until that instant', () => {
    const store = fakeStore();
    writeOverride(store, { mode: 'dark', until });
    expect(readOverride(store, now)).toEqual({ mode: 'dark', until });
    expect(readOverride(store, until - 1)).toEqual({ mode: 'dark', until });
    expect(readOverride(store, until)).toBeNull();
    expect(readOverride(store, until + 1)).toBeNull();
  });

  it('is cleared when it is written as none', () => {
    const store = fakeStore();
    writeOverride(store, { mode: 'dark', until });
    writeOverride(store, null);
    expect(store.items.has(OVERRIDE_KEY)).toBe(false);
    expect(readOverride(store, now)).toBeNull();
  });

  it('is none when what is stored is not an override', () => {
    for (const stored of ['', 'not json', '{}', '{"mode":"purple","until":9999999999999}', '{"mode":"dark"}', '{"mode":"dark","until":"later"}', 'null', '[]']) {
      expect(readOverride(fakeStore({ [OVERRIDE_KEY]: stored }), now), stored).toBeNull();
    }
    expect(readOverride(fakeStore(), now)).toBeNull();
  });

  it('is none, and keeps quiet, when there is no storage', () => {
    expect(readOverride(null, now)).toBeNull();
    expect(readOverride(blocked, now)).toBeNull();
    expect(() => writeOverride(blocked, { mode: 'dark', until })).not.toThrow();
    expect(() => writeOverride(null, null)).not.toThrow();
  });

  it('stays on this screen: it is written to storage and to nothing else', () => {
    const store = fakeStore();
    writeOverride(store, { mode: 'light', until });
    expect([...store.items.keys()]).toEqual([OVERRIDE_KEY]);
  });
});

// ---- The script in index.html, which paints the mode before React does ---------------------------

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];

// Runs the page's inline script in a page that has what is given, and says what it set data-mode to (undefined when it set
// nothing, which leaves the page light), what it put in the color-scheme and theme-color metas, whether it threw, and which
// globals it left behind.
function paint({
  path,
  stored,
  prefersDark = false,
  storage = 'works',
  metas = 'present',
}: {
  path: string;
  stored?: string;
  prefersDark?: boolean;
  storage?: 'works' | 'blocked';
  metas?: 'present' | 'missing';
}) {
  const page: { mode?: string; metas: Record<string, string> } = { metas: {} };
  const sandbox: Record<string, unknown> = {
    location: { pathname: path },
    matchMedia: (query: string) => ({ matches: query === '(prefers-color-scheme: dark)' && prefersDark }),
    document: {
      documentElement: { setAttribute: (name: string, value: string) => void (name === 'data-mode' && (page.mode = value)) },
      querySelector: (selector: string) => {
        const meta = /name=["']?([\w-]+)/.exec(selector)?.[1];
        if (metas === 'missing' || meta === undefined) return null;
        return { setAttribute: (name: string, value: string) => void (name === 'content' && (page.metas[meta] = value)) };
      },
    },
  };
  if (storage === 'blocked') {
    Object.defineProperty(sandbox, 'localStorage', {
      get() {
        throw new Error('SecurityError');
      },
    });
  } else {
    sandbox.localStorage = fakeStore(stored === undefined ? {} : { [MODE_KEY]: stored });
  }
  const before = new Set(Object.keys(sandbox));
  let threw = false;
  try {
    runInNewContext(script!, sandbox);
  } catch {
    threw = true;
  }
  return { mode: page.mode, metas: page.metas, threw, leaked: Object.keys(sandbox).filter((key) => !before.has(key)) };
}

describe('the inline script in index.html', () => {
  it('is there, and the page starts light: no dark class, and the light page colour in its metas', () => {
    expect(script).toBeTruthy();
    expect(html).not.toMatch(/<html[^>]*class=/);
    expect(html).toContain(`<meta name="theme-color" content="${TOKENS.light.background}" />`);
    expect(html).toContain('<meta name="color-scheme" content="light" />');
  });

  it('paints the mode the Wall last resolved, light when it has none', () => {
    expect(paint({ path: '/', stored: 'dark' })).toMatchObject({ mode: 'dark', threw: false });
    expect(paint({ path: '/week', stored: 'light' })).toMatchObject({ mode: 'light', threw: false });
    expect(paint({ path: '/routines' })).toMatchObject({ mode: 'light', threw: false });
    expect(paint({ path: '/meals', stored: 'purple' })).toMatchObject({ mode: 'light', threw: false });
  });

  // So a dark reload does not show a light browser bar until React mounts and applyMode() catches up.
  it('sets the color-scheme and theme-color metas with the mode, the Wall and the phone alike', () => {
    expect(paint({ path: '/', stored: 'dark' }).metas).toEqual({ 'color-scheme': 'dark', 'theme-color': TOKENS.dark.background });
    expect(paint({ path: '/', stored: 'light' }).metas).toEqual({ 'color-scheme': 'light', 'theme-color': TOKENS.light.background });
    expect(paint({ path: '/settings', prefersDark: true }).metas).toEqual({ 'color-scheme': 'dark', 'theme-color': TOKENS.dark.background });
    expect(paint({ path: '/settings', prefersDark: false, stored: 'dark' }).metas).toEqual({ 'color-scheme': 'light', 'theme-color': TOKENS.light.background });
  });

  it('sets data-mode even when a meta element is missing', () => {
    expect(paint({ path: '/', stored: 'dark', metas: 'missing' })).toMatchObject({ mode: 'dark', threw: false, metas: {} });
  });

  it('keeps its variables to itself: it leaves no globals behind, whichever way it ends', () => {
    for (const options of [{ path: '/', stored: 'dark' }, { path: '/settings', prefersDark: true }, { path: '/', storage: 'blocked' as const }]) {
      expect(paint(options).leaked, JSON.stringify(options)).toEqual([]);
    }
  });

  it("paints the phone's pages from prefers-color-scheme, never from what the Wall stored", () => {
    for (const path of ['/settings', '/settings/', '/settings/routines', '/settings/events']) {
      expect(paint({ path, stored: 'light', prefersDark: true }).mode, path).toBe('dark');
      expect(paint({ path, stored: 'dark', prefersDark: false }).mode, path).toBe('light');
      expect(paint({ path, prefersDark: false }).mode, path).toBe('light');
    }
  });

  it("takes a path that only starts with the word settings for the Wall's", () => {
    expect(paint({ path: '/settingsx', stored: 'dark', prefersDark: false }).mode).toBe('dark');
  });

  it('leaves the page light, without throwing, when the browser will not give it localStorage', () => {
    expect(paint({ path: '/', storage: 'blocked' })).toMatchObject({ mode: undefined, threw: false, metas: {} });
  });

  it('still follows the phone when localStorage is blocked, since it never needed it there', () => {
    expect(paint({ path: '/settings', storage: 'blocked', prefersDark: true }).mode).toBe('dark');
  });
});
