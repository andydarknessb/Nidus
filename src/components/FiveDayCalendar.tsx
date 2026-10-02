import { ChevronLeft, ChevronRight, Pin } from 'lucide-react';
import { useContext, useEffect, useLayoutEffect, useRef, useState, type Ref } from 'react';
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
  type Occurrence,
  type WallDay,
} from '../lib/calendar-occurrences';
import { emptyRowWords, HOUR_REM, hoursThatFit, hourWords, planDay, type DayBlock, type DayPlan, type FoldTile } from '../lib/day-view';
import { ProfileFilterContext } from '../lib/profile-filter';
import type { Profile } from '../lib/profiles';
import { householdDay } from '../lib/routines';
import { pillName, pillPeople, type Pill, type PillPeople } from '../lib/schedule';
import { useNow, useOccurrences } from '../lib/wall-hooks';
import { forecastDay, type Forecast } from '../lib/weather';
import { EventDiscs, EventFill, EventPill } from './EventPill';
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
        <DayView key={`${view}:${day.date}`} timezone={timezone} now={now} day={day} version={version} profiles={profiles} returnFocus={() => heading.current?.focus()} />
      ) : (
        // The month's cells carry no weather: the spec puts it on the day headings of Home, Day and Week.
        <MonthGrid key={`${view}:${anchor}`} timezone={timezone} today={today} anchor={anchor} window={window} version={version} onOpenDay={(date) => onNavigate('day', date)} />
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
// The "+N" of a crowded cluster is one 48 px target at the right of the second lane, 8 px from the block beside it.
const FOLD_WIDTH = '3rem';
const LANE_GAP_PX = 8;

// The Day view: the hour grid, 3 rem an hour (docs/look.md; spec 0003, Day view). Above it one row holds the day's all-day
// events and then the timed ones that ended before its first hour; below it one row holds the ones that start after its last.
// Both rows keep their place whatever they hold, so the hours the grid shows (the whole hours that fit in what is left, measured
// here and decided by planDay) never depend on them. A row with more pills than fit scrolls sideways. Events that overlap sit
// side by side, two at most; a cluster of more folds into a "+N" in the second lane that opens a list of it. The blocks wait for
// the Profiles, as the schedule's pills do, and are filled from them. Tapping an event opens its details; after an event is
// deleted from its sheet, focus goes to the page title (`returnFocus`), not to the page.
function DayView({
  timezone,
  now,
  day,
  version,
  profiles,
  returnFocus,
}: {
  timezone: string;
  now: Date;
  day: WallDay;
  version: number;
  profiles: Profile[] | null;
  returnFocus: () => void;
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

  // The event a sheet was last opened for: if a read finds it gone (it was deleted from its sheet) while focus has fallen to the
  // page, focus goes to the page title instead.
  const opened = useRef<string | null>(null);
  const change = (next: OpenEvent) => {
    if (next && next.sheet !== 'cluster') opened.current = next.occurrence.id;
    setOpen(next);
  };
  useEffect(() => {
    if (open !== null || opened.current === null || occurrences === null) return;
    if (occurrences.some((occurrence) => occurrence.id === opened.current) || document.activeElement !== document.body) return;
    opened.current = null;
    returnFocus();
  }, [open, occurrences, returnFocus]);

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
      <PillRow label="Earlier" name="All day and earlier" pills={plan.above} day={day} people={people} empty={loaded ? emptyRowWords('earlier', day.isToday) : ''} onOpen={(occurrence) => change({ sheet: 'details', occurrence })} />
      <div ref={room} className="flex min-h-0 flex-1 flex-col gap-2">
        <HourGrid
          plan={plan}
          day={day}
          people={people}
          onOpen={(occurrence) => change({ sheet: 'details', occurrence })}
          onFold={(fold) => change({ sheet: 'cluster', day, pills: fold.pills })}
        />
        <PillRow
          ref={later}
          label="Later"
          name="Later"
          pills={plan.below}
          day={day}
          people={people}
          empty={loaded ? emptyRowWords('later', day.isToday) : ''}
          onOpen={(occurrence) => change({ sheet: 'details', occurrence })}
        />
      </div>
      <EventSheets open={open} onChange={change} timezone={timezone} date={day.date} profiles={people} onEdited={() => setEdits((count) => count + 1)} />
    </section>
  );
}

// One of the Day view's two rows, exactly one pill tall whatever it holds: its word in the hour gutter's width, then the pills,
// 220 px wide each (a title takes one line), side by side and scrolling sideways when they do not fit. With none it says so in
// `empty` (nothing while the day is still being read, so an empty row is never claimed before it is known to be).
function PillRow({
  ref,
  label,
  name,
  pills,
  day,
  people,
  empty,
  onOpen,
}: {
  ref?: Ref<HTMLDivElement>;
  label: string;
  name: string;
  pills: Pill[];
  day: WallDay;
  people: readonly Profile[];
  empty: string;
  onOpen: (occurrence: Occurrence) => void;
}) {
  return (
    <div ref={ref} role="group" aria-label={name} className="flex h-13 flex-none gap-2">
      <span aria-hidden className="flex w-15 flex-none items-center justify-end text-sm text-muted-foreground">
        {label}
      </span>
      <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto overflow-y-hidden px-1.5 [scrollbar-width:none]">
        {pills.length === 0 ? (
          <p className="flex items-center text-sm text-muted-foreground">{empty}</p>
        ) : (
          pills.map((pill) => (
            <div key={pill.occurrence.id} className="w-[220px] flex-none">
              <EventPill pill={pill} day={day} people={pillPeople(pill.occurrence, people)} onOpen={onOpen} lines={1} className="py-1 focus-visible:-outline-offset-2" />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// The hours of the window: the gutter of labels, and the grid itself with a hairline at each hour, the now line behind the
// blocks, then the blocks and the "+N" of a crowded cluster. Every position is in rem, so an hour is 3 rem whatever the text
// size is. The now line and its dot are drawn first, so each block covers them and the line never crosses a title.
function HourGrid({
  plan,
  day,
  people,
  onOpen,
  onFold,
}: {
  plan: DayPlan;
  day: WallDay;
  people: readonly Profile[];
  onOpen: (occurrence: Occurrence) => void;
  onFold: (fold: FoldTile) => void;
}) {
  const { startHour, endHour } = plan.window;
  const hours = Array.from({ length: endHour - startHour }, (_, index) => startHour + index);
  const at = (hour: number) => `${(hour - startHour) * HOUR_REM}rem`;
  return (
    <div className="flex flex-none gap-2" style={{ height: `${hours.length * HOUR_REM}rem` }}>
      <div aria-hidden className="relative w-15 flex-none text-sm leading-[18px] text-muted-foreground">
        {hours.map((hour, index) => (
          <span key={hour} className="absolute right-0" style={{ top: index === 0 ? 0 : `calc(${at(hour)} - 9px)` }}>
            {hourWords(hour)}
          </span>
        ))}
      </div>
      <div className="relative min-w-0 flex-1 rounded-[18px] bg-muted">
        {hours.slice(1).map((hour) => (
          <div key={hour} aria-hidden className="absolute inset-x-0 h-px bg-border" style={{ top: at(hour) }} />
        ))}
        {plan.nowHour !== null && (
          <>
            <div aria-hidden data-testid="now-line" className="pointer-events-none absolute inset-x-0 h-[3px] rounded-[2px] bg-foreground" style={{ top: at(plan.nowHour) }} />
            <div aria-hidden className="pointer-events-none absolute -left-[5px] size-[13px] rounded-full bg-foreground" style={{ top: `calc(${at(plan.nowHour)} - 5px)` }} />
          </>
        )}
        <div className="absolute inset-x-1.5 inset-y-0">
          {plan.blocks.map((block) => (
            <EventBlock key={block.pill.occurrence.id} block={block} top={at(block.topHour)} day={day} people={pillPeople(block.pill.occurrence, people)} onOpen={onOpen} />
          ))}
          {plan.folds.map((fold) => (
            <FoldButton key={fold.pills[0]!.occurrence.id} fold={fold} top={at(fold.topHour)} onFold={onFold} />
          ))}
        </div>
      </div>
    </div>
  );
}

// How tall a block of `hours` hours is: its hours less 2 px, so blocks that follow each other show a gap, but never under one
// hour (3 rem, 48 px): an hour-long event is exactly one hour tall.
const heightOf = (hours: number) => `max(${HOUR_REM}rem, calc(${hours * HOUR_REM}rem - 2px))`;

// One event in the grid: a flat fill in its people's colours with, on one line, the title (two when it is too long for one, and
// then ending in an ellipsis; never broken inside a word), its time, "On now" when it is, and its discs at the right. A Native
// Event has the pin before its title. The one that is on now has the 2.5 px ring in --foreground, drawn over the fill. The
// second lane of a lane pair starts 4 px past the middle, so the blocks are 8 px apart; one that leaves room for the "+N" is
// 8 px short of it.
function EventBlock({ block, top, day, people, onOpen }: { block: DayBlock; top: string; day: WallDay; people: PillPeople; onOpen: (occurrence: Occurrence) => void }) {
  const { pill } = block;
  const { occurrence } = pill;
  const half = LANE_GAP_PX / 2;
  return (
    <Button
      variant="quiet"
      aria-label={pillName(pill, day, people)}
      onClick={() => onOpen(occurrence)}
      className="absolute h-auto justify-start gap-3 rounded-[14px] px-0 py-0 pr-2.5 pl-3.5 text-left font-normal whitespace-normal text-foreground focus-visible:-outline-offset-2"
      style={{
        top,
        height: heightOf(block.bottomHour - block.topHour),
        left: block.lane === 0 ? 0 : `calc(50% + ${half}px)`,
        width: block.lanes === 1 ? '100%' : block.narrow ? `calc(50% - ${half}px - ${FOLD_WIDTH} - ${LANE_GAP_PX}px)` : `calc(50% - ${half}px)`,
      }}
    >
      <EventFill people={people} />
      <span className="relative line-clamp-2 min-w-0 text-base leading-5 font-semibold text-ellipsis">
        {occurrence.source === 'native' && <Pin aria-hidden data-testid="native-mark" className="mr-1 inline size-3.5 align-[-2px]" />}
        {occurrence.title}
      </span>
      <span className="relative min-w-0 flex-1 truncate text-sm leading-[18px]">{pill.time}</span>
      {pill.onNow && <span className="relative shrink-0 text-sm leading-[18px] font-semibold">On now</span>}
      <span className="relative flex shrink-0">
        <EventDiscs people={people} />
      </span>
      {pill.onNow && <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_2.5px_var(--foreground)]" />}
    </Button>
  );
}

// The "+N" of a cluster that needs more than two lanes, at the right end of the second lane: how many events are not drawn.
// It opens the list of the cluster. A tile on the card with a ring in --input, never a colour of its own.
function FoldButton({ fold, top, onFold }: { fold: FoldTile; top: string; onFold: (fold: FoldTile) => void }) {
  return (
    <Button
      variant="quiet"
      aria-label={`${fold.folded} more ${fold.folded === 1 ? 'event' : 'events'}, show the list`}
      onClick={() => onFold(fold)}
      className="absolute right-0 h-auto rounded-[14px] bg-card px-0 text-[15px] text-foreground shadow-[inset_0_0_0_1.5px_var(--input)] focus-visible:-outline-offset-2"
      style={{ top, height: heightOf(fold.bottomHour - fold.topHour), width: FOLD_WIDTH }}
    >
      +{fold.folded}
    </Button>
  );
}
