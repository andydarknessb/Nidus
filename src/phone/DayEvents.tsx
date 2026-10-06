import { useState } from 'react';
import { describeCell, type Occurrence, type WallDay } from '../lib/calendar-occurrences';
import { focusElement, focusEvent } from '../lib/focus';
import type { Profile } from '../lib/profiles';
import { pillPeople, scheduleColumns } from '../lib/schedule';
import { EmptyWords } from '../components/EmptyWords';
import { EventPill } from '../components/EventPill';
import { EventSheets, type OpenEvent } from '../components/EventSheets';

// The picked day of the phone's Week and Month (docs/specs/0004-the-wall-on-a-phone.md): its full date as a heading, then its events as
// the tablet's stacked pills, and the sheets a tap opens (EventSheets: details, and Edit for a Native Event, as on the tablet). The
// screen reads the events and hands them down, already through the Profile filter (useOccurrences), so what is listed here is what the
// filter lets through; `occurrences` are null until the first read lands. `beyond` is a day past the range the calendar keeps, which
// has nothing to read and says so. The pills wait for the Profiles, as the tablet's do. `onEdited` runs after an edit is saved, so the
// screen reads again at once.
export function DayEvents({
  day,
  occurrences,
  failed,
  beyond,
  profiles,
  now,
  timezone,
  onEdited,
}: {
  day: WallDay;
  occurrences: Occurrence[] | null;
  failed: boolean;
  beyond: boolean;
  profiles: Profile[] | null;
  now: Date;
  timezone: string;
  onEdited: () => void;
}) {
  const [open, setOpen] = useState<OpenEvent>(null);
  const people = profiles ?? [];
  const loaded = profiles !== null && occurrences !== null;
  const pills = loaded ? scheduleColumns(occurrences, [day], now)[0]!.pills : [];
  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-display text-xl leading-7">{describeCell(day.date, null)}</h3>
      {beyond ? (
        <EmptyWords>Beyond the calendar's range.</EmptyWords>
      ) : failed && occurrences === null ? (
        <p role="alert" className="text-base">
          Could not load the calendar. Check your connection.
        </p>
      ) : !loaded ? (
        <EmptyWords>Loading</EmptyWords>
      ) : pills.length === 0 ? (
        <EmptyWords>{day.isToday ? 'Nothing scheduled today.' : 'Nothing scheduled.'}</EmptyWords>
      ) : (
        pills.map((pill) => <EventPill key={pill.occurrence.id} pill={pill} day={day} people={pillPeople(pill.occurrence, people)} onOpen={(occurrence) => setOpen({ sheet: 'details', occurrence })} />)
      )}
      <EventSheets
        open={open}
        onChange={setOpen}
        timezone={timezone}
        date={day.date}
        profiles={people}
        occurrences={occurrences}
        onEdited={onEdited}
        // After an event is deleted from its sheet, or moved by an edit: to its pill if it is still listed, else the day's chip or cell.
        returnFocus={(occurrence) => {
          if (!focusEvent(occurrence.id)) focusElement(document.querySelector<HTMLElement>(`[data-day="${day.date}"]`));
        }}
      />
    </div>
  );
}
