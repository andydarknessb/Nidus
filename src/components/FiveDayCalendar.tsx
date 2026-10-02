import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  describeCell,
  describeMonth,
  describePage,
  fiveDays,
  pageDays,
  pageStart,
  paging,
  pagingWindow,
  shownDate,
  type CalendarView,
  type WallDay,
} from '../lib/calendar-occurrences';
import { emptyRowWords, HOUR_REM, hoursThatFit, planDay } from '../lib/day-view';
import { focusEvent } from '../lib/focus';
import { ProfileFilterContext } from '../lib/profile-filter';
import type { Profile } from '../lib/profiles';
import { householdDay } from '../lib/routines';
import { useNow, useOccurrences } from '../lib/wall-hooks';
import { forecastDay, type Forecast } from '../lib/weather';
import { HourGrid, PillRow } from './DayGrid';
import { EventSheets, type OpenEvent } from './EventSheets';
import { MonthGrid } from './MonthGrid';
import { Schedule } from './Schedule';
import { Button } from './ui/button';
import { DayWeather } from './Weather';

// The wall's calendar views. Home (today and the next four days) and Week (Sunday to Saturday) draw the schedule: a
// column for each day with its events stacked as pills (Schedule.tsx). The Day view keeps the hour grid, at 3 rem an hour:
// one row above it for the all-day events and what ended before its hours, one below for what starts after them, and a
// line at the current time behind the blocks. In all of them, tapping an event opens its details. An event is filled from
// its Profiles' own colours, never from the Mirrored Calendar it came from.

// The home screen: today and the next four days. `version` changes when the screen around the calendar has written an
// event, so the calendar reads again at once. `forecast` is the Household's weather, read once by the screen around the
// calendar; `weatherOn` says the Household has a place, so each day heading keeps a line for it (empty while there is no
// forecast, or none for that day). `profiles` are the Household's, read once by that screen: they colour the events, and
// are null until read. A touch anywhere in the calendar keeps the Profile filter open.
export function FiveDayCalendar({
  timezone,
  version = 0,
  onNavigate,
  forecast = null,
  weatherOn = false,
  profiles,
}: {
  timezone: string;
  version?: number;
  onNavigate: (view: CalendarView, date: string) => void;
  forecast?: Forecast | null;
  weatherOn?: boolean;
  profiles: Profile[] | null;
}) {
  const now = useNow(timezone);
  const { touch } = useContext(ProfileFilterContext);
  return (
    <div className="contents" onPointerDownCapture={touch}>
      <Schedule
        timezone={timezone}
        now={now}
        days={fiveDays(timezone, now)}
        version={version}
        onOpenDay={(date) => onNavigate('day', date)}
        forecast={forecast}
        weatherOn={weatherOn}
        profiles={profiles}
      />
    </div>
  );
}

// The paging row's round buttons: the card's colour on the page, an arrow in each, named "Previous week" and so on.
const PAGE_ARROW = 'size-12 rounded-full bg-card p-0';

// The week, day and month views: the week is the schedule with seven columns, the day the hour grid and a month a grid
// of its own, each under a header to page back and forward within the synced window and jump to today. `date` is the
// page's anchor (null for today); a date outside the window is pulled to its nearest end. A touch anywhere on the page
// keeps the Profile filter open.
export function PagedCalendar({
  timezone,
  view,
  date,
  version = 0,
  onNavigate,
  forecast = null,
  weatherOn = false,
  profiles,
}: {
  timezone: string;
  view: CalendarView;
  date: string | null;
  version?: number;
  onNavigate: (view: CalendarView, date: string) => void;
  forecast?: Forecast | null;
  weatherOn?: boolean;
  profiles: Profile[] | null;
}) {
  const now = useNow(timezone);
  const { touch } = useContext(ProfileFilterContext);
  const window = pagingWindow(timezone, now);
  const today = householdDay(timezone, now).date;
  const anchor = pageStart(view, shownDate(date, today));
  // A week or a day is a run of days; a month is a grid of weeks of its own.
  const days = view === 'month' ? null : pageDays(view, anchor, timezone, now);
  const day = view === 'day' ? days?.[0] : undefined;
  const { previous, next } = paging(view, anchor, window);
  // Paging may disable or remove the button that was pressed: put focus on the page title instead of losing it. It is also
  // where focus goes on the Day view when the event it would return to has been deleted.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), [view, anchor]);

  return (
    <div className="flex min-h-0 flex-col gap-3" onPointerDownCapture={touch}>
      <nav aria-label="Calendar paging" className="flex flex-none flex-wrap items-center gap-2">
        <Button aria-label={`Previous ${view}`} className={PAGE_ARROW} disabled={previous === null} onClick={() => previous && onNavigate(view, previous)}>
          <ChevronLeft aria-hidden className="size-6" strokeWidth={2.2} />
        </Button>
        <Button className="h-12 rounded-full bg-card px-5 text-[15px]" onClick={() => onNavigate(view, pageStart(view, today))}>
          Today
        </Button>
        <Button aria-label={`Next ${view}`} className={PAGE_ARROW} disabled={next === null} onClick={() => next && onNavigate(view, next)}>
          <ChevronRight aria-hidden className="size-6" strokeWidth={2.2} />
        </Button>
        <h2
          ref={heading}
          tabIndex={-1}
          aria-current={day?.isToday ? 'date' : undefined}
          aria-label={day?.isToday ? `Today, ${describeCell(day.date, null)}` : undefined}
          className="ml-3 flex items-center gap-3 font-display text-[28px] leading-[34px] outline-none"
        >
          {day ? <DayTitle day={day} /> : days ? describePage(days) : describeMonth(anchor)}
        </h2>
        {/* The day's weather, at the right of the row. */}
        {day && (
          <span className="ml-auto pr-2">
            <DayWeather day={forecastDay(forecast, day.date)} />
          </span>
        )}
      </nav>
      {/* Always mounted, so a screen reader announces the text when it appears. */}
      <p role="status" className="text-lg empty:hidden">
        {previous === null
          ? 'This is as far back as the calendar goes. It keeps one month of past events.'
          : next === null
            ? 'This is as far ahead as the calendar goes. It keeps six months of upcoming events.'
            : ''}
      </p>
      {/* Keyed on the view and the page, so a turned page, or the other view starting on the same day, never shows the last page's events, and a failed read says so. */}
      {days && view === 'week' ? (
        // A week's day headings open that day.
        <Schedule
          key={`${view}:${days[0]!.date}`}
          timezone={timezone}
          now={now}
          days={days}
          version={version}
          onOpenDay={(date) => onNavigate('day', date)}
          forecast={forecast}
          weatherOn={weatherOn}
          profiles={profiles}
        />
      ) : day ? (
        <DayView key={`${view}:${day.date}`} timezone={timezone} now={now} day={day} version={version} profiles={profiles} focusHeading={() => heading.current?.focus()} />
      ) : (
        // The month's cells carry no weather: the spec puts it on the day headings of Home, Day and Week.
        <MonthGrid key={`${view}:${anchor}`} timezone={timezone} today={today} anchor={anchor} window={window} version={version} onOpenDay={(date) => onNavigate('day', date)} profiles={profiles} />
      )}
    </div>
  );
}

// The Day view's title in the paging row: the date in words ("Thursday, October 1"). Today is the schedule's heading in a line:
// the date in a 38 px --primary disc and the word "Today", then the date in words, so today is found the same way on every
// view. The disc is for the eye: the page title is named by "Today, Thursday, October 1".
function DayTitle({ day }: { day: WallDay }) {
  const words = describeCell(day.date, null);
  if (!day.isToday) return words;
  return (
    <>
      <span aria-hidden className="grid size-[38px] shrink-0 place-items-center rounded-full bg-primary text-[21px] leading-none text-primary-foreground">
        {Number(day.date.slice(8))}
      </span>
      <span>Today</span>
      <span className="font-sans text-[17px] leading-6 text-muted-foreground">{words}</span>
    </>
  );
}

// What the 1280 x 800 Wall holds, until the room for the grid has been measured: the drawing's eight hours.
const FIT_UNTIL_MEASURED = 8;

// The Day view: the hour grid, 3 rem an hour (docs/look.md; spec 0003, Day view). Above it one row holds the day's all-day
// events and then the timed ones that ended before its first hour; below it one row holds the ones that start after its last.
// Both rows keep their place whatever they hold, so the hours the grid shows (the whole hours that fit in what is left, measured
// here and decided by planDay) never depend on them. A row with more pills than fit scrolls sideways. Events that overlap sit
// side by side, two at most; a cluster of more folds into a "+N" in the second lane that opens a list of it. The blocks wait for
// the Profiles, as the schedule's pills do, and are filled from them. Tapping an event opens its details; after an event is
// deleted from its sheet, or moved by an edit, focus goes to its new pill or block, or to the page title (`focusHeading`) if it is
// not on the day any more, and never to the page (EventSheets).
function DayView({
  timezone,
  now,
  day,
  version,
  profiles,
  focusHeading,
}: {
  timezone: string;
  now: Date;
  day: WallDay;
  version: number;
  profiles: Profile[] | null;
  focusHeading: () => void;
}) {
  // The event tapped and the sheet it opened, and a count of the edits made here, so the read runs again after one.
  const [open, setOpen] = useState<OpenEvent>(null);
  const [edits, setEdits] = useState(0);
  // An edit made here counts into `version`, so it reads again like an event added around the calendar.
  const { occurrences, failed } = useOccurrences([day], version + edits);
  const loaded = profiles !== null && occurrences !== null;
  const people = profiles ?? [];

  // The room for the grid is what is left between the row above it and the row below it, which keep their height: the hours that
  // fit are whole 3 rem hours of it. Measured again when the room changes.
  const room = useRef<HTMLDivElement>(null);
  const later = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(FIT_UNTIL_MEASURED);
  useLayoutEffect(() => {
    const element = room.current;
    if (!element) return;
    const measure = () => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const gap = parseFloat(getComputedStyle(element).rowGap) || 0;
      setFit(hoursThatFit(element.clientHeight - gap - (later.current?.offsetHeight ?? 0), HOUR_REM * rem));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const plan = planDay({ occurrences: loaded ? occurrences : [], day, now, fit });

  return (
    <section
      aria-label={`${describeCell(day.date, null)}${day.isToday ? ', today' : ''}`}
      className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden rounded-3xl bg-card py-3 pr-3 pl-2"
    >
      {failed && occurrences === null && (
        <p role="alert" className="px-4 py-2 text-xl">
          Could not load the calendar. Check your connection.
        </p>
      )}
      <PillRow label="Earlier" name="All day and earlier" pills={plan.above} day={day} people={people} empty={loaded ? emptyRowWords('earlier', day.isToday) : ''} onOpen={(occurrence) => setOpen({ sheet: 'details', occurrence })} />
      <div ref={room} className="flex min-h-0 flex-1 flex-col gap-2">
        <HourGrid
          plan={plan}
          day={day}
          people={people}
          onOpen={(occurrence) => setOpen({ sheet: 'details', occurrence })}
          onFold={(fold) => setOpen({ sheet: 'cluster', day, pills: fold.pills })}
        />
        <PillRow
          ref={later}
          label="Later"
          name="Later"
          pills={plan.below}
          day={day}
          people={people}
          empty={loaded ? emptyRowWords('later', day.isToday) : ''}
          onOpen={(occurrence) => setOpen({ sheet: 'details', occurrence })}
        />
      </div>
      <EventSheets
        open={open}
        onChange={setOpen}
        timezone={timezone}
        date={day.date}
        profiles={people}
        occurrences={occurrences}
        onEdited={() => setEdits((count) => count + 1)}
        // After an event is deleted from its sheet, or moved by an edit: to its new pill or block if it is still on the day, else the title.
        returnFocus={(occurrence) => {
          if (!focusEvent(occurrence.id)) focusHeading();
        }}
      />
    </section>
  );
}
