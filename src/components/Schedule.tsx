import { cn } from 'cn';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { describeCell, type Occurrence } from '../lib/calendar-occurrences';
import { canOpenDay, pagingWindow, type WallDay } from '../lib/paged-view';
import { focusElement } from '../lib/focus';
import type { Profile } from '../lib/profiles';
import { dayHeadingName, headingLabel, pillPeople, pillsToShow, scheduleColumns, type ScheduleColumn } from '../lib/schedule';
import { useDayEvents } from '../lib/wall-hooks';
import { forecastDay, type Forecast, type ForecastDay } from '../lib/weather';
import { EventPill } from './EventPill';
import { EventSheets, type OpenEvent } from './EventSheets';
import { Button } from './ui/button';
import { DayWeather } from './Weather';

// The schedule (docs/look.md, The parts): Home draws today and the next four days (three on a narrow screen), Week Sunday to Saturday, each as a
// column. A column is a heading that opens the day, the day's forecast under it (outside the button), and the day's
// events as pills, all-day first, then by start, then by title. A column that cannot hold its pills draws as many as
// fit and a "+N more" button that opens the day: nothing is ever clipped.

// The "+N more" button is 3 rem tall (h-12), like the pills it takes the place of.
const MORE_REM = 3;

// A day's heading cell: the weekday over the date, which opens the day. Today says "Today" over the date in a --primary
// disc. The button is named by what is drawn on it ("Fri 2, open day"). A day that cannot be opened (`onOpen` null: it lies
// beyond the calendar's range) is only a heading. 64 px tall, and the forecast line, outside the button, makes it the 82 of
// the drawing. `data-day` is the date, so focus can be put back on the heading of the day an event was on (lib/focus.ts).
function ColumnHeading({ day, onOpen }: { day: WallDay; onOpen: (() => void) | null }) {
  const date = Number(day.date.slice(8));
  const words = (
    <>
      <span className={cn('text-sm leading-[1.2857]', day.isToday ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground')}>{headingLabel(day)}</span>
      {day.isToday ? (
        <span className="grid size-[38px] place-items-center rounded-full bg-primary font-display text-[21px] leading-none text-primary-foreground">{date}</span>
      ) : (
        <span className="flex h-[38px] items-center font-display text-[28px] leading-none text-foreground">{date}</span>
      )}
    </>
  );
  return (
    <h2 aria-current={onOpen ? undefined : day.isToday ? 'date' : undefined}>
      {onOpen ? (
        <Button
          variant="quiet"
          data-day={day.date}
          aria-current={day.isToday ? 'date' : undefined}
          aria-label={dayHeadingName(day)}
          onClick={onOpen}
          className="h-16 w-full flex-col gap-0.5 rounded-[14px] px-0"
        >
          {words}
        </Button>
      ) : (
        <span data-day={day.date} tabIndex={-1} className="flex h-16 flex-col items-center justify-center gap-0.5">
          {words}
        </span>
      )}
    </h2>
  );
}

// One day. Every pill is drawn in the column, in order, so that each can be measured: the ones that do not show are held
// out of the flow, invisible and out of reach, and the button says how many. Which show is measured again whenever the
// column is drawn or resized, and when the fonts have loaded, which change how a title wraps; in today's column the pills
// that are over give way first (pillsToShow), and each says when it ended in `data-ended-at`, read with its height.
function DayColumn({
  column,
  profiles,
  onOpenDay,
  onOpen,
  weather,
  room,
}: {
  column: ScheduleColumn;
  profiles: readonly Profile[];
  onOpenDay: ((date: string) => void) | null;
  onOpen: (occurrence: Occurrence) => void;
  weather: ForecastDay | undefined;
  room: boolean;
}) {
  const { day, pills } = column;
  const list = useRef<HTMLDivElement>(null);
  // Which pills show: all of them until the column has been measured.
  const [shown, setShown] = useState<readonly boolean[] | null>(null);
  const shows = (index: number) => shown?.[index] ?? true;
  const left = pills.filter((_, index) => !shows(index)).length;

  const measure = useCallback(() => {
    const element = list.current;
    if (!element) return;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const drawn = [...element.querySelectorAll<HTMLElement>('[data-pill]')];
    const next = pillsToShow({
      heightPx: element.getBoundingClientRect().height,
      pillPx: drawn.map((pill) => pill.getBoundingClientRect().height),
      gapPx: parseFloat(getComputedStyle(element).rowGap) || 0,
      morePx: MORE_REM * rem,
      endedAt: drawn.map((pill) => (pill.dataset.endedAt === undefined ? null : Number(pill.dataset.endedAt))),
    });
    // The same flags are the same state, so a read that changed nothing is not a render.
    setShown((last) => (last && last.length === next.length && last.every((flag, index) => flag === next[index]) ? last : next));
  }, []);
  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    // A font that arrives changes how a title wraps, and so how tall a pill is: measure once the fonts are ready, and
    // again each time more of them load (the subset an accented title needs comes later).
    let live = true;
    void document.fonts.ready.then(() => live && measure());
    document.fonts.addEventListener('loadingdone', measure);
    return () => {
      live = false;
      observer.disconnect();
      document.fonts.removeEventListener('loadingdone', measure);
    };
  }, [measure]);
  // New events, a new minute (an event may have ended) and a new heading all come through a render; measuring is a read.
  useLayoutEffect(measure);

  return (
    <section aria-label={`${describeCell(day.date, null)}${day.isToday ? ', today' : ''}`} className={cn('flex min-h-0 min-w-0 flex-col gap-2 rounded-[18px] p-1.5', day.isToday && 'bg-muted')}>
      <div className="flex-none">
        <ColumnHeading day={day} onOpen={onOpenDay && (() => onOpenDay(day.date))} />
        {/* A line for the forecast while the Household has a place, empty for a day it does not cover, so a column is as tall before the forecast arrives as after. */}
        {room && (
          <div className="flex h-[18px] items-center justify-center">
            <DayWeather day={weather} />
          </div>
        )}
      </div>
      <div ref={list} className="relative flex min-h-0 flex-1 flex-col gap-2">
        {pills.map((pill, index) => (
          <EventPill
            key={pill.occurrence.id}
            pill={pill}
            day={day}
            people={pillPeople(pill.occurrence, profiles)}
            onOpen={onOpen}
            className={shows(index) ? undefined : 'invisible absolute inset-x-0 top-0'}
          />
        ))}
        {left > 0 &&
          (onOpenDay ? (
            <Button variant="quiet" onClick={() => onOpenDay(day.date)} className="h-12 w-full rounded-[14px] px-0 text-sm font-medium">
              +{left} more
            </Button>
          ) : (
            <p className="flex h-12 items-center justify-center text-sm font-medium text-muted-foreground">+{left} more</p>
          ))}
      </div>
    </section>
  );
}

// The calendar of Home and Week: a column for each of `days`, reading what the Profile filter lets through. `version`
// changes when the screen around the calendar has written an event, so it reads again at once; `forecast` is the
// Household's weather and `weatherOn` says it has a place. `onOpenDay` opens a day from its heading; a day beyond the
// paging window is only a heading. `profiles` colour the pills: null until they are read, and the pills wait for them.
export function Schedule({
  timezone,
  now,
  days,
  version,
  onOpenDay,
  forecast,
  weatherOn,
  profiles,
}: {
  timezone: string;
  now: Date;
  days: WallDay[];
  version: number;
  onOpenDay: (date: string) => void;
  forecast: Forecast | null;
  weatherOn: boolean;
  profiles: Profile[] | null;
}) {
  const [open, setOpen] = useState<OpenEvent>(null);
  const events = useDayEvents(days, version, profiles);
  const pageWindow = pagingWindow(timezone, now);
  const columns = scheduleColumns(events.occurrences ?? [], days, now);
  // The day of the column the event that a sheet is open for was tapped in: where focus goes if that event is not on the screen any more.
  const openedOn = useRef(days[0]!.date);

  return (
    <section aria-label="Calendar" className="flex min-h-0 flex-1 flex-col rounded-3xl bg-card p-2">
      {events.problem && (
        <p role="alert" className="p-4 text-xl">
          {events.problem}
        </p>
      )}
      <div style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }} className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] gap-x-1.5">
        {columns.map((column) => (
          <DayColumn
            key={column.day.date}
            column={column}
            profiles={profiles ?? []}
            onOpenDay={canOpenDay(column.day.date, pageWindow) ? onOpenDay : null}
            onOpen={(occurrence) => {
              openedOn.current = column.day.date;
              setOpen({ sheet: 'details', occurrence });
            }}
            weather={forecastDay(forecast, column.day.date)}
            room={weatherOn}
          />
        ))}
      </div>
      <EventSheets
        open={open}
        onChange={setOpen}
        timezone={timezone}
        date={days[0]!.date}
        profiles={profiles ?? []}
        events={events}
        // After an event is deleted from its sheet, or moved by an edit, and is in no column: the heading of its day.
        focusPlace={() => focusElement(document.querySelector<HTMLElement>(`[data-day="${openedOn.current}"]`))}
      />
    </section>
  );
}
