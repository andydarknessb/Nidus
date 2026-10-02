import { Pin } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  canOpenDay,
  describeMonth,
  describePage,
  fiveDays,
  formatClock,
  describeWhen,
  nowHour,
  pageDays,
  pageStart,
  paging,
  pagingWindow,
  place,
  shownDate,
  visibleHours,
  type AllDayBar,
  type CalendarView,
  type Occurrence,
  type TimedBlock,
  type WallDay,
} from '../lib/calendar-occurrences';
import { tint } from '../lib/event-tint';
import { householdDay, WEEKDAYS } from '../lib/routines';
import { useNow, useOccurrences } from '../lib/wall-hooks';
import { forecastDay, type Forecast, type ForecastDay } from '../lib/weather';
import { EventDetails } from './EventDetails';
import { MonthGrid } from './MonthGrid';
import { NativeEventSheet } from './NativeEventSheet';
import { DayWeather } from './Weather';

// The home screen's calendar: today and the next four days as columns in the Household
// Timezone. An all-day band on top (multi-day events span their columns), timed events
// positioned by time below, a line at the current time and today's column lifted. Tapping an
// event opens its details, and tapping a day's heading opens that day.

// The smallest a tappable event may be drawn (48 px, CLAUDE.md), and the grid padding above and below the columns.
const MIN_TARGET_PX = 48;
const GRID_PADDING_PX = 24;
// The hour gutter and one column per day: five on the home screen, seven in a week, one in a day. The
// gutter is 4 rem, room for "10 AM" and no more, so that beside the navigation rail the five days
// clear 140 px at 1280 px.
function gridColumns(count: number): CSSProperties {
  return { gridTemplateColumns: `4rem repeat(${count}, minmax(0, 1fr))` };
}

function hourLabel(hour: number): string {
  return `${hour % 12 || 12} ${hour % 24 < 12 ? 'AM' : 'PM'}`;
}

// What a screen reader hears of an event beyond its title: where it came from.
function source(occurrence: Occurrence): string {
  return occurrence.source === 'native' ? 'only in Nidus' : occurrence.calendar_name;
}

// The mark on a Native Event, which lives only in Nidus: a pin, never colour alone.
function NativeMark({ occurrence }: { occurrence: Occurrence }) {
  return occurrence.source === 'native' ? <Pin aria-hidden data-testid="native-mark" className="mr-1 inline size-4 shrink-0 align-text-bottom" /> : null;
}

// The home screen: today and the next four days. `version` changes when the screen around the
// calendar has written an event, so the calendar reads again at once. `forecast` is the Household's
// weather, read once by the screen around the calendar; `weatherOn` says the Household has a place,
// so each day heading keeps a line for it (empty while there is no forecast, or none for that day).
export function FiveDayCalendar({
  timezone,
  version = 0,
  onNavigate,
  forecast = null,
  weatherOn = false,
}: {
  timezone: string;
  version?: number;
  onNavigate: (view: CalendarView, date: string) => void;
  forecast?: Forecast | null;
  weatherOn?: boolean;
}) {
  const now = useNow(timezone);
  return (
    <CalendarGrid
      timezone={timezone}
      now={now}
      days={fiveDays(timezone, now)}
      version={version}
      onOpenDay={(date) => onNavigate('day', date)}
      forecast={forecast}
      weatherOn={weatherOn}
    />
  );
}

const PAGE_BUTTON = 'min-h-12 rounded-lg border border-border px-6 text-lg font-medium disabled:opacity-50';

// The week, day and month views: the same grid as the home screen (a month's is a grid of its own)
// with a header to page back and forward within the synced window and jump to today. `date` is the
// page's anchor (null for today); a date outside the window is pulled to its nearest end.
export function PagedCalendar({
  timezone,
  view,
  date,
  version = 0,
  onNavigate,
  forecast = null,
  weatherOn = false,
}: {
  timezone: string;
  view: CalendarView;
  date: string | null;
  version?: number;
  onNavigate: (view: CalendarView, date: string) => void;
  forecast?: Forecast | null;
  weatherOn?: boolean;
}) {
  const now = useNow(timezone);
  const window = pagingWindow(timezone, now);
  const today = householdDay(timezone, now).date;
  const anchor = pageStart(view, shownDate(date, today));
  // A week or a day is a run of days on the time grid; a month is a grid of weeks of its own.
  const days = view === 'month' ? null : pageDays(view, anchor, timezone, now);
  const { previous, next } = paging(view, anchor, window);
  // Paging may disable or remove the button that was pressed: put focus on the page title instead of losing it.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), [view, anchor]);

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <nav aria-label="Calendar paging" className="flex flex-wrap items-center gap-4">
        <button type="button" className={PAGE_BUTTON} disabled={previous === null} onClick={() => previous && onNavigate(view, previous)}>
          Previous {view}
        </button>
        <button type="button" className={PAGE_BUTTON} onClick={() => onNavigate(view, pageStart(view, today))}>
          Today
        </button>
        <button type="button" className={PAGE_BUTTON} disabled={next === null} onClick={() => next && onNavigate(view, next)}>
          Next {view}
        </button>
        <h2 ref={heading} tabIndex={-1} className="ml-2 text-2xl font-semibold outline-none">{days ? describePage(days) : describeMonth(anchor)}</h2>
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
      {days ? (
        <CalendarGrid
          key={`${view}:${days[0]!.date}`}
          timezone={timezone}
          now={now}
          days={days}
          version={version}
          // A week's day headings open that day; on a day page the heading is only a heading.
          onOpenDay={view === 'week' ? (day) => onNavigate('day', day) : null}
          forecast={forecast}
          weatherOn={weatherOn}
        />
      ) : (
        // The month's cells carry no weather: the spec puts it on the day headings of Home, Day and Week.
        <MonthGrid key={`${view}:${anchor}`} timezone={timezone} today={today} anchor={anchor} window={window} version={version} onOpenDay={(day) => onNavigate('day', day)} />
      )}
    </div>
  );
}

function CalendarGrid({
  timezone,
  now,
  days,
  version,
  onOpenDay,
  forecast,
  weatherOn,
}: {
  timezone: string;
  now: Date;
  days: WallDay[];
  version: number;
  onOpenDay: ((date: string) => void) | null;
  forecast: Forecast | null;
  weatherOn: boolean;
}) {
  const columnsStyle = gridColumns(days.length);
  // A day outside the paging window would open its nearest end instead, so it is only a heading.
  const pageWindow = pagingWindow(timezone, now);
  const [open, setOpen] = useState<Occurrence | null>(null);
  // A Native Event being edited, and a count of the edits made here, so the read runs again after one.
  const [editing, setEditing] = useState<Occurrence | null>(null);
  const [edits, setEdits] = useState(0);
  // The height of the time grid, so events can be given room for a 48 px target.
  const grid = useRef<HTMLDivElement>(null);
  const [gridPx, setGridPx] = useState(640);

  useEffect(() => {
    const element = grid.current;
    if (!element) return;
    const measure = () => setGridPx(Math.max(element.clientHeight - GRID_PADDING_PX, 1));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // An edit made here counts into `version`, so it reads again like an event added around the calendar.
  const { occurrences, failed } = useOccurrences(days, version + edits);

  const todayColumn = days.find((day) => day.isToday);
  const todayHour = todayColumn ? nowHour(todayColumn, now) : null;
  const { startHour, endHour } = visibleHours(place(occurrences ?? [], days).columns, todayHour);
  const minMinutes = (MIN_TARGET_PX / (gridPx / (endHour - startHour))) * 60;
  const { allDay, columns } = place(occurrences ?? [], days, minMinutes);
  const hours = Array.from({ length: endHour - startHour + 1 }, (_, index) => startHour + index);

  return (
    <section aria-label="Calendar" className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl bg-card">
      <div style={columnsStyle} className="grid border-b border-border">
        <div />
        {days.map((day) => (
          <DayHeading
            key={day.date}
            day={day}
            onOpen={onOpenDay && canOpenDay(day.date, pageWindow) ? onOpenDay : null}
            weather={forecastDay(forecast, day.date)}
            room={weatherOn}
            // One column is wide enough to hold the weather beside the day; several are not.
            beside={days.length === 1}
          />
        ))}
      </div>
      {failed && occurrences === null && (
        <p role="alert" className="p-4 text-xl">
          Could not load the calendar. Check your connection.
        </p>
      )}
      {allDay.length > 0 && <AllDayBand bars={allDay} columnsStyle={columnsStyle} onOpen={setOpen} />}
      <div ref={grid} style={columnsStyle} className="grid min-h-0 flex-1">
        <div className="relative my-3" aria-hidden>
          {hours.slice(1, -1).map((hour) => (
            <span key={hour} className="absolute right-2 -translate-y-1/2 text-base" style={{ top: `${((hour - startHour) / (endHour - startHour)) * 100}%` }}>
              {hourLabel(hour)}
            </span>
          ))}
        </div>
        {days.map((day, index) => (
          <div key={day.date} className={`relative my-3 border-l border-border ${day.isToday ? 'bg-muted' : ''}`}>
            {hours.slice(1, -1).map((hour) => (
              <div key={hour} aria-hidden className="absolute inset-x-0 border-t border-border" style={{ top: `${((hour - startHour) / (endHour - startHour)) * 100}%` }} />
            ))}
            {(columns[index] ?? []).map((block) => (
              <EventBlock key={`${block.occurrence.id}-${day.date}`} block={block} startHour={startHour} endHour={endHour} timezone={timezone} onOpen={setOpen} />
            ))}
            {day.isToday && todayHour !== null && (
              <div
                aria-hidden
                data-testid="now-line"
                className="pointer-events-none absolute inset-x-0 z-[5] h-0.5 bg-foreground"
                style={{ top: `${((todayHour - startHour) / (endHour - startHour)) * 100}%` }}
              >
                <span className="absolute -top-1 -left-1.5 size-3.5 rounded-full bg-foreground" />
              </div>
            )}
          </div>
        ))}
      </div>
      {open && (
        <EventDetails
          occurrence={open}
          timezone={timezone}
          onClose={() => setOpen(null)}
          onEdit={() => {
            setEditing(open);
            setOpen(null);
          }}
        />
      )}
      {editing && (
        <NativeEventSheet
          timezone={timezone}
          date={days[0]!.date}
          occurrence={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setEdits((count) => count + 1);
          }}
        />
      )}
    </section>
  );
}

// A day's heading cell: the heading and the day's weather, under it (beside it on a one-day page, which
// is wide enough). Where that day can be opened (the home screen and the week view) the heading holds
// a button that opens it and fills the heading, so the whole heading is the target; on the day view
// itself it is only a heading. The weather is never inside the heading or its button, so the button's
// name stays "Thu 1, open day". While the Household has a place (`room`) every cell keeps its line for
// the weather, empty for a day the forecast does not cover, so the row is as tall before the forecast
// arrives, or when a week is only partly covered, as it is after.
function DayHeading({
  day,
  onOpen,
  weather,
  room,
  beside,
}: {
  day: WallDay;
  onOpen: ((date: string) => void) | null;
  weather: ForecastDay | undefined;
  room: boolean;
  beside: boolean;
}) {
  const weekday = WEEKDAYS[day.weekday]!.short;
  const date = Number(day.date.slice(8));
  const words = (
    <>
      <span>{weekday}</span>
      <span>{date}</span>
      {day.isToday && <span className="sr-only">(today)</span>}
    </>
  );
  const text = `flex items-baseline justify-center gap-2 px-2 py-3 text-2xl font-semibold ${day.isToday ? 'underline decoration-4 underline-offset-8' : ''}`;
  // The button fills its column, so its focus ring is drawn inside it: drawn outside, the next column and the edge clip it.
  const heading = onOpen ? (
    <h2>
      <button
        type="button"
        aria-current={day.isToday ? 'date' : undefined}
        aria-label={`${weekday} ${date}${day.isToday ? ' (today)' : ''}, open day`}
        onClick={() => onOpen(day.date)}
        className={`${text} min-h-12 w-full focus-visible:-outline-offset-2`}
      >
        {words}
      </button>
    </h2>
  ) : (
    <h2 aria-current={day.isToday ? 'date' : undefined} className={text}>
      {words}
    </h2>
  );
  return (
    <div className={`border-l border-border ${day.isToday ? 'bg-muted' : ''} ${beside ? 'flex items-center justify-center gap-4' : ''}`}>
      {heading}
      {room &&
        (beside ? (
          <DayWeather day={weather} />
        ) : (
          <div className="flex h-7 items-center justify-center">
            <DayWeather day={weather} />
          </div>
        ))}
    </div>
  );
}

function AllDayBand({ bars, columnsStyle, onOpen }: { bars: AllDayBar[]; columnsStyle: CSSProperties; onOpen: (occurrence: Occurrence) => void }) {
  return (
    <div style={columnsStyle} className="grid max-h-[30%] auto-rows-min gap-y-1 overflow-y-auto border-b border-border py-1">
      {bars.map((bar) => (
        <button
          key={bar.occurrence.id}
          type="button"
          onClick={() => onOpen(bar.occurrence)}
          aria-label={`${bar.occurrence.title}, ${source(bar.occurrence)}, all day`}
          className={`mx-1 flex min-h-12 items-center truncate border-l-8 px-3 text-left text-lg font-medium ${bar.continuesBefore ? 'rounded-l-none' : 'rounded-l-md'} ${bar.continuesAfter ? 'rounded-r-none' : 'rounded-r-md'}`}
          style={{ ...tint(bar.occurrence), gridColumn: `${bar.startColumn + 2} / span ${bar.span}`, gridRow: bar.row + 1 }}
        >
          <span className="truncate">
            <NativeMark occurrence={bar.occurrence} />
            {bar.occurrence.title}
          </span>
        </button>
      ))}
    </div>
  );
}

function EventBlock({
  block,
  startHour,
  endHour,
  timezone,
  onOpen,
}: {
  block: TimedBlock;
  startHour: number;
  endHour: number;
  timezone: string;
  onOpen: (occurrence: Occurrence) => void;
}) {
  const { occurrence } = block;
  const range = endHour - startHour;
  const top = ((block.topHour - startHour) / range) * 100;
  const bottom = ((block.bottomHour - startHour) / range) * 100;
  return (
    <button
      type="button"
      onClick={() => onOpen(occurrence)}
      aria-label={`${occurrence.title}, ${source(occurrence)}, ${describeWhen(occurrence, timezone)}`}
      // A short event is still a 48 px target, so it may run past its end on the grid.
      className="absolute z-[1] min-h-12 overflow-hidden rounded-md border-l-8 px-2 py-1 text-left text-lg leading-tight"
      style={{
        ...tint(occurrence),
        top: `${top}%`,
        height: `${bottom - top}%`,
        left: `calc(${(block.lane / block.lanes) * 100}% + 2px)`,
        width: `calc(${100 / block.lanes}% - 4px)`,
      }}
    >
      <span className="block font-semibold break-words">
        <NativeMark occurrence={occurrence} />
        {occurrence.title}
      </span>
      {!block.continuesBefore && <span className="block text-base">{formatClock(Date.parse(occurrence.starts_at), timezone)}</span>}
    </button>
  );
}
