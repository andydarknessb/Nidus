import type { Occurrence } from './calendar-occurrences';
import type { WallDay } from './paged-view';
import type { Pill } from './schedule';

// The event sheet host's state (spec 0012), as plain TypeScript so a test needs no screen; `useEventSheets` (components/EventSheets.tsx)
// is its hook. What on a calendar has been tapped to open: an event's details, and from them Edit, for a Native Event; or the list of a
// cluster the Day view folded into a "+N", and from it an event's details; or the sheet that adds an event. null is nothing open.
export type OpenSheet =
  | { sheet: 'details'; occurrence: Occurrence }
  | { sheet: 'edit'; occurrence: Occurrence }
  | { sheet: 'add'; date: string | null }
  | { sheet: 'cluster'; day: WallDay; pills: Pill[] }
  | null;

// How long after a sheet closes a read may still find focus fallen to the page, and put it back.
export const REFOCUS_MS = 10_000;

// A sheet gives focus back to what opened it (Sheet), but a read can then take that away: an event that was deleted has no pill any
// more, and one that an edit moved is a pill somewhere else. So the host remembers the event the last sheet was open for (`id`, or null
// for a sheet that adds one) and when it closed, and for REFOCUS_MS after that a read that lands on a page with no focus is to put it
// on the event's pill if it is still on the screen, and if not on what stands for its place there (`refocus`).
//
// After a save or a delete (`saved`) the sheet closes and the screen's read is made again (`refresh`), in the one order.
export function createEventSheets(options: { refresh?: () => void; now?: () => number } = {}) {
  const now = options.now ?? Date.now;
  let open: OpenSheet = null;
  let last: { id: string | null; closedAt: number | null } | null = null;
  const listeners = new Set<() => void>();

  const set = (next: OpenSheet) => {
    open = next;
    listeners.forEach((listener) => listener());
  };
  const close = () => {
    if (open === null) return;
    if (last && last.closedAt === null) last.closedAt = now();
    set(null);
  };

  return {
    state: (): OpenSheet => open,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    // An event's details, from a pill, a block or a cluster's list.
    open(occurrence: Occurrence) {
      last = { id: occurrence.id, closedAt: null };
      set({ sheet: 'details', occurrence });
    },
    // From the details of the event that is open to Edit.
    edit() {
      if (open?.sheet !== 'details') return;
      last = { id: open.occurrence.id, closedAt: null };
      set({ sheet: 'edit', occurrence: open.occurrence });
    },
    // Edit for `occurrence` at once, with no details first (the Settings list, where a tap on an event is a change to it). It keeps the
    // same record of the last sheet as an Edit reached from the details.
    openEdit(occurrence: Occurrence) {
      last = { id: occurrence.id, closedAt: null };
      set({ sheet: 'edit', occurrence });
    },
    // The sheet that adds an event, starting on the Household Date `date`. A press before the screen knows its day (`date` null) waits:
    // it is the sheet that opens once the day is known (`dayKnown`).
    add(date: string | null) {
      last = { id: null, closedAt: null };
      set({ sheet: 'add', date });
    },
    // The screen's day is known: an add that was waiting for it opens on it.
    dayKnown(date: string) {
      if (open?.sheet === 'add' && open.date === null) set({ sheet: 'add', date });
    },
    // The list of a cluster the Day view folded into a "+N".
    cluster(day: WallDay, pills: Pill[]) {
      set({ sheet: 'cluster', day, pills });
    },
    close,
    // An event was saved or deleted from the open sheet: it closes, and the screen reads again.
    saved() {
      close();
      options.refresh?.();
    },
    // Where focus is to go, if it fell to the page: the event the last sheet was open for (null for an added one). Nothing while a sheet
    // is open, before one has closed, or once REFOCUS_MS have passed since (which forgets it).
    refocus(): { id: string | null } | null {
      if (open !== null || !last || last.closedAt === null) return null;
      if (now() - last.closedAt > REFOCUS_MS) {
        last = null;
        return null;
      }
      return { id: last.id };
    },
  };
}
