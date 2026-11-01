import { List } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { formatClock } from '@shared/event-words.ts';
import { lastSentMs, leftToGet, listChipName, waitingItems, withoutCrossed, type ListItem, type SharedList } from '../lib/shared-lists';
import { focusTitle, titleId, useItems } from '../lib/use-shared-lists';
import { useOverflow } from '../lib/use-overflow';
import { PhoneCard } from '../phone/parts';
import { AddRow, ItemRow, PinnedMark } from '../SharedListsPage';
import { EmptyWords } from './EmptyWords';
import { FOOT_CLEARANCE, OverflowButton } from './OverflowButton';
import { GotItSheet } from './GotItSheet';
import { SendToTargetSheet } from './SendToTargetSheet';
import { Button } from './ui/button';

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
  const { items, loaded, problem, add, toggle, clear, markSent, gotItems, sentProblem, gotProblem, clearSends, busy } = useItems(list.id);
  const left = leftToGet(loaded, problem, items);
  const crossed = items.length - withoutCrossed(items).length;
  const waiting = waitingItems(items);
  const sentAt = lastSentMs(waiting);
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
  // At rest an item may sit partly under the "More" button at their foot; one that takes the focus, or is added, is scrolled clear of it.
  const scrollBox = (
    <div ref={scrolls ? more.scroller : undefined} className={scrolls ? `min-h-0 overflow-y-auto ${FOOT_CLEARANCE}` : undefined}>
      {rowList}
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
      {items.length > 0 && (wall ? scrollBox : rowList)}
      {/* What did not save is said at the card's foot, where "Clear crossed off" sits, and never above the rows: a line over them would
          push the row that was just tapped down from under the finger. */}
      {problem && (
        <p role="alert" className={wall ? 'shrink-0 text-[15px] leading-5' : 'px-1 text-base'}>
          {problem}
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
      {!wall && withoutCrossed(items).length > 0 && (
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
        <SendToTargetSheet items={withoutCrossed(items)} busy={busy} problem={sentProblem} onMarkSent={markSent} onClose={() => setSending(false)} />
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
