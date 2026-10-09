// The Household clock: every question about the Household Date (CONTEXT.md) and the time of day
// on it, for the Wall, the phone and every Edge Function. Nothing else computes a Household Date,
// a day's start or the instant of a time of day. Plain Intl, no Deno globals, so the same code
// runs under Node, the browser and Deno, and cannot drift between them.

// Building an Intl.DateTimeFormat is the slow part of every conversion; one per zone is enough.
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(timezone: string): Intl.DateTimeFormat {
  let format = formatters.get(timezone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timezone, format);
  }
  return format;
}

// The zone's offset from UTC at `timestamp`, in milliseconds (Chicago in summer: -5 h).
export function offsetMs(timestamp: number, timezone: string): number {
  const parts = formatterFor(timezone).formatToParts(new Date(timestamp));
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
  return asUtc - Math.floor(timestamp / 1000) * 1000;
}

// The instant the wall clock in `timezone` reads `wall` (the clock's fields taken as a UTC
// timestamp, e.g. Date.UTC(2026, 2, 8, 9, 0)), by RFC 5545 3.3.5. The offsets a day either side
// give the two candidates: a time that happens twice (clocks going back) is the earlier, and a
// time that never happens (clocks going forward) takes the offset from before the gap, so it moves
// on by the skipped time, never back.
export function wallClockMs(wall: number, timezone: string): number {
  const before = wall - offsetMs(wall - 86_400_000, timezone);
  const after = wall - offsetMs(wall + 86_400_000, timezone);
  const real = [before, after].filter((candidate) => candidate + offsetMs(candidate, timezone) === wall);
  return real.length > 0 ? Math.min(...real) : before;
}

// The instant a Household day begins: local midnight of `date` ('YYYY-MM-DD') in `timezone`,
// correct across daylight saving changes.
export function dayStartMs(date: string, timezone: string): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const wall = Date.UTC(year, month - 1, day);
  const first = wall - offsetMs(wall, timezone);
  const start = wall - offsetMs(first, timezone);
  if (householdTime(start, timezone).date === date) return start;
  // Midnight does not exist that day (a few zones, such as Santiago, change their clocks at
  // midnight): the day begins at the first instant whose local date is `date`.
  let low = wall - 15 * 3_600_000;
  let high = wall + 15 * 3_600_000;
  while (high - low > 1000) {
    const middle = Math.floor((low + high) / 2000) * 1000;
    if (householdTime(middle, timezone).date < date) low = middle;
    else high = middle;
  }
  return high;
}

// The instant `time` ('HH:MM') on `date` is on the wall clock of `timezone`, by wallClockMs's rule.
export function instantAt(date: string, time: string, timezone: string): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  return wallClockMs(Date.UTC(year, month - 1, day, hour, minute), timezone);
}

// `date` ('YYYY-MM-DD') moved by whole days. A calendar date does not depend on any zone.
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export type HouseholdTime = { date: string; weekday: number; minutes: number };

// The Household Date ('YYYY-MM-DD'), its weekday (Sunday 0) and the minutes since its midnight on
// the wall clock, at the instant `ms`.
export function householdTime(ms: number, timezone: string): HouseholdTime {
  const local = new Date(ms + offsetMs(ms, timezone));
  return { date: local.toISOString().slice(0, 10), weekday: local.getUTCDay(), minutes: local.getUTCHours() * 60 + local.getUTCMinutes() };
}

export type HouseholdDay = { date: string; weekday: number };

// The Household Date and its weekday at `now`. Never the machine's zone.
export function householdDay(timezone: string, now: Date = new Date()): HouseholdDay {
  const { date, weekday } = householdTime(now.getTime(), timezone);
  return { date, weekday };
}

// Whether the span from `start` to `end` is on the day from `day.startMs` to `day.endMs` (the next
// day's start): it starts before the day ends and ends after the day starts, so one ending exactly
// at midnight is not on the next day. A span of no length overlaps nothing, so it is on the day its
// instant falls in.
export function spanIsOn(start: number, end: number, day: { startMs: number; endMs: number }): boolean {
  if (end <= start) return start >= day.startMs && start < day.endMs;
  return start < day.endMs && end > day.startMs;
}
