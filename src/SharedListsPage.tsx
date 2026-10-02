import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, Check, Circle } from 'lucide-react';
import { supabase } from './lib/supabase';
import {
  addItem,
  byPosition,
  clearCompleted,
  clearOptimistically,
  createList,
  crossOptimistically,
  deleteList,
  loadItems,
  loadLists,
  loadPinnedListId,
  movedIds,
  nextSortOrder,
  renameList,
  reorderItems,
  reorderLists,
  setCrossed,
  setPinnedList,
  type ListItem,
  type SharedList,
} from './lib/shared-lists';
import type { Household } from './lib/household';
import { useChangeTick, useRefetchOn } from './lib/change-feed';
import { createSyncedReader, type SyncedReader } from './lib/synced-reader';

// What each read here listens to. The pinned list is a column of the Household.
const ITEM_TABLES = ['list_items'] as const;
const ITEM_REFRESH_MS = 30_000;
const LIST_TABLES = ['shared_lists', 'households'] as const;

const field = 'w-full text-base';
const action = 'min-h-12 rounded-lg px-4 text-base font-medium';
const quiet = `${action} border border-border`;
const iconAction = 'inline-flex size-12 shrink-0 items-center justify-center rounded-lg border border-border';

// ---- Items of one list: the same on the wall's rail and on the phone --------------

type ItemsState = { items: ListItem[]; loaded: boolean; problem: string };

function useItems(listId: string) {
  const [state, setState] = useState<ItemsState>({ items: [], loaded: false, problem: '' });
  // The list this state belongs to, so a slow answer for the previous list is dropped.
  const current = useRef(listId);
  current.current = listId;

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

  async function add(text: string): Promise<boolean> {
    try {
      const created = await guarded(() => addItem(supabase, listId, text, nextSortOrder(state.items)));
      if (current.current === listId) setState((prev) => ({ ...prev, items: [...prev.items, created], problem: '' }));
      return true;
    } catch {
      fail('Could not add that item. Try again.');
      return false;
    }
  }

  async function toggle(item: ListItem) {
    const stuck = await guarded(() =>
      crossOptimistically(publish, item.id, item.crossed_at === null, state.items, () => setCrossed(supabase, item.id, item.crossed_at === null)),
    );
    fail(stuck ? '' : 'Could not update that item. It has been put back.');
  }

  async function clear() {
    const stuck = await guarded(() => clearOptimistically(publish, state.items, () => clearCompleted(supabase, listId)));
    fail(stuck ? '' : 'Could not clear completed items. They have been put back.');
  }

  async function move(id: string, offset: number) {
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

// The items of one list with the field that adds one and the button that clears the crossed ones. Given a
// `title` (the wall's rail) the list's name and that button share the top row instead of the button
// taking a row of its own below the items: beside Today's meals and the Routines, the rail has room
// for little else than the items, and the button's own row left it one.
function ListItems({ listId, reorderable, title }: { listId: string; reorderable: boolean; title?: string }) {
  const { items, loaded, problem, add, toggle, clear, move } = useItems(listId);
  const [text, setText] = useState('');
  const hasCrossed = items.some((item) => item.crossed_at !== null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim()) return;
    if (await add(text)) setText('');
  }

  const clearButton = (
    <button type="button" className={`${quiet} disabled:opacity-40${title === undefined ? '' : ' shrink-0'}`} disabled={!hasCrossed} onClick={() => void clear()}>
      Clear completed
    </button>
  );

  return (
    <div className={`flex min-h-0 flex-1 flex-col ${title === undefined ? 'gap-4' : 'gap-3'}`}>
      {title !== undefined && (
        <div className="flex items-center justify-between gap-3">
          <h2 className="min-w-0 truncate text-2xl font-semibold">{title}</h2>
          {clearButton}
        </div>
      )}
      <form onSubmit={(event) => void submit(event)} className="flex gap-2">
        <input
          className={field}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={200}
          placeholder="Add an item"
          aria-label="New item"
        />
        <button type="submit" className={`${action} bg-primary text-primary-foreground`}>
          Add
        </button>
      </form>

      {problem && (
        <p role="alert" className="text-base">
          {problem}
        </p>
      )}
      {loaded && items.length === 0 && !problem && <p className="text-base">Nothing on this list.</p>}

      <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {items.map((item, index) => {
          const crossed = item.crossed_at !== null;
          return (
            <li key={item.id} className="flex items-center gap-2">
              <button
                type="button"
                aria-pressed={crossed}
                onClick={() => void toggle(item)}
                className="flex min-h-12 flex-1 items-center gap-3 rounded-lg border border-border px-3 text-left text-lg"
              >
                {crossed ? <Check aria-hidden className="size-6 shrink-0" /> : <Circle aria-hidden className="size-6 shrink-0" />}
                <span className={crossed ? 'line-through decoration-2' : ''}>{item.text}</span>
              </button>
              {reorderable && (
                <>
                  <button type="button" className={iconAction} aria-label={`Move ${item.text} up`} disabled={index === 0} onClick={() => void move(item.id, -1)}>
                    <ArrowUp aria-hidden className="size-5" />
                  </button>
                  <button
                    type="button"
                    className={iconAction}
                    aria-label={`Move ${item.text} down`}
                    disabled={index === items.length - 1}
                    onClick={() => void move(item.id, 1)}
                  >
                    <ArrowDown aria-hidden className="size-5" />
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>

      {title === undefined && clearButton}
    </div>
  );
}

// ---- The wall ------------------------------------------------------------------------

// The pinned Shared List, on the home screen's right rail.
export function PinnedListRail() {
  const [pinned, setPinned] = useState<SharedList | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const changes = useChangeTick(LIST_TABLES);

  useEffect(() => {
    let live = true;
    Promise.all([loadPinnedListId(supabase), loadLists(supabase)])
      .then(([pinnedId, lists]) => {
        if (!live) return;
        setPinned(lists.find((list) => list.id === pinnedId) ?? null);
        setFailed(false);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [changes]);

  return (
    <aside aria-label="Pinned list" className="flex min-h-0 flex-col gap-4 rounded-3xl bg-card p-4">
      {pinned === undefined && !failed && <p className="text-base">Loading</p>}
      {failed && pinned === undefined && (
        <p role="alert" className="text-base">
          Could not load lists. Check your connection.
        </p>
      )}
      {pinned === null && <p className="text-base">No list is pinned. Pin one in settings on your phone.</p>}
      {pinned && <ListItems listId={pinned.id} reorderable={false} title={pinned.name} />}
    </aside>
  );
}

// The other Shared Lists, opened from the tablet. A Device can use them but not manage them.
export function WallListsScreen({ onClose }: { onClose: () => void }) {
  const [others, setOthers] = useState<SharedList[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<SharedList | null>(null);
  const dialog = useRef<HTMLDivElement>(null);

  // Focus moves into the dialog on open and back to what opened it on close; Escape closes.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => opener?.focus();
  }, []);

  const changes = useChangeTick(LIST_TABLES);
  useEffect(() => {
    let live = true;
    Promise.all([loadPinnedListId(supabase), loadLists(supabase)])
      .then(([pinnedId, lists]) => {
        if (!live) return;
        setOthers(lists.filter((list) => list.id !== pinnedId));
        setFailed(false);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [changes]);

  return (
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-labelledby="wall-lists-title"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        if (open) setOpen(null);
        else onClose();
      }}
      className="fixed inset-0 z-10 flex flex-col gap-6 bg-background p-8 outline-none"
    >
      <header className="flex items-center justify-between gap-4">
        <h2 id="wall-lists-title" className="text-3xl font-semibold">
          {open ? open.name : 'Lists'}
        </h2>
        <button type="button" className={quiet} onClick={open ? () => setOpen(null) : onClose}>
          {open ? 'Back to lists' : 'Close'}
        </button>
      </header>
      {failed && others === null && (
        <p role="alert" className="text-xl">
          Could not load lists. Check your connection.
        </p>
      )}
      {open ? (
        <ListItems listId={open.id} reorderable />
      ) : (
        <>
          {others?.length === 0 && <p className="text-xl">No other lists. Add one from your phone.</p>}
          <ul className="grid grid-cols-2 gap-4">
            {others?.map((list) => (
              <li key={list.id}>
                <button
                  type="button"
                  className="min-h-16 w-full rounded-xl border border-border px-4 text-left text-2xl"
                  // This button goes with the lists, taking focus with it: keep it in the dialog, so Escape still reaches it.
                  onClick={() => {
                    setOpen(list);
                    dialog.current?.focus();
                  }}
                >
                  {list.name}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// ---- The phone: manage lists (Household Account only) ---------------------------------

export function SharedListsPage({ household }: { household: Household }) {
  const [lists, setLists] = useState<SharedList[] | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [problem, setProblem] = useState('');
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [found, pinned] = await Promise.all([loadLists(supabase), loadPinnedListId(supabase)]);
      setLists(found);
      setPinnedId(pinned);
    } catch {
      setProblem('Could not load lists. Check your connection.');
    }
  }, []);
  useRefetchOn(LIST_TABLES, () => void refresh());

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Runs one change, then reloads so the screen shows what the database holds.
  async function change(work: () => Promise<void>, failure: string) {
    try {
      await work();
      setProblem('');
    } catch {
      setProblem(failure);
    }
    await refresh();
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!newName.trim()) return;
    await change(async () => {
      await createList(supabase, household.id, newName, nextSortOrder(lists ?? []));
      setNewName('');
    }, 'Could not create that list. Try again.');
  }

  async function rename(event: FormEvent) {
    event.preventDefault();
    if (!renaming || !renaming.name.trim()) return;
    const { id, name } = renaming;
    await change(async () => {
      await renameList(supabase, id, name);
      setRenaming(null);
    }, 'Could not rename that list. Try again.');
  }

  async function move(id: string, offset: number) {
    const ids = movedIds((lists ?? []).map((list) => list.id), id, offset);
    await change(() => reorderLists(supabase, ids), 'Could not reorder lists. Try again.');
  }

  async function remove(id: string) {
    setConfirming(null);
    if (open === id) setOpen(null);
    await change(() => deleteList(supabase, id), 'Could not delete that list. Try again.');
  }

  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col gap-6 p-4">
      <h1 className="text-2xl font-semibold">Shared Lists</h1>

      <form onSubmit={(event) => void create(event)} className="flex gap-2">
        <input className={field} value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={100} placeholder="New list name" aria-label="New list name" />
        <button type="submit" className={`${action} bg-primary text-primary-foreground`}>
          Create
        </button>
      </form>

      {problem && (
        <p role="alert" className="text-base">
          {problem}
        </p>
      )}
      {lists?.length === 0 && <p className="text-base">No lists yet.</p>}

      <ul className="flex flex-col gap-4">
        {lists?.map((list, index) => (
          <li key={list.id} className="flex flex-col gap-3 rounded-lg border border-border p-3">
            {renaming?.id === list.id ? (
              <form onSubmit={(event) => void rename(event)} className="flex gap-2">
                <input
                  className={field}
                  value={renaming.name}
                  onChange={(e) => setRenaming({ id: list.id, name: e.target.value })}
                  maxLength={100}
                  aria-label={`Name for ${list.name}`}
                  autoFocus
                />
                <button type="submit" className={`${action} bg-primary text-primary-foreground`}>
                  Save
                </button>
                <button type="button" className={quiet} onClick={() => setRenaming(null)}>
                  Cancel
                </button>
              </form>
            ) : (
              <p className="text-lg font-medium">
                {list.name}
                {list.id === pinnedId && <span className="ml-2 text-base font-normal">(pinned to the wall)</span>}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <button type="button" className={quiet} aria-expanded={open === list.id} onClick={() => setOpen(open === list.id ? null : list.id)}>
                {open === list.id ? 'Hide items' : 'Items'}
              </button>
              <button
                type="button"
                className={quiet}
                disabled={list.id === pinnedId}
                onClick={() => void change(() => setPinnedList(supabase, household.id, list.id), 'Could not pin that list. Try again.')}
              >
                {list.id === pinnedId ? 'Pinned' : 'Pin to wall'}
              </button>
              <button type="button" className={quiet} onClick={() => setRenaming({ id: list.id, name: list.name })}>
                Rename
              </button>
              <button type="button" className={iconAction} aria-label={`Move ${list.name} up`} disabled={index === 0} onClick={() => void move(list.id, -1)}>
                <ArrowUp aria-hidden className="size-5" />
              </button>
              <button
                type="button"
                className={iconAction}
                aria-label={`Move ${list.name} down`}
                disabled={index === lists.length - 1}
                onClick={() => void move(list.id, 1)}
              >
                <ArrowDown aria-hidden className="size-5" />
              </button>
              {confirming === list.id ? (
                <>
                  <button type="button" className={`${action} border-2 border-destructive bg-primary text-primary-foreground`} onClick={() => void remove(list.id)}>
                    Delete {list.name} and its items
                  </button>
                  <button type="button" className={quiet} onClick={() => setConfirming(null)}>
                    Keep it
                  </button>
                </>
              ) : (
                <button type="button" className={quiet} onClick={() => setConfirming(list.id)}>
                  Delete
                </button>
              )}
            </div>

            {open === list.id && <ListItems listId={list.id} reorderable />}
          </li>
        ))}
      </ul>
    </main>
  );
}
