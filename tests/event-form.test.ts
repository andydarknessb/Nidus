import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { NativeEventSheet as NativeEventSheetType } from '../src/components/NativeEventSheet';
import type { Occurrence } from '../src/lib/calendar-occurrences';
import {
  addedSentence,
  blankEventForm,
  timeInputWords,
  dayChoices,
  eventFormFromOccurrence,
  eventFormToInput,
  isUntouched,
  moveToDay,
  openingTimes,
  savedSentence,
  type EventForm,
  type NativeEventInput,
} from '../src/lib/native-events';
import { setEnd, setStart } from '../src/lib/time-picker';

// The Add event sheet's rules (spec 0003, Add event sheet): Starts and Ends, the days, a form nothing has touched and the line
// the status line says after a save. All of it is pure, so none of it needs the local stack; the tests that write
// through it are in native-events.test.ts. Every date goes through the Household Timezone, never the machine's.

const CHICAGO = 'America/Chicago';
const form = (startTime: string, endTime: string): EventForm => ({ ...blankEventForm('2026-10-02'), startTime, endTime });
const times = (value: EventForm) => [value.startTime, value.endTime];

describe('Starts and Ends', () => {
  // (The rules for setting a time are in time-picker.test.ts.) The sheet opened by a tap cannot be drawn to markup; what is drawn is
  // the two buttons that open it.
  let NativeEventSheet: typeof NativeEventSheetType;
  beforeAll(async () => {
    // It imports the Supabase client, which is built on import and not used to draw: a placeholder URL and key are enough.
    vi.stubEnv('VITE_SUPABASE_URL', process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', process.env['VITE_SUPABASE_ANON_KEY'] ?? 'placeholder-anon-key');
    ({ NativeEventSheet } = await import('../src/components/NativeEventSheet'));
  });
  const props = { timezone: CHICAGO, profiles: [], onSaved: () => undefined, onClose: () => undefined };
  const drawNew = () => renderToStaticMarkup(createElement(NativeEventSheet, { ...props, date: '2026-10-02' }));
  const drawEdit = (changes: Partial<Occurrence> = {}) =>
    renderToStaticMarkup(
      createElement(NativeEventSheet, {
        ...props,
        occurrence: { title: 'Plumber', description: null, location: null, starts_at: '2026-10-02T19:10:00Z', ends_at: '2026-10-02T20:20:00Z', is_all_day: false, profile_ids: [], ...changes } as unknown as Occurrence,
      }),
    );
  const buttonNamed = (html: string, label: string) => /<button[^>]*>/.exec(html.slice(html.indexOf(`aria-label="${label}"`) - 80))?.[0] ?? '';

  it('are two buttons, each named for its time: "Starts, 9:00 AM" and "Ends, 10:00 AM"', () => {
    const html = drawNew();
    for (const label of ['Starts, 9:00 AM', 'Ends, 10:00 AM']) {
      expect(html).toContain(`aria-label="${label}"`);
      const button = buttonNamed(html, label);
      expect(button).toContain('type="button"');
      expect(button).toMatch(/class="[^"]*\bh-15\b/);
      expect(button).toMatch(/class="[^"]*\bw-full\b/);
      expect(button).toMatch(/class="[^"]*\brounded-2xl\b[^"]*\bbg-muted\b[^"]*\bpx-4\b/);
    }
    // Their captions are over them, and the buttons are named for the whole.
    expect(html).toContain('>Starts</span>');
    expect(html).toContain('>Ends</span>');
  });

  it('show the time as the steppers did: the clock in Young Serif at 24, the AM or PM small', () => {
    const html = drawEdit();
    expect(html).toContain('aria-label="Starts, 2:10 PM"');
    expect(html).toContain('aria-label="Ends, 3:20 PM"');
    expect(html).toContain('<span class="font-display text-2xl">2:10</span><span class="text-base font-medium">PM</span>');
    expect(html).toContain('<span class="font-display text-2xl">3:20</span><span class="text-base font-medium">PM</span>');
  });

  it('have no stepper left: no minus, no plus, no live region', () => {
    for (const html of [drawNew(), drawEdit()]) {
      expect(html).not.toMatch(/aria-label="(?:Start|End) (?:earlier|later)"/);
      expect(html).not.toContain('<output');
      expect(html).not.toContain('lucide-minus');
      expect(html).not.toContain('lucide-plus');
    }
  });

  it('draw no time sheet until one is tapped', () => {
    const html = drawNew();
    expect(html.match(/role="dialog"/g)).toHaveLength(1);
    expect(html).not.toContain('Type a time like 4:30 PM');
  });

  it('are hidden by All day, and keep their room on the Wall', () => {
    const html = drawEdit({ is_all_day: true });
    expect(html).toContain('hidden min-[960px]:invisible min-[960px]:grid');
    expect(drawNew()).not.toContain('min-[960px]:invisible');
  });

  it('says its times as the family reads them', () => {
    expect(timeInputWords('00:00')).toBe('12:00 AM');
    expect(timeInputWords('09:05')).toBe('9:05 AM');
    expect(timeInputWords('12:00')).toBe('12:00 PM');
    expect(timeInputWords('14:00')).toBe('2:00 PM');
    expect(timeInputWords('23:45')).toBe('11:45 PM');
  });
});

describe('the times a new event opens with', () => {
  const AUCKLAND = 'Pacific/Auckland';
  const HONOLULU = 'Pacific/Honolulu';
  const KIRITIMATI = 'Pacific/Kiritimati';
  const KOLKATA = 'Asia/Kolkata';
  const KATHMANDU = 'Asia/Kathmandu';
  const LONDON = 'Europe/London';
  const HAVANA = 'America/Havana';
  const LORD_HOWE = 'Australia/Lord_Howe';
  // The times for a new event on `date` with the clock at `now`, an instant written with its own offset so that nothing
  // here depends on the machine's zone.
  const opening = (date: string, timezone: string, now: string) => {
    const { startTime, endTime } = openingTimes(date, timezone, new Date(now));
    // What it gives is always something the form takes.
    expect(eventFormToInput({ ...blankEventForm(date), title: 'Plumber', startTime, endTime }, timezone)).not.toHaveProperty('problem');
    return [startTime, endTime];
  };

  it('is the next whole hour, for an hour, when the date is today', () => {
    expect(opening('2026-10-01', CHICAGO, '2026-10-01T19:21:00-05:00')).toEqual(['20:00', '21:00']);
    // On the hour it is the next one; a millisecond short of it, it is that one.
    expect(opening('2026-10-01', CHICAGO, '2026-10-01T19:00:00.000-05:00')).toEqual(['20:00', '21:00']);
    expect(opening('2026-10-01', CHICAGO, '2026-10-01T19:59:59.999-05:00')).toEqual(['20:00', '21:00']);
  });

  it('is 9:00 AM to 10:00 AM on any other day', () => {
    for (const date of ['2026-09-30', '2026-10-02', '2026-12-25', '']) {
      expect(openingTimes(date, CHICAGO, new Date('2026-10-01T19:21:00-05:00'))).toEqual({ startTime: '09:00', endTime: '10:00' });
    }
  });

  it('stops Starts at 11:00 PM and Ends at 11:45 PM', () => {
    expect(opening('2026-10-01', CHICAGO, '2026-10-01T22:15:00-05:00')).toEqual(['23:00', '23:45']);
    // From 11:00 PM on it is 11:00 PM to 11:45 PM, even with the hour already half gone.
    for (const now of ['2026-10-01T23:00:00-05:00', '2026-10-01T23:30:00-05:00', '2026-10-01T23:59:59.999-05:00']) {
      expect(opening('2026-10-01', CHICAGO, now)).toEqual(['23:00', '23:45']);
    }
  });

  it('reads the day and the hour on the Household clock, not UTC and not the machine', () => {
    // 12:10 AM on Oct 2 in Auckland is still Oct 1 in UTC.
    expect(opening('2026-10-02', AUCKLAND, '2026-10-02T00:10:00+13:00')).toEqual(['01:00', '02:00']);
    expect(opening('2026-10-01', AUCKLAND, '2026-10-02T00:10:00+13:00')).toEqual(['09:00', '10:00']);
    expect(opening('2026-10-01', KIRITIMATI, '2026-10-01T00:10:00+14:00')).toEqual(['01:00', '02:00']);
    expect(opening('2026-10-02', AUCKLAND, '2026-10-02T23:30:00+13:00')).toEqual(['23:00', '23:45']);
    // 11:30 PM on Oct 1 in Honolulu is already Oct 2 in UTC.
    expect(opening('2026-10-01', HONOLULU, '2026-10-01T23:30:00-10:00')).toEqual(['23:00', '23:45']);
    // Zones that are not whole hours from UTC: the next whole hour on their own clock.
    expect(opening('2026-10-01', KOLKATA, '2026-10-01T19:21:00+05:30')).toEqual(['20:00', '21:00']);
    expect(opening('2026-10-01', KATHMANDU, '2026-10-01T19:21:00+05:45')).toEqual(['20:00', '21:00']);
  });

  it('gives the same on whatever zone the machine is in', () => {
    const machine = process.env.TZ;
    // Minutes west of UTC for each, so the test knows the machine really did move.
    const behind: Record<string, number> = { UTC: 0, 'Asia/Kolkata': -330, 'Pacific/Kiritimati': -840, 'Pacific/Pago_Pago': 660 };
    try {
      for (const [zone, offset] of Object.entries(behind)) {
        process.env.TZ = zone;
        expect(new Date('2026-10-01T12:00:00Z').getTimezoneOffset()).toBe(offset);
        expect(opening('2026-10-02', AUCKLAND, '2026-10-02T00:10:00+13:00')).toEqual(['01:00', '02:00']);
        expect(opening('2026-10-01', CHICAGO, '2026-10-01T19:21:00-05:00')).toEqual(['20:00', '21:00']);
        expect(opening('2027-03-14', CHICAGO, '2027-03-14T01:30:00-06:00')).toEqual(['03:00', '04:00']);
      }
    } finally {
      if (machine === undefined) delete process.env.TZ;
      else process.env.TZ = machine;
    }
  });

  it('never lands on a time the clocks skip', () => {
    // Chicago, 2027-03-14: at 2:00 AM the clocks go to 3:00 AM. The next whole hour after 1:30 AM is 3:00 AM.
    expect(opening('2027-03-14', CHICAGO, '2027-03-14T01:30:00-06:00')).toEqual(['03:00', '04:00']);
    // The same night in a zone east of UTC (Auckland, 2026-09-27).
    expect(opening('2026-09-27', AUCKLAND, '2026-09-27T01:30:00+12:00')).toEqual(['03:00', '04:00']);
    // The hour after Starts is an hour of real time too, so from 12:10 AM it ends at 3:00 AM on the clock.
    expect(opening('2027-03-14', CHICAGO, '2027-03-14T00:10:00-06:00')).toEqual(['01:00', '03:00']);
    // London, 2027-03-28: 1:00 AM does not exist.
    expect(opening('2027-03-28', LONDON, '2027-03-28T00:30:00+00:00')).toEqual(['02:00', '03:00']);
    // Havana, 2027-03-14: the change is at midnight, so the day's first hour is 1:00 AM.
    expect(opening('2027-03-14', HAVANA, '2027-03-14T01:10:00-04:00')).toEqual(['02:00', '03:00']);
    // The night before, the next whole hour is already tomorrow's 1:00 AM: Starts stays inside today.
    expect(opening('2027-03-13', HAVANA, '2027-03-13T23:30:00-05:00')).toEqual(['23:00', '23:45']);
    // Lord Howe, 2026-10-04: the clocks go forward by half an hour, 2:00 AM to 2:30 AM.
    expect(opening('2026-10-04', LORD_HOWE, '2026-10-04T01:45:00+10:30')).toEqual(['02:30', '03:30']);
  });
});

describe('moving a new event to another day', () => {
  const now = new Date('2026-10-01T19:21:00-05:00');
  const opened = { ...blankEventForm('2026-10-01'), ...openingTimes('2026-10-01', CHICAGO, now) };

  it('takes the new day’s opening times while no time has been set', () => {
    expect(times(opened)).toEqual(['20:00', '21:00']);
    const tomorrow = moveToDay(opened, '2026-10-02', false, CHICAGO, now);
    expect(tomorrow).toMatchObject({ date: '2026-10-02', startTime: '09:00', endTime: '10:00' });
    expect(moveToDay(tomorrow, '2026-10-01', false, CHICAGO, now)).toMatchObject({ date: '2026-10-01', startTime: '20:00', endTime: '21:00' });
  });

  it('keeps its times once a time has been set', () => {
    const moved = setStart(opened, '20:15');
    expect(times(moved)).toEqual(['20:15', '21:15']);
    expect(moveToDay(moved, '2026-10-02', true, CHICAGO, now)).toEqual({ ...moved, date: '2026-10-02' });
  });

  it('changes nothing but the date and the times', () => {
    const typed = { ...opened, title: 'Plumber', location: 'Home', notes: 'Key under the pot', profileIds: ['ava'], allDay: true };
    expect(moveToDay(typed, '2026-10-03', false, CHICAGO, now)).toEqual({ ...typed, date: '2026-10-03', startTime: '09:00', endTime: '10:00' });
  });

  it('takes a cleared date field without complaint', () => {
    expect(moveToDay(opened, '', false, CHICAGO, now)).toMatchObject({ date: '', startTime: '09:00', endTime: '10:00' });
  });

  it('is untouched only while it is as it opened', () => {
    expect(isUntouched(moveToDay(opened, '2026-10-01', false, CHICAGO, now), opened)).toBe(true);
    expect(isUntouched(moveToDay(opened, '2026-10-02', false, CHICAGO, now), opened)).toBe(false);
  });
});

describe('a time the clocks skip', () => {
  const HAVANA = 'America/Havana';
  const LONDON = 'Europe/London';
  const refused = (date: string, startTime: string, endTime: string, timezone: string) =>
    eventFormToInput({ ...blankEventForm(date), title: 'Early', startTime, endTime }, timezone);
  const skipped = (time: string) => ({ problem: `The clocks go forward on this day, so there is no ${time}. Pick another time.` });

  it('is named when it is why an end is not after its start', () => {
    // Chicago, 2027-03-14: 2:00 AM becomes 3:00 AM, so 2:00 AM does not exist and moves on to 3:00 AM.
    expect(refused('2027-03-14', '02:00', '03:00', CHICAGO)).toEqual(skipped('2:00 AM'));
    expect(refused('2027-03-14', '02:30', '03:15', CHICAGO)).toEqual(skipped('2:30 AM'));
    // London, 2027-03-28: 1:00 AM becomes 2:00 AM.
    expect(refused('2027-03-28', '01:00', '02:00', LONDON)).toEqual(skipped('1:00 AM'));
    expect(refused('2027-03-28', '01:45', '02:30', LONDON)).toEqual(skipped('1:45 AM'));
    // Havana, 2027-03-14: midnight becomes 1:00 AM.
    expect(refused('2027-03-14', '00:00', '01:00', HAVANA)).toEqual(skipped('12:00 AM'));
    expect(refused('2027-03-14', '00:30', '01:15', HAVANA)).toEqual(skipped('12:30 AM'));
  });

  it('is named for every quarter-hour form that the clocks refuse', () => {
    const quarter = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    const days: [string, string, RegExp][] = [
      [CHICAGO, '2027-03-14', /^The clocks go forward on this day, so there is no 2:\d\d AM\. Pick another time\.$/],
      [LONDON, '2027-03-28', /^The clocks go forward on this day, so there is no 1:\d\d AM\. Pick another time\.$/],
      [HAVANA, '2027-03-14', /^The clocks go forward on this day, so there is no 12:\d\d AM\. Pick another time\.$/],
    ];
    for (const [zone, date, message] of days) {
      let count = 0;
      for (let start = 0; start <= 5 * 60; start += 15) {
        for (let end = start + 15; end <= 6 * 60; end += 15) {
          const result = refused(date, quarter(start), quarter(end), zone);
          if (!('problem' in result)) continue;
          count += 1;
          // An end is never before its start on the clock here, so what is refused is the skipped hour's doing.
          expect(result.problem).toMatch(message);
        }
      }
      expect(count).toBeGreaterThan(0);
    }
  });

  it('still saves a time the clocks move on, when the order holds', () => {
    // 2:30 AM becomes 3:30 AM, which is before 3:45 AM.
    expect(refused('2027-03-14', '02:30', '03:45', CHICAGO)).toMatchObject({ starts_at: '2027-03-14T08:30:00.000Z', ends_at: '2027-03-14T08:45:00.000Z' });
  });

  it('leaves the other message for an end that is not after its start', () => {
    const order = { problem: 'The event must end after it starts.' };
    expect(refused('2026-10-08', '14:00', '13:00', CHICAGO)).toEqual(order);
    expect(refused('2026-10-08', '14:00', '14:00', CHICAGO)).toEqual(order);
    // On a day the clocks go forward, with both times real.
    expect(refused('2027-03-14', '04:00', '03:30', CHICAGO)).toEqual(order);
    // An end before its start on the clock is that problem, even where one of the times is skipped.
    expect(refused('2027-03-14', '03:30', '02:15', CHICAGO)).toEqual(order);
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
    expect(isUntouched(setStart(opened, '09:15'), opened)).toBe(false);
    expect(isUntouched(setEnd(opened, '10:15') as EventForm, opened)).toBe(false);
    expect(isUntouched({ ...opened, profileIds: ['ava'] }, opened)).toBe(false);
    expect(isUntouched({ ...opened, profileIds: [] }, opened)).toBe(false);
    expect(isUntouched({ ...opened, profileIds: ['ava', 'ben', 'cy'] }, opened)).toBe(false);
  });

  it('is untouched again once what was changed is put back', () => {
    expect(isUntouched({ ...opened, title: '' }, opened)).toBe(true);
    expect(isUntouched(setStart(setStart(opened, '09:15'), '09:00'), opened)).toBe(true);
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

// An edit that moves an event to another day takes it off the week on screen: the line says when the event is now, in the
// words of the one an added event says, and not only that it was saved.
describe('what the status line says after an event is saved', () => {
  const input = (value: EventForm) => eventFormToInput({ ...value, title: ' Plumber coming ' }, CHICAGO) as NativeEventInput;

  it('names the event, and the day and the time it is on now, in the Household Timezone', () => {
    const moved = input({ ...blankEventForm('2026-10-14'), startTime: '14:00', endTime: '15:00' });
    expect(savedSentence(moved, CHICAGO)).toBe('Saved Plumber coming: Wed, Oct 14, 2:00 PM');
    expect(savedSentence(moved, 'Pacific/Auckland')).toBe('Saved Plumber coming: Thu, Oct 15, 8:00 AM');
  });

  it('says all day for an all-day event, and keeps midnight and noon straight', () => {
    expect(savedSentence(input({ ...form('14:00', '15:00'), allDay: true }), CHICAGO)).toBe('Saved Plumber coming: Fri, Oct 2, all day');
    expect(savedSentence(input(form('00:00', '00:15')), CHICAGO)).toBe('Saved Plumber coming: Fri, Oct 2, 12:00 AM');
    expect(savedSentence(input(form('12:00', '12:15')), CHICAGO)).toBe('Saved Plumber coming: Fri, Oct 2, 12:00 PM');
  });

  it('is the added sentence with its own first word: one helper builds both', () => {
    for (const value of [form('14:00', '15:00'), { ...form('09:00', '10:00'), allDay: true }, form('23:30', '23:45')]) {
      const event = input(value);
      expect(savedSentence(event, CHICAGO)).toBe(addedSentence(event, CHICAGO).replace(/^Added /, 'Saved '));
    }
  });

  it('uses no dash of any length', () => {
    expect(savedSentence(input(form('14:00', '15:00')), CHICAGO)).not.toMatch(/[–—]/);
  });
});
