import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { BeforeHousehold as BeforeHouseholdType } from '../src/WallPage';

// What the Wall draws before it has read its Household: the frame that stands in for a screen until then. Rendered to markup, so that
// what is asserted is what the browser is given. The page imports the Supabase client, which is built on import and not used to draw:
// a placeholder URL and key are enough to load it (as tests/lists-screen.test.ts does).

let BeforeHousehold: typeof BeforeHouseholdType;
beforeAll(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', process.env['VITE_SUPABASE_ANON_KEY'] ?? 'placeholder-anon-key');
  ({ BeforeHousehold } = await import('../src/WallPage'));
});

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
