import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { HomeRail as HomeRailType } from '../src/components/HomeRail';
import { homeGrid } from '../src/lib/home-layout';
import type { RoutinesToday } from '../src/lib/use-routines-today';

// Home in portrait (docs/specs/0009): the grid's classes and the rail as a row or a column, rendered to markup. The components import
// the Supabase client, which is built on import and not used to draw: a placeholder URL and key are enough to load them (as
// tests/phone-home.test.ts does). How the row sits at 920 by 1472 is looked at in a browser.

let HomeRail: typeof HomeRailType;
beforeAll(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', process.env['VITE_SUPABASE_ANON_KEY'] ?? 'placeholder-anon-key');
  ({ HomeRail } = await import('../src/components/HomeRail'));
});
afterAll(() => {
  vi.unstubAllEnvs();
});

const noop = () => undefined;
const classesOf = (tag: string) => (/class="([^"]*)"/.exec(tag)?.[1] ?? '').replaceAll('&amp;', '&').replaceAll('&gt;', '>').split(' ');
const routines: RoutinesToday = { date: '2026-10-01', loaded: true, settled: true, failed: false, part: 'evening', problems: {}, groups: [], columns: [], done: new Set(), finished: new Set(), toggle: async () => true };
const rail = (row: boolean) => renderToStaticMarkup(createElement(HomeRail, { routines, failed: false, tiles: 3, row, onOpenRoutines: noop, onOpenLists: noop }));
// The rail's own box, and the box that holds the Pinned List.
const box = (html: string) => classesOf(html.slice(0, html.indexOf('>') + 1));
const listCell = (html: string) => classesOf(html.slice(0, html.indexOf('<aside')).match(/<div[^>]*>(?=$)/)![0]);

describe('Home grid', () => {
  it('is the days beside the rail in landscape, as it always was', () => {
    expect(homeGrid(false)).toBe('grid min-h-0 grid-cols-[minmax(0,1fr)_min(20rem,max(320px,27vw))] gap-4');
  });

  it('is the days over the rail in portrait: the days take what is left of the height and the rail is as tall as Up next, and never under three tiles (21 rem)', () => {
    const classes = homeGrid(true).split(' ');
    expect(classes).toEqual(expect.arrayContaining(['grid', 'min-h-0', 'grid-cols-[minmax(0,1fr)]', 'grid-rows-[minmax(0,1fr)_minmax(21rem,auto)]', 'gap-4']));
    expect(classes.some((name) => name.startsWith('grid-cols-[minmax(0,1fr)_'))).toBe(false);
  });
});

describe('HomeRail', () => {
  it('as a column is Up next over the Pinned List, which takes the rest of the height', () => {
    const html = rail(false);
    expect(html.indexOf('aria-label="Up next"')).toBeGreaterThan(0);
    expect(html.indexOf('aria-label="Up next"')).toBeLessThan(html.indexOf('aria-label="Pinned list"'));
    expect(box(html)).toEqual(expect.arrayContaining(['flex', 'flex-col', 'gap-4', 'min-h-0']));
    expect(listCell(html)).toEqual(expect.arrayContaining(['grid', 'flex-1', 'grid-rows-[minmax(0,1fr)]']));
  });

  it('as a row is Up next at the left, 20 rem and no more than half, and the Pinned List beside it', () => {
    const html = rail(true);
    expect(html.indexOf('aria-label="Up next"')).toBeGreaterThan(0);
    expect(html.indexOf('aria-label="Up next"')).toBeLessThan(html.indexOf('aria-label="Pinned list"'));
    expect(box(html)).toEqual(expect.arrayContaining(['grid', 'grid-cols-[min(20rem,50%)_minmax(0,1fr)]', 'gap-4', 'min-w-0']));
    expect(box(html)).not.toContain('flex-col');
  });

  it('as a row sizes itself from Up next: the Pinned List fills its cell without giving it height, so a long list never grows the row', () => {
    const cell = listCell(rail(true));
    expect(cell).toEqual(expect.arrayContaining(['relative', 'min-w-0', '*:absolute', '*:inset-0']));
    expect(cell).not.toContain('flex-1');
  });
});
