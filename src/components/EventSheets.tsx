import { useEffect, useRef } from 'react';
import type { Occurrence } from '../lib/calendar-occurrences';
import type { WallDay } from '../lib/paged-view';
import { focusEvent } from '../lib/focus';
import type { Profile } from '../lib/profiles';
import { pillPeople, type Pill } from '../lib/schedule';
import { ClusterList } from './ClusterList';
import { EventDetails } from './EventDetails';
import { NativeEventSheet } from './NativeEventSheet';

// What on the calendar has been tapped to open: an event's details, and from them Edit, for a Native Event; or the list of a
// cluster the Day view folded into a "+N", and from it an event's details. The calendar view keeps this in a `useState` so it
// can open a sheet from a pill, a block or a "+N"; null is nothing open.
export type OpenEvent = { sheet: 'details' | 'edit'; occurrence: Occurrence } | { sheet: 'cluster'; day: WallDay; pills: Pill[] } | null;

// How long after a sheet closes a read may still find focus fallen to the page, and put it back.
const REFOCUS_MS = 10_000;

// The event sheet host: the sheet `open` names, over the Wall, for every calendar view. `date` is the day the calendar is on, which
// an edit starts from; `events` is the view's day events (useDayEvents), read again here after an edit is saved. `profiles` are the
// Household's, which say who an event is for. Focus moves in on open and back to the tapped event on close (Sheet), so going from the
// list to the details, or from the details to Edit, hands it on without losing it.
//
// A read can take that element away: an event that was deleted has no pill any more, and one that an edit moved is a pill somewhere
// else. So when what the view has read changes soon after a sheet closed and focus is on the page, focus goes to the event's pill or
// block if it is still on the screen, and if not to what stands for its place there, which the view names: `focusPlace` (the heading
// of its day).
export function EventSheets({
  open,
  onChange,
  timezone,
  date,
  profiles,
  events,
  focusPlace,
}: {
  open: OpenEvent;
  onChange: (open: OpenEvent) => void;
  timezone: string;
  date: string;
  profiles: readonly Profile[];
  events: { occurrences: Occurrence[] | null; refresh: () => void };
  focusPlace: () => void;
}) {
  const { occurrences, refresh } = events;
  // The view's way to its event's place, as it is on the render the focus is put back in.
  const place = useRef(focusPlace);
  useEffect(() => {
    place.current = focusPlace;
  });
  // The event a sheet was last open for, and when that sheet closed (null while it is open).
  const last = useRef<{ occurrence: Occurrence; closedAt: number | null } | null>(null);
  useEffect(() => {
    if (open && open.sheet !== 'cluster') last.current = { occurrence: open.occurrence, closedAt: null };
    else if (open === null && last.current && last.current.closedAt === null) last.current.closedAt = Date.now();
  }, [open]);
  // Looked at a frame later, when what the read has drawn has settled (the schedule holds out of reach the pills that do not fit).
  useEffect(() => {
    const target = last.current;
    if (open !== null || !target || target.closedAt === null || occurrences === null) return;
    if (Date.now() - target.closedAt > REFOCUS_MS) {
      last.current = null;
      return;
    }
    const frame = requestAnimationFrame(() => {
      if (document.activeElement === document.body && !focusEvent(target.occurrence.id)) place.current();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, occurrences]);

  if (!open) return null;
  if (open.sheet === 'cluster') {
    return <ClusterList day={open.day} pills={open.pills} profiles={profiles} onOpen={(occurrence) => onChange({ sheet: 'details', occurrence })} onClose={() => onChange(null)} />;
  }
  const { occurrence } = open;
  return open.sheet === 'details' ? (
    <EventDetails
      occurrence={occurrence}
      timezone={timezone}
      people={pillPeople(occurrence, profiles)}
      onClose={() => onChange(null)}
      onEdit={() => onChange({ sheet: 'edit', occurrence })}
    />
  ) : (
    <NativeEventSheet
      timezone={timezone}
      profiles={profiles}
      date={date}
      occurrence={occurrence}
      onClose={() => onChange(null)}
      onSaved={() => {
        onChange(null);
        refresh();
      }}
    />
  );
}
