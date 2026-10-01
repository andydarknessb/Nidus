import { Pin } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  clampToWindow,
  describePage,
  fiveDays,
  formatClock,
  describeWhen,
  loadOccurrences,
  nowHour,
  pageDays,
  pageStart,
  paging,
  pagingWindow,
  place,
  visibleHours,
  type AllDayBar,
  type CalendarView,
  type Occurrence,
  type TimedBlock,
  type WallDay,
} from '../lib/calendar-occurrences';
import { householdDay, WEEKDAYS } from '../lib/routines';
import { supabase } from '../lib/supabase';
import { EventDetails } from './EventDetails';
import { NativeEventSheet } from './NativeEventSheet';

// The home screen's calendar: today and the next four days as columns in the Household
// Timezone. An all-day band on top (multi-day events span their columns), timed events
// positioned by time below, a line at the current time and today's column lifted. Tapping an
// event opens its details.
const REFRESH_MS = 60_000;
const RETRY_MS = 5_000;
const CLOCK_MS = 30_000;
// Events with no colour (a whole-Household calendar) still need an edge to read against.
const NEUTRAL = '#d4d4d8';
// The smallest a tappable event may be drawn (48 px, CLAUDE.md), and the grid padding above and below the columns.
const MIN_TARGET_PX = 48;
const GRID_PADDING_PX = 24;
// The hour gutter and one column per day: five on the home screen, seven in a week, one in a day.
function gridColumns(count: number): CSSProperties {
  return { gridTemplateColumns: `4.5rem repeat(${count}, minmax(0, 1fr))` };
}

function hourLabel(hour: number): string {
  return `${hour % 12 || 12} ${hour % 24 < 12 ? 'AM' : 'PM'}`;
}

// A tinted block in the event's colour: the colour is the edge and a wash, never the text, so
// the words stay white on a dark ground whatever colour the Profile picked.
// An event for several Profiles splits its edge into one stripe of each colour.
function tint(occurrence: Occurrence): CSSProperties {
  const edge = occurrence.color ?? NEUTRAL;
  const wash = `color-mix(in srgb, ${edge} 24%, #18181b)`;
  const { colors } = occurrence;
  if (colors.length < 2) return { borderLeftColor: edge, backgroundColor: wash };
  const stops = colors.map((color, index) => `${color} ${(index * 100) / colors.length}% ${((index + 1) * 100) / colors.length}%`).join(', ');
  return {
    borderLeftColor: 'transparent',
    backgroundImage: `linear-gradient(to bottom, ${stops}), linear-gradient(${wash}, ${wash})`,
    backgroundSize: '8px 100%, 100% 100%',
    backgroundPosition: 'left top, left top',
    backgroundRepeat: 'no-repeat',
    backgroundOrigin: 'border-box',
  };
}

// What a screen reader hears of an event beyond its title: where it came from.
function source(occurrence: Occurrence): string {
  return occurrence.source === 'native' ? 'only in Nidus' : occurrence.calendar_name;
}

// The mark on a Native Event, which lives only in Nidus: a pin, never colour alone.
function NativeMark({ occurrence }: { occurrence: Occurrence }) {
  return occurrence.source === 'native' ? <Pin aria-hidden data-testid="native-mark" className="mr-1 inline size-4 shrink-0 align-text-bottom" /> : null;
}

function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), CLOCK_MS);
    return () => clearInterval(id);
  }, []);
  return now;
}

// The home screen: today and the next four days. `version` changes when the screen around the
// calendar has written an event, so the calendar reads again at once.
export function FiveDayCalendar({ timezone, version = 0 }: { timezone: string; version?: number }) {
  const now = useNow();
  return <CalendarGrid timezone={timezone} now={now} days={fiveDays(timezone, now)} version={version} />;
}

const PAGE_BUTTON = 'min-h-12 rounded-lg border border-border px-6 text-lg font-medium disabled:opacity-50';

// The week and day views: the same grid as the home screen with a header to page back and forward
// within the synced window, jump to today and return to the home screen. `date` is the page's
// anchor (null for today); a date outside the window is pulled to its nearest end.
export function PagedCalendar({
  timezone,
  view,
  date,
  version = 0,
  onNavigate,
  onHome,
}: {
  timezone: string;
  view: CalendarView;
  date: string | null;
  version?: number;
  onNavigate: (view: CalendarView, date: string) => void;
  onHome: () => void;
}) {
  const now = useNow();
  const window = pagingWindow(timezone, now);
  const today = householdDay(timezone, now).date;
  const anchor = pageStart(view, clampToWindow(date ?? today, window));
  const days = pageDays(view, anchor, timezone, now);
  const { previous, next } = paging(view, anchor, window);
  const label = view === 'week' ? 'week' : 'day';
  // Paging may disable or remove the button that was pressed: put focus on the page title instead of losing it.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), [view, anchor]);

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <nav aria-label="Calendar paging" className="flex flex-wrap items-center gap-4">
        <button type="button" className={PAGE_BUTTON} onClick={onHome}>
          Home
        </button>
        <button type="button" className={PAGE_BUTTON} disabled={previous === null} onClick={() => previous && onNavigate(view, previous)}>
          Previous {label}
        </button>
        <button type="button" className={PAGE_BUTTON} onClick={() => onNavigate(view, pageStart(view, today))}>
          Today
        </button>
        <button type="button" className={PAGE_BUTTON} disabled={next === null} onClick={() => next && onNavigate(view, next)}>
          Next {label}
        </button>
        <h2 ref={heading} tabIndex={-1} className="ml-2 text-2xl font-semibold outline-none">{describePage(days)}</h2>
        <button type="button" className={`${PAGE_BUTTON} ml-auto`} onClick={() => onNavigate(view === 'week' ? 'day' : 'week', view === 'week' ? today : anchor)}>
          {view === 'week' ? 'Day view' : 'Week view'}
        </button>
      </nav>
      {/* Always mounted, so a screen reader announces the text when it appears. */}
      <p role="status" className="text-lg empty:hidden">
        {previous === null
          ? 'This is as far back as the calendar goes. It keeps one month of past events.'
          : next === null
            ? 'This is as far ahead as the calendar goes. It keeps six months of upcoming events.'
            : ''}
      </p>
      {/* Keyed on the page so a turned page never shows the last page's events, and a failed read says so. */}
      <CalendarGrid key={days[0]!.date} timezone={timezone} now={now} days={days} version={version} />
    </div>
  );
}

function CalendarGrid({ timezone, now, days, version }: { timezone: string; now: Date; days: WallDay[]; version: number }) {
  const columnsStyle = gridColumns(days.length);
  const [occurrences, setOccurrences] = useState<Occurrence[] | null>(null);
  const [failed, setFailed] = useState(false);
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

  // The span to read: from the first day's start to the last day's end. Read again when it changes
  // (the day rolls over, the Household Timezone changes, a page is turned), and on a timer for new events.
  const fromMs = days[0]!.startMs;
  const toMs = days[days.length - 1]!.endMs;
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function read() {
      let delay = REFRESH_MS;
      try {
        const rows = await loadOccurrences(supabase, new Date(fromMs), new Date(toMs));
        if (live) {
          setOccurrences(rows);
          setFailed(false);
        }
      } catch {
        // Keep what the wall shows and try again sooner.
        if (live) setFailed(true);
        delay = RETRY_MS;
      }
      if (live) timer = setTimeout(() => void read(), delay);
    }

    void read();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [fromMs, toMs, version, edits]);

  const todayColumn = days.find((day) => day.isToday);
  const todayHour = todayColumn ? nowHour(todayColumn, now) : null;
  const { startHour, endHour } = visibleHours(place(occurrences ?? [], days).columns, todayHour);
  const minMinutes = (MIN_TARGET_PX / (gridPx / (endHour - startHour))) * 60;
  const { allDay, columns } = place(occurrences ?? [], days, minMinutes);
  const hours = Array.from({ length: endHour - startHour + 1 }, (_, index) => startHour + index);

  return (
    <section aria-label="Calendar" className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border">
      <div style={columnsStyle} className="grid border-b border-border">
        <div />
        {days.map((day) => (
          <DayHeading key={day.date} day={day} />
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
          <div key={day.date} className={`relative my-3 border-l border-border ${day.isToday ? 'bg-muted/60' : ''}`}>
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
                className="pointer-events-none absolute inset-x-0 z-[5] h-0.5 bg-red-300"
                style={{ top: `${((todayHour - startHour) / (endHour - startHour)) * 100}%` }}
              >
                <span className="absolute -top-1 -left-1.5 size-3.5 rounded-full bg-red-300" />
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

function DayHeading({ day }: { day: WallDay }) {
  return (
    <h2
      aria-current={day.isToday ? 'date' : undefined}
      className={`flex items-baseline justify-center gap-2 border-l border-border px-2 py-3 text-2xl font-semibold ${day.isToday ? 'bg-muted/60 underline decoration-4 underline-offset-8' : ''}`}
    >
      <span>{WEEKDAYS[day.weekday]!.short}</span>
      <span>{Number(day.date.slice(8))}</span>
      {day.isToday && <span className="sr-only">(today)</span>}
    </h2>
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
