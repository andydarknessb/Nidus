import { Pin } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  canOpenDay,
  cellLines,
  dayOccurrences,
  describeCell,
  formatCompactClock,
  linesPerCell,
  monthWeeks,
  type Occurrence,
  type PagingWindow,
  type WallDay,
} from '../lib/calendar-occurrences';
import { tint } from '../lib/event-tint';
import { WEEKDAYS } from '../lib/routines';
import { useOccurrences } from '../lib/wall-hooks';

// The month view's grid: the weekday names and a row per week. Each day inside the mirror's window is one
// button that opens that day. It lists the day's occurrences a line each, as many as fit, and says how many
// more there are. Events are not tappable here, the day is.

// A day cell is drawn to these sizes, in rem like the classes that draw it, so the lines measured to fit are the
// lines drawn at any text size: CELL_HEAD_REM above its first line (its padding and its date, and the divider
// over its row) and CELL_LINE_REM for each line. They are multiplied by the root font size when measuring.
const CELL_HEAD_REM = 2.25;
const CELL_LINE_REM = 1.5;
const BEYOND_RANGE = "Beyond the calendar's range";
// The ground of a day beyond the window: thin diagonal lines in the border colour, so that "beyond the
// calendar's range" is told by a mark and not by colour alone. Used nowhere else.
const HATCH = 'bg-[repeating-linear-gradient(135deg,transparent_0_6px,var(--border)_6px_8px)]';

// `anchor` is the 1st of the month shown. `version` changes when the screen around the calendar has written
// an event, so every week reads again at once.
export function MonthGrid({
  timezone,
  today,
  anchor,
  window,
  version,
  onOpenDay,
}: {
  timezone: string;
  today: string;
  anchor: string;
  window: PagingWindow;
  version: number;
  onOpenDay: (date: string) => void;
}) {
  // Built once a page and a day, not on every tick of the clock or measure of the grid: it is the slow part.
  const weeks = useMemo(() => monthWeeks(anchor, timezone, today), [anchor, timezone, today]);
  // The weeks whose first read failed, so the grid says so once, not once per week.
  const [unreadWeeks, setUnreadWeeks] = useState<string[]>([]);
  const reportUnread = useCallback((week: string, unread: boolean) => {
    setUnreadWeeks((current) => {
      if (current.includes(week) === unread) return current;
      return unread ? [...current, week] : current.filter((other) => other !== week);
    });
  }, []);
  // The height the week rows share and the size of a rem, so the lines that fit a cell are measured, not
  // guessed, at whatever text size the tablet is set to.
  const rows = useRef<HTMLDivElement>(null);
  const [rowsPx, setRowsPx] = useState(480);
  const [remPx, setRemPx] = useState(16);

  useEffect(() => {
    const element = rows.current;
    if (!element) return;
    const measure = () => {
      setRowsPx(element.clientHeight);
      setRemPx(parseFloat(getComputedStyle(document.documentElement).fontSize));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const lines = linesPerCell(rowsPx / weeks.length, CELL_HEAD_REM * remPx, CELL_LINE_REM * remPx);

  return (
    <section aria-label="Calendar" className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border">
      {/* Every cell's name says its weekday already, so a screen reader need not hear the row of them first. */}
      <div aria-hidden className="grid grid-cols-7 divide-x divide-border border-b border-border">
        {WEEKDAYS.map((weekday) => (
          <div key={weekday.bit} className="py-2 text-center text-lg font-semibold">
            {weekday.short}
          </div>
        ))}
      </div>
      {unreadWeeks.length > 0 && (
        <p role="alert" className="p-4 text-xl">
          Could not load the calendar. Check your connection.
        </p>
      )}
      <div ref={rows} style={{ gridTemplateRows: `repeat(${weeks.length}, minmax(0, 1fr))` }} className="grid min-h-0 flex-1 divide-y divide-border">
        {weeks.map((days) =>
          // A week wholly beyond the window has nothing to read, so it is drawn without asking the API.
          days.every((day) => !canOpenDay(day.date, window)) ? (
            <WeekCells key={days[0]!.date} days={days} anchor={anchor} window={window} occurrences={null} lines={lines} timezone={timezone} onOpenDay={onOpenDay} />
          ) : (
            <WeekRow
              key={days[0]!.date}
              days={days}
              anchor={anchor}
              window={window}
              lines={lines}
              version={version}
              timezone={timezone}
              onOpenDay={onOpenDay}
              onUnread={reportUnread}
            />
          ),
        )}
      </div>
    </section>
  );
}

// One week of the grid, which reads its own seven days: the API caps a read at 1000 rows without saying so,
// and a week cannot reach that where a month could.
function WeekRow({
  days,
  anchor,
  window,
  lines,
  version,
  timezone,
  onOpenDay,
  onUnread,
}: {
  days: WallDay[];
  anchor: string;
  window: PagingWindow;
  lines: number;
  version: number;
  timezone: string;
  onOpenDay: (date: string) => void;
  onUnread: (week: string, unread: boolean) => void;
}) {
  const { occurrences, failed } = useOccurrences(days, version);
  const week = days[0]!.date;
  // As on the other views, only a read that has never landed is reported: a later failure keeps what is shown.
  const unread = failed && occurrences === null;
  useEffect(() => {
    onUnread(week, unread);
    return () => onUnread(week, false);
  }, [onUnread, week, unread]);

  return <WeekCells days={days} anchor={anchor} window={window} occurrences={occurrences} lines={lines} timezone={timezone} onOpenDay={onOpenDay} />;
}

// The seven cells of a week, given what its week has read (null until it has, and for a week that is never read).
function WeekCells({
  days,
  anchor,
  window,
  occurrences,
  lines,
  timezone,
  onOpenDay,
}: {
  days: WallDay[];
  anchor: string;
  window: PagingWindow;
  occurrences: Occurrence[] | null;
  lines: number;
  timezone: string;
  onOpenDay: (date: string) => void;
}) {
  return (
    <div className="grid min-h-0 grid-cols-7 grid-rows-[minmax(0,1fr)] divide-x divide-border">
      {days.map((day) => (
        <DayCell
          key={day.date}
          day={day}
          inMonth={day.date.slice(0, 7) === anchor.slice(0, 7)}
          beyond={!canOpenDay(day.date, window)}
          occurrences={occurrences === null ? null : dayOccurrences(occurrences, day)}
          lines={lines}
          timezone={timezone}
          onOpen={onOpenDay}
        />
      ))}
    </div>
  );
}

// One day. Inside the window it is a single button that opens the day and fills its cell. Beyond the window
// there is nothing to open and nothing known about the day, so the cell says so rather than look like a free
// day. `occurrences` are the day's own, in order, and null until its week has been read.
function DayCell({
  day,
  inMonth,
  beyond,
  occurrences,
  lines,
  timezone,
  onOpen,
}: {
  day: WallDay;
  inMonth: boolean;
  beyond: boolean;
  occurrences: Occurrence[] | null;
  lines: number;
  timezone: string;
  onOpen: (date: string) => void;
}) {
  // A day of the neighbouring month is dimmed with the muted colour, which is AAA on the page ground (7.59:1) but
  // not on today's lifted one (6.55:1), so today keeps the full colour wherever it falls. The same goes for a day
  // beyond the window: against the lighter colour of its hatch, the lines (rgb 34 34 36 as rendered), the muted
  // colour is 6.05:1 and the full colour 15.22:1.
  const dim = !inMonth && !beyond && !day.isToday ? 'text-muted-foreground' : '';
  // The date's line is shorter than its row so that today's underline sits inside the row, above the first line.
  const date = (
    <span className={`h-7 shrink-0 px-1 text-lg leading-6 font-semibold ${day.isToday ? 'underline decoration-4 underline-offset-2' : ''}`}>{Number(day.date.slice(8))}</span>
  );
  if (beyond) {
    return (
      <div className={`flex min-h-0 flex-col overflow-hidden pt-1 ${HATCH}`}>
        {date}
        <span className="sr-only">{BEYOND_RANGE}</span>
      </div>
    );
  }
  const { shown, more } = cellLines(occurrences ?? [], lines);
  return (
    <button
      type="button"
      aria-current={day.isToday ? 'date' : undefined}
      aria-label={describeCell(day.date, occurrences === null ? null : occurrences.length)}
      onClick={() => onOpen(day.date)}
      className={`flex min-h-0 w-full flex-col overflow-hidden pt-1 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-foreground ${day.isToday ? 'bg-muted/60' : ''} ${dim}`}
    >
      {date}
      {shown.map((occurrence) => (
        <EventLine key={occurrence.id} occurrence={occurrence} day={day} timezone={timezone} />
      ))}
      {more && <span className="h-6 shrink-0 px-2 text-base leading-6 font-medium">{more}</span>}
    </button>
  );
}

// The width of a line's coloured edge (its border-l-4), which the stripes of an event for several Profiles
// are drawn as wide as.
const EDGE_PX = 4;

// One occurrence on a day: its colour edge, the pin of a Native Event, the start time of a timed one (with no
// ":00" on the hour, to leave room for the title) and the title, cut short with an ellipsis. A timed event
// that began on an earlier day only continues, so it shows no time, as in the week view.
function EventLine({ occurrence, day, timezone }: { occurrence: Occurrence; day: WallDay; timezone: string }) {
  const start = Date.parse(occurrence.starts_at);
  const time = !occurrence.is_all_day && start >= day.startMs ? formatCompactClock(start, timezone) : null;
  return (
    <span className="mx-1 mb-0.5 flex h-5.5 shrink-0 items-center gap-1 rounded-sm border-l-4 px-1 text-base leading-5 text-foreground" style={tint(occurrence, EDGE_PX)}>
      {occurrence.source === 'native' && <Pin aria-hidden data-testid="native-mark" className="size-4 shrink-0" />}
      {time && <span className="shrink-0 tabular-nums">{time}</span>}
      <span className="truncate">{occurrence.title}</span>
    </span>
  );
}
