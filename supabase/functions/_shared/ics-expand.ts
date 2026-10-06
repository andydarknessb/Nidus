// An iPhone (iCloud) calendar's feed as Synced Event rows (issue #117, spec 0005). Unlike
// Google, a feed carries its repeats as rules, so this expands them with ical.js: RRULE, RDATE,
// EXDATE, overrides by RECURRENCE-ID, VTIMEZONE and TZID. Pure: text, the Household Timezone and
// a window in, rows out, no network, no clock, no Deno globals, so the same code runs under
// Vitest (Node) and the Edge Function (Deno). The machine's own zone is never consulted: every
// wall-clock time is turned into an instant by the feed's zone or the Household Timezone.
import ICAL from 'ical.js';
import { type EventRow, MAX_DESCRIPTION, MAX_LOCATION, MAX_TITLE } from './event-row.ts';
import { dayStartMs, wallClockMs } from './zoned-time.ts';

export const MAX_PER_EVENT = 1000;
export const MAX_PER_FEED = 20000;
// How far one repeating series is walked looking for the window, how many steps one feed may take,
// how many all the feeds of one run may take between them, and how much time the run's expansion
// may take in all: a rule that started long ago and fires every few seconds would otherwise take
// forever, and the hosted function has a 2 s CPU limit for the run (the run's caps leave a margin
// under it). The caps only ever limit repeating series: a single event, an RDATE or a moved
// occurrence is always read, costs no steps, and is kept whatever any budget says.
// ponytail: no fast-forward in ical.js's iterator; series are walked newest start first, so the
// ancient expensive rules are the ones a cap cuts. A series cut by the event's or feed's cap keeps
// what it reached and the feed says so (`truncated`). Past the run's cap or time, the feed is not
// read at all this run (FeedTooLargeError): storing it would delete the rows it did not reach.
// ical.js can spend unbounded time inside one step of a rule that rarely or never matches, which
// no step count sees, so a rule the iPhone cannot make is not walked at all (see `walkable`).
const MAX_STEPS_PER_EVENT = 30_000;
const MAX_STEPS_PER_FEED = 60_000;
export const MAX_STEPS_PER_RUN = 80_000;
export const MAX_EXPANSION_MS = 800;

// What is left of a run's work, shared by every feed the run expands: steps, and the milliseconds
// of expansion (parsing included) already spent. `now` is the clock (performance.now by default),
// injectable so the time limit is testable.
export type StepBudget = { remaining: number; spentMs?: number; now?: () => number };

// No zone is more than 14 hours from UTC, so a wall-clock time this far before the window start
// is before it in every zone and needs no zone arithmetic.
const MAX_ZONE_OFFSET_MS = 14 * 3_600_000;
const DAY_MS = 86_400_000;
// Between the UID and the occurrence's original start in a row's key.
const KEY_SEPARATOR = '|';

export class FeedParseError extends Error {}
// The run's step budget ran out while this feed still had repeating events to walk.
export class FeedTooLargeError extends Error {}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');
const dateOf = (t: ICAL.Time) => `${pad(t.year, 4)}-${pad(t.month)}-${pad(t.day)}`;

// An instant for one of the feed's times. A time with a zone the feed defines (or UTC) is exact;
// anything else (floating, or a TZID the feed never defines) is wall-clock in the Household.
function instantMs(t: ICAL.Time, timezone: string): number {
  if (t.isDate) return dayStartMs(dateOf(t), timezone);
  if (t.zone === ICAL.Timezone.localTimezone) return wallClockMs(Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second), timezone);
  return t.toUnixTime() * 1000;
}

function whole(days: number): number {
  return Math.max(1, Math.round(days));
}

// Days from one date to another, for an all-day event's length.
function daysBetween(from: ICAL.Time, to: ICAL.Time): number {
  return whole((Date.UTC(to.year, to.month - 1, to.day) - Date.UTC(from.year, from.month - 1, from.day)) / 86_400_000);
}

// The event's end, ical.js's `endDate` (DTEND, else start plus DURATION, else a day for a date and
// nothing for a time), except that a DTEND before DTSTART is as good as none.
function endTime(ev: ICAL.Event): ICAL.Time {
  const start = ev.startDate;
  const end = ev.endDate;
  if (!ev.component.hasProperty('dtend') || end.compare(start) >= 0) return end;
  const fallback = start.clone();
  const duration = ev.component.getFirstPropertyValue('duration');
  if (duration instanceof ICAL.Duration) fallback.addDuration(duration);
  else if (start.isDate) fallback.day += 1;
  return fallback;
}

type Layout = { start: ICAL.Time; isAllDay: boolean; lengthDays: number; lengthMs: number };

// An event's length, taken once.
function layout(ev: ICAL.Event, timezone: string): Layout | null {
  const start = ev.startDate;
  if (!start) return null;
  const end = endTime(ev);
  return {
    start,
    isAllDay: start.isDate,
    lengthDays: start.isDate ? daysBetween(start, end) : 0,
    lengthMs: start.isDate ? 0 : instantMs(end, timezone) - instantMs(start, timezone),
  };
}

function build(ev: ICAL.Event, uid: string, originalMs: number, startMs: number, endMs: number, isAllDay: boolean): EventRow | null {
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) return null;
  return {
    google_event_id: `${uid}${KEY_SEPARATOR}${new Date(originalMs).toISOString()}`,
    title: (ev.summary?.trim() || '(No title)').slice(0, MAX_TITLE),
    description: ev.description ? ev.description.slice(0, MAX_DESCRIPTION) : null,
    location: ev.location ? ev.location.slice(0, MAX_LOCATION) : null,
    starts_at: new Date(startMs).toISOString(),
    ends_at: new Date(endMs).toISOString(),
    is_all_day: isAllDay,
  };
}

const cancelled = (ev: ICAL.Event) => ev.component.getFirstPropertyValue('status')?.toString().toUpperCase() === 'CANCELLED';

// The instants an event's EXDATEs name, in every form (a zone, UTC, floating, a date). The
// iterator already leaves them out, but DTSTART is emitted by hand and must be checked too.
function excludedStarts(ev: ICAL.Event, timezone: string): Set<number> {
  const out = new Set<number>();
  for (const property of ev.component.getAllProperties('exdate')) {
    for (const value of property.getValues()) out.add(instantMs(value as ICAL.Time, timezone));
  }
  return out;
}

const DAILY_WEEKLY_WITHOUT = ['BYMONTH', 'BYMONTHDAY', 'BYYEARDAY', 'BYWEEKNO', 'BYSETPOS', 'BYHOUR', 'BYMINUTE', 'BYSECOND'];
const MONTHLY_YEARLY_WITHOUT = ['BYHOUR', 'BYMINUTE', 'BYSECOND', 'BYWEEKNO', 'BYYEARDAY'];

// The longest INTERVAL the iPhone offers; ical.js reaches the first occurrence of a daily or weekly
// rule a day at a time, so INTERVAL=100000000 takes it seconds inside one step.
const MAX_INTERVAL = 999;

// Whether every rule of the event is one the iPhone can make: daily, weekly, monthly or yearly,
// and none of the parts that make ical.js search without end for a date that never comes (a
// daily rule on February 30th) or step a second at a time. Anything else is not expanded.
function walkable(ev: ICAL.Event): boolean {
  for (const property of ev.component.getAllProperties('rrule')) {
    const rule = property.getFirstValue();
    if (!(rule instanceof ICAL.Recur)) return false;
    const without = rule.freq === 'DAILY' || rule.freq === 'WEEKLY' ? DAILY_WEEKLY_WITHOUT : rule.freq === 'MONTHLY' || rule.freq === 'YEARLY' ? MONTHLY_YEARLY_WITHOUT : null;
    if (!without || without.some((part) => part in rule.parts) || rule.interval > MAX_INTERVAL) return false;
  }
  return true;
}

// Whether every rule of the event has ended before the window, in any zone: nothing to walk.
function endedBefore(ev: ICAL.Event, windowStartMs: number, lengthBound: number): boolean {
  const rules = ev.component.getAllProperties('rrule').map((property) => property.getFirstValue());
  return (
    rules.length > 0 &&
    rules.every((rule) => {
      if (!(rule instanceof ICAL.Recur) || !rule.until) return false;
      const u = rule.until;
      // A date UNTIL still allows the whole of that day.
      const last = Date.UTC(u.year, u.month - 1, u.day, u.hour, u.minute, u.second) + (u.isDate ? DAY_MS : 0);
      return last + MAX_ZONE_OFFSET_MS + lengthBound < windowStartMs;
    })
  );
}

// The starts an event's RDATEs name (a period names its start).
function rdateStarts(ev: ICAL.Event): ICAL.Time[] {
  const out: ICAL.Time[] = [];
  for (const property of ev.component.getAllProperties('rdate')) {
    for (const value of property.getValues()) out.push(value instanceof ICAL.Period ? value.start : (value as ICAL.Time));
  }
  return out;
}

// Every non-cancelled occurrence of the feed that overlaps [windowStartMs, windowEndMs), as rows
// in start order, and whether a limit cut any repeating series short (`truncated`): a step cap, the
// row cap, or a rule the iPhone cannot make (not expanded: only its DTSTART, RDATEs and moved
// occurrences are read). Single events, RDATEs and moved occurrences are read first and always
// kept; the repeating series fill what the feed's row cap leaves. Throws FeedParseError when the
// text is not a calendar, and FeedTooLargeError when `run` (the steps and time left for the whole
// run) runs out while a repeating event still needed walking.
export function expandFeed(
  text: string,
  timezone: string,
  windowStartMs: number,
  windowEndMs: number,
  run: StepBudget = { remaining: MAX_STEPS_PER_RUN },
): { rows: EventRow[]; truncated: boolean } {
  const clock = run.now ?? (() => performance.now());
  const began = clock();
  try {
    return expand(text, timezone, windowStartMs, windowEndMs, run, () => (run.spentMs ?? 0) + (clock() - began) >= MAX_EXPANSION_MS);
  } finally {
    run.spentMs = (run.spentMs ?? 0) + (clock() - began);
  }
}

type Series = { uid: string; ev: ICAL.Event; layout: Layout; startMs: number; excluded: Set<number> };

function expand(
  text: string,
  timezone: string,
  windowStartMs: number,
  windowEndMs: number,
  run: StepBudget,
  outOfTime: () => boolean,
): { rows: EventRow[]; truncated: boolean } {
  let calendar: ICAL.Component;
  try {
    const parsed = ICAL.parse(text);
    if (typeof parsed[0] !== 'string' || parsed[0] !== 'vcalendar') throw new Error('no VCALENDAR');
    calendar = new ICAL.Component(parsed);
  } catch (error) {
    throw new FeedParseError(`The link did not return a calendar, so it is not a calendar feed (${error instanceof Error ? error.message : 'unreadable'}).`);
  }

  // ical.js keeps a registry of zones that is global to the process; this feed's zones are read
  // from its own tree, and anything an earlier feed left is cleared before and after.
  const rows = new Map<string, EventRow>();
  let truncated = false;
  ICAL.TimezoneService.reset();
  try {
    // A series and its overrides share a UID. Overrides are rows of their own, keyed by the
    // occurrence they replace; the series skips those occurrences.
    const series = new Map<string, { ev: ICAL.Event; layout: Layout }[]>();
    const overrides = new Map<string, { ev: ICAL.Event; layout: Layout }[]>();
    for (const component of calendar.getAllSubcomponents('vevent')) {
      try {
        // No exceptions: ical.js would otherwise scan every VEVENT of the feed for each one.
        const ev = new ICAL.Event(component, { exceptions: [] });
        const l = ev.uid && ev.startDate ? layout(ev, timezone) : null;
        if (!ev.uid || !l) continue;
        const into = component.hasProperty('recurrence-id') ? overrides : series;
        const list = into.get(ev.uid);
        if (list) list.push({ ev, layout: l });
        else into.set(ev.uid, [{ ev, layout: l }]);
      } catch {
        // One unreadable event is not the feed's failure.
      }
    }

    const overlaps = (startMs: number, endMs: number) => endMs > windowStartMs && startMs < windowEndMs;
    // Where an occurrence starting at `startMs` (the time `at`) ends.
    const endOf = (l: Layout, at: ICAL.Time, startMs: number): number => {
      if (!l.isAllDay) return startMs + l.lengthMs;
      const last = at.clone();
      last.day += l.lengthDays;
      return dayStartMs(dateOf(last), timezone);
    };
    const replaced = new Set<string>();
    for (const [uid, list] of overrides) {
      for (const { ev, layout: l } of list) {
        try {
          const originalMs = instantMs(ev.recurrenceId, timezone);
          replaced.add(`${uid}${KEY_SEPARATOR}${originalMs}`);
          if (cancelled(ev)) continue;
          const startMs = instantMs(l.start, timezone);
          const endMs = endOf(l, l.start, startMs);
          const row = overlaps(startMs, endMs) ? build(ev, uid, originalMs, startMs, endMs, l.isAllDay) : null;
          if (row) rows.set(row.google_event_id, row);
        } catch {
          // As above.
        }
      }
    }

    // The occurrences of one event that fall in the window go into `rows`; false once nothing
    // later can be wanted.
    const emitterFor = ({ uid, ev, layout: l, excluded }: Series) => {
      const lengthBound = l.isAllDay ? l.lengthDays * DAY_MS : l.lengthMs;
      let emitted = 0;
      return (occurrence: ICAL.Time): boolean => {
        // Long before the window in any zone: no need to know which instant it is.
        const wall = Date.UTC(occurrence.year, occurrence.month - 1, occurrence.day, occurrence.hour, occurrence.minute, occurrence.second);
        if (wall + MAX_ZONE_OFFSET_MS + lengthBound < windowStartMs) return true;
        const startMs = instantMs(occurrence, timezone);
        if (startMs >= windowEndMs) return false;
        if (excluded.has(startMs) || replaced.has(`${uid}${KEY_SEPARATOR}${startMs}`)) return true;
        const endMs = endOf(l, occurrence, startMs);
        const row = overlaps(startMs, endMs) ? build(ev, uid, startMs, startMs, endMs, l.isAllDay) : null;
        if (row) {
          // DTSTART comes round again from the iterator: it counts once.
          if (!rows.has(row.google_event_id)) emitted += 1;
          rows.set(row.google_event_id, row);
        }
        return emitted < MAX_PER_EVENT && rows.size < MAX_PER_FEED;
      };
    };

    // First, what costs no steps and is always kept: single events, the RDATEs of every series, and
    // the DTSTART of a series that is not walked (one the iPhone cannot make, or one that has ended).
    // The series that must be walked are gathered.
    const repeating: Series[] = [];
    for (const [uid, list] of series) {
      for (const { ev, layout: l } of list) {
        if (cancelled(ev)) continue;
        try {
          const s: Series = { uid, ev, layout: l, startMs: instantMs(l.start, timezone), excluded: excludedStarts(ev, timezone) };
          const lengthBound = l.isAllDay ? l.lengthDays * DAY_MS : l.lengthMs;
          const live = ev.component.hasProperty('rrule') && !endedBefore(ev, windowStartMs, lengthBound);
          const canWalk = live && walkable(ev);
          const emit = emitterFor(s);
          // A series that is walked emits its own DTSTART there, where the row cap can stop it.
          if (!canWalk) emit(l.start);
          // A rule that could have had occurrences in the window and is not read: the feed says so.
          if (live && !canWalk && s.startMs < windowEndMs) truncated = true;
          for (const at of rdateStarts(ev)) emit(at);
          if (canWalk) repeating.push(s);
        } catch {
          // A rule that cannot be fulfilled, or a time ical.js cannot read: this event only.
        }
      }
    }
    // Newest start first, then by UID, so the same feed is always cut the same way.
    const newest = (m: number) => (Number.isNaN(m) ? -Infinity : m);
    repeating.sort((a, b) => newest(b.startMs) - newest(a.startMs) || (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
    const fixed = new Set(rows.keys());

    let budget = MAX_STEPS_PER_FEED;
    for (const s of repeating) {
      if (rows.size >= MAX_PER_FEED) {
        truncated = true;
        break;
      }
      try {
        const emit = emitterFor(s);
        // A rule's first occurrence is DTSTART.
        if (!emit(s.layout.start)) continue;
        const steps = s.ev.iterator();
        let n = 0;
        for (let next = steps.next(); next; next = steps.next()) {
          if (n >= MAX_STEPS_PER_EVENT || budget <= 0) {
            truncated = true;
            break;
          }
          // The run's steps or time ran out with this series still to walk: the feed is not read this time.
          if (run.remaining <= 0 || outOfTime()) throw new FeedTooLargeError();
          n += 1;
          budget -= 1;
          run.remaining -= 1;
          if (!emit(next)) break;
        }
      } catch (error) {
        if (error instanceof FeedTooLargeError) throw error;
        // A rule that cannot be fulfilled, or a time ical.js cannot read: this event only.
      }
    }
    if (rows.size >= MAX_PER_FEED) truncated = true;

    // The row cap limits only the repeating rows: what was read first is kept, and the earliest of
    // the repeating ones fill what room is left.
    const byStart = (a: EventRow, b: EventRow) => a.starts_at.localeCompare(b.starts_at) || a.google_event_id.localeCompare(b.google_event_id);
    const all = [...rows.values()];
    const kept = all.filter((row) => fixed.has(row.google_event_id)).sort(byStart);
    const later = all.filter((row) => !fixed.has(row.google_event_id)).sort(byStart);
    const room = Math.max(0, MAX_PER_FEED - kept.length);
    if (later.length > room || kept.length > MAX_PER_FEED) truncated = true;
    return { rows: [...kept, ...later.slice(0, room)].slice(0, MAX_PER_FEED).sort(byStart), truncated };
  } finally {
    ICAL.TimezoneService.reset();
  }
}
