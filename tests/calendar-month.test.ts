import { describe, expect, it } from 'vitest';
import { dayOccurrences, describeMonth, pageWords, type Occurrence } from '../src/lib/calendar-occurrences';
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
    event_id: null, repeat_every: null, repeat_interval: null, repeat_days: null, repeat_until: null,
  };
}

// The pager's words, in the Wall's form and the phone's (the cases of describePage and of the phone's pageWords, on the one function).
describe('pageWords', () => {
  const NOW = new Date('2026-10-06T16:00:00Z');
  const TODAY_AT_NOW = '2026-10-06';
  const wall = (view: 'day' | 'week', anchor: string) => pageWords(pageDays(view, anchor, CHICAGO, NOW), TODAY_AT_NOW, 'wall');
  const phone = (view: 'day' | 'week', anchor: string, today = TODAY_AT_NOW) => pageWords(pageDays(view, anchor, CHICAGO, NOW), today, 'phone');

  it('names a day and a week on the Wall, with the year, and with both years where the range crosses one', () => {
    expect(wall('day', '2026-09-30')).toBe('Wed, Sep 30, 2026');
    expect(wall('week', '2026-09-27')).toBe('Sep 27 to Oct 3, 2026');
    expect(wall('week', '2026-12-27')).toBe('Dec 27, 2026 to Jan 2, 2027');
  });

  it('keeps the Wall\'s year in every year, the current one or not', () => {
    expect(wall('week', '2026-10-04')).toBe('Oct 4 to Oct 10, 2026');
    expect(wall('day', '2027-01-04')).toBe('Mon, Jan 4, 2027');
  });

  it('is a week on the phone as its first and last day, without the year while the week is in this one', () => {
    expect(phone('week', '2026-10-04')).toBe('Oct 4 to Oct 10');
    expect(phone('week', '2026-09-27')).toBe('Sep 27 to Oct 3');
  });

  it('is a day on the phone as its weekday and date', () => {
    expect(phone('day', '2026-09-30')).toBe('Wed, Sep 30');
  });

  it('keeps the year on the phone for a page that is not in the current one, or that crosses into the next', () => {
    expect(phone('week', '2027-01-10')).toContain('2027');
    expect(phone('day', '2027-01-04')).toContain('2027');
    expect(phone('week', '2026-12-27')).toContain('2027');
  });

  it('follows the Household\'s current year on the phone, which is today\'s', () => {
    expect(phone('day', '2027-01-04', '2027-01-03')).toBe('Mon, Jan 4');
    expect(phone('week', '2026-12-27', '2027-01-03')).toContain('2026');
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
