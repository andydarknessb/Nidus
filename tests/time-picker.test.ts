import { describe, expect, it } from 'vitest';
import type { Occurrence } from '../src/lib/calendar-occurrences';
import { blankEventForm, eventFormFromOccurrence, eventFormToInput, type EventForm } from '../src/lib/native-events';
import { drumOf, minutesOf, parseTypedTime, setEnd, setStart, timeOf, timeOfDrum } from '../src/lib/time-picker';

// The time sheet's core (docs/specs/0013, The time sheet): the typed forms, the drums, and what Starts and Ends do to each other. All of
// it is pure, so none of it needs the local stack or a DOM. The cases of the steppers this replaced are here as cases of setStart and
// setEnd, under the names they had.

const CHICAGO = 'America/Chicago';
const form = (startTime: string, endTime: string): EventForm => ({ ...blankEventForm('2026-10-02'), startTime, endTime });
const times = (value: EventForm | { problem: string }) => (value as EventForm & { problem?: string }).problem ?? [(value as EventForm).startTime, (value as EventForm).endTime];
// setEnd's answer when it is a form.
const ended = (value: ReturnType<typeof setEnd>): EventForm => {
  if ('problem' in value) throw new Error(value.problem);
  return value;
};

describe('a time typed', () => {
  it('reads every plain way of typing one', () => {
    for (const text of ['4:30 pm', '4:30pm', '4:30 PM', '4.30 pm', '4 30 pm', '430 pm', '430pm', '16:30', '1630', ' 16:30 ', '4:30p']) {
      expect(parseTypedTime(text, 'AM'), text).toBe('16:30');
      expect(parseTypedTime(text, 'PM'), text).toBe('16:30');
    }
    expect(parseTypedTime('4pm', 'AM')).toBe('16:00');
    expect(parseTypedTime('4 pm', 'AM')).toBe('16:00');
    expect(parseTypedTime('4am', 'PM')).toBe('04:00');
    expect(parseTypedTime('11:05 PM', 'AM')).toBe('23:05');
  });

  it('gives an hour with no AM or PM the field’s meridiem', () => {
    for (const text of ['4', '4:30', '430', '4.30', '4 30']) {
      expect(parseTypedTime(text, 'AM'), text).toBe(text === '4' ? '04:00' : '04:30');
      expect(parseTypedTime(text, 'PM'), text).toBe(text === '4' ? '16:00' : '16:30');
    }
    expect(parseTypedTime('11', 'PM')).toBe('23:00');
    expect(parseTypedTime('1', 'AM')).toBe('01:00');
  });

  it('keeps 13 to 23 as they are, whatever the field says', () => {
    expect(parseTypedTime('13', 'AM')).toBe('13:00');
    expect(parseTypedTime('16:30', 'AM')).toBe('16:30');
    expect(parseTypedTime('23:59', 'AM')).toBe('23:59');
    expect(parseTypedTime('0:30', 'PM')).toBe('00:30');
    expect(parseTypedTime('0030', 'PM')).toBe('00:30');
  });

  it('takes 12 with no AM or PM as noon, whatever the field says', () => {
    expect(parseTypedTime('12', 'AM')).toBe('12:00');
    expect(parseTypedTime('12', 'PM')).toBe('12:00');
    expect(parseTypedTime('12:30', 'AM')).toBe('12:30');
    expect(parseTypedTime('1230', 'AM')).toBe('12:30');
  });

  it('takes 12 with AM or PM as midnight and noon', () => {
    expect(parseTypedTime('12am', 'PM')).toBe('00:00');
    expect(parseTypedTime('12 AM', 'PM')).toBe('00:00');
    expect(parseTypedTime('12:30 am', 'PM')).toBe('00:30');
    expect(parseTypedTime('12pm', 'AM')).toBe('12:00');
    expect(parseTypedTime('12:45 pm', 'AM')).toBe('12:45');
  });

  it('refuses what is not a time', () => {
    for (const text of ['', ' ', '25', '24', '4:60', '430:00', 'abc', '13 pm', '0 pm', '4:5', '4:30 xm', '4::30', '12345', '4 3', '-4', '4:30 pm pm']) {
      expect(parseTypedTime(text, 'AM'), text).toBeNull();
      expect(parseTypedTime(text, 'PM'), text).toBeNull();
    }
  });
});

describe('the drums', () => {
  it('show the hour 1 to 12, the minute in fives and AM or PM', () => {
    expect(drumOf('00:00')).toEqual({ hour: 12, minute: 0, meridiem: 'AM' });
    expect(drumOf('09:05')).toEqual({ hour: 9, minute: 5, meridiem: 'AM' });
    expect(drumOf('12:00')).toEqual({ hour: 12, minute: 0, meridiem: 'PM' });
    expect(drumOf('16:30')).toEqual({ hour: 4, minute: 30, meridiem: 'PM' });
    expect(drumOf('23:55')).toEqual({ hour: 11, minute: 55, meridiem: 'PM' });
  });

  it('show the nearest minute at or below one off the fives', () => {
    expect(drumOf('16:37')).toMatchObject({ hour: 4, minute: 35 });
    expect(drumOf('14:04')).toMatchObject({ hour: 2, minute: 0 });
    expect(drumOf('23:59')).toMatchObject({ hour: 11, minute: 55 });
  });

  it('give a time back, for every time they can show', () => {
    for (let minutes = 0; minutes < 24 * 60; minutes += 1) {
      const time = timeOf(minutes);
      const drum = drumOf(time);
      expect(drum.hour).toBeGreaterThanOrEqual(1);
      expect(drum.hour).toBeLessThanOrEqual(12);
      expect(drum.minute % 5).toBe(0);
      expect(timeOfDrum(drum)).toBe(timeOf(minutes - (minutes % 5)));
    }
  });

  it('make 12 AM midnight and 12 PM noon', () => {
    expect(timeOfDrum({ hour: 12, minute: 0, meridiem: 'AM' })).toBe('00:00');
    expect(timeOfDrum({ hour: 12, minute: 30, meridiem: 'PM' })).toBe('12:30');
    expect(timeOfDrum({ hour: 11, minute: 55, meridiem: 'PM' })).toBe('23:55');
  });
});

describe('Starts and Ends', () => {
  it('moves Starts, and Ends by the same amount', () => {
    expect(times(setStart(form('14:00', '15:30'), '14:15'))).toEqual(['14:15', '15:45']);
    expect(times(setStart(form('14:00', '15:30'), '13:45'))).toEqual(['13:45', '15:15']);
    // Any time, not a quarter hour: 9:00 AM to 4:37 PM keeps the hour.
    expect(times(setStart(form('09:00', '10:00'), '16:37'))).toEqual(['16:37', '17:37']);
  });

  it('moves Ends on its own', () => {
    expect(times(setEnd(form('14:00', '15:00'), '15:15'))).toEqual(['14:00', '15:15']);
    expect(times(setEnd(form('14:00', '15:00'), '14:45'))).toEqual(['14:00', '14:45']);
  });

  it('keeps Ends after Starts', () => {
    expect(times(setEnd(form('14:00', '14:30'), '14:15'))).toEqual(['14:00', '14:15']);
    expect(times(setEnd(form('14:00', '14:30'), '14:01'))).toEqual(['14:00', '14:01']);
    // At Starts, or before it, the end is refused, in words, and the form is not changed.
    expect(setEnd(form('14:00', '14:15'), '14:00')).toEqual({ problem: 'The event must end after it starts.' });
    expect(setEnd(form('14:00', '14:15'), '13:45')).toEqual({ problem: 'The event must end after it starts.' });
    expect(setEnd(form('00:00', '01:00'), '00:00')).toEqual({ problem: 'The event must end after it starts.' });
  });

  it('stops Starts at 11:58 PM, and Ends goes with it as far as 11:59 PM', () => {
    let current = form('22:30', '23:30');
    const seen: unknown[] = [];
    for (const time of ['22:45', '23:00', '23:15', '23:30', '23:45', '23:59']) {
      current = setStart(current, time);
      seen.push(times(current));
    }
    expect(seen).toEqual([
      ['22:45', '23:45'],
      ['23:00', '23:59'],
      ['23:15', '23:59'],
      ['23:30', '23:59'],
      ['23:45', '23:59'],
      ['23:58', '23:59'],
    ]);
  });

  it('stops Ends at 11:59 PM', () => {
    expect(ended(setEnd(form('14:00', '23:30'), '23:59')).endTime).toBe('23:59');
    expect(ended(setEnd(form('14:00', '23:59'), '23:59')).endTime).toBe('23:59');
  });

  it('stops Starts at midnight, and Ends comes back with it', () => {
    expect(times(setStart(form('00:15', '01:15'), '00:00'))).toEqual(['00:00', '01:00']);
    // An Ends that was held at 11:59 PM comes back by the length it has, not to where it was.
    expect(times(setStart(form('23:30', '23:59'), '23:15'))).toEqual(['23:15', '23:44']);
  });

  it('keeps an existing event’s times off the quarter hour until a time is set', () => {
    const occurrence = {
      title: 'Plumber',
      description: null,
      location: null,
      starts_at: '2026-10-02T19:10:00Z',
      ends_at: '2026-10-02T20:20:00Z',
      is_all_day: false,
      profile_ids: [],
    } as unknown as Occurrence;
    const opened = eventFormFromOccurrence(occurrence, CHICAGO);
    expect(times(opened)).toEqual(['14:10', '15:20']);
    // The one that is set lands where it was set, and Ends follows Starts by the same amount.
    expect(times(setStart(opened, '14:15'))).toEqual(['14:15', '15:25']);
    expect(times(setStart(opened, '14:00'))).toEqual(['14:00', '15:10']);
    expect(times(setEnd(opened, '15:30'))).toEqual(['14:10', '15:30']);
    expect(times(setEnd(opened, '15:15'))).toEqual(['14:10', '15:15']);
  });

  it('lands inside the limits when an existing time is past them', () => {
    // Starts at 11:59 PM leaves no room for an end after it: it is held at 11:58 PM, with Ends at 11:59 PM.
    const late = form('23:40', '23:50');
    expect(times(setStart(late, '23:59'))).toEqual(['23:58', '23:59']);
    expect(times(setStart(late, '23:30'))).toEqual(['23:30', '23:40']);
    // Ends at 11:50 PM can come back, and cannot go before Starts at 11:40 PM.
    expect(ended(setEnd(form('14:00', '23:50'), '23:59')).endTime).toBe('23:59');
    expect(ended(setEnd(form('14:00', '23:50'), '23:45')).endTime).toBe('23:45');
    expect(setEnd(late, '23:40')).toEqual({ problem: 'The event must end after it starts.' });
  });

  it('lets the time sheet mend an existing event that is shorter than 15 minutes', () => {
    expect(times(setEnd(form('14:00', '14:00'), '14:15'))).toEqual(['14:00', '14:15']);
    expect(times(setStart(form('14:00', '14:10'), '14:15'))).toEqual(['14:15', '14:25']);
    expect(times(setEnd(form('14:10', '14:20'), '14:30'))).toEqual(['14:10', '14:30']);
    // An event with no length (or less) takes an hour with its new start.
    expect(times(setStart(form('14:00', '14:00'), '14:15'))).toEqual(['14:15', '15:15']);
    expect(times(setStart(form('14:00', '13:00'), '14:15'))).toEqual(['14:15', '15:15']);
  });

  it('can never hold an end at or before its start, or a time past the limits', () => {
    const broken: string[] = [];
    const check = (label: string, next: EventForm | { problem: string }) => {
      if ('problem' in next) return;
      const [start, end] = [minutesOf(next.startTime), minutesOf(next.endTime)];
      if (start === null || end === null || start < 0 || end > 23 * 60 + 59 || end <= start) broken.push(`${label}: ${next.startTime} to ${next.endTime}`);
    };
    // Every start time, from forms of several lengths, set to a spread of times.
    for (let start = 0; start < 24 * 60; start += 1) {
      for (const length of [1, 15, 60, 600]) {
        const end = Math.min(start + length, 23 * 60 + 59);
        if (end <= start) continue;
        const before = form(timeOf(start), timeOf(end));
        for (let at = 0; at < 24 * 60; at += 13) {
          check(`${before.startTime} to ${before.endTime}, start ${timeOf(at)}`, setStart(before, timeOf(at)));
          check(`${before.startTime} to ${before.endTime}, end ${timeOf(at)}`, setEnd(before, timeOf(at)));
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it('only ever makes a form eventFormToInput takes, whatever is set', () => {
    // A fixed walk of times (a small generator, so the test is the same every run) from a new event.
    let seed = 7;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31);
    let current = { ...blankEventForm('2026-10-02'), title: 'Plumber' };
    for (let press = 0; press < 400; press += 1) {
      const time = timeOf(next() % (24 * 60));
      const result = next() % 2 === 0 ? setStart(current, time) : setEnd(current, time);
      if (!('problem' in result)) current = result;
      expect(eventFormToInput(current, CHICAGO)).not.toHaveProperty('problem');
    }
  });

  it('refuses a form that is not times, and changes nothing', () => {
    const odd = form('soon', '10:00');
    expect(setStart(odd, '09:00')).toBe(odd);
    expect(setEnd(odd, '09:00')).toBe(odd);
    const fine = form('09:00', '10:00');
    expect(setStart(fine, 'noon')).toBe(fine);
    expect(setEnd(fine, 'noon')).toBe(fine);
  });
});
