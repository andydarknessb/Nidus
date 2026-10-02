import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import { ArrowDown, ArrowUp, List, Pin, Plus } from 'lucide-react';
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
  pinnedFirst,
  renameList,
  reorderItems,
  reorderLists,
  rowsThatFit,
  setCrossed,
  setPinnedList,
  withoutCrossed,
  type ListItem,
  type SharedList,
} from './lib/shared-lists';
import type { Household } from './lib/household';
import { useChangeTick, useRefetchOn } from './lib/change-feed';
import { useStatusLine } from './lib/status-line';
import { createSyncedReader, type SyncedReader } from './lib/synced-reader';
import { EmptyRing, Tick } from './components/people';
import { Button } from './components/ui/button';

// What each read here listens to. The pinned list is a column of the Household.
const ITEM_TABLES = ['list_items'] as const;
const ITEM_REFRESH_MS = 30_000;
const LIST_TABLES = ['shared_lists', 'households'] as const;

// ---- Items of one list: the same on the wall's cards and on the phone --------------

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

  // The item that was added, as stored, or null when it could not be.
  async function add(text: string): Promise<ListItem | null> {
    try {
      const created = await guarded(() => addItem(supabase, listId, text, nextSortOrder(state.items)));
      if (current.current === listId) setState((prev) => ({ ...prev, items: [...prev.items, created], problem: '' }));
      return created;
    } catch {
      fail('Could not add that item. Try again.');
      return null;
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
    fail(stuck ? '' : 'Could not clear the crossed off items. They have been put back.');
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

// ---- The wall ------------------------------------------------------------------------

// Every Shared List and which one is pinned, read again when a list or the Household changes. `read` is null until the
// first read has landed; a read that fails after that keeps what is shown.
function useLists(): { read: { lists: SharedList[]; pinnedId: string | null } | null; failed: boolean } {
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

// The height of the element `ref` holds, measured when it is laid out and again whenever it changes. Null until then.
function useHeight(ref: RefObject<HTMLElement | null>): number | null {
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setHeight(element.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return height;
}

// The height of an item's row in each place, from the drawings: 52 px in a card on the Lists screen, 48 px on Home and
// 56 px on the phone, where every row is.
const ROW_HEIGHT = { card: 'h-13', home: 'h-12', phone: 'h-14' } as const;

// One item. The whole row is the button: a tap crosses the item off, another puts it back. To get, it is an empty ring;
// crossed off, a tick and struck-through words, so it never rests on colour alone.
function ItemRow({ item, size, onToggle }: { item: ListItem; size: keyof typeof ROW_HEIGHT; onToggle: () => void }) {
  const crossed = item.crossed_at !== null;
  const ring = size === 'home' ? 26 : 28;
  return (
    <button
      type="button"
      aria-pressed={crossed}
      onClick={onToggle}
      // The focus ring is drawn inside the row: its list scrolls, and a scrolling box clips what is drawn outside it.
      className={`flex w-full shrink-0 items-center gap-3 rounded-[14px] bg-muted px-3 text-left text-[17px] transition-[transform,background-color] duration-75 select-none focus-visible:-outline-offset-2 active:translate-y-0.5 active:bg-accent ${ROW_HEIGHT[size]}`}
    >
      {crossed ? <Tick size={ring} /> : <EmptyRing size={ring} width={2.5} />}
      <span className={`min-w-0 flex-1 truncate ${crossed ? 'text-muted-foreground line-through' : ''}`}>{item.text}</span>
    </button>
  );
}

// The field that adds an item, and its button: 52 px on the Wall, 56 on the phone. `onAdd` says whether the item was added,
// and the field empties when it was.
function AddRow({ listName, size = 'wall', onAdd }: { listName: string; size?: 'wall' | 'phone'; onAdd: (text: string) => Promise<boolean> }) {
  const [text, setText] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim()) return;
    if (await onAdd(text)) setText('');
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex shrink-0 gap-2">
      <input
        className={`min-w-0 flex-1 text-[17px] ${size === 'phone' ? 'h-14' : ''}`}
        value={text}
        onChange={(event) => setText(event.target.value)}
        maxLength={200}
        placeholder="Add an item"
        aria-label={`Add an item to ${listName}`}
      />
      <Button type="submit" variant="secondary" size={size} aria-label={`Add to ${listName}`} className={size === 'phone' ? 'w-14 px-0' : 'w-13 px-0'}>
        <Plus aria-hidden className="size-6" strokeWidth={2.6} />
      </Button>
    </form>
  );
}

// The mark on the Pinned List, on the Wall's card and on the phone's.
function PinnedMark() {
  return (
    <p className="flex h-8 shrink-0 items-center gap-2 self-start rounded-full bg-muted px-3 text-sm text-muted-foreground">
      <Pin aria-hidden className="size-4" />
      On the home screen
    </p>
  );
}

// ---- The Lists screen: a card for every list ----------------------------------------------

// One Shared List as a card: its picture, name and how many items are left to get, whether it is the Pinned List, the field
// that adds an item, then its items, which scroll inside the card when the card is shorter than the list. A card is as tall as
// its items, up to the height of the screen. Items are crossed off here and cleared; reordering is for the phone.
function ListCard({ list, pinned }: { list: SharedList; pinned: boolean }) {
  const { items, loaded, problem, add, toggle, clear } = useItems(list.id);
  const crossed = items.length - withoutCrossed(items).length;
  const rows = useRef<HTMLUListElement>(null);
  // How many items have been added here. The one just added is last: bring it into view when the list is longer than the card.
  // ponytail: "last" holds while a new item always goes to the bottom (nextSortOrder); find it by id if one ever lands elsewhere.
  const [added, setAdded] = useState(0);
  useEffect(() => {
    if (added > 0) rows.current?.lastElementChild?.scrollIntoView({ block: 'nearest' });
  }, [added]);

  return (
    <section aria-label={list.name} className="flex max-h-full w-(--card-w) shrink-0 snap-start flex-col gap-2 rounded-3xl bg-card p-3.5">
      <div className="flex h-13 shrink-0 items-center gap-3">
        {/* One picture for every list: there is no picture on a Shared List to choose. */}
        <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-full bg-muted">
          <List className="size-[22px]" />
        </span>
        <h3 className="min-w-0 flex-1 truncate font-display text-2xl leading-[30px]">{list.name}</h3>
        {loaded && <span className="shrink-0 text-[15px] text-muted-foreground">{items.length - crossed} to get</span>}
      </div>
      {pinned && <PinnedMark />}
      <AddRow
        listName={list.name}
        onAdd={async (text) => {
          const item = await add(text);
          if (item) setAdded((count) => count + 1);
          return item !== null;
        }}
      />
      {problem && (
        <p role="alert" className="shrink-0 text-base">
          {problem}
        </p>
      )}
      {loaded && items.length === 0 && !problem && <p className="shrink-0 text-base">Nothing on this list.</p>}
      {items.length > 0 && (
        <ul ref={rows} className="flex min-h-0 flex-col gap-2 overflow-y-auto">
          {items.map((item) => (
            <li key={item.id} className="shrink-0">
              <ItemRow item={item} size="card" onToggle={() => void toggle(item)} />
            </li>
          ))}
        </ul>
      )}
      {crossed > 0 && (
        <Button variant="secondary" className="h-12 w-full shrink-0 rounded-[14px]" onClick={() => void clear()}>
          Clear {crossed} crossed off
        </Button>
      )}
    </section>
  );
}

// The Wall's Lists screen: every Shared List as a card, the Pinned List first. Three cards fill the screen's width. With more,
// the fourth shows in part and the row scrolls sideways, so a list is never left off the screen with no sign of it, and each card
// still scrolls its own items up and down.
export function ListsScreen() {
  const { read, failed } = useLists();
  const cards = read ? pinnedFirst(read.lists, read.pinnedId) : [];

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <div className="flex h-13 shrink-0 items-center justify-between gap-4">
        <h2 className="font-display text-[30px] leading-9">Lists</h2>
        <p className="text-[15px] text-muted-foreground">New lists are made on the phone.</p>
      </div>
      {failed && read === null && (
        <p role="alert" className="text-xl">
          Could not load lists. Check your connection.
        </p>
      )}
      {read?.lists.length === 0 && <p className="text-xl">No lists yet. Add one from your phone.</p>}
      <div
        className={`flex min-h-0 flex-1 snap-x snap-mandatory items-start gap-4 overflow-x-auto ${cards.length > 3 ? '[--card-w:calc((100%_-_3rem)/3.2)]' : '[--card-w:calc((100%_-_2rem)/3)]'}`}
      >
        {cards.map((list) => (
          <ListCard key={list.id} list={list} pinned={list.id === read?.pinnedId} />
        ))}
      </div>
    </div>
  );
}

// ---- Home's card: the Pinned List -----------------------------------------------------

// From the drawing (v2/home.js): a row is 48 px (h-12) and rows are 8 px apart (gap-2). "And N more" is a button, so it is 48 px
// as well, where the drawing's line of words is 20: nothing a finger taps is smaller.
// ponytail: these sit beside the classes they stand for and are not measured; if a larger text size (#69) ever grows a row,
// measure the first row instead.
const HOME_ROW_PX = 48;
const HOME_GAP_PX = 8;
const HOME_MORE_PX = 48;
const HOME_CARD = 'flex min-h-0 flex-1 flex-col gap-2 rounded-3xl bg-card p-3';

// The Pinned List's card: it is as tall as the right rail leaves it, and shows the items still to get that fit under its field
// (rowsThatFit), then "and N more", which opens the Lists screen. Crossed-off items are for the Lists screen, until someone clears
// them. An item added here is said on the status line, since it may land under "and N more".
function HomeList({ list, onOpenLists }: { list: SharedList; onOpenLists: () => void }) {
  const say = useStatusLine();
  const { items, loaded, problem, add, toggle } = useItems(list.id);
  const toGet = withoutCrossed(items);
  const region = useRef<HTMLDivElement>(null);
  const room = useHeight(region);
  // A line of words, when there is one, takes the room of a row.
  const words = problem || (loaded && toGet.length === 0 ? 'Nothing left to get.' : '');
  const shown = room === null ? 0 : rowsThatFit({ count: toGet.length, room: room - (words ? HOME_ROW_PX + HOME_GAP_PX : 0), row: HOME_ROW_PX, gap: HOME_GAP_PX, more: HOME_MORE_PX });
  const hidden = toGet.length - shown;

  return (
    <section aria-label={list.name} className={HOME_CARD}>
      <div className="flex h-8 shrink-0 items-center justify-between gap-3 px-1">
        <h2 className="min-w-0 truncate font-display text-[22px] leading-7">{list.name}</h2>
        {loaded && <span className="shrink-0 text-sm text-muted-foreground">{toGet.length} to get</span>}
      </div>
      <AddRow
        listName={list.name}
        onAdd={async (text) => {
          const item = await add(text);
          if (item) say(`Added ${item.text} to ${list.name}`);
          return item !== null;
        }}
      />
      {/* What is drawn here is only what fits, so nothing in it is ever cut off or reached by Tab without being seen. */}
      <div ref={region} className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
        {room !== null && (
          <>
            {words && (
              <p role={problem ? 'alert' : undefined} className="flex h-12 shrink-0 items-center px-1 text-sm leading-[18px]">
                {words}
              </p>
            )}
            {toGet.slice(0, shown).map((item) => (
              <ItemRow key={item.id} item={item} size="home" onToggle={() => void toggle(item)} />
            ))}
            {hidden > 0 && room >= HOME_MORE_PX && (
              <Button
                variant="quiet"
                aria-label={`and ${hidden} more on ${list.name}. Open lists`}
                className="h-12 w-full shrink-0 justify-start rounded-[14px] px-1 text-sm font-medium focus-visible:-outline-offset-2"
                onClick={onOpenLists}
              >
                and {hidden} more
              </Button>
            )}
          </>
        )}
      </div>
    </section>
  );
}

// The pinned Shared List, on the home screen's right rail.
export function PinnedListCard({ onOpenLists }: { onOpenLists: () => void }) {
  const { read, failed } = useLists();
  // undefined until the first read; null when no list is pinned (or the pinned one is gone).
  const pinned = read ? (read.lists.find((list) => list.id === read.pinnedId) ?? null) : undefined;
  if (pinned) return <HomeList key={pinned.id} list={pinned} onOpenLists={onOpenLists} />;

  return (
    <aside aria-label="Pinned list" className={HOME_CARD}>
      {pinned === undefined && !failed && <p className="text-base">Loading</p>}
      {pinned === undefined && failed && (
        <p role="alert" className="text-base">
          Could not load lists. Check your connection.
        </p>
      )}
      {pinned === null && <p className="text-base">No list is pinned. Pin one in settings on your phone.</p>}
    </aside>
  );
}

// ---- The phone: manage lists (Household Account only) ---------------------------------

// The phone's parts, from the drawing (v2/phone.js): a card has 16 px of padding round its parts, 16 apart, and its title in the
// display face at 22 px. A field, a row and the big button are 56 px; the smaller actions are 48.
const CARD = 'flex flex-col gap-4 rounded-3xl bg-card p-4';
const CARD_TITLE = 'font-display text-[22px] leading-7';
const ACTION = 'h-12 px-4';
const ICON_ACTION = 'size-12 rounded-full px-0';

// One list's items on the phone: the rows of the Wall's cards, with the arrows that reorder them, which only the phone has.
function ItemsEditor({ listId, listName }: { listId: string; listName: string }) {
  const { items, loaded, problem, add, toggle, clear, move } = useItems(listId);
  const crossed = items.length - withoutCrossed(items).length;

  return (
    <div className="flex flex-col gap-4">
      <AddRow listName={listName} size="phone" onAdd={async (text) => (await add(text)) !== null} />
      {problem && (
        <p role="alert" className="text-base">
          {problem}
        </p>
      )}
      {loaded && items.length === 0 && !problem && <p className="text-base">Nothing on this list.</p>}
      {items.length > 0 && (
        <ul className="flex flex-col gap-2">
          {items.map((item, index) => (
            <li key={item.id} className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <ItemRow item={item} size="phone" onToggle={() => void toggle(item)} />
              </div>
              <Button variant="secondary" className={ICON_ACTION} aria-label={`Move ${item.text} up`} disabled={index === 0} onClick={() => void move(item.id, -1)}>
                <ArrowUp aria-hidden className="size-5" />
              </Button>
              <Button variant="secondary" className={ICON_ACTION} aria-label={`Move ${item.text} down`} disabled={index === items.length - 1} onClick={() => void move(item.id, 1)}>
                <ArrowDown aria-hidden className="size-5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {crossed > 0 && (
        <Button variant="secondary" size="phone" className="w-full" onClick={() => void clear()}>
          Clear {crossed} crossed off
        </Button>
      )}
    </div>
  );
}

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
    <main className="mx-auto flex max-w-md flex-col gap-3 px-4 pt-2 pb-6">
      <h1 className="sr-only">Lists</h1>

      <section aria-labelledby="new-list-title" className={CARD}>
        <h2 id="new-list-title" className={CARD_TITLE}>
          New list
        </h2>
        <form onSubmit={(event) => void create(event)} className="flex flex-col gap-4">
          <label className="flex flex-col gap-2 text-[15px] text-muted-foreground">
            Name
            <input className="h-14 text-[17px]" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={100} />
          </label>
          <Button type="submit" variant="primary" size="phone" className="w-full text-[17px]">
            Add list
          </Button>
        </form>
      </section>

      {problem && (
        <p role="alert" className="px-1 text-base">
          {problem}
        </p>
      )}
      {lists?.length === 0 && <p className="px-1 text-base">No lists yet.</p>}

      <ul className="flex flex-col gap-3">
        {lists?.map((list, index) => (
          <li key={list.id}>
            <section aria-label={list.name} className={CARD}>
              {renaming?.id === list.id ? (
                <form onSubmit={(event) => void rename(event)} className="flex flex-col gap-3">
                  <input
                    className="h-14 text-[17px]"
                    value={renaming.name}
                    onChange={(e) => setRenaming({ id: list.id, name: e.target.value })}
                    maxLength={100}
                    aria-label={`Name for ${list.name}`}
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <Button type="submit" variant="secondary" className={ACTION}>
                      Save
                    </Button>
                    <Button variant="quiet" className={ACTION} onClick={() => setRenaming(null)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : (
                // The arrows move the whole card, so they sit with its name.
                <div className="flex items-center gap-2">
                  <h2 className={`${CARD_TITLE} min-w-0 flex-1 break-words`}>{list.name}</h2>
                  <Button variant="secondary" className={ICON_ACTION} aria-label={`Move ${list.name} up`} disabled={index === 0} onClick={() => void move(list.id, -1)}>
                    <ArrowUp aria-hidden className="size-5" />
                  </Button>
                  <Button variant="secondary" className={ICON_ACTION} aria-label={`Move ${list.name} down`} disabled={index === lists.length - 1} onClick={() => void move(list.id, 1)}>
                    <ArrowDown aria-hidden className="size-5" />
                  </Button>
                </div>
              )}
              {list.id === pinnedId && <PinnedMark />}

              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" className={ACTION} aria-expanded={open === list.id} onClick={() => setOpen(open === list.id ? null : list.id)}>
                  {open === list.id ? 'Hide items' : 'Items'}
                </Button>
                <Button variant="secondary" className={ACTION} onClick={() => setRenaming({ id: list.id, name: list.name })}>
                  Rename
                </Button>
                {list.id !== pinnedId && (
                  <Button
                    variant="secondary"
                    className={ACTION}
                    onClick={() => void change(() => setPinnedList(supabase, household.id, list.id), 'Could not pin that list. Try again.')}
                  >
                    Show on home screen
                  </Button>
                )}
                {confirming === list.id ? (
                  <>
                    <Button variant="delete" className="h-auto min-h-12 px-4 py-2 whitespace-normal" onClick={() => void remove(list.id)}>
                      Delete {list.name} and its items
                    </Button>
                    <Button variant="quiet" className={ACTION} onClick={() => setConfirming(null)}>
                      Keep it
                    </Button>
                  </>
                ) : (
                  <Button variant="quiet" className={ACTION} onClick={() => setConfirming(list.id)}>
                    Delete
                  </Button>
                )}
              </div>

              {open === list.id && <ItemsEditor listId={list.id} listName={list.name} />}
            </section>
          </li>
        ))}
      </ul>
    </main>
  );
}
