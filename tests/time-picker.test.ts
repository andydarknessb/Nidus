import { describe, expect, it } from 'vitest';
import { drumOf, parseTypedTime, timeOf, timeOfDrum } from '../src/lib/time-picker';

// The time sheet's core (docs/specs/0013, The time sheet): the typed forms and the drums. All of it is pure, so none of it needs the local
// stack or a DOM. What Starts and Ends do to each other (setStart and setEnd) is the event draft's now: tests/event-draft.test.ts.

describe('a time typed', () => {
  it('reads every plain way of typing one', () => {
    for (const text of ['4:30 pm', '4:30pm', '4:30 PM', '4.30 pm', '4 30 pm', '430 pm', '430pm', '16:30', '1630', ' 16:30 ', '4:30p', '4:30 p.m.', '4:30 P.M.', '4.30 p.m', '4 : 30 pm', '4  30  pm']) {
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
