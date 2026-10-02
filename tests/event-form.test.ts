import { describe, expect, it } from 'vitest';
import type { Occurrence } from '../src/lib/calendar-occurrences';
import {
  addedSentence,
  blankEventForm,
  clockWords,
  dayChoices,
  eventFormFromOccurrence,
  eventFormToInput,
  isUntouched,
  stepEnd,
  stepStart,
  type EventForm,
  type NativeEventInput,
} from '../src/lib/native-events';

// The Add event sheet's rules (spec 0003, Add event sheet): the steppers, the days, a form nothing has touched and the line
// the status line says after a save. All of it is pure, so none of it needs the local stack; the tests that write
// through it are in native-events.test.ts. Every date goes through the Household Timezone, never the machine's.

const CHICAGO = 'America/Chicago';
const form = (startTime: string, endTime: string): EventForm => ({ ...blankEventForm('2026-10-02'), startTime, endTime });
const times = (value: EventForm) => [value.startTime, value.endTime];

describe('Starts and Ends', () => {
  it('moves Starts a quarter hour, and Ends by the same amount', () => {
    expect(times(stepStart(form('14:00', '15:30'), 1))).toEqual(['14:15', '15:45']);
    expect(times(stepStart(form('14:00', '15:30'), -1))).toEqual(['13:45', '15:15']);
  });

  it('moves Ends a quarter hour on its own', () => {
    expect(times(stepEnd(form('14:00', '15:00'), 1))).toEqual(['14:00', '15:15']);
    expect(times(stepEnd(form('14:00', '15:00'), -1))).toEqual(['14:00', '14:45']);
  });

  it('keeps Ends at least 15 minutes after Starts', () => {
    expect(times(stepEnd(form('14:00', '14:30'), -1))).toEqual(['14:00', '14:15']);
    // At 15 minutes there is nothing earlier to step to.
    const least = form('14:00', '14:15');
    expect(stepEnd(least, -1)).toBe(least);
  });

  it('stops Starts at 11:30 PM, and Ends goes with it as far as 11:45 PM', () => {
    let current = form('22:30', '23:30');
    const seen: string[][] = [];
    for (let press = 0; press < 6; press += 1) {
      current = stepStart(current, 1);
      seen.push(times(current));
    }
    expect(seen).toEqual([
      ['22:45', '23:45'],
      ['23:00', '23:45'],
      ['23:15', '23:45'],
      ['23:30', '23:45'],
      ['23:30', '23:45'],
      ['23:30', '23:45'],
    ]);
  });

  it('stops Ends at 11:45 PM', () => {
    const late = stepEnd(form('14:00', '23:30'), 1);
    expect(late.endTime).toBe('23:45');
    expect(stepEnd(late, 1)).toBe(late);
  });

  it('stops Starts at midnight, and Ends comes back with it', () => {
    const early = stepStart(form('00:15', '01:15'), -1);
    expect(times(early)).toEqual(['00:00', '01:00']);
    expect(stepStart(early, -1)).toBe(early);
    // An Ends that was held at 11:45 PM comes back by the same amount as Starts, not to where it was.
    expect(times(stepStart(form('23:30', '23:45'), -1))).toEqual(['23:15', '23:30']);
  });

  it('keeps an existing event’s times off the quarter hour until a stepper moves one', () => {
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
    // The one a stepper moves lands on the next quarter hour that way, and Ends follows Starts by the same amount.
    expect(times(stepStart(opened, 1))).toEqual(['14:15', '15:25']);
    expect(times(stepStart(opened, -1))).toEqual(['14:00', '15:10']);
    expect(times(stepEnd(opened, 1))).toEqual(['14:10', '15:30']);
    expect(times(stepEnd(opened, -1))).toEqual(['14:10', '15:15']);
  });

  it('lands inside the limits when an existing time is past them', () => {
    // Starts at 11:40 PM can only come back, to 11:30 PM, and Ends is held 15 minutes after it.
    const late = form('23:40', '23:50');
    expect(stepStart(late, 1)).toBe(late);
    expect(times(stepStart(late, -1))).toEqual(['23:30', '23:45']);
    // Ends at 11:50 PM can only come back, to 11:45 PM; with Starts at 11:40 PM there is no room for it to move.
    expect(stepEnd(form('14:00', '23:50'), 1).endTime).toBe('23:50');
    expect(stepEnd(form('14:00', '23:50'), -1).endTime).toBe('23:45');
    expect(stepEnd(late, -1)).toBe(late);
  });

  it('lets the steppers mend an existing event that is shorter than 15 minutes', () => {
    expect(times(stepEnd(form('14:00', '14:00'), 1))).toEqual(['14:00', '14:15']);
    expect(times(stepStart(form('14:00', '14:10'), 1))).toEqual(['14:15', '14:30']);
    expect(times(stepEnd(form('14:10', '14:20'), 1))).toEqual(['14:10', '14:30']);
  });

  it('can never hold an end at or before its start, or a time past the limits', () => {
    const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
    const broken: string[] = [];
    // Every pair of quarter hours the form can hold, and every press from each.
    for (let start = 0; start <= 23 * 60 + 30; start += 15) {
      for (let end = start + 15; end <= 23 * 60 + 45; end += 15) {
        for (const direction of [1, -1] as const) {
          for (const next of [stepStart(form(clock(start), clock(end)), direction), stepEnd(form(clock(start), clock(end)), direction)]) {
            const [nextStart, nextEnd] = [minutes(next.startTime), minutes(next.endTime)];
            if (nextStart < 0 || nextStart > 23 * 60 + 30 || nextEnd > 23 * 60 + 45 || nextEnd - nextStart < 15) {
              broken.push(`${clock(start)} to ${clock(end)}, ${direction}: ${next.startTime} to ${next.endTime}`);
            }
          }
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it('only ever makes a form eventFormToInput takes, whatever is pressed', () => {
    // A fixed walk of presses (a small generator, so the test is the same every run) from a new event.
    let seed = 7;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31);
    let current = { ...blankEventForm('2026-10-02'), title: 'Plumber' };
    for (let press = 0; press < 400; press += 1) {
      const pick = next() % 4;
      current = (pick < 2 ? stepStart : stepEnd)(current, pick % 2 === 0 ? 1 : -1);
      expect(eventFormToInput(current, CHICAGO)).not.toHaveProperty('problem');
    }
  });

  it('leaves the end-after-start check in place for what the steppers cannot see', () => {
    // On the day clocks go forward in Chicago, 2:30 AM does not exist and moves on to 3:30 AM, past an end of 3:15 AM.
    const gap = { ...blankEventForm('2027-03-14'), title: 'Early', startTime: '02:30', endTime: '03:15' };
    expect(eventFormToInput(gap, CHICAGO)).toEqual({ problem: 'The event must end after it starts.' });
  });

  it('says its times as the family reads them', () => {
    expect(clockWords('00:00')).toBe('12:00 AM');
    expect(clockWords('09:05')).toBe('9:05 AM');
    expect(clockWords('12:00')).toBe('12:00 PM');
    expect(clockWords('14:00')).toBe('2:00 PM');
    expect(clockWords('23:45')).toBe('11:45 PM');
  });
});

describe('the days to pick from', () => {
  it('offers today and the next two days', () => {
    expect(dayChoices('2026-10-01')).toEqual([
      { date: '2026-10-01', label: 'Today' },
      { date: '2026-10-02', label: 'Fri 2' },
      { date: '2026-10-03', label: 'Sat 3' },
    ]);
  });

  it('carries over the end of a month and a year', () => {
    expect(dayChoices('2026-10-30')).toEqual([
      { date: '2026-10-30', label: 'Today' },
      { date: '2026-10-31', label: 'Sat 31' },
      { date: '2026-11-01', label: 'Sun 1' },
    ]);
    expect(dayChoices('2026-12-31').map((choice) => choice.date)).toEqual(['2026-12-31', '2027-01-01', '2027-01-02']);
  });
});

describe('a form nothing has touched', () => {
  const opened = { ...blankEventForm('2026-10-02'), profileIds: ['ava', 'ben'] };

  it('is untouched as it opened', () => {
    expect(isUntouched(opened, opened)).toBe(true);
    expect(isUntouched({ ...opened }, opened)).toBe(true);
  });

  it('is touched by anything typed, even a space', () => {
    expect(isUntouched({ ...opened, title: 'P' }, opened)).toBe(false);
    expect(isUntouched({ ...opened, title: ' ' }, opened)).toBe(false);
    expect(isUntouched({ ...opened, location: 'Home' }, opened)).toBe(false);
    expect(isUntouched({ ...opened, notes: 'Key under the pot' }, opened)).toBe(false);
  });

  it('is touched by anything changed', () => {
    expect(isUntouched({ ...opened, date: '2026-10-03' }, opened)).toBe(false);
    expect(isUntouched({ ...opened, allDay: true }, opened)).toBe(false);
    expect(isUntouched(stepStart(opened, 1), opened)).toBe(false);
    expect(isUntouched(stepEnd(opened, 1), opened)).toBe(false);
    expect(isUntouched({ ...opened, profileIds: ['ava'] }, opened)).toBe(false);
    expect(isUntouched({ ...opened, profileIds: [] }, opened)).toBe(false);
    expect(isUntouched({ ...opened, profileIds: ['ava', 'ben', 'cy'] }, opened)).toBe(false);
  });

  it('is untouched again once what was changed is put back', () => {
    expect(isUntouched({ ...opened, title: '' }, opened)).toBe(true);
    expect(isUntouched(stepStart(stepStart(opened, 1), -1), opened)).toBe(true);
    expect(isUntouched({ ...opened, allDay: false }, opened)).toBe(true);
    // The same people in the order they were pressed in are the same people.
    expect(isUntouched({ ...opened, profileIds: ['ben', 'ava'] }, opened)).toBe(true);
  });

  it('is untouched as an existing event opened, too', () => {
    const occurrence = { title: 'Trip', description: null, location: null, starts_at: '2026-10-02T05:00:00Z', ends_at: '2026-10-03T05:00:00Z', is_all_day: true, profile_ids: [] } as unknown as Occurrence;
    const existing = eventFormFromOccurrence(occurrence, CHICAGO);
    expect(isUntouched(eventFormFromOccurrence(occurrence, CHICAGO), existing)).toBe(true);
    expect(isUntouched({ ...existing, title: 'Trips' }, existing)).toBe(false);
  });
});

describe('what the status line says after an event is added', () => {
  const input = (value: EventForm) => eventFormToInput({ ...value, title: ' Plumber coming ' }, CHICAGO) as NativeEventInput;

  it('names the event, the day and the time, in the Household Timezone', () => {
    const plumber = input(form('14:00', '15:00'));
    expect(addedSentence(plumber, CHICAGO)).toBe('Added Plumber coming: Fri, Oct 2, 2:00 PM');
    // The same instant is another day and time on a clock elsewhere: nothing here reads the machine's zone.
    expect(addedSentence(plumber, 'Pacific/Auckland')).toBe('Added Plumber coming: Sat, Oct 3, 8:00 AM');
  });

  it('says all day for an all-day event, on the Household day it starts', () => {
    expect(addedSentence(input({ ...form('14:00', '15:00'), allDay: true }), CHICAGO)).toBe('Added Plumber coming: Fri, Oct 2, all day');
    // The day clocks go back: a 25 hour day still starts on its own date.
    expect(addedSentence(input({ ...blankEventForm('2026-11-01'), allDay: true }), CHICAGO)).toBe('Added Plumber coming: Sun, Nov 1, all day');
  });

  it('keeps midnight and noon straight', () => {
    expect(addedSentence(input(form('00:00', '00:15')), CHICAGO)).toBe('Added Plumber coming: Fri, Oct 2, 12:00 AM');
    expect(addedSentence(input(form('12:00', '12:15')), CHICAGO)).toBe('Added Plumber coming: Fri, Oct 2, 12:00 PM');
  });
});
