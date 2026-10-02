import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { EmptyListCard as EmptyListCardType, ListsScreen as ListsScreenType, PinnedListCard as PinnedListCardType } from '../src/SharedListsPage';

// The Lists screen and Home's list card as the Wall first draws them, rendered to markup so that what is asserted is what the browser
// is given. They import the Supabase client, which is built on import and not used to draw: a placeholder URL and key are enough to load
// them (as tests/phone-settings.test.ts does for the phone's pages).

let ListsScreen: typeof ListsScreenType;
let PinnedListCard: typeof PinnedListCardType;
let EmptyListCard: typeof EmptyListCardType;
beforeAll(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', process.env['VITE_SUPABASE_ANON_KEY'] ?? 'placeholder-anon-key');
  ({ ListsScreen, PinnedListCard, EmptyListCard } = await import('../src/SharedListsPage'));
});

const words = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

describe("Home's list card with no list on the home screen", () => {
  const card = (lists: number) => renderToStaticMarkup(createElement(EmptyListCard, { lists, onOpenLists: () => undefined }));

  it('keeps its heading, "Lists", and says to add one on the phone when there is no list at all', () => {
    const html = card(0);
    expect(html).toMatch(/<h2[^>]*>Lists<\/h2>/);
    expect(words(html)).toContain('No lists yet. Add one on your phone.');
    // Nothing to open: there is no list to see, and nothing says to open a list that does not exist.
    expect(html).not.toContain('href="/lists"');
    expect(words(html)).not.toContain('open a list');
  });

  it('says to put one on the home screen when there are lists and none is, with the link to see them', () => {
    const html = card(3);
    expect(html).toMatch(/<h2[^>]*>Lists<\/h2>/);
    expect(words(html)).toContain('No list here yet. On your phone, open a list and choose Show on home screen.');
    expect(html).toContain('aria-label="All lists"');
  });

  it('says it in the one style every empty state has: 16 px in --muted-foreground', () => {
    for (const lists of [0, 3]) expect(card(lists)).toMatch(/<p class="text-base text-muted-foreground px-1">/);
  });
});

describe("Home's list card while it waits for the lists", () => {
  it('says "Loading" in the same style, with no heading before it knows which list it is', () => {
    const html = renderToStaticMarkup(createElement(PinnedListCard, { onOpenLists: () => undefined }));
    expect(html).toMatch(/<p class="text-base text-muted-foreground">Loading<\/p>/);
    expect(html).not.toContain('<h2');
  });
});

describe('the Lists screen', () => {
  const screen = () => renderToStaticMarkup(createElement(ListsScreen));

  it('takes the focus to its title when it opens, which it can: the title is reached by script and not by Tab', () => {
    expect(screen()).toMatch(/<h2 tabindex="-1" class="[^"]*">Lists<\/h2>/);
  });
});
