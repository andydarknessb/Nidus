import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { ArrowDown, ArrowUp, ChevronRight, List, Pin, Plus } from 'lucide-react';
import { supabase } from './lib/supabase';
import {
  addItem,
  byPosition,
  clearCompleted,
  clearOptimistically,
  createList,
  crossOptimistically,
  deleteList,
  HOME_HOLD_MS,
  homeRows,
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
import { useOverflow } from './lib/use-overflow';
import { FOOT_CLEARANCE, OverflowButton } from './components/OverflowButton';
import { EmptyRing, Tick } from './components/people';
import { Button } from './components/ui/button';

// What each read here listens to. The pinned list is a column of the Household.
const ITEM_TABLES = ['list_items'] as const;
const ITEM_REFRESH_MS = 30_000;
const LIST_TABLES = ['shared_lists', 'households'] as const;

// ---- Items of one list: the same on the wall's cards and on the phone --------------

type ItemsState = { items: ListItem[]; loaded: boolean; problem: string };

// A row shown for an item the server has not stored yet has an id that says so ("pending-1"). It cannot be crossed off or moved
// until the stored row has taken its place, which is a moment.
const PENDING = 'pending-';
const isPending = (item: ListItem) => item.id.startsWith(PENDING);

function useItems(listId: string) {
  const [state, setState] = useState<ItemsState>({ items: [], loaded: false, problem: '' });
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
    } catch {
      if (current.current === listId) {
        setState((prev) => ({ ...prev, items: prev.items.filter((row) => row.id !== pending.id), problem: 'Could not add that item. Try again.' }));
      }
      return null;
    }
  }

  async function toggle(item: ListItem) {
    if (isPending(item)) return;
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

// How an item's row is drawn in each place, from the drawings. In a card on the Lists screen it is 52 px, and its words may take two
// lines (the row grows for the second). On Home it is 48 px and the words one line, since its rows are counted by height. On the phone
// it is at least 56 px and shows the words in full. Words with no space in them break where the row ends.
const ROW = {
  card: { box: 'min-h-13 py-2', words: 'line-clamp-2 wrap-anywhere' },
  home: { box: 'h-12', words: 'truncate' },
  phone: { box: 'min-h-14 py-2', words: 'wrap-anywhere' },
} as const;

// One item. The whole row is the button: a tap crosses the item off, another puts it back. To get, it is an empty ring;
// crossed off, a tick and struck-through words, so it never rests on colour alone.
function ItemRow({ item, size, onToggle }: { item: ListItem; size: keyof typeof ROW; onToggle: () => void }) {
  const crossed = item.crossed_at !== null;
  const ring = size === 'home' ? 26 : 28;
  return (
    <button
      type="button"
      aria-pressed={crossed}
      onClick={onToggle}
      // The focus ring is drawn inside the row: its list scrolls, and a scrolling box clips what is drawn outside it.
      className={`flex w-full shrink-0 items-center gap-3 rounded-[14px] bg-muted px-3 text-left text-[17px] transition-[transform,background-color] duration-75 select-none focus-visible:-outline-offset-2 active:translate-y-0.5 active:bg-accent ${ROW[size].box}`}
    >
      {crossed ? <Tick size={ring} /> : <EmptyRing size={ring} width={2.5} />}
      <span className={`min-w-0 flex-1 ${ROW[size].words} ${crossed ? 'text-muted-foreground line-through' : ''}`}>{item.text}</span>
    </button>
  );
}

// The field that adds an item, and its button: 52 px on the Wall, 56 on the phone. `onAdd` says whether the item was added. The
// field empties at once, so a second Enter while the first is still out has nothing to add; if the item could not be added the
// words come back, unless something else has been typed there since.
function AddRow({ listName, size = 'wall', onAdd }: { listName: string; size?: 'wall' | 'phone'; onAdd: (text: string) => Promise<boolean> }) {
  const [text, setText] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    const words = text;
    if (!words.trim()) return;
    setText('');
    if (!(await onAdd(words))) setText((now) => now || words);
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

// What a card's title is called on the page, so that focus can be put on it from the phone's list editor, which is not the component that
// draws the title.
const titleId = (listId: string) => `title-${listId}`;

// After "Clear N crossed off" the button is gone, and focus with it. It goes to the card's title (tabIndex -1: reached by script, not by
// Tab), not to the field, which would raise a tablet's or a phone's keyboard; the next Tab lands on what follows the title. Focus does
// not scroll the page, so a long list on the phone stays where it is.
function focusTitle(listId: string) {
  document.getElementById(titleId(listId))?.focus({ preventScroll: true });
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
// that adds an item, then its items, which scroll inside the card when the card is shorter than the list, with a "More" button
// at their foot that says so (OverflowButton). A card is as tall as its items, up to the height of the screen. Items are crossed
// off here and cleared; reordering is for the phone.
function ListCard({ list, pinned }: { list: SharedList; pinned: boolean }) {
  const { items, loaded, problem, add, toggle, clear } = useItems(list.id);
  const left = withoutCrossed(items).length;
  const crossed = items.length - left;
  const rows = useRef<HTMLUListElement>(null);
  // Whether the items hold more than the card shows. The button is the items' last child, stuck to their foot.
  const more = useOverflow('y', 'over');

  return (
    <section aria-label={loaded ? `${list.name}, ${left} left` : list.name} className="flex max-h-full w-(--card-w) shrink-0 snap-start flex-col gap-2 rounded-3xl bg-card p-3.5">
      <div className="flex h-13 shrink-0 items-center gap-3">
        {/* One picture for every list: there is no picture on a Shared List to choose. */}
        <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-full bg-muted">
          <List className="size-[22px]" />
        </span>
        <h3 id={titleId(list.id)} tabIndex={-1} className="min-w-0 flex-1 truncate font-display text-2xl leading-[30px]">
          {list.name}
        </h3>
        {loaded && <span className="shrink-0 text-[15px] text-muted-foreground">{left} to get</span>}
      </div>
      {pinned && <PinnedMark />}
      <AddRow
        listName={list.name}
        onAdd={async (text) => {
          // The new row shows at once, as the last one, and brings the foot with it when the list now scrolls for the first time: the
          // foot is a render of its own, after the one that adds the row (the hook reads the list in a layout effect). Both are drawn
          // here, before the row is brought into view, so it stops clear of the foot and not under it; and it is brought into view now,
          // not when the server has answered. (An effect would run before the foot exists, and scroll to the end of a list that has none.)
          // ponytail: "last" holds while a new item always goes to the bottom (nextSortOrder); find it by id if one ever lands elsewhere.
          let adding!: Promise<ListItem | null>;
          flushSync(() => {
            adding = add(text);
          });
          rows.current?.lastElementChild?.scrollIntoView({ block: 'nearest' });
          return (await adding) !== null;
        }}
      />
      {problem && (
        <p role="alert" className="shrink-0 text-base">
          {problem}
        </p>
      )}
      {loaded && items.length === 0 && !problem && <p className="shrink-0 text-base">Nothing on this list.</p>}
      {items.length > 0 && (
        // At rest an item may sit partly under the "More" button at their foot; one that takes the focus, or is added, is scrolled clear of it.
        <div ref={more.scroller} className={`min-h-0 overflow-y-auto ${FOOT_CLEARANCE}`}>
          <ul ref={rows} className="flex flex-col gap-2">
            {items.map((item) => (
              <li key={item.id} className="shrink-0">
                <ItemRow item={item} size="card" onToggle={() => void toggle(item)} />
              </li>
            ))}
          </ul>
          <OverflowButton control={more} of={list.name} />
        </div>
      )}
      {crossed > 0 && (
        <Button
          variant="secondary"
          aria-label={`Clear ${crossed} crossed off from ${list.name}`}
          className="h-12 w-full shrink-0 rounded-[14px]"
          // The button goes when nothing is crossed off any more, and focus would fall to the page with it.
          onClick={() => {
            focusTitle(list.id);
            void clear();
          }}
        >
          Clear {crossed} crossed off
        </Button>
      )}
    </section>
  );
}

// The Wall's Lists screen: every Shared List as a card, the Pinned List first. Three cards fill the screen's width. With more,
// the fourth shows in part and the row scrolls sideways, and the heading row holds a "More lists" button that says so, so a list
// is never left off the screen with no sign of it; each card still scrolls its own items up and down.
export function ListsScreen() {
  const { read, failed } = useLists();
  const cards = read ? pinnedFirst(read.lists, read.pinnedId) : [];
  // The row of cards, and whether it holds more than it shows. The button is in the heading row, so it takes nothing from the row.
  const row = useOverflow('x');

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <div className="flex h-13 shrink-0 items-center justify-between gap-4">
        <h2 className="font-display text-[30px] leading-9">Lists</h2>
        <div className="flex items-center gap-4">
          <p className="text-[15px] text-muted-foreground">New lists are made on the phone.</p>
          {/* The heading row is 52 px, so is the button. */}
          <OverflowButton control={row} of="lists" className="h-13" />
        </div>
      </div>
      {failed && read === null && (
        <p role="alert" className="text-xl">
          Could not load lists. Check your connection.
        </p>
      )}
      {read?.lists.length === 0 && <p className="text-xl">No lists yet. Add one from your phone.</p>}
      <div
        ref={row.scroller}
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

// From the drawing (v2/home.js): a row is 48 px (h-12) and rows are 8 px apart (gap-2).
// ponytail: these sit beside the classes they stand for and are not measured; if a larger text size (#69) ever grows a row,
// measure the first row instead.
const HOME_ROW_PX = 48;
const HOME_GAP_PX = 8;
// min-w-0: the card is a grid item, whose width is otherwise at least that of its widest unwrapped words, so one long item or list
// name would make the whole right rail, and the page, wider than the screen.
const HOME_CARD = 'flex min-h-0 min-w-0 flex-1 flex-col gap-2 rounded-3xl bg-card p-3';

// The Pinned List's card, under Up next in Home's right column: it is as tall as that column leaves it. A heading row holds the list's
// name and a link to the Lists screen that says how many items still to get the card has no room for ("3 more"), or "All lists" when it
// shows them all. Then the field that adds an item, and the rows that fit under it (rowsThatFit): the items still to get, and any
// crossed off on this card in the last HOME_HOLD_MS (homeRows), which stay where they are, ticked, so another tap can put them back.
// An item added here is said on the status line, since it may not be one of the rows that fit.
function HomeList({ list, onOpenLists }: { list: SharedList; onOpenLists: () => void }) {
  const say = useStatusLine();
  const { items, loaded, problem, add, toggle } = useItems(list.id);
  // What was crossed off on this card and when, and the time the card last looked at. Both go with the card, when Home is left.
  const [crossedHere, setCrossedHere] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [now, setNow] = useState(() => Date.now());
  // One timer, for the row next to leave: it looks again then, and is cleared when another row is crossed off or put back, and
  // with the card.
  useEffect(() => {
    const leaving = [...crossedHere.values()].map((at) => at + HOME_HOLD_MS).filter((time) => time > now);
    if (leaving.length === 0) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(...leaving) - Date.now());
    return () => clearTimeout(timer);
  }, [crossedHere, now]);
  const rows = homeRows(items, crossedHere, now);
  const left = withoutCrossed(items).length;
  const region = useRef<HTMLDivElement>(null);
  const room = useHeight(region);
  // A line of words, when there is one, takes the room of a row. "Nothing left to get" waits until the last row has gone, so it
  // never pushes a row that was just crossed off down from under the finger.
  const words = problem || (loaded && rows.length === 0 ? 'Nothing left to get.' : '');
  const shown = room === null ? 0 : rowsThatFit({ count: rows.length, room: room - (words ? HOME_ROW_PX + HOME_GAP_PX : 0), row: HOME_ROW_PX, gap: HOME_GAP_PX });
  // The items still to get that the card has no room for.
  const hidden = withoutCrossed(rows.slice(shown)).length;

  // A tap crosses a row off, or puts back one crossed off here. The row stays where it is either way.
  function tap(item: ListItem) {
    if (isPending(item)) return;
    const at = Date.now();
    setNow(at);
    setCrossedHere((before) => {
      const next = new Map(before);
      if (item.crossed_at === null) next.set(item.id, at);
      else next.delete(item.id);
      return next;
    });
    void toggle(item);
  }

  return (
    <section aria-label={loaded ? `${list.name}, ${left} left` : list.name} className={HOME_CARD}>
      <div className="flex h-12 shrink-0 items-center justify-between gap-2">
        <h2 className="min-w-0 flex-1 truncate px-1 font-display text-[22px] leading-7">{list.name}</h2>
        <Button asChild variant="quiet" className="h-12 shrink-0 gap-0.5 rounded-[14px] pr-1 pl-3 text-[15px] font-medium">
          <a
            href="/lists"
            aria-label={hidden > 0 ? `${hidden} more in ${list.name}. All lists` : 'All lists'}
            onClick={(event) => {
              event.preventDefault();
              onOpenLists();
            }}
          >
            {hidden > 0 ? `${hidden} more` : 'All lists'}
            <ChevronRight aria-hidden className="size-5" strokeWidth={2.2} />
          </a>
        </Button>
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
            {rows.slice(0, shown).map((item) => (
              <ItemRow key={item.id} item={item} size="home" onToggle={() => tap(item)} />
            ))}
          </>
        )}
      </div>
    </section>
  );
}

// The pinned Shared List, under Up next in Home's right column.
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
      {pinned === null && <p className="text-base">No list here yet. On your phone, open a list and choose Show on home screen.</p>}
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
        <Button
          variant="secondary"
          size="phone"
          aria-label={`Clear ${crossed} crossed off from ${listName}`}
          className="w-full"
          // As on the Wall: the button goes when nothing is crossed off any more, so focus moves to the card's title.
          onClick={() => {
            focusTitle(listId);
            void clear();
          }}
        >
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
      document.getElementById(`rename-${id}`)?.focus();
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
                    id={titleId(list.id)}
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
                    <Button
                      variant="quiet"
                      className={ACTION}
                      onClick={() => {
                        setRenaming(null);
                        document.getElementById(`rename-${list.id}`)?.focus();
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : (
                // The arrows move the whole card, so they sit with its name.
                <div className="flex items-center gap-2">
                  <h2 id={titleId(list.id)} tabIndex={-1} className={`${CARD_TITLE} min-w-0 flex-1 break-words`}>
                    {list.name}
                  </h2>
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
                <Button id={`rename-${list.id}`} variant="secondary" className={ACTION} onClick={() => setRenaming({ id: list.id, name: list.name })}>
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
                    <Button
                      autoFocus
                      variant="quiet"
                      className={ACTION}
                      onClick={() => {
                        // Delete is not on the page while this is asked: draw it again, then put focus back on it.
                        flushSync(() => setConfirming(null));
                        document.getElementById(`delete-${list.id}`)?.focus();
                      }}
                    >
                      Keep it
                    </Button>
                  </>
                ) : (
                  <Button id={`delete-${list.id}`} variant="quiet" className={ACTION} onClick={() => setConfirming(list.id)}>
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
