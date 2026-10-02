import { dayOccurrences, formatClock, nowHour, wallHour, type Occurrence, type WallDay } from './calendar-occurrences';
import { listNames, pillTime, saysAllDay, scheduleColumns, type Pill, type PillPeople } from './schedule';

// The Day view (docs/look.md; spec 0003, Day view): the one view that keeps the hour grid. An hour is 3 rem, 48 px at the
// default text size and the smallest thing a finger can hit, so an hour-long event is exactly that tall and no block is ever
// under an hour. The grid shows the whole hours that fit; the row above it holds the day's all-day events and then the timed
// ones that ended before its first hour, the row below it the ones that start after its last, and both rows always keep
// their place, so what they hold never decides how many hours fit. Everything the view decides is here and pure, so it is
// tested without a screen (tests/day-view.test.ts). Every date is read in the Household Timezone, which a WallDay carries:
// nothing reads the machine's.
//
// The grid is the wall clock, as the rest of the calendar's placement has always been (wallHour): its hours run 0 to 24 on the
// clock whatever the day's real length. On a 23 hour day the skipped hour is an empty row; on a 25 hour day the repeated hour
// is one row that its two hours share, and events that land on the same spot there are given lanes like any that overlap.

const HOUR_MS = 3_600_000;

// An hour of the grid, in rem: 3 rem is 48 px at the default size, and grows with the text.
export const HOUR_REM = 3;

// A block is never under 48 px, which is one hour of the grid.
const MIN_BLOCK_HOURS = 1;

// Another day with no timed event starts at 8 AM.
const DEFAULT_START_HOUR = 8;

// Two events may sit side by side: a cluster that needs more lanes folds the rest into one "+N".
const MAX_LANES = 2;

// Two hours of the grid that differ by less than this are the same hour: an end and a start that are one instant, or an hour
// added to a start, may differ by the last bit of a float.
const EPS = 1e-6;

// ---- The window ------------------------------------------------------------------------------------

// How many whole hours of `hourPx` fit in `spacePx`: at least one, and at most a day.
export function hoursThatFit(spacePx: number, hourPx: number): number {
  return Math.min(24, Math.max(1, Math.floor(spacePx / hourPx) || 1));
}

// The hours the grid shows, as wall clock hours: `startHour` to `endHour`, both whole, 0 to 24.
export type HourWindow = { startHour: number; endHour: number };

// The wall clock hour of the first timed event that starts on `day`, or null with none. An event that began on an earlier day
// does not count, and neither does one that covers the whole day, which says "All day".
function firstStartHour(occurrences: Occurrence[], day: WallDay): number | null {
  let first: number | null = null;
  for (const occurrence of dayOccurrences(occurrences, day)) {
    const start = Date.parse(occurrence.starts_at);
    if (saysAllDay(occurrence, day) || start < day.startMs) continue;
    const hour = wallHour(start, day);
    if (first === null || hour < first) first = hour;
  }
  return first;
}

// The hour the grid starts from on today: one hour before now, which is an hour that really passed: on a day the clocks jumped
// it is not the wall clock's hour less one (at 3:30 AM on the day they went forward, the hour before is 1:30 AM, not 2:30, which
// the day does not have). When only one hour fits, now's own hour, so now is always inside. Null when `now` is not in `day`.
function hourOnToday(day: WallDay, now: Date, hours: number): number | null {
  const at = nowHour(day, now);
  if (at === null) return null;
  return hours > 1 ? wallHour(now.getTime() - HOUR_MS, day) : at;
}

// The whole hours the grid shows, from the hours that fit: on today from one hour before now; on another day from the first
// timed event that starts on it (8 AM with none); never from before midnight, and slid back so it ends by midnight.
// `occurrences` are the Household's for the day, after the Profile filter.
export function hourWindow({ occurrences, day, now, fit }: { occurrences: Occurrence[]; day: WallDay; now: Date; fit: number }): HourWindow {
  const hours = Math.min(24, Math.max(1, Math.floor(fit) || 1));
  const wanted = (day.isToday ? hourOnToday(day, now, hours) : null) ?? firstStartHour(occurrences, day) ?? DEFAULT_START_HOUR;
  const startHour = Math.max(0, Math.min(Math.floor(wanted), 24 - hours));
  return { startHour, endHour: startHour + hours };
}

// ---- The day ---------------------------------------------------------------------------------------

// One event in the grid. `pill` is the event as the schedule's pill has it (its colours, discs and name come from the pill's
// rules), with `time` as the block says it: "4:00 to 4:45 PM". `topHour` and `bottomHour` are where it is drawn, in wall clock
// hours inside the window and at least an hour apart, so a quarter hour is drawn an hour tall and one that would run past the
// end of the grid is drawn up from it. `lane` and `lanes` put the events that overlap side by side (never more than two);
// `narrow` leaves the right of the second lane to the "+N" that stands for the rest.
export type DayBlock = { pill: Pill; topHour: number; bottomHour: number; lane: 0 | 1; lanes: 1 | 2; narrow: boolean };

// The "+N" of a cluster that needs more than two lanes: `folded` events are not drawn (the short ones, when the longest keep the two
// lanes), it spans what they take, and `pills` are every event of the cluster, in time order, for the list it opens.
export type FoldTile = { pills: Pill[]; folded: number; topHour: number; bottomHour: number };

export type DayPlan = {
  window: HourWindow;
  // The row above the grid: the day's all-day events (a timed event that covers the whole day too), then the timed events that
  // ended before the window.
  above: Pill[];
  // The row below it: the timed events that start after the window.
  below: Pill[];
  blocks: DayBlock[];
  folds: FoldTile[];
  // Where the now line is, in wall clock hours, on today when now is inside the window.
  nowHour: number | null;
};

// Where an occurrence is on `day` in wall clock hours (0 to 24), by what it really lasts: from the day's first instant if it
// began earlier, to its last if it goes on. Never ends above where it starts, which the repeated hour of a 25 hour day can
// make the wall clock do.
function spanOn(occurrence: Occurrence, day: WallDay): { top: number; bottom: number } {
  const top = wallHour(Math.max(Date.parse(occurrence.starts_at), day.startMs), day);
  return { top, bottom: Math.max(wallHour(Math.min(Date.parse(occurrence.ends_at), day.endMs), day), top) };
}

// The room a block takes on the grid: its span kept to the window, at least an hour, and drawn up from the window's end
// when an hour from its start would run past it.
function slotOf(top: number, bottom: number, window: HourWindow): [number, number] {
  const from = Math.max(top, window.startHour);
  const length = Math.max(Math.min(bottom, window.endHour) - from, MIN_BLOCK_HOURS);
  const slotTop = Math.max(Math.min(from, window.endHour - length), window.startHour);
  return [slotTop, slotTop + length];
}

type Slot = { top: number; bottom: number };

// What the lanes are decided from, for each event in the grid: the room it takes (its slot) and what it really is (how long it
// lasts, when it starts and its title), which decides what a crowded cluster keeps.
type Entry = Slot & { length: number; start: number; title: string };

// The events by where their slots start, the longer slot first.
const byStart = (entries: readonly Entry[]) => (a: number, b: number) => entries[a]!.top - entries[b]!.top || entries[b]!.bottom - entries[a]!.bottom || a - b;

// The lane each of `members` takes, each in the first lane that is free when it starts, and how many lanes that makes.
function packLanes(entries: readonly Entry[], members: readonly number[]): { lane: Map<number, number>; count: number } {
  const lane = new Map<number, number>();
  const ends: number[] = [];
  for (const index of [...members].sort(byStart(entries))) {
    const { top, bottom } = entries[index]!;
    let at = ends.findIndex((end) => end <= top + EPS);
    if (at < 0) at = ends.length;
    ends[at] = bottom;
    lane.set(index, at);
  }
  return { lane, count: ends.length };
}

// The events of a cluster that are kept when two lanes are all there is. A short event is drawn an hour tall, so a quarter hour can
// take a whole lane from one that really lasts the hour: the events are taken in order of how long each really lasts, the longest
// first (the earlier start first among equals, then the title), and each is kept if it fits two lanes with those kept before it.
function keepForLanes(entries: readonly Entry[], members: readonly number[]): number[] {
  const kept: number[] = [];
  const longest = [...members].sort(
    (a, b) => entries[b]!.length - entries[a]!.length || entries[a]!.start - entries[b]!.start || entries[a]!.title.localeCompare(entries[b]!.title) || a - b,
  );
  for (const index of longest) if (packLanes(entries, [...kept, index]).count <= MAX_LANES) kept.push(index);
  return kept;
}

// A lane for each event, and how many lanes its cluster uses. A cluster is a run of slots that overlap one another one after the
// next; slots that only touch are not a cluster. A cluster that fits two lanes shares the width equally, each event in the first
// lane that is free when it starts. One that does not draws the events keepForLanes keeps, in two lanes; the lane of the rest is
// null, and they fold into the cluster's "+N".
function assignLanes(entries: Entry[]): { lane: number | null; lanes: number; cluster: number }[] {
  const placed = entries.map(() => ({ lane: 0 as number | null, lanes: 1, cluster: 0 }));
  const clusters: number[][] = [];
  let clusterEnd = -Infinity;
  for (const index of entries.map((_, each) => each).sort(byStart(entries))) {
    if (entries[index]!.top >= clusterEnd - EPS) {
      clusters.push([]);
      clusterEnd = -Infinity;
    }
    clusters[clusters.length - 1]!.push(index);
    clusterEnd = Math.max(clusterEnd, entries[index]!.bottom);
  }
  clusters.forEach((members, cluster) => {
    const all = packLanes(entries, members);
    const fits = all.count <= MAX_LANES;
    const { lane } = fits ? all : packLanes(entries, keepForLanes(entries, members));
    for (const index of members) placed[index] = { lane: lane.get(index) ?? null, lanes: fits ? all.count : MAX_LANES, cluster };
  });
  return placed;
}

// The Day view of `day`: the window for the `fit` hours that fit, the rows above and below it, the blocks in it and the "+N" of
// a cluster that is too crowded. `occurrences` are the Household's for the day, after the Profile filter, and `now` is the
// clock, so the event that is on now is known.
export function planDay({ occurrences, day, now, fit }: { occurrences: Occurrence[]; day: WallDay; now: Date; fit: number }): DayPlan {
  const window = hourWindow({ occurrences, day, now, fit });
  const { pills } = scheduleColumns(occurrences, [day], now)[0]!;
  const allDay: Pill[] = [];
  const earlier: Pill[] = [];
  const below: Pill[] = [];
  const drawn: { pill: Pill; slot: Slot }[] = [];
  for (const pill of pills) {
    if (saysAllDay(pill.occurrence, day)) {
      allDay.push(pill);
      continue;
    }
    const { top, bottom } = spanOn(pill.occurrence, day);
    // In the window when it overlaps it; an event of no length when it is inside. Otherwise it is before the window, or after it.
    const inside = bottom === top ? top >= window.startHour && top < window.endHour : top < window.endHour && bottom > window.startHour;
    if (inside) {
      const [slotTop, slotBottom] = slotOf(top, bottom, window);
      drawn.push({ pill: { ...pill, time: blockTime(pill.occurrence, day) }, slot: { top: slotTop, bottom: slotBottom } });
    } else if (top < window.startHour) {
      earlier.push(pill);
    } else {
      below.push(pill);
    }
  }

  const placed = assignLanes(
    drawn.map(({ pill, slot }) => ({
      ...slot,
      length: Math.max(0, Date.parse(pill.occurrence.ends_at) - Date.parse(pill.occurrence.starts_at)),
      start: Date.parse(pill.occurrence.starts_at),
      title: pill.occurrence.title,
    })),
  );
  const clusters = new Map<number, number[]>();
  drawn.forEach((_, index) => clusters.set(placed[index]!.cluster, [...(clusters.get(placed[index]!.cluster) ?? []), index]));
  const blocks: DayBlock[] = [];
  const folds: FoldTile[] = [];
  for (const members of clusters.values()) {
    // Time order, the longer first, which is the order the lanes were given in.
    const ordered = [...members].sort((a, b) => drawn[a]!.slot.top - drawn[b]!.slot.top || drawn[b]!.slot.bottom - drawn[a]!.slot.bottom || a - b);
    const folded = ordered.filter((index) => placed[index]!.lane === null);
    const tile =
      folded.length === 0
        ? null
        : {
            pills: ordered.map((index) => drawn[index]!.pill),
            folded: folded.length,
            topHour: Math.min(...folded.map((index) => drawn[index]!.slot.top)),
            bottomHour: Math.max(...folded.map((index) => drawn[index]!.slot.bottom)),
          };
    if (tile) folds.push(tile);
    for (const index of ordered.filter((each) => !folded.includes(each))) {
      const { pill, slot } = drawn[index]!;
      blocks.push({
        pill,
        topHour: slot.top,
        bottomHour: slot.bottom,
        lane: placed[index]!.lane === 0 ? 0 : 1,
        lanes: placed[index]!.lanes === 1 ? 1 : 2,
        narrow: tile !== null && placed[index]!.lane === 1 && slot.top < tile.bottomHour - EPS && slot.bottom > tile.topHour + EPS,
      });
    }
  }
  blocks.sort((a, b) => a.topHour - b.topHour || a.lane - b.lane);
  folds.sort((a, b) => a.topHour - b.topHour);

  const at = day.isToday ? nowHour(day, now) : null;
  return {
    window,
    above: [...allDay, ...earlier],
    below,
    blocks,
    folds,
    nowHour: at !== null && at >= window.startHour && at <= window.endHour ? at : null,
  };
}

// ---- Words -----------------------------------------------------------------------------------------

// What a block says of its time: "4:00 to 4:45 PM", with one AM or PM when both ends share it, and "11:30 AM to 12:30 PM"
// when they do not. An event of no length, or one that began on an earlier day or goes on to a later one, says what the
// schedule's pill says ("4:00 PM", "Until 2:00 AM", "10:00 PM"): the range is for an event that lies within the day.
export function blockTime(occurrence: Occurrence, day: WallDay): string {
  const start = Date.parse(occurrence.starts_at);
  const end = Date.parse(occurrence.ends_at);
  if (start < day.startMs || end > day.endMs || end <= start) return pillTime(occurrence, day);
  const [from = '', fromPeriod = ''] = formatClock(start, day.timezone).split(/\s+/);
  const [to = '', toPeriod = ''] = formatClock(end, day.timezone).split(/\s+/);
  return fromPeriod === toPeriod ? `${from} to ${to} ${toPeriod}` : `${from} ${fromPeriod} to ${to} ${toPeriod}`;
}

// An hour on the gutter: "12 AM", "4 PM".
export function hourWords(hour: number): string {
  return `${hour % 12 || 12} ${hour % 24 < 12 ? 'AM' : 'PM'}`;
}

// What an empty row says: "Nothing later today" (just "Nothing later" on another day).
export function emptyRowWords(row: 'earlier' | 'later', isToday: boolean): string {
  return `Nothing ${row}${isToday ? ' today' : ''}`;
}

// Who an event is for, in the words of its details: "Everyone" for the whole Household, else every name ("Ava and Ben",
// "Cory, Sam and Ava"), however many there are: a pill has room for two discs, the details have room for all the names.
export function whoWords(people: PillPeople): string {
  return people.kind === 'everyone' ? 'Everyone' : listNames(people.names);
}
