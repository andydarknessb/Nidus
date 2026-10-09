import { cn } from 'cn';
import { useMemo, useState } from 'react';
import { BEYOND_RANGE, HATCH } from '../components/MonthCell';
import { ReadState } from '../components/ReadState';
import { Button } from '../components/ui/button';
import {
  describeCell,
  describeMonth,
  type Occurrence,
} from '../lib/calendar-occurrences';
import {
  canOpenDay,
  monthWeeks,
  pageDays,
  type PagingWindow,
  type WallDay,
} from '../lib/paged-view';
import { personStyle } from '../lib/look';
import type { DayEvents as Read } from '../lib/day-events';
import { pickedDay, type MonthDot } from '../lib/phone-calendar';
import type { Profile } from '../lib/profiles';
import { WEEKDAYS } from '../lib/routines';
import { useDayEvents } from '../lib/wall-hooks';
import { DayEvents } from './DayEvents';
import { FACE, PhoneCard, SideScroll, TOUCHING } from './parts';

// The phone's Month (docs/specs/0004-the-wall-on-a-phone.md; docs/look.md, "The phone", A Month cell): the weekdays' three letters (14 px), then the
// grid of 58 px cells, each a button for one day, then the picked day's heading and events under it. A cell is the date over up to
// three 7 px dots (who has something that day: monthDots), and says its full date and how many events it has in its name, so the dots
// are never the only telling. Today has the --primary disc and `aria-current="date"`; the picked day is `aria-pressed` and has the
// Selected look. The picked day starts as today when the month holds it, else the 1st, and is the screen's own state, given up when
// the month changes (the screen is keyed on it).

// A cell is a touching 48 px target at least, so a row narrower than seven of them (336 px) scrolls sideways, as the day chips do. A cell is
// also as wide as the weekday's three letters (14 px, in rem, so 2.4 rem and more), so at larger text the letters never run into each other.
const ROW_FLOOR = 'min-w-[calc(7*max(48px,2.4rem))]';

function Dot({ dot }: { dot: MonthDot }) {
  return dot.kind === 'household' ? (
    <span className="size-[7px] rounded-full bg-primary" />
  ) : (
    <span className="person size-[7px] rounded-full bg-person-strong" style={personStyle(dot.profile.color)} />
  );
}

// One day of the grid. `occurrences` are the day's own, in order and after the Profile filter, and null until the month has been read
// (the name then gives the date alone: "no events" would call a day free that may not be); `dots` are who has something that day
// (DayEvents.dots). A day past the range the calendar keeps
// (`beyond`) is no button: it has nothing to open, so it is a hatched cell that says so.
//
// The button is 58 tall and a cell wide, and the cells touch. The Selected fill and ring are drawn 2 px inside it, on an inner span,
// so two cells never read as one (as the day chips do).
export function MonthDay({
  day,
  inMonth,
  beyond,
  picked,
  occurrences,
  dots,
  onPick,
}: {
  day: WallDay;
  inMonth: boolean;
  beyond: boolean;
  picked: boolean;
  occurrences: Occurrence[] | null;
  dots: readonly MonthDot[];
  onPick: (date: string) => void;
}) {
  const number = Number(day.date.slice(8));
  // As the chips and the tablet's cells are named: the date and how many events, with ", today" on today's.
  const words = `${describeCell(day.date, occurrences === null ? null : occurrences.length)}${day.isToday ? ', today' : ''}`;
  if (beyond) {
    return (
      <div className="h-[58px] min-w-12 p-0.5">
        <div className={cn('flex size-full flex-col items-center rounded-xl pt-1', HATCH)}>
          <span aria-hidden className="grid h-[30px] min-w-8 place-items-center rounded-full bg-card px-1 font-display text-lg leading-none text-muted-foreground">
            {number}
          </span>
          <span className="sr-only">{`${describeCell(day.date, null)}, ${BEYOND_RANGE}`}</span>
        </div>
      </div>
    );
  }
  return (
    <Button
      variant="quiet"
      data-day={day.date}
      aria-label={words}
      aria-pressed={picked}
      aria-current={day.isToday ? 'date' : undefined}
      onClick={() => onPick(day.date)}
      className={cn(TOUCHING, 'h-[58px] min-w-12')}
    >
      <span className={cn(FACE, 'flex-col gap-0.5')}>
        {day.isToday ? (
          <span aria-hidden className="grid size-[30px] place-items-center rounded-full bg-primary font-display text-lg leading-none text-primary-foreground">
            {number}
          </span>
        ) : (
          <span aria-hidden className={cn('flex h-[30px] items-center font-display text-lg leading-none', inMonth ? 'text-foreground' : 'text-muted-foreground')}>
            {number}
          </span>
        )}
        <span aria-hidden className="flex h-[7px] gap-1">
          {dots.map((dot) => (
            <Dot key={dot.kind === 'household' ? 'household' : dot.profile.id} dot={dot} />
          ))}
        </span>
      </span>
    </Button>
  );
}

// The seven cells of a week, from the month's day events (null for a week that is never read).
export function WeekCells({
  days,
  anchor,
  window,
  events,
  picked,
  onPick,
}: {
  days: WallDay[];
  anchor: string;
  window: PagingWindow;
  events: Read | null;
  picked: string;
  onPick: (date: string) => void;
}) {
  return (
    <div className="grid grid-cols-7">
      {days.map((day) => (
        <MonthDay
          key={day.date}
          day={day}
          inMonth={day.date.slice(0, 7) === anchor.slice(0, 7)}
          beyond={!canOpenDay(day.date, window)}
          picked={day.date === picked}
          occurrences={events === null ? null : events.on(day)}
          dots={events === null ? [] : events.dots(day)}
          onPick={onPick}
        />
      ))}
    </div>
  );
}

// The Month page anchored on `anchor` (the 1st), read in one go (useDayEvents), so the picked day's list needs no read of its own.
// `version` changes when the screen around the calendar has written an event, so the month reads again at once.
export function PhoneMonth({
  timezone,
  now,
  today,
  anchor,
  window,
  version,
  profiles,
}: {
  timezone: string;
  now: Date;
  today: string;
  anchor: string;
  window: PagingWindow;
  version: number;
  profiles: Profile[] | null;
}) {
  // Built once a page and a day, not on every tick of the clock: it is the slow part.
  const weeks = useMemo(() => monthWeeks(anchor, timezone, today), [anchor, timezone, today]);
  const events = useDayEvents(useMemo(() => weeks.flat(), [weeks]), version, profiles);
  // The pick is the screen's own: until a day is tapped it is the default, which follows today across Household midnight.
  const [pick, setPick] = useState<string | null>(null);
  const picked = pick ?? pickedDay('month', anchor, timezone, now);
  const beyond = !canOpenDay(picked, window);
  const day = pageDays('day', picked, timezone, now)[0]!;

  return (
    <>
      <PhoneCard label="Calendar">
        {/* The weeks share the card's width, and scroll sideways under 336 px as the day chips do. */}
        <SideScroll label={describeMonth(anchor)} className="-mx-3">
          <div className={cn('flex flex-1 flex-col', ROW_FLOOR)}>
            {/* Every cell's name says its weekday already, so a screen reader need not hear the row of them first. */}
            <div aria-hidden className="grid grid-cols-7 pb-1">
              {WEEKDAYS.map((weekday) => (
                <span key={weekday.bit} className="text-center text-sm leading-5 font-medium text-muted-foreground">
                  {weekday.short}
                </span>
              ))}
            </div>
            {weeks.map((days) => (
              <WeekCells
                key={days[0]!.date}
                days={days}
                anchor={anchor}
                window={window}
                // A week wholly past the range is drawn as one that holds nothing to read.
                events={days.every((other) => !canOpenDay(other.date, window)) ? null : events}
                picked={picked}
                onPick={setPick}
              />
            ))}
          </div>
        </SideScroll>
        <ReadState of="the calendar" read={events} say="failed" />
        <DayEvents day={day} events={events} beyond={beyond} profiles={profiles} now={now} timezone={timezone} announce={false} />
      </PhoneCard>
    </>
  );
}
