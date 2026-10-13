import { cn } from 'cn';
import { useMemo, useState } from 'react';
import { WeekCells } from '../components/MonthGrid';
import { ReadState } from '../components/ReadState';
import { describeMonth } from '../lib/calendar-occurrences';
import { canOpenDay, monthWeeks, pageDays, type PagingWindow } from '../lib/paged-view';
import { monthCells } from '../lib/month-grid';
import { pickedDay } from '../lib/phone-calendar';
import type { Profile } from '../lib/profiles';
import { WEEKDAYS } from '../lib/routines';
import { useDayEvents } from '../lib/wall-hooks';
import { DayEvents } from './DayEvents';
import { PhoneCard, SideScroll } from './parts';

// The phone's Month (docs/specs/0004-the-wall-on-a-phone.md; docs/look.md, "The phone", A Month cell): the weekdays' three letters (14 px), then the
// grid of 58 px cells, each a button for one day (MonthDay in components/MonthCell.tsx, drawn from monthCells' dots), then the picked day's
// heading and events under it. A cell is the date over up to three 7 px dots (who has something that day: monthDots), and says its full
// date and how many events it has in its name, so the dots are never the only telling. Today has the --primary disc and
// `aria-current="date"`; the picked day is `aria-pressed` and has the Selected look. The picked day starts as today when the month
// holds it, else the 1st, and is the screen's own state, given up when the month changes (the screen is keyed on it).

// A cell is a touching 48 px target at least, so a row narrower than seven of them (336 px) scrolls sideways, as the day chips do. A cell is
// also as wide as the weekday's three letters (14 px, in rem, so 2.4 rem and more), so at larger text the letters never run into each other.
const ROW_FLOOR = 'min-w-[calc(7*max(48px,2.4rem))]';

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
  const cells = monthCells(weeks, anchor, window, events, 'dots');
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
            {cells.map((week) => (
              <WeekCells key={week[0]!.day.date} form="dots" cells={week} picked={picked} onOpen={setPick} />
            ))}
          </div>
        </SideScroll>
        <ReadState of="the calendar" read={events} say="failed" />
        <DayEvents day={day} events={events} beyond={beyond} profiles={profiles} now={now} timezone={timezone} announce={false} />
      </PhoneCard>
    </>
  );
}
