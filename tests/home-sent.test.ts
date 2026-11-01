import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { PinnedListCard as PinnedListCardType } from '../src/SharedListsPage';

// Home's Pinned List card, drawn to markup: "Sent to Target: {n}" and "Got it" while items wait for Got it, and neither otherwise
// (docs/specs/0019, "Home"). The card's reads are the test's: the Pinned List and its items.

const state = vi.hoisted(() => ({
  lists: null as null | { read: { lists: { id: string; name: string; sort_order: number }[]; pinnedId: string | null }; state: string },
  items: null as null | { items: unknown[]; loaded: boolean; problem: string },
}));
vi.mock('../src/lib/use-shared-lists', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/lib/use-shared-lists')>();
  const noop = async () => '';
  return {
    ...original,
    useLists: () => state.lists ?? original.useLists(),
    useItems: (listId: string) => (state.items ? { ...state.items, add: noop, toggle: noop, clear: noop, move: noop, markSent: noop, gotItems: noop, clearSends: noop } : original.useItems(listId)),
  };
});

let PinnedListCard: typeof PinnedListCardType;
beforeAll(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', process.env['VITE_SUPABASE_ANON_KEY'] ?? 'placeholder-anon-key');
  ({ PinnedListCard } = await import('../src/SharedListsPage'));
});

const groceries = { id: 'g-1', name: 'Groceries', sort_order: 0 };
const row = (id: string, text: string, sent_at: string | null, crossed_at: string | null = null) => ({ id, list_id: 'g-1', text, crossed_at, sent_at, sort_order: 0 });

const render = (items: unknown[]) => {
  state.lists = { read: { lists: [groceries], pinnedId: 'g-1' }, state: 'ready' };
  state.items = { items, loaded: true, problem: '' };
  try {
    return renderToStaticMarkup(createElement(PinnedListCard, { onOpenLists: () => undefined, limit: 6 }));
  } finally {
    state.lists = null;
    state.items = null;
  }
};

describe("Home's Pinned List card and Sent to Target", () => {
  it('says how many items wait for Got it, with a Got it button', () => {
    const html = render([row('a', 'Milk', '2026-10-09T21:00:00Z'), row('b', 'Eggs', '2026-10-09T21:00:00Z'), row('c', 'Bread', null)]);
    expect(html).toContain('Sent to Target: 2');
    expect(html).toContain('>Got it<');
  });

  it('draws neither while nothing waits, even with items to get', () => {
    const html = render([row('c', 'Bread', null), row('d', 'Milk', '2026-10-09T21:00:00Z', '2026-10-09T22:00:00Z')]);
    expect(html).not.toContain('Sent to Target');
    expect(html).not.toContain('Got it');
  });
});
