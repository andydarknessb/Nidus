import { X } from 'lucide-react';
import type { Occurrence } from '../lib/calendar-occurrences';
import type { OpenSheet } from '../lib/event-sheets';
import type { WallDay } from '../lib/paged-view';
import type { Profile } from '../lib/profiles';
import { pillPeople, type Pill } from '../lib/schedule';
import { EventDetails } from './EventDetails';
import { EventPill } from './EventPill';
import { NativeEventSheet } from './NativeEventSheet';
import { Sheet } from './Sheet';
import { Button } from './ui/button';

// The sheet that is open (lib/event-sheets.ts), drawn: an event's details, and from them Edit, for a Native Event; the list of a
// cluster the Day view folded into a "+N"; or the sheet that adds an event. Nothing until the Household Timezone is read. A screen draws
// it through useEventSheets (lib/use-event-sheets.tsx), which gives it what to do on each way out.
export function EventSheets({
  open,
  timezone,
  profiles,
  onOpen,
  onEdit,
  onClose,
  onSaved,
}: {
  open: OpenSheet;
  timezone: string | null;
  // The Household's, which say who an event is for.
  profiles: readonly Profile[];
  onOpen: (occurrence: Occurrence) => void;
  onEdit: () => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  if (!open || timezone === null) return null;
  switch (open.sheet) {
    case 'cluster':
      return <ClusterSheet day={open.day} pills={open.pills} profiles={profiles} onOpen={onOpen} onClose={onClose} />;
    case 'details':
      return <EventDetails occurrence={open.occurrence} timezone={timezone} people={pillPeople(open.occurrence, profiles)} onClose={onClose} onEdit={onEdit} />;
    case 'edit':
      return <NativeEventSheet timezone={timezone} profiles={profiles} occurrence={open.occurrence} onClose={onClose} onSaved={onSaved} />;
    case 'add':
      return <NativeEventSheet timezone={timezone} profiles={profiles} date={open.date} onClose={onClose} onSaved={onSaved} />;
  }
}

// The list a "+N" on the Day view opens: every event of that cluster, in time order, each as its pill (colour, discs, time) that
// opens its details when tapped. `pills` say their time as the blocks do ("4:00 to 4:45 PM"). A dozen events are taller than the
// screen: the title row stays in view and the list under it scrolls, and says so (Sheet).
export function ClusterSheet({
  day,
  pills,
  profiles,
  onOpen,
  onClose,
}: {
  day: WallDay;
  pills: Pill[];
  profiles: readonly Profile[];
  onOpen: (occurrence: Occurrence) => void;
  onClose: () => void;
}) {
  const title = `${pills.length} events around this time`;
  return (
    <Sheet
      labelledBy="cluster-list-title"
      title={title}
      onClose={onClose}
      className="max-w-[560px]"
      header={
        <header className="flex shrink-0 items-center justify-between gap-4">
          <h2 id="cluster-list-title" className="font-display text-[30px] leading-9">
            {title}
          </h2>
          <Button variant="quiet" aria-label="Close" onClick={onClose} className="size-12 rounded-full p-0">
            <X aria-hidden className="size-[26px]" strokeWidth={2.2} />
          </Button>
        </header>
      }
    >
      <div className="flex flex-col gap-2">
        {pills.map((pill) => (
          <EventPill key={pill.occurrence.id} pill={pill} day={day} people={pillPeople(pill.occurrence, profiles)} onOpen={onOpen} />
        ))}
      </div>
    </Sheet>
  );
}
