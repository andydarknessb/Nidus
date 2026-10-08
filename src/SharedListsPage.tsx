import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type Ref, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { ArrowDown, ArrowUp, ChevronRight, List, Pin, Plus } from 'lucide-react';
import { movedIds, nextSortOrder } from './lib/ordering';
import { supabase } from './lib/supabase';
import {
  createList,
  deleteList,
  HOME_HOLD_MS,
  homeRows,
  homeWindow,
  loadLists,
  loadPinnedListId,
  pinnedFirst,
  renameList,
  reorderLists,
  setPinnedList,
  withoutCrossed,
  type ListItem,
  type SharedList,
} from './lib/shared-lists';
import { rootFontSize } from './lib/home-layout';
import type { Household } from './lib/household';
import { focusElement } from './lib/focus';
import { useStatusLine } from './lib/status-line';
import { useCardWrite } from './lib/use-card-write';
import { focusTitle, isPending, LIST_TABLES, titleId, useItems, useLists } from './lib/use-shared-lists';
import { useOverflow } from './lib/use-overflow';
import { unnamed } from './lib/write-failure';
import { EmptyWords } from './components/EmptyWords';
import { FOOT_CLEARANCE, OverflowButton } from './components/OverflowButton';
import { EmptyRing, Tick } from './components/people';
import { Problem } from './components/phone';
import { Button } from './components/ui/button';
import { couldNotLoad, useSyncedRead } from './lib/synced-read';

// ---- The wall ------------------------------------------------------------------------

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
export function ItemRow({ item, size, onToggle, ref }: { item: ListItem; size: keyof typeof ROW; onToggle: () => void; ref?: Ref<HTMLButtonElement> }) {
  const crossed = item.crossed_at !== null;
  const ring = size === 'home' ? 26 : 28;
  return (
    <button
      ref={ref}
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
export function AddRow({ listName, size = 'wall', onAdd }: { listName: string; size?: 'wall' | 'phone'; onAdd: (text: string) => Promise<boolean> }) {
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

// The mark on the Pinned List, on the Wall's card and on the phone's.
export function PinnedMark() {
  return (
    <p className="flex min-h-8 shrink-0 items-center gap-2 self-start rounded-full bg-muted px-3 py-0.5 text-sm text-muted-foreground">
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
    <section aria-label={loaded ? `${list.name}, ${left} left` : list.name} className="flex max-h-full w-(--card-w) shrink-0 snap-start flex-col gap-2 rounded-3xl bg-card p-3">
      <div className="flex min-h-13 shrink-0 items-center gap-3">
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
      {loaded && items.length === 0 && <EmptyWords className="shrink-0">Nothing on this list.</EmptyWords>}
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
      {/* What did not save is said at the card's foot, where "Clear crossed off" sits, and never above the rows: a line over them would
          push the row that was just tapped down from under the finger. */}
      {problem && (
        <p role="alert" className="shrink-0 text-[15px] leading-5">
          {problem}
        </p>
      )}
      {crossed > 0 && (
        <Button
          variant="quiet"
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
  // Focus goes to the screen's title on arrival, as on the Routines chart and the calendar pages, rather than falling to the page when
  // the link that opened this (Home's list card) goes with the screen it was on.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <div className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 ref={heading} tabIndex={-1} className="font-display text-[28px] leading-[34px] outline-none">
          Lists
        </h2>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="text-[15px] text-muted-foreground">The owner adds lists in Settings.</p>
          {/* The heading row is 48 px, and the button is the row's height. */}
          <OverflowButton control={row} of="lists" className="h-12" />
        </div>
      </div>
      {failed && read === null && (
        <p role="alert" className="text-xl">
          {couldNotLoad('lists')}
        </p>
      )}
      {read?.lists.length === 0 && <EmptyWords>No lists yet. The owner adds lists in Settings.</EmptyWords>}
      <div
        ref={row.scroller}
        className={`flex min-h-0 flex-1 snap-x snap-mandatory items-start gap-4 overflow-x-auto ${cards.length > 3 ? '[--card-w:max(calc((100%_-_3rem)/3.2),min(17rem,100%,calc((1rem_-_16px)*1000)))]' : '[--card-w:max(calc((100%_-_2rem)/3),min(17rem,100%,calc((1rem_-_16px)*1000)))]'}`}
      >
        {cards.map((list) => (
          <ListCard key={list.id} list={list} pinned={list.id === read?.pinnedId} />
        ))}
      </div>
    </div>
  );
}

// ---- Home's card: the Pinned List -----------------------------------------------------

// min-w-0: the card is a grid item, whose width is otherwise at least that of its widest unwrapped words, so one long item or list
// name would make the whole right rail, and the page, wider than the screen.
// On a phone (below 768 px, spec 0004) the card is 22 round, like every card of its column.
const HOME_CARD = 'flex min-h-0 min-w-0 flex-1 flex-col gap-2 rounded-3xl bg-card p-3 max-[768px]:rounded-[22px]';

// The Pinned List's card, under Up next in Home's right column: it is as tall as that column leaves it. A heading row holds the list's
// name and a link to the Lists screen that says how many items still to get the card has no room for ("3 more"), or "All lists" when it
// shows them all. Then the field that adds an item, and the rows that fit under it (rowsThatFit): the items still to get, and any
// crossed off on this card in the last HOME_HOLD_MS (homeRows), which stay where they are, ticked, so another tap can put them back.
// An item added here is said on the status line, since it may not be one of the rows that fit.
//
// `limit` is for the phone's column, which the document scrolls and which gives the card no height to measure: the card shows up to that
// many rows and says how many more ("3 more") as it does when it has no room for them, and measures nothing.
function HomeList({ list, onOpenLists, limit }: { list: SharedList; onOpenLists: () => void; limit?: number | undefined }) {
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
  // A row that goes while it has the keyboard's focus (one crossed off here leaves after its four seconds) would leave the keyboard
  // nowhere: as Up next does, the focus goes to the link in the card's heading. A row's ref is called with null as it goes, while its
  // button is still on the page and still has the focus, so what is noted there is read once the page has changed.
  const card = useRef<HTMLElement>(null);
  const link = useRef<HTMLAnchorElement>(null);
  const focusLost = useRef(false);
  const watchRow = useCallback((row: HTMLButtonElement | null) => {
    if (row === null && card.current?.contains(document.activeElement)) focusLost.current = true;
  }, []);
  useEffect(() => {
    if (!focusLost.current) return;
    focusLost.current = false;
    if (!document.activeElement || document.activeElement === document.body) link.current?.focus();
  });
  // "Nothing left to get" waits until the last row has gone (`rows` holds a row crossed off here for its four seconds), so it never
  // pushes a row that was just crossed off down from under the finger.
  const nothing = loaded && rows.length === 0;
  const measured = limit === undefined;
  // The rows that show, and the items still to get that the card has no room for.
  const { shown, hidden } = homeWindow({ rows, limit, room, rem: rootFontSize() });

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
    <section ref={card} aria-label={loaded ? `${list.name}, ${left} left` : list.name} className={HOME_CARD}>
      <div className="flex h-12 shrink-0 items-center justify-between gap-2">
        <h2 className="min-w-0 flex-1 truncate px-1 font-display text-[22px] leading-7">{list.name}</h2>
        <ListsLink ref={link} words={hidden > 0 ? `${hidden} more` : 'All lists'} name={hidden > 0 ? `${hidden} more in ${list.name}. All lists` : 'All lists'} onOpen={onOpenLists} />
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
      <div ref={region} className={measured ? 'flex min-h-0 flex-1 flex-col gap-2 overflow-hidden' : 'flex flex-col gap-2'}>
        {(room !== null || !measured) && (
          <>
            {nothing && <EmptyWords className="shrink-0 px-1">Nothing left to get.</EmptyWords>}
            {rows.slice(0, shown).map((item) => (
              <ItemRow key={item.id} ref={watchRow} item={item} size="home" onToggle={() => tap(item)} />
            ))}
          </>
        )}
      </div>
      {/* What did not save is said at the card's foot, under the rows that fit (they take what room is left): a line over them would
          push the row that was just tapped down from under the finger. */}
      {problem && (
        <p role="alert" className="shrink-0 px-1 text-[15px] leading-5">
          {problem}
        </p>
      )}
    </section>
  );
}

// The link in a card's heading row to the Lists screen: "All lists", or how many items still to get the card has no room for ("3 more").
// Its name says where it goes, and starts with what is read.
function ListsLink({ words, name, onOpen, ref }: { words: string; name: string; onOpen: () => void; ref?: Ref<HTMLAnchorElement> }) {
  return (
    <Button asChild variant="quiet" className="h-12 shrink-0 gap-0.5 rounded-[14px] pr-1 pl-3 text-[15px] font-medium">
      <a
        ref={ref}
        href="/lists"
        aria-label={name}
        onClick={(event) => {
          event.preventDefault();
          onOpen();
        }}
      >
        {words}
        <ChevronRight aria-hidden className="size-5" strokeWidth={2.2} />
      </a>
    </Button>
  );
}

// Home's list card when no list is on the home screen. It keeps its heading, "Lists", and says what to do: with no list at all, who adds
// one (the owner, in Settings); with lists and none on the home screen, who puts one there (the owner, in Settings), and the link to the Lists screen is there to see them. (It
// used to have no heading, and to say to open a list that does not exist.)
// On the phone layout (`phone`) the words say what the person holding the phone can do: only the owner makes and pins lists, in Settings.
export function EmptyListCard({ lists, onOpenLists, phone = false }: { lists: number; onOpenLists: () => void; phone?: boolean }) {
  return (
    <aside aria-label="Pinned list" className={HOME_CARD}>
      <div className="flex h-12 shrink-0 items-center justify-between gap-2">
        <h2 className="min-w-0 flex-1 truncate px-1 font-display text-[22px] leading-7">Lists</h2>
        {lists > 0 && <ListsLink words="All lists" name="All lists" onOpen={onOpenLists} />}
      </div>
      <EmptyWords className="px-1">
        {phone
          ? lists === 0
            ? 'No lists yet. The owner adds lists in Settings.'
            : 'No list on Home yet. The owner picks one in Settings.'
          : lists === 0
            ? 'No lists yet. The owner adds lists in Settings.'
            : 'No list here yet. The owner picks one in Settings.'}
      </EmptyWords>
    </aside>
  );
}

// The pinned Shared List, under Up next in Home's right column.
export function PinnedListCard({ onOpenLists, limit }: { onOpenLists: () => void; limit?: number | undefined }) {
  const { read, failed } = useLists();
  // undefined until the first read; null when no list is pinned (or the pinned one is gone).
  const pinned = read ? (read.lists.find((list) => list.id === read.pinnedId) ?? null) : undefined;
  if (pinned) return <HomeList key={pinned.id} list={pinned} onOpenLists={onOpenLists} limit={limit} />;
  if (pinned === null) return <EmptyListCard lists={read?.lists.length ?? 0} onOpenLists={onOpenLists} phone={limit !== undefined} />;

  return (
    <aside aria-label="Pinned list" className={HOME_CARD}>
      {!failed && <EmptyWords>Loading</EmptyWords>}
      {failed && (
        <p role="alert" className="text-base">
          {couldNotLoad('lists')}
        </p>
      )}
    </aside>
  );
}

// ---- The phone: manage lists (Household Account only) ---------------------------------

// The phone's parts, from the drawing (v2/phone.js): a card has 16 px of padding round its parts, 16 apart, and its title in the
// display face at 22 px. A field, a row and the big button are 56 px; the smaller actions are 48.
const CARD = 'flex flex-col gap-4 rounded-3xl bg-card p-4';
const CARD_TITLE = 'font-display text-[22px] leading-7';
const ACTION = 'h-12 px-4';
// Where a form says it was asked to save with no name: each is tied to the field it is about.
const NEW_LIST_PROBLEM = 'new-list-problem';
const NEW_LIST_TITLE = 'new-list-title';
const RENAME_PROBLEM = 'rename-list-problem';
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
  // Read through the synced read; a change is written through it, then read back before the page moves on.
  const read = useSyncedRead(
    async () => {
      const [lists, pinnedId] = await Promise.all([loadLists(supabase), loadPinnedListId(supabase)]);
      return { lists, pinnedId };
    },
    LIST_TABLES,
    'lists',
  );
  const lists = read.data?.lists ?? null;
  const pinnedId = read.data?.pinnedId ?? null;
  // What the last change said when it failed, else that the page could not be read.
  const [changeProblem, setProblem] = useState('');
  const problem = changeProblem || (read.failed ? couldNotLoad('lists') : '');
  const [newName, setNewName] = useState('');
  // How many times each form was asked to save with no name, which it says in its own line (a rename counts with the rename, so it
  // starts again with each).
  const [askedNew, setAskedNew] = useState(0);
  const [renaming, setRenaming] = useState<{ id: string; name: string; asked: number } | null>(null);
  const newProblem = unnamed('list', askedNew, newName);
  const renameProblem = renaming ? unnamed('list', renaming.asked, renaming.name) : null;
  const [confirming, setConfirming] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  // One change at a time (the card write guard): the buttons are drawn `aria-disabled` from `busy`.
  const card = useCardWrite();
  const { busy } = card;

  // Runs one change, then reads again so the screen shows what the database holds, before the next may begin. A failure is said
  // at once. Says whether it was made; false too when another change was on its way and this one did nothing.
  async function change(work: () => Promise<void>, failure: string): Promise<boolean> {
    const outcome = await card.run(
      async () => {
        await read.write(work);
        setProblem('');
        await read.readBack();
      },
      { failed: () => setProblem(failure) },
    );
    return outcome === 'done';
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    if (card.isBusy()) return;
    if (!newName.trim()) {
      setAskedNew((count) => count + 1);
      return;
    }
    await change(async () => {
      await createList(supabase, household.id, newName, nextSortOrder(lists ?? []));
      setNewName('');
      setAskedNew(0);
    }, 'Could not create that list. Try again.');
  }

  async function rename(event: FormEvent) {
    event.preventDefault();
    if (!renaming || card.isBusy()) return;
    if (!renaming.name.trim()) {
      setRenaming({ ...renaming, asked: renaming.asked + 1 });
      return;
    }
    const { id, name } = renaming;
    await change(async () => {
      await renameList(supabase, id, name);
      setRenaming(null);
      document.getElementById(`rename-${id}`)?.focus();
    }, 'Could not rename that list. Try again.');
  }

  async function move(id: string, offset: number) {
    if (card.isBusy()) return;
    const ids = movedIds((lists ?? []).map((list) => list.id), id, offset);
    await change(() => reorderLists(supabase, ids), 'Could not reorder lists. Try again.');
  }

  // The Delete that was pressed goes with its list: focus goes at once to the title of the list beside it, or to "New list" when it was
  // the only one, so it never falls to the page; and back to this list's Delete if the delete did not go through.
  async function remove(id: string) {
    if (card.isBusy()) return;
    const ids = (lists ?? []).map((list) => list.id);
    const beside = ids[ids.indexOf(id) + 1] ?? ids[ids.indexOf(id) - 1];
    setConfirming(null);
    if (open === id) setOpen(null);
    focusElement(document.getElementById(beside === undefined ? NEW_LIST_TITLE : titleId(beside)));
    if (!(await change(() => deleteList(supabase, id), 'Could not delete that list. Try again.'))) focusElement(document.getElementById(`delete-${id}`));
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-3 px-4 pt-2 pb-6">
      <h1 className="sr-only">Lists</h1>

      <section aria-labelledby={NEW_LIST_TITLE} className={CARD}>
        <h2 id={NEW_LIST_TITLE} tabIndex={-1} className={CARD_TITLE}>
          New list
        </h2>
        <form onSubmit={(event) => void create(event)} noValidate className="flex flex-col gap-4">
          <label className="flex flex-col gap-2 text-[15px] text-muted-foreground">
            Name
            <input
              className="h-14 text-[17px]"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={100}
              aria-invalid={newProblem ? true : undefined}
              aria-describedby={newProblem ? NEW_LIST_PROBLEM : undefined}
            />
          </label>
          <Button type="submit" variant="primary" size="phone" className="w-full text-[17px]" aria-disabled={busy || undefined}>
            Add list
          </Button>
          <Problem id={NEW_LIST_PROBLEM} problem={newProblem} />
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
                <form onSubmit={(event) => void rename(event)} noValidate className="flex flex-col gap-3">
                  <input
                    id={titleId(list.id)}
                    className="h-14 text-[17px]"
                    value={renaming.name}
                    onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
                    maxLength={100}
                    aria-label={`Name for ${list.name}`}
                    aria-invalid={renameProblem ? true : undefined}
                    aria-describedby={renameProblem ? RENAME_PROBLEM : undefined}
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <Button type="submit" variant="secondary" className={ACTION} aria-disabled={busy || undefined}>
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
                  <Problem id={RENAME_PROBLEM} problem={renameProblem} />
                </form>
              ) : (
                // The arrows move the whole card, so they sit with its name.
                <div className="flex items-center gap-2">
                  <h2 id={titleId(list.id)} tabIndex={-1} className={`${CARD_TITLE} min-w-0 flex-1 break-words`}>
                    {list.name}
                  </h2>
                  <Button variant="secondary" className={ICON_ACTION} aria-label={`Move ${list.name} up`} disabled={index === 0} aria-disabled={busy || undefined} onClick={() => void move(list.id, -1)}>
                    <ArrowUp aria-hidden className="size-5" />
                  </Button>
                  <Button variant="secondary" className={ICON_ACTION} aria-label={`Move ${list.name} down`} disabled={index === lists.length - 1} aria-disabled={busy || undefined} onClick={() => void move(list.id, 1)}>
                    <ArrowDown aria-hidden className="size-5" />
                  </Button>
                </div>
              )}
              {list.id === pinnedId && <PinnedMark />}

              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" className={ACTION} aria-expanded={open === list.id} onClick={() => setOpen(open === list.id ? null : list.id)}>
                  {open === list.id ? 'Hide items' : 'Items'}
                </Button>
                <Button id={`rename-${list.id}`} variant="secondary" className={ACTION} onClick={() => setRenaming({ id: list.id, name: list.name, asked: 0 })}>
                  Rename
                </Button>
                {list.id !== pinnedId && (
                  <Button
                    variant="secondary"
                    className={ACTION}
                    aria-disabled={busy || undefined}
                    onClick={() => {
                      if (!card.isBusy()) void change(() => setPinnedList(supabase, household.id, list.id), 'Could not pin that list. Try again.');
                    }}
                  >
                    Show on home screen
                  </Button>
                )}
                {confirming === list.id ? (
                  <>
                    <Button variant="delete" className="h-auto min-h-12 px-4 py-2 whitespace-normal" aria-disabled={busy || undefined} onClick={() => void remove(list.id)}>
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
