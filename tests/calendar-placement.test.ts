import { describe, expect, it } from 'vitest';
import {
  addDays,
  dayStartMs,
  describeWhen,
  fiveDays,
  formatClock,
  nowFraction,
  place,
  visibleHours,
  type Occurrence,
} from '../src/lib/calendar-occurrences';

const CHICAGO = 'America/Chicago';
const TOKYO = 'Asia/Tokyo';

let counter = 0;
function event(title: string, startsAt: string, endsAt: string, allDay = false): Occurrence {
  counter += 1;
  return {
    source: 'synced',
    id: `event-${counter}`,
    calendar_id: 'calendar-1',
    calendar_name: 'Family',
    title,
    description: null,
    location: null,
    starts_at: startsAt,
    ends_at: endsAt,
    is_all_day: allDay,
    profile_id: null,
    color: null,
  };
}

// Tue 2026-09-29 .. Sat 2026-10-03 in Chicago (CDT, UTC-5), now being Tuesday 10:30 local.
const NOW = new Date('2026-09-29T15:30:00Z');
const days = fiveDays(CHICAGO, NOW);

describe('the five days', () => {
  it('are today and the next four in the Household Timezone', () => {
    expect(days.map((day) => day.date)).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03']);
    expect(days.map((day) => day.weekday)).toEqual([2, 3, 4, 5, 6]);
    expect(days.map((day) => day.isToday)).toEqual([true, false, false, false, false]);
  });

  it('start at Household midnight, not UTC midnight', () => {
    expect(days[0]!.startMs).toBe(Date.parse('2026-09-29T05:00:00Z'));
    expect(days[0]!.endMs).toBe(days[1]!.startMs);
  });

  it('take today from the Household Timezone, not the machine’s', () => {
    // 02:00 UTC on the 30th is still the evening of the 29th in Chicago and already the 30th in Tokyo.
    const instant = new Date('2026-09-30T02:00:00Z');
    expect(fiveDays(CHICAGO, instant)[0]!.date).toBe('2026-09-29');
    expect(fiveDays(TOKYO, instant)[0]!.date).toBe('2026-09-30');
  });

  it('keep the right length across a daylight saving change', () => {
    // US clocks go back on 2026-11-01: that day has 25 hours.
    const fall = fiveDays(CHICAGO, new Date('2026-10-31T17:00:00Z'));
    expect(fall.map((day) => (day.endMs - day.startMs) / 3_600_000)).toEqual([24, 25, 24, 24, 24]);
    expect(dayStartMs('2026-11-02', CHICAGO)).toBe(Date.parse('2026-11-02T06:00:00Z'));
  });

  it('start a day at its first instant when a zone skips midnight', () => {
    // Santiago's clocks jump from 00:00 to 01:00 on 2026-09-06, so that day starts at 01:00 (-03).
    expect(dayStartMs('2026-09-06', 'America/Santiago')).toBe(Date.parse('2026-09-06T04:00:00Z'));
    expect(dayStartMs('2026-09-05', 'America/Santiago')).toBe(Date.parse('2026-09-05T04:00:00Z'));
  });

  it('add whole days to a date across month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('placing timed events', () => {
  it('puts an event in its day’s column at its time', () => {
    const { columns } = place([event('Soccer', '2026-09-30T23:00:00Z', '2026-10-01T00:30:00Z')], days);
    // 18:00 to 19:30 Chicago on Wednesday.
    expect(columns.map((column) => column.length)).toEqual([0, 1, 0, 0, 0]);
    const block = columns[1]![0]!;
    expect(block.top).toBeCloseTo(18 / 24);
    expect(block.bottom).toBeCloseTo(19.5 / 24);
    expect(block).toMatchObject({ lane: 0, lanes: 1, continuesBefore: false, continuesAfter: false });
  });

  it('files an event by Household date when UTC says another day', () => {
    // 03:00 UTC on Oct 1 is 22:00 on Sep 30 in Chicago: Wednesday's column, not Thursday's.
    const { columns } = place([event('Late', '2026-10-01T03:00:00Z', '2026-10-01T04:00:00Z')], days);
    expect(columns.map((column) => column.length)).toEqual([0, 1, 0, 0, 0]);
  });

  it('splits an event that crosses midnight across both columns', () => {
    const { columns } = place([event('Sleepover', '2026-09-30T03:00:00Z', '2026-09-30T13:00:00Z')], days);
    // 22:00 Tuesday to 08:00 Wednesday Chicago.
    expect(columns.map((column) => column.length)).toEqual([1, 1, 0, 0, 0]);
    expect(columns[0]![0]).toMatchObject({ continuesBefore: false, continuesAfter: true, bottom: 1 });
    expect(columns[0]![0]!.top).toBeCloseTo(22 / 24);
    expect(columns[1]![0]).toMatchObject({ continuesBefore: true, continuesAfter: false, top: 0 });
    expect(columns[1]![0]!.bottom).toBeCloseTo(8 / 24);
  });

  it('ignores events outside the five days, and one ending exactly at the first midnight', () => {
    const { columns, allDay } = place(
      [
        event('Yesterday', '2026-09-28T15:00:00Z', '2026-09-28T16:00:00Z'),
        event('Ends at midnight', '2026-09-29T03:00:00Z', '2026-09-29T05:00:00Z'),
        event('Next week', '2026-10-09T15:00:00Z', '2026-10-09T16:00:00Z'),
      ],
      days,
    );
    expect(columns.flat()).toEqual([]);
    expect(allDay).toEqual([]);
  });

  it('gives an event of no length something to tap', () => {
    const { columns } = place([event('Reminder', '2026-09-29T15:00:00Z', '2026-09-29T15:00:00Z')], days);
    const block = columns[0]![0]!;
    expect(block.bottom - block.top).toBeCloseTo(15 / (24 * 60));
  });

  it('puts overlapping events side by side and lets later ones use the full width again', () => {
    const { columns } = place(
      [
        event('A', '2026-09-29T15:00:00Z', '2026-09-29T17:00:00Z'),
        event('B', '2026-09-29T16:00:00Z', '2026-09-29T18:00:00Z'),
        event('C', '2026-09-29T16:30:00Z', '2026-09-29T17:30:00Z'),
        event('Alone', '2026-09-29T20:00:00Z', '2026-09-29T21:00:00Z'),
      ],
      days,
    );
    const byTitle = Object.fromEntries(columns[0]!.map((block) => [block.occurrence.title, block]));
    expect(byTitle['A']).toMatchObject({ lane: 0, lanes: 3 });
    expect(byTitle['B']).toMatchObject({ lane: 1, lanes: 3 });
    expect(byTitle['C']).toMatchObject({ lane: 2, lanes: 3 });
    expect(byTitle['Alone']).toMatchObject({ lane: 0, lanes: 1 });
  });

  it('does not treat back-to-back events as overlapping', () => {
    const { columns } = place(
      [event('First', '2026-09-29T15:00:00Z', '2026-09-29T16:00:00Z'), event('Second', '2026-09-29T16:00:00Z', '2026-09-29T17:00:00Z')],
      days,
    );
    expect(columns[0]!.map((block) => [block.lane, block.lanes])).toEqual([
      [0, 1],
      [0, 1],
    ]);
  });
});

describe('room for a 48 px target', () => {
  const back2back = [event('First', '2026-09-29T14:00:00Z', '2026-09-29T14:30:00Z'), event('Second', '2026-09-29T14:30:00Z', '2026-09-29T15:00:00Z')];

  it('puts short back-to-back events side by side when they are drawn taller than they last', () => {
    // 82 minutes is what 48 px takes on a grid of about 35 px per hour.
    const { columns } = place(back2back, days, 82);
    expect(columns[0]!.map((block) => [block.lane, block.lanes])).toEqual([
      [0, 2],
      [1, 2],
    ]);
  });

  it('leaves events that are far enough apart in one lane', () => {
    const { columns } = place([back2back[0]!, event('Later', '2026-09-29T17:00:00Z', '2026-09-29T17:30:00Z')], days, 82);
    expect(columns[0]!.map((block) => [block.lane, block.lanes])).toEqual([
      [0, 1],
      [0, 1],
    ]);
  });

  it('does not change where an event is drawn, only its lane', () => {
    const { columns } = place(back2back, days, 82);
    expect(columns[0]![0]!.bottom - columns[0]![0]!.top).toBeCloseTo(0.5 / 24);
  });
});

describe('placing all-day events', () => {
  it('puts a one-day event in its column', () => {
    const { allDay, columns } = place([event('Holiday', '2026-10-01T05:00:00Z', '2026-10-02T05:00:00Z', true)], days);
    expect(allDay).toHaveLength(1);
    expect(allDay[0]).toMatchObject({ startColumn: 2, span: 1, continuesBefore: false, continuesAfter: false, row: 0 });
    expect(columns.flat()).toEqual([]);
  });

  it('spans every column of a multi-day event', () => {
    const { allDay } = place([event('Camping', '2026-09-30T05:00:00Z', '2026-10-03T05:00:00Z', true)], days);
    // Wed Sep 30 through Fri Oct 2.
    expect(allDay[0]).toMatchObject({ startColumn: 1, span: 3, continuesBefore: false, continuesAfter: false });
  });

  it('is clipped to the five days and says which side it continues past', () => {
    const { allDay } = place(
      [
        event('Long trip', '2026-09-26T05:00:00Z', '2026-10-10T05:00:00Z', true),
        event('Arriving', '2026-09-27T05:00:00Z', '2026-09-30T05:00:00Z', true),
        event('Leaving', '2026-10-02T05:00:00Z', '2026-10-08T05:00:00Z', true),
      ],
      days,
    );
    const byTitle = Object.fromEntries(allDay.map((bar) => [bar.occurrence.title, bar]));
    expect(byTitle['Long trip']).toMatchObject({ startColumn: 0, span: 5, continuesBefore: true, continuesAfter: true });
    expect(byTitle['Arriving']).toMatchObject({ startColumn: 0, span: 1, continuesBefore: true, continuesAfter: false });
    expect(byTitle['Leaving']).toMatchObject({ startColumn: 3, span: 2, continuesBefore: false, continuesAfter: true });
  });

  it('stacks events that share a column into rows and reuses a row when they do not', () => {
    const { allDay } = place(
      [
        event('Trip', '2026-09-29T05:00:00Z', '2026-10-01T05:00:00Z', true),
        event('Birthday', '2026-09-30T05:00:00Z', '2026-10-01T05:00:00Z', true),
        event('Holiday', '2026-10-02T05:00:00Z', '2026-10-03T05:00:00Z', true),
      ],
      days,
    );
    const rows = Object.fromEntries(allDay.map((bar) => [bar.occurrence.title, bar.row]));
    expect(rows).toEqual({ Trip: 0, Birthday: 1, Holiday: 0 });
  });

  it('follows Household dates: a Tokyo all-day event is in Tokyo’s column', () => {
    const tokyo = fiveDays(TOKYO, new Date('2026-09-29T15:30:00Z'));
    // Household today is Wed Sep 30 in Tokyo; the all-day event is Thu Oct 1 Tokyo time.
    const { allDay } = place([event('Thursday', '2026-09-30T15:00:00Z', '2026-10-01T15:00:00Z', true)], tokyo);
    expect(tokyo[0]!.date).toBe('2026-09-30');
    expect(allDay[0]).toMatchObject({ startColumn: 1, span: 1 });
  });
});

describe('the grid', () => {
  it('shows 6 am to 10 pm when everything fits', () => {
    const { columns } = place([event('Soccer', '2026-09-30T23:00:00Z', '2026-10-01T00:30:00Z')], days);
    expect(visibleHours(columns, null)).toEqual({ startHour: 6, endHour: 22 });
  });

  it('widens to take in an early or late event', () => {
    const { columns } = place(
      [event('Flight', '2026-09-30T09:30:00Z', '2026-09-30T11:00:00Z'), event('Late show', '2026-10-01T03:00:00Z', '2026-10-01T04:30:00Z')],
      days,
    );
    // 04:30 to 06:00 Wednesday, and 22:00 to 23:30 Wednesday.
    expect(visibleHours(columns, null)).toEqual({ startHour: 4, endHour: 24 });
  });

  it('widens to take in the current time', () => {
    expect(visibleHours([], 0.1)).toEqual({ startHour: 2, endHour: 22 });
  });

  it('places the current-time line only inside today', () => {
    expect(nowFraction(days[0]!, NOW)).toBeCloseTo(10.5 / 24);
    expect(nowFraction(days[1]!, NOW)).toBeNull();
  });
});

describe('words', () => {
  it('formats clock times in the Household Timezone', () => {
    expect(formatClock(Date.parse('2026-09-29T15:30:00Z'), CHICAGO)).toBe('10:30 AM');
    expect(formatClock(Date.parse('2026-09-29T15:30:00Z'), TOKYO)).toBe('12:30 AM');
  });

  it('describes a timed event, an overnight one and all-day ones', () => {
    expect(describeWhen(event('x', '2026-09-30T23:00:00Z', '2026-10-01T00:30:00Z'), CHICAGO)).toBe('Wed, Sep 30, 6:00 PM to 7:30 PM');
    expect(describeWhen(event('x', '2026-09-30T03:00:00Z', '2026-09-30T13:00:00Z'), CHICAGO)).toBe('Tue, Sep 29, 10:00 PM to Wed, Sep 30, 8:00 AM');
    expect(describeWhen(event('x', '2026-10-01T05:00:00Z', '2026-10-02T05:00:00Z', true), CHICAGO)).toBe('Thu, Oct 1, all day');
    expect(describeWhen(event('x', '2026-09-30T05:00:00Z', '2026-10-03T05:00:00Z', true), CHICAGO)).toBe('Wed, Sep 30 to Fri, Oct 2, all day');
  });
});
