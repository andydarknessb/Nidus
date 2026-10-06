// Household Timezone arithmetic shared by the sync Edge Function (which converts all-day
// events on ingest) and the wall (which lays days out). Plain Intl, no Deno globals, so the
// same code runs under Node, the browser and Deno, and cannot drift between them.

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
// timestamp, e.g. Date.UTC(2026, 2, 8, 9, 0)), correct across daylight saving changes. A time
// that never happens (the hour skipped in spring) reads as the instant an hour later.
export function wallClockMs(wall: number, timezone: string): number {
  const first = wall - offsetMs(wall, timezone);
  return wall - offsetMs(first, timezone);
}

// The instant a Household day begins: local midnight of `date` ('YYYY-MM-DD') in `timezone`,
// correct across daylight saving changes.
export function dayStartMs(date: string, timezone: string): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const wall = Date.UTC(year, month - 1, day);
  const first = wall - offsetMs(wall, timezone);
  const start = wall - offsetMs(first, timezone);
  if (localDate(start, timezone) === date) return start;
  // Midnight does not exist that day (a few zones, such as Santiago, change their clocks at
  // midnight): the day begins at the first instant whose local date is `date`.
  let low = wall - 15 * 3_600_000;
  let high = wall + 15 * 3_600_000;
  while (high - low > 1000) {
    const middle = Math.floor((low + high) / 2000) * 1000;
    if (localDate(middle, timezone) < date) low = middle;
    else high = middle;
  }
  return high;
}

function localDate(timestamp: number, timezone: string): string {
  return new Date(timestamp + offsetMs(timestamp, timezone)).toISOString().slice(0, 10);
}
