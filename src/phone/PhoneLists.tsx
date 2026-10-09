import { Pin } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { EmptyWords } from '../components/EmptyWords';
import { ListCard } from '../components/ListCard';
import { Button } from '../components/ui/button';
import { leftToGet, listChipName, pinnedFirst, pickedList, type SharedList } from '../lib/shared-lists';
import { useItems, useLists } from '../lib/use-shared-lists';
import { SideScroll } from './parts';
import { couldNotLoad } from '../lib/synced-read';

// The phone's Lists tab (spec 0004, "Lists"): a row of list chips that scrolls sideways, the Pinned List first, then the picked list's
// card. The card is the Wall's own (ListCard, at the phone size), so its items read and write as it does, as a Device and as the
// Household Account.
//
// Making, renaming, moving and deleting lists are not on the Lists screen of the tablet either: they are the Household Account's, on
// the Lists tab of Settings, which the phone's gear opens. The Wall's words say so where there is nothing to open.

// One list as a chip: 56 tall and at least 48 wide, its name over how many are left to get, a pin before the name for the Pinned List
// (which the card says in words too). The picked chip is pressed and takes the Selected look. It keeps its natural width, so the row
// holds more than it shows and the chip cut at the edge is the sign.
export function ListChip({ name, left, pinned, picked, onPick }: { name: string; left: number | null; pinned: boolean; picked: boolean; onPick: () => void }) {
  return (
    <Button variant="quiet" aria-label={listChipName(name, left)} aria-pressed={picked} onClick={onPick} className="h-14 min-w-12 rounded-2xl bg-card px-4 text-foreground">
      <span aria-hidden className="flex max-w-56 min-w-0 flex-col items-start">
        <span className="flex max-w-full items-center gap-1.5">
          {pinned && <Pin className="size-4 shrink-0" />}
          <span className="truncate text-[17px] leading-6">{name}</span>
        </span>
        {left !== null && <span className="text-[13px] leading-4 font-medium text-muted-foreground">{left} to get</span>}
      </span>
    </Button>
  );
}

// What a chip counts: how many are left to get on its list, or null while that is not known (not read yet, or the last read or write
// failed), which the chip leaves unsaid. The count of a list is told up to the row by the reader or the card that holds its items.
type Counts = Readonly<Record<string, number | null>>;

// Reads one list's items for its chip's count and draws nothing: the same reader the card uses, kept for a list that is not open.
function CountReader({ listId, onCount }: { listId: string; onCount: (listId: string, left: number | null) => void }) {
  const { items, loaded, problem } = useItems(listId);
  const left = leftToGet(loaded, problem, items);
  useEffect(() => onCount(listId, left), [left, listId, onCount]);
  return null;
}

// The tab's own heading, for a screen reader (the chips and the card say the rest): the page's h1 is the Household's name, so without it
// the headings would jump from that to the picked list's h3. Not drawn: the row of chips is what the eye starts at.
export function PhoneLists() {
  return (
    <>
      <h2 className="sr-only">Lists</h2>
      <Lists />
    </>
  );
}

function Lists() {
  const { read, failed } = useLists();
  if (read === null) {
    return failed ? (
      <p role="alert" className="text-base">
        {couldNotLoad('lists')}
      </p>
    ) : (
      <EmptyWords>Loading</EmptyWords>
    );
  }
  if (read.lists.length === 0) return <EmptyWords>No lists yet. The owner adds lists in Settings.</EmptyWords>;
  return <ListsBody lists={read.lists} pinnedId={read.pinnedId} />;
}

function ListsBody({ lists, pinnedId }: { lists: SharedList[]; pinnedId: string | null }) {
  const [choice, setChoice] = useState<string | null>(null);
  const [counts, setCounts] = useState<Counts>({});
  const pickedId = pickedList(lists, pinnedId, choice)!;
  const list = lists.find((candidate) => candidate.id === pickedId)!;
  const count = useCallback((id: string, left: number | null) => setCounts((before) => (before[id] === left ? before : { ...before, [id]: left })), []);

  return (
    <div className="flex flex-col gap-3">
      {/* The row bleeds to the screen's edges, so the chip that does not fit is cut there. The padding keeps a focus ring inside what scrolls. */}
      <SideScroll label="Lists" className="-mx-4 -my-1 px-4 py-1">
        {pinnedFirst(lists, pinnedId).map((entry) => (
          <ListChip key={entry.id} name={entry.name} left={counts[entry.id] ?? null} pinned={entry.id === pinnedId} picked={entry.id === pickedId} onPick={() => setChoice(entry.id)} />
        ))}
      </SideScroll>
      {lists
        .filter((entry) => entry.id !== pickedId)
        .map((entry) => (
          <CountReader key={entry.id} listId={entry.id} onCount={count} />
        ))}
      {/* Keyed on the list, so what one list's card holds (its items, its failed write, the words typed in its field) never reaches another's. */}
      <ListCard key={pickedId} list={list} size="phone" pinned={list.id === pinnedId} onCount={count} />
    </div>
  );
}
