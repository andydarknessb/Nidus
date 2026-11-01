import { List, Plus, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import type { ListSuggestion } from '../lib/list-suggestions';
import { leftToGet, listChipName, withoutCrossed, type ListItem, type SharedList } from '../lib/shared-lists';
import { focusTitle, titleId, useItems, useSuggestions } from '../lib/use-shared-lists';
import { useOverflow } from '../lib/use-overflow';
import { PhoneCard } from '../phone/parts';
import { AddRow, ItemRow, PinnedMark } from '../SharedListsPage';
import { EmptyWords } from './EmptyWords';
import { FOOT_CLEARANCE, OverflowButton } from './OverflowButton';
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
// `onCount` hears the count whenever it changes, for the phone's chip (a list that is not open has its count read by the chips' own reader).
export function ListCard({
  list,
  size,
  pinned,
  portrait = false,
  onCount,
}: {
  list: SharedList;
  size: 'card' | 'phone';
  pinned: boolean;
  portrait?: boolean;
  onCount?: (listId: string, left: number | null) => void;
}) {
  const { items, loaded, problem, add, toggle, clear } = useItems(list.id);
  const suggested = useSuggestions(list.id);
  const left = leftToGet(loaded, problem, items);
  const crossed = items.length - withoutCrossed(items).length;
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
  const waiting = suggested.suggestions.length > 0 && (
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
      {waiting}
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
      {loaded && items.length === 0 && !problem && <EmptyWords className={wall ? 'shrink-0' : 'px-1'}>Nothing on this list.</EmptyWords>}
      {(items.length > 0 || waiting) && (wall ? scrollBox : listed)}
      {/* What did not save is said at the card's foot, where "Clear crossed off" sits, and never above the rows: a line over them would
          push the row that was just tapped down from under the finger. */}
      {(problem || suggested.problem) && (
        <p role="alert" className={wall ? 'shrink-0 text-[15px] leading-5' : 'px-1 text-base'}>
          {problem || suggested.problem}
        </p>
      )}
      {crossed > 0 && (
        <Button
          variant={wall ? 'quiet' : 'secondary'}
          size={wall ? undefined : 'phone'}
          aria-label={`Clear ${crossed} crossed off from ${list.name}`}
          className={wall ? 'h-12 w-full shrink-0 rounded-[14px]' : 'w-full'}
          // The button goes when nothing is crossed off any more, and focus would fall to the page with it: it goes to the card's title.
          onClick={() => {
            focusTitle(list.id);
            void clear();
          }}
        >
          Clear {crossed} crossed off
        </Button>
      )}
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
