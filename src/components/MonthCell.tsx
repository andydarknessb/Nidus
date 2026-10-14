import { cn } from 'cn';
import { Pin } from 'lucide-react';
import { eventTime, timeWords } from '../../supabase/functions/_shared/event-words.ts';
import type { Occurrence } from '../lib/calendar-occurrences';
import { personStyle } from '../lib/look';
import { BEYOND_RANGE, cellLines, type CellForm, type MonthCell } from '../lib/month-grid';
import type { WallDay } from '../lib/paged-view';
import type { MonthDot } from '../lib/phone-calendar';
import type { Profile } from '../lib/profiles';
import { pillPeople, type PillPeople } from '../lib/schedule';
import { FACE, HATCH, TOUCHING } from '../phone/parts';
import { EventDiscs, EventFill } from './EventPill';
import { TodayDisc } from './people';
import { Button } from './ui/button';

// One day of the month's grid, drawn from a MonthCell (month-grid.ts), on the Wall (DayCell) and on the phone (MonthDay). Inside the
// calendar's range it is a single button that opens the day. On the Wall it fills its cell: the date, then the day's occurrences a line
// each, as many as fit, and "+N more" for the rest. Events are not tappable here, the day is.

// A day cell is drawn to these sizes, in rem like the classes that draw it, so the lines measured to fit are the lines drawn at
// any text size: CELL_HEAD_REM above its first line (pt-1, the date's h-8.5 and mb-0.5, and the divider over its row, with a pixel to
// spare) and CELL_LINE_REM for each line (h-5.5 and mb-0.5). The grid multiplies them by the root font size when measuring.
export const CELL_HEAD_REM = 2.625;
export const CELL_LINE_REM = 1.5;

// The date of a Wall cell. Today's is in a filled disc (the date in a --primary disc, on every view): 34 px with a 20 px number, where the other
// dates are 22 px in the display face. Every date has the same 34 px row, so the lines under a week's dates start at the same place.
// Beyond the range the date sits on the card, so the hatch stays out from under it.
function WallDate({ day, beyond = false }: { day: WallDay; beyond?: boolean }) {
  return (
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
}

// A day beyond the range the calendar keeps (`beyond`), drawn once for both grids (WeekCells): no button, as it has nothing to open and
// nothing known about it, so its cell says so rather than look like a free day. On the Wall it is the date and the words; on the phone
// a 58 px cell that names its date too.
export function BeyondCell({ cell, form }: { cell: MonthCell; form: CellForm }) {
  if (form === 'lines') {
    return (
      <div className={cn('flex min-h-0 min-w-0 flex-col overflow-hidden px-1.5 pt-1', HATCH)}>
        <WallDate day={cell.day} beyond />
        <span className="sr-only">{BEYOND_RANGE}</span>
      </div>
    );
  }
  return (
    <div className="h-[58px] min-w-12 p-0.5">
      <div className={cn('flex size-full flex-col items-center rounded-xl pt-1', HATCH)}>
        <span aria-hidden className="grid h-[30px] min-w-8 place-items-center rounded-full bg-card px-1 font-display text-lg leading-none text-muted-foreground">
          {Number(cell.day.date.slice(8))}
        </span>
        <span className="sr-only">{cell.name}</span>
      </div>
    </div>
  );
}

// The Wall's day inside the range: a single button that opens the day and fills its cell. `cell.lines` are the day's own occurrences, in
// order, null until its week has been read; `profiles` fill each line, and the lines wait for them, so the caller's occurrences are null
// until it has them.
export function DayCell({
  cell,
  profiles,
  lines,
  onOpen,
}: {
  cell: MonthCell<'lines'>;
  profiles: readonly Profile[];
  lines: number;
  onOpen: (date: string) => void;
}) {
  const { day, inMonth, count } = cell;
  const date = <WallDate day={day} />;
  const { shown, more } = cellLines(cell.lines ?? [], lines);
  return (
    <Button
      variant="quiet"
      aria-current={day.isToday ? 'date' : undefined}
      aria-label={cell.name}
      onClick={() => onOpen(day.date)}
      // A day of the neighbouring month is dimmed with the muted colour, which holds 7:1 on the card and on today's lifted ground.
      // The cell is a grid item and clips what it holds, so its focus ring is drawn inside it.
      className={cn(
        '@container h-auto min-h-0 w-full min-w-0 flex-col items-stretch justify-start gap-0 overflow-hidden rounded-none px-1.5 pt-1 text-left font-normal focus-visible:-outline-offset-2 active:translate-y-0',
        inMonth || day.isToday ? 'text-foreground' : 'text-muted-foreground',
        day.isToday && 'bg-muted',
      )}
    >
      {lines === 0 ? (
        // A cell too short for a line under its date (isTightCell, at larger text): the date and, beside it, how many events the day holds. The
        // count is a number, since the room is the date's row; the cell's name says it in words.
        <span className="flex items-start justify-between gap-1">
          {date}
          {count !== null && count > 0 && (
            <span aria-hidden data-testid="cell-count" className="pr-1 text-sm leading-[2.125rem] font-semibold text-muted-foreground">
              {count}
            </span>
          )}
        </span>
      ) : (
        date
      )}
      {shown.map((occurrence) => (
        <EventLine key={occurrence.id} occurrence={occurrence} day={day} people={pillPeople(occurrence, profiles)} />
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
// holds 7:1 for them. It is one line and never wider than its cell, and the words give way to the discs: the pin, the time and the title
// are one group (flex-1, min-w-0) that clips its own overflow, and the discs, a sibling at the end, never shrink and are never cut. In the
// group the title gives way first (flex-1 with a basis of 0, max-w-max) down to 1.25 em, room for its ellipsis, then the time down to
// nothing, and then the group clips the title; where the line has not even that, the title may be cut to nothing, since the discs say whose it is. In a cell
// under 7 rem wide (the cell is the container) the pin is hidden and the gaps close up; the end of the time is cut (an ellipsis) when it
// must be. A cell with room is as it was. The title starts where it starts, whichever way it is written (dir="auto"), so a right-to-left
// one is cut at its end.
function EventLine({ occurrence, day, people }: { occurrence: Occurrence; day: WallDay; people: PillPeople }) {
  const time = timeWords(eventTime(occurrence, day), 'line');
  return (
    <span data-testid="event-line" className="relative mb-0.5 flex h-5.5 min-w-0 shrink-0 items-center gap-1 overflow-hidden rounded-lg pr-1 pl-1.5 text-foreground @max-[7rem]:gap-0.5">
      <EventFill people={people} />
      <span data-testid="event-words" className="relative flex min-w-0 flex-1 items-center gap-1 overflow-hidden @max-[7rem]:gap-0.5">
        {occurrence.source === 'native' && <Pin aria-hidden data-testid="native-mark" className="size-3.5 shrink-0 @max-[7rem]:hidden" />}
        {time && <span className="min-w-0 truncate text-sm font-medium tabular-nums">{time}</span>}
        <span dir="auto" className="min-w-[1.25em] max-w-max flex-1 truncate text-[0.9375rem] leading-5 font-semibold">
          {occurrence.title}
        </span>
      </span>
      <span className="relative ml-auto flex shrink-0">
        <EventDiscs people={people} size={16} />
      </span>
    </span>
  );
}

function Dot({ dot }: { dot: MonthDot }) {
  return dot.kind === 'household' ? (
    <span className="size-[7px] rounded-full bg-primary" />
  ) : (
    <span className="person size-[7px] rounded-full bg-person-strong" style={personStyle(dot.profile.color)} />
  );
}

// The phone's day inside the range (docs/look.md, "The phone", A Month cell): the date over up to three 7 px dots (`cell.dots`: who has
// something that day), named by `cell.name`, so the dots are never the only telling. The button is 58 tall and a cell wide, and the
// cells touch. The Selected fill and ring are drawn 2 px inside it, on an inner span, so two cells never read as one (as the day chips do).
export function MonthDay({ cell, picked, onPick }: { cell: MonthCell<'dots'>; picked: boolean; onPick: (date: string) => void }) {
  const { day, inMonth } = cell;
  const number = Number(day.date.slice(8));
  return (
    <Button
      variant="quiet"
      data-day={day.date}
      aria-label={cell.name}
      aria-pressed={picked}
      aria-current={day.isToday ? 'date' : undefined}
      onClick={() => onPick(day.date)}
      className={cn(TOUCHING, 'h-[58px] min-w-12')}
    >
      <span className={cn(FACE, 'flex-col gap-0.5')}>
        {day.isToday ? (
          <TodayDisc size={30}>{number}</TodayDisc>
        ) : (
          <span aria-hidden className={cn('flex h-[30px] items-center font-display text-lg leading-none', inMonth ? 'text-foreground' : 'text-muted-foreground')}>
            {number}
          </span>
        )}
        <span aria-hidden className="flex h-[7px] gap-1">
          {cell.dots.map((dot) => (
            <Dot key={dot.kind === 'household' ? 'household' : dot.profile.id} dot={dot} />
          ))}
        </span>
      </span>
    </Button>
  );
}
