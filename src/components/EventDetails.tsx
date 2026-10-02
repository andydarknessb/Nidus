import { CalendarDays, Pin, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { describeWhen, type Occurrence } from '../lib/calendar-occurrences';
import { whoWords } from '../lib/day-view';
import type { PillPeople } from '../lib/schedule';
import { EventDiscs, EventFill } from './EventPill';
import { Sheet } from './Sheet';
import { Button } from './ui/button';

// What the sheet says of where an event lives, and so of where to change it: a Synced Event is read-only here and is changed in
// Google Calendar; a Native Event lives only in Nidus.
const FROM_GOOGLE = 'From Google Calendar. Change it there.';
const ADDED_HERE = 'Added here. Not in Google Calendar.';

// The details of one event, over the wall (docs/look.md, Sheets): the title, who it is for (on the event's own fill, with its
// discs and every name, or "Everyone"), when, where, the notes and, for a Synced Event, which calendar it came from. The foot says
// where the event lives; a Native Event offers Edit when `onEdit` is given. A Synced Event is read-only: it is never edited
// here. Focus moves in on open and back to the tapped event on close; Escape, the scrim and the X all close it. The title row and
// the foot stay in view however long the notes are (a Zoom invite is 15 to 30 lines): the details between them scroll, and say so.
export function EventDetails({
  occurrence,
  timezone,
  people,
  onClose,
  onEdit,
}: {
  occurrence: Occurrence;
  timezone: string;
  people: PillPeople;
  onClose: () => void;
  onEdit?: () => void;
}) {
  const native = occurrence.source === 'native';

  return (
    <Sheet
      labelledBy="event-details-title"
      title={occurrence.title}
      onClose={onClose}
      className="max-w-[640px]"
      header={
        <header className="flex shrink-0 items-start justify-between gap-4">
          <h2 id="event-details-title" className="min-w-0 pt-1 font-display text-[30px] leading-9 break-words">
            {occurrence.title}
          </h2>
          <Button variant="quiet" aria-label="Close" onClick={onClose} className="size-12 rounded-full p-0">
            <X aria-hidden className="size-[26px]" strokeWidth={2.2} />
          </Button>
        </header>
      }
      footer={
        <footer className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-3">
          <p className="flex min-w-48 flex-1 items-center gap-2 text-[17px] leading-6 font-medium">
            {native ? <Pin aria-hidden className="size-5 shrink-0" /> : <CalendarDays aria-hidden className="size-5 shrink-0" />}
            <span>{native ? ADDED_HERE : FROM_GOOGLE}</span>
          </p>
          {native && onEdit && (
            <Button variant="secondary" onClick={onEdit} className="h-14 px-6 text-[17px] font-medium">
              Edit
            </Button>
          )}
        </footer>
      }
    >
      <dl className="flex flex-col gap-4">
        <Detail label="Who">
          {/* The event's own fill and discs, as on the calendar, and every name: nobody is told apart by colour alone. */}
          <span className="relative flex items-center gap-3 rounded-[18px] py-3 pr-4 pl-3 text-foreground">
            <EventFill people={people} />
            <span className="relative flex">
              <EventDiscs people={people} />
            </span>
            <span className="relative min-w-0 font-semibold">{whoWords(people)}</span>
          </span>
        </Detail>
        <Detail label="When">{describeWhen(occurrence, timezone)}</Detail>
        {occurrence.location && <Detail label="Where">{occurrence.location}</Detail>}
        {occurrence.description && <Detail label="Notes">{occurrence.description}</Detail>}
        {!native && <Detail label="Calendar">{occurrence.calendar_name}</Detail>}
      </dl>
    </Sheet>
  );
}

// A caption over its value. A description from Google may hold markup, which is never rendered: plain text.
function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-[15px] leading-5 text-muted-foreground">{label}</dt>
      <dd className="text-[19px] leading-7 break-words whitespace-pre-wrap">{children}</dd>
    </div>
  );
}
