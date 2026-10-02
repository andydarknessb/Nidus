import type { Occurrence, WallDay } from '../lib/calendar-occurrences';
import type { Profile } from '../lib/profiles';
import { pillPeople, type Pill } from '../lib/schedule';
import { ClusterList } from './ClusterList';
import { EventDetails } from './EventDetails';
import { NativeEventSheet } from './NativeEventSheet';

// What on the calendar has been tapped to open: an event's details, and from them Edit, for a Native Event; or the list of a
// cluster the Day view folded into a "+N", and from it an event's details. The calendar view keeps this in a `useState` so it
// can open a sheet from a pill, a block or a "+N"; null is nothing open.
export type OpenEvent = { sheet: 'details' | 'edit'; occurrence: Occurrence } | { sheet: 'cluster'; day: WallDay; pills: Pill[] } | null;

// The sheet `open` names, over the Wall. `date` is the day the calendar is on, which an edit starts from, and `onEdited` runs
// after an edit is saved, so the calendar can read again at once. `profiles` are the Household's, which say who an event is for.
// Focus moves in on open and back to the tapped event on close (Sheet), so going from the list to the details, or from the
// details to Edit, hands it on without losing it.
export function EventSheets({
  open,
  onChange,
  timezone,
  date,
  profiles,
  onEdited,
}: {
  open: OpenEvent;
  onChange: (open: OpenEvent) => void;
  timezone: string;
  date: string;
  profiles: readonly Profile[];
  onEdited: () => void;
}) {
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
      date={date}
      occurrence={occurrence}
      onClose={() => onChange(null)}
      onSaved={() => {
        onChange(null);
        onEdited();
      }}
    />
  );
}
