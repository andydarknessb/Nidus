import { describe, expect, it } from 'vitest';
import type { Occurrence } from '../src/lib/calendar-occurrences';
import {
  answer,
  askToDelete,
  blankEventForm,
  changeRepeat,
  chooseAnotherDay,
  chooseRepeat,
  dayRow,
  eventFormToInput,
  goBack,
  moveToDay,
  openDraft,
  pickDate,
  pickDay,
  pressEveryone,
  pressPerson,
  setField,
  setTime,
  submit,
  untouched,
  writeFailed,
  type EventDraft,
} from '../src/lib/event-draft';
import type { EventForm, NativeEventInput, Repeat } from '../src/lib/native-events';
import { minutesOf, timeOf } from '../src/lib/time-picker';

// The event draft (docs/specs/0015, "1. The event draft"): the Native Event form's rules driven as plain calls, with no screen and no
// database. What a plan writes is in native-events.test.ts (`runPlan`, against the local stack); what the sheet draws is in
// event-form.test.ts and sheet.test.ts. Every date goes through the Household Timezone, never the machine's.

const CHICAGO = 'America/Chicago';
const NOW = new Date('2026-10-01T19:21:00-05:00');
const form = (startTime: string, endTime: string): EventForm => ({ ...blankEventForm('2026-10-02'), startTime, endTime });
// A new event on Oct 2 (not "today" at NOW, so it opens at 9:00 AM), with its form, as opened, replaced.
const draftOf = (value: EventForm): EventDraft => ({ ...openDraft({ date: '2026-10-02' }, CHICAGO, NOW), form: value, opened: value });
const moves = (draft: EventDraft | { problem: string }) => draft as EventDraft;
const times = (value: EventDraft | { problem: string }) => ('problem' in value ? value.problem : [value.form.startTime, value.form.endTime]);

// An Occurrence as the Household reads it. Soccer: Tuesdays at 3:00 PM from Oct 6, in Chicago.
const occurrence = (more: Partial<Occurrence> = {}): Occurrence =>
  ({
    source: 'native',
    id: 'n1',
    event_id: 'n1',
    household_id: 'household-1',
    title: 'Plumber',
    description: null,
    location: null,
    starts_at: '2026-10-02T19:10:00Z',
    ends_at: '2026-10-02T20:20:00Z',
    is_all_day: false,
    profile_ids: [],
    repeat_every: null,
    repeat_interval: null,
    repeat_days: null,
    repeat_until: null,
    ...more,
  }) as unknown as Occurrence;
const SOCCER = occurrence({ id: 'n1-2', title: 'Soccer', starts_at: '2026-10-13T20:00:00Z', ends_at: '2026-10-13T21:00:00Z', repeat_every: 'week', repeat_interval: 1, repeat_days: 4 });

describe('opening a draft', () => {
  it('opens a new event on the date given, as untouched, with no question and "Another day" not chosen for a day in the row', () => {
    const draft = openDraft({ date: '2026-10-02' }, CHICAGO, NOW);
    expect(draft).toMatchObject({ asking: null, keepTimes: false, another: false, occurrence: undefined, timezone: CHICAGO });
    expect(draft.form).toEqual({ ...blankEventForm('2026-10-02') });
    expect(untouched(draft)).toBe(true);
    // Today and the two days after it are the row; any other day is "Another day", chosen from the start.
    expect(openDraft({ date: '2026-10-03' }, CHICAGO, NOW).another).toBe(false);
    expect(openDraft({ date: '2026-10-04' }, CHICAGO, NOW).another).toBe(true);
  });

  it('opens an Occurrence as an edit, whose times always stay', () => {
    const draft = openDraft({ occurrence: occurrence() }, CHICAGO, NOW);
    expect(draft).toMatchObject({ keepTimes: true, asking: null });
    expect(draft.occurrence).toEqual(occurrence());
    expect(times(draft)).toEqual(['14:10', '15:20']);
    expect(untouched(draft)).toBe(true);
  });

  it('opens a Repeat with the Repeat the Occurrence has', () => {
    expect(openDraft({ occurrence: SOCCER }, CHICAGO, NOW).form.repeat).toEqual({ every: 'week', interval: 1, days: 4, until: null });
    expect(openDraft({ occurrence: occurrence() }, CHICAGO, NOW).form.repeat).toBeNull();
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
    const { form: opened } = openDraft({ date }, timezone, new Date(now));
    // What it gives is always something the form takes.
    expect(eventFormToInput({ ...opened, title: 'Plumber' }, timezone)).not.toHaveProperty('problem');
    return [opened.startTime, opened.endTime];
  };

  it('is the next whole hour, for an hour, when the date is today', () => {
    expect(opening('2026-10-01', CHICAGO, '2026-10-01T19:21:00-05:00')).toEqual(['20:00', '21:00']);
    // On the hour it is the next one; a millisecond short of it, it is that one.
    expect(opening('2026-10-01', CHICAGO, '2026-10-01T19:00:00.000-05:00')).toEqual(['20:00', '21:00']);
    expect(opening('2026-10-01', CHICAGO, '2026-10-01T19:59:59.999-05:00')).toEqual(['20:00', '21:00']);
  });

  it('is 9:00 AM to 10:00 AM on any other day', () => {
    for (const date of ['2026-09-30', '2026-10-02', '2026-12-25', '']) {
      const { form: opened } = openDraft({ date }, CHICAGO, new Date('2026-10-01T19:21:00-05:00'));
      expect([opened.startTime, opened.endTime]).toEqual(['09:00', '10:00']);
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
  const opened = openDraft({ date: '2026-10-01' }, CHICAGO, now);

  it('takes the new day’s opening times while no time has been set', () => {
    expect(times(opened)).toEqual(['20:00', '21:00']);
    const tomorrow = pickDay(opened, '2026-10-02', now);
    expect(tomorrow.form).toMatchObject({ date: '2026-10-02', startTime: '09:00', endTime: '10:00' });
    expect(pickDay(tomorrow, '2026-10-01', now).form).toMatchObject({ date: '2026-10-01', startTime: '20:00', endTime: '21:00' });
  });

  it('keeps its times once a time has been set', () => {
    const moved = moves(setTime(opened, 'start', '20:15'));
    expect(times(moved)).toEqual(['20:15', '21:15']);
    expect(pickDay(moved, '2026-10-02', now).form).toEqual({ ...moved.form, date: '2026-10-02' });
  });

  it('changes nothing but the date and the times', () => {
    const typed = { ...opened, form: { ...opened.form, title: 'Plumber', location: 'Home', notes: 'Key under the pot', profileIds: ['ava'], allDay: true } };
    expect(pickDay(typed, '2026-10-03', now).form).toEqual({ ...typed.form, date: '2026-10-03', startTime: '09:00', endTime: '10:00' });
  });

  it('takes a cleared date field without complaint', () => {
    expect(pickDate(opened, '', now).form).toMatchObject({ date: '', startTime: '09:00', endTime: '10:00' });
  });

  it('is untouched only while it is as it opened', () => {
    expect(untouched(pickDay(opened, '2026-10-01', now))).toBe(true);
    expect(untouched(pickDay(opened, '2026-10-02', now))).toBe(false);
  });

  it('takes "Another day" away with a day from the row, and keeps it with a date from the field', () => {
    const another = chooseAnotherDay(opened);
    expect(another.another).toBe(true);
    expect(pickDate(another, '2026-10-02', now).another).toBe(true);
    expect(pickDay(another, '2026-10-02', now).another).toBe(false);
  });

  it('keeps "Another day" as the choice of its own, and offers the row from the Household’s today', () => {
    expect(dayRow(opened, '2026-10-01')).toEqual({
      days: [
        { date: '2026-10-01', label: 'Today' },
        { date: '2026-10-02', label: 'Fri 2' },
        { date: '2026-10-03', label: 'Sat 3' },
      ],
      another: false,
    });
    expect(dayRow(chooseAnotherDay(opened), '2026-10-01').another).toBe(true);
  });
});

describe('the days to pick from', () => {
  const row = (today: string) => dayRow(openDraft({ date: today }, CHICAGO, NOW), today).days;

  it('offers today and the next two days', () => {
    expect(row('2026-10-01')).toEqual([
      { date: '2026-10-01', label: 'Today' },
      { date: '2026-10-02', label: 'Fri 2' },
      { date: '2026-10-03', label: 'Sat 3' },
    ]);
  });

  it('carries over the end of a month and a year', () => {
    expect(row('2026-10-30')).toEqual([
      { date: '2026-10-30', label: 'Today' },
      { date: '2026-10-31', label: 'Sat 31' },
      { date: '2026-11-01', label: 'Sun 1' },
    ]);
    expect(row('2026-12-31').map((choice) => choice.date)).toEqual(['2026-12-31', '2027-01-01', '2027-01-02']);
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
    const days: [string, string, RegExp][] = [
      [CHICAGO, '2027-03-14', /^The clocks go forward on this day, so there is no 2:\d\d AM\. Pick another time\.$/],
      [LONDON, '2027-03-28', /^The clocks go forward on this day, so there is no 1:\d\d AM\. Pick another time\.$/],
      [HAVANA, '2027-03-14', /^The clocks go forward on this day, so there is no 12:\d\d AM\. Pick another time\.$/],
    ];
    for (const [zone, date, message] of days) {
      let count = 0;
      for (let start = 0; start <= 5 * 60; start += 15) {
        for (let end = start + 15; end <= 6 * 60; end += 15) {
          const result = refused(date, timeOf(start), timeOf(end), zone);
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

describe('a form nothing has touched', () => {
  const opened = draftOf({ ...blankEventForm('2026-10-02'), profileIds: ['ava', 'ben'] });
  const edited = (changes: Partial<EventForm>) => ({ ...opened, form: { ...opened.form, ...changes } });

  it('is untouched as it opened', () => {
    expect(untouched(opened)).toBe(true);
    expect(untouched(edited({}))).toBe(true);
  });

  it('is touched by anything typed, even a space', () => {
    expect(untouched(setField(opened, { title: 'P' }))).toBe(false);
    expect(untouched(setField(opened, { title: ' ' }))).toBe(false);
    expect(untouched(setField(opened, { location: 'Home' }))).toBe(false);
    expect(untouched(setField(opened, { notes: 'Key under the pot' }))).toBe(false);
  });

  it('is touched by anything changed', () => {
    expect(untouched(pickDate(opened, '2026-10-03'))).toBe(false);
    expect(untouched(setField(opened, { allDay: true }))).toBe(false);
    expect(untouched(moves(setTime(opened, 'start', '09:15')))).toBe(false);
    expect(untouched(moves(setTime(opened, 'end', '10:15')))).toBe(false);
    expect(untouched(edited({ profileIds: ['ava'] }))).toBe(false);
    expect(untouched(edited({ profileIds: [] }))).toBe(false);
    expect(untouched(edited({ profileIds: ['ava', 'ben', 'cy'] }))).toBe(false);
  });

  it('is untouched again once what was changed is put back', () => {
    expect(untouched(setField(setField(opened, { title: 'P' }), { title: '' }))).toBe(true);
    expect(untouched(moves(setTime(moves(setTime(opened, 'start', '09:15')), 'start', '09:00')))).toBe(true);
    expect(untouched(setField(setField(opened, { allDay: true }), { allDay: false }))).toBe(true);
    // The same people in the order they were pressed in are the same people.
    expect(untouched(edited({ profileIds: ['ben', 'ava'] }))).toBe(true);
  });

  it('is untouched as an existing event opened, too', () => {
    const existing = openDraft({ occurrence: occurrence({ title: 'Trip', starts_at: '2026-10-02T05:00:00Z', ends_at: '2026-10-03T05:00:00Z', is_all_day: true }) }, CHICAGO);
    expect(untouched(existing)).toBe(true);
    expect(untouched(setField(existing, { title: 'Trips' }))).toBe(false);
  });

  it('counts a Repeat changed in the form as a change, by value', () => {
    const repeating = draftOf({ ...blankEventForm('2026-10-06'), repeat: { every: 'week', interval: 2, days: 4, until: null } });
    const repeat = repeating.form.repeat!;
    const other = (changes: Partial<EventForm>): EventDraft => ({ ...repeating, form: { ...repeating.form, ...changes } });
    expect(untouched(other({ repeat: { ...repeat } }))).toBe(true);
    expect(untouched(other({ repeat: { ...repeat, interval: 3 } }))).toBe(false);
    expect(untouched(other({ repeat: { ...repeat, days: 4 | 16 } }))).toBe(false);
    expect(untouched(other({ repeat: { ...repeat, until: '2026-12-20' } }))).toBe(false);
    expect(untouched(other({ repeat: { ...repeat, every: 'month' } }))).toBe(false);
    expect(untouched(other({ repeat: null }))).toBe(false);
    expect(untouched({ ...repeating, opened: { ...repeating.opened, repeat: null } })).toBe(false);
    const none = draftOf({ ...blankEventForm('2026-10-06'), repeat: null });
    expect(untouched({ ...none, form: { ...none.form, repeat: null } })).toBe(true);
  });
});

describe('Starts and Ends', () => {
  const at = (startTime: string, endTime: string) => draftOf(form(startTime, endTime));
  // setTime's answer when it is a draft.
  const ended = (value: EventDraft | { problem: string }): EventForm => {
    if ('problem' in value) throw new Error(value.problem);
    return value.form;
  };

  it('moves Starts, and Ends by the same amount', () => {
    expect(times(setTime(at('14:00', '15:30'), 'start', '14:15'))).toEqual(['14:15', '15:45']);
    expect(times(setTime(at('14:00', '15:30'), 'start', '13:45'))).toEqual(['13:45', '15:15']);
    // Any time, not a quarter hour: 9:00 AM to 4:37 PM keeps the hour.
    expect(times(setTime(at('09:00', '10:00'), 'start', '16:37'))).toEqual(['16:37', '17:37']);
  });

  it('moves Ends on its own', () => {
    expect(times(setTime(at('14:00', '15:00'), 'end', '15:15'))).toEqual(['14:00', '15:15']);
    expect(times(setTime(at('14:00', '15:00'), 'end', '14:45'))).toEqual(['14:00', '14:45']);
  });

  it('keeps Ends after Starts', () => {
    expect(times(setTime(at('14:00', '14:30'), 'end', '14:15'))).toEqual(['14:00', '14:15']);
    expect(times(setTime(at('14:00', '14:30'), 'end', '14:01'))).toEqual(['14:00', '14:01']);
    // At Starts, or before it, the end is refused, in words, and the form is not changed.
    expect(setTime(at('14:00', '14:15'), 'end', '14:00')).toEqual({ problem: 'The event must end after it starts.' });
    expect(setTime(at('14:00', '14:15'), 'end', '13:45')).toEqual({ problem: 'The event must end after it starts.' });
    expect(setTime(at('00:00', '01:00'), 'end', '00:00')).toEqual({ problem: 'The event must end after it starts.' });
  });

  it('stops Starts at 11:58 PM, and Ends goes with it as far as 11:59 PM', () => {
    let current = at('22:30', '23:30');
    const seen: unknown[] = [];
    for (const time of ['22:45', '23:00', '23:15', '23:30', '23:45', '23:59']) {
      current = moves(setTime(current, 'start', time));
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
    expect(ended(setTime(at('14:00', '23:30'), 'end', '23:59')).endTime).toBe('23:59');
    expect(ended(setTime(at('14:00', '23:59'), 'end', '23:59')).endTime).toBe('23:59');
  });

  it('stops Starts at midnight, and Ends comes back with it', () => {
    expect(times(setTime(at('00:15', '01:15'), 'start', '00:00'))).toEqual(['00:00', '01:00']);
    // An Ends that was held at 11:59 PM comes back by the length it has, not to where it was.
    expect(times(setTime(at('23:30', '23:59'), 'start', '23:15'))).toEqual(['23:15', '23:44']);
  });

  it('keeps an existing event’s times off the quarter hour until a time is set', () => {
    const opened = openDraft({ occurrence: occurrence() }, CHICAGO);
    expect(times(opened)).toEqual(['14:10', '15:20']);
    // The one that is set lands where it was set, and Ends follows Starts by the same amount.
    expect(times(setTime(opened, 'start', '14:15'))).toEqual(['14:15', '15:25']);
    expect(times(setTime(opened, 'start', '14:00'))).toEqual(['14:00', '15:10']);
    expect(times(setTime(opened, 'end', '15:30'))).toEqual(['14:10', '15:30']);
    expect(times(setTime(opened, 'end', '15:15'))).toEqual(['14:10', '15:15']);
  });

  it('lands inside the limits when an existing time is past them', () => {
    // Starts at 11:59 PM leaves no room for an end after it: it is held at 11:58 PM, with Ends at 11:59 PM.
    const late = at('23:40', '23:50');
    expect(times(setTime(late, 'start', '23:59'))).toEqual(['23:58', '23:59']);
    expect(times(setTime(late, 'start', '23:30'))).toEqual(['23:30', '23:40']);
    // Ends at 11:50 PM can come back, and cannot go before Starts at 11:40 PM.
    expect(ended(setTime(at('14:00', '23:50'), 'end', '23:59')).endTime).toBe('23:59');
    expect(ended(setTime(at('14:00', '23:50'), 'end', '23:45')).endTime).toBe('23:45');
    expect(setTime(late, 'end', '23:40')).toEqual({ problem: 'The event must end after it starts.' });
  });

  it('lets the time sheet mend an existing event that is shorter than 15 minutes', () => {
    expect(times(setTime(at('14:00', '14:00'), 'end', '14:15'))).toEqual(['14:00', '14:15']);
    expect(times(setTime(at('14:00', '14:10'), 'start', '14:15'))).toEqual(['14:15', '14:25']);
    expect(times(setTime(at('14:10', '14:20'), 'end', '14:30'))).toEqual(['14:10', '14:30']);
    // An event with no length (or less) takes an hour with its new start.
    expect(times(setTime(at('14:00', '14:00'), 'start', '14:15'))).toEqual(['14:15', '15:15']);
    expect(times(setTime(at('14:00', '13:00'), 'start', '14:15'))).toEqual(['14:15', '15:15']);
  });

  it('can never hold an end at or before its start, or a time past the limits', () => {
    const broken: string[] = [];
    const check = (label: string, next: EventDraft | { problem: string }) => {
      if ('problem' in next) return;
      const [start, end] = [minutesOf(next.form.startTime), minutesOf(next.form.endTime)];
      if (start === null || end === null || start < 0 || end > 23 * 60 + 59 || end <= start) broken.push(`${label}: ${next.form.startTime} to ${next.form.endTime}`);
    };
    // Every start time, from forms of several lengths, set to a spread of times.
    for (let start = 0; start < 24 * 60; start += 1) {
      for (const length of [1, 15, 60, 600]) {
        const end = Math.min(start + length, 23 * 60 + 59);
        if (end <= start) continue;
        const before = at(timeOf(start), timeOf(end));
        for (let when = 0; when < 24 * 60; when += 13) {
          check(`${before.form.startTime} to ${before.form.endTime}, start ${timeOf(when)}`, setTime(before, 'start', timeOf(when)));
          check(`${before.form.startTime} to ${before.form.endTime}, end ${timeOf(when)}`, setTime(before, 'end', timeOf(when)));
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it('only ever makes a form eventFormToInput takes, whatever is set', () => {
    // A fixed walk of times (a small generator, so the test is the same every run) from a new event.
    let seed = 7;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31);
    let current = setField(openDraft({ date: '2026-10-02' }, CHICAGO, NOW), { title: 'Plumber' });
    for (let press = 0; press < 400; press += 1) {
      const result = setTime(current, next() % 2 === 0 ? 'start' : 'end', timeOf(next() % (24 * 60)));
      if (!('problem' in result)) current = result;
      expect(eventFormToInput(current.form, CHICAGO)).not.toHaveProperty('problem');
    }
  });

  it('refuses a form that is not times, and changes nothing', () => {
    // An edit's times always stay, so setting a time on it has nothing else to change.
    const odd = { ...at('soon', '10:00'), keepTimes: true };
    expect(setTime(odd, 'start', '09:00')).toBe(odd);
    expect(setTime(odd, 'end', '09:00')).toBe(odd);
    const fine = { ...at('09:00', '10:00'), keepTimes: true };
    expect(setTime(fine, 'start', 'noon')).toBe(fine);
    expect(setTime(fine, 'end', 'noon')).toBe(fine);
  });

  it('keeps the times from then on, when the day changes', () => {
    const fresh = openDraft({ date: '2026-10-02' }, CHICAGO, NOW);
    expect(fresh.keepTimes).toBe(false);
    expect(moves(setTime(fresh, 'end', '11:00')).keepTimes).toBe(true);
  });
});

describe('the Native Event form', () => {
  const form = { ...blankEventForm('2026-10-08'), title: ' Plumber ', startTime: '14:00', endTime: '15:30' };

  it('turns wall-clock times into instants in the Household Timezone', () => {
    expect(eventFormToInput(form, CHICAGO)).toEqual({
      title: 'Plumber',
      location: null,
      notes: null,
      starts_at: '2026-10-08T19:00:00.000Z',
      ends_at: '2026-10-08T20:30:00.000Z',
      is_all_day: false,
      profile_ids: [],
      repeat_every: null,
      repeat_interval: 1,
      repeat_days: null,
      repeat_until: null,
    });
    // The same wall time in another zone is another instant: nothing reads the machine's zone.
    expect(eventFormToInput(form, 'Pacific/Auckland')).toMatchObject({ starts_at: '2026-10-08T01:00:00.000Z' });
  });

  it('keeps the wall clock across a daylight saving change', () => {
    // Chicago went back from CDT to CST on 2026-11-01.
    const input = eventFormToInput({ ...form, ...{ date: '2026-11-02' } }, CHICAGO);
    expect(input).toMatchObject({ starts_at: '2026-11-02T20:00:00.000Z' });
  });

  it('is right on the day of a daylight saving change itself', () => {
    const at = (date: string, time: string, zone = CHICAGO) => (eventFormToInput({ ...form, date, startTime: time, endTime: '23:00' }, zone) as NativeEventInput).starts_at;
    // Spring forward (Chicago, 2027-03-14): 02:30 does not exist, and moves on to 03:30 CDT, never back.
    expect(at('2027-03-14', '01:30')).toBe('2027-03-14T07:30:00.000Z');
    expect(at('2027-03-14', '02:30')).toBe('2027-03-14T08:30:00.000Z');
    expect(at('2027-03-14', '03:30')).toBe('2027-03-14T08:30:00.000Z');
    // The same in a zone east of UTC (Berlin, 2027-03-28).
    expect(at('2027-03-28', '02:30', 'Europe/Berlin')).toBe('2027-03-28T01:30:00.000Z');
    // Fall back (Chicago, 2026-11-01): 01:30 happens twice, and the first is meant.
    expect(at('2026-11-01', '01:30')).toBe('2026-11-01T06:30:00.000Z');
    expect(at('2026-11-01', '02:30')).toBe('2026-11-01T08:30:00.000Z');
  });

  it('makes an all-day event the Household day, ending at the next midnight', () => {
    expect(eventFormToInput({ ...form, allDay: true }, CHICAGO)).toMatchObject({
      starts_at: '2026-10-08T05:00:00.000Z',
      ends_at: '2026-10-09T05:00:00.000Z',
      is_all_day: true,
    });
    // On a 25 hour day the next midnight is 25 hours on.
    expect(eventFormToInput({ ...blankEventForm('2026-11-01'), title: 'Clocks', allDay: true }, CHICAGO)).toMatchObject({
      starts_at: '2026-11-01T05:00:00.000Z',
      ends_at: '2026-11-02T06:00:00.000Z',
    });
  });

  it('keeps blank optional fields as none and trims the rest', () => {
    expect(eventFormToInput({ ...form, location: '  ', notes: ' Key under the pot ', profileIds: ['a', 'b'] }, CHICAGO)).toMatchObject({
      location: null,
      notes: 'Key under the pot',
      profile_ids: ['a', 'b'],
    });
  });

  it('says what is wrong instead of saving', () => {
    expect(eventFormToInput({ ...form, title: '  ' }, CHICAGO)).toEqual({ problem: 'Give the event a title.' });
    expect(eventFormToInput({ ...form, date: '' }, CHICAGO)).toEqual({ problem: 'Pick a date.' });
    expect(eventFormToInput({ ...form, startTime: '' }, CHICAGO)).toEqual({ problem: 'Pick a start and end time, or choose all day.' });
    expect(eventFormToInput({ ...form, endTime: '13:00' }, CHICAGO)).toEqual({ problem: 'The event must end after it starts.' });
    // All day needs no times.
    expect(eventFormToInput({ ...form, allDay: true, startTime: '', endTime: '' }, CHICAGO)).toHaveProperty('is_all_day', true);
  });

  it('fills the form from an occurrence, as the Household sees it', () => {
    const plumber = occurrence({
      title: 'Plumber',
      description: 'Key under the pot',
      location: '12 Elm St',
      starts_at: '2026-10-08T19:00:00+00:00',
      ends_at: '2026-10-08T20:30:00+00:00',
      profile_ids: ['a', 'b'],
    });
    const filled = openDraft({ occurrence: plumber }, CHICAGO).form;
    expect(filled).toEqual({
      title: 'Plumber',
      date: '2026-10-08',
      allDay: false,
      startTime: '14:00',
      endTime: '15:30',
      location: '12 Elm St',
      notes: 'Key under the pot',
      profileIds: ['a', 'b'],
      repeat: null,
    });
    // Saving it unchanged writes the same instants back.
    expect(eventFormToInput(filled, CHICAGO)).toMatchObject({ starts_at: '2026-10-08T19:00:00.000Z', ends_at: '2026-10-08T20:30:00.000Z' });
  });

  it('fills an all-day event with no times', () => {
    const filled = openDraft({ occurrence: occurrence({ title: 'Trip', starts_at: '2026-10-08T05:00:00Z', ends_at: '2026-10-09T05:00:00Z', is_all_day: true }) }, CHICAGO).form;
    expect(filled).toMatchObject({ date: '2026-10-08', allDay: true });
    expect(eventFormToInput(filled, CHICAGO)).toMatchObject({ starts_at: '2026-10-08T05:00:00.000Z', ends_at: '2026-10-09T05:00:00.000Z' });
  });
});

describe('the Repeats of the form', () => {
  // Tuesday, Oct 6.
  const soccer: EventForm = { ...blankEventForm('2026-10-06'), title: 'Soccer', startTime: '15:00', endTime: '16:00' };
  const weekly = (changes: Partial<Repeat> = {}): Repeat => ({ every: 'week', interval: 1, days: 4, until: null, ...changes });
  const input = (repeat: Repeat) => eventFormToInput({ ...soccer, repeat }, CHICAGO);

  it('writes none for an event that does not repeat', () => {
    expect(eventFormToInput(soccer, CHICAGO)).toMatchObject({ repeat_every: null, repeat_interval: 1, repeat_days: null, repeat_until: null });
  });

  it('writes the Repeat, its days only for a week', () => {
    expect(input(weekly({ interval: 2, until: '2026-12-01' }))).toMatchObject({ repeat_every: 'week', repeat_interval: 2, repeat_days: 4, repeat_until: '2026-12-01' });
    expect(input({ every: 'month', interval: 1, days: 4, until: null })).toMatchObject({ repeat_every: 'month', repeat_days: null });
    // The day it ends on is a day it may land on.
    expect(input(weekly({ until: '2026-10-06' }))).not.toHaveProperty('problem');
  });

  it('refuses a week with no days, an end before the first day, and a number outside 1 to 99', () => {
    expect(input(weekly({ days: 0 }))).toEqual({ problem: 'Pick at least one day.' });
    expect(input(weekly({ until: '2026-10-05' }))).toEqual({ problem: 'The repeat ends before it starts.' });
    for (const interval of [0, 100, -1, 1.5, Number.NaN]) expect(input(weekly({ interval }))).toEqual({ problem: 'Repeat every 1 to 99.' });
    expect(input(weekly({ interval: 99 }))).not.toHaveProperty('problem');
    expect(input(weekly({ until: '' }))).toHaveProperty('problem');
    // A day Repeat has no days to pick.
    expect(input({ every: 'day', interval: 1, days: 0, until: null })).not.toHaveProperty('problem');
  });

  it("moves a week Repeat's one day with the date, and leaves any other choice of days where it is", () => {
    const only = { ...soccer, repeat: weekly() };
    expect(moveToDay(only, '2026-10-08', true, CHICAGO).repeat).toEqual(weekly({ days: 16 }));
    const two = { ...soccer, repeat: weekly({ days: 4 | 16 }) };
    expect(moveToDay(two, '2026-10-08', true, CHICAGO).repeat).toEqual(weekly({ days: 4 | 16 }));
    const month = { ...soccer, repeat: { every: 'month' as const, interval: 1, days: 4, until: null } };
    expect(moveToDay(month, '2026-10-08', true, CHICAGO).repeat).toEqual(month.repeat);
    expect(moveToDay(soccer, '2026-10-08', true, CHICAGO).repeat).toBeNull();
  });
});

describe('choosing how an event repeats', () => {
  // A new event on Tuesday, Oct 6 (not today at NOW).
  const fresh = openDraft({ date: '2026-10-06' }, CHICAGO, NOW);

  it('keeps the number and the end when the kind is chosen, and a week starts with the form’s day pressed', () => {
    const monthly = chooseRepeat(fresh, 'month');
    expect(monthly.form.repeat).toEqual({ every: 'month', interval: 1, days: 0, until: null });
    const counted = changeRepeat(changeRepeat(monthly, { interval: 3 }), { until: '2026-12-01' });
    // Tuesday is bit 2 (Sunday = bit 0), which is 4.
    expect(chooseRepeat(counted, 'week').form.repeat).toEqual({ every: 'week', interval: 3, days: 4, until: '2026-12-01' });
    expect(chooseRepeat(counted, 'year').form.repeat).toEqual({ every: 'year', interval: 3, days: 0, until: '2026-12-01' });
  });

  it('changes nothing when the kind is the one chosen already, or when there is no Repeat to take away', () => {
    expect(chooseRepeat(fresh, null)).toBe(fresh);
    const weekly = chooseRepeat(fresh, 'week');
    expect(chooseRepeat(weekly, 'week')).toBe(weekly);
    expect(chooseRepeat(weekly, null).form.repeat).toBeNull();
  });

  it('changes the Repeat’s number, days and end, and nothing without a Repeat', () => {
    const weekly = chooseRepeat(fresh, 'week');
    expect(changeRepeat(weekly, { interval: 2 }).form.repeat).toMatchObject({ interval: 2 });
    expect(changeRepeat(weekly, { days: 4 ^ 16 }).form.repeat).toMatchObject({ days: 20 });
    expect(changeRepeat(weekly, { until: '2026-12-01' }).form.repeat).toMatchObject({ until: '2026-12-01' });
    expect(changeRepeat(fresh, { interval: 2 })).toBe(fresh);
  });

  it('moves a week’s one pressed day with the date, as it is chosen', () => {
    expect(pickDay(chooseRepeat(fresh, 'week'), '2026-10-08').form.repeat).toMatchObject({ days: 16 });
  });
});

describe('who an event is for', () => {
  const fresh = openDraft({ date: '2026-10-06' }, CHICAGO, NOW);

  it('lets Everyone go when a person is pressed, and a person go when pressed again', () => {
    const ava = pressPerson(fresh, 'ava');
    expect(ava.form.profileIds).toEqual(['ava']);
    expect(pressPerson(ava, 'ben').form.profileIds).toEqual(['ava', 'ben']);
    expect(pressPerson(pressPerson(ava, 'ben'), 'ava').form.profileIds).toEqual(['ben']);
    expect(pressPerson(ava, 'ava').form.profileIds).toEqual([]);
  });

  it('lets every person go when Everyone is pressed', () => {
    const both = pressPerson(pressPerson(fresh, 'ava'), 'ben');
    expect(pressEveryone(both).form.profileIds).toEqual([]);
  });

  it('changes nothing when Everyone is pressed and is the choice already', () => {
    expect(pressEveryone(fresh)).toBe(fresh);
  });
});

describe('a move that changes nothing', () => {
  const fresh = openDraft({ date: '2026-10-06' }, CHICAGO, NOW);

  it('returns the same draft, so that a caller can tell a real change', () => {
    const titled = setField(fresh, { title: 'Plumber' });
    expect(titled).not.toBe(fresh);
    expect(setField(titled, { title: 'Plumber' })).toBe(titled);
    expect(setField(titled, {})).toBe(titled);
    expect(pickDate(titled, '2026-10-06')).toBe(titled);
    // Oct 6 is not in the row, so "Another day" is the choice from the start.
    expect(chooseAnotherDay(titled)).toBe(titled);
    expect(goBack(titled)).toBe(titled);
    expect(writeFailed(titled)).toBe(titled);
    expect(askToDelete(titled)).toBe(titled);
  });
});

describe('submit, the question and the answer', () => {
  const typed = (draft: EventDraft) => setField(draft, { title: 'Soccer' });

  it('gives a problem in the form’s words', () => {
    expect(submit(openDraft({ date: '2026-10-06' }, CHICAGO, NOW))).toEqual({ problem: 'Give the event a title.' });
    expect(submit(setField(openDraft({ occurrence: SOCCER }, CHICAGO), { title: ' ' }))).toEqual({ problem: 'Give the event a title.' });
  });

  it('plans to add a new event, from the form as it stands', () => {
    const result = submit(typed(openDraft({ date: '2026-10-06' }, CHICAGO, NOW)));
    expect(result).toEqual({ plan: { kind: 'add', input: expect.objectContaining({ title: 'Soccer', starts_at: '2026-10-06T14:00:00.000Z', repeat_every: null }) } });
  });

  it('plans to save an event that does not repeat, without a question', () => {
    const plumber = occurrence();
    const result = submit(openDraft({ occurrence: plumber }, CHICAGO));
    expect(result).toEqual({ plan: { kind: 'save', input: expect.objectContaining({ title: 'Plumber' }), occurrence: plumber } });
  });

  it('asks before it plans, for an Occurrence of a Repeat', () => {
    const result = submit(openDraft({ occurrence: SOCCER }, CHICAGO));
    expect(result).not.toHaveProperty('plan');
    expect(result).not.toHaveProperty('problem');
    expect((result as { draft: EventDraft }).draft).toMatchObject({ asking: 'save' });
    // Nothing else of the form moved.
    expect((result as { draft: EventDraft }).draft.form).toEqual(openDraft({ occurrence: SOCCER }, CHICAGO).form);
  });

  it('plans "this one" or "every one" of a save, with the form and the Occurrence', () => {
    const asking = (submit(openDraft({ occurrence: SOCCER }, CHICAGO)) as { draft: EventDraft }).draft;
    expect(answer(asking, 'one')).toEqual({ kind: 'save-one', form: asking.form, occurrence: SOCCER });
    expect(answer(asking, 'every')).toEqual({ kind: 'save-every', form: asking.form, occurrence: SOCCER });
  });

  it('plans "this one" or "every one" of a delete as a skipped day or a delete', () => {
    const asking = askToDelete(openDraft({ occurrence: SOCCER }, CHICAGO));
    expect(asking.asking).toBe('delete');
    expect(answer(asking, 'one')).toEqual({ kind: 'skip', occurrence: SOCCER });
    expect(answer(asking, 'every')).toEqual({ kind: 'delete', occurrence: SOCCER });
  });

  it('plans the Delete of an event that does not repeat as a delete', () => {
    const plumber = occurrence();
    const asking = askToDelete(openDraft({ occurrence: plumber }, CHICAGO));
    expect(asking.asking).toBe('delete');
    expect(answer(asking, 'every')).toEqual({ kind: 'delete', occurrence: plumber });
  });

  it('plans nothing when nothing is asked, and asks nothing of a new event', () => {
    expect(answer(openDraft({ occurrence: SOCCER }, CHICAGO), 'every')).toBeNull();
    const fresh = openDraft({ date: '2026-10-06' }, CHICAGO, NOW);
    expect(askToDelete(fresh)).toBe(fresh);
    expect(answer(fresh, 'every')).toBeNull();
  });

  it('takes the question away on Back', () => {
    const asking = askToDelete(openDraft({ occurrence: SOCCER }, CHICAGO));
    expect(goBack(asking).asking).toBeNull();
    expect(goBack(asking).form).toBe(asking.form);
  });

  it('takes the question away when a write failed', () => {
    const asking = (submit(openDraft({ occurrence: SOCCER }, CHICAGO)) as { draft: EventDraft }).draft;
    expect(asking.asking).toBe('save');
    expect(writeFailed(asking).asking).toBeNull();
    expect(answer(writeFailed(asking), 'every')).toBeNull();
  });
});
