import { useEffect, useState, type CSSProperties } from 'react';
import {
  fiveDays,
  formatClock,
  describeWhen,
  loadOccurrences,
  nowFraction,
  place,
  visibleHours,
  type AllDayBar,
  type Occurrence,
  type TimedBlock,
  type WallDay,
} from '../lib/calendar-occurrences';
import { householdDay, WEEKDAYS } from '../lib/routines';
import { supabase } from '../lib/supabase';
import { EventDetails } from './EventDetails';

// The home screen's calendar: today and the next four days as columns in the Household
// Timezone. An all-day band on top (multi-day events span their columns), timed events
// positioned by time below, a line at the current time and today's column lifted. Tapping an
// event opens its details.
const REFRESH_MS = 60_000;
const RETRY_MS = 5_000;
const CLOCK_MS = 30_000;
// Events with no colour (a whole-Household calendar) still need an edge to read against.
const NEUTRAL = '#d4d4d8';
const GRID = 'grid grid-cols-[4.5rem_repeat(5,minmax(0,1fr))]';

function hourLabel(hour: number): string {
  return `${hour % 12 || 12} ${hour % 24 < 12 ? 'AM' : 'PM'}`;
}

// A tinted block in the event's colour: the colour is the edge and a wash, never the text, so
// the words stay white on a dark ground whatever colour the Profile picked.
function tint(color: string | null): CSSProperties {
  const edge = color ?? NEUTRAL;
  return { borderLeftColor: edge, backgroundColor: `color-mix(in srgb, ${edge} 24%, #18181b)` };
}

export function FiveDayCalendar({ timezone }: { timezone: string }) {
  const [now, setNow] = useState(() => new Date());
  const [occurrences, setOccurrences] = useState<Occurrence[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<Occurrence | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), CLOCK_MS);
    return () => clearInterval(id);
  }, []);

  const today = householdDay(timezone, now).date;
  // Read again when the Household's day or timezone changes, and on a timer for new events.
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function read() {
      let delay = REFRESH_MS;
      try {
        const span = fiveDays(timezone, new Date());
        const rows = await loadOccurrences(supabase, new Date(span[0]!.startMs), new Date(span[4]!.endMs));
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
  }, [timezone, today]);

  const days = fiveDays(timezone, now);
  const { allDay, columns } = place(occurrences ?? [], days);
  const todayFraction = nowFraction(days[0]!, now);
  const { startHour, endHour } = visibleHours(columns, todayFraction);
  const hours = Array.from({ length: endHour - startHour + 1 }, (_, index) => startHour + index);

  return (
    <section aria-label="Calendar" className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border">
      <div className={`${GRID} border-b border-border`}>
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
      {allDay.length > 0 && <AllDayBand bars={allDay} onOpen={setOpen} />}
      <div className={`${GRID} min-h-0 flex-1`}>
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
            {day.isToday && todayFraction !== null && (
              <div
                aria-hidden
                data-testid="now-line"
                className="pointer-events-none absolute inset-x-0 z-[5] h-0.5 bg-red-300"
                style={{ top: `${((todayFraction * 24 - startHour) / (endHour - startHour)) * 100}%` }}
              >
                <span className="absolute -top-1 -left-1.5 size-3.5 rounded-full bg-red-300" />
              </div>
            )}
          </div>
        ))}
      </div>
      {open && <EventDetails occurrence={open} timezone={timezone} onClose={() => setOpen(null)} />}
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

function AllDayBand({ bars, onOpen }: { bars: AllDayBar[]; onOpen: (occurrence: Occurrence) => void }) {
  return (
    <div className={`${GRID} max-h-[30%] auto-rows-min gap-y-1 overflow-y-auto border-b border-border py-1`}>
      {bars.map((bar) => (
        <button
          key={bar.occurrence.id}
          type="button"
          onClick={() => onOpen(bar.occurrence)}
          aria-label={`${bar.occurrence.title}, ${bar.occurrence.calendar_name}, all day`}
          className={`mx-1 flex min-h-12 items-center truncate border-l-8 px-3 text-left text-lg font-medium ${bar.continuesBefore ? 'rounded-l-none' : 'rounded-l-md'} ${bar.continuesAfter ? 'rounded-r-none' : 'rounded-r-md'}`}
          style={{ ...tint(bar.occurrence.color), gridColumn: `${bar.startColumn + 2} / span ${bar.span}`, gridRow: bar.row + 1 }}
        >
          <span className="truncate">{bar.occurrence.title}</span>
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
  const top = ((block.top * 24 - startHour) / range) * 100;
  const bottom = ((block.bottom * 24 - startHour) / range) * 100;
  return (
    <button
      type="button"
      onClick={() => onOpen(occurrence)}
      aria-label={`${occurrence.title}, ${occurrence.calendar_name}, ${describeWhen(occurrence, timezone)}`}
      // A short event is still a 48 px target, so it may run past its end on the grid.
      className="absolute z-[1] min-h-12 overflow-hidden rounded-md border-l-8 px-2 py-1 text-left text-lg leading-tight"
      style={{
        ...tint(occurrence.color),
        top: `${top}%`,
        height: `${bottom - top}%`,
        left: `calc(${(block.lane / block.lanes) * 100}% + 2px)`,
        width: `calc(${100 / block.lanes}% - 4px)`,
      }}
    >
      <span className="block font-semibold break-words">{occurrence.title}</span>
      {!block.continuesBefore && <span className="block text-base">{formatClock(Date.parse(occurrence.starts_at), timezone)}</span>}
    </button>
  );
}
