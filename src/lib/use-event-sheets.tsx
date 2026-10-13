import { useEffect, useRef, useState } from 'react';
import { EventSheets } from '../components/EventSheets';
import { createEventSheets } from './event-sheets';
import { focusEvent } from './focus';
import type { Profile } from './profiles';

// The event sheet host (spec 0012): the sheets over the Wall for every screen that shows events. A screen calls `open(occurrence)` for
// an event's details (and from them Edit, for a Native Event), `cluster(day, pills)` for the list a "+N" on the Day view folds, or
// `add(date)` for the sheet that adds one, and draws `sheets`, the element for whichever is open. The rules of what is open, what is
// remembered of the last sheet and when it is used are the core's (lib/event-sheets.ts); this is its hook, and components/EventSheets.tsx
// draws the sheets.
//
// After an event is saved or deleted, one rule for every screen: the sheet closes and the screen reads again (`refresh`, the read it
// holds), and focus goes back to where the sheet was opened from (Sheet). A read can then take that away: an event that was deleted has
// no pill any more, and one that an edit moved is a pill somewhere else. So when what the screen has read changes (`drawn`, any value
// that does, null until something has been read) soon after a sheet closed and focus is on the page, focus goes to the event's pill
// or block if it is still on the screen, and if not to what stands for its place there, which the screen names: `focusPlace` (the
// heading of its day, the page's title, the Add event button).
export function useEventSheets({
  timezone,
  profiles,
  refresh,
  focusPlace,
  drawn,
}: {
  // None until the Household has been read: no sheet is drawn.
  timezone: string | null;
  // The Household's, which say who an event is for.
  profiles: readonly Profile[];
  refresh: () => void;
  focusPlace?: () => void;
  drawn?: unknown;
}) {
  // The screen's way to read again and to its event's place, as they are on the render they are used in.
  const latest = useRef({ refresh, focusPlace });
  useEffect(() => {
    latest.current = { refresh, focusPlace };
  });
  const [core] = useState(() => createEventSheets({ refresh: () => latest.current.refresh() }));
  const [open, setOpen] = useState(core.state);
  useEffect(() => {
    setOpen(core.state());
    return core.subscribe(() => setOpen(core.state()));
  }, [core]);

  // Looked at a frame later, when what the read has drawn has settled (the schedule holds out of reach the pills that do not fit).
  useEffect(() => {
    if (drawn === null || drawn === undefined) return;
    const target = core.refocus();
    if (!target) return;
    const frame = requestAnimationFrame(() => {
      if (document.activeElement === document.body && !(target.id !== null && focusEvent(target.id))) latest.current.focusPlace?.();
    });
    return () => cancelAnimationFrame(frame);
  }, [core, open, drawn]);

  const sheets = <EventSheets open={open} timezone={timezone} profiles={profiles} onOpen={core.open} onEdit={core.edit} onClose={core.close} onSaved={core.saved} />;
  return { open: core.open, cluster: core.cluster, add: core.add, close: core.close, sheets };
}

