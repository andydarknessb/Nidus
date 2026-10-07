import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { canOpenDay, dayOccurrences, linesPerCell, monthWeeks, type Occurrence, type PagingWindow, type WallDay } from '../lib/calendar-occurrences';
import type { Profile } from '../lib/profiles';
import { WEEKDAYS } from '../lib/routines';
import { useOccurrences } from '../lib/wall-hooks';
import { CELL_HEAD_REM, CELL_LINE_REM, DayCell } from './MonthCell';

// The weekday names' row, in rem (py-2 and a line of text-sm, and the border under it).
const WEEKDAYS_REM = 2.5;

// The least height of the grid in rem: the weekday row and, for each week, the date and the one line under it.
function monthMinRem(weeks: number): number {
  return WEEKDAYS_REM + weeks * (CELL_HEAD_REM + CELL_LINE_REM);
}

// The month view's grid: the weekday names and a row per week. Each day inside the mirror's window is one
// button that opens that day (MonthCell.tsx). It lists the day's occurrences a line each, as many as fit, and says how many
// more there are. Events are not tappable here, the day is.

// `anchor` is the 1st of the month shown. `version` changes when the screen around the calendar has written
// an event, so every week reads again at once. `profiles` are the Household's, read by that screen and handed down: they fill the
// event lines, and are null until read, when the lines wait for them as the schedule's pills do.
export function MonthGrid({
  timezone,
  today,
  anchor,
  window,
  version,
  onOpenDay,
  profiles,
}: {
  timezone: string;
  today: string;
  anchor: string;
  window: PagingWindow;
  version: number;
  onOpenDay: (date: string) => void;
  profiles: Profile[] | null;
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

  // At larger text a week is never drawn shorter than its date and the one line under it (the "+N more" or "6 events" that says what the
  // day holds): where the room for the grid is less than that, the grid is as tall as it needs and the screen scrolls. At 16 px text the
  // floor is 0, so the grid is as it was: `(1rem - 16px) * 1000` is 0 there and thousands of px as soon as the text is larger.
  return (
    <section aria-label="Calendar" style={{ minHeight: `min(${monthMinRem(weeks.length)}rem, calc((1rem - 16px) * 1000))` }} className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl bg-card">
      {/* Every cell's name says its weekday already, so a screen reader need not hear the row of them first. */}
      <div aria-hidden className="grid grid-cols-7 divide-x divide-border border-b border-border">
        {WEEKDAYS.map((weekday) => (
          <div key={weekday.bit} className="py-2 text-center text-sm font-medium text-muted-foreground">
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
            <WeekCells key={days[0]!.date} days={days} anchor={anchor} window={window} occurrences={null} profiles={profiles ?? []} lines={lines} timezone={timezone} onOpenDay={onOpenDay} />
          ) : (
            <WeekRow
              key={days[0]!.date}
              days={days}
              anchor={anchor}
              window={window}
              lines={lines}
              version={version}
              profiles={profiles}
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
  profiles,
  timezone,
  onOpenDay,
  onUnread,
}: {
  days: WallDay[];
  anchor: string;
  window: PagingWindow;
  lines: number;
  version: number;
  profiles: Profile[] | null;
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

  // The lines are filled from the Profiles, so until they are read the week is as one that has not been read yet.
  return (
    <WeekCells
      days={days}
      anchor={anchor}
      window={window}
      occurrences={profiles === null ? null : occurrences}
      profiles={profiles ?? []}
      lines={lines}
      timezone={timezone}
      onOpenDay={onOpenDay}
    />
  );
}

// The seven cells of a week, given what its week has read (null until it has, and for a week that is never read).
function WeekCells({
  days,
  anchor,
  window,
  occurrences,
  profiles,
  lines,
  timezone,
  onOpenDay,
}: {
  days: WallDay[];
  anchor: string;
  window: PagingWindow;
  occurrences: Occurrence[] | null;
  profiles: readonly Profile[];
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
          profiles={profiles}
          lines={lines}
          timezone={timezone}
          onOpen={onOpenDay}
        />
      ))}
    </div>
  );
}
