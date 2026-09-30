// Household Timezone arithmetic shared by the sync Edge Function (which converts all-day
// events on ingest) and the wall (which lays days out). Plain Intl, no Deno globals, so the
// same code runs under Node, the browser and Deno, and cannot drift between them.

// The zone's offset from UTC at `timestamp`, in milliseconds (Chicago in summer: -5 h).
export function offsetMs(timestamp: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(timestamp));
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
  return asUtc - Math.floor(timestamp / 1000) * 1000;
}

// The instant a Household day begins: local midnight of `date` ('YYYY-MM-DD') in `timezone`,
// correct across daylight saving changes.
export function dayStartMs(date: string, timezone: string): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const wall = Date.UTC(year, month - 1, day);
  const first = wall - offsetMs(wall, timezone);
  return wall - offsetMs(first, timezone);
}
