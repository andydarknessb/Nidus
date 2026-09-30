import type { SupabaseClient } from '@supabase/supabase-js';
import { dayStartMs } from '../../supabase/functions/_shared/zoned-time.ts';
import { householdDay } from './routines';

export { dayStartMs };

// Occurrences on the wall (CONTEXT.md: Synced Event, Native Event). The `calendar_occurrences`
// view unions every source with the Profile and colour it inherits; everything below is what
// the five-day home screen does with them. All date logic uses the Household Timezone, never
// the machine's zone, and is pure so it is tested without a screen.

export type Occurrence = {
  source: 'synced' | 'native';
  id: string;
  calendar_id: string;
  calendar_name: string;
  title: string;
  description: string | null;
  location: string | null;
  // ISO instants. For an all-day event, Household-Timezone midnights, the end being the
  // midnight after its last day.
  starts_at: string;
  ends_at: string;
  is_all_day: boolean;
  profile_id: string | null;
  // The calendar's colour, else its Profile's; null for a whole-Household calendar with neither.
  color: string | null;
};

const columns = 'source, id, calendar_id, calendar_name, title, description, location, starts_at, ends_at, is_all_day, profile_id, color';

// Household Account or Device. Everything that overlaps [from, to), in start order.
export async function loadOccurrences(client: SupabaseClient, from: Date, to: Date): Promise<Occurrence[]> {
  const { data, error } = await client
    .from('calendar_occurrences')
    .select(columns)
    .lt('starts_at', to.toISOString())
    // Inclusive so an event of no length at `from` is kept; placement is the exact overlap test.
    .gte('ends_at', from.toISOString())
    .order('starts_at')
    .order('id');
  if (error) throw error;
  return data as Occurrence[];
}

// ---- Household Timezone arithmetic ------------------------------------------------

const MINUTE_MS = 60 * 1000;
// An event of no length still needs something to tap.
export const MIN_EVENT_MINUTES = 15;

// `date` ('YYYY-MM-DD') moved by whole days. A calendar date does not depend on any zone.
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export type WallDay = {
  date: string;
  weekday: number;
  startMs: number;
  // The start of the next day, so the day's length is right on a DST change.
  endMs: number;
  isToday: boolean;
};

// Today and the next four days in the Household Timezone.
export function fiveDays(timezone: string, now: Date = new Date()): WallDay[] {
  const today = householdDay(timezone, now).date;
  return Array.from({ length: 5 }, (_, index) => {
    const date = addDays(today, index);
    return {
      date,
      weekday: householdDay(timezone, new Date(dayStartMs(date, timezone))).weekday,
      startMs: dayStartMs(date, timezone),
      endMs: dayStartMs(addDays(date, 1), timezone),
      isToday: index === 0,
    };
  });
}

// ---- Placement ----------------------------------------------------------------------

// An all-day event across the band: which columns it covers and which row it sits in.
export type AllDayBar = {
  occurrence: Occurrence;
  startColumn: number;
  span: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
  row: number;
};

// A timed event in one day's column. top and bottom are fractions of that day (0 to 1);
// lane and lanes place events that overlap side by side.
export type TimedBlock = {
  occurrence: Occurrence;
  top: number;
  bottom: number;
  lane: number;
  lanes: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
};

export type Placement = { allDay: AllDayBar[]; columns: TimedBlock[][] };

function startOf(occurrence: Occurrence): number {
  return Date.parse(occurrence.starts_at);
}

function endOf(occurrence: Occurrence): number {
  const end = Date.parse(occurrence.ends_at);
  return occurrence.is_all_day ? end : Math.max(end, startOf(occurrence) + MIN_EVENT_MINUTES * MINUTE_MS);
}

function placeAllDay(occurrences: Occurrence[], days: WallDay[]): AllDayBar[] {
  const bars: AllDayBar[] = [];
  for (const occurrence of occurrences) {
    const covered = days.flatMap((day, index) => (startOf(occurrence) < day.endMs && endOf(occurrence) > day.startMs ? [index] : []));
    if (covered.length === 0) continue;
    const first = covered[0]!;
    const last = covered[covered.length - 1]!;
    bars.push({
      occurrence,
      startColumn: first,
      span: last - first + 1,
      continuesBefore: startOf(occurrence) < days[first]!.startMs,
      continuesAfter: endOf(occurrence) > days[last]!.endMs,
      row: 0,
    });
  }
  bars.sort((a, b) => a.startColumn - b.startColumn || b.span - a.span || a.occurrence.title.localeCompare(b.occurrence.title));
  const rows: AllDayBar[][] = [];
  for (const bar of bars) {
    let row = rows.findIndex((taken) => taken.every((other) => other.startColumn + other.span <= bar.startColumn || bar.startColumn + bar.span <= other.startColumn));
    if (row < 0) row = rows.length;
    (rows[row] ??= []).push(bar);
    bar.row = row;
  }
  return bars;
}

// Side-by-side lanes for the overlapping events of one day: a run of events that touch
// shares the day's width equally.
function assignLanes(blocks: TimedBlock[], startsMs: Map<TimedBlock, [number, number]>): void {
  const ordered = [...blocks].sort((a, b) => {
    const [aStart, aEnd] = startsMs.get(a)!;
    const [bStart, bEnd] = startsMs.get(b)!;
    return aStart - bStart || bEnd - aEnd;
  });
  let cluster: TimedBlock[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -Infinity;
  const close = () => {
    for (const block of cluster) block.lanes = laneEnds.length;
    cluster = [];
    laneEnds = [];
  };
  for (const block of ordered) {
    const [start, end] = startsMs.get(block)!;
    if (start >= clusterEnd) {
      close();
      clusterEnd = -Infinity;
    }
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = end;
    block.lane = lane;
    cluster.push(block);
    clusterEnd = Math.max(clusterEnd, end);
  }
  close();
}

function placeTimed(occurrences: Occurrence[], day: WallDay): TimedBlock[] {
  const length = day.endMs - day.startMs;
  const blocks: TimedBlock[] = [];
  const spans = new Map<TimedBlock, [number, number]>();
  for (const occurrence of occurrences) {
    const start = startOf(occurrence);
    const end = endOf(occurrence);
    if (!(start < day.endMs && end > day.startMs)) continue;
    const shownStart = Math.max(start, day.startMs);
    const shownEnd = Math.min(end, day.endMs);
    const block: TimedBlock = {
      occurrence,
      top: (shownStart - day.startMs) / length,
      bottom: (shownEnd - day.startMs) / length,
      lane: 0,
      lanes: 1,
      continuesBefore: start < day.startMs,
      continuesAfter: end > day.endMs,
    };
    blocks.push(block);
    spans.set(block, [shownStart, shownEnd]);
  }
  assignLanes(blocks, spans);
  return blocks;
}

// Puts every occurrence where it belongs on the five columns: all-day events in the band
// (a multi-day one spanning its columns), timed events in each day they touch.
export function place(occurrences: Occurrence[], days: WallDay[]): Placement {
  const allDay = occurrences.filter((occurrence) => occurrence.is_all_day);
  const timed = occurrences.filter((occurrence) => !occurrence.is_all_day);
  return { allDay: placeAllDay(allDay, days), columns: days.map((day) => placeTimed(timed, day)) };
}

export type HourRange = { startHour: number; endHour: number };

// The hours the grid shows: 6 am to 10 pm, widened only when an event (or the current
// time) falls outside, so nothing the wall should show is ever off the grid.
export function visibleHours(columnBlocks: TimedBlock[][], nowFraction: number | null): HourRange {
  let startHour = 6;
  let endHour = 22;
  const consider = (top: number, bottom: number) => {
    startHour = Math.min(startHour, Math.floor(top * 24));
    endHour = Math.max(endHour, Math.ceil(bottom * 24));
  };
  for (const column of columnBlocks) for (const block of column) consider(block.top, block.bottom);
  if (nowFraction !== null) consider(nowFraction, nowFraction);
  return { startHour: Math.max(0, startHour), endHour: Math.min(24, endHour) };
}

// Where the current time falls in today's column, as a fraction of the day; null if `now`
// is not within the day.
export function nowFraction(day: WallDay, now: Date): number | null {
  const at = now.getTime();
  return at >= day.startMs && at < day.endMs ? (at - day.startMs) / (day.endMs - day.startMs) : null;
}

// ---- Words --------------------------------------------------------------------------

export function formatClock(ms: number, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' }).format(new Date(ms));
}

function formatDate(ms: number, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(ms));
}

// "Tue, Sep 30, 9:00 AM to 10:00 AM", or "Tue, Sep 30, all day": the time as the details sheet shows it.
export function describeWhen(occurrence: Occurrence, timezone: string): string {
  const start = startOf(occurrence);
  const end = Date.parse(occurrence.ends_at);
  if (occurrence.is_all_day) {
    const lastDay = Math.max(start, end - 1);
    const sameDay = householdDay(timezone, new Date(start)).date === householdDay(timezone, new Date(lastDay)).date;
    return sameDay ? `${formatDate(start, timezone)}, all day` : `${formatDate(start, timezone)} to ${formatDate(lastDay, timezone)}, all day`;
  }
  const sameDay = householdDay(timezone, new Date(start)).date === householdDay(timezone, new Date(end)).date;
  if (sameDay) {
    return end === start
      ? `${formatDate(start, timezone)}, ${formatClock(start, timezone)}`
      : `${formatDate(start, timezone)}, ${formatClock(start, timezone)} to ${formatClock(end, timezone)}`;
  }
  return `${formatDate(start, timezone)}, ${formatClock(start, timezone)} to ${formatDate(end, timezone)}, ${formatClock(end, timezone)}`;
}
