import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ListCard as ListCardType } from '../src/components/ListCard';

// The Shared List card, rendered to markup in both sizes (the Wall's `card` and the phone's), so what is asserted is what the browser is
// given. It imports the Supabase client, which is built on import and not used to draw: a placeholder URL and key are enough to load it
// (as tests/phone-meals-lists.test.ts does).

// What the card's items and suggestions hooks say, set per test.
type Suggestions = { suggestions: unknown[]; problem: string; busy: boolean };
const hook = vi.hoisted(() => ({
  items: null as null | { items: unknown[]; loaded: boolean; problem: string },
  suggestions: null as null | Suggestions,
  shopper: null as null | { asking: boolean; answer: { outcome: string; count?: number } | null; key: number },
  lists: null as null | { lists: unknown[]; pinnedId: string | null },
}));
vi.mock('../src/lib/use-shared-lists', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/lib/use-shared-lists')>();
  const noop = async () => undefined;
  return {
    ...original,
    useItems: (listId: string) => (hook.items ? { ...hook.items, add: noop, toggle: noop, clear: noop } : original.useItems(listId)),
    useSuggestions: (listId: string) => (hook.suggestions ? { ...hook.suggestions, add: noop, dismiss: noop } : original.useSuggestions(listId)),
    useShopper: (listId: string) => (hook.shopper ? { ...hook.shopper, ask: async () => null } : original.useShopper(listId)),
    useLists: () => (hook.lists ? { read: hook.lists, state: 'ready' as const } : original.useLists()),
  };
});

let ListCard: typeof ListCardType;
let PinnedListCard: typeof import('../src/SharedListsPage').PinnedListCard;
let titleId: (listId: string) => string;
beforeAll(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', process.env['VITE_SUPABASE_ANON_KEY'] ?? 'placeholder-anon-key');
  ({ ListCard } = await import('../src/components/ListCard'));
  ({ PinnedListCard } = await import('../src/SharedListsPage'));
  ({ titleId } = await import('../src/lib/use-shared-lists'));
});

const words = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

const list = { id: 'l-1', name: 'Groceries', sort_order: 0 };
const milk = { id: 'i-1', list_id: 'l-1', text: 'Milk', crossed_at: null, sort_order: 0 };
const eggs = { id: 'i-2', list_id: 'l-1', text: 'Eggs', crossed_at: '2026-10-09T08:00:00Z', sort_order: 1 };
const items = [milk, eggs];
// What the shopper left on the list (List Suggestions): two, one with what Meals it is for.
const ground = { id: 's-1', list_id: 'l-1', text: 'Ground beef, 2 lb', for_meals: 'Tacos, Chili', sort_order: 0 };
const tortillas = { id: 's-2', list_id: 'l-1', text: 'Tortillas', for_meals: null, sort_order: 1 };
const waiting: Suggestions = { suggestions: [ground, tortillas], problem: '', busy: false };
const NONE: Suggestions = { suggestions: [], problem: '', busy: false };

type State = { items: unknown[]; loaded: boolean; problem: string };
const render = (
  size: 'card' | 'phone',
  state: State,
  props: { pinned?: boolean; portrait?: boolean; suggestions?: Suggestions; shopper?: NonNullable<typeof hook.shopper> } = {},
) => {
  hook.items = state;
  hook.suggestions = props.suggestions ?? NONE;
  hook.shopper = props.shopper ?? null;
  try {
    return renderToStaticMarkup(createElement(ListCard, { list, size, pinned: props.pinned ?? false, portrait: props.portrait ?? false }));
  } finally {
    hook.items = null;
    hook.suggestions = null;
    hook.shopper = null;
  }
};

describe.each(['card', 'phone'] as const)('the Shared List card, %s size', (size) => {
  const card = (state: State, props?: { pinned?: boolean; portrait?: boolean }) => render(size, state, props);

  it('says how many are left to get, in the count and the label, once the items are read', () => {
    const html = card({ items, loaded: true, problem: '' });
    expect(words(html)).toContain('1 to get');
    expect(html).toContain('aria-label="Groceries, 1 to get"');
  });

  it('says no count, and only the name in the label, before the items are read', () => {
    const html = card({ items: [], loaded: false, problem: '' });
    expect(words(html)).not.toContain('to get');
    expect(html).toContain('aria-label="Groceries"');
  });

  it('says no count, never "0 to get", when the last read or write failed', () => {
    for (const held of [[], items]) {
      const html = card({ items: held, loaded: true, problem: 'Could not save. Check your connection.' });
      expect(words(html)).not.toContain('to get');
      expect(html).toContain('aria-label="Groceries"');
    }
  });

  it('says "Nothing on this list." once an empty list is read, and not before or beside a problem', () => {
    expect(words(card({ items: [], loaded: true, problem: '' }))).toContain('Nothing on this list.');
    expect(words(card({ items: [], loaded: false, problem: '' }))).not.toContain('Nothing on this list.');
    expect(words(card({ items: [], loaded: true, problem: 'Could not load this list. Check your connection.' }))).not.toContain('Nothing on this list.');
    expect(words(card({ items, loaded: true, problem: '' }))).not.toContain('Nothing on this list.');
  });

  it('says what did not save in an alert, after the rows', () => {
    const html = card({ items, loaded: true, problem: 'Could not save. Check your connection.' });
    expect(html).toMatch(/<p role="alert"[^>]*>Could not save\. Check your connection\.<\/p>/);
    expect(html.indexOf('Milk')).toBeLessThan(html.indexOf('role="alert"'));
    expect(card({ items, loaded: true, problem: '' })).not.toContain('role="alert"');
  });

  it('names Clear for the items crossed off and the list, and draws it only when something is crossed off', () => {
    expect(card({ items, loaded: true, problem: '' })).toContain('aria-label="Clear 1 crossed off from Groceries"');
    expect(words(card({ items, loaded: true, problem: '' }))).toContain('Clear 1 crossed off');
    expect(card({ items: [milk], loaded: true, problem: '' })).not.toContain('Clear');
  });

  it('puts the focus Clear takes on the title: reached by script, not by Tab, with the id focusTitle looks for', () => {
    expect(card({ items, loaded: true, problem: '' })).toMatch(new RegExp(`<h3 id="${titleId(list.id)}" tabindex="-1" class="[^"]*">Groceries</h3>`));
  });

  it('marks the Pinned List in words, and no other', () => {
    expect(words(card({ items, loaded: true, problem: '' }, { pinned: true }))).toContain('On the home screen');
    expect(words(card({ items, loaded: true, problem: '' }))).not.toContain('On the home screen');
  });

  it('draws the add row and a row for every item', () => {
    const html = card({ items, loaded: true, problem: '' });
    expect(html).toContain('aria-label="Add an item to Groceries"');
    expect(html).toContain('>Milk<');
    expect(html).toContain('>Eggs<');
  });
});

describe.each(['card', 'phone'] as const)('the suggestions the shopper left, %s size', (size) => {
  const card = (state: State, props?: { suggestions?: Suggestions }) => render(size, state, props);
  const withItems = { items, loaded: true, problem: '' };

  it('draws them under a "Suggested from meals" heading, with what Meals each is for, and none "For null"', () => {
    const text = words(card(withItems, { suggestions: waiting }));
    expect(text).toContain('Suggested from meals');
    expect(text).toContain('Ground beef, 2 lb For Tacos, Chili');
    expect(text).toContain('Tortillas');
    expect(text).not.toContain('For null');
  });

  it('shows them on a list with no items yet', () => {
    expect(words(card({ items: [], loaded: true, problem: '' }, { suggestions: waiting }))).toContain('Suggested from meals');
  });

  it('names Add and Dismiss for the item and the list, each a 48 px control', () => {
    const html = card(withItems, { suggestions: waiting });
    expect(html).toContain('aria-label="Add Ground beef, 2 lb to Groceries"');
    expect(html).toContain('aria-label="Dismiss Ground beef, 2 lb"');
    expect(html).toContain('aria-label="Add Tortillas to Groceries"');
    expect((html.match(/h-12 w-12/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it('draws a suggestion as a dashed outline with no fill, never as an item is drawn', () => {
    const row = /<div class="([^"]*border-dashed[^"]*)"/.exec(card(withItems, { suggestions: waiting }))?.[1] ?? '';
    expect(row).toContain('border-[1.5px]');
    expect(row).toContain('border-input');
    expect(row).not.toMatch(/\bbg-/);
  });

  it('offers "Add all" with how many there are, and "Dismiss all", under the rows', () => {
    const text = words(card(withItems, { suggestions: waiting }));
    expect(text).toContain('Add all 2');
    expect(text).toContain('Dismiss all');
  });

  it('leaves the suggestions out of the count and the chip label', () => {
    const html = card(withItems, { suggestions: waiting });
    expect(words(html)).toContain('1 to get');
    expect(html).toContain('aria-label="Groceries, 1 to get"');
  });

  it('draws no group when nothing waits', () => {
    expect(card(withItems)).not.toContain('Suggested from meals');
  });

  it('says a suggestion write that did not go through at the foot, in its own alert', () => {
    const html = card(withItems, { suggestions: { suggestions: [ground], problem: 'Could not add. Check your connection.', busy: false } });
    expect(html).toMatch(/<p role="alert"[^>]*>Could not add\. Check your connection\.<\/p>/);
  });

  // A stale item failure must not hide a new suggestion failure: each is its own alert, so the new one is heard.
  it('says a failed item write and a failed suggestion write each in its own alert', () => {
    const html = card(
      { items, loaded: true, problem: 'Could not save. Check your connection.' },
      { suggestions: { suggestions: [ground], problem: 'Could not add. Check your connection.', busy: false } },
    );
    expect(html).toMatch(/<p role="alert"[^>]*>Could not save\. Check your connection\.<\/p>/);
    expect(html).toMatch(/<p role="alert"[^>]*>Could not add\. Check your connection\.<\/p>/);
  });
});

// "Suggest from meals" at the foot (spec 0019, ticket 3): its words in each state, and what the last answer says there.
describe.each(['card', 'phone'] as const)('the shopper at the foot of the card, %s size', (size) => {
  const loaded: State = { items, loaded: true, problem: '' };
  const shopper = (overrides: Partial<NonNullable<typeof hook.shopper>> = {}): NonNullable<typeof hook.shopper> => ({
    asking: false,
    answer: null,
    key: 0,
    ...overrides,
  });

  it('offers "Suggest from meals" with nothing waiting, and no line about replacing', () => {
    const html = render(size, loaded, { shopper: shopper() });
    expect(words(html)).toContain('Suggest from meals');
    expect(words(html)).not.toContain('This replaces');
  });

  it('says it replaces the waiting ones, and reads "Suggest again", once suggestions wait', () => {
    const html = render(size, loaded, { suggestions: waiting, shopper: shopper() });
    expect(words(html)).toContain('This replaces the 2 waiting.');
    expect(words(html)).toContain('Suggest again');
    expect(words(html)).not.toContain('Suggest from meals');
  });

  it('reads "Looking at your meals" and cannot be pressed while it waits', () => {
    const html = render(size, loaded, { shopper: shopper({ asking: true }) });
    expect(words(html)).toContain('Looking at your meals');
    expect(html).toContain('aria-disabled="true"');
  });

  it('says the outcome of an ask at the foot, in an alert', () => {
    const html = render(size, loaded, { shopper: shopper({ answer: { outcome: 'no-meals' }, key: 1 }) });
    expect(html).toMatch(/role="alert"[^>]*>No meals planned for the next 7 days\./);
  });

  it('says nothing at the foot for a suggestion (the status line says how many)', () => {
    const html = render(size, loaded, { shopper: shopper({ answer: { outcome: 'suggested', count: 2 }, key: 1 }) });
    expect(html).not.toContain('role="alert"');
  });

  it('draws it beside "Clear crossed off" when something is crossed off', () => {
    const html = render(size, { items: [...items], loaded: true, problem: '' }, { shopper: shopper() });
    expect(html).toMatch(/flex gap-2[^]*Suggest from meals[^]*Clear 1 crossed off/);
  });

  it.runIf(size === 'card')('draws the button 48 px tall on the Wall', () => {
    const html = render(size, loaded, { shopper: shopper() });
    expect(html).toMatch(/<button[^>]*h-12[^>]*>Suggest from meals/);
  });
});

describe("Home's pinned list card, with the suggestions it has", () => {
  const home = (suggestions: Suggestions) => {
    hook.lists = { lists: [list], pinnedId: list.id };
    hook.items = { items, loaded: true, problem: '' };
    hook.suggestions = suggestions;
    try {
      return renderToStaticMarkup(createElement(PinnedListCard, { onOpenLists: () => undefined }));
    } finally {
      hook.lists = null;
      hook.items = null;
      hook.suggestions = null;
    }
  };

  it('says how many suggestions wait, as a link to the Lists screen at that list', () => {
    const html = home(waiting);
    expect(words(html)).toContain('2 suggestions waiting');
    expect(html).toContain('aria-label="2 suggestions waiting in Groceries. All lists"');
  });

  it('says one suggestion waiting in the singular', () => {
    expect(words(home({ ...waiting, suggestions: [ground] }))).toContain('1 suggestion waiting');
  });

  it('says nothing about suggestions when none wait', () => {
    expect(home(NONE)).not.toContain('waiting in Groceries');
  });
});

describe('the Wall size', () => {
  const card = (portrait: boolean) => render('card', { items, loaded: true, problem: '' }, { portrait });

  it('is the section of the Wall: the snap width in landscape, its natural width in portrait', () => {
    expect(card(false)).toContain('w-(--card-w) shrink-0 snap-start');
    expect(card(false)).not.toContain('w-auto');
    expect(card(true)).toContain('w-auto shrink-0 snap-start');
    expect(card(true)).not.toContain('w-(--card-w)');
  });

  it('cuts a landscape title with an ellipsis and wraps a portrait one', () => {
    const title = (portrait: boolean) => /<h3 [^>]*class="([^"]*)"/.exec(card(portrait))?.[1]?.split(' ') ?? [];
    expect(title(true)).toContain('break-words');
    expect(title(true)).not.toContain('truncate');
    expect(title(false)).toContain('truncate');
    expect(title(false)).not.toContain('break-words');
  });

  it('scrolls its items inside a landscape card, with the overflow foot, and lets a portrait card be as tall as its items', () => {
    expect(card(false)).toContain('overflow-y-auto');
    expect(card(true)).not.toContain('overflow-y-auto');
  });

  it('draws a picture beside the name', () => {
    expect(card(false)).toContain('lucide-list');
  });
});

describe('the phone size', () => {
  const html = () => render('phone', { items, loaded: true, problem: '' });

  it('is a phone card: 22 round, 12 inside', () => {
    expect(html()).toContain('rounded-[22px]');
    expect(html()).not.toContain('snap-start');
  });

  it('draws no picture and no scrolling box of its own', () => {
    expect(html()).not.toContain('lucide-list');
    expect(html()).not.toContain('overflow-y-auto');
  });

  it('draws the 56 px add row', () => {
    expect(html()).toContain('h-14');
  });
});

describe('Sent to Target on the card', () => {
  const sentItem = (id: string, text: string, sent_at: string | null, crossed_at: string | null = null) => ({ id, list_id: 'l-1', text, crossed_at, sent_at, sort_order: 0 });
  const renderWith = (size: 'card' | 'phone', rows: unknown[], timezone: string | null) => {
    hook.items = { items: rows, loaded: true, problem: '' };
    try {
      return renderToStaticMarkup(createElement(ListCard, { list, size, pinned: false, timezone }));
    } finally {
      hook.items = null;
    }
  };
  // 22:02 UTC on 9 October 2026 is 5:02 PM in Chicago, where the Household is.
  const waiting = [sentItem('i-1', 'Milk', '2026-10-09T22:02:00Z'), sentItem('i-2', 'Eggs', '2026-10-09T21:00:00Z')];

  it.each(['card', 'phone'] as const)('says when the waiting items went, in the Household Timezone, and offers Got it (%s)', (size) => {
    const html = renderWith(size, waiting, 'America/Chicago');
    expect(words(html)).toContain('Sent to Target at 5:02 PM: 2 items');
    expect(words(html)).toContain('Got it');
  });

  it('says the count without a time while the Household is not read, and says "1 item" for one', () => {
    expect(words(renderWith('card', waiting, null))).toContain('Sent to Target: 2 items');
    expect(words(renderWith('card', [waiting[0]!], 'America/Chicago'))).toContain('Sent to Target at 5:02 PM: 1 item');
  });

  it('draws no sent line and no Got it when nothing is waiting', () => {
    const html = renderWith('card', [sentItem('i-3', 'Bread', null)], 'America/Chicago');
    expect(html).not.toContain('Sent to Target');
    expect(html).not.toContain('Got it');
  });

  it('offers Send to Target on the phone only, and only while an item is still to get', () => {
    expect(words(renderWith('phone', [sentItem('i-3', 'Bread', null)], 'America/Chicago'))).toContain('Send to Target');
    expect(renderWith('card', [sentItem('i-3', 'Bread', null)], 'America/Chicago')).not.toContain('Send to Target');
    expect(renderWith('phone', [sentItem('i-4', 'Milk', '2026-10-09T22:02:00Z', '2026-10-09T23:00:00Z')], 'America/Chicago')).not.toContain('Send to Target');
  });
});
