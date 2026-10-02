import type { Occurrence } from '../lib/calendar-occurrences';
import { EventDetails } from './EventDetails';
import { NativeEventSheet } from './NativeEventSheet';

// What an event on the calendar has been tapped to open: its details, and from them Edit, for a Native Event. The
// calendar view keeps this in a `useState` so it can open a sheet from a pill or a block; null is nothing open.
export type OpenEvent = { sheet: 'details' | 'edit'; occurrence: Occurrence } | null;

// The sheet `open` names, over the Wall. `date` is the day the calendar is on, which an edit starts from, and `onEdited`
// runs after an edit is saved, so the calendar can read again at once. Focus moves in on open and back to the tapped
// event on close (EventDetails), so going from the details to Edit hands it on without losing it.
export function EventSheets({
  open,
  onChange,
  timezone,
  date,
  onEdited,
}: {
  open: OpenEvent;
  onChange: (open: OpenEvent) => void;
  timezone: string;
  date: string;
  onEdited: () => void;
}) {
  if (!open) return null;
  const { occurrence } = open;
  return open.sheet === 'details' ? (
    <EventDetails occurrence={occurrence} timezone={timezone} onClose={() => onChange(null)} onEdit={() => onChange({ sheet: 'edit', occurrence })} />
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
