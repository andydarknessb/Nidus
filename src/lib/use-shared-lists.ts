import { useContext, useState } from 'react';
import { ChangeFeedContext } from './change-feed';
import { useChange, type CardWriteOutcome } from './change';
import { listCard, type ListCardView } from './list-card';
import { supabase } from './supabase';
import { loadItems, loadLists, loadPinnedListId, type ListItem, type SharedList } from './shared-lists';
import { couldNotLoad, useSyncedRead, type ReadStateName } from './synced-read';
import { addSuggestions, dismissSuggestions, loadSuggestions, type ListSuggestion } from './list-suggestions';
import { askShopper, type ShopperAnswer } from './shopper';

// The Shared Lists' readers and writers as hooks, one for the Wall's cards and the phone's screens alike (SharedListsPage.tsx draws
// the tablet's, src/phone/PhoneLists.tsx the phone's). Both read through the synced read (synced-read.ts). A list's card is the core in
// list-card.ts; its hook here only reads and hands the core its effects.

// What each read here listens to. The pinned list is a column of the Household.
const ITEM_TABLES = ['list_items'] as const;
export const LIST_TABLES = ['shared_lists', 'households'] as const;

const NO_ITEMS: ListItem[] = [];

// One list's card: its items, the count, and the writes (list-card.ts). The read and the change are this hook's.
export function useItems(listId: string): ListCardView {
  const read = useSyncedRead(() => loadItems(supabase, listId), ITEM_TABLES, listId);
  return listCard(
    { listId, items: read.data ?? NO_ITEMS, state: read.state },
    { client: supabase, write: read.write, change: read.change, fail: read.fail, say: read.say, clear: read.clear, problem: read.problem, isBusy: read.isBusy },
  );
}

// A list's suggestions (spec 0019), read again when they change. Adding and dismissing go through the synced read's change, one at a
// time, and a write that does not go through is said at the card's foot (`SUGGESTIONS_PLACE`), where the card's other writes say theirs.
const SUGGESTION_TABLES = ['list_suggestions'] as const;
const SUGGESTIONS_PLACE = 'suggestions';
const NO_SUGGESTIONS: ListSuggestion[] = [];

export function useSuggestions(listId: string) {
  const read = useSyncedRead(() => loadSuggestions(supabase, listId), SUGGESTION_TABLES, listId);
  const feed = useContext(ChangeFeedContext);
  // Focus goes to the card's title once the change lands, as "Clear" does (preventScroll), but only where the person left it: on the
  // pressed control, or nowhere once that control has gone. Focus they moved elsewhere while the write was out stays there.
  const settle = (pressed: Element | null) => (outcome: CardWriteOutcome) => {
    const now = document.activeElement;
    if (outcome === 'done' && (now === null || now === document.body || now === pressed)) focusTitle(listId);
    return outcome;
  };
  const said = read.problem(SUGGESTIONS_PLACE);
  return {
    suggestions: read.data ?? NO_SUGGESTIONS,
    problem: said?.words ?? (read.state === 'failed' ? couldNotLoad('the suggestions') : ''),
    // Changes each time a failure is said again, so the alert is heard again when it repeats (change.ts).
    problemKey: said?.n ?? 0,
    busy: read.busy,
    // An added suggestion is an item: the items read is told at once, not when Realtime or its 30 s poll gets to it.
    add: (ids: string[]) => {
      const pressed = document.activeElement;
      return read
        .change(SUGGESTIONS_PLACE, async () => {
          await addSuggestions(supabase, ids);
          feed?.notify(['list_items']);
        })
        .then(settle(pressed));
    },
    dismiss: (ids: string[]) => {
      const pressed = document.activeElement;
      return read.change(SUGGESTIONS_PLACE, () => dismissSuggestions(supabase, ids)).then(settle(pressed));
    },
  };
}

// The shopper (spec 0019) for this list: `asking` is true while Claude is being asked, and `answer` is the last answer. Each ask clears
// the last answer first, so its alert is taken down and a repeated answer is announced again. The ask is a change of its own (no place:
// the answers say their own words), so a second tap before the answer lands is no second ask: each one is a run. It is apart from the
// suggestions' change, so an ask of up to two minutes never blocks adding or dismissing.
export function useShopper(listId: string) {
  const ask = useChange();
  const [answer, setAnswer] = useState<ShopperAnswer | null>(null);
  return {
    asking: ask.busy,
    answer,
    ask: async (): Promise<ShopperAnswer | null> => {
      let next = null as ShopperAnswer | null;
      const outcome = await ask.change(null, async () => {
        setAnswer(null);
        next = await askShopper(supabase, listId);
        setAnswer(next);
      });
      return outcome === 'busy' ? null : next;
    },
  };
}

// Every Shared List and which one is pinned, read again when a list or the Household changes. `read` is null until the
// first read has landed (`state` says whether it is on its way or failed); a read that fails after that keeps what is shown.
export function useLists(): { read: { lists: SharedList[]; pinnedId: string | null } | null; state: ReadStateName } {
  const read = useSyncedRead(
    async () => {
      const [pinnedId, lists] = await Promise.all([loadPinnedListId(supabase), loadLists(supabase)]);
      return { lists, pinnedId };
    },
    LIST_TABLES,
    'lists',
  );
  return { read: read.data, state: read.state };
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
