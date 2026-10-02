import { X } from 'lucide-react';
import type { Occurrence, WallDay } from '../lib/calendar-occurrences';
import type { Profile } from '../lib/profiles';
import { pillPeople, type Pill } from '../lib/schedule';
import { EventPill } from './EventPill';
import { Sheet } from './Sheet';
import { Button } from './ui/button';

// The list a "+N" on the Day view opens: every event of that cluster, in time order, each as its pill (colour, discs, time) that
// opens its details when tapped. `pills` say their time as the blocks do ("4:00 to 4:45 PM"). A dozen events are taller than the
// screen: the title row stays in view and the list under it scrolls, and says so (Sheet).
export function ClusterList({
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
