import type { SupabaseClient } from '@supabase/supabase-js';
import type { CardWriteOutcome, ChangeThen, WriteProblem } from './change';
import { byPosition, movedIds, nextSortOrder } from './ordering';
import {
  addItem,
  clearCompleted,
  gotListItems,
  lastSentMs,
  leftToGet,
  markListSent,
  reorderItems,
  setCrossed,
  waitingItems,
  withCrossed,
  withGot,
  withoutCrossed,
  withSent,
  type ListItem,
} from './shared-lists';
import { couldNotLoad, type ReadStateName, type SyncedRead } from './synced-read';

// The Shared List card (spec 0020, ticket 1): one list's items, how many are left to get, and the writes the card makes, as one function over
// the list's facts and its effects, with no screen. tests/list-card-core.test.ts drives it with a real synced read and a real change;
// use-shared-lists.ts is the thin hook over it. Adding, crossing off, clearing and moving show at once as pending changes. A write that does
// not go through takes back only itself and is said at the list's place (`items-<list>`), which a write that lands clears. Send and Got it
// each keep their own place.

// A row shown for an item the server has not stored yet has an id that says so ("pending-1"). It cannot be crossed off or moved until the
// stored row has taken its place, which is a moment.
const PENDING = 'pending-';
export const isPending = (item: ListItem) => item.id.startsWith(PENDING);
// Module-wide, so two cards never give two rows the same id.
let pendings = 0;

export type ListCardFacts = {
  listId: string;
  // What the read holds, with each pending change shown (the synced read's data), or nothing until it lands.
  items: ListItem[];
  state: ReadStateName;
  // Whether a change is on its way, as the change's last draw says.
  busy: boolean;
};

export type ListCardEffects = {
  // The client the card writes as: a Household Account or a Device.
  client: SupabaseClient;
  // The synced read's write, and the change's: `change` is run with the read, `fail`, `say`, `clear` and `problem` are the change's places.
  write: SyncedRead<ListItem[]>['write'];
  change: <R>(place: string | null, work: () => Promise<R>, then?: ChangeThen<R, ListItem[]>) => Promise<CardWriteOutcome>;
  fail(place: string, error: unknown): void;
  say(place: string, words: string): void;
  clear(place?: string): void;
  problem(place: string): WriteProblem | null;
};

export type ListCardView = {
  items: ListItem[];
  // How many are left to get, or null while that is not known: until the items are read, and whenever the last read or write failed.
  left: number | null;
  crossed: number;
  toGet: ListItem[];
  waiting: ListItem[];
  // The time the last waiting item was sent, in ms; null when none waits.
  sentAt: number | null;
  // What did not save at the list, and the count that changes each time it is said again (the alert's key).
  problem: string;
  problemKey: number;
  // What the Send to Target and Got it sheets say when their write did not save.
  sentProblem: string;
  gotProblem: string;
  busy: boolean;
  clearSends(): void;
  add(text: string): Promise<ListItem | null>;
  toggle(item: ListItem): Promise<void>;
  clear(): Promise<void>;
  move(id: string, offset: number): Promise<void>;
  markSent(): Promise<CardWriteOutcome>;
  gotItems(came: string[]): Promise<CardWriteOutcome>;
};

export function listCard({ listId, items, state, busy }: ListCardFacts, effects: ListCardEffects): ListCardView {
  const place = `items-${listId}`;
  const sentPlace = `sent-${listId}`;
  const gotPlace = `got-${listId}`;
  const failure = effects.problem(place);
  // Items already shown stay when a later read fails; a read that failed before anything landed says so.
  const problem = failure?.words ?? (state === 'failed' ? couldNotLoad('this list') : '');
  const waiting = waitingItems(items);

  return {
    items,
    left: leftToGet(state !== 'loading', problem, items),
    crossed: items.length - withoutCrossed(items).length,
    toGet: withoutCrossed(items),
    waiting,
    sentAt: lastSentMs(waiting),
    problem,
    problemKey: failure?.n ?? 0,
    sentProblem: effects.problem(sentPlace)?.words ?? '',
    gotProblem: effects.problem(gotPlace)?.words ?? '',
    busy,
    clearSends() {
      effects.clear(sentPlace);
      effects.clear(gotPlace);
    },

    async add(text) {
      const pending: ListItem = { id: `${PENDING}${(pendings += 1)}`, list_id: listId, text: text.trim(), crossed_at: null, sent_at: null, sort_order: nextSortOrder(items) };
      try {
        const created = await effects.write(
          () => addItem(effects.client, listId, text, pending.sort_order),
          (rows) => [...rows, pending],
          (stored) => (rows) => rows.map((row) => (row.id === pending.id ? stored : row)),
        );
        effects.clear(place);
        return created;
      } catch (error) {
        effects.fail(place, error);
        return null;
      }
    },

    async toggle(item) {
      if (isPending(item)) return;
      const crossed = item.crossed_at === null;
      try {
        await effects.write(() => setCrossed(effects.client, item.id, crossed), (rows) => withCrossed(rows, item.id, crossed));
        effects.clear(place);
      } catch (error) {
        effects.fail(place, error);
      }
    },

    async clear() {
      try {
        await effects.write(() => clearCompleted(effects.client, listId), withoutCrossed);
        effects.clear(place);
      } catch (error) {
        effects.fail(place, error);
      }
    },

    async move(id, offset) {
      if (items.some(isPending)) return;
      const ids = movedIds(items.map((item) => item.id), id, offset);
      try {
        await effects.write(
          () => reorderItems(effects.client, ids),
          (rows) => byPosition(ids.flatMap((itemId, index) => rows.filter((row) => row.id === itemId).map((row) => ({ ...row, sort_order: index })))),
        );
        effects.clear(place);
      } catch {
        // The old order is back at once; the read that follows the write replaces it with what the database holds (some of the writes may
        // have landed) once the connection allows. The words hold whether or not that read gets through, so they never claim what is saved.
        effects.say(place, 'Could not reorder. The order may not be saved. Check your connection.');
      }
    },

    // The items to get are sent, once the sheet's Open, Share or Copy has gone through; the rows show them sent until the read lands.
    markSent() {
      const now = new Date();
      return effects.change(sentPlace, () => markListSent(effects.client, listId), { meanwhile: () => (rows) => withSent(rows, now) });
    },

    // Got it: the waiting items in `came` are crossed off and the rest stop waiting.
    gotItems(came) {
      const now = new Date();
      return effects.change(gotPlace, () => gotListItems(effects.client, listId, came), { meanwhile: () => (rows) => withGot(rows, came, now) });
    },
  };
}
