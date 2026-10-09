import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ListCard as ListCardType } from '../src/components/ListCard';

// The Shared List card, rendered to markup in both sizes (the Wall's `card` and the phone's), so what is asserted is what the browser is
// given. It imports the Supabase client, which is built on import and not used to draw: a placeholder URL and key are enough to load it
// (as tests/phone-meals-lists.test.ts does).

// What the card's items hook says, set per test.
const hook = vi.hoisted(() => ({ items: null as null | { items: unknown[]; loaded: boolean; problem: string } }));
vi.mock('../src/lib/use-shared-lists', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/lib/use-shared-lists')>();
  const noop = async () => undefined;
  return { ...original, useItems: (listId: string) => (hook.items ? { ...hook.items, add: noop, toggle: noop, clear: noop } : original.useItems(listId)) };
});

let ListCard: typeof ListCardType;
let titleId: (listId: string) => string;
beforeAll(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', process.env['VITE_SUPABASE_ANON_KEY'] ?? 'placeholder-anon-key');
  ({ ListCard } = await import('../src/components/ListCard'));
  ({ titleId } = await import('../src/lib/use-shared-lists'));
});

const words = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

const list = { id: 'l-1', name: 'Groceries', sort_order: 0 };
const milk = { id: 'i-1', list_id: 'l-1', text: 'Milk', crossed_at: null, sort_order: 0 };
const eggs = { id: 'i-2', list_id: 'l-1', text: 'Eggs', crossed_at: '2026-10-09T08:00:00Z', sort_order: 1 };
const items = [milk, eggs];

type State = { items: unknown[]; loaded: boolean; problem: string };
const render = (size: 'card' | 'phone', state: State, props: { pinned?: boolean; portrait?: boolean } = {}) => {
  hook.items = state;
  try {
    return renderToStaticMarkup(createElement(ListCard, { list, size, pinned: props.pinned ?? false, portrait: props.portrait ?? false }));
  } finally {
    hook.items = null;
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
