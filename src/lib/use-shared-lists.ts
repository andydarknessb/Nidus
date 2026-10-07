import { useRef, useState } from 'react';
import { supabase } from './supabase';
import {
  addItem,
  byPosition,
  clearCompleted,
  loadItems,
  loadLists,
  loadPinnedListId,
  movedIds,
  nextSortOrder,
  reorderItems,
  setCrossed,
  withCrossed,
  withoutCrossed,
  type ListItem,
  type SharedList,
} from './shared-lists';
import { couldNotLoad, useSyncedRead } from './synced-read';
import { useFailureWords } from './use-failure-words';

// The Shared Lists' readers and writers as hooks, one for the Wall's cards and the phone's screens alike (SharedListsPage.tsx draws
// the tablet's, src/phone/PhoneLists.tsx the phone's). Both read through the synced read (synced-read.ts).

// What each read here listens to. The pinned list is a column of the Household.
const ITEM_TABLES = ['list_items'] as const;
export const LIST_TABLES = ['shared_lists', 'households'] as const;

// A row shown for an item the server has not stored yet has an id that says so ("pending-1"). It cannot be crossed off or moved
// until the stored row has taken its place, which is a moment.
const PENDING = 'pending-';
export const isPending = (item: ListItem) => item.id.startsWith(PENDING);

const NO_ITEMS: ListItem[] = [];

// One list's items. Adding, crossing off, clearing and moving show at once, as pending changes of the synced read: one that does not go
// through takes back only itself, and the card says why. What a write said stays until the next action; a read does not clear it.
export function useItems(listId: string) {
  const read = useSyncedRead(() => loadItems(supabase, listId), ITEM_TABLES, listId);
  const items = read.data ?? NO_ITEMS;
  const [said, setSaid] = useState<{ listId: string; problem: string }>({ listId, problem: '' });
  // What a write that did not go through says: the one vocabulary of the Wall and the phone (write-failure.ts).
  const failureWords = useFailureWords();
  // How many rows have been shown before the server answered, so that each has an id of its own.
  const pendings = useRef(0);
  // Said of this list only: a write that answers after another list was opened says nothing there.
  const fail = (problem: string) => setSaid({ listId, problem });
  const written = said.listId === listId ? said.problem : '';
  // Items already shown stay when a later read fails; the header says the connection is gone.
  const problem = written || (read.unread ? couldNotLoad('this list') : '');

  // Adding does not wait for the server: the item shows at once, as a row that is not stored yet, and the stored row takes its place
  // when the server has answered. If it cannot be added the row goes and the card says so. Returns the item as stored, or null when
  // it could not be.
  async function add(text: string): Promise<ListItem | null> {
    const pending: ListItem = { id: `${PENDING}${(pendings.current += 1)}`, list_id: listId, text: text.trim(), crossed_at: null, sort_order: nextSortOrder(items) };
    try {
      const created = await read.write(
        () => addItem(supabase, listId, text, pending.sort_order),
        (rows) => [...rows, pending],
        (stored) => (rows) => rows.map((row) => (row.id === pending.id ? stored : row)),
      );
      fail('');
      return created;
    } catch (error) {
      fail(failureWords(error));
      return null;
    }
  }

  async function toggle(item: ListItem) {
    if (isPending(item)) return;
    const crossed = item.crossed_at === null;
    try {
      await read.write(() => setCrossed(supabase, item.id, crossed), (rows) => withCrossed(rows, item.id, crossed));
      fail('');
    } catch (error) {
      fail(failureWords(error));
    }
  }

  async function clear() {
    try {
      await read.write(() => clearCompleted(supabase, listId), withoutCrossed);
      fail('');
    } catch (error) {
      fail(failureWords(error));
    }
  }

  async function move(id: string, offset: number) {
    if (items.some(isPending)) return;
    const ids = movedIds(items.map((item) => item.id), id, offset);
    try {
      await read.write(
        () => reorderItems(supabase, ids),
        (rows) => byPosition(ids.flatMap((itemId, index) => rows.filter((row) => row.id === itemId).map((row) => ({ ...row, sort_order: index })))),
      );
      fail('');
    } catch {
      // The old order is back at once; the read that follows the write replaces it with what the database holds (some of the writes
      // may have landed) once the connection allows. The words hold whether or not that read gets through, so they never claim what
      // is saved.
      fail('Could not reorder. The order may not be saved. Check your connection.');
    }
  }

  // Loaded once a read has landed, or the first one failed (the card then says so).
  return { items, loaded: read.data !== null || read.unread, problem, add, toggle, clear, move };
}

// Every Shared List and which one is pinned, read again when a list or the Household changes. `read` is null until the
// first read has landed; a read that fails after that keeps what is shown.
export function useLists(): { read: { lists: SharedList[]; pinnedId: string | null } | null; failed: boolean } {
  const read = useSyncedRead(
    async () => {
      const [pinnedId, lists] = await Promise.all([loadPinnedListId(supabase), loadLists(supabase)]);
      return { lists, pinnedId };
    },
    LIST_TABLES,
    'lists',
  );
  return { read: read.data, failed: read.failed };
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
