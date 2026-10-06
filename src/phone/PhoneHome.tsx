import { useContext, useRef, useState } from 'react';
import { BeforeHousehold } from '../components/BeforeHousehold';
import { EmptyWords } from '../components/EmptyWords';
import { EventPill } from '../components/EventPill';
import { EventSheets, type OpenEvent } from '../components/EventSheets';
import { UpNext } from '../components/UpNext';
import { DayWeather } from '../components/Weather';
import { describeCell, fiveDays } from '../lib/calendar-occurrences';
import { focusElement, focusEvent } from '../lib/focus';
import { ProfileFilterContext } from '../lib/profile-filter';
import { UP_NEXT_TILES } from '../lib/routines';
import { pillPeople, scheduleColumns } from '../lib/schedule';
import { useNow, useOccurrences } from '../lib/wall-hooks';
import { forecastDay } from '../lib/weather';
import type { PhoneScreenProps } from '../PhoneWall';
import { PinnedListCard } from '../SharedListsPage';
import { PhoneCard } from './parts';

// Home on a phone (docs/specs/0004-the-wall-on-a-phone.md, Screens, Home): the people strip (the shell draws it), then one column of
// three cards the page scrolls: Today, Up next and the Pinned List. Each is the tablet's own, with nothing read that the tablet does
// not read: today's events are the occurrence read the five-day schedule makes, for one day, drawn as its stacked pills.

// The most rows the Pinned List's card shows before it says how many more ("3 more", to the Lists screen). The tablet's card shows the
// rows that fit the height it is given; the phone's column has no height to give, so it is a count.
const PHONE_LIST_ROWS = 6;

// Today: today's disc, "Today", the day's high and low when the Household has weather, then every event of the day as the schedule's
// stacked pills, ringed when on now, in the schedule's order and filtered by the strip (the Profile filter, in useOccurrences). The
// day is the Household's today, so it moves on at Household midnight with no reload (useNow). Tapping a pill opens its details,
// and from them a Native Event is changed or deleted (EventSheets).
function TodayCard({ timezone, added, forecast, weatherOn, profiles }: Pick<PhoneScreenProps, 'added' | 'forecast' | 'weatherOn' | 'profiles'> & { timezone: string }) {
  const now = useNow(timezone);
  const { touch } = useContext(ProfileFilterContext);
  const day = fiveDays(timezone, now)[0]!;
  const [open, setOpen] = useState<OpenEvent>(null);
  // An edit made here counts into `version`, so the day reads again like an event added around the calendar.
  const [edits, setEdits] = useState(0);
  const { occurrences, failed } = useOccurrences([day], added + edits);
  const heading = useRef<HTMLHeadingElement>(null);
  // Until the Profiles are read the pills wait, as the schedule's do.
  const [column] = scheduleColumns(profiles === null ? [] : (occurrences ?? []), [day], now);
  const pills = column!.pills;
  const people = profiles ?? [];
  const weather = weatherOn ? forecastDay(forecast, day.date) : undefined;

  return (
    <div className="contents" onPointerDownCapture={touch}>
      <PhoneCard label="Today">
        <div className="flex min-h-12 items-center gap-3 px-1">
          <span aria-hidden className="grid size-[38px] shrink-0 place-items-center rounded-full bg-primary font-display text-[21px] leading-none text-primary-foreground">
            {Number(day.date.slice(8))}
          </span>
          <h2 ref={heading} tabIndex={-1} aria-label={`Today, ${describeCell(day.date, null)}`} className="font-display text-[22px] leading-7 outline-none">
            Today
          </h2>
          <span className="ml-auto">
            <DayWeather day={weather} />
          </span>
        </div>
        {failed && occurrences === null && (
          <p role="alert" className="px-1 text-base">
            Could not load the calendar. Check your connection.
          </p>
        )}
        {!failed && occurrences === null && <EmptyWords className="px-1">Loading</EmptyWords>}
        {occurrences !== null && profiles !== null && pills.length === 0 && <EmptyWords className="px-1">Nothing scheduled today.</EmptyWords>}
        {pills.length > 0 && (
          <div className="flex flex-col gap-2">
            {pills.map((pill) => (
              <EventPill key={pill.occurrence.id} pill={pill} day={day} people={pillPeople(pill.occurrence, people)} onOpen={(occurrence) => setOpen({ sheet: 'details', occurrence })} />
            ))}
          </div>
        )}
        <EventSheets
          open={open}
          onChange={setOpen}
          timezone={timezone}
          date={day.date}
          profiles={people}
          occurrences={occurrences}
          onEdited={() => setEdits((count) => count + 1)}
          // After an event is deleted from its sheet, or moved by an edit: to its pill if it is still on today, else the card's heading.
          returnFocus={(occurrence) => {
            if (!focusEvent(occurrence.id)) focusElement(heading.current);
          }}
        />
      </PhoneCard>
    </div>
  );
}

export function PhoneHome({ timezone, view, added, forecast, weatherOn, profiles, routines, openRoutines, openLists }: PhoneScreenProps) {
  return (
    <>
      {timezone ? (
        <TodayCard timezone={timezone} added={added} forecast={forecast} weatherOn={weatherOn} profiles={profiles} />
      ) : (
        <BeforeHousehold label="Calendar" failed={view.failed} words="Could not load the calendar. Check your connection." />
      )}
      {/* Three tiles, whatever the phone's height: the column scrolls, so there is no card under it for them to leave without a row. */}
      <UpNext routines={routines} failed={view.failed} onOpenRoutines={openRoutines} tiles={UP_NEXT_TILES} />
      <PinnedListCard onOpenLists={openLists} limit={PHONE_LIST_ROWS} />
    </>
  );
}
