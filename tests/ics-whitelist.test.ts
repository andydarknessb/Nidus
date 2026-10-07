import { describe, expect, it } from 'vitest';
import { expandFeed, MAX_STEPS_PER_RUN } from '../supabase/functions/_shared/ics-expand';

// A fixed sample of the repeat shapes the iPhone writes (the whitelist of ics-expand.ts), each read
// from a start long ago, in each kind of start. Every one is walked (nothing said to be cut) and takes
// well under a third of a second: a shape that does not is one ical.js can spend seconds on in a step.
// The same grammar, sampled by the thousand in a subprocess with a hard kill, is how the whitelist was found.

const ZONES = `BEGIN:VTIMEZONE
TZID:America/Chicago
BEGIN:DAYLIGHT
TZOFFSETFROM:-0600
TZOFFSETTO:-0500
TZNAME:CDT
DTSTART:20070311T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:-0500
TZOFFSETTO:-0600
TZNAME:CST
DTSTART:20071104T020000
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
END:STANDARD
END:VTIMEZONE
BEGIN:VTIMEZONE
TZID:Europe/London
BEGIN:DAYLIGHT
TZOFFSETFROM:+0000
TZOFFSETTO:+0100
TZNAME:BST
DTSTART:19810329T010000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:+0100
TZOFFSETTO:+0000
TZNAME:GMT
DTSTART:19961027T020000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
END:STANDARD
END:VTIMEZONE`;

const WINDOW_START = Date.parse('2026-09-06T00:00:00Z');
const WINDOW_END = Date.parse('2027-04-06T00:00:00Z');
const SHAPES = 400;
const SHAPE_MS = 2000;

function mulberry(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const p2 = (n: number) => String(n).padStart(2, '0');

function sample(count: number): { rule: string; start: string; allDay: boolean }[] {
  const r = mulberry(119);
  const pick = <T>(a: T[]) => a[Math.floor(r() * a.length)]!;
  const int = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));
  const subset = <T>(a: T[], max = a.length) => {
    const chosen = new Set<T>();
    const n = int(1, max);
    while (chosen.size < n) chosen.add(pick(a));
    return [...chosen];
  };
  const position = () => pick([1, 2, 3, 4, 5, -1]);
  return Array.from({ length: count }, () => {
    const freq = pick(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']);
    const parts = [`FREQ=${freq}`];
    let interval = pick([1, 1, 1, 2, 2, 3, 4, 7, 12, 13, 24, 26, 28, 48, 52, 100, 336, 400, 998, 999, int(1, 999)]);
    let setpos = false;
    if (freq === 'DAILY' && r() < 0.5) {
      interval = 1;
      parts.push(`BYDAY=${subset(DAYS).join(',')}`);
    } else if (freq === 'WEEKLY' && r() < 0.6) {
      parts.push(`BYDAY=${subset(DAYS).join(',')}`);
    } else if (freq === 'MONTHLY' || freq === 'YEARLY') {
      const shape = int(0, 3);
      if (freq === 'YEARLY' && (shape > 0 || r() < 0.2)) parts.push(`BYMONTH=${subset([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 4).join(',')}`);
      if (freq === 'MONTHLY' && shape === 1) parts.push(`BYMONTHDAY=${subset([...Array.from({ length: 31 }, (_, k) => k + 1), -1], 6).join(',')}`);
      if (shape === 2 && (freq === 'MONTHLY' || parts.length > 1)) {
        const n = position();
        if (n === 5) interval = 1;
        parts.push(`BYDAY=${n}${pick(DAYS)}`);
      }
      if (shape === 3 && (freq === 'MONTHLY' || parts.length > 1)) {
        const n = position();
        if (n === 5) interval = 1;
        setpos = freq === 'MONTHLY';
        parts.push(`BYDAY=${subset(DAYS).join(',')}`, `BYSETPOS=${n}`);
      }
    }
    if (interval !== 1 || r() < 0.2) parts.push(`INTERVAL=${interval}`);
    if (r() < 0.25) parts.push(`WKST=${pick(DAYS)}`);
    const end = r();
    const counted = end < 0.2;
    if (counted) parts.push(`COUNT=${pick([1, 2, 5, 10, 100, 1000, 5000])}`);
    else if (end < 0.4) parts.push(`UNTIL=${pick([2027, 2030, 2099])}${p2(int(1, 12))}${p2(int(1, 28))}`);
    // A monthly BYSETPOS with COUNT is walked from DTSTART, and only from at most 240 of its steps before the window.
    const year = setpos && counted ? int(2007, 2026) : r() < 0.5 ? int(1900, 2026) : pick([1900, 1970, 1999, 2015, 2026]);
    const month = int(1, 12);
    const date = `${year}${p2(month)}${p2(r() < 0.3 ? new Date(Date.UTC(year, month, 0)).getUTCDate() : int(1, 28))}`;
    const time = `T${p2(int(0, 23))}${pick(['00', '15', '30'])}00`;
    const kind = pick(['utc', 'floating', 'chicago', 'london', 'allday']);
    const start = {
      utc: `DTSTART:${date}${time}Z`,
      floating: `DTSTART:${date}${time}`,
      chicago: `DTSTART;TZID=America/Chicago:${date}${time}`,
      london: `DTSTART;TZID=Europe/London:${date}${time}`,
      allday: `DTSTART;VALUE=DATE:${date}`,
    }[kind]!;
    return { rule: parts.join(';'), start, allDay: kind === 'allday' };
  });
}

describe('expandFeed: the shapes the iPhone writes', () => {
  it(`walks ${SHAPES} sampled shapes, in every kind of start, each in under ${SHAPE_MS} ms and with nothing said to be cut`, () => {
    let slowest = 0;
    for (const { rule, start, allDay } of sample(SHAPES)) {
      const text = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        ZONES,
        'BEGIN:VEVENT',
        'UID:sampled',
        'DTSTAMP:20260901T000000Z',
        'SUMMARY:Sampled',
        start,
        ...(allDay ? [`DTEND;VALUE=DATE:${start.split(':')[1]}`] : []),
        `RRULE:${rule}`,
        'END:VEVENT',
        'END:VCALENDAR',
        '',
      ]
        .join('\n')
        .replace(/\n/g, '\r\n');
      const run = { remaining: MAX_STEPS_PER_RUN, spentMs: 0 };
      const began = performance.now();
      const { truncated } = expandFeed(text, 'America/Chicago', WINDOW_START, WINDOW_END, run);
      const took = performance.now() - began;
      slowest = Math.max(slowest, took);
      expect(truncated, `${rule} ${start}`).toBe(false);
      expect(took, `${rule} ${start}`).toBeLessThan(SHAPE_MS);
    }
    expect(slowest).toBeLessThan(SHAPE_MS);
  }, 20_000);
});
