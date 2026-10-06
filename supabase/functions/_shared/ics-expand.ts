// An iPhone (iCloud) calendar's feed as Synced Event rows (issue #117, spec 0005). Unlike
// Google, a feed carries its repeats as rules, so this expands them with ical.js: RRULE, RDATE,
// EXDATE, overrides by RECURRENCE-ID, VTIMEZONE and TZID. Pure: text, the Household Timezone and
// a window in, rows out, no network, no clock, no Deno globals, so the same code runs under
// Vitest (Node) and the Edge Function (Deno). The machine's own zone is never consulted: every
// wall-clock time is turned into an instant by the feed's zone or the Household Timezone.
import ICAL from 'ical.js';
import type { EventRow } from '../calendar-sync/handler.ts';
import { dayStartMs, wallClockMs } from './zoned-time.ts';

// Kept equal to toRow's cuts in calendar-sync/handler.ts.
const MAX_TITLE = 500;
const MAX_LOCATION = 500;
const MAX_DESCRIPTION = 8000;
export const MAX_PER_EVENT = 1000;
export const MAX_PER_FEED = 20000;
// How far one rule is walked looking for the window: a rule that started long ago and fires
// every few seconds would otherwise take forever. ponytail: no fast-forward in ical.js's
// iterator; past this the later occurrences of such a rule are dropped.
const MAX_STEPS_PER_EVENT = 100_000;
// Between the UID and the occurrence's original start in a row's key.
const KEY_SEPARATOR = '|';

export class FeedParseError extends Error {}

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

type Layout = { start: ICAL.Time; isAllDay: boolean; lengthDays: number; lengthMs: number };

// The master's length, taken once: DTEND, else DURATION, else a day for a date and nothing for
// a time (ical.js's `endDate` already says so).
function layout(ev: ICAL.Event, timezone: string): Layout | null {
  const start = ev.startDate;
  if (!start) return null;
  const end = ev.endDate;
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

// Every non-cancelled occurrence of the feed that overlaps [windowStartMs, windowEndMs), as rows
// in start order. Throws FeedParseError when the text is not a calendar.
export function expandFeed(text: string, timezone: string, windowStartMs: number, windowEndMs: number): EventRow[] {
  let calendar: ICAL.Component;
  try {
    const parsed = ICAL.parse(text);
    if (typeof parsed[0] !== 'string' || parsed[0] !== 'vcalendar') throw new Error('no VCALENDAR');
    calendar = new ICAL.Component(parsed);
  } catch (error) {
    throw new FeedParseError(`The link did not return a calendar, so it is not a calendar feed (${error instanceof Error ? error.message : 'unreadable'}).`);
  }

  // The zone registry is global to ical.js: register this feed's zones, and clear them after.
  const rows = new Map<string, EventRow>();
  ICAL.TimezoneService.reset();
  try {
    for (const zone of calendar.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(zone);
    // A series and its overrides share a UID. Overrides are rows of their own, keyed by the
    // occurrence they replace; the series skips those occurrences.
    const series = new Map<string, ICAL.Event[]>();
    const overrides = new Map<string, ICAL.Event[]>();
    for (const component of calendar.getAllSubcomponents('vevent')) {
      const ev = new ICAL.Event(component);
      if (!ev.uid || !ev.startDate) continue;
      const into = component.hasProperty('recurrence-id') ? overrides : series;
      into.set(ev.uid, [...(into.get(ev.uid) ?? []), ev]);
    }

    const overlaps = (startMs: number, endMs: number) => endMs > windowStartMs && startMs < windowEndMs;
    const replaced = new Set<string>();
    for (const [uid, list] of overrides) {
      for (const ev of list) {
        try {
          replaced.add(`${uid}${KEY_SEPARATOR}${instantMs(ev.recurrenceId, timezone)}`);
          if (cancelled(ev)) continue;
          const l = layout(ev, timezone);
          if (!l) continue;
          const startMs = instantMs(l.start, timezone);
          const endMs = l.isAllDay ? dayStartMs(dateOf(ev.endDate), timezone) : startMs + l.lengthMs;
          const row = overlaps(startMs, endMs) ? build(ev, uid, instantMs(ev.recurrenceId, timezone), startMs, endMs, l.isAllDay) : null;
          if (row) rows.set(row.google_event_id, row);
        } catch {
          // One unreadable event is not the feed's failure.
        }
      }
    }

    for (const [uid, list] of series) {
      for (const ev of list) {
        if (cancelled(ev)) continue;
        try {
          const l = layout(ev, timezone);
          if (!l) continue;
          let emitted = 0;
          const emit = (occurrence: ICAL.Time): boolean => {
            const startMs = instantMs(occurrence, timezone);
            if (startMs >= windowEndMs) return false;
            if (replaced.has(`${uid}${KEY_SEPARATOR}${startMs}`)) return true;
            let endMs: number;
            if (l.isAllDay) {
              const last = occurrence.clone();
              last.day += l.lengthDays;
              endMs = dayStartMs(dateOf(last), timezone);
            } else {
              endMs = startMs + l.lengthMs;
            }
            const row = overlaps(startMs, endMs) ? build(ev, uid, startMs, startMs, endMs, l.isAllDay) : null;
            if (row) {
              // DTSTART comes round again from the iterator: it counts once.
              if (!rows.has(row.google_event_id)) emitted += 1;
              rows.set(row.google_event_id, row);
            }
            return emitted < MAX_PER_EVENT;
          };
          // A rule's first occurrence is DTSTART; an RDATE-only event is not iterated from it.
          if (!emit(l.start)) continue;
          if (ev.isRecurring()) {
            const steps = ev.iterator();
            for (let n = 0, next = steps.next(); next && n < MAX_STEPS_PER_EVENT; n += 1, next = steps.next()) {
              if (!emit(next)) break;
            }
          }
        } catch {
          // A rule that cannot be fulfilled, or a time ical.js cannot read: this event only.
        }
        if (rows.size >= MAX_PER_FEED) break;
      }
      if (rows.size >= MAX_PER_FEED) break;
    }
  } finally {
    ICAL.TimezoneService.reset();
  }

  return [...rows.values()]
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.google_event_id.localeCompare(b.google_event_id))
    .slice(0, MAX_PER_FEED);
}
