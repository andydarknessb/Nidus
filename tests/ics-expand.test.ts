import { describe, expect, it } from 'vitest';
import { expandFeed, FeedParseError, FeedTooLargeError, MAX_STEPS_PER_RUN } from '../supabase/functions/_shared/ics-expand';

// Pure: feed text in, rows out. The fixtures are iCloud-style feeds (CRLF line endings,
// VTIMEZONE blocks, X-WR-CALNAME, folded lines), not objects built to suit the code. Run once
// with TZ set to an odd zone (TZ=Pacific/Chatham) to see that the machine's zone never matters.

const HOUSEHOLD = 'Pacific/Auckland';
const WINDOW_START = Date.parse('2026-09-01T00:00:00Z');
const WINDOW_END = Date.parse('2027-03-01T00:00:00Z');

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

const expand = (text: string, timezone = HOUSEHOLD) => expandFeed(text, timezone, WINDOW_START, WINDOW_END);
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

  it('caps an endless rule at 1000 occurrences, and a feed at 20000', () => {
    const endless = (uid: string) => event('DTSTART:20260902T000000Z\nRRULE:FREQ=HOURLY', uid);
    expect(expand(feed(endless('a')))).toHaveLength(1000);
    const rows = expand(feed(...Array.from({ length: 25 }, (_, index) => endless(`e${index}`))));
    expect(rows).toHaveLength(20000);
    expect(new Set(rows.map((row) => row.google_event_id)).size).toBe(20000);
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

  it('gives up on a rule that started in 1970 and fires every second, without throwing', () => {
    quickly(() => expect(expand(feed(event('DTSTART:19700101T000000\nRRULE:FREQ=SECONDLY')))).toEqual([]));
  });

  it('gives up on a daily rule from the year 1700, without throwing', () => {
    quickly(() => expect(expand(feed(event('DTSTART;VALUE=DATE:17000101\nRRULE:FREQ=DAILY')))).toEqual([]));
  });

  it('stops the feed once its step budget is spent, keeping what came before', () => {
    const runaway = (uid: string) => event('DTSTART:19700101T000000\nRRULE:FREQ=SECONDLY', uid);
    const rows = expand(feed(event('DTSTART:20261014T140000Z', 'first'), runaway('a'), runaway('b'), runaway('c'), event('DTSTART:20261015T140000Z\nRRULE:FREQ=DAILY;COUNT=2', 'last')));
    expect(rows.map((row) => row.google_event_id.split('|')[0])).toEqual(['first']);
  });
});

describe('expandFeed: the step budget of a run', () => {
  const runaway = (uid: string) => event('DTSTART:19700101T000000\nRRULE:FREQ=SECONDLY', uid);
  const expandIn = (text: string, run: { remaining: number }) => expandFeed(text, HOUSEHOLD, WINDOW_START, WINDOW_END, run);

  it('lets one feed take at most half of the run, keeping the events it reached', () => {
    const run = { remaining: MAX_STEPS_PER_RUN };
    const rows = expandIn(feed(event('DTSTART:20261014T140000Z', 'first'), runaway('a'), runaway('b')), run);
    expect(rows.map((row) => row.google_event_id.split('|')[0])).toEqual(['first']);
    expect(run.remaining).toBe(MAX_STEPS_PER_RUN / 2);
  });

  it('shares what is left between feeds: two bad feeds spend the run, a third is not read', () => {
    const run = { remaining: MAX_STEPS_PER_RUN };
    expect(expandIn(feed(runaway('a')), run)).toEqual([]);
    expect(expandIn(feed(runaway('b')), run)).toEqual([]);
    expect(run.remaining).toBe(0);
    expect(() => expandIn(feed(event('DTSTART:20261014T140000Z', 'plain')), run)).toThrow(FeedTooLargeError);
  });

  it('throws, rather than return half a feed, when the run ran out in the middle of one', () => {
    const run = { remaining: 30_000 };
    expect(() => expandIn(feed(event('DTSTART:20261014T140000Z', 'first'), runaway('a')), run)).toThrow(FeedTooLargeError);
    expect(run.remaining).toBe(0);
  });

  it('throws when the run ran out exactly as one event ended, with a later event unread', () => {
    const few = event('DTSTART:20261014T140000Z\nRRULE:FREQ=DAILY;COUNT=5', 'few');
    const measured = { remaining: 1000 };
    expandIn(feed(few), measured);
    const run = { remaining: 1000 - measured.remaining };
    expect(() => expandIn(feed(few, event('DTSTART:20261014T140000Z', 'later')), run)).toThrow(FeedTooLargeError);
  });

  it('reads a feed that fits whole, and spends only what it walked', () => {
    const run = { remaining: 1000 };
    expect(expandIn(feed(event('DTSTART:20261014T140000Z\nRRULE:FREQ=DAILY;COUNT=5', 'few')), run)).toHaveLength(5);
    expect(run.remaining).toBeGreaterThan(900);
    expect(run.remaining).toBeLessThan(1000);
  });
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
