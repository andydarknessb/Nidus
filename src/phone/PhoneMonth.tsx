import { cn } from 'cn';
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { BEYOND_RANGE, HATCH } from '../components/MonthCell';
import { Button } from '../components/ui/button';
import {
  canOpenDay,
  dayOccurrences,
  describeCell,
  describeMonth,
  monthWeeks,
  pageDays,
  weekStart,
  type Occurrence,
  type PagingWindow,
  type WallDay,
} from '../lib/calendar-occurrences';
import { personStyle } from '../lib/look';
import { monthDots, pickedDay, type MonthDot } from '../lib/phone-calendar';
import { ProfileFilterContext } from '../lib/profile-filter';
import type { Profile } from '../lib/profiles';
import { WEEKDAYS } from '../lib/routines';
import { useOccurrences } from '../lib/wall-hooks';
import { DayEvents } from './DayEvents';
import { FACE, PhoneCard, SideScroll, TOUCHING } from './parts';

// The phone's Month (docs/specs/0004-the-wall-on-a-phone.md; docs/look.md, "The phone", A Month cell): the weekdays' three letters (14 px), then the
// grid of 58 px cells, each a button for one day, then the picked day's heading and events under it. A cell is the date over up to
// three 7 px dots (who has something that day: monthDots), and says its full date and how many events it has in its name, so the dots
// are never the only telling. Today has the --primary disc and `aria-current="date"`; the picked day is `aria-pressed` and has the
// Selected look. The picked day starts as today when the month holds it, else the 1st, and is the screen's own state, given up when
// the month changes (the screen is keyed on it).

// A cell is a touching 48 px target at least, so a row narrower than seven of them (336 px) scrolls sideways, as the day chips do.
const ROW_FLOOR = 'min-w-[336px]';

function Dot({ dot }: { dot: MonthDot }) {
  return dot.kind === 'household' ? (
    <span className="size-[7px] rounded-full bg-primary" />
  ) : (
    <span className="person size-[7px] rounded-full bg-person-strong" style={personStyle(dot.profile.color)} />
  );
}

// One day of the grid. `occurrences` are the day's own, in order and after the Profile filter, and null until its week has been read
// (the name then gives the date alone: "no events" would call a day free that may not be). A day past the range the calendar keeps
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
  profiles,
  pressed,
  onPick,
}: {
  day: WallDay;
  inMonth: boolean;
  beyond: boolean;
  picked: boolean;
  occurrences: Occurrence[] | null;
  profiles: readonly Profile[];
  pressed: readonly string[];
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
  const dots = occurrences === null ? [] : monthDots(occurrences, profiles, pressed);
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

// What one week of the grid has read: its occurrences after the filter (null until the first read lands, and for a week that is never
// read) and whether the first read failed.
type WeekRead = { occurrences: Occurrence[] | null; unread: boolean };

// The seven cells of a week, given what its week has read (null until it has, and for a week that is never read).
export function WeekCells({
  days,
  anchor,
  window,
  occurrences,
  profiles,
  picked,
  onPick,
}: {
  days: WallDay[];
  anchor: string;
  window: PagingWindow;
  occurrences: Occurrence[] | null;
  profiles: readonly Profile[];
  picked: string;
  onPick: (date: string) => void;
}) {
  const { pressed } = useContext(ProfileFilterContext);
  return (
    <div className="grid grid-cols-7">
      {days.map((day) => (
        <MonthDay
          key={day.date}
          day={day}
          inMonth={day.date.slice(0, 7) === anchor.slice(0, 7)}
          beyond={!canOpenDay(day.date, window)}
          picked={day.date === picked}
          occurrences={occurrences === null ? null : dayOccurrences(occurrences, day)}
          profiles={profiles}
          pressed={pressed}
          onPick={onPick}
        />
      ))}
    </div>
  );
}

// One week of the grid, which reads its own seven days: the API caps a read at 1000 rows without saying so, and a week cannot reach
// that where a month could. It tells the screen what it has read, so the picked day's list needs no read of its own. The cells are
// drawn from the Profiles, so until they are read the week is as one that has not been read yet.
function WeekRow({
  days,
  anchor,
  window,
  version,
  profiles,
  picked,
  onPick,
  onRead,
}: {
  days: WallDay[];
  anchor: string;
  window: PagingWindow;
  version: number;
  profiles: Profile[] | null;
  picked: string;
  onPick: (date: string) => void;
  onRead: (week: string, read: WeekRead) => void;
}) {
  const week = days[0]!.date;
  const { occurrences, failed } = useOccurrences(days, version);
  // As on the other views, only a read that has never landed is reported: a later failure keeps what is shown.
  const unread = failed && occurrences === null;
  const waiting = profiles === null;
  const read = waiting ? null : occurrences;
  useEffect(() => {
    onRead(week, { occurrences: read, unread });
  }, [onRead, week, read, unread]);
  return <WeekCells days={days} anchor={anchor} window={window} occurrences={read} profiles={profiles ?? []} picked={picked} onPick={onPick} />;
}

// The Month page anchored on `anchor` (the 1st). `version` changes when the screen around the calendar has written an event, so every
// week reads again at once.
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
  // The pick is the screen's own: until a day is tapped it is the default, which follows today across Household midnight.
  const [pick, setPick] = useState<string | null>(null);
  const picked = pick ?? pickedDay('month', anchor, timezone, now);
  const [reads, setReads] = useState<Record<string, WeekRead>>({});
  const onRead = useCallback((week: string, read: WeekRead) => {
    setReads((current) => {
      const last = current[week];
      return last && last.occurrences === read.occurrences && last.unread === read.unread ? current : { ...current, [week]: read };
    });
  }, []);
  // An edit made from the picked day's sheet counts into `version`, so every week reads again like an event added around the calendar.
  const [edits, setEdits] = useState(0);

  const pickedWeek = reads[weekStart(picked)];
  const beyond = !canOpenDay(picked, window);
  const day = pageDays('day', picked, timezone, now)[0]!;
  const anyUnread = Object.values(reads).some((read) => read.unread);

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
            {weeks.map((days) =>
              // A week wholly past the range has nothing to read, so it is drawn without asking the API.
              days.every((day) => !canOpenDay(day.date, window)) ? (
                <WeekCells key={days[0]!.date} days={days} anchor={anchor} window={window} occurrences={null} profiles={profiles ?? []} picked={picked} onPick={setPick} />
              ) : (
              <WeekRow
                key={days[0]!.date}
                days={days}
                anchor={anchor}
                window={window}
                version={version + edits}
                profiles={profiles}
                picked={picked}
                onPick={setPick}
                onRead={onRead}
              />
              ),
            )}
          </div>
        </SideScroll>
        {anyUnread && (
          <p role="alert" className="text-base">
            Could not load the calendar. Check your connection.
          </p>
        )}
        <DayEvents
          day={day}
          occurrences={beyond || !pickedWeek ? null : pickedWeek.occurrences}
          failed={pickedWeek?.unread ?? false}
          beyond={beyond}
          profiles={profiles}
          now={now}
          timezone={timezone}
          onEdited={() => setEdits((count) => count + 1)}
          announce={false}
        />
      </PhoneCard>
    </>
  );
}
