import { useCallback, useEffect, useRef, useState } from 'react';
import { useChangeTick, useRefetchOn } from './change-feed';
import { supabase } from './supabase';
import {
  addItem,
  byPosition,
  clearCompleted,
  clearOptimistically,
  crossOptimistically,
  loadItems,
  loadLists,
  loadPinnedListId,
  movedIds,
  nextSortOrder,
  reorderItems,
  setCrossed,
  type ListItem,
  type SharedList,
} from './shared-lists';
import { createSyncedReader, type SyncedReader } from './synced-reader';
import { useFailureWords } from './use-failure-words';

// The Shared Lists' readers and writers as hooks, one for the Wall's cards and the phone's screens alike (SharedListsPage.tsx draws
// the tablet's, src/phone/PhoneLists.tsx the phone's).

// What each read here listens to. The pinned list is a column of the Household.
const ITEM_TABLES = ['list_items'] as const;
const ITEM_REFRESH_MS = 30_000;
export const LIST_TABLES = ['shared_lists', 'households'] as const;

type ItemsState = { items: ListItem[]; loaded: boolean; problem: string };

// A row shown for an item the server has not stored yet has an id that says so ("pending-1"). It cannot be crossed off or moved
// until the stored row has taken its place, which is a moment.
const PENDING = 'pending-';
export const isPending = (item: ListItem) => item.id.startsWith(PENDING);

// Runs `work` and notes in `why` what it failed with, which the words need: crossOptimistically and clearOptimistically say only
// whether the write stuck.
const noting = (why: { error?: unknown }, work: () => Promise<void>) => () =>
  work().catch((error: unknown) => {
    why.error = error;
    throw error;
  });

export function useItems(listId: string) {
  const [state, setState] = useState<ItemsState>({ items: [], loaded: false, problem: '' });
  // What a write that did not go through says: the one vocabulary of the Wall and the phone (write-failure.ts).
  const failureWords = useFailureWords();
  // The list this state belongs to, so a slow answer for the previous list is dropped.
  const current = useRef(listId);
  current.current = listId;
  // How many rows have been shown before the server answered, so that each has an id of its own.
  const pendings = useRef(0);

  const publish = useCallback((update: (rows: ListItem[]) => ListItem[]) => {
    setState((prev) => ({ ...prev, items: update(prev.items) }));
  }, []);
  const fail = (problem: string) => setState((prev) => ({ ...prev, problem }));

  // Reads and this screen's own writes take turns (see synced-reader.ts): a change another
  // device made while a tap is in flight is read once the tap has landed.
  const reader = useRef<SyncedReader | null>(null);

  useEffect(() => {
    setState({ items: [], loaded: false, problem: '' });
    const next = createSyncedReader(
      () => loadItems(supabase, listId),
      // The message of a failed write stays until the next action; a read does not clear it.
      (items) => setState((prev) => ({ items, loaded: true, problem: prev.problem })),
      // Items already shown stay when a later read fails; the header says the connection is gone.
      () => setState((prev) => (prev.loaded ? prev : { items: [], loaded: true, problem: 'Could not load this list. Check your connection.' })),
    );
    reader.current = next;
    next.refresh();
    // The backstop for a change missed while the connection was down.
    const id = setInterval(() => next.refresh(), ITEM_REFRESH_MS);
    return () => {
      next.dispose();
      clearInterval(id);
      reader.current = null;
    };
  }, [listId]);
  useRefetchOn(ITEM_TABLES, () => reader.current?.refresh());

  const guarded = <T,>(work: () => Promise<T>): Promise<T> => (reader.current ? reader.current.write(work) : work());

  // Adding does not wait for the server: the item shows at once, as a row that is not stored yet, and the stored row takes its
  // place when the server has answered. If it cannot be added the row goes and the card says so. Returns the item as stored, or
  // null when it could not be.
  async function add(text: string): Promise<ListItem | null> {
    const pending: ListItem = { id: `${PENDING}${(pendings.current += 1)}`, list_id: listId, text: text.trim(), crossed_at: null, sort_order: nextSortOrder(state.items) };
    publish((rows) => [...rows, pending]);
    try {
      const created = await guarded(() => addItem(supabase, listId, text, pending.sort_order));
      if (current.current === listId) setState((prev) => ({ ...prev, items: prev.items.map((row) => (row.id === pending.id ? created : row)), problem: '' }));
      return created;
    } catch (error) {
      if (current.current === listId) {
        setState((prev) => ({ ...prev, items: prev.items.filter((row) => row.id !== pending.id), problem: failureWords(error) }));
      }
      return null;
    }
  }

  async function toggle(item: ListItem) {
    if (isPending(item)) return;
    const why: { error?: unknown } = {};
    const stuck = await guarded(() =>
      crossOptimistically(publish, item.id, item.crossed_at === null, state.items, noting(why, () => setCrossed(supabase, item.id, item.crossed_at === null))),
    );
    fail(stuck ? '' : failureWords(why.error));
  }

  async function clear() {
    const why: { error?: unknown } = {};
    const stuck = await guarded(() => clearOptimistically(publish, state.items, noting(why, () => clearCompleted(supabase, listId))));
    fail(stuck ? '' : failureWords(why.error));
  }

  async function move(id: string, offset: number) {
    if (state.items.some(isPending)) return;
    const before = state.items;
    const ids = movedIds(before.map((item) => item.id), id, offset);
    publish((rows) => byPosition(ids.map((itemId, index) => ({ ...rows.find((row) => row.id === itemId)!, sort_order: index }))));
    try {
      await guarded(() => reorderItems(supabase, ids));
      fail('');
    } catch {
      // Put the old order back now; the read that follows the write replaces it with what the
      // database holds (some of the writes may have landed) once the connection allows.
      publish(() => before);
      // The words hold whether or not that read gets through, so they never claim what is saved.
      fail('Could not reorder. The order may not be saved. Check your connection.');
    }
  }

  return { ...state, add, toggle, clear, move };
}

// Every Shared List and which one is pinned, read again when a list or the Household changes. `read` is null until the
// first read has landed; a read that fails after that keeps what is shown.
export function useLists(): { read: { lists: SharedList[]; pinnedId: string | null } | null; failed: boolean } {
  const [read, setRead] = useState<{ lists: SharedList[]; pinnedId: string | null } | null>(null);
  const [failed, setFailed] = useState(false);
  const changes = useChangeTick(LIST_TABLES);

  useEffect(() => {
    let live = true;
    Promise.all([loadPinnedListId(supabase), loadLists(supabase)])
      .then(([pinnedId, lists]) => {
        if (!live) return;
        setRead({ lists, pinnedId });
        setFailed(false);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [changes]);

  return { read, failed };
}

// What a card's title is called on the page, so that focus can be put on it from the phone's list editor, which is not the component that
// draws the title.
export const titleId = (listId: string) => `title-${listId}`;

// After "Clear N crossed off" the button is gone, and focus with it. It goes to the card's title (tabIndex -1: reached by script, not by
// Tab), not to the field, which would raise a tablet's or a phone's keyboard; the next Tab lands on what follows the title. Focus does
// not scroll the page, so a long list on the phone stays where it is.
export function focusTitle(listId: string) {
  document.getElementById(titleId(listId))?.focus({ preventScroll: true });
}
