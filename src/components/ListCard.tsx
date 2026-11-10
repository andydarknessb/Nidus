import { List, Pin, Plus, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent, type Ref } from 'react';
import { flushSync } from 'react-dom';
import { formatClock } from '@shared/event-words.ts';
import type { ListSuggestion } from '../lib/list-suggestions';
import { listChipName, type ListItem, type SharedList } from '../lib/shared-lists';
import { focusTitle, titleId, useItems, useShopper, useSuggestions } from '../lib/use-shared-lists';
import { useOverflow } from '../lib/use-overflow';
import { shopperWords, suggestedWords } from '../lib/shopper';
import { useStatusLine } from '../lib/status-line';
import { PhoneCard } from '../phone/parts';
import { EmptyWords } from './EmptyWords';
import { EmptyRing, Tick } from './people';
import { FOOT_CLEARANCE, OverflowButton } from './OverflowButton';
import { GotItSheet } from './GotItSheet';
import { SendToTargetSheet } from './SendToTargetSheet';
import { Button } from './ui/button';

// One suggestion: its words, what Meals it is for, and Add and Dismiss, each 48 px. It has a 1.5 px dashed ring in --input and no fill.
function SuggestionRow({
  suggestion,
  listName,
  busy,
  onAdd,
  onDismiss,
}: {
  suggestion: ListSuggestion;
  listName: string;
  busy: boolean;
  onAdd: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-[14px] border-[1.5px] border-dashed border-input py-1.5 pr-1.5 pl-3">
      <div className="min-w-0 flex-1">
        <p className="text-[17px] wrap-anywhere text-foreground">{suggestion.text}</p>
        {suggestion.for_meals && <p className="text-[15px] wrap-anywhere text-muted-foreground">For {suggestion.for_meals}</p>}
      </div>
      <Button variant="quiet" aria-label={`Add ${suggestion.text} to ${listName}`} aria-disabled={busy || undefined} className="h-12 w-12 shrink-0 rounded-[14px] px-0" onClick={onAdd}>
        <Plus aria-hidden className="size-6" strokeWidth={2.6} />
      </Button>
      <Button variant="quiet" aria-label={`Dismiss ${suggestion.text}`} aria-disabled={busy || undefined} className="h-12 w-12 shrink-0 rounded-[14px] px-0" onClick={onDismiss}>
        <X aria-hidden className="size-6" strokeWidth={2.6} />
      </Button>
    </div>
  );
}

// One item's row. The whole row is the button: a tap crosses the item off, another puts it back. To get, it is an empty ring; crossed off, a
// tick and struck-through words, so it never rests on colour alone.
const ROW = {
  card: { box: 'min-h-13 py-2', words: 'line-clamp-2 wrap-anywhere' },
  home: { box: 'h-12', words: 'truncate' },
  phone: { box: 'min-h-14 py-2', words: 'wrap-anywhere' },
} as const;

// How an item's row is drawn in each place, from the drawings. In a card on the Lists screen it is 52 px, and its words may take two
// lines (the row grows for the second). On Home it is 48 px and the words one line, since its rows are counted by height. On the phone
// it is at least 56 px and shows the words in full. Words with no space in them break where the row ends.
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

// One Shared List as a card, on the Wall's Lists screen (`size="card"`) and the phone's Lists tab (`size="phone"`): its name and how many
// items are left to get, whether it is the Pinned List, the field that adds an item, then its items, what did not save, and Clear.
// The count is `leftToGet` in both: none until a read or write has landed, and none after one fails (never "0 to get" from items not read).
//
// On the Wall the card is a `section` of the screen's row, and its items scroll inside it when it is shorter than the list, with a "More"
// button at their foot that says so (OverflowButton). A card is as tall as its items, up to the height of the screen. Items are crossed
// off here and cleared; reordering is for the phone's Settings. In portrait (docs/specs/0009) it is its natural height, every item, with no
// foot of its own: the screen scrolls, and its title wraps (up to three lines cost nothing) where a landscape card's is cut with an ellipsis.
// On the phone it is a PhoneCard and its items are all drawn.
//
// Sent to Target (docs/specs/0019): on the phone, "Send to Target" opens the sheet that makes the message from the items to get. Items
// sent and not yet crossed off wait for Got it, on the Wall and the phone alike: the card says when they were sent (in the Household
// Timezone, so `timezone` is needed for the time; null until the Household is read) and offers Got it.
//
// `onCount` hears the count whenever it changes, for the phone's chip (a list that is not open has its count read by the chips' own reader).
export function ListCard({
  list,
  size,
  pinned,
  portrait = false,
  timezone = null,
  onCount,
}: {
  list: SharedList;
  size: 'card' | 'phone';
  pinned: boolean;
  portrait?: boolean;
  timezone?: string | null;
  onCount?: (listId: string, left: number | null) => void;
}) {
  const { items, left, crossed, toGet, waiting, sentAt, problem, problemKey, add, toggle, clear, markSent, gotItems, sentProblem, gotProblem, clearSends, busy } =
    useItems(list.id);
  const suggested = useSuggestions(list.id);
  const shopper = useShopper(list.id);
  const say = useStatusLine();
  const replaceId = useId();
  // What the shopper's last answer says at the foot (spec 0019); a suggestion landing says nothing there, the status line does.
  const shopperSaid = shopper.answer ? shopperWords(shopper.answer.outcome, list.name) : null;
  const waitingCount = suggested.suggestions.length;
  const shopperLabel = shopper.asking ? 'Looking at your meals' : waitingCount > 0 ? 'Suggest again' : 'Suggest from meals';
  const [sending, setSending] = useState(false);
  const [gettingIt, setGettingIt] = useState(false);
  const rows = useRef<HTMLUListElement>(null);
  // Whether the items hold more than the card shows. The button is the items' last child, stuck to their foot.
  const more = useOverflow('y', 'over');
  useEffect(() => onCount?.(list.id, left), [left, list.id, onCount]);

  const wall = size === 'card';
  const scrolls = wall && !portrait;

  const rowList = (
    <ul ref={rows} className="flex flex-col gap-2">
      {items.map((item) => (
        <li key={item.id} className={wall ? 'shrink-0' : undefined}>
          <ItemRow item={item} size={size} onToggle={() => void toggle(item)} />
        </li>
      ))}
    </ul>
  );
  // What the shopper left, under the items (spec 0019). They are not items: the count, the notification and "Clear" never read them, and
  // a suggestion is drawn as an outline, never a row with a fill, so it is not taken for an item.
  const ids = suggested.suggestions.map((suggestion) => suggestion.id);
  const suggestionGroup = suggested.suggestions.length > 0 && (
    <div role="group" aria-label="Suggested from meals" className="flex flex-col gap-2 pt-2">
      <h4 className="px-1 text-[15px] text-muted-foreground">Suggested from meals</h4>
      <ul className="flex flex-col gap-2">
        {suggested.suggestions.map((suggestion) => (
          <li key={suggestion.id} className={wall ? 'shrink-0' : undefined}>
            <SuggestionRow
              suggestion={suggestion}
              listName={list.name}
              busy={suggested.busy}
              onAdd={() => void suggested.add([suggestion.id])}
              onDismiss={() => void suggested.dismiss([suggestion.id])}
            />
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button variant="secondary" aria-disabled={suggested.busy || undefined} className="h-12 flex-1 rounded-[14px]" onClick={() => void suggested.add(ids)}>
          Add all {ids.length}
        </Button>
        <Button variant="quiet" aria-disabled={suggested.busy || undefined} className="h-12 flex-1 rounded-[14px]" onClick={() => void suggested.dismiss(ids)}>
          Dismiss all
        </Button>
      </div>
    </div>
  );
  const listed = (
    <>
      {items.length > 0 && rowList}
      {suggestionGroup}
    </>
  );
  // At rest an item may sit partly under the "More" button at their foot; one that takes the focus, or is added, is scrolled clear of it.
  const scrollBox = (
    <div ref={scrolls ? more.scroller : undefined} className={scrolls ? `min-h-0 overflow-y-auto ${FOOT_CLEARANCE}` : undefined}>
      {listed}
      {scrolls && <OverflowButton control={more} of={list.name} />}
    </div>
  );

  const heading = (
    <>
      {wall && (
        // One picture for every list: there is no picture on a Shared List to choose.
        <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-full bg-muted">
          <List className="size-[22px]" />
        </span>
      )}
      <h3
        id={titleId(list.id)}
        tabIndex={-1}
        className={wall ? `min-w-0 flex-1 ${portrait ? 'break-words' : 'truncate'} font-display text-2xl leading-[30px]` : 'min-w-0 flex-1 font-display text-[22px] leading-7 wrap-anywhere outline-none'}
      >
        {list.name}
      </h3>
      {left !== null && <span className="shrink-0 text-[15px] text-muted-foreground">{left} to get</span>}
    </>
  );

  const body = (
    <>
      <div className={wall ? 'flex min-h-13 shrink-0 items-center gap-3' : 'flex min-h-12 items-center gap-3 px-1'}>{heading}</div>
      {pinned && <PinnedMark />}
      <AddRow
        listName={list.name}
        size={wall ? 'wall' : 'phone'}
        onAdd={async (text) => {
          if (!wall) return (await add(text)) !== null;
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
      {left !== null && items.length === 0 && <EmptyWords className={wall ? 'shrink-0' : 'px-1'}>Nothing on this list.</EmptyWords>}
      {(items.length > 0 || suggestionGroup) && (wall ? scrollBox : listed)}
      {/* What did not save is said at the card's foot, where "Clear crossed off" sits, and never above the rows: a line over them would
          push the row that was just tapped down from under the finger. */}
      {/* Each has its own alert, so a stale item failure never hides a new suggestion one. */}
      {problem && (
        <p key={problemKey} role="alert" className={wall ? 'shrink-0 text-[15px] leading-5' : 'px-1 text-base'}>
          {problem}
        </p>
      )}
      {suggested.problem && (
        <p key={suggested.problemKey} role="alert" className={wall ? 'shrink-0 text-[15px] leading-5' : 'px-1 text-base'}>
          {suggested.problem}
        </p>
      )}
      {waiting.length > 0 && (
        <div className={wall ? 'flex shrink-0 flex-col gap-2' : 'flex flex-col gap-2 px-1'}>
          <p className="text-[15px] leading-5 text-muted-foreground">
            {sentAt !== null && timezone
              ? `Sent to Target at ${formatClock(sentAt, timezone)}: ${waiting.length} ${waiting.length === 1 ? 'item' : 'items'}`
              : `Sent to Target: ${waiting.length} ${waiting.length === 1 ? 'item' : 'items'}`}
          </p>
          <Button variant="secondary" size={wall ? undefined : 'phone'} className={wall ? 'h-12 w-full rounded-[14px]' : 'w-full'} onClick={() => {
              clearSends();
              setGettingIt(true);
            }}>
            Got it
          </Button>
        </div>
      )}
      {!wall && toGet.length > 0 && (
        <Button variant="secondary" size="phone" className="w-full" onClick={() => {
            clearSends();
            setSending(true);
          }}>
          Send to Target
        </Button>
      )}
      {gettingIt && (
        <GotItSheet items={waiting} busy={busy} problem={gotProblem} onCross={gotItems} onClose={() => setGettingIt(false)} />
      )}
      {sending && (
        <SendToTargetSheet items={toGet} busy={busy} problem={sentProblem} onMarkSent={markSent} onClose={() => setSending(false)} />
      )}
      {shopperSaid && (
        <p role="alert" className={wall ? 'shrink-0 text-[15px] leading-5' : 'px-1 text-base'}>
          {shopperSaid}
        </p>
      )}
      {/* "Suggest from meals" sits beside "Clear crossed off" at the foot, and wraps under it when the card is too narrow for both. The line
          under it says what asking replaces, and the button is described by that line. */}
      <div className={wall ? 'flex shrink-0 flex-col gap-2' : 'flex flex-col gap-2 px-1'}>
        <div className="flex flex-wrap gap-2">
          <Button
            variant={wall ? 'quiet' : 'secondary'}
            size={wall ? undefined : 'phone'}
            aria-disabled={shopper.asking || undefined}
            aria-label={`${shopperLabel} for ${list.name}`}
            aria-describedby={waitingCount > 0 ? replaceId : undefined}
            className={wall ? 'h-12 flex-1 shrink-0 rounded-[14px]' : 'flex-1'}
            onClick={() => {
              if (shopper.asking) return;
              void shopper.ask().then((next) => {
                if (next?.outcome === 'suggested') say(suggestedWords(next.count ?? 0, list.name));
              });
            }}
          >
            {shopperLabel}
          </Button>
          {crossed > 0 && (
            <Button
              variant={wall ? 'quiet' : 'secondary'}
              size={wall ? undefined : 'phone'}
              aria-label={`Clear ${crossed} crossed off from ${list.name}`}
              className={wall ? 'h-12 flex-1 shrink-0 rounded-[14px]' : 'flex-1'}
              // The button goes when nothing is crossed off any more, and focus would fall to the page with it: it goes to the card's title.
              onClick={() => {
                focusTitle(list.id);
                void clear();
              }}
            >
              Clear {crossed} crossed off
            </Button>
          )}
        </div>
        {waitingCount > 0 && (
          <p id={replaceId} className="text-[15px] leading-5 text-muted-foreground">
            This replaces the {waitingCount} waiting.
          </p>
        )}
      </div>
    </>
  );

  const label = listChipName(list.name, left);
  return wall ? (
    <section aria-label={label} className={`flex ${portrait ? '' : 'max-h-full '}${portrait ? 'w-auto' : 'w-(--card-w)'} shrink-0 snap-start flex-col gap-2 rounded-3xl bg-card p-3`}>
      {body}
    </section>
  ) : (
    <PhoneCard label={label}>{body}</PhoneCard>
  );
}
