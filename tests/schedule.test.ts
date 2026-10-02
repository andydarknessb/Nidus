import { describe, expect, it } from 'vitest';
import { fiveDays, pageDays, type Occurrence } from '../src/lib/calendar-occurrences';
import type { Profile } from '../src/lib/profiles';
import type { ProfileRoutines, Routine } from '../src/lib/routines';
import { isOnNow, pillName, pillPeople, pillsThatFit, pillTime, scheduleColumns, stripPeople } from '../src/lib/schedule';

// The schedule: the columns of Home and Week built from occurrences, the words under a pill's title, which pill is
// on now, how many pills a column holds, who a pill is for, and the words on the people strip. All of it is pure, and
// every date is read in the Household Timezone: nothing here reads the machine's.

const CHICAGO = 'America/Chicago';
const TOKYO = 'Asia/Tokyo';

// Thu Oct 1, 2026, 7:21 PM in Chicago (CDT, UTC-5).
const NOW = new Date('2026-10-02T00:21:00Z');

let counter = 0;
function event(title: string, startsAt: string, endsAt: string, more: Partial<Occurrence> = {}): Occurrence {
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
    is_all_day: false,
    profile_id: null,
    color: null,
    profile_ids: [],
    colors: [],
    ...more,
  };
}

// An all-day event on Household midnights: the end is the midnight after its last day. In Chicago on these dates that is 05:00Z.
const allDay = (title: string, firstDay: string, lastDay: string, more: Partial<Occurrence> = {}) => event(title, `${firstDay}T05:00:00Z`, `${lastDay}T05:00:00Z`, { is_all_day: true, ...more });

const titles = (column: { pills: { occurrence: Occurrence }[] } | undefined) => column?.pills.map((pill) => pill.occurrence.title);
const times = (column: { pills: { time: string }[] } | undefined) => column?.pills.map((pill) => pill.time);

describe('the columns of the schedule', () => {
  const days = fiveDays(CHICAGO, NOW);

  it('is one column for each day, in the order of the days', () => {
    expect(scheduleColumns([], days, NOW).map((column) => column.day.date)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05']);
    expect(scheduleColumns([], days, NOW).every((column) => column.pills.length === 0)).toBe(true);
  });

  it('lists a day all-day first, then by start, then by title', () => {
    const [today] = scheduleColumns(
      [
        event('Book club', '2026-10-02T01:00:00Z', '2026-10-02T02:00:00Z'),
        event('Standup', '2026-10-01T14:00:00Z', '2026-10-01T14:30:00Z'),
        allDay('Photo day', '2026-10-01', '2026-10-02'),
        event('Art', '2026-10-01T14:00:00Z', '2026-10-01T15:00:00Z'),
        allDay('Grandma visiting', '2026-10-01', '2026-10-02'),
      ],
      days,
      NOW,
    );
    expect(titles(today)).toEqual(['Grandma visiting', 'Photo day', 'Art', 'Standup', 'Book club']);
  });

  it('puts an event on every day it really covers, as "All day" on each when it is an all-day event', () => {
    const columns = scheduleColumns([allDay('Grandma visiting', '2026-10-02', '2026-10-05')], days, NOW);
    expect(columns.map(titles)).toEqual([[], ['Grandma visiting'], ['Grandma visiting'], ['Grandma visiting'], []]);
    expect(columns.slice(1, 4).map(times)).toEqual([['All day'], ['All day'], ['All day']]);
  });

  it('does not put an event that ends at midnight on the day that starts there', () => {
    // 10:00 PM to midnight on Oct 1, Chicago.
    const columns = scheduleColumns([event('Late movie', '2026-10-02T03:00:00Z', '2026-10-02T05:00:00Z')], days, NOW);
    expect(columns.map(titles)).toEqual([['Late movie'], [], [], [], []]);
  });

  it('keeps an event of no length on the day it falls on', () => {
    const columns = scheduleColumns([event('Reminder', '2026-10-02T14:00:00Z', '2026-10-02T14:00:00Z')], days, NOW);
    expect(columns.map(titles)).toEqual([[], ['Reminder'], [], [], []]);
    expect(times(columns[1])).toEqual(['9:00 AM']);
  });

  it('says the start time of a timed event on its first day, and "Until" on the last day of one that began on an earlier day', () => {
    // 10:00 PM on Oct 1 to 2:00 AM on Oct 2, Chicago.
    const columns = scheduleColumns([event('Sleepover', '2026-10-02T03:00:00Z', '2026-10-02T07:00:00Z')], days, NOW);
    expect(columns.map(times)).toEqual([['10:00 PM'], ['Until 2:00 AM'], [], [], []]);
  });

  it('says "All day" on a day a timed event covers from end to end, between its start and its "Until"', () => {
    // 8:00 PM on Oct 1 to 3:00 AM on Oct 3, Chicago.
    const columns = scheduleColumns([event('Camping', '2026-10-02T01:00:00Z', '2026-10-03T08:00:00Z')], days, NOW);
    expect(columns.map(times)).toEqual([['8:00 PM'], ['All day'], ['Until 3:00 AM'], [], []]);
  });

  it('says "All day" for a timed event from one midnight to the next', () => {
    const columns = scheduleColumns([event('Lock-in', '2026-10-02T05:00:00Z', '2026-10-03T05:00:00Z')], days, NOW);
    expect(columns.map(times)).toEqual([[], ['All day'], [], [], []]);
  });

  it('says "All day" for a timed event that fills a 25 hour day, and keeps the all-day event of that day on that day only', () => {
    // Sun Nov 1, 2026: clocks go back in Chicago, so the day is 25 hours (05:00Z to 06:00Z the next day).
    const week = pageDays('week', '2026-11-01', CHICAGO, new Date('2026-11-01T18:00:00Z'));
    const columns = scheduleColumns(
      [event('Fall back', '2026-11-01T05:00:00Z', '2026-11-02T06:00:00Z'), allDay('Clocks change', '2026-11-01', '2026-11-02', { ends_at: '2026-11-02T06:00:00Z' })],
      week,
      new Date('2026-11-01T18:00:00Z'),
    );
    expect(columns[0]?.pills.map((pill) => [pill.occurrence.title, pill.time])).toEqual([
      ['Clocks change', 'All day'],
      ['Fall back', 'All day'],
    ]);
    expect(titles(columns[1])).toEqual([]);
  });

  it('puts an event in the column of the Household Timezone, not the machine\'s', () => {
    // 04:00Z is 11:00 PM on Wed Sep 30 in Chicago and 1:00 PM on Thu Oct 1 in Tokyo.
    const late = event('Night shift', '2026-10-01T04:00:00Z', '2026-10-01T04:45:00Z');
    const inChicago = scheduleColumns([late], pageDays('week', '2026-09-30', CHICAGO, NOW), NOW);
    expect(inChicago.filter((column) => column.pills.length > 0).map((column) => column.day.date)).toEqual(['2026-09-30']);
    expect(times(inChicago[3])).toEqual(['11:00 PM']);
    const inTokyo = scheduleColumns([late], pageDays('week', '2026-09-30', TOKYO, NOW), NOW);
    expect(inTokyo.filter((column) => column.pills.length > 0).map((column) => column.day.date)).toEqual(['2026-10-01']);
    expect(times(inTokyo[4])).toEqual(['1:00 PM']);
  });

  it('is seven columns, Sunday to Saturday, for a week', () => {
    const week = pageDays('week', '2026-10-01', CHICAGO, NOW);
    expect(scheduleColumns([], week, NOW).map((column) => column.day.date)).toEqual(['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03']);
  });
});

describe('what is on now', () => {
  const days = fiveDays(CHICAGO, NOW);
  const ringed = (occurrences: Occurrence[]) => scheduleColumns(occurrences, days, NOW).map((column) => column.pills.filter((pill) => pill.onNow).map((pill) => pill.occurrence.title));

  it('is a timed event that has started and not ended, in today\'s column', () => {
    expect(ringed([event('Family dinner', '2026-10-01T23:30:00Z', '2026-10-02T01:00:00Z'), event('Piano', '2026-10-01T21:00:00Z', '2026-10-01T21:45:00Z'), event('Book club', '2026-10-02T01:00:00Z', '2026-10-02T02:00:00Z')])).toEqual([
      ['Family dinner'],
      [],
      [],
      [],
      [],
    ]);
  });

  it('is never an all-day event', () => {
    expect(ringed([allDay('Grandma visiting', '2026-10-01', '2026-10-02')])).toEqual([[], [], [], [], []]);
  });

  it('is the event\'s moment of starting, and not its moment of ending', () => {
    expect(ringed([event('Starts now', '2026-10-02T00:21:00Z', '2026-10-02T01:00:00Z'), event('Ends now', '2026-10-01T23:00:00Z', '2026-10-02T00:21:00Z')])[0]).toEqual(['Starts now']);
  });

  it('is only in today\'s column for an event that crosses midnight', () => {
    // 6:00 PM on Oct 1 to 2:00 AM on Oct 2: on now at 7:21 PM, and on both days, but ringed on today's only.
    expect(ringed([event('Sleepover', '2026-10-01T23:00:00Z', '2026-10-02T07:00:00Z')])).toEqual([['Sleepover'], [], [], [], []]);
  });

  it('is nothing in any column when the page does not hold today', () => {
    const nextWeek = pageDays('week', '2026-10-08', CHICAGO, NOW);
    expect(nextWeek.some((day) => day.isToday)).toBe(false);
    const columns = scheduleColumns([event('Sleepover', '2026-10-01T23:00:00Z', '2026-10-09T07:00:00Z')], nextWeek, NOW);
    expect(columns.flatMap((column) => column.pills).some((pill) => pill.onNow)).toBe(false);
  });

  it('is decided in the Household Timezone: today is the Household\'s today', () => {
    // 04:30Z is 1:30 PM on Thu Oct 1 in Tokyo, where Oct 1 is today at that instant.
    const at = new Date('2026-10-01T04:45:00Z');
    const tokyo = fiveDays(TOKYO, at);
    const [today] = scheduleColumns([event('Lunch', '2026-10-01T04:30:00Z', '2026-10-01T05:30:00Z')], tokyo, at);
    expect(today?.day.date).toBe('2026-10-01');
    expect(today?.pills.map((pill) => pill.onNow)).toEqual([true]);
    expect(isOnNow(event('Lunch', '2026-10-01T04:30:00Z', '2026-10-01T05:30:00Z'), tokyo[0]!, at)).toBe(true);
  });
});

describe('the words under a title', () => {
  const [today] = fiveDays(CHICAGO, NOW);

  it('is the start time with minutes, AM or PM, in the Household Timezone', () => {
    expect(pillTime(event('Standup', '2026-10-01T14:00:00Z', '2026-10-01T14:30:00Z'), today!)).toBe('9:00 AM');
    expect(pillTime(event('Dinner', '2026-10-02T00:30:00Z', '2026-10-02T02:00:00Z'), today!)).toBe('7:30 PM');
    expect(pillTime(event('Midnight snack', '2026-10-01T05:00:00Z', '2026-10-01T05:30:00Z'), today!)).toBe('12:00 AM');
  });

  it('is "All day" for an all-day event', () => {
    expect(pillTime(allDay('Photo day', '2026-10-01', '2026-10-02'), today!)).toBe('All day');
  });
});

describe('how many pills fit', () => {
  const fit = (heightPx: number, pillPx: number[], gapPx = 8, morePx = 48) => pillsThatFit({ heightPx, pillPx, gapPx, morePx });

  it('is every pill, and no button, when they all fit with their gaps', () => {
    expect(fit(172, [52, 52, 52])).toBe(3);
    expect(fit(600, [52, 70, 52])).toBe(3);
  });

  it('is none for a day with no pills', () => {
    expect(fit(500, [])).toBe(0);
    expect(fit(0, [])).toBe(0);
  });

  it('is one pill that fills the column exactly', () => {
    expect(fit(52, [52])).toBe(1);
  });

  it('leaves room for the button as soon as one pill does not fit: a pixel short, and the last pill goes', () => {
    // Three 52 px pills need 172. With the button, two pills need 52 + 8 + 52 + 8 + 48 = 168.
    expect(fit(171, [52, 52, 52])).toBe(2);
    expect(fit(168, [52, 52, 52])).toBe(2);
    expect(fit(167, [52, 52, 52])).toBe(1);
  });

  it('takes the room for the button from the pills, not from below them', () => {
    // 120 px holds two pills (112) but not two pills and the button; one pill and the button need 108.
    expect(fit(120, [52, 52, 52, 52])).toBe(1);
  });

  it('counts each pill at its own height: a pill of two lines takes more room', () => {
    // 70 + 52 + 52 + 70 and three gaps is 268 px; 200 px holds 70 + 8 + 52 + 8 + 48 = 186, not three pills and the button.
    expect(fit(200, [70, 52, 52, 70])).toBe(2);
    expect(fit(200, [52, 52, 70, 70])).toBe(2);
    expect(fit(200, [52, 70, 70, 52])).toBe(2);
  });

  it('is none when only the button fits, and none when not even that does', () => {
    expect(fit(50, [52, 52])).toBe(0);
    expect(fit(48, [52, 52])).toBe(0);
    expect(fit(10, [52, 52])).toBe(0);
    expect(fit(200, [300])).toBe(0);
  });

  it('takes the gap and the button as they are given', () => {
    // No gap: three pills and a 48 px button are 204 px. With 16 px gaps and a 40 px button, two pills and the button are 176.
    expect(fit(204, [52, 52, 52, 52], 0, 48)).toBe(3);
    expect(fit(203, [52, 52, 52, 52], 0, 48)).toBe(2);
    expect(fit(200, [52, 52, 52, 52], 16, 40)).toBe(2);
  });
});

describe('who a pill is for', () => {
  const profile = (id: string, name: string, sort: number, color: string): Profile => ({ id, name, color, avatar_url: null, sort_order: sort });
  const CORY = profile('p-cory', 'Cory', 0, '#93c5fd');
  const SAM = profile('p-sam', 'Sam', 1, '#f9a8d4');
  const AVA = profile('p-ava', 'Ava', 2, '#fcd34d');
  const BEN = profile('p-ben', 'Ben', 3, '#6ee7b7');
  const EMMA = profile('p-emma', 'Emma', 4, '#c4b5fd');
  const FAMILY = [CORY, SAM, AVA, BEN, EMMA];
  const meeting = (profileIds: string[], more: Partial<Occurrence> = {}) =>
    event('Meeting', '2026-10-01T14:00:00Z', '2026-10-01T15:00:00Z', { profile_ids: profileIds, profile_id: profileIds[0] ?? null, ...more });

  it('is the whole Household\'s look for an event with no Profile', () => {
    expect(pillPeople(meeting([]), FAMILY)).toEqual({ kind: 'everyone' });
  });

  it('is one fill and one disc for an event for one Profile', () => {
    expect(pillPeople(meeting(['p-ava']), FAMILY)).toEqual({ kind: 'people', bands: [AVA], discs: [AVA], more: 0, names: ['Ava'] });
  });

  it('is equal bands in Profile order for two or three, whichever order the event lists them in', () => {
    expect(pillPeople(meeting(['p-ben', 'p-cory']), FAMILY)).toEqual({ kind: 'people', bands: [CORY, BEN], discs: [CORY, BEN], more: 0, names: ['Cory', 'Ben'] });
    expect(pillPeople(meeting(['p-ava', 'p-sam', 'p-cory']), FAMILY)).toMatchObject({ kind: 'people', bands: [CORY, SAM, AVA], names: ['Cory', 'Sam', 'Ava'] });
  });

  // The row of discs is never more than two discs wide, so the time and the discs always fit under a title: one Profile is
  // a disc, two are two discs, and three or more are the first one's disc and a "+N" disc that counts the rest.
  it('shows one disc for one Profile and both discs for two', () => {
    expect(pillPeople(meeting(['p-ava']), FAMILY)).toMatchObject({ discs: [AVA], more: 0 });
    expect(pillPeople(meeting(['p-ben', 'p-cory']), FAMILY)).toMatchObject({ discs: [CORY, BEN], more: 0 });
  });

  it('shows a disc for the first Profile and a "+N" disc that counts the rest for three or more: three people are a disc and "+2"', () => {
    expect(pillPeople(meeting(['p-cory', 'p-sam', 'p-ava']), FAMILY)).toMatchObject({ bands: [CORY, SAM, AVA], discs: [CORY], more: 2 });
    expect(pillPeople(meeting(['p-ava', 'p-cory', 'p-sam', 'p-ben']), FAMILY)).toEqual({
      kind: 'people',
      bands: [CORY, SAM, AVA],
      discs: [CORY],
      more: 3,
      names: ['Cory', 'Sam', 'Ava', 'Ben'],
    });
  });

  it('is never more than two discs wide, whoever it is for, and never more than three bands', () => {
    const wide = (ids: string[]) => {
      const people = pillPeople(meeting(ids), FAMILY);
      return people.kind === 'people' ? { discs: people.discs.length + (people.more > 0 ? 1 : 0), bands: people.bands.length } : null;
    };
    expect(wide(['p-ava'])).toEqual({ discs: 1, bands: 1 });
    expect(wide(['p-ava', 'p-ben'])).toEqual({ discs: 2, bands: 2 });
    expect(wide(['p-ava', 'p-ben', 'p-sam'])).toEqual({ discs: 2, bands: 3 });
    expect(wide(['p-ava', 'p-ben', 'p-sam', 'p-cory'])).toEqual({ discs: 2, bands: 3 });
  });

  it('names everyone it is for, however many discs it draws', () => {
    expect(pillPeople(meeting(['p-cory', 'p-sam', 'p-ava', 'p-ben']), FAMILY)).toMatchObject({ names: ['Cory', 'Sam', 'Ava', 'Ben'] });
  });

  it('is the whole Household\'s look for an event for every Profile of a Household of two or more', () => {
    expect(pillPeople(meeting(['p-cory', 'p-sam', 'p-ava', 'p-ben', 'p-emma']), FAMILY)).toEqual({ kind: 'everyone' });
    expect(pillPeople(meeting(['p-cory', 'p-sam']), [CORY, SAM])).toEqual({ kind: 'everyone' });
  });

  describe('in a Household of one Profile', () => {
    it('is that Profile\'s own fill and disc for an event for them: nobody else is there to share it with', () => {
      expect(pillPeople(meeting(['p-cory']), [CORY])).toEqual({ kind: 'people', bands: [CORY], discs: [CORY], more: 0, names: ['Cory'] });
    });

    it('is the whole Household\'s look only for an event with no Profile, or none this Household has', () => {
      expect(pillPeople(meeting([]), [CORY])).toEqual({ kind: 'everyone' });
      expect(pillPeople(meeting(['p-gone']), [CORY])).toEqual({ kind: 'everyone' });
    });

    it('is named for that Profile, not "everyone"', () => {
      const [today] = fiveDays(CHICAGO, NOW);
      const occurrence = meeting(['p-cory']);
      const [column] = scheduleColumns([occurrence], [today!], new Date('2026-10-01T15:00:00Z'));
      expect(pillName(column!.pills[0]!, today!, pillPeople(occurrence, [CORY]))).toBe('Meeting, Cory, Thursday, October 1, 9:00 AM');
    });

    it('is the rule of two or more again as soon as there is a second Profile: every Profile, or none, is the Household\'s', () => {
      expect(pillPeople(meeting(['p-cory']), [CORY, SAM])).toMatchObject({ kind: 'people', bands: [CORY] });
      expect(pillPeople(meeting(['p-cory', 'p-sam']), [CORY, SAM])).toEqual({ kind: 'everyone' });
    });
  });

  it('leaves out a Profile that is not in the Household any more, and is the Household\'s when none is left', () => {
    expect(pillPeople(meeting(['p-gone', 'p-sam']), FAMILY)).toMatchObject({ kind: 'people', bands: [SAM], names: ['Sam'] });
    expect(pillPeople(meeting(['p-gone']), FAMILY)).toEqual({ kind: 'everyone' });
  });

  it('is the Profiles\' own colours, never the colour of the Mirrored Calendar the event came from', () => {
    const fromACalendar = meeting(['p-ava'], { color: '#ff0000', colors: ['#ff0000'] });
    const people = pillPeople(fromACalendar, FAMILY);
    expect(people.kind === 'people' && people.bands.map((band) => band.color)).toEqual([AVA.color]);
    // Synced here with several Profiles, as the preview's fixture does: the Profiles still decide, not the colours.
    const several = pillPeople(meeting(['p-cory', 'p-sam'], { color: '#ff0000', colors: ['#ff0000', '#00ff00'] }), FAMILY);
    expect(several.kind === 'people' && several.bands.map((band) => band.color)).toEqual([CORY.color, SAM.color]);
  });

  describe('its name', () => {
    const [today] = fiveDays(CHICAGO, NOW);
    const nameOf = (occurrence: Occurrence, onNow = false) => {
      const [column] = scheduleColumns([occurrence], [today!], onNow ? NOW : new Date('2026-10-01T15:00:00Z'));
      const pill = column!.pills[0]!;
      return pillName(pill, today!, pillPeople(occurrence, FAMILY));
    };

    it('says the title, who it is for, the day and the time', () => {
      expect(nameOf(meeting(['p-ava']))).toBe('Meeting, Ava, Thursday, October 1, 9:00 AM');
      expect(nameOf(meeting(['p-ava', 'p-ben']))).toBe('Meeting, Ava and Ben, Thursday, October 1, 9:00 AM');
      expect(nameOf(meeting(['p-cory', 'p-sam', 'p-ava']))).toBe('Meeting, Cory, Sam and Ava, Thursday, October 1, 9:00 AM');
      expect(nameOf(meeting(['p-cory', 'p-sam', 'p-ava', 'p-ben']))).toBe('Meeting, Cory, Sam, Ava and Ben, Thursday, October 1, 9:00 AM');
    });

    it('says everyone for the whole Household and "All day" for an all-day event', () => {
      expect(nameOf(allDay('Grandma visiting', '2026-10-01', '2026-10-02'))).toBe('Grandma visiting, everyone, Thursday, October 1, All day');
    });

    it('ends "added here" for a Native Event, and for no other', () => {
      expect(nameOf(meeting([], { source: 'native', calendar_id: null, calendar_name: 'Nidus' }))).toBe('Meeting, everyone, Thursday, October 1, 9:00 AM, added here');
      expect(nameOf(meeting([]))).not.toContain('added here');
    });

    it('says "on now" for an event that is on now, before "added here"', () => {
      const dinner = event('Family dinner', '2026-10-01T23:30:00Z', '2026-10-02T01:00:00Z', { source: 'native', calendar_id: null, calendar_name: 'Nidus' });
      expect(nameOf(dinner, true)).toBe('Family dinner, everyone, Thursday, October 1, 6:30 PM, on now, added here');
    });
  });
});

describe('the words on the people strip', () => {
  const profile = (id: string, name: string, sort: number): Profile => ({ id, name, color: '#93c5fd', avatar_url: null, sort_order: sort });
  const CORY = profile('p-cory', 'Cory', 0);
  const SAM = profile('p-sam', 'Sam', 1);
  const AVA = profile('p-ava', 'Ava', 2);
  const BEN = profile('p-ben', 'Ben', 3);

  const routines = (profileId: string, count: number): Routine[] =>
    Array.from({ length: count }, (_, index) => ({ id: `${profileId}-${index}`, profile_id: profileId, title: `Routine ${index}`, days_of_week: 127, time_of_day: null, sort_order: index, archived_at: null }));
  const group = (profile: Profile, count: number): ProfileRoutines => ({ profile, routines: routines(profile.id, count) });
  const ticked = (profileId: string, count: number) => Array.from({ length: count }, (_, index) => `${profileId}-${index}`);

  it('is "3 of 5" for a person part way through today\'s Routines', () => {
    const [person] = stripPeople([AVA], [group(AVA, 5)], new Set(ticked('p-ava', 3)));
    expect(person).toMatchObject({ profile: AVA, done: 3, total: 5, words: '3 of 5' });
  });

  it('is "All done" once every one is ticked', () => {
    const [person] = stripPeople([CORY], [group(CORY, 1)], new Set(ticked('p-cory', 1)));
    expect(person).toMatchObject({ done: 1, total: 1, words: 'All done' });
  });

  it('is "0 of 3" before the first tick', () => {
    expect(stripPeople([SAM], [group(SAM, 3)], new Set())[0]?.words).toBe('0 of 3');
  });

  it('is nothing for a person with no Routines today', () => {
    const [person] = stripPeople([BEN], [], new Set());
    expect(person).toMatchObject({ profile: BEN, done: 0, total: 0, words: '' });
  });

  it('is the count past eight Routines too: it is the pips that give way, not the words', () => {
    expect(stripPeople([AVA], [group(AVA, 9)], new Set(ticked('p-ava', 3)))[0]?.words).toBe('3 of 9');
  });

  it('is a person for every Profile, in the Profiles\' own order, whoever has Routines', () => {
    const people = stripPeople([CORY, SAM, AVA, BEN], [group(AVA, 5), group(CORY, 1)], new Set([...ticked('p-ava', 3), ...ticked('p-cory', 1)]));
    expect(people.map((person) => [person.profile.name, person.words])).toEqual([
      ['Cory', 'All done'],
      ['Sam', ''],
      ['Ava', '3 of 5'],
      ['Ben', ''],
    ]);
  });

  it('counts only the ticks of the Routines it was given: a tick of another day\'s Routine is not one', () => {
    const [person] = stripPeople([AVA], [group(AVA, 2)], new Set(['p-ava-0', 'someone-elses-routine']));
    expect(person).toMatchObject({ done: 1, total: 2, words: '1 of 2' });
  });

  it('is named for a screen reader with its progress, in the singular for one Routine', () => {
    const people = stripPeople([AVA, CORY, BEN], [group(AVA, 5), group(CORY, 1)], new Set(ticked('p-ava', 3)));
    expect(people.map((person) => person.label)).toEqual(['Ava, 3 of 5 Routines done', 'Cory, 0 of 1 Routine done', 'Ben']);
  });
});
