import { cn } from 'cn';
import { Pin } from 'lucide-react';
import { cellLines, describeCell, formatCompactClock, type Occurrence, type WallDay } from '../lib/calendar-occurrences';
import type { Profile } from '../lib/profiles';
import { pillPeople, type PillPeople } from '../lib/schedule';
import { EventDiscs, EventFill } from './EventPill';
import { Button } from './ui/button';

// One day of the month's grid. Inside the calendar's range it is a single button that opens the day and fills its cell: the date,
// then the day's occurrences a line each, as many as fit, and "+N more" for the rest. Events are not tappable here, the day is.

// A day cell is drawn to these sizes, in rem like the classes that draw it, so the lines measured to fit are the lines drawn at
// any text size: CELL_HEAD_REM above its first line (pt-1, the date's h-8.5 and mb-0.5, and the divider over its row, with a pixel to
// spare) and CELL_LINE_REM for each line (h-5.5 and mb-0.5). The grid multiplies them by the root font size when measuring.
export const CELL_HEAD_REM = 2.625;
export const CELL_LINE_REM = 1.5;

export const BEYOND_RANGE = "Beyond the calendar's range";
// The ground of a day beyond the range: thin diagonal lines in --input, so that "beyond the calendar's range" is told by a mark
// and not by colour alone. --input holds 3:1 on the card in both modes (tests/look.test.ts). The date sits on a --card ground of
// its own, so the lines never run under the digits. Used by the tablet's grid and the phone's (src/phone/PhoneMonth.tsx).
export const HATCH = 'bg-[repeating-linear-gradient(135deg,transparent_0_6px,var(--input)_6px_8px)]';

// What the cell is called: the date drawn on it first, so a name spoken from the screen ("22") finds it, then "today" on today's
// (which the disc says to the eye), then the day in full and how many events it holds. Until its week has been read there is no
// count to give, and "no events" would call a day free that may not be.
function cellName(day: WallDay, occurrences: Occurrence[] | null): string {
  const date = Number(day.date.slice(8));
  return `${date}, ${day.isToday ? 'today, ' : ''}${describeCell(day.date, occurrences === null ? null : occurrences.length)}`;
}

// `occurrences` are the day's own, in order, and null until its week has been read; `profiles` fill each line, and the lines wait
// for them, so the caller gives null for `occurrences` until it has them. A day beyond the range has nothing to open and nothing
// known about it, so its cell says so rather than look like a free day.
export function DayCell({
  day,
  inMonth,
  beyond,
  occurrences,
  profiles,
  lines,
  timezone,
  onOpen,
}: {
  day: WallDay;
  inMonth: boolean;
  beyond: boolean;
  occurrences: Occurrence[] | null;
  profiles: readonly Profile[];
  lines: number;
  timezone: string;
  onOpen: (date: string) => void;
}) {
  // Today's date is in a filled disc (the date in a --primary disc, on every view): 34 px with a 20 px number, where the other dates
  // are 22 px in the display face. Every date has the same 34 px row, so the lines under a week's dates start at the same place.
  // Beyond the range the date sits on the card, so the hatch stays out from under it.
  const date = (
    <span
      className={cn(
        'mb-0.5 grid h-8.5 shrink-0 place-items-center self-start rounded-full font-display leading-none',
        day.isToday ? 'w-8.5 bg-primary text-xl text-primary-foreground' : 'min-w-8.5 px-1 text-[1.375rem]',
        beyond && 'bg-card',
      )}
    >
      {Number(day.date.slice(8))}
    </span>
  );
  if (beyond) {
    return (
      <div className={cn('flex min-h-0 min-w-0 flex-col overflow-hidden px-1.5 pt-1', HATCH)}>
        {date}
        <span className="sr-only">{BEYOND_RANGE}</span>
      </div>
    );
  }
  const { shown, more } = cellLines(occurrences ?? [], lines);
  return (
    <Button
      variant="quiet"
      aria-current={day.isToday ? 'date' : undefined}
      aria-label={cellName(day, occurrences)}
      onClick={() => onOpen(day.date)}
      // A day of the neighbouring month is dimmed with the muted colour, which holds 7:1 on the card and on today's lifted ground.
      // The cell is a grid item and clips what it holds, so its focus ring is drawn inside it.
      className={cn(
        'h-auto min-h-0 w-full min-w-0 flex-col items-stretch justify-start gap-0 overflow-hidden rounded-none px-1.5 pt-1 text-left font-normal focus-visible:-outline-offset-2 active:translate-y-0',
        inMonth || day.isToday ? 'text-foreground' : 'text-muted-foreground',
        day.isToday && 'bg-muted',
      )}
    >
      {lines === 0 ? (
        // A cell too short for a line under its date (isTightCell, at larger text): the date and, beside it, how many events the day holds. The
        // count is a number, since the room is the date's row; the cell's name says it in words.
        <span className="flex items-start justify-between gap-1">
          {date}
          {occurrences !== null && occurrences.length > 0 && (
            <span aria-hidden data-testid="cell-count" className="pr-1 text-sm leading-[2.125rem] font-semibold text-muted-foreground">
              {occurrences.length}
            </span>
          )}
        </span>
      ) : (
        date
      )}
      {shown.map((occurrence) => (
        <EventLine key={occurrence.id} occurrence={occurrence} day={day} timezone={timezone} people={pillPeople(occurrence, profiles)} />
      ))}
      {more && lines > 0 && <span className="h-6 shrink-0 px-1.5 text-sm leading-6 font-medium text-muted-foreground">{more}</span>}
    </Button>
  );
}

// One occurrence on a day: its people's fill (EventFill, as on the pill: never a Mirrored Calendar's colour), the pin of a Native
// Event, the start time of a timed one (with no ":00" on the hour, to leave room for the title), the title, cut short with an
// ellipsis, and at the end who it is for, in discs (EventDiscs, by the pill's rule, at 16 px): colour alone does not say whose an
// event is, as two people can share a colour to the eye and four of five draw the same three bands as three. A timed event that
// began on an earlier day only continues, so it shows no time, as in the week view. The words are --foreground, on a fill that
// holds 7:1 for them. It is one line and never wider than its cell: the title gives way, and the discs never shrink. The title
// starts where it starts, whichever way it is written (dir="auto"), so a right-to-left one is cut at its end.
function EventLine({ occurrence, day, timezone, people }: { occurrence: Occurrence; day: WallDay; timezone: string; people: PillPeople }) {
  const start = Date.parse(occurrence.starts_at);
  const time = !occurrence.is_all_day && start >= day.startMs ? formatCompactClock(start, timezone) : null;
  return (
    <span data-testid="event-line" className="relative mb-0.5 flex h-5.5 min-w-0 shrink-0 items-center gap-1 overflow-hidden rounded-lg pr-1 pl-1.5 text-foreground">
      <EventFill people={people} />
      {occurrence.source === 'native' && <Pin aria-hidden data-testid="native-mark" className="relative size-3.5 shrink-0" />}
      {time && <span className="relative shrink-0 text-sm font-medium tabular-nums">{time}</span>}
      <span dir="auto" className="relative min-w-0 truncate text-[0.9375rem] leading-5 font-semibold">
        {occurrence.title}
      </span>
      <span className="relative ml-auto flex shrink-0">
        <EventDiscs people={people} size={16} />
      </span>
    </span>
  );
}
