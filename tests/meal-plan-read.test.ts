import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The first commit of a turned page: the synced read is only cleared once the page has drawn, so for one render useMealPlan is handed
// what the last week's read said. It must show none of it: not the Meals, and not a failure (a "could not load" alert would be announced
// for a read that was not this page's). Rendered with the synced read held at that stale state.

const tacos = { id: 'a', meal_date: '2026-10-08', slot: 'dinner', title: 'Tacos' };
const held = vi.hoisted(() => ({ state: null as unknown }));
vi.mock('../src/lib/synced-read', async (original) => ({
  ...(await original<typeof import('../src/lib/synced-read')>()),
  useSyncedRead: () => ({ ...(held.state as object), write: async () => undefined, refresh: () => undefined, readBack: async () => undefined }),
}));

const failedFor = (from: string) => Object.assign(new Error('The Meals were not read'), { from });
const timezone = 'America/Chicago';
let MealsScreen: typeof import('../src/MealsPage').MealsScreen;
let PhoneMeals: typeof import('../src/phone/PhoneMeals').PhoneMeals;
beforeAll(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', process.env['VITE_SUPABASE_ANON_KEY'] ?? 'placeholder-anon-key');
  vi.useFakeTimers({ toFake: ['Date'] });
  // Thursday, October 8, 2026, noon in Chicago: the week of the 4th is today's.
  vi.setSystemTime(new Date('2026-10-08T17:00:00Z'));
  ({ MealsScreen } = await import('../src/MealsPage'));
  ({ PhoneMeals } = await import('../src/phone/PhoneMeals'));
});
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const wall = (date: string | null) => renderToStaticMarkup(createElement(MealsScreen, { timezone, date, onNavigate: () => undefined }));
const phone = (date: string | null) =>
  renderToStaticMarkup(createElement(PhoneMeals, { route: { view: 'meals', date }, timezone, view: { failed: false } } as unknown as Parameters<typeof PhoneMeals>[0]));
const screens = { Wall: wall, phone };

describe.each(Object.entries(screens))('the %s, on the first commit of another week', (_name, screen) => {
  it("shows nothing of the last week's Meals, and the cells are not tappable", () => {
    held.state = { data: { from: '2026-10-04', meals: [tacos] }, failed: false, unread: false, error: null };
    const html = screen('2026-10-11');
    expect(html).not.toContain('Tacos');
    expect(html).not.toContain('nothing planned');
    expect(html).toContain('Loading');
  });

  it("does not say the last week's read failed", () => {
    held.state = { data: { from: '2026-10-04', meals: [tacos] }, failed: true, unread: false, error: failedFor('2026-10-04') };
    const html = screen('2026-10-11');
    expect(html).not.toContain('Could not load');
    expect(html).toContain('Loading');
  });

  it('does say it when this week’s first read failed', () => {
    held.state = { data: null, failed: true, unread: true, error: failedFor('2026-10-11') };
    const html = screen('2026-10-11');
    expect(html).toContain('Could not load meals. Check your connection.');
    expect(html).not.toContain('Loading');
  });

  it('shows this week’s Meals once they are read', () => {
    held.state = { data: { from: '2026-10-04', meals: [tacos] }, failed: false, unread: false, error: null };
    expect(screen(null)).toContain('Tacos');
  });
});
