import { describe, expect, it } from 'vitest';
import { dayOccurrences, describeMonth, describePage, type Occurrence } from '../src/lib/calendar-occurrences';
import { monthWeeks, pageDays } from '../src/lib/paged-view';

const CHICAGO = 'America/Chicago';

const TODAY = '2026-10-01';

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
    profile_ids: [],
  };
}

describe('describePage', () => {
  const now = new Date('2026-09-30T15:00:00Z');

  it('names a day and a week, with the year where the range crosses one', () => {
    expect(describePage(pageDays('day', '2026-09-30', CHICAGO, now))).toBe('Wed, Sep 30, 2026');
    expect(describePage(pageDays('week', '2026-09-27', CHICAGO, now))).toBe('Sep 27 to Oct 3, 2026');
    expect(describePage(pageDays('week', '2026-12-27', CHICAGO, now))).toBe('Dec 27, 2026 to Jan 2, 2027');
  });
});

describe('describeMonth', () => {
  it('names the month and year of its page', () => {
    expect(describeMonth('2026-10-01')).toBe('October 2026');
    expect(describeMonth('2026-12-01')).toBe('December 2026');
    expect(describeMonth('2027-01-01')).toBe('January 2027');
  });

  it('names the month whichever date of it is given, and is not moved by the machine zone', () => {
    expect(describeMonth('2026-10-31')).toBe('October 2026');
    // Midnight UTC on the 1st is still the month before in any zone behind UTC, so this reads the calendar date, not an instant.
    expect(describeMonth('2026-03-01')).toBe('March 2026');
  });
});

describe('the occurrences of a day', () => {
  // Sun Sep 27 to Sat Oct 3, 2026: Wednesday is Sep 30, Thursday Oct 1 and Friday Oct 2.
  const week = monthWeeks('2026-10-01', CHICAGO, TODAY)[0]!;
  const titlesOn = (occurrences: Occurrence[]) => week.map((day) => dayOccurrences(occurrences, day).map((occurrence) => occurrence.title));
  const thursday = week[4]!;

  it('puts all-day events first, then timed ones by start, then by title', () => {
    const occurrences = [
      event('Dentist', '2026-10-01T16:00:00Z', '2026-10-01T17:00:00Z'),
      event('Brunch', '2026-10-01T16:00:00Z', '2026-10-01T17:00:00Z'),
      event('Standup', '2026-10-01T14:00:00Z', '2026-10-01T14:30:00Z'),
      // A sleepover from Wednesday 22:00 started before any all-day event of Thursday did: all-day still comes first.
      event('Sleepover', '2026-10-01T03:00:00Z', '2026-10-01T13:00:00Z'),
      event('Zoo', '2026-10-01T05:00:00Z', '2026-10-02T05:00:00Z', true),
      event('Birthday', '2026-10-01T05:00:00Z', '2026-10-02T05:00:00Z', true),
      // Camping began on Tuesday, so of the all-day events it is first by start.
      event('Camping', '2026-09-29T05:00:00Z', '2026-10-02T05:00:00Z', true),
    ];
    expect(dayOccurrences(occurrences, thursday).map((occurrence) => occurrence.title)).toEqual([
      'Camping',
      'Birthday',
      'Zoo',
      'Sleepover',
      'Standup',
      'Brunch',
      'Dentist',
    ]);
  });

  it('does not reorder or change what it is given', () => {
    const occurrences = [event('B', '2026-10-01T16:00:00Z', '2026-10-01T17:00:00Z'), event('A', '2026-10-01T14:00:00Z', '2026-10-01T15:00:00Z')];
    const before = [...occurrences];
    dayOccurrences(occurrences, thursday);
    expect(occurrences).toEqual(before);
  });

  it('is empty on a day with nothing', () => {
    expect(dayOccurrences([event('Elsewhere', '2026-10-09T14:00:00Z', '2026-10-09T15:00:00Z')], thursday)).toEqual([]);
    expect(dayOccurrences([], thursday)).toEqual([]);
  });

  it('puts a multi-day event on every day it covers', () => {
    // All-day Tue Sep 29 to Thu Oct 1: the end is the midnight after its last day.
    const camping = event('Camping', '2026-09-29T05:00:00Z', '2026-10-02T05:00:00Z', true);
    expect(titlesOn([camping])).toEqual([[], [], ['Camping'], ['Camping'], ['Camping'], [], []]);
    // Timed, 22:00 Wednesday to 08:00 Thursday.
    const sleepover = event('Sleepover', '2026-10-01T03:00:00Z', '2026-10-01T13:00:00Z');
    expect(titlesOn([sleepover])).toEqual([[], [], [], ['Sleepover'], ['Sleepover'], [], []]);
  });

  it('keeps an event that ends exactly at midnight out of the next day', () => {
    // 20:00 Wednesday to 00:00 Thursday.
    const late = event('Late', '2026-10-01T01:00:00Z', '2026-10-01T05:00:00Z');
    expect(titlesOn([late])).toEqual([[], [], [], ['Late'], [], [], []]);
  });

  it('keeps an all-day event to its own day: it ends at the next midnight', () => {
    const holiday = event('Holiday', '2026-10-01T05:00:00Z', '2026-10-02T05:00:00Z', true);
    expect(titlesOn([holiday])).toEqual([[], [], [], [], ['Holiday'], [], []]);
  });

  it('puts an event that starts exactly at midnight on that day and not the one before', () => {
    const early = event('Early', '2026-10-01T05:00:00Z', '2026-10-01T06:00:00Z');
    expect(titlesOn([early])).toEqual([[], [], [], [], ['Early'], [], []]);
  });

  it('puts an event of no length on the day it starts, midnight included', () => {
    const noon = event('Reminder', '2026-10-01T17:00:00Z', '2026-10-01T17:00:00Z');
    const midnight = event('Midnight reminder', '2026-10-02T05:00:00Z', '2026-10-02T05:00:00Z');
    expect(titlesOn([noon, midnight])).toEqual([[], [], [], [], ['Reminder'], ['Midnight reminder'], []]);
  });

  it('keeps a short event in a day\'s last quarter hour on that day only', () => {
    // Tuesday Sep 29, 23:50 to 23:55 CDT. The week view gives such an event 15 minutes so there is something
    // to tap, which would carry it past midnight; the month lists an event by what it really lasts.
    const lastMinutes = event('Last call', '2026-09-30T04:50:00Z', '2026-09-30T04:55:00Z');
    expect(titlesOn([lastMinutes])).toEqual([[], [], ['Last call'], [], [], [], []]);
  });

  it('keeps an event of no length at 23:59 on its own day', () => {
    const reminder = event('Reminder', '2026-09-30T04:59:00Z', '2026-09-30T04:59:00Z');
    expect(titlesOn([reminder])).toEqual([[], [], ['Reminder'], [], [], [], []]);
  });

  it('still puts a short event that really crosses midnight on both days', () => {
    // 23:55 Tuesday to 00:05 Wednesday.
    const across = event('Across', '2026-09-30T04:55:00Z', '2026-09-30T05:05:00Z');
    expect(titlesOn([across])).toEqual([[], [], ['Across'], ['Across'], [], [], []]);
  });

  it('follows the day lengths of a daylight saving change', () => {
    // Sunday 2026-11-01 is 25 hours long and 2026-03-08 is 23: an all-day event still fills its own day and no more.
    const fall = monthWeeks('2026-11-01', CHICAGO, TODAY)[0]!;
    const holiday = event('Holiday', '2026-11-01T05:00:00Z', '2026-11-02T06:00:00Z', true);
    // 23:30 CST Sunday to 00:00 Monday CST.
    const night = event('Night', '2026-11-02T05:30:00Z', '2026-11-02T06:00:00Z');
    expect(fall.map((day) => dayOccurrences([holiday, night], day).map((occurrence) => occurrence.title))).toEqual([['Holiday', 'Night'], [], [], [], [], [], []]);
    const spring = monthWeeks('2026-03-01', CHICAGO, TODAY)[1]!;
    const springHoliday = event('Holiday', '2026-03-08T06:00:00Z', '2026-03-09T05:00:00Z', true);
    expect(spring.map((day) => dayOccurrences([springHoliday], day).length)).toEqual([1, 0, 0, 0, 0, 0, 0]);
  });
});
