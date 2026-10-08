import { useState } from 'react';
import { describeCell } from '../lib/calendar-occurrences';
import type { WallDay } from '../lib/paged-view';
import { focusElement } from '../lib/focus';
import type { Profile } from '../lib/profiles';
import { pillPeople, scheduleColumns } from '../lib/schedule';
import type { DayEventsRead } from '../lib/wall-hooks';
import { EmptyWords } from '../components/EmptyWords';
import { EventPill } from '../components/EventPill';
import { EventSheets, type OpenEvent } from '../components/EventSheets';

// The picked day of the phone's Week and Month (docs/specs/0004-the-wall-on-a-phone.md): its full date as a heading, then its events as
// the tablet's stacked pills, and the sheets a tap opens (EventSheets: details, and Edit for a Native Event, as on the tablet). The
// screen reads the day events and hands them down (useDayEvents), so what is listed here is what the Profile filter lets through, and
// nothing until the first read and the Profiles have landed. `beyond` is a day past the range the calendar keeps, which has nothing to
// read and says so. A failed read is said as an alert unless `announce` is false, for the Month, whose grid already alerts for the same
// failure.
export function DayEvents({
  day,
  events,
  beyond,
  profiles,
  now,
  timezone,
  announce = true,
}: {
  day: WallDay;
  events: DayEventsRead;
  beyond: boolean;
  profiles: Profile[] | null;
  now: Date;
  timezone: string;
  announce?: boolean;
}) {
  const [open, setOpen] = useState<OpenEvent>(null);
  const people = profiles ?? [];
  const occurrences = events.on(day);
  const pills = occurrences === null ? [] : scheduleColumns(occurrences, [day], now)[0]!.pills;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-[15px] leading-5 font-medium text-muted-foreground">{describeCell(day.date, null)}</h3>
      {beyond ? (
        <EmptyWords>Beyond the calendar's range.</EmptyWords>
      ) : events.problem ? (
        <p role={announce ? 'alert' : undefined} className="text-base">
          {events.problem}
        </p>
      ) : occurrences === null ? (
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
        events={events}
        // After an event is deleted from its sheet, or moved by an edit, and is not listed any more: the day's chip or cell.
        focusPlace={() => focusElement(document.querySelector<HTMLElement>(`[data-day="${day.date}"]`))}
      />
    </div>
  );
}
