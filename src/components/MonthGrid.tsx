import { useEffect, useMemo, useRef, useState } from 'react';
import { isTightCell, linesPerCell, monthMinRem } from '../lib/calendar-occurrences';
import { canOpenDay, monthWeeks, type PagingWindow, type WallDay } from '../lib/paged-view';
import type { DayEvents } from '../lib/day-events';
import type { Profile } from '../lib/profiles';
import { WEEKDAYS } from '../lib/routines';
import { useDayEvents } from '../lib/wall-hooks';
import { CELL_HEAD_REM, CELL_LINE_REM, DayCell } from './MonthCell';
import { ReadState } from './ReadState';

// The month view's grid: the weekday names and a row per week. Each day inside the mirror's window is one
// button that opens that day (MonthCell.tsx). It lists the day's occurrences a line each, as many as fit, and says how many
// more there are. Events are not tappable here, the day is.

// `anchor` is the 1st of the month shown, read in one go (useDayEvents). `version` changes when the screen around the calendar has
// written an event, so the month reads again at once. `profiles` are the Household's, read by that screen and handed down: they fill the
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
  const events = useDayEvents(useMemo(() => weeks.flat(), [weeks]), version, profiles);
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

  // A week the room for the grid leaves too short for its date and a line under it (a six-week month at 130 percent text on the 1280 x 800
  // Wall: 73 px of the 86 it needs) is drawn as its date and the day's count beside it, 0 lines (isTightCell), rather than cut off.
  const rowPx = rowsPx / weeks.length;
  const lines = isTightCell(rowPx, CELL_HEAD_REM * remPx, CELL_LINE_REM * remPx, remPx) ? 0 : linesPerCell(rowPx, CELL_HEAD_REM * remPx, CELL_LINE_REM * remPx);

  // At larger text a week is never drawn shorter than its date (a row too short for a line under it shows the count beside the date, see
  // `lines` above): where even that is more than the room, the grid is as tall as it needs and the screen scrolls. At 16 px text the floor
  // is 0, so the grid is as it was: `(1rem - 16px) * 1000` is 0 there and thousands of px as soon as the text is larger.
  return (
    <section aria-label="Calendar" style={{ minHeight: `min(${monthMinRem(weeks.length, CELL_HEAD_REM)}rem, calc((1rem - 16px) * 1000))` }} className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl bg-card">
      {/* Every cell's name says its weekday already, so a screen reader need not hear the row of them first. */}
      <div aria-hidden className="grid grid-cols-7 divide-x divide-border border-b border-border">
        {WEEKDAYS.map((weekday) => (
          <div key={weekday.bit} className="py-2 text-center text-sm font-medium text-muted-foreground">
            {weekday.short}
          </div>
        ))}
      </div>
      <ReadState of="the calendar" read={events} say="failed" alert="p-4 text-xl" />
      <div ref={rows} style={{ gridTemplateRows: `repeat(${weeks.length}, minmax(0, 1fr))` }} className="grid min-h-0 flex-1 divide-y divide-border">
        {weeks.map((days) => (
          <WeekCells
            key={days[0]!.date}
            days={days}
            anchor={anchor}
            window={window}
            // A week wholly beyond the window is drawn as one that holds nothing to read.
            events={days.every((day) => !canOpenDay(day.date, window)) ? null : events}
            profiles={profiles ?? []}
            lines={lines}
            timezone={timezone}
            onOpenDay={onOpenDay}
          />
        ))}
      </div>
    </section>
  );
}

// The seven cells of a week, from the month's day events (null for a week that is never read).
function WeekCells({
  days,
  anchor,
  window,
  events,
  profiles,
  lines,
  timezone,
  onOpenDay,
}: {
  days: WallDay[];
  anchor: string;
  window: PagingWindow;
  events: DayEvents | null;
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
          occurrences={events === null ? null : events.on(day)}
          profiles={profiles}
          lines={lines}
          timezone={timezone}
          onOpen={onOpenDay}
        />
      ))}
    </div>
  );
}
