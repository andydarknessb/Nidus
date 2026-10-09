// Event words: what an event's time and a date say, once, for the Wall, the phone and the push
// notifications. Facts first (eventTime: is it all day, does it go on from an earlier day, where does
// it end, do the clocks repeat inside it), then the words for a place (timeWords: the schedule pill,
// the day block, the month line, the details sheet). Nothing else formats a clock time or a date for
// a person to read. Beside the Household clock (zoned-time.ts), and plain Intl like it, so the same
// words come out under Node, the browser and Deno.

import { householdTime } from './zoned-time.ts';

// What an event is, as the calendar_occurrences view and the Edge Functions' rows both have it.
export type EventSpan = { starts_at: string; ends_at: string; is_all_day: boolean };

// The day an event is told on: its Household day's instants and the Household Timezone, or the zone alone
// for words that are not about one day (the details sheet).
export type EventDay = { timezone: string } | { timezone: string; startMs: number; endMs: number };

export type EventTime = {
  // Says "All day": an all-day event, or a timed one that covers the day from end to end. Only a day
  // given with its instants can be covered.
  allDay: boolean;
  // A timed event that began on an earlier day.
  continues: boolean;
  // Ends by the end of the day (an event ending at midnight ends on the day before it).
  endsHere: boolean;
  start: number;
  end: number;
  // The event starts and ends on one day, yet its end reads as its start or earlier on the clock,
  // because the clocks went back inside it: "1:00 AM to 1:00 AM". Its times then say their zones.
  clocksRepeat: boolean;
  timezone: string;
};

export function eventTime(occurrence: EventSpan, day: EventDay): EventTime {
  const start = Date.parse(occurrence.starts_at);
  const end = Date.parse(occurrence.ends_at);
  const window = 'startMs' in day ? day : null;
  const from = householdTime(start, day.timezone);
  const to = householdTime(end, day.timezone);
  return {
    allDay: occurrence.is_all_day || (window !== null && start <= window.startMs && end >= window.endMs),
    continues: window !== null && start < window.startMs,
    endsHere: window === null || end <= window.endMs,
    start,
    end,
    clocksRepeat: end > start && from.date === to.date && to.minutes <= from.minutes,
    timezone: day.timezone,
  };
}

// "10:30 AM" on the Household's clock.
export function formatClock(ms: number, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' }).format(new Date(ms));
}

// "1:00 AM CDT": a time with the zone's short name, for the night the clocks go back, when one clock time is two instants.
const clockWithZone = (ms: number, timezone: string): string =>
  new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(ms));

export type TimeForm = 'pill' | 'block' | 'line' | 'sheet';

// The sentence for `form`:
//   pill   "All day", "Until 2:00 AM" on the last day of an event that began earlier, else the start, "9:00 AM". The
//          schedule's pill, push-notify's morning summary and the phone's lines.
//   block  "4:00 to 4:45 PM" (one AM or PM when both ends share it, "11:30 AM to 12:30 PM" when not, the zones when the
//          clocks repeat) for an event that lies within the day; any other says what the pill says.
//   line   the start without its ":00", "10 AM" or "9:30 AM", for the month's line, which has room for little else; ""
//          for an event that says no time (all day, or one that began earlier).
//   sheet  "Wed, Sep 30, 9:00 AM to 10:00 AM", "Wed, Sep 30 to Fri, Oct 2, all day": the dates too, for an event given
//          by its zone alone.
export function timeWords(time: EventTime, form: TimeForm): string {
  const { start, end, timezone } = time;
  const pill = () => (time.allDay ? 'All day' : time.continues ? `Until ${formatClock(end, timezone)}` : formatClock(start, timezone));
  switch (form) {
    case 'pill':
      return pill();
    case 'block': {
      if (time.allDay || time.continues || !time.endsHere || end <= start) return pill();
      if (time.clocksRepeat) return `${clockWithZone(start, timezone)} to ${clockWithZone(end, timezone)}`;
      const [from = '', fromPeriod = ''] = formatClock(start, timezone).split(/\s+/);
      const [to = '', toPeriod = ''] = formatClock(end, timezone).split(/\s+/);
      return fromPeriod === toPeriod ? `${from} to ${to} ${toPeriod}` : `${from} ${fromPeriod} to ${to} ${toPeriod}`;
    }
    case 'line':
      return time.allDay || time.continues ? '' : formatClock(start, timezone).replace(':00', '');
    case 'sheet': {
      const date = (ms: number) => dateWords.day(ms, timezone);
      const sameDay = (a: number, b: number) => householdTime(a, timezone).date === householdTime(b, timezone).date;
      if (time.allDay) {
        const lastDay = Math.max(start, end - 1);
        return sameDay(start, lastDay) ? `${date(start)}, all day` : `${date(start)} to ${date(lastDay)}, all day`;
      }
      if (!sameDay(start, end)) return `${date(start)}, ${formatClock(start, timezone)} to ${date(end)}, ${formatClock(end, timezone)}`;
      if (end === start) return `${date(start)}, ${formatClock(start, timezone)}`;
      const clock = time.clocksRepeat ? clockWithZone : formatClock;
      return `${date(start)}, ${clock(start, timezone)} to ${clock(end, timezone)}`;
    }
  }
}

// ---- Dates --------------------------------------------------------------------------------

// "no events", "1 event", "3 events".
export function eventCount(count: number): string {
  return count === 0 ? 'no events' : count === 1 ? '1 event' : `${count} events`;
}

// A calendar date ('YYYY-MM-DD') in words. Calendar dates carry no zone, so they are formatted in UTC.
function calendarDate(date: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options }).format(new Date(`${date}T00:00:00Z`));
}

export const dateWords = {
  // "Thu, Oct 1": the date as the details sheet and the header show it, at the instant `ms` in the Household Timezone.
  day: (ms: number, timezone: string): string => new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(ms)),
  // "Oct 1, 2026": a date that may be a year or more ago, as "Since" says it in Settings.
  dayWithYear: (ms: number, timezone: string): string => new Intl.DateTimeFormat('en-US', { timeZone: timezone, month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(ms)),
  // What a screen reader hears of a month cell: "Thursday, October 1, 3 events". Until its day has been read there is no
  // count to give, and "no events" would call a day free that may not be.
  cell: (date: string, count: number | null): string => {
    const day = calendarDate(date, { weekday: 'long', month: 'long', day: 'numeric' });
    return count === null ? day : `${day}, ${eventCount(count)}`;
  },
  // A calendar date with the given parts, for a page's title (describePage, describeMonth).
  calendar: calendarDate,
};
