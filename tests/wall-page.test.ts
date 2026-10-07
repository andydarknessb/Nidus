import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { BeforeHousehold as BeforeHouseholdType, PairingScreen as PairingScreenType, WallFrame as WallFrameType } from '../src/WallPage';
import { WallHeader } from '../src/components/WallHeader';

// The two screens the Wall draws before it has a Household: the frame that stands in for a screen until the Household is read, and the
// pairing screen of a tablet that has no Household yet. Rendered to markup, so that what is asserted is what the browser is given. The
// page imports the Supabase client, which is built on import and not used to draw: a placeholder URL and key are enough to load it
// (as tests/lists-screen.test.ts does).

let BeforeHousehold: typeof BeforeHouseholdType;
let PairingScreen: typeof PairingScreenType;
let WallFrame: typeof WallFrameType;
beforeAll(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', process.env['VITE_SUPABASE_ANON_KEY'] ?? 'placeholder-anon-key');
  // The pairing screen says where to go from the address the tablet is at.
  vi.stubGlobal('window', { location: { origin: 'https://nidus.example' } });
  ({ BeforeHousehold, PairingScreen, WallFrame } = await import('../src/WallPage'));
});
afterAll(() => {
  vi.unstubAllGlobals();
});

const words = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

describe('the frame that stands in for a screen until the Household is read', () => {
  const frame = (failed: boolean) => renderToStaticMarkup(createElement(BeforeHousehold, { label: 'Meals', failed, words: 'Could not load meals. Check your connection.' }));

  it('says "Loading" while the read is on its way, in the one style every empty state has', () => {
    const html = frame(false);
    expect(html).toMatch(/<p class="text-base text-muted-foreground p-4">Loading<\/p>/);
    expect(html).not.toContain('role="alert"');
  });

  it('says the screen\'s own words once the read has failed, and no longer says it is loading', () => {
    const html = frame(true);
    expect(html).toMatch(/<p role="alert"[^>]*>Could not load meals\. Check your connection\.<\/p>/);
    expect(html).not.toContain('Loading');
  });
});

describe('the pairing screen', () => {
  const screen = () => renderToStaticMarkup(createElement(PairingScreen, { pairing: { code: 'K7M2QX', expiresAt: new Date(Date.now() + 9 * 60_000) } }));

  it('has its title in the display face', () => {
    expect(screen()).toMatch(/<h1 class="font-display [^"]*">Pair this tablet<\/h1>/);
  });

  it('has its code in the display face, whose figures are lining and tabular, spaced out by letter-spacing, and in no monospace face', () => {
    const html = screen();
    const code = /<p class="([^"]*)">K7M2QX<\/p>/.exec(html);
    expect(code).not.toBeNull();
    const classes = (code?.[1] ?? '').split(' ');
    expect(classes).toContain('font-display');
    expect(classes.some((name) => name.startsWith('tracking-'))).toBe(true);
    // The space after the last letter is as much as the space before the first, so the code sits in the middle.
    expect(classes).toContain('pl-[0.2em]');
    expect(html).not.toContain('font-mono');
  });

  it('never breaks the sentence between "sign" and "in"', () => {
    const html = screen();
    expect(html).toContain('<span class="whitespace-nowrap">sign in,</span>');
    expect(words(html)).toContain('On your phone, open https://nidus.example/settings, sign in, and enter this code.');
  });

  it('keeps the way in for the owner of the household, on one line', () => {
    const html = screen();
    expect(html).toMatch(/<a href="\/settings" class="[^"]*whitespace-nowrap[^"]*">Own this household\? Sign in<\/a>/);
  });

  it('is drawn in tokens: no colour of its own', () => {
    expect(screen()).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(|\bbg-\w+-\d{2,3}\b|\btext-\w+-\d{2,3}\b/);
  });
});

describe("the Wall's frame", () => {
  const frame = () =>
    renderToStaticMarkup(
      createElement(WallFrame, {
        rail: createElement('nav', { 'aria-label': 'Wall sections' }),
        header: createElement(WallHeader, { household: null, today: null, forecast: null, onMeals: null }),
        children: createElement('section', { 'aria-label': 'Calendar' }),
      }),
    );

  it('has its header outside the one main, so the header is the page banner (a header inside a main is not)', () => {
    const html = frame();
    expect(html.match(/<main[ >]/g)).toHaveLength(1);
    expect(html.match(/<header[ >]/g)).toHaveLength(1);
    // The header is complete before the main opens, and the main holds the screen and not the rail.
    expect(html.indexOf('</header>')).toBeLessThan(html.indexOf('<main'));
    const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
    expect(main).toContain('aria-label="Calendar"');
    expect(main).not.toContain('<header');
    expect(main).not.toContain('Wall sections');
  });

  it('draws as it did: the rail, the header and the screen are grid items, the main having no box of its own', () => {
    const html = frame();
    expect(html).toMatch(/^<div class="grid h-svh grid-cols-\[6rem_minmax\(0,1fr\)\] grid-rows-\[auto_minmax\(0,1fr\)\] gap-4 p-4">/);
    expect(html).toMatch(/<main class="contents">/);
    expect(html.indexOf('Wall sections')).toBeLessThan(html.indexOf('<header'));
    expect(html.indexOf('<header')).toBeLessThan(html.indexOf('<main'));
  });
});
