import { describe, expect, it } from 'vitest';
import { expandFeed, FeedParseError, FeedTooLargeError, MAX_EXPANSION_MS, MAX_PER_FEED, MAX_STEPS_PER_RUN, type StepBudget } from '../supabase/functions/_shared/ics-expand';

// Pure: feed text in, rows out. The fixtures are iCloud-style feeds (CRLF line endings,
// VTIMEZONE blocks, X-WR-CALNAME, folded lines), not objects built to suit the code. Run once
// with TZ set to an odd zone (TZ=Pacific/Chatham) to see that the machine's zone never matters.

const HOUSEHOLD = 'Pacific/Auckland';
const WINDOW_START = Date.parse('2026-09-01T00:00:00Z');
const WINDOW_END = Date.parse('2027-03-01T00:00:00Z');
const DAY_MS = 86_400_000;

const CHICAGO = `BEGIN:VTIMEZONE
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
END:VTIMEZONE`;

const LONDON = `BEGIN:VTIMEZONE
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

// A whole feed as iCloud sends it: lines end in CRLF.
function feed(...components: string[]): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Apple Inc.//iPhone OS 18.0//EN',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:Family',
    'X-WR-TIMEZONE:America/Chicago',
    CHICAGO,
    LONDON,
    ...components,
    'END:VCALENDAR',
    '',
  ]
    .join('\n')
    .replace(/\n/g, '\r\n');
}

function event(lines: string, uid = 'ev-1', summary = 'Thing'): string {
  return `BEGIN:VEVENT\nUID:${uid}\nDTSTAMP:20260901T000000Z\nSUMMARY:${summary}\n${lines}\nEND:VEVENT`;
}

const expand = (text: string, timezone = HOUSEHOLD) => expandFeed(text, timezone, WINDOW_START, WINDOW_END).rows;
const starts = (text: string, timezone = HOUSEHOLD) => expand(text, timezone).map((row) => row.starts_at);

describe('expandFeed: repeats', () => {
  const weekly = (extra: string) =>
    event(`DTSTART;TZID=America/Chicago:20261006T180000\nDTEND;TZID=America/Chicago:20261006T190000\nRRULE:FREQ=WEEKLY;COUNT=6\n${extra}`);

  it('expands a weekly rule, drops an EXDATE and a cancelled occurrence, and moves an override without changing its key', () => {
    const exdate = 'EXDATE;TZID=America/Chicago:20261013T180000';
    const cancelled = event(
      'RECURRENCE-ID;TZID=America/Chicago:20261103T180000\nDTSTART;TZID=America/Chicago:20261103T180000\nDTEND;TZID=America/Chicago:20261103T190000\nSTATUS:CANCELLED',
    );
    const before = expand(feed(weekly(exdate), cancelled));
    // Oct 6 CDT, Oct 20 CDT, Oct 27 CDT, Nov 10 CST: Oct 13 is excluded, Nov 3 cancelled.
    expect(before.map((row) => row.starts_at)).toEqual([
      '2026-10-06T23:00:00.000Z',
      '2026-10-20T23:00:00.000Z',
      '2026-10-27T23:00:00.000Z',
      '2026-11-11T00:00:00.000Z',
    ]);

    const moved = event(
      'RECURRENCE-ID;TZID=America/Chicago:20261020T180000\nDTSTART;TZID=America/Chicago:20261021T190000\nDTEND;TZID=America/Chicago:20261021T200000',
      'ev-1',
      'Moved',
    );
    const after = expand(feed(weekly(exdate), cancelled, moved));
    expect(after).toHaveLength(4);
    const was = before.find((row) => row.starts_at === '2026-10-20T23:00:00.000Z')!;
    const now = after.find((row) => row.starts_at === '2026-10-22T00:00:00.000Z')!;
    expect(now.title).toBe('Moved');
    expect(now.ends_at).toBe('2026-10-22T01:00:00.000Z');
    expect(now.google_event_id).toBe(was.google_event_id);
    expect(now.google_event_id).toBe('ev-1|2026-10-20T23:00:00.000Z');
    expect(after.map((row) => row.google_event_id)).toEqual(before.map((row) => row.google_event_id));
  });

  it('adds RDATEs, to a rule and on their own', () => {
    const withRule = event(
      'DTSTART;TZID=America/Chicago:20261006T180000\nDTEND;TZID=America/Chicago:20261006T190000\nRRULE:FREQ=WEEKLY;COUNT=2\nRDATE;TZID=America/Chicago:20261009T120000',
    );
    expect(starts(feed(withRule))).toEqual(['2026-10-06T23:00:00.000Z', '2026-10-09T17:00:00.000Z', '2026-10-13T23:00:00.000Z']);
    const alone = event('DTSTART:20261006T230000Z\nDTEND:20261007T000000Z\nRDATE:20261008T230000Z,20261009T230000Z');
    expect(starts(feed(alone))).toEqual(['2026-10-06T23:00:00.000Z', '2026-10-08T23:00:00.000Z', '2026-10-09T23:00:00.000Z']);
  });

  it('keeps a moved occurrence whose original start is outside the window', () => {
    const series = event('DTSTART;TZID=America/Chicago:20260817T180000\nDTEND;TZID=America/Chicago:20260817T190000\nRRULE:FREQ=WEEKLY;COUNT=3');
    const moved = event(
      'RECURRENCE-ID;TZID=America/Chicago:20260817T180000\nDTSTART;TZID=America/Chicago:20260902T180000\nDTEND;TZID=America/Chicago:20260902T190000',
    );
    const rows = expand(feed(series, moved));
    // Aug 17 and 31 are outside the window (Aug 24 and 31 end by Sep 1 00:00Z); only the move shows.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ starts_at: '2026-09-02T23:00:00.000Z', google_event_id: 'ev-1|2026-08-17T23:00:00.000Z' });
  });

  it('reads the same feed to the same keys twice', () => {
    const text = feed(weekly('EXDATE;TZID=America/Chicago:20261013T180000'), event('DTSTART;VALUE=DATE:20261010', 'ev-2'));
    expect(expand(text)).toEqual(expand(text));
  });
});

describe('expandFeed: times', () => {
  // Auckland is on +13 from Sep 27 (NZDT) and +12 before; Chicago, where this suite runs, is neither.
  it('turns an all-day event into the Household midnight to the midnight after', () => {
    const text = feed(event('DTSTART;VALUE=DATE:20261010\nDTEND;VALUE=DATE:20261011'));
    const rows = expand(text);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ starts_at: '2026-10-09T11:00:00.000Z', ends_at: '2026-10-10T11:00:00.000Z', is_all_day: true });
    // In another Household the same date is another instant.
    expect(expand(text, 'America/Chicago')[0]?.starts_at).toBe('2026-10-10T05:00:00.000Z');
  });

  it('runs a multi-day all-day event to the midnight after its last day, across a DST change', () => {
    // Sep 25 to Sep 28 inclusive; the clocks go forward in Auckland at 02:00 on Sep 27.
    const [row] = expand(feed(event('DTSTART;VALUE=DATE:20260925\nDTEND;VALUE=DATE:20260929')));
    expect(row).toMatchObject({ starts_at: '2026-09-24T12:00:00.000Z', ends_at: '2026-09-28T11:00:00.000Z', is_all_day: true });
  });

  it('gives an all-day event with no end one day, or its DURATION', () => {
    expect(expand(feed(event('DTSTART;VALUE=DATE:20261010')))[0]?.ends_at).toBe('2026-10-10T11:00:00.000Z');
    expect(expand(feed(event('DTSTART;VALUE=DATE:20261010\nDURATION:P3D')))[0]?.ends_at).toBe('2026-10-12T11:00:00.000Z');
  });

  it('repeats an all-day event on Household midnights', () => {
    const rows = expand(feed(event('DTSTART;VALUE=DATE:20260918\nDTEND;VALUE=DATE:20260920\nRRULE:FREQ=WEEKLY;COUNT=3')));
    expect(rows.map((row) => [row.starts_at, row.ends_at])).toEqual([
      ['2026-09-17T12:00:00.000Z', '2026-09-19T12:00:00.000Z'],
      ['2026-09-24T12:00:00.000Z', '2026-09-26T12:00:00.000Z'],
      ['2026-10-01T11:00:00.000Z', '2026-10-03T11:00:00.000Z'],
    ]);
  });

  it('reads a floating time in the Household Timezone', () => {
    const text = feed(event('DTSTART:20261014T090000\nDTEND:20261014T100000'));
    expect(expand(text)[0]).toMatchObject({ starts_at: '2026-10-13T20:00:00.000Z', ends_at: '2026-10-13T21:00:00.000Z', is_all_day: false });
    expect(expand(text, 'Asia/Tokyo')[0]?.starts_at).toBe('2026-10-14T00:00:00.000Z');
  });

  it('keeps a floating repeat at the same wall time across a DST change', () => {
    const text = feed(event('DTSTART:20260924T090000\nDTEND:20260924T100000\nRRULE:FREQ=WEEKLY;COUNT=2'));
    expect(starts(text)).toEqual(['2026-09-23T21:00:00.000Z', '2026-09-30T20:00:00.000Z']);
  });

  it('reads a TZID event in its own zone across that zone and the Household changing their clocks', () => {
    // Mondays 09:00 in London from Oct 19: BST until Oct 25, GMT after; Chicago changes on Nov 1.
    const text = feed(event('DTSTART;TZID=Europe/London:20261019T090000\nDTEND;TZID=Europe/London:20261019T100000\nRRULE:FREQ=WEEKLY;COUNT=3'));
    expect(starts(text)).toEqual(['2026-10-19T08:00:00.000Z', '2026-10-26T09:00:00.000Z', '2026-11-02T09:00:00.000Z']);
  });

  it('reads a TZID the feed never defines in the Household Timezone', () => {
    expect(starts(feed(event('DTSTART;TZID=Mars/Olympus:20261014T090000')))).toEqual(['2026-10-13T20:00:00.000Z']);
  });

  it('reads UTC times as they are', () => {
    expect(expand(feed(event('DTSTART:20261014T140000Z\nDTEND:20261014T153000Z')))[0]).toMatchObject({
      starts_at: '2026-10-14T14:00:00.000Z',
      ends_at: '2026-10-14T15:30:00.000Z',
    });
  });

  it('uses DURATION when there is no end, and zero length for a time with neither', () => {
    expect(expand(feed(event('DTSTART:20261014T140000Z\nDURATION:PT90M')))[0]?.ends_at).toBe('2026-10-14T15:30:00.000Z');
    const [row] = expand(feed(event('DTSTART:20261014T140000Z')));
    expect(row?.ends_at).toBe(row?.starts_at);
  });
});

describe('expandFeed: which occurrences', () => {
  it('skips a cancelled event', () => {
    expect(expand(feed(event('DTSTART:20261014T140000Z\nSTATUS:CANCELLED')))).toEqual([]);
  });

  it('keeps only occurrences that overlap the window', () => {
    const text = feed(
      event('DTSTART:20250101T140000Z', 'before'),
      event('DTSTART:20270601T140000Z', 'after'),
      event('DTSTART:20260831T230000Z\nDTEND:20260901T010000Z', 'straddles-start'),
      event('DTSTART:20200105T140000Z\nRRULE:FREQ=MONTHLY;BYMONTHDAY=5', 'old-series'),
    );
    const rows = expand(text);
    expect(rows.map((row) => row.google_event_id.split('|')[0])).toEqual(['straddles-start', ...Array(6).fill('old-series')]);
    expect(rows.slice(1).map((row) => row.starts_at)).toEqual([
      '2026-09-05T14:00:00.000Z',
      '2026-10-05T14:00:00.000Z',
      '2026-11-05T14:00:00.000Z',
      '2026-12-05T14:00:00.000Z',
      '2027-01-05T14:00:00.000Z',
      '2027-02-05T14:00:00.000Z',
    ]);
  });
});

describe('expandFeed: text', () => {
  it('unfolds lines, unescapes text, and cuts long ones as Google rows are cut', () => {
    const long = 'x'.repeat(9000);
    const folded = 'DESCRIPTION:Bring the big one\\, the blue one\\nand a snack\n  that is folded here';
    const text = feed(`BEGIN:VEVENT\nUID:t\nDTSTAMP:20260901T000000Z\nSUMMARY:${'T'.repeat(600)}\nLOCATION:${'L'.repeat(600)}\nDTSTART:20261014T140000Z\n${folded}\nEND:VEVENT`);
    const [row] = expand(text);
    expect(row?.title).toBe('T'.repeat(500));
    expect(row?.location).toBe('L'.repeat(500));
    expect(row?.description).toBe('Bring the big one, the blue one\nand a snack that is folded here');
    const [longRow] = expand(feed(event(`DTSTART:20261014T140000Z\nDESCRIPTION:${long}`)));
    expect(longRow?.description).toHaveLength(8000);
  });

  it('names an untitled event and leaves absent notes null', () => {
    const [row] = expand(feed('BEGIN:VEVENT\nUID:n\nDTSTAMP:20260901T000000Z\nDTSTART:20261014T140000Z\nEND:VEVENT'));
    expect(row).toMatchObject({ title: '(No title)', description: null, location: null });
  });
});

describe('expandFeed: broken feeds', () => {
  it('raises a clear error for text that is not a calendar', () => {
    expect(() => expand('<html><body>Sign in</body></html>')).toThrow(FeedParseError);
    expect(() => expand('')).toThrow(/not a calendar/);
  });

  it('raises for a calendar cut off mid-event', () => {
    const cut = feed(event('DTSTART:20261014T140000Z')).replace(/END:VEVENT[\s\S]*$/, '');
    expect(() => expand(cut)).toThrow(FeedParseError);
  });

  it('reads a calendar with no events as no rows', () => {
    expect(expand(feed())).toEqual([]);
  });

  it('skips an event with no start rather than failing the feed', () => {
    const rows = expand(feed('BEGIN:VEVENT\nUID:nostart\nSUMMARY:Broken\nEND:VEVENT', event('DTSTART:20261014T140000Z', 'ok')));
    expect(rows.map((row) => row.google_event_id.split('|')[0])).toEqual(['ok']);
  });
});

describe('expandFeed: excluded starts', () => {
  const series = (exdate: string) =>
    event(`DTSTART;TZID=America/Chicago:20261006T180000\nDTEND;TZID=America/Chicago:20261006T190000\nRRULE:FREQ=WEEKLY;COUNT=3\n${exdate}`);

  it('honours an EXDATE equal to DTSTART, in a zone and in UTC', () => {
    for (const exdate of [
      'EXDATE;TZID=America/Chicago:20261006T180000',
      'EXDATE:20261006T230000Z',
      'EXDATE:20261006T230000Z,20261013T230000Z',
    ]) {
      const rows = starts(feed(series(exdate)));
      expect(rows, exdate).toEqual(exdate.includes('1013') ? ['2026-10-20T23:00:00.000Z'] : ['2026-10-13T23:00:00.000Z', '2026-10-20T23:00:00.000Z']);
    }
  });

  it('honours an EXDATE on an event with only RDATEs', () => {
    const alone = event('DTSTART:20261006T230000Z\nRDATE:20261008T230000Z\nEXDATE:20261006T230000Z');
    expect(starts(feed(alone))).toEqual(['2026-10-08T23:00:00.000Z']);
  });
});

describe('expandFeed: lengths', () => {
  it('treats a DTEND before DTSTART as no DTEND, for times and for dates', () => {
    expect(expand(feed(event('DTSTART:20261014T140000Z\nDTEND:20261014T130000Z')))[0]).toMatchObject({
      starts_at: '2026-10-14T14:00:00.000Z',
      ends_at: '2026-10-14T14:00:00.000Z',
    });
    expect(expand(feed(event('DTSTART:20261014T140000Z\nDTEND:20261014T130000Z\nDURATION:PT45M')))[0]?.ends_at).toBe('2026-10-14T14:45:00.000Z');
    expect(expand(feed(event('DTSTART;VALUE=DATE:20261010\nDTEND;VALUE=DATE:20261008')))[0]).toMatchObject({
      starts_at: '2026-10-09T11:00:00.000Z',
      ends_at: '2026-10-10T11:00:00.000Z',
    });
  });

  it('gives an all-day override at least one day, as its series', () => {
    const series = event('DTSTART;VALUE=DATE:20261010\nDTEND;VALUE=DATE:20261011\nRRULE:FREQ=WEEKLY;COUNT=2');
    for (const end of ['DTEND;VALUE=DATE:20261017', 'DTEND;VALUE=DATE:20261015', '']) {
      const moved = event(`RECURRENCE-ID;VALUE=DATE:20261017\nDTSTART;VALUE=DATE:20261017\n${end}`);
      const rows = expand(feed(series, moved));
      expect(rows.map((row) => [row.starts_at, row.ends_at]), end).toEqual([
        ['2026-10-09T11:00:00.000Z', '2026-10-10T11:00:00.000Z'],
        ['2026-10-16T11:00:00.000Z', '2026-10-17T11:00:00.000Z'],
      ]);
    }
  });
});

// A run's work with a clock that never moves, so that no test here depends on how fast the machine is:
// only the step caps and the time limit the test itself sets can cut a read.
function mulberry(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const budget = (remaining = MAX_STEPS_PER_RUN): StepBudget => ({ remaining, spentMs: 0, now: () => 0 });
const read = (text: string, run: StepBudget = budget()) => expandFeed(text, HOUSEHOLD, WINDOW_START, WINDOW_END, run);
const ids = (rows: { google_event_id: string }[]) => rows.map((row) => row.google_event_id.split('|')[0]!);
// A daily rule from the year 1700 reaches the window only after 119,000 steps: more than any cap.
// A rule with a COUNT is not skipped forward (see fastForwarded), so it is walked from DTSTART.
const runaway = (uid: string, year = 1700) => event(`DTSTART:${year}0101T000000\nRRULE:FREQ=DAILY;COUNT=400000`, uid);
const dentist = event('DTSTART:20261014T140000Z', 'dentist', 'Dentist');

describe('expandFeed: work', () => {
  // The bounds are generous: they catch a quadratic or runaway walk, not a slow machine.
  const quickly = (work: () => void) => {
    const began = Date.now();
    work();
    expect(Date.now() - began).toBeLessThan(10_000);
  };

  it('expands a few thousand plain events at once', () => {
    const events = Array.from({ length: 4000 }, (_, index) => event(`DTSTART:20261014T140000Z\nDTEND:20261014T150000Z`, `bulk-${index}`));
    quickly(() => expect(expand(feed(...events))).toHaveLength(4000));
  });

  it('gives up on a series with two rules from the year 1700, without throwing, and says so', () => {
    quickly(() => {
      const { rows, truncated } = read(feed(event('DTSTART;VALUE=DATE:17000101\nRRULE:FREQ=DAILY\nRRULE:FREQ=DAILY;INTERVAL=7')));
      expect(rows).toEqual([]);
      expect(truncated).toBe(true);
    });
  });

  it('reads a single daily rule from the year 1700 in full, for a few steps', () => {
    const run = budget();
    const { rows, truncated } = read(feed(event('DTSTART;VALUE=DATE:17000101\nRRULE:FREQ=DAILY')), run);
    expect(rows.length).toBeGreaterThan(150);
    expect(truncated).toBe(false);
    expect(MAX_STEPS_PER_RUN - run.remaining).toBeLessThan(300);
  });

  it('always keeps a single event, before or after a runaway rule, and says the rule was cut', () => {
    for (const events of [[runaway('a'), dentist], [dentist, runaway('a')], [runaway('a'), dentist, runaway('b')]]) {
      const { rows, truncated } = read(feed(...events));
      expect(ids(rows)).toEqual(['dentist']);
      expect(truncated).toBe(true);
    }
  });

  it('keeps a single event after more runaway rules than a feed has steps for', () => {
    const many = Array.from({ length: 6 }, (_, index) => runaway(`r${index}`, 1700 + index));
    quickly(() => expect(ids(read(feed(...many, dentist)).rows)).toEqual(['dentist']));
  });

  it('keeps a single event when the run has no steps left, and costs no steps', () => {
    const run = budget(0);
    const { rows, truncated } = read(feed(dentist), run);
    expect(ids(rows)).toEqual(['dentist']);
    expect(truncated).toBe(false);
    expect(run.remaining).toBe(0);
  });

  it('does not say anything was cut when nothing was', () => {
    expect(read(feed(dentist, event('DTSTART:20261015T140000Z\nRRULE:FREQ=DAILY;COUNT=3', 'few'))).truncated).toBe(false);
  });

  it('walks the newest series first, so the old expensive rules are the ones cut', () => {
    // Feed order puts the newest last: four ancient rules would spend the feed's steps before it.
    const ancient = Array.from({ length: 4 }, (_, index) => runaway(`ancient${index}`, 1700 + index));
    const recent = event('DTSTART:20261015T140000Z\nRRULE:FREQ=DAILY;COUNT=2', 'recent');
    const { rows, truncated } = read(feed(...ancient, recent));
    expect(ids(rows)).toEqual(['recent', 'recent']);
    expect(truncated).toBe(true);
  });

  it('stops only the series that reaches the per-event cap, and spends no more than the feed may', () => {
    const run = budget();
    const weekly = event('DTSTART:20261014T140000Z\nRRULE:FREQ=WEEKLY;COUNT=3', 'weekly');
    const { rows, truncated } = read(feed(runaway('a'), runaway('b', 1701), weekly), run);
    expect(ids(rows)).toEqual(['weekly', 'weekly', 'weekly']);
    expect(truncated).toBe(true);
    // The three weeks, a runaway to its 30,000, and the second to what the feed has left of 60,000.
    expect(MAX_STEPS_PER_RUN - run.remaining).toBe(60_000);
  });
});

describe('expandFeed: the step budget of a run', () => {
  // Four rules are more than a feed's steps (60,000 at 30,000 each).
  const heavy = (prefix: string) => Array.from({ length: 4 }, (_, index) => runaway(`${prefix}${index}`, 1700 + index));

  it('lets one feed take at most 60,000 steps of the run, keeping what it reached', () => {
    const run = budget();
    const { rows, truncated } = read(feed(event('DTSTART:20261014T140000Z', 'first'), ...heavy('a')), run);
    expect(ids(rows)).toEqual(['first']);
    expect(truncated).toBe(true);
    expect(run.remaining).toBe(MAX_STEPS_PER_RUN - 60_000);
  });

  it('shares what is left between feeds: a second bad feed that needs more than the run has is not stored', () => {
    const run = budget();
    expect(read(feed(...heavy('a')), run).truncated).toBe(true);
    expect(() => read(feed(...heavy('b')), run)).toThrow(FeedTooLargeError);
    expect(run.remaining).toBe(0);
  });

  it('throws, rather than return half a feed, when the run ran out in the middle of a series', () => {
    const run = budget(20_000);
    expect(() => read(feed(event('DTSTART:20261014T140000Z', 'first'), runaway('a')), run)).toThrow(FeedTooLargeError);
    expect(run.remaining).toBe(0);
  });

  it('throws when the run ran out exactly as one series ended, with a later repeating series unread', () => {
    const few = event('DTSTART:20261014T140000Z\nRRULE:FREQ=DAILY;COUNT=5', 'few');
    const measured = budget(1000);
    read(feed(few), measured);
    const run = budget(1000 - measured.remaining);
    expect(() => read(feed(few, event('DTSTART:20261013T140000Z\nRRULE:FREQ=DAILY;COUNT=5', 'later')), run)).toThrow(FeedTooLargeError);
  });

  it('is not cut by the run when what is left is single events, or a rule that starts after the window', () => {
    const later = event('DTSTART:20270601T140000Z\nRRULE:FREQ=DAILY', 'later');
    const rows = read(feed(event('DTSTART:20261014T140000Z', 'plain'), later, event('DTSTART:20261015T140000Z', 'plain2')), budget(0)).rows;
    expect(ids(rows)).toEqual(['plain', 'plain2']);
  });

  it('is not cut by the run when the feed hit its row cap before the repeating events', () => {
    const events = Array.from({ length: MAX_PER_FEED }, (_, index) => event('DTSTART:20261014T140000Z', `bulk-${index}`));
    const { rows } = read(feed(...events, event('DTSTART:20261014T140000Z\nRRULE:FREQ=DAILY;COUNT=5', 'few')), budget(0));
    expect(rows).toHaveLength(MAX_PER_FEED);
  });

  it('reads a feed that fits whole, and spends only what it walked', () => {
    const run = budget(1000);
    const { rows, truncated } = read(feed(event('DTSTART:20261014T140000Z\nRRULE:FREQ=DAILY;COUNT=5', 'few')), run);
    expect(rows).toHaveLength(5);
    expect(truncated).toBe(false);
    expect(run.remaining).toBeGreaterThan(900);
    expect(run.remaining).toBeLessThan(1000);
  });
});

describe('expandFeed: the time limit of a run', () => {
  // A clock that moves a millisecond each time it is read, which the step loop does once a step.
  const ticking = (): StepBudget => {
    let t = 0;
    return { remaining: MAX_STEPS_PER_RUN, spentMs: 0, now: () => (t += 1) };
  };

  it('stops a walk once 800 ms of the run have passed, as if the run had no steps left', () => {
    const run = ticking();
    expect(() => read(feed(runaway('a')), run)).toThrow(FeedTooLargeError);
    const walked = MAX_STEPS_PER_RUN - run.remaining;
    expect(walked).toBeGreaterThan(700);
    expect(walked).toBeLessThanOrEqual(MAX_EXPANSION_MS);
    expect(run.spentMs).toBeGreaterThanOrEqual(MAX_EXPANSION_MS - 1);
  });

  it('keeps single events, RDATEs and moved occurrences when the time is spent, and is not cut when nothing needs walking', () => {
    const run = { ...budget(), spentMs: MAX_EXPANSION_MS };
    const { rows, truncated } = read(feed(dentist, event('DTSTART:20270601T140000Z\nRRULE:FREQ=DAILY', 'later')), run);
    expect(ids(rows)).toEqual(['dentist']);
    expect(truncated).toBe(false);
  });

  it('counts the time of every feed of the run: what the first spent, the second does not have', () => {
    const run = ticking();
    // Daily since mid-2025, with a COUNT so that it is walked from DTSTART: about 640 steps to the end of the window.
    const twoRules = (uid: string) => event('DTSTART:20250601T140000Z\nRRULE:FREQ=DAILY;COUNT=700', uid);
    read(feed(twoRules('first')), run);
    expect(run.spentMs).toBeGreaterThan(600);
    expect(run.spentMs).toBeLessThan(MAX_EXPANSION_MS);
    // The second feed's walk needs about as much again, and the run has a fifth of that left.
    expect(() => read(feed(twoRules('second')), run)).toThrow(FeedTooLargeError);
    expect(run.spentMs).toBeGreaterThanOrEqual(MAX_EXPANSION_MS - 1);
  });

  it('does not stop a walk while the time is within the limit', () => {
    const run = budget();
    // Daily since mid-2025, to the end of the window: the 181 days of it are rows.
    expect(read(feed(event('DTSTART:20250601T140000Z\nRRULE:FREQ=DAILY', 'long')), run).rows).toHaveLength(181);
    expect(run.spentMs).toBe(0);
  });
});

describe('expandFeed: rules the iPhone cannot make', () => {
  // Each of these makes ical.js search without end, or step a second at a time; the first two took
  // 19 s and forever in the review. None is walked.
  const hostile = [
    'FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30',
    'FREQ=SECONDLY;BYMONTH=1',
    'FREQ=MINUTELY;BYMONTH=1',
    'FREQ=SECONDLY;BYDAY=MO,TU,WE,TH,FR',
    'FREQ=SECONDLY',
    'FREQ=MINUTELY',
    'FREQ=HOURLY',
    'FREQ=DAILY;BYMONTH=1',
    'FREQ=DAILY;BYYEARDAY=60',
    'FREQ=DAILY;BYWEEKNO=5',
    'FREQ=DAILY;BYSETPOS=1',
    'FREQ=DAILY;BYHOUR=9',
    'FREQ=DAILY;BYMINUTE=30',
    'FREQ=DAILY;BYSECOND=30',
    'FREQ=WEEKLY;BYMONTHDAY=13;BYDAY=FR',
    'FREQ=WEEKLY;BYMONTH=2',
    'FREQ=WEEKLY;BYHOUR=9',
    'FREQ=MONTHLY;BYHOUR=9',
    'FREQ=MONTHLY;BYMINUTE=30',
    'FREQ=MONTHLY;BYSECOND=30',
    'FREQ=MONTHLY;BYWEEKNO=5',
    'FREQ=MONTHLY;BYYEARDAY=60',
    'FREQ=YEARLY;BYHOUR=9',
    'FREQ=YEARLY;BYWEEKNO=20;BYDAY=MO',
    'FREQ=YEARLY;BYYEARDAY=60',
    'FREQ=DAILY;INTERVAL=100000000',
    'FREQ=WEEKLY;INTERVAL=1000000;BYDAY=MO',
    // Daily rules that hang ical.js inside one step: a weekday filter on a 7-day interval never
    // matches, and an ordinal weekday is not something a daily rule can mean.
    'FREQ=DAILY;INTERVAL=7;BYDAY=WE',
    'FREQ=DAILY;INTERVAL=2;BYDAY=MO,TU,WE,TH,FR',
    'FREQ=DAILY;BYDAY=1MO',
    'FREQ=DAILY;BYDAY=-1FR',
    'FREQ=DAILY;BYDAY=MO,2TU',
    // Only the repeats Apple Calendar writes are walked: anything else is not, whatever it is made of.
    'FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=14',
    'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30',
    'FREQ=YEARLY;BYDAY=2WE',
    'FREQ=YEARLY;BYMONTH=10;BYDAY=2WE,3TH',
    'FREQ=YEARLY;BYMONTH=10;BYDAY=MO,TU',
    'FREQ=YEARLY;BYMONTH=10;BYDAY=MO,TU;BYSETPOS=1,2',
    'FREQ=YEARLY;BYMONTH=10;BYSETPOS=1',
    'FREQ=MONTHLY;BYMONTHDAY=-2',
    'FREQ=MONTHLY;BYMONTHDAY=0,5',
    'FREQ=MONTHLY;BYDAY=MO',
    'FREQ=MONTHLY;BYDAY=-2MO',
    'FREQ=MONTHLY;BYDAY=2TU,3TU',
    'FREQ=MONTHLY;BYDAY=2TU;BYMONTHDAY=3',
    'FREQ=MONTHLY;BYDAY=MO,TU;BYSETPOS=1,2',
    'FREQ=MONTHLY;BYDAY=MO,TU;BYSETPOS=-2',
    'FREQ=MONTHLY;BYDAY=2MO,TU;BYSETPOS=1',
    'FREQ=MONTHLY;BYMONTHDAY=31;BYSETPOS=1',
    'FREQ=WEEKLY;BYDAY=2MO',
    'FREQ=WEEKLY;BYDAY=MO;BYSETPOS=1',
    'FREQ=WEEKLY;BYMONTHDAY=13',
    // A "fifth" every few months or years can be one that never comes (the fifth Monday of a 28-day
    // February every four years): ical.js searched for seconds inside one step.
    'FREQ=MONTHLY;INTERVAL=48;BYDAY=5MO',
    'FREQ=MONTHLY;INTERVAL=96;BYDAY=MO;BYSETPOS=5',
    'FREQ=YEARLY;INTERVAL=2;BYMONTH=2;BYDAY=5MO',
    'FREQ=YEARLY;INTERVAL=998;BYMONTH=2;BYDAY=5TH',
  ];

  it('walks nothing of an event with two rules, and says so', () => {
    const run = budget();
    const { rows, truncated } = read(feed(event('DTSTART:20261014T140000Z\nRRULE:FREQ=DAILY\nRRULE:FREQ=WEEKLY', 'two')), run);
    expect(rows.map((row) => row.starts_at)).toEqual(['2026-10-14T14:00:00.000Z']);
    expect(truncated).toBe(true);
    expect(run.remaining).toBe(MAX_STEPS_PER_RUN);
  });

  it.each([
    'FREQ=DAILY',
    'FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR',
    'FREQ=DAILY;INTERVAL=999;UNTIL=20271231T000000Z',
    'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;WKST=SU',
    'FREQ=MONTHLY;BYMONTHDAY=1,15',
    'FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=40',
    'FREQ=MONTHLY;BYDAY=-1FR',
    'FREQ=MONTHLY;BYDAY=5MO',
    'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=1',
    'FREQ=YEARLY',
    'FREQ=YEARLY;BYMONTH=5,6',
    'FREQ=YEARLY;BYMONTH=5;BYDAY=2SU',
    'FREQ=YEARLY;BYMONTH=10;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1',
    'FREQ=YEARLY;BYMONTH=2;BYDAY=5MO',
    'FREQ=YEARLY;INTERVAL=999',
  ])('walks the iPhone’s %s, and says nothing was cut', (rule) => {
    const run = budget();
    const { rows, truncated } = read(feed(event(`DTSTART:20150105T090000Z
RRULE:${rule}`, 'ok')), run);
    expect(rows, rule).toBeInstanceOf(Array);
    expect(truncated, rule).toBe(false);
    expect(run.remaining, rule).toBeLessThan(MAX_STEPS_PER_RUN);
  }, 5000);

  it('walks a monthly BYSETPOS rule with COUNT only when DTSTART is at most 240 of its steps before the window, and one without COUNT from any year', () => {
    const rule = (start: string, interval: number, end = '') => feed(event(`DTSTART:${start}T090000Z
RRULE:FREQ=MONTHLY;INTERVAL=${interval};BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1${end}`, 'last'));
    // 2007-01 to 2026-09 is 236 months; 2006-01 is 248.
    expect(read(rule('20070115', 1, ';COUNT=400'), budget()).truncated).toBe(false);
    expect(read(rule('20060115', 1, ';COUNT=400'), budget()).truncated).toBe(true);
    expect(read(rule('20060115', 2, ';COUNT=400'), budget()).truncated).toBe(false);
    const run = budget();
    expect(read(rule('19700115', 1, ';COUNT=900'), run).truncated).toBe(true);
    expect(run.remaining).toBe(MAX_STEPS_PER_RUN);
    // Without COUNT it is moved forward to the window, so its age costs nothing.
    expect(read(rule('20060115', 1), budget()).truncated).toBe(false);
    const old = budget();
    expect(read(rule('19700115', 1), old).truncated).toBe(false);
    expect(MAX_STEPS_PER_RUN - old.remaining).toBeLessThan(100);
  });

  it('does not start a series the run has no steps or time left for, even before its first step', () => {
    const weekly = feed(event('DTSTART:20261014T140000Z\nRRULE:FREQ=WEEKLY', 'w'));
    expect(() => read(weekly, budget(0))).toThrow(FeedTooLargeError);
    expect(() => read(weekly, { ...budget(), spentMs: MAX_EXPANSION_MS })).toThrow(FeedTooLargeError);
  });

  it.each(hostile)('does not expand %s: only its DTSTART, said so, and at once', (rule) => {
    const run = budget();
    const began = Date.now();
    const { rows, truncated } = read(feed(event(`DTSTART:20261014T140000Z\nRRULE:${rule}`, 'h')), run);
    expect(Date.now() - began).toBeLessThan(2000);
    expect(rows.map((row) => row.starts_at)).toEqual(['2026-10-14T14:00:00.000Z']);
    expect(truncated).toBe(true);
    expect(run.remaining).toBe(MAX_STEPS_PER_RUN);
  }, 5000);

  it('finishes the whole hostile list, started long ago, in well under a second', () => {
    const began = Date.now();
    const { rows, truncated } = read(feed(...hostile.map((rule, index) => event(`DTSTART:19700101T000000Z\nRRULE:${rule}`, `h${index}`))));
    expect(Date.now() - began).toBeLessThan(1000);
    expect(rows).toEqual([]);
    expect(truncated).toBe(true);
  }, 5000);

  it('still walks the iPhone’s every weekday, daily or weekly, started long ago, and says nothing was cut', () => {
    for (const rule of ['FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR', 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR']) {
      const run = budget();
      const { rows, truncated } = read(feed(event(`DTSTART:20150105T090000Z
RRULE:${rule}`, 'weekdays')), run);
      expect(rows.length, rule).toBeGreaterThan(100);
      expect(truncated, rule).toBe(false);
      expect(MAX_STEPS_PER_RUN - run.remaining, rule).toBeLessThan(500);
    }
  }, 5000);

  it('does not say anything was cut by a rule that starts after the window', () => {
    expect(read(feed(event('DTSTART:20270601T140000Z\nRRULE:FREQ=SECONDLY', 'later'))).truncated).toBe(false);
  });

  it('still reads the RDATEs and the moved occurrences of a series it does not expand', () => {
    const series = event('DTSTART:20000101T000000Z\nRRULE:FREQ=SECONDLY\nRDATE:20261010T150000Z', 'u');
    const moved = event('RECURRENCE-ID:20000101T000500Z\nDTSTART:20261011T150000Z\nDTEND:20261011T160000Z', 'u');
    const { rows, truncated } = read(feed(series, moved));
    expect(rows.map((row) => row.starts_at)).toEqual(['2026-10-10T15:00:00.000Z', '2026-10-11T15:00:00.000Z']);
    expect(truncated).toBe(true);
  });

  it.each([
    'FREQ=WEEKLY;BYDAY=MO,WE',
    'FREQ=MONTHLY;BYDAY=2TU',
    'FREQ=MONTHLY;BYMONTHDAY=-1',
    'FREQ=MONTHLY;BYSETPOS=-1;BYDAY=MO,TU,WE,TH,FR',
    'FREQ=YEARLY;BYMONTH=10;BYDAY=2WE',
    'FREQ=DAILY;INTERVAL=2',
    'FREQ=WEEKLY;INTERVAL=999;BYDAY=MO',
  ])('still expands %s', (rule) => {
    const { rows, truncated } = read(feed(event(`DTSTART:20261001T140000Z\nRRULE:${rule}`, 'ok')));
    expect(rows.length).toBeGreaterThan(0);
    expect(truncated).toBe(false);
  });

  it('does not walk a series whose UNTIL is before the window, and does not say it was cut', () => {
    // Walked, twelve of these are 130,000 steps.
    const ended = Array.from({ length: 12 }, (_, index) => event(`DTSTART:19${80 + index}0101T090000Z\nRRULE:FREQ=DAILY;UNTIL=20100101T000000Z`, `ended${index}`));
    const run = budget();
    const { rows, truncated } = read(feed(...ended, event('DTSTART:20261014T140000Z\nRRULE:FREQ=WEEKLY;COUNT=2', 'live')), run);
    expect(ids(rows)).toEqual(['live', 'live']);
    expect(truncated).toBe(false);
    expect(MAX_STEPS_PER_RUN - run.remaining).toBeLessThan(10);
  });

  it('still reads the last occurrence of a series that ends just inside the window, and the RDATEs of one that ended', () => {
    const straddles = event('DTSTART:20260101T230000Z\nDTEND:20260102T010000Z\nRRULE:FREQ=DAILY;UNTIL=20260831T235959Z', 'straddles');
    const ended = event('DTSTART:20100101T090000Z\nRRULE:FREQ=DAILY;UNTIL=20100201T000000Z\nRDATE:20261010T150000Z', 'ended');
    const rows = read(feed(straddles, ended)).rows;
    expect(rows.map((row) => row.google_event_id)).toEqual(['straddles|2026-08-31T23:00:00.000Z', 'ended|2026-10-10T15:00:00.000Z']);
  });
});

describe('expandFeed: added dates', () => {
  it('reads the first 1,000 RDATEs of an event and ignores the rest, saying so', () => {
    const at = (index: number) => new Date(Date.UTC(2026, 8, 1) + (index + 1) * 3_600_000).toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
    const dates = (count: number) => Array.from({ length: count }, (_, index) => at(index)).join(',');
    const many = read(feed(event(`DTSTART:20260101T000000Z
RDATE:${dates(1500)}`, 'many')));
    expect(many.rows.filter((row) => row.google_event_id.startsWith('many|'))).toHaveLength(1000);
    expect(many.truncated).toBe(true);
    const exact = read(feed(event(`DTSTART:20260101T000000Z
RDATE:${dates(1000)}`, 'exact')));
    expect(exact.rows).toHaveLength(1000);
    expect(exact.truncated).toBe(false);
  });
});

describe('expandFeed: what the caps cut', () => {
  const FIVE_YEARS = Date.parse('2031-09-01T00:00:00Z');
  const wide = (text: string, run: StepBudget = budget()) => expandFeed(text, HOUSEHOLD, WINDOW_START, FIVE_YEARS, run);
  // 1,826 occurrences in five years, so 1,000 each.
  const daily = (uid: string, start = '20260902T000000Z') => event(`DTSTART:${start}\nRRULE:FREQ=DAILY`, uid);
  const count = (rows: { google_event_id: string }[]) => {
    const counts = new Map<string, number>();
    for (const id of ids(rows)) counts.set(id, (counts.get(id) ?? 0) + 1);
    return counts;
  };

  it('caps an endless rule at 1000 occurrences, and a feed at 20000, and says so', () => {
    const one = wide(feed(daily('a')));
    expect(one.rows).toHaveLength(1000);
    const { rows, truncated } = wide(feed(...Array.from({ length: 25 }, (_, index) => daily(`e${index}`))));
    expect(rows).toHaveLength(20000);
    expect(new Set(rows.map((row) => row.google_event_id)).size).toBe(20000);
    expect(truncated).toBe(true);
  });

  it('keeps a single event, an RDATE and a moved occurrence when repeating series fill the feed', () => {
    const late = event('DTSTART:20310301T150000Z', 'lateSingle');
    const rdate = event('DTSTART:20260902T000000Z\nRRULE:FREQ=DAILY;COUNT=1\nRDATE:20310301T160000Z', 'withRdate');
    const moved = event('RECURRENCE-ID:20260902T000000Z\nDTSTART:20310301T170000Z\nDTEND:20310301T180000Z', 'withRdate');
    // 21 series of 1000 are 21,000 rows: the feed has room for 20,000.
    const series = Array.from({ length: 21 }, (_, index) => daily(`d${index}`));
    const { rows, truncated } = wide(feed(...series, late, rdate, moved));
    expect(rows).toHaveLength(MAX_PER_FEED);
    expect(truncated).toBe(true);
    const counts = count(rows);
    expect(counts.get('lateSingle')).toBe(1);
    // The RDATE and the moved occurrence of one UID; the series' own DTSTART was replaced by the move.
    expect(counts.get('withRdate')).toBe(2);
    // The slice took only repeating rows: every row of the series that is left is theirs.
    expect([...counts].filter(([id]) => id.startsWith('d')).reduce((sum, [, n]) => sum + n, 0)).toBe(MAX_PER_FEED - 3);
  });

  it('cuts the same series whatever order the feed is in: newest start first, then by UID', () => {
    // Twenty-one series with the same start: one of them does not fit.
    const series = Array.from({ length: 21 }, (_, index) => daily(`u${String(index).padStart(2, '0')}`));
    const forward = wide(feed(...series));
    const backward = wide(feed(...[...series].reverse()));
    expect(forward.rows).toEqual(backward.rows);
    const counts = count(forward.rows);
    expect(counts.get('u19')).toBe(1000);
    expect(counts.get('u20')).toBeUndefined();
    // And a series that starts later is walked before them all.
    const newer = wide(feed(...series, daily('newest', '20260903T000000Z')));
    expect(count(newer.rows).get('newest')).toBe(1000);
    expect(count(newer.rows).get('u19')).toBeUndefined();
  });

  it('keeps the RDATEs and moved occurrences of a series that a cap cut', () => {
    const cut = event('DTSTART:17000101T000000\nRRULE:FREQ=DAILY\nRRULE:FREQ=DAILY;INTERVAL=7\nRDATE:20261010T150000Z\nRDATE;VALUE=PERIOD:20261012T150000Z/PT1H', 'cut');
    const moved = event('RECURRENCE-ID:17000105T000000\nDTSTART:20261011T150000Z\nDTEND:20261011T160000Z', 'cut');
    const { rows, truncated } = read(feed(cut, moved));
    expect(rows.map((row) => row.starts_at)).toEqual(['2026-10-10T15:00:00.000Z', '2026-10-11T15:00:00.000Z', '2026-10-12T15:00:00.000Z']);
    expect(truncated).toBe(true);
    // Also when the feed has no steps left to give it.
    const spent = read(feed(runaway('a', 1701), runaway('b', 1702), cut, moved));
    expect(spent.rows.map((row) => row.starts_at)).toEqual(['2026-10-10T15:00:00.000Z', '2026-10-11T15:00:00.000Z', '2026-10-12T15:00:00.000Z']);
  });

  it('does not read an RDATE that an EXDATE names, nor one whose occurrence was moved', () => {
    const series = event('DTSTART:20261001T150000Z\nRRULE:FREQ=WEEKLY;COUNT=1\nRDATE:20261010T150000Z\nRDATE:20261011T150000Z\nEXDATE:20261010T150000Z', 'x');
    const moved = event('RECURRENCE-ID:20261011T150000Z\nDTSTART:20261012T150000Z', 'x');
    expect(read(feed(series, moved)).rows.map((row) => row.starts_at)).toEqual(['2026-10-01T15:00:00.000Z', '2026-10-12T15:00:00.000Z']);
  });
});

// Each series is read twice, from DTSTART a step at a time and with the skip over the years before
// the window, and must give the same rows; the skip must cost almost no steps.
const compare = (text: string, windowStartMs = WINDOW_START, windowEndMs = WINDOW_END) => {
  const slow = { ...budget(), noFastForward: true };
  const fast = budget();
  const walked = expandFeed(text, HOUSEHOLD, windowStartMs, windowEndMs, slow);
  const skipped = expandFeed(text, HOUSEHOLD, windowStartMs, windowEndMs, fast);
  return { walked, skipped, slow: MAX_STEPS_PER_RUN - slow.remaining, fast: MAX_STEPS_PER_RUN - fast.remaining };
};
const both = (...components: string[]) => {
  const { walked, skipped, slow, fast } = compare(feed(...components));
  expect(skipped.rows).toEqual(walked.rows);
  expect(skipped.truncated).toBe(walked.truncated);
  return { rows: skipped.rows, slow, fast };
};

describe('expandFeed: daily and weekly series that began long ago', () => {
  it('gives a weekly BYDAY=MO,WE series with a TZID since 2010 the same rows across a DST change, for a few steps', () => {
    // Chicago ends daylight time on 2026-11-01: the 09:00 rows are 14:00Z before and 15:00Z after.
    const { rows, slow, fast } = both(
      event('DTSTART;TZID=America/Chicago:20100106T090000\nDTEND;TZID=America/Chicago:20100106T100000\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE', 'weekly'),
    );
    expect(rows.length).toBeGreaterThan(40);
    expect(rows.map((row) => row.starts_at)).toContain('2026-10-28T14:00:00.000Z');
    expect(rows.map((row) => row.starts_at)).toContain('2026-11-02T15:00:00.000Z');
    expect(slow).toBeGreaterThan(1500);
    expect(fast).toBeLessThan(100);
  });

  it('keeps a daily INTERVAL=3 series on its three-day phase', () => {
    const { rows, slow, fast } = both(event('DTSTART;TZID=Europe/London:20200102T080000\nRRULE:FREQ=DAILY;INTERVAL=3', 'every3'));
    const days = rows.map((row) => Date.parse(row.starts_at) / 86_400_000);
    // Wall time 08:00 in London is 07:00Z in summer and 08:00Z in winter: whole days apart, at 3-day steps of the calendar.
    expect(rows.length).toBeGreaterThan(55);
    for (let i = 1; i < days.length; i += 1) expect(Math.round(days[i]! - days[i - 1]!)).toBe(3);
    // 2020-01-02 plus a whole number of three-day periods: 2026-09-?? is on the phase.
    const first = Date.parse(rows[0]!.starts_at);
    const sinceStart = Math.round((Date.UTC(new Date(first).getUTCFullYear(), new Date(first).getUTCMonth(), new Date(first).getUTCDate()) - Date.UTC(2020, 0, 2)) / 86_400_000);
    expect(sinceStart % 3).toBe(0);
    expect(slow).toBeGreaterThan(700);
    expect(fast).toBeLessThan(100);
  });

  it('reads an all-day weekly series, a floating one and a UTC one the same', () => {
    both(
      event('DTSTART;VALUE=DATE:20120104\nRRULE:FREQ=WEEKLY;INTERVAL=2', 'allday'),
      event('DTSTART:20150305T180000\nDTEND:20150305T200000\nRRULE:FREQ=DAILY;INTERVAL=5', 'floating'),
      event('DTSTART:20190101T230000Z\nDTEND:20190102T010000Z\nRRULE:FREQ=DAILY', 'utc'),
    );
  });

  it('reads a series with an UNTIL inside the window the same, and stops at it', () => {
    const { rows, fast } = both(event('DTSTART;TZID=America/Chicago:20150107T090000\nRRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261104T150000Z', 'until'));
    expect(rows.at(-1)!.starts_at).toBe('2026-11-04T15:00:00.000Z');
    expect(fast).toBeLessThan(100);
  });

  it('still leaves out EXDATEs and moved occurrences, and keeps RDATEs', () => {
    const series = event(
      'DTSTART;TZID=America/Chicago:20100106T090000\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE\nEXDATE;TZID=America/Chicago:20261014T090000\nRDATE;TZID=America/Chicago:20261015T090000',
      'x',
    );
    const moved = event('RECURRENCE-ID;TZID=America/Chicago:20261019T090000\nDTSTART;TZID=America/Chicago:20261020T100000', 'x');
    const { rows } = both(series, moved);
    const starts = rows.map((row) => row.starts_at);
    expect(starts).not.toContain('2026-10-14T14:00:00.000Z');
    expect(starts).not.toContain('2026-10-19T14:00:00.000Z');
    expect(starts).toContain('2026-10-20T15:00:00.000Z');
    expect(starts).toContain('2026-10-15T14:00:00.000Z');
  });

  it('walks a series with COUNT from DTSTART, as it counts from there', () => {
    const { rows, slow, fast } = both(event('DTSTART:20260601T140000Z\nRRULE:FREQ=WEEKLY;COUNT=40', 'counted'));
    expect(rows.length).toBeGreaterThan(20);
    expect(fast).toBe(slow);
  });
});

describe('expandFeed: monthly and yearly series that began long ago', () => {
  it('reads a monthly BYDAY=2TU series since 2000 the same, for a few steps', () => {
    const { rows, slow, fast } = both(event('DTSTART:20000111T090000Z\nRRULE:FREQ=MONTHLY;BYDAY=2TU', 'second-tuesday'));
    expect(rows.map((row) => row.starts_at)).toContain('2026-10-13T09:00:00.000Z');
    expect(slow).toBeGreaterThan(300);
    expect(fast).toBeLessThan(100);
  });

  it('keeps a monthly series on the 31st, the 29th and the last day, and a leap-day yearly series, on their months', () => {
    const { rows, fast } = both(
      event('DTSTART;TZID=America/Chicago:19980131T090000\nRRULE:FREQ=MONTHLY', 'thirty-first'),
      event('DTSTART;TZID=Europe/London:20000229T090000\nRRULE:FREQ=MONTHLY;INTERVAL=5', 'twenty-ninth'),
      event('DTSTART:20000130T090000Z\nRRULE:FREQ=MONTHLY;BYMONTHDAY=-1', 'last'),
      event('DTSTART;VALUE=DATE:19960229\nRRULE:FREQ=YEARLY', 'leap'),
      event('DTSTART:20040229T090000Z\nRRULE:FREQ=YEARLY;INTERVAL=4', 'leap4'),
    );
    expect(rows.map((row) => row.google_event_id.split('|')[0])).toContain('thirty-first');
    expect(fast).toBeLessThan(100);
  });

  it('still leaves out EXDATEs and moved occurrences of a monthly series, and keeps RDATEs', () => {
    const series = event('DTSTART;TZID=America/Chicago:20000111T090000\nRRULE:FREQ=MONTHLY;BYDAY=2TU\nEXDATE;TZID=America/Chicago:20261013T090000\nRDATE;TZID=America/Chicago:20261015T090000', 'x');
    const moved = event('RECURRENCE-ID;TZID=America/Chicago:20261110T090000\nDTSTART;TZID=America/Chicago:20261111T100000', 'x');
    const starts = both(series, moved).rows.map((row) => row.starts_at);
    expect(starts).not.toContain('2026-10-13T14:00:00.000Z');
    expect(starts).not.toContain('2026-11-10T15:00:00.000Z');
    expect(starts).toContain('2026-11-11T16:00:00.000Z');
    expect(starts).toContain('2026-10-15T14:00:00.000Z');
    expect(starts).toContain('2026-12-08T15:00:00.000Z');
  });

  it('reads a series whose fifth Tuesday is missing in the month of the moved start the same: ical.js gives the first day of such a first month', () => {
    // November 2017 has four Tuesdays. Started in that month, on the 6th, ical.js would give the 7th as
    // the "fifth", so the walk starts from a month that ends before the window, not from the 6th.
    const windowStart = Date.parse('2017-11-07T00:00:00Z');
    const windowEnd = Date.parse('2017-12-07T00:00:00Z');
    for (const rule of ['FREQ=MONTHLY;BYDAY=TU;BYSETPOS=5', 'FREQ=MONTHLY;BYDAY=5TU', 'FREQ=YEARLY;BYMONTH=11;BYDAY=TU;BYSETPOS=5', 'FREQ=YEARLY;BYMONTH=11;BYDAY=5TU']) {
      const { walked, skipped, fast } = compare(feed(event(`DTSTART:20000106T003000Z
RRULE:${rule}`, 'missing')), windowStart, windowEnd);
      expect(skipped.rows, rule).toEqual(walked.rows);
      expect(fast, rule).toBeLessThan(100);
    }
  });

  it('leaves to the plain walk a series ical.js gives up on at its start, so that it reads as it always has', () => {
    // The 31st every 5 months from June 2010: five months with no 31st in a row, and ical.js finds nothing.
    const text = feed(event('DTSTART;TZID=America/Chicago:20100607T143000\nRRULE:FREQ=MONTHLY;BYMONTHDAY=31;INTERVAL=5', 'dead'));
    const { walked, skipped } = compare(text, Date.parse('2023-10-01T00:00:00Z'), Date.parse('2023-12-01T00:00:00Z'));
    expect(skipped.rows).toEqual(walked.rows);
  });

  it('refuses a monthly BYSETPOS series it cannot move, as one with COUNT: its first occurrence, said to be cut, and no clock spent', () => {
    // A length that runs past the window leaves no month to move to, so the series is walked from 1900, at 0.7 ms a step.
    const text = feed(event('DTSTART:19000115T090000Z\nDURATION:P73000D\nRRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1', 'long'));
    const run: StepBudget = { remaining: MAX_STEPS_PER_RUN, spentMs: 0 };
    const began = Date.now();
    const { rows, truncated } = expandFeed(text, HOUSEHOLD, WINDOW_START, WINDOW_END, run);
    expect(Date.now() - began).toBeLessThan(400);
    expect(rows).toHaveLength(1);
    expect(truncated).toBe(true);
  });

  it('syncs a feed with two series it cannot move, each shown as its first occurrence', () => {
    const long = (uid: string) => event('DTSTART:19000115T090000Z\nDURATION:P73000D\nRRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1', uid);
    const run: StepBudget = { remaining: MAX_STEPS_PER_RUN, spentMs: 0 };
    const { rows, truncated } = expandFeed(feed(long('a'), long('b')), HOUSEHOLD, WINDOW_START, WINDOW_END, run);
    expect(rows).toHaveLength(2);
    expect(truncated).toBe(true);
  });

  it('stops a monthly BYSETPOS walk after the steps an admitted series needs, and says it was cut, however long each occurrence lasts', () => {
    const rule = 'RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1';
    // Each of these can be moved to a month before the window, but the occurrences overlapping the window are years of them.
    for (const lines of [
      `DTSTART:19000115T090000Z\nDURATION:P36525D\n${rule}`,
      `DTSTART:16000115T090000Z\nDURATION:P109575D\n${rule}`,
      `DTSTART:00010115T090000Z\nDURATION:P800000D\n${rule}`,
    ]) {
      const run = budget();
      const { rows, truncated } = expandFeed(feed(event(lines, 'huge')), HOUSEHOLD, WINDOW_START, WINDOW_END, run);
      expect(truncated, lines).toBe(true);
      expect(rows.length, lines).toBeGreaterThan(0);
      expect(MAX_STEPS_PER_RUN - run.remaining, lines).toBeLessThan(400);
    }
  });

  it('reads in full a monthly BYSETPOS series just inside the age limit, and one of any age that is moved', () => {
    // 2006-09 to the window's 2026-09 is 240 months, the most that is walked from DTSTART.
    const last = (start: string, end: string) => feed(event(`DTSTART:${start}T090000Z\nRRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1${end}`, 'last'));
    for (const text of [last('20060915', ';COUNT=400'), last('20060915', ''), last('19700115', '')]) {
      const walked = expandFeed(text, HOUSEHOLD, WINDOW_START, WINDOW_END, { ...budget(), noFastForward: true });
      const run = budget();
      const { rows, truncated } = expandFeed(text, HOUSEHOLD, WINDOW_START, WINDOW_END, run);
      expect(truncated).toBe(false);
      expect(rows).toHaveLength(6);
      expect(walked.truncated).toBe(false);
      expect(walked.rows).toEqual(rows);
    }
  });

  it('leaves to the plain walk a series whose moved start is the one ical.js gives up on', () => {
    // The 31st every 5 months from January 2000: alive from DTSTART, but dead from a start moved to a month 5 periods before the next 31st.
    const text = feed(event('DTSTART:20000115T090000Z\nRRULE:FREQ=MONTHLY;BYMONTHDAY=31;INTERVAL=5', 'dead-moved'));
    const { walked, skipped } = compare(text, Date.parse('2005-07-02T00:00:00Z'), Date.parse('2007-09-01T00:00:00Z'));
    expect(walked.rows.map((row) => row.starts_at)).toContain('2007-07-31T09:00:00.000Z');
    expect(skipped.rows).toEqual(walked.rows);
  });

  it('walks a series with COUNT from DTSTART, as it counts from there', () => {
    const { slow, fast } = both(event('DTSTART:20200111T090000Z\nRRULE:FREQ=MONTHLY;COUNT=100;BYDAY=2TU', 'counted'));
    expect(fast).toBe(slow);
  });

  // Every series of a fixed seed, read both ways with a window of its own, gives the same rows.
  // `ICS_SWEEP=<series>` and `ICS_SEED=<n>` make a bigger one-off run of the same generator.
  const SERIES = Number(process.env.ICS_SWEEP) || 500;
  it(`gives the same rows with and without the skip, for ${SERIES} generated monthly and yearly series`, () => {
    const r = mulberry(Number(process.env.ICS_SEED) || 127);
    const int = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));
    const pick = <T>(a: T[]) => a[Math.floor(r() * a.length)]!;
    const subset = <T>(a: T[], max: number) => [...new Set(Array.from({ length: int(1, max) }, () => pick(a)))];
    const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
    const p2 = (n: number) => String(n).padStart(2, '0');
    const fmt = (ms: number) => new Date(ms).toISOString().replace(/[-:]|\.\d{3}/g, '');
    const daysIn = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
    const specs = (count: number) =>
      Array.from({ length: count }, (_, k) => {
        const yearly = r() < 0.4;
        const parts = [`FREQ=${yearly ? 'YEARLY' : 'MONTHLY'}`];
        let interval = r() < 0.4 ? 1 : pick([int(1, 12), int(1, 12), 12, 24, 36, 5, 7]);
        const position = () => pick([1, 2, 3, 4, 5, -1]);
        // A monthly BYSETPOS step costs most, and the plain walk takes hundreds of them: it is the rarer shape.
        const shape = r() < 0.06 ? 3 : int(0, 2);
        if (yearly && (shape > 0 || r() < 0.3)) parts.push(`BYMONTH=${subset([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 3).join(',')}`);
        if (!yearly && shape === 1) parts.push(`BYMONTHDAY=${subset([...Array.from({ length: 31 }, (_, d) => d + 1), -1, 29, 30, 31, -1], 4).join(',')}`);
        if (shape === 2 && (!yearly || parts.length > 1)) {
          const n = position();
          if (n === 5) interval = 1;
          parts.push(`BYDAY=${n}${pick(DAYS)}`);
        }
        if (shape === 3 && (!yearly || parts.length > 1)) {
          const n = position();
          if (n === 5) interval = 1;
          parts.push(`BYDAY=${subset(DAYS, 7).join(',')}`, `BYSETPOS=${n}`);
        }
        if (interval !== 1 || r() < 0.2) parts.push(`INTERVAL=${interval}`);
        if (r() < 0.2) parts.push(`WKST=${pick(DAYS)}`);
        if (r() < 0.25) parts.push(`UNTIL=${pick([2020, 2027, 2028, 2035, 2099])}${p2(int(1, 12))}${p2(int(1, 28))}T000000Z`);
        const year = r() < 0.9 ? int(1995, 2026) : pick([1900, 1970, 1999]);
        const leapDay = r() < 0.2 && daysIn(year, 2) === 29;
        const month = leapDay ? 2 : int(1, 12);
        const day = leapDay ? 29 : r() < 0.35 ? pick([29, 30, 31, daysIn(year, month)].filter((d) => d <= daysIn(year, month))) : int(1, 28);
        const date = `${year}${p2(month)}${p2(day)}`;
        const time = `T${p2(int(0, 23))}${pick(['00', '15', '30'])}00`;
        const kind = pick(['utc', 'floating', 'chicago', 'london', 'allday']);
        const start = {
          utc: `DTSTART:${date}${time}Z`,
          floating: `DTSTART:${date}${time}`,
          chicago: `DTSTART;TZID=America/Chicago:${date}${time}`,
          london: `DTSTART;TZID=Europe/London:${date}${time}`,
          allday: `DTSTART;VALUE=DATE:${date}`,
        }[kind]!;
        const length = kind === 'allday' ? pick(['P1D', 'P3D']) : pick(['PT1H', 'PT30M', 'P1D', 'P2DT3H', 'PT0S']);
        return { uid: `s${k}`, lines: `${start}\nDURATION:${length}\nRRULE:${parts.join(';')}` };
      });

    let walkedSteps = 0;
    let skippedSteps = 0;
    let rowsSeen = 0;
    for (let done = 0; done < SERIES; done += 10) {
      const batch = specs(Math.min(10, SERIES - done));
      const windowStart = Date.UTC(int(1996, 2040), int(0, 11), int(1, 28));
      const windowEnd = windowStart + int(30, 200) * DAY_MS;
      // Exclude and move a few of the occurrences the series really has, and add a date.
      const probe = expandFeed(feed(...batch.map((spec) => event(spec.lines, spec.uid))), HOUSEHOLD, windowStart, windowEnd, budget()).rows;
      const components = batch.map((spec) => {
        const own = probe.filter((row) => row.google_event_id.startsWith(`${spec.uid}|`));
        const exdates = own.filter(() => r() < 0.2).map((row) => `EXDATE:${fmt(Date.parse(row.starts_at))}`);
        const rdate = r() < 0.2 ? [`RDATE:${fmt(windowStart + int(0, 20) * DAY_MS)}`] : [];
        return event([spec.lines, ...exdates, ...rdate].join('\n'), spec.uid);
      });
      const moves = probe.filter(() => r() < 0.08).map((row) => {
        const at = Date.parse(row.starts_at);
        return event(`RECURRENCE-ID:${fmt(at)}\nDTSTART:${fmt(at + 5 * 3_600_000)}\nDURATION:PT1H`, row.google_event_id.split('|')[0]!);
      });
      const { walked, skipped, slow, fast } = compare(feed(...components, ...moves), windowStart, windowEnd);
      const label = batch.map((spec) => spec.lines.replace(/\n/g, ' ')).join('\n');
      expect(skipped.rows, label).toEqual(walked.rows);
      expect(skipped.truncated, label).toBe(walked.truncated);
      walkedSteps += slow;
      skippedSteps += fast;
      rowsSeen += skipped.rows.length;
    }
    // Most of the walk is skipped, and there were rows to compare.
    expect(rowsSeen).toBeGreaterThan(SERIES / 4);
    expect(skippedSteps).toBeLessThan(walkedSteps / 4);
  }, Math.max(60_000, SERIES * 100));
});

describe('expandFeed: one bad part is not the feed', () => {
  it('skips an event whose start is not a date and keeps the rest', () => {
    const rows = expand(feed(event('DTSTART:2026XX14T140000Z', 'bad'), event('DTSTART:20261014T140000Z', 'ok')));
    expect(rows.map((row) => row.google_event_id.split('|')[0])).toEqual(['ok']);
  });

  it('skips a VTIMEZONE with no TZID and still reads the zones that have one', () => {
    const noId = 'BEGIN:VTIMEZONE\nBEGIN:STANDARD\nTZOFFSETFROM:+0000\nTZOFFSETTO:+0100\nDTSTART:19700101T000000\nEND:STANDARD\nEND:VTIMEZONE';
    const text = feed(noId, event('DTSTART;TZID=Europe/London:20261019T090000', 'london'));
    expect(starts(text)).toEqual(['2026-10-19T08:00:00.000Z']);
  });
});
