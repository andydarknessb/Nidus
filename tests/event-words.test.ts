import { describe, expect, it } from 'vitest';
import { dateWords, eventTime, formatClock, timeWords, type EventDay, type EventSpan, type TimeForm } from '../supabase/functions/_shared/event-words.ts';
import { addDays, dayStartMs, instantAt } from '../supabase/functions/_shared/zoned-time.ts';

// Event words (spec 0011): the facts of an event's time on a day, and the sentence each place says of them (pill,
// block, line, sheet), plus the date words. Every case that the formatters, the pill, the day block, the month line,
// the details sheet and the push reminder and morning summary tested on their own is here, on the one interface.

const CHICAGO = 'America/Chicago';
const LONDON = 'Europe/London';
const AUCKLAND = 'Pacific/Auckland';
const TOKYO = 'Asia/Tokyo';
const KOLKATA = 'Asia/Kolkata';

const span = (startsAt: string, endsAt: string, isAllDay = false): EventSpan => ({ starts_at: startsAt, ends_at: endsAt, is_all_day: isAllDay });
const dayOf = (date: string, timezone: string): EventDay => ({ timezone, startMs: dayStartMs(date, timezone), endMs: dayStartMs(addDays(date, 1), timezone) });
const say = (event: EventSpan, day: EventDay, form: TimeForm): string => timeWords(eventTime(event, day), form);
// The sheet is not about one day: only the zone.
const sheet = (event: EventSpan, timezone: string): string => say(event, { timezone }, 'sheet');

describe('the pill', () => {
  const today = dayOf('2026-10-01', CHICAGO);

  it('is the start time with minutes, AM or PM, in the Household Timezone', () => {
    expect(say(span('2026-10-01T14:00:00Z', '2026-10-01T14:30:00Z'), today, 'pill')).toBe('9:00 AM');
    expect(say(span('2026-10-02T00:30:00Z', '2026-10-02T02:00:00Z'), today, 'pill')).toBe('7:30 PM');
    expect(say(span('2026-10-01T05:00:00Z', '2026-10-01T05:30:00Z'), today, 'pill')).toBe('12:00 AM');
  });

  it('is "All day" for an all-day event', () => {
    expect(say(span('2026-10-01T05:00:00Z', '2026-10-02T05:00:00Z', true), today, 'pill')).toBe('All day');
  });

  it('is "All day" for a timed event that covers the day from end to end, and "Until" on the last day of one that began earlier', () => {
    const camp = span('2026-09-30T14:00:00Z', '2026-10-03T14:00:00Z');
    expect(say(camp, dayOf('2026-10-01', CHICAGO), 'pill')).toBe('All day');
    expect(say(camp, dayOf('2026-09-30', CHICAGO), 'pill')).toBe('9:00 AM');
    expect(say(camp, dayOf('2026-10-03', CHICAGO), 'pill')).toBe('Until 9:00 AM');
  });

  it('is "All day" for a timed event from one midnight to the next', () => {
    expect(say(span('2026-10-01T05:00:00Z', '2026-10-02T05:00:00Z'), today, 'pill')).toBe('All day');
  });

  it('says it in the Household Timezone, whatever the instant is in UTC', () => {
    // 9:00 AM in Auckland and 7:00 PM in London, the evening before and the morning in UTC.
    expect(say(span('2026-10-02T20:00:00Z', '2026-10-02T20:30:00Z'), dayOf('2026-10-03', AUCKLAND), 'pill')).toBe('9:00 AM');
    expect(say(span('2026-10-02T18:00:00Z', '2026-10-02T19:00:00Z'), dayOf('2026-10-02', LONDON), 'pill')).toBe('7:00 PM');
  });
});

describe('the day block', () => {
  const today = dayOf('2026-10-01', CHICAGO);
  const at = (from: string, to: string) => span(`2026-10-01T${from}:00Z`, `2026-10-01T${to}:00Z`);
  const block = (from: string, to: string) => say(at(from, to), today, 'block');

  it('says a range, with one AM or PM when both ends share it', () => {
    // Chicago is five hours behind UTC on this day.
    expect(block('21:00', '21:45')).toBe('4:00 to 4:45 PM');
    expect(block('14:30', '15:15')).toBe('9:30 to 10:15 AM');
    expect(block('16:30', '17:30')).toBe('11:30 AM to 12:30 PM');
    expect(block('05:00', '06:00')).toBe('12:00 to 1:00 AM');
  });

  it('says it in the Household Timezone, whatever the instant is in UTC', () => {
    expect(say(span('2026-10-02T20:00:00Z', '2026-10-02T20:30:00Z'), dayOf('2026-10-03', AUCKLAND), 'block')).toBe('9:00 to 9:30 AM');
    expect(say(span('2026-10-02T18:00:00Z', '2026-10-02T19:00:00Z'), dayOf('2026-10-02', LONDON), 'block')).toBe('7:00 to 8:00 PM');
  });

  it('says the zones on the night the clocks go back, when the end of an event reads as its start or before it', () => {
    // Sun 2026-11-01 in Chicago: 1:00 AM CDT is 06:00Z and the same 1:00 AM on the clock again, as CST, is 07:00Z.
    const night = dayOf('2026-11-01', CHICAGO);
    const word = (from: string, to: string) => say(span(from, to), night, 'block');
    expect(word('2026-11-01T06:00:00Z', '2026-11-01T07:00:00Z')).toBe('1:00 AM CDT to 1:00 AM CST');
    expect(word('2026-11-01T06:30:00Z', '2026-11-01T07:15:00Z')).toBe('1:30 AM CDT to 1:15 AM CST');
    // Either side of it the words are as they always are.
    expect(word('2026-11-01T05:00:00Z', '2026-11-01T06:30:00Z')).toBe('12:00 to 1:30 AM');
    expect(word('2026-11-01T07:00:00Z', '2026-11-01T08:00:00Z')).toBe('1:00 to 2:00 AM');
  });

  it('says only the start for an event of no length, and for one that goes on past the day', () => {
    expect(block('21:00', '21:00')).toBe('4:00 PM');
    expect(say(span('2026-10-02T03:00:00Z', '2026-10-02T13:00:00Z'), dayOf('2026-10-01', CHICAGO), 'block')).toBe('10:00 PM');
  });

  it('says "Until" for an event that began the day before', () => {
    expect(say(span('2026-10-02T03:00:00Z', '2026-10-02T13:00:00Z'), dayOf('2026-10-02', CHICAGO), 'block')).toBe('Until 8:00 AM');
  });
});

describe('the month line', () => {
  const day = dayOf('2026-09-29', CHICAGO);
  const line = (startsAt: string) => say(span(startsAt, new Date(Date.parse(startsAt) + 30 * 60_000).toISOString()), day, 'line');

  it('drops ":00" on the hour and keeps the minutes otherwise', () => {
    expect(line('2026-09-29T15:00:00Z')).toBe('10 AM');
    expect(line('2026-09-29T14:30:00Z')).toBe('9:30 AM');
    expect(line('2026-09-29T14:05:00Z')).toBe('9:05 AM');
    expect(line('2026-09-29T17:00:00Z')).toBe('12 PM');
    expect(line('2026-09-29T05:00:00Z')).toBe('12 AM');
    expect(line('2026-09-30T04:59:00Z')).toBe('11:59 PM');
  });

  it('reads the time in the Household Timezone, minutes included', () => {
    // 15:30Z is half past ten in Chicago but on the hour in Kolkata (UTC+5:30), and 15:00Z is midnight in Tokyo.
    expect(say(span('2026-09-29T15:30:00Z', '2026-09-29T16:00:00Z'), day, 'line')).toBe('10:30 AM');
    expect(say(span('2026-09-29T15:30:00Z', '2026-09-29T16:00:00Z'), dayOf('2026-09-29', KOLKATA), 'line')).toBe('9 PM');
    expect(say(span('2026-09-29T15:00:00Z', '2026-09-29T16:00:00Z'), dayOf('2026-09-30', TOKYO), 'line')).toBe('12 AM');
  });

  it('says no time for an all-day event, and for a timed one that began on an earlier day', () => {
    expect(say(span('2026-09-29T05:00:00Z', '2026-09-30T05:00:00Z', true), day, 'line')).toBe('');
    expect(say(span('2026-09-28T20:00:00Z', '2026-09-29T15:00:00Z'), day, 'line')).toBe('');
  });
});

describe('the details sheet', () => {
  it('describes a timed event, an overnight one and all-day ones', () => {
    expect(sheet(span('2026-09-30T23:00:00Z', '2026-10-01T00:30:00Z'), CHICAGO)).toBe('Wed, Sep 30, 6:00 PM to 7:30 PM');
    expect(sheet(span('2026-09-30T03:00:00Z', '2026-09-30T13:00:00Z'), CHICAGO)).toBe('Tue, Sep 29, 10:00 PM to Wed, Sep 30, 8:00 AM');
    expect(sheet(span('2026-10-01T05:00:00Z', '2026-10-02T05:00:00Z', true), CHICAGO)).toBe('Thu, Oct 1, all day');
    expect(sheet(span('2026-09-30T05:00:00Z', '2026-10-03T05:00:00Z', true), CHICAGO)).toBe('Wed, Sep 30 to Fri, Oct 2, all day');
  });

  it('says the start alone for an event of no length', () => {
    expect(sheet(span('2026-10-01T21:00:00Z', '2026-10-01T21:00:00Z'), CHICAGO)).toBe('Thu, Oct 1, 4:00 PM');
  });

  it('gives the zones on the night the clocks go back, and says nothing of zones that night or any other when the clock does not repeat', () => {
    // Sun Nov 1, 2026: 2:00 AM CDT is 1:00 AM CST again, so 1:00 AM is on the clock twice and the zones say which.
    expect(sheet(span('2026-11-01T06:00:00Z', '2026-11-01T07:00:00Z'), CHICAGO)).toBe('Sun, Nov 1, 1:00 AM CDT to 1:00 AM CST');
    expect(sheet(span('2026-11-01T06:30:00Z', '2026-11-01T07:15:00Z'), CHICAGO)).toBe('Sun, Nov 1, 1:30 AM CDT to 1:15 AM CST');
    expect(sheet(span('2026-11-01T05:00:00Z', '2026-11-01T06:30:00Z'), CHICAGO)).toBe('Sun, Nov 1, 12:00 AM to 1:30 AM');
    expect(sheet(span('2026-11-01T08:00:00Z', '2026-11-01T09:00:00Z'), CHICAGO)).toBe('Sun, Nov 1, 2:00 AM to 3:00 AM');
  });

  it('says a range, not "all day", for a timed event that covers whole days', () => {
    expect(sheet(span('2026-10-01T05:00:00Z', '2026-10-03T14:00:00Z'), CHICAGO)).toBe('Thu, Oct 1, 12:00 AM to Sat, Oct 3, 9:00 AM');
  });
});

describe('the facts', () => {
  const today = dayOf('2026-10-01', CHICAGO);

  it('say whether the event is all day, goes on from an earlier day, and ends on this one', () => {
    const lunch = eventTime(span('2026-10-01T17:00:00Z', '2026-10-01T18:00:00Z'), today);
    expect(lunch).toMatchObject({ allDay: false, continues: false, endsHere: true, clocksRepeat: false, start: Date.parse('2026-10-01T17:00:00Z'), end: Date.parse('2026-10-01T18:00:00Z') });
    expect(eventTime(span('2026-09-30T20:00:00Z', '2026-10-01T15:00:00Z'), today)).toMatchObject({ allDay: false, continues: true, endsHere: true });
    expect(eventTime(span('2026-10-02T03:00:00Z', '2026-10-02T13:00:00Z'), today)).toMatchObject({ allDay: false, continues: false, endsHere: false });
    expect(eventTime(span('2026-10-01T05:00:00Z', '2026-10-02T05:00:00Z', true), today)).toMatchObject({ allDay: true });
    expect(eventTime(span('2026-09-30T14:00:00Z', '2026-10-03T14:00:00Z'), today)).toMatchObject({ allDay: true, continues: true, endsHere: false });
  });

  it('say that the clocks repeat when an event that starts and ends on one day ends at or before its start on the clock', () => {
    const night = dayOf('2026-11-01', CHICAGO);
    expect(eventTime(span('2026-11-01T06:00:00Z', '2026-11-01T07:00:00Z'), night).clocksRepeat).toBe(true);
    expect(eventTime(span('2026-11-01T06:30:00Z', '2026-11-01T07:15:00Z'), night).clocksRepeat).toBe(true);
    expect(eventTime(span('2026-11-01T05:00:00Z', '2026-11-01T06:30:00Z'), night).clocksRepeat).toBe(false);
    // An event of no length, and one that ends on the next day, do not repeat.
    expect(eventTime(span('2026-11-01T06:00:00Z', '2026-11-01T06:00:00Z'), night).clocksRepeat).toBe(false);
    expect(eventTime(span('2026-11-01T22:00:00Z', '2026-11-02T04:00:00Z'), night).clocksRepeat).toBe(false);
  });
});

// The nights the clocks change, in every form. `back` is an event over the hour the clocks repeat; `forward` one over the
// hour that is skipped (its end reads two hours after its start on the clock, one real hour later). Each zone's words, as
// the family reads them.
describe('the nights the clocks change', () => {
  const nights = [
    {
      zone: CHICAGO,
      back: { date: '2026-11-01', event: span('2026-11-01T06:00:00Z', '2026-11-01T07:00:00Z'), pill: '1:00 AM', block: '1:00 AM CDT to 1:00 AM CST', line: '1 AM', sheet: 'Sun, Nov 1, 1:00 AM CDT to 1:00 AM CST' },
      forward: { date: '2026-03-08', event: span('2026-03-08T07:30:00Z', '2026-03-08T08:30:00Z'), pill: '1:30 AM', block: '1:30 to 3:30 AM', line: '1:30 AM', sheet: 'Sun, Mar 8, 1:30 AM to 3:30 AM' },
    },
    {
      zone: LONDON,
      back: { date: '2026-10-25', event: span('2026-10-25T00:00:00Z', '2026-10-25T01:00:00Z'), pill: '1:00 AM', block: '1:00 AM GMT+1 to 1:00 AM GMT', line: '1 AM', sheet: 'Sun, Oct 25, 1:00 AM GMT+1 to 1:00 AM GMT' },
      forward: { date: '2026-03-29', event: span('2026-03-29T00:30:00Z', '2026-03-29T01:30:00Z'), pill: '12:30 AM', block: '12:30 to 2:30 AM', line: '12:30 AM', sheet: 'Sun, Mar 29, 12:30 AM to 2:30 AM' },
    },
    {
      zone: AUCKLAND,
      back: { date: '2026-04-05', event: span('2026-04-04T13:00:00Z', '2026-04-04T14:00:00Z'), pill: '2:00 AM', block: '2:00 AM GMT+13 to 2:00 AM GMT+12', line: '2 AM', sheet: 'Sun, Apr 5, 2:00 AM GMT+13 to 2:00 AM GMT+12' },
      forward: { date: '2026-09-27', event: span('2026-09-26T13:30:00Z', '2026-09-26T14:30:00Z'), pill: '1:30 AM', block: '1:30 to 3:30 AM', line: '1:30 AM', sheet: 'Sun, Sep 27, 1:30 AM to 3:30 AM' },
    },
  ];

  for (const { zone, back, forward } of nights) {
    for (const [name, night] of [['clocks go back', back], ['clocks go forward', forward]] as const) {
      it(`says the pill, the block, the line and the sheet in ${zone} when the ${name}`, () => {
        const day = dayOf(night.date, zone);
        expect(say(night.event, day, 'pill')).toBe(night.pill);
        expect(say(night.event, day, 'block')).toBe(night.block);
        expect(say(night.event, day, 'line')).toBe(night.line);
        expect(sheet(night.event, zone)).toBe(night.sheet);
      });
    }

    it(`says "Until" and no line time in ${zone} for an event that began the day before a change`, () => {
      // From 10:00 PM the evening before to a quarter past 8 in the morning of the night's own date.
      const start = instantAt(addDays(back.date, -1), '22:00', zone);
      const end = instantAt(back.date, '08:15', zone);
      const event = span(new Date(start).toISOString(), new Date(end).toISOString());
      const day = dayOf(back.date, zone);
      expect(say(event, day, 'pill')).toBe('Until 8:15 AM');
      expect(say(event, day, 'block')).toBe('Until 8:15 AM');
      expect(say(event, day, 'line')).toBe('');
    });

    it(`says "All day" in ${zone} for a timed event that covers the whole day of a change, whatever its length in hours`, () => {
      for (const night of [back, forward]) {
        const day = dayOf(night.date, zone) as { startMs: number; endMs: number; timezone: string };
        const event = span(new Date(day.startMs).toISOString(), new Date(day.endMs).toISOString());
        expect(say(event, day, 'pill')).toBe('All day');
        expect(say(event, day, 'block')).toBe('All day');
        expect(say(event, day, 'line')).toBe('');
      }
    });
  }
});

describe('the clock', () => {
  it('formats clock times in the Household Timezone', () => {
    expect(formatClock(Date.parse('2026-09-29T15:30:00Z'), CHICAGO)).toBe('10:30 AM');
    expect(formatClock(Date.parse('2026-09-29T15:30:00Z'), TOKYO)).toBe('12:30 AM');
  });

  it('writes times of day as "8:30 AM" in the Household Timezone', () => {
    const at = Date.parse('2026-10-06T13:30:00Z');
    expect(formatClock(at, CHICAGO)).toBe('8:30 AM');
    expect(formatClock(at, 'Pacific/Kiritimati')).toBe('3:30 AM');
    expect(formatClock(Date.parse('2026-10-06T17:00:00Z'), CHICAGO)).toBe('12:00 PM');
    expect(formatClock(Date.parse('2026-10-06T05:05:00Z'), CHICAGO)).toBe('12:05 AM');
    expect(formatClock(Date.parse('2026-10-07T00:00:00Z'), CHICAGO)).toBe('7:00 PM');
    // Across the Auckland change the same UTC hour reads an hour apart.
    expect(formatClock(Date.parse('2026-04-04T18:30:00Z'), AUCKLAND)).toBe('6:30 AM');
    expect(formatClock(Date.parse('2026-04-03T18:30:00Z'), AUCKLAND)).toBe('7:30 AM');
  });
});

describe('the date words', () => {
  it('say a day as "Thu, Oct 1" in the Household Timezone', () => {
    const late = Date.parse('2026-10-02T03:00:00Z');
    expect(dateWords.day(late, CHICAGO)).toBe('Thu, Oct 1');
    expect(dateWords.day(late, TOKYO)).toBe('Fri, Oct 2');
  });

  it('say a date that may be a year or more ago with its year', () => {
    expect(dateWords.dayWithYear(Date.parse('2026-10-01T17:00:00Z'), CHICAGO)).toBe('Oct 1, 2026');
  });

  describe('for a screen reader hearing a cell', () => {
    it('give the full date and how many events the day holds', () => {
      expect(dateWords.cell('2026-10-01', 3)).toBe('Thursday, October 1, 3 events');
      expect(dateWords.cell('2027-01-31', 12)).toBe('Sunday, January 31, 12 events');
    });

    it('say "no events" for an empty day and "1 event" for one', () => {
      expect(dateWords.cell('2026-10-02', 0)).toBe('Friday, October 2, no events');
      expect(dateWords.cell('2026-10-03', 1)).toBe('Saturday, October 3, 1 event');
    });

    it('give only the date until the day has been read, so a day not yet known is never called free', () => {
      expect(dateWords.cell('2026-10-01', null)).toBe('Thursday, October 1');
    });
  });
});
