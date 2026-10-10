import { describe, expect, it } from 'vitest';
import { type Occurrence } from '../src/lib/calendar-occurrences';
import { pageDays, type WallDay } from '../src/lib/paged-view';
import type { Profile } from '../src/lib/profiles';
import { pillPeople } from '../src/lib/schedule';
import { aboveLabel, emptyRowWords, hourWindow, hourWords, hoursThatFit, planDay, whoWords, type DayPlan } from '../src/lib/day-view';
import { addDays, dayStartMs, offsetMs } from '../supabase/functions/_shared/zoned-time.ts';

// The Day view's rules, all pure: how many hours fit, which of them the grid shows, which events go in the row above it (all
// day, then what ended before its first hour), which in the row below (what starts after its last), where each block sits and
// how the ones that overlap share the width. Every date is read in the Household Timezone: no test reads the machine's, and the
// daylight saving days are tried in three zones that are not this machine's (Chicago, London, Auckland).

const CHICAGO = 'America/Chicago';
const LONDON = 'Europe/London';
const AUCKLAND = 'Pacific/Auckland';

// The instant of a wall clock time on a Household date, found the way dayStartMs finds midnight, so it is right in any zone
// and across a daylight saving change (except for a time the clocks skip or repeat: those tests give the instants themselves).
function wall(date: string, time: string, timezone: string): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  return naive - offsetMs(naive - offsetMs(naive, timezone), timezone);
}

let counter = 0;
function make(title: string, startsAt: number, endsAt: number, more: Partial<Occurrence> = {}): Occurrence {
  counter += 1;
  return {
    source: 'synced',
    id: `event-${counter}`,
    calendar_id: 'calendar-1',
    calendar_name: 'Family',
    title,
    description: null,
    location: null,
    starts_at: new Date(startsAt).toISOString(),
    ends_at: new Date(endsAt).toISOString(),
    is_all_day: false,
    profile_id: null,
    profile_ids: [],
    ...more,
  };
}

// A timed event on one Household date, from one wall clock time to another: `at('Piano', '2026-10-01', '16:00', '16:45')`.
const at = (title: string, date: string, from: string, to: string, timezone = CHICAGO, more: Partial<Occurrence> = {}) =>
  make(title, wall(date, from, timezone), wall(date, to, timezone), more);
// A timed event that ends on another date.
const across = (title: string, from: [string, string], to: [string, string], timezone = CHICAGO) => make(title, wall(from[0], from[1], timezone), wall(to[0], to[1], timezone));
// An all-day event: Household midnights, the end being the midnight after its last day.
const allDay = (title: string, firstDay: string, lastDay: string, timezone = CHICAGO) =>
  make(title, dayStartMs(firstDay, timezone), dayStartMs(addDays(lastDay, 1), timezone), { is_all_day: true });

// Thu Oct 1, 2026, 7:21 PM in Chicago (CDT): the drawings' clock.
const NOW = new Date(wall('2026-10-01', '19:21', CHICAGO));
const TODAY = '2026-10-01';
const TOMORROW = '2026-10-02';

const dayOf = (date: string, timezone: string, now: Date): WallDay => pageDays('day', date, timezone, now)[0]!;
const titles = (pills: readonly { occurrence: Occurrence }[]) => pills.map((pill) => pill.occurrence.title);
const shown = (view: DayPlan) => titles(view.blocks.map((block) => block.pill));

// The view of a day: today's (the clock being `now`) or another one, with `fit` hours that fit.
function view(occurrences: Occurrence[], options: { date?: string; now?: Date; fit?: number; timezone?: string } = {}): DayPlan {
  const { date = TODAY, now = NOW, fit = 8, timezone = CHICAGO } = options;
  return planDay({ occurrences, day: dayOf(date, timezone, now), now, fit });
}
const windowOf = (occurrences: Occurrence[], options: { date?: string; now?: Date; fit?: number; timezone?: string } = {}) => {
  const { date = TODAY, now = NOW, fit = 8, timezone = CHICAGO } = options;
  return hourWindow({ occurrences, day: dayOf(date, timezone, now), now, fit });
};
const clock = (date: string, time: string, timezone = CHICAGO) => new Date(wall(date, time, timezone));

describe('the hours that fit', () => {
  it('are the whole hours in the room, an hour being 3 rem', () => {
    // 384 px is eight 48 px hours: what the 1280 x 800 Wall has.
    expect(hoursThatFit(384, 48)).toBe(8);
    expect(hoursThatFit(431, 48)).toBe(8);
    expect(hoursThatFit(432, 48)).toBe(9);
    // Larger text makes the hour larger, so fewer fit.
    expect(hoursThatFit(384, 60)).toBe(6);
  });

  it('are at least one and at most a day', () => {
    expect(hoursThatFit(10, 48)).toBe(1);
    expect(hoursThatFit(-5, 48)).toBe(1);
    expect(hoursThatFit(5000, 48)).toBe(24);
  });
});

describe('the window on today', () => {
  it('starts one hour before now and runs for the hours that fit', () => {
    // 1:30 PM: from 12 PM.
    expect(windowOf([], { now: clock(TODAY, '13:30') })).toEqual({ startHour: 12, endHour: 20 });
    // 9:05 AM: from 8 AM.
    expect(windowOf([], { now: clock(TODAY, '09:05') })).toEqual({ startHour: 8, endHour: 16 });
  });

  it('starts at a whole hour, the hour before the one now is in', () => {
    expect(windowOf([], { now: clock(TODAY, '13:00') }).startHour).toBe(12);
    expect(windowOf([], { now: clock(TODAY, '13:59') }).startHour).toBe(12);
    expect(windowOf([], { now: clock(TODAY, '14:00') }).startHour).toBe(13);
  });

  it('in the early morning starts at 4 AM at ten past five, and never before midnight', () => {
    expect(windowOf([], { now: clock(TODAY, '05:10') })).toEqual({ startHour: 4, endHour: 12 });
    expect(windowOf([], { now: clock(TODAY, '00:30') })).toEqual({ startHour: 0, endHour: 8 });
    expect(windowOf([], { now: clock(TODAY, '00:00') })).toEqual({ startHour: 0, endHour: 8 });
    expect(windowOf([], { now: clock(TODAY, '01:59') })).toEqual({ startHour: 0, endHour: 8 });
  });

  it('is slid back so it ends by midnight: at 7:21 PM it is 4 PM to midnight', () => {
    expect(windowOf([])).toEqual({ startHour: 16, endHour: 24 });
    expect(windowOf([], { now: clock(TODAY, '16:30') })).toEqual({ startHour: 15, endHour: 23 });
    expect(windowOf([], { now: clock(TODAY, '17:00') })).toEqual({ startHour: 16, endHour: 24 });
  });

  it('at 11 PM is the last eight hours of the day, and still holds now', () => {
    for (const time of ['23:00', '23:30', '23:59']) {
      const now = clock(TODAY, time);
      expect(windowOf([], { now }), time).toEqual({ startHour: 16, endHour: 24 });
      expect(view([], { now }).nowHour, time).not.toBeNull();
    }
  });

  it('takes whatever number of hours fit', () => {
    expect(windowOf([], { fit: 6 })).toEqual({ startHour: 18, endHour: 24 });
    expect(windowOf([], { fit: 10 })).toEqual({ startHour: 14, endHour: 24 });
    expect(windowOf([], { fit: 3, now: clock(TODAY, '13:30') })).toEqual({ startHour: 12, endHour: 15 });
    // The whole day fits, or more than does.
    expect(windowOf([], { fit: 24 })).toEqual({ startHour: 0, endHour: 24 });
    expect(windowOf([], { fit: 40 })).toEqual({ startHour: 0, endHour: 24 });
  });

  it('keeps now inside when only one hour fits', () => {
    expect(windowOf([], { fit: 1 })).toEqual({ startHour: 19, endHour: 20 });
    expect(windowOf([], { fit: 0 })).toEqual({ startHour: 19, endHour: 20 });
  });

  it('does not depend on the events', () => {
    const events = [at('Early', TODAY, '06:00', '07:00'), at('Late', TODAY, '23:00', '23:30')];
    expect(windowOf(events)).toEqual(windowOf([]));
  });
});

describe('the window on another day', () => {
  it('starts at the first timed event that starts that day', () => {
    // 9:30 AM: from 9 AM, for eight hours.
    expect(windowOf([at('Dentist', TOMORROW, '09:30', '10:30'), at('Soccer', TOMORROW, '17:00', '18:00')], { date: TOMORROW })).toEqual({ startHour: 9, endHour: 17 });
  });

  it('finds the first whatever order the events come in', () => {
    const events = [at('Soccer', TOMORROW, '17:00', '18:00'), at('Dentist', TOMORROW, '11:15', '12:00'), at('Swim', TOMORROW, '13:00', '14:00')];
    expect(windowOf(events, { date: TOMORROW })).toEqual({ startHour: 11, endHour: 19 });
  });

  it('is 8 AM with no events, and with only all-day ones', () => {
    expect(windowOf([], { date: TOMORROW })).toEqual({ startHour: 8, endHour: 16 });
    expect(windowOf([allDay('Photo day', TOMORROW, TOMORROW)], { date: TOMORROW })).toEqual({ startHour: 8, endHour: 16 });
  });

  it('is slid back so it ends by midnight when the first event is late', () => {
    expect(windowOf([at('Late show', TOMORROW, '22:00', '23:30')], { date: TOMORROW })).toEqual({ startHour: 16, endHour: 24 });
    expect(windowOf([at('Last call', TOMORROW, '23:45', '23:59')], { date: TOMORROW })).toEqual({ startHour: 16, endHour: 24 });
    expect(windowOf([at('Afternoon', TOMORROW, '15:00', '16:00')], { date: TOMORROW, fit: 5 })).toEqual({ startHour: 15, endHour: 20 });
    expect(windowOf([at('Evening', TOMORROW, '21:00', '22:00')], { date: TOMORROW, fit: 5 })).toEqual({ startHour: 19, endHour: 24 });
  });

  it('never starts before midnight', () => {
    expect(windowOf([at('Early flight', TOMORROW, '00:15', '01:00')], { date: TOMORROW })).toEqual({ startHour: 0, endHour: 8 });
  });

  it('does not count an event that began on the day before, or one that covers the whole day', () => {
    const sleepover = across('Sleepover', [TODAY, '22:00'], [TOMORROW, '08:00']);
    const trip = across('Trip', [TODAY, '09:00'], ['2026-10-04', '17:00']);
    const events = [sleepover, trip, at('Dentist', TOMORROW, '11:00', '12:00')];
    expect(windowOf(events, { date: TOMORROW })).toEqual({ startHour: 11, endHour: 19 });
    // With nothing else that day it is 8 AM, not midnight.
    expect(windowOf([sleepover, trip], { date: TOMORROW })).toEqual({ startHour: 8, endHour: 16 });
  });

  it('is the same on a past day and a day far ahead, and ignores events of other days', () => {
    const events = [at('Elsewhere', '2026-10-09', '06:00', '07:00')];
    expect(windowOf(events, { date: '2026-09-20' })).toEqual({ startHour: 8, endHour: 16 });
    expect(windowOf([at('Dentist', '2026-12-04', '10:00', '11:00')], { date: '2026-12-04' })).toEqual({ startHour: 10, endHour: 18 });
  });

  it('takes the first event by the wall clock of the Household Timezone, not UTC', () => {
    // 9:00 AM in Auckland is 20:00Z the day before: UTC would call it another day. (Chicago's Oct 1 evening is already Oct 2 there.)
    const events = [at('School run', '2026-10-05', '09:00', '09:30', AUCKLAND)];
    expect(windowOf(events, { date: '2026-10-05', timezone: AUCKLAND })).toEqual({ startHour: 9, endHour: 17 });
  });
});

describe('the window on a 23 and a 25 hour day', () => {
  // The clocks go forward (23 hours) and back (25) on these dates, and the Wall's grid is the wall clock all the same: its hours
  // are 0 to 24 on the clock, so a window still ends by midnight.
  const CHANGES = [
    { name: 'Chicago forward', date: '2026-03-08', timezone: CHICAGO, hours: 23 },
    { name: 'Chicago back', date: '2026-11-01', timezone: CHICAGO, hours: 25 },
    { name: 'London forward', date: '2026-03-29', timezone: LONDON, hours: 23 },
    { name: 'London back', date: '2026-10-25', timezone: LONDON, hours: 25 },
    { name: 'Auckland forward', date: '2026-09-27', timezone: AUCKLAND, hours: 23 },
    { name: 'Auckland back', date: '2026-04-05', timezone: AUCKLAND, hours: 25 },
  ];

  it('is a day of the length the zone gives it', () => {
    for (const { name, date, timezone, hours } of CHANGES) {
      const day = dayOf(date, timezone, new Date(wall(date, '12:00', timezone)));
      expect((day.endMs - day.startMs) / 3_600_000, name).toBe(hours);
    }
  });

  it('at 11 PM is the last eight hours, whichever the length of the day', () => {
    for (const { name, date, timezone } of CHANGES) {
      const now = clock(date, '23:00', timezone);
      expect(windowOf([], { date, now, timezone }), name).toEqual({ startHour: 16, endHour: 24 });
    }
  });

  it('with no events, or a late one, starts at 8 AM or slides back to end by midnight', () => {
    for (const { name, date, timezone } of CHANGES) {
      const now = clock(addDays(date, -3), '12:00', timezone);
      expect(windowOf([], { date, now, timezone }), name).toEqual({ startHour: 8, endHour: 16 });
      expect(windowOf([at('Late', date, '22:30', '23:30', timezone)], { date, now, timezone }), name).toEqual({ startHour: 16, endHour: 24 });
      expect(windowOf([at('Morning', date, '09:15', '10:00', timezone)], { date, now, timezone }), name).toEqual({ startHour: 9, endHour: 17 });
    }
  });

  it('starts one real hour before now, which on a clock that jumped is not an hour on the wall', () => {
    // Chicago forward: 2:00 AM CST jumps to 3:00 CDT at 08:00Z. At 3:30 AM CDT (08:30Z) the hour before is 1:30 AM CST (07:30Z),
    // not 2:30 AM, which the day does not have.
    const spring = new Date('2026-03-08T08:30:00Z');
    expect(windowOf([], { date: '2026-03-08', now: spring })).toEqual({ startHour: 1, endHour: 9 });
    // Chicago back: 2:00 AM CDT falls back to 1:00 CST at 07:00Z. At 1:30 AM CST (07:30Z) the hour before, 06:30Z, is 1:30 AM CDT.
    const fall = new Date('2026-11-01T07:30:00Z');
    expect(windowOf([], { date: '2026-11-01', now: fall })).toEqual({ startHour: 1, endHour: 9 });
    // And at 3:00 AM CST (09:00Z) it is 2:00 AM CST.
    expect(windowOf([], { date: '2026-11-01', now: new Date('2026-11-01T09:00:00Z') })).toEqual({ startHour: 2, endHour: 10 });
  });

  it('counts the hour before now as an hour in London and in Auckland too', () => {
    // London forward: 01:00 GMT jumps to 02:00 BST at 01:00Z. At 02:30 BST (01:30Z) the hour before is 00:30 GMT, wall hour 0.
    expect(windowOf([], { date: '2026-03-29', timezone: LONDON, now: new Date('2026-03-29T01:30:00Z') })).toEqual({ startHour: 0, endHour: 8 });
    // London back: 02:00 BST falls back to 01:00 GMT at 01:00Z. At 01:30 GMT (01:30Z) the hour before is 01:30 BST (00:30Z).
    expect(windowOf([], { date: '2026-10-25', timezone: LONDON, now: new Date('2026-10-25T01:30:00Z') })).toEqual({ startHour: 1, endHour: 9 });
    // Auckland forward: 02:00 NZST jumps to 03:00 NZDT at 14:00Z on the 26th. At 03:30 NZDT (14:30Z) the hour before is 01:30 NZST.
    expect(windowOf([], { date: '2026-09-27', timezone: AUCKLAND, now: new Date('2026-09-26T14:30:00Z') })).toEqual({ startHour: 1, endHour: 9 });
    // Auckland back: 03:00 NZDT falls back to 02:00 NZST at 14:00Z on the 4th. At 02:30 NZST (14:30Z) the hour before is 02:30 NZDT.
    expect(windowOf([], { date: '2026-04-05', timezone: AUCKLAND, now: new Date('2026-04-04T14:30:00Z') })).toEqual({ startHour: 2, endHour: 10 });
  });

  it('puts the now line on the wall clock', () => {
    // 18:00Z on 2026-11-01 is noon CST, 13 hours after midnight in real time and 12 on the clock.
    expect(view([], { date: '2026-11-01', now: new Date('2026-11-01T18:00:00Z'), fit: 24 }).nowHour).toBeCloseTo(12);
    expect(view([], { date: '2026-03-08', now: new Date('2026-03-08T18:00:00Z'), fit: 24 }).nowHour).toBeCloseTo(13);
  });
});

describe('the rows above and below the grid', () => {
  // Today at 7:21 PM: the grid is 4 PM to midnight.
  const standup = at('Standup', TODAY, '09:00', '09:30');
  const review = at('Design review', TODAY, '13:00', '14:00');
  const piano = at('Piano', TODAY, '16:00', '16:45');
  const dinner = at('Family dinner', TODAY, '18:30', '20:00');
  const book = at('Book club', TODAY, '20:00', '21:00');

  it('hold what ended before the grid, and the grid holds the rest', () => {
    const v = view([book, dinner, piano, review, standup]);
    expect(v.window).toEqual({ startHour: 16, endHour: 24 });
    expect(titles(v.above)).toEqual(['Standup', 'Design review']);
    expect(shown(v)).toEqual(['Piano', 'Family dinner', 'Book club']);
    expect(v.below).toEqual([]);
  });

  it('put the all-day events first, then what ended before, each in order', () => {
    const v = view([review, allDay('School photo day', TODAY, TODAY), standup, allDay('Grandma visiting', TODAY, '2026-10-03')]);
    expect(titles(v.above)).toEqual(['Grandma visiting', 'School photo day', 'Standup', 'Design review']);
    expect(v.above.map((pill) => pill.time)).toEqual(['All day', 'All day', '9:00 AM', '1:00 PM']);
  });

  it('follow Household dates: an all-day event in Tokyo is on its Tokyo day', () => {
    const tokyo = 'Asia/Tokyo';
    // Thu Oct 1 in Tokyo is Wed Sep 30 15:00Z to Thu Oct 1 15:00Z.
    const holiday = allDay('Holiday', TODAY, TODAY, tokyo);
    const now = clock(TODAY, '12:00', tokyo);
    expect(titles(view([holiday], { timezone: tokyo, now }).above)).toEqual(['Holiday']);
    expect(titles(view([holiday], { date: TOMORROW, timezone: tokyo, now }).above)).toEqual([]);
    expect(titles(view([holiday], { date: '2026-09-30', timezone: tokyo, now }).above)).toEqual([]);
  });

  it('call a timed event that covers the whole day all day, and keep it out of the grid', () => {
    const trip = across('Trip', ['2026-09-30', '09:00'], ['2026-10-03', '17:00']);
    const v = view([trip, standup, piano]);
    expect(titles(v.above)).toEqual(['Trip', 'Standup']);
    expect(v.above[0]!.time).toBe('All day');
    expect(shown(v)).toEqual(['Piano']);
  });

  it('hold what starts after the last hour on another day', () => {
    // The first event is at 9 AM, so the grid is 9 AM to 5 PM; 5 PM and later are below it.
    const v = view([at('Dentist', TOMORROW, '09:00', '10:00'), at('Dinner out', TOMORROW, '17:30', '19:00'), at('Soccer', TOMORROW, '17:00', '18:00'), at('Late show', TOMORROW, '21:00', '22:30')], { date: TOMORROW });
    expect(v.window).toEqual({ startHour: 9, endHour: 17 });
    expect(shown(v)).toEqual(['Dentist']);
    expect(titles(v.below)).toEqual(['Soccer', 'Dinner out', 'Late show']);
    expect(v.below.map((pill) => pill.time)).toEqual(['5:00 PM', '5:30 PM', '9:00 PM']);
    expect(v.above).toEqual([]);
  });

  it('are empty arrays when nothing is there, so the rows keep their place', () => {
    const v = view([]);
    expect(v.above).toEqual([]);
    expect(v.below).toEqual([]);
    expect(v.blocks).toEqual([]);
    expect(v.folds).toEqual([]);
  });

  it('count an event that ends exactly at the first hour as before the grid, and one that starts at the last hour as after it', () => {
    // 2 PM to 4 PM ends as the grid begins: nothing of it would be drawn.
    expect(titles(view([at('Lesson', TODAY, '14:00', '16:00')]).above)).toEqual(['Lesson']);
    // 5 PM to 6 PM starts as the grid (9 AM to 5 PM) ends.
    const v = view([at('First', TOMORROW, '09:00', '09:30'), at('Soccer', TOMORROW, '17:00', '18:00'), at('Tea', TOMORROW, '16:30', '17:00')], { date: TOMORROW });
    expect(titles(v.below)).toEqual(['Soccer']);
    expect(shown(v)).toEqual(['First', 'Tea']);
  });

  it('draw an event that is partly inside the grid, from where the grid begins', () => {
    const v = view([at('Long lesson', TODAY, '15:00', '17:00')]);
    expect(v.above).toEqual([]);
    expect(shown(v)).toEqual(['Long lesson']);
    // 3 PM to 5 PM clipped to 4 PM to 5 PM.
    expect(v.blocks[0]).toMatchObject({ topHour: 16, bottomHour: 17 });
  });

  it('keep an event of no length at the first hour in the grid, and one before it above', () => {
    const at4 = make('Reminder', wall(TODAY, '16:00', CHICAGO), wall(TODAY, '16:00', CHICAGO));
    const before = make('Earlier reminder', wall(TODAY, '15:59', CHICAGO), wall(TODAY, '15:59', CHICAGO));
    const v = view([at4, before]);
    expect(shown(v)).toEqual(['Reminder']);
    expect(titles(v.above)).toEqual(['Earlier reminder']);
  });

  it('are never made from an event that is not on that day', () => {
    const endsAtMidnight = make('Ends at midnight', wall('2026-09-30', '22:00', CHICAGO), dayStartMs(TODAY, CHICAGO));
    const v = view([at('Elsewhere', '2026-10-05', '10:00', '11:00'), at('Yesterday', '2026-09-30', '10:00', '11:00'), endsAtMidnight]);
    expect(v.above).toEqual([]);
    expect(v.blocks).toEqual([]);
    expect(v.below).toEqual([]);
  });

  it('say what a carried-over event has left, in the row above when it ended before the grid', () => {
    const sleepover = across('Sleepover', [TODAY, '22:00'], [TOMORROW, '08:00']);
    const v = view([sleepover, at('Dentist', TOMORROW, '11:00', '12:00')], { date: TOMORROW });
    expect(titles(v.above)).toEqual(['Sleepover']);
    expect(v.above[0]!.time).toBe('Until 8:00 AM');
  });
});

describe('an event across midnight', () => {
  it('is drawn to the bottom of its first day and from the top of its second', () => {
    const sleepover = across('Sleepover', [TODAY, '22:00'], [TOMORROW, '08:00']);
    // Today (4 PM to midnight): 10 PM to the end of the grid.
    const first = view([sleepover]);
    expect(first.blocks).toHaveLength(1);
    expect(first.blocks[0]).toMatchObject({ topHour: 22, bottomHour: 24, lane: 0, lanes: 1 });
    expect(first.blocks[0]!.pill.time).toBe('10:00 PM');
    // The next morning, with the grid starting at midnight (an early event pulls it there): the top of the grid to 8 AM.
    const second = view([sleepover, at('Early run', TOMORROW, '06:00', '07:00')], { date: TOMORROW, fit: 24 });
    expect(second.blocks.find((block) => block.pill.occurrence.title === 'Sleepover')).toMatchObject({ topHour: 0, bottomHour: 8 });
    expect(second.blocks.find((block) => block.pill.occurrence.title === 'Sleepover')!.pill.time).toBe('Until 8:00 AM');
  });

  it('is not on the next day when it ends at midnight', () => {
    const late = make('Late movie', wall(TODAY, '22:00', CHICAGO), dayStartMs(TOMORROW, CHICAGO));
    expect(view([late], { date: TOMORROW }).blocks).toEqual([]);
    expect(view([late], { date: TOMORROW }).above).toEqual([]);
    const today = view([late]);
    expect(today.blocks[0]).toMatchObject({ topHour: 22, bottomHour: 24 });
    expect(today.blocks[0]!.pill.time).toBe('10:00 PM to 12:00 AM');
  });
});

describe('where a block sits', () => {
  it('is at its time, an hour being one unit of the window and a block never under an hour', () => {
    const v = view([at('Piano', TODAY, '16:00', '16:45'), at('Family dinner', TODAY, '18:30', '20:00'), at('Book club', TODAY, '20:00', '21:00')]);
    expect(v.blocks.map((block) => [block.pill.occurrence.title, block.topHour, block.bottomHour])).toEqual([
      // 45 minutes is drawn an hour tall, because no block is under 48 px, which is an hour.
      ['Piano', 16, 17],
      ['Family dinner', 18.5, 20],
      ['Book club', 20, 21],
    ]);
  });

  it('is exactly an hour for an hour-long event', () => {
    const [block] = view([at('Book club', TODAY, '20:00', '21:00')]).blocks;
    expect(block!.bottomHour - block!.topHour).toBe(1);
  });

  it('is filed by Household date when UTC says another day', () => {
    // 03:00Z on Oct 2 is 22:00 on Oct 1 in Chicago.
    const v = view([make('Late', Date.parse('2026-10-02T03:00:00Z'), Date.parse('2026-10-02T04:00:00Z'))]);
    expect(v.blocks[0]).toMatchObject({ topHour: 22, bottomHour: 23 });
  });

  it('is drawn up from the end of the grid when a short event would run past it', () => {
    // 11:30 PM to 11:45 PM is a quarter hour: it is drawn an hour tall, so it is drawn from 11 PM to keep to the grid.
    const v = view([at('Late call', TODAY, '23:30', '23:45')]);
    expect(v.blocks[0]).toMatchObject({ topHour: 23, bottomHour: 24 });
    expect(v.blocks[0]!.pill.time).toBe('11:30 to 11:45 PM');
  });

  it('keeps the time it says to the event, however it is drawn', () => {
    const v = view([at('Piano', TODAY, '16:00', '16:45'), at('Lunch', TODAY, '11:30', '12:30'), at('Reminder', TODAY, '19:00', '19:00')], { fit: 24 });
    expect(Object.fromEntries(v.blocks.map((block) => [block.pill.occurrence.title, block.pill.time]))).toEqual({
      Piano: '4:00 to 4:45 PM',
      Lunch: '11:30 AM to 12:30 PM',
      Reminder: '7:00 PM',
    });
  });

  it('is in time order', () => {
    const v = view([at('C', TODAY, '20:00', '21:00'), at('A', TODAY, '16:00', '17:00'), at('B', TODAY, '18:00', '19:00')]);
    expect(shown(v)).toEqual(['A', 'B', 'C']);
  });

  it('has the now line at the time, inside the grid', () => {
    expect(view([]).nowHour).toBeCloseTo(19.35);
    // Another day has none.
    expect(view([], { date: TOMORROW }).nowHour).toBeNull();
  });

  it('is on now only for a timed event that is, and its pill says so', () => {
    const v = view([at('Family dinner', TODAY, '18:30', '20:00'), at('Piano', TODAY, '16:00', '16:45'), allDay('Photo day', TODAY, TODAY)]);
    expect(v.blocks.map((block) => [block.pill.occurrence.title, block.pill.onNow])).toEqual([
      ['Piano', false],
      ['Family dinner', true],
    ]);
    expect(v.above.map((pill) => pill.onNow)).toEqual([false]);
  });
});

describe('daylight saving days', () => {
  // The grid is the wall clock: a block sits on its wall clock time though the day is 23 or 25 hours long.
  it('draws an event at its wall-clock time on a 23 hour day', () => {
    // US clocks go forward on Sun 2026-03-08: 2:00 AM becomes 3:00 AM. 8:00 AM CDT is 13:00Z.
    const spring = new Date('2026-03-08T18:00:00Z');
    const v = view([make('Early', Date.parse('2026-03-08T13:00:00Z'), Date.parse('2026-03-08T14:00:00Z'))], { date: '2026-03-08', now: spring, fit: 24 });
    expect(v.blocks[0]).toMatchObject({ topHour: 8, bottomHour: 9 });
  });

  it('draws an event at its wall-clock time on a 25 hour day', () => {
    // Clocks go back on Sun 2026-11-01. 6:00 PM CST is 00:00Z on the 2nd.
    const fall = new Date('2026-11-01T18:00:00Z');
    const v = view([make('Dinner', Date.parse('2026-11-02T00:00:00Z'), Date.parse('2026-11-02T01:30:00Z'))], { date: '2026-11-01', now: fall, fit: 24 });
    expect(v.blocks[0]).toMatchObject({ topHour: 18, bottomHour: 19.5 });
  });

  it('draws the same wall clock time in London and Auckland', () => {
    for (const [date, timezone] of [
      ['2026-03-29', LONDON],
      ['2026-10-25', LONDON],
      ['2026-09-27', AUCKLAND],
      ['2026-04-05', AUCKLAND],
    ] as const) {
      const now = clock(date, '12:00', timezone);
      const v = view([at('Dinner', date, '18:00', '19:30', timezone)], { date, now, timezone, fit: 24 });
      expect(v.blocks[0], `${timezone} ${date}`).toMatchObject({ topHour: 18, bottomHour: 19.5 });
      expect(v.blocks[0]!.pill.time, `${timezone} ${date}`).toBe('6:00 to 7:30 PM');
    }
  });

  it('ends a block that runs to the end of a DST day at 24', () => {
    const spring = new Date('2026-03-08T18:00:00Z');
    // 22:00 Sunday CDT to 07:00 Monday CDT.
    const overnight = make('Overnight', Date.parse('2026-03-09T03:00:00Z'), Date.parse('2026-03-09T12:00:00Z'));
    const v = view([overnight], { date: '2026-03-08', now: spring, fit: 24 });
    expect(v.blocks[0]).toMatchObject({ topHour: 22, bottomHour: 24 });
    const monday = view([overnight], { date: '2026-03-09', now: spring, fit: 24 });
    expect(monday.blocks[0]!.topHour).toBe(0);
    expect(monday.blocks[0]!.bottomHour).toBeCloseTo(7);
  });

  it('keeps events that the repeated hour draws on the same spot out of one lane', () => {
    const fall = new Date('2026-11-01T18:00:00Z');
    // A: 00:00 to 01:59 CDT. B: 01:00 to 02:00 CST, an hour later in real time but the same wall-clock hour.
    const a = make('A', Date.parse('2026-11-01T05:00:00Z'), Date.parse('2026-11-01T06:59:00Z'));
    const b = make('B', Date.parse('2026-11-01T07:00:00Z'), Date.parse('2026-11-01T08:00:00Z'));
    const v = view([a, b], { date: '2026-11-01', now: fall, fit: 24 });
    const byTitle = Object.fromEntries(v.blocks.map((block) => [block.pill.occurrence.title, block]));
    expect(byTitle['A']).toMatchObject({ lanes: 2 });
    expect(byTitle['B']).toMatchObject({ lanes: 2 });
    expect(byTitle['A']!.lane).not.toBe(byTitle['B']!.lane);
  });

  it('never draws a block upside down across the repeated hour', () => {
    const fall = new Date('2026-11-01T18:00:00Z');
    // 01:30 CDT to 01:15 CST: the wall clock goes backwards.
    const v = view([make('Across', Date.parse('2026-11-01T06:30:00Z'), Date.parse('2026-11-01T07:15:00Z'))], { date: '2026-11-01', now: fall, fit: 24 });
    expect(v.blocks[0]!.bottomHour).toBeGreaterThan(v.blocks[0]!.topHour);
  });

  it('counts hours from the wall clock on a day that skips midnight', () => {
    // Santiago's clocks jump 00:00 to 01:00 on Sun 2026-09-06: that day starts at 01:00, 04:00Z.
    const santiago = 'America/Santiago';
    const now = new Date('2026-09-06T15:00:00Z');
    const v = view([make('Breakfast', Date.parse('2026-09-06T11:00:00Z'), Date.parse('2026-09-06T12:00:00Z'))], { date: '2026-09-06', now, timezone: santiago, fit: 24 });
    // 08:00 to 09:00 local (-03).
    expect(v.blocks[0]).toMatchObject({ topHour: 8, bottomHour: 9 });
    expect(v.nowHour).toBeCloseTo(12);
  });

  it('does not run past the bottom of the day before a skipped midnight', () => {
    // Santiago's clocks jump from 00:00 to 01:00 on Sun 2026-09-06, so Saturday ends at that jump.
    const santiago = 'America/Santiago';
    const now = new Date('2026-09-05T15:00:00Z');
    const v = view([make('Late', Date.parse('2026-09-06T01:00:00Z'), Date.parse('2026-09-06T05:00:00Z'))], { date: '2026-09-05', now, timezone: santiago, fit: 24 });
    // 21:00 Saturday (UTC-4 then) to past the jump: the Saturday block ends at 24, not 25.
    expect(v.blocks[0]).toMatchObject({ topHour: 21, bottomHour: 24 });
  });

  it('puts the row an event belongs in by the wall clock too', () => {
    // 12:30 PM CST on the 25 hour day: the grid is 11 AM to 7 PM, and an event in the repeated hour (00:30 CDT, 05:30Z) ended before it.
    const now = new Date('2026-11-01T18:30:00Z');
    const early = make('Early', Date.parse('2026-11-01T05:30:00Z'), Date.parse('2026-11-01T06:00:00Z'));
    const v = view([early, at('Lunch', '2026-11-01', '12:00', '13:00')], { date: '2026-11-01', now });
    expect(v.window).toEqual({ startHour: 11, endHour: 19 });
    expect(titles(v.above)).toEqual(['Early']);
    expect(shown(v)).toEqual(['Lunch']);
  });
});

describe('overlapping blocks', () => {
  const lanes = (v: DayPlan) => Object.fromEntries(v.blocks.map((block) => [block.pill.occurrence.title, [block.lane, block.lanes]]));

  it('are one lane when alone, and when they only touch', () => {
    const v = view([at('First', TODAY, '16:00', '17:00'), at('Second', TODAY, '17:00', '18:00'), at('Alone', TODAY, '20:00', '21:00')]);
    expect(lanes(v)).toEqual({ First: [0, 1], Second: [0, 1], Alone: [0, 1] });
    expect(v.folds).toEqual([]);
  });

  it('sit side by side when two overlap, and let later ones take the whole width again', () => {
    const v = view([at('A', TODAY, '16:00', '18:00'), at('B', TODAY, '17:00', '19:00'), at('Alone', TODAY, '21:00', '22:00')]);
    expect(lanes(v)).toEqual({ A: [0, 2], B: [1, 2], Alone: [0, 1] });
    expect(v.blocks.every((block) => !block.narrow)).toBe(true);
    expect(v.folds).toEqual([]);
  });

  it('sit side by side when short events follow each other closer than an hour, as each is drawn an hour tall', () => {
    const v = view([at('First', TODAY, '16:00', '16:30'), at('Second', TODAY, '16:30', '17:00')]);
    expect(lanes(v)).toEqual({ First: [0, 2], Second: [1, 2] });
  });

  it('reuse a lane once its event is over, so a long event with short ones beside it is still two lanes', () => {
    const v = view([at('Long', TODAY, '16:00', '19:00'), at('B', TODAY, '16:00', '17:00'), at('C', TODAY, '17:00', '18:00'), at('D', TODAY, '18:00', '19:00')]);
    expect(lanes(v)).toEqual({ Long: [0, 2], B: [1, 2], C: [1, 2], D: [1, 2] });
    expect(v.folds).toEqual([]);
  });

  it('draw a third event, and more, as "+N" in the second lane, and list the whole cluster', () => {
    const v = view([at('A', TODAY, '16:00', '17:00'), at('B', TODAY, '16:00', '17:00'), at('C', TODAY, '16:00', '17:00')]);
    // Two are drawn, side by side; the third is not drawn.
    expect(shown(v)).toEqual(['A', 'B']);
    expect(lanes(v)).toEqual({ A: [0, 2], B: [1, 2] });
    expect(v.folds).toHaveLength(1);
    expect(v.folds[0]).toMatchObject({ folded: 1, topHour: 16, bottomHour: 17 });
    // The list is every event of the cluster, the ones drawn too, in time order.
    expect(titles(v.folds[0]!.pills)).toEqual(['A', 'B', 'C']);
    // The second lane leaves room at its right for the "+1".
    expect(v.blocks.map((block) => block.narrow)).toEqual([false, true]);
  });

  it('count every event past the second', () => {
    const v = view([
      at('A', TODAY, '16:00', '17:30'),
      at('B', TODAY, '16:00', '17:30'),
      at('C', TODAY, '16:30', '17:30'),
      at('D', TODAY, '16:45', '18:00'),
      at('E', TODAY, '17:00', '18:00'),
    ]);
    expect(v.folds).toHaveLength(1);
    expect(v.folds[0]!.folded).toBe(3);
    expect(titles(v.folds[0]!.pills)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(shown(v)).toEqual(['A', 'B']);
    // The tile spans what the folded events take: from C at 4:30 to the end of D and E at 6 PM.
    expect(v.folds[0]).toMatchObject({ topHour: 16.5, bottomHour: 18 });
  });

  it('fold only what does not fit in two lanes at once, and keep the later events of the second lane', () => {
    const v = view([
      at('A', TODAY, '16:00', '19:00'),
      at('B', TODAY, '16:00', '17:00'),
      at('C', TODAY, '16:30', '17:30'),
      at('D', TODAY, '17:30', '18:30'),
    ]);
    // C is the third at once; D comes after B and fits the second lane.
    expect(shown(v)).toEqual(['A', 'B', 'D']);
    expect(lanes(v)).toEqual({ A: [0, 2], B: [1, 2], D: [1, 2] });
    expect(v.folds).toHaveLength(1);
    expect(v.folds[0]).toMatchObject({ folded: 1, topHour: 16.5, bottomHour: 17.5 });
    expect(titles(v.folds[0]!.pills)).toEqual(['A', 'B', 'C', 'D']);
    // B shares time with the tile, so it leaves room for it; D starts as the tile ends, so it keeps its lane to the edge.
    expect(Object.fromEntries(v.blocks.map((block) => [block.pill.occurrence.title, block.narrow]))).toEqual({ A: false, B: true, D: false });
  });

  it('keep clusters apart: one that folds does not touch another', () => {
    const v = view([
      at('A', TODAY, '16:00', '17:00'),
      at('B', TODAY, '16:00', '17:00'),
      at('C', TODAY, '16:00', '17:00'),
      at('Dinner', TODAY, '19:00', '20:00'),
      at('Book club', TODAY, '19:30', '20:30'),
    ]);
    expect(lanes(v)).toEqual({ A: [0, 2], B: [1, 2], Dinner: [0, 2], 'Book club': [1, 2] });
    expect(v.folds).toHaveLength(1);
    expect(titles(v.folds[0]!.pills)).toEqual(['A', 'B', 'C']);
  });

  it('make a tile for each cluster that needs one', () => {
    const v = view([
      at('A', TODAY, '16:00', '17:00'),
      at('B', TODAY, '16:00', '17:00'),
      at('C', TODAY, '16:00', '17:00'),
      at('D', TODAY, '19:00', '20:00'),
      at('E', TODAY, '19:00', '20:00'),
      at('F', TODAY, '19:00', '20:00'),
      at('G', TODAY, '19:00', '20:00'),
    ]);
    expect(v.folds.map((fold) => [fold.folded, fold.topHour, fold.bottomHour])).toEqual([
      [1, 16, 17],
      [2, 19, 20],
    ]);
  });

  it('judge the overlap by what is drawn, so a short event drawn up from the end of the grid meets the one before it', () => {
    const v = view([at('Show', TODAY, '22:30', '23:30'), at('Late call', TODAY, '23:30', '23:45')]);
    expect(lanes(v)).toEqual({ Show: [0, 2], 'Late call': [1, 2] });
  });

  it('are the same for every Profile: the filter has been applied before the day is built', () => {
    // Nothing here knows of Profiles: two events are two events whoever they are for.
    const v = view([at('A', TODAY, '16:00', '17:00', CHICAGO, { profile_ids: ['p-ava'] }), at('B', TODAY, '16:00', '17:00', CHICAGO, { profile_ids: ['p-ben', 'p-sam'] })]);
    expect(lanes(v)).toEqual({ A: [0, 2], B: [1, 2] });
  });
});

describe('a cluster that folds', () => {
  // A short event is drawn an hour tall, so a quarter hour takes a whole lane for an hour. When the lanes run out the events kept are
  // the ones that last longest, never the ones that happen to start first, so a long event is not hidden behind short ones.
  const lanes = (v: DayPlan) => Object.fromEntries(v.blocks.map((block) => [block.pill.occurrence.title, [block.lane, block.lanes]]));
  const narrow = (v: DayPlan) => Object.fromEntries(v.blocks.map((block) => [block.pill.occurrence.title, block.narrow]));

  it('keeps Walk, which overlaps neither of two short events in real time, and folds one of them: Nap, Snack, Walk', () => {
    const v = view([at('Nap', TOMORROW, '13:00', '13:15'), at('Snack', TOMORROW, '13:15', '13:30'), at('Walk', TOMORROW, '13:30', '14:30')], { date: TOMORROW });
    expect(shown(v)).toEqual(['Nap', 'Walk']);
    expect(lanes(v)).toEqual({ Nap: [0, 2], Walk: [1, 2] });
    expect(v.folds).toHaveLength(1);
    // Snack is the one that folds: its slot, an hour from 1:15, is what the tile spans, and the list is the whole cluster in time order.
    expect(v.folds[0]).toMatchObject({ folded: 1, topHour: 13.25, bottomHour: 14.25 });
    expect(titles(v.folds[0]!.pills)).toEqual(['Nap', 'Snack', 'Walk']);
    // Walk shares time with the tile and leaves room for it; Nap is in the other lane.
    expect(narrow(v)).toEqual({ Nap: false, Walk: true });
  });

  it('keeps the six hour event when two five minute events come before it: the school day is not hidden', () => {
    const v = view([at('Bell A', TOMORROW, '08:00', '08:05'), at('Bell B', TOMORROW, '08:05', '08:10'), at('School', TOMORROW, '08:10', '14:10')], { date: TOMORROW });
    expect(shown(v)).toEqual(['Bell A', 'School']);
    expect(lanes(v)).toEqual({ 'Bell A': [0, 2], School: [1, 2] });
    expect(v.folds).toHaveLength(1);
    expect(v.folds[0]).toMatchObject({ folded: 1 });
    expect(titles(v.folds[0]!.pills)).toEqual(['Bell A', 'Bell B', 'School']);
  });

  it('keeps the first two of three events of one length, as before', () => {
    const v = view([at('A', TOMORROW, '09:00', '10:00'), at('B', TOMORROW, '09:00', '10:00'), at('C', TOMORROW, '09:00', '10:00')], { date: TOMORROW });
    expect(shown(v)).toEqual(['A', 'B']);
    expect(v.folds[0]).toMatchObject({ folded: 1, topHour: 9, bottomHour: 10 });
  });

  it('folds ten of twelve that are all at once, keeping the first two', () => {
    const titlesOf = 'ABCDEFGHIJKL'.split('');
    const v = view(titlesOf.map((title) => at(title, TOMORROW, '10:00', '11:00')), { date: TOMORROW });
    expect(shown(v)).toEqual(['A', 'B']);
    expect(v.folds).toHaveLength(1);
    expect(v.folds[0]!.folded).toBe(10);
    expect(titles(v.folds[0]!.pills)).toEqual(titlesOf);
  });

  it('orders by how long an event really lasts, not by the hour it is drawn: 60 and 45 minutes beat 30, 15 and none', () => {
    const v = view(
      [
        at('Quarter', TOMORROW, '09:00', '09:15'),
        at('Half', TOMORROW, '09:00', '09:30'),
        at('Three quarters', TOMORROW, '09:00', '09:45'),
        at('Hour', TOMORROW, '09:00', '10:00'),
        at('Reminder', TOMORROW, '09:00', '09:00'),
      ],
      { date: TOMORROW },
    );
    expect(shown(v).sort()).toEqual(['Hour', 'Three quarters']);
    expect(v.folds[0]!.folded).toBe(3);
    expect(titles(v.folds[0]!.pills)).toHaveLength(5);
  });

  it('breaks a tie of length by the earlier start, then by the title', () => {
    // Three hours that overlap one another: the one that starts first and the one after it are kept, whatever the titles are.
    const byStart = view([at('Zed', TOMORROW, '09:00', '10:00'), at('Amy', TOMORROW, '09:10', '10:10'), at('Bob', TOMORROW, '09:20', '10:20')], { date: TOMORROW });
    expect(shown(byStart)).toEqual(['Zed', 'Amy']);
    // The same start and the same length: by title, however the events come in.
    const byTitle = view([at('C', TOMORROW, '09:00', '10:00'), at('A', TOMORROW, '09:00', '10:00'), at('B', TOMORROW, '09:00', '10:00')], { date: TOMORROW });
    expect(shown(byTitle)).toEqual(['A', 'B']);
  });

  it('draws the events it keeps in the lanes they would have had, in time order', () => {
    // Long fills the day's morning; Nap and Snack are short and overlap each other and Long: Long and Nap are kept.
    const v = view([at('Long', TOMORROW, '09:00', '12:00'), at('Nap', TOMORROW, '09:00', '09:15'), at('Snack', TOMORROW, '09:10', '09:25')], { date: TOMORROW });
    expect(shown(v)).toEqual(['Long', 'Nap']);
    expect(lanes(v)).toEqual({ Long: [0, 2], Nap: [1, 2] });
  });

  it('says which cluster each block and each "+N" belongs to, in time order, so a tile can follow its own blocks', () => {
    const v = view(
      [
        at('A', TOMORROW, '09:00', '10:00'),
        at('B', TOMORROW, '09:00', '10:00'),
        at('C', TOMORROW, '09:00', '10:00'),
        at('Dinner', TOMORROW, '11:30', '12:30'),
        ...['W', 'X', 'Y', 'Z'].map((title) => at(title, TOMORROW, '13:00', '14:00')),
      ],
      { date: TOMORROW },
    );
    expect(v.blocks.map((block) => [block.pill.occurrence.title, block.cluster])).toEqual([
      ['A', 0],
      ['B', 0],
      ['Dinner', 1],
      ['W', 2],
      ['X', 2],
    ]);
    expect(v.folds.map((fold) => fold.cluster)).toEqual([0, 2]);
  });

  it('lays a cluster that fits two lanes out as before, whatever its lengths', () => {
    // Nap and Snack and nothing else: two lanes are enough, so nothing folds and the order is the order of the start.
    const v = view([at('Nap', TOMORROW, '13:00', '13:15'), at('Snack', TOMORROW, '13:15', '13:30')], { date: TOMORROW });
    expect(shown(v)).toEqual(['Nap', 'Snack']);
    expect(lanes(v)).toEqual({ Nap: [0, 2], Snack: [1, 2] });
    expect(v.folds).toEqual([]);
  });

  it('keeps a long event across the day even when many short ones fall on it, and folds only the short ones', () => {
    const v = view(
      [at('All morning', TOMORROW, '09:00', '12:00'), at('Call 1', TOMORROW, '10:00', '10:05'), at('Call 2', TOMORROW, '10:10', '10:15'), at('Call 3', TOMORROW, '10:20', '10:25')],
      { date: TOMORROW },
    );
    // All morning, and the first of the calls that fit with it; the calls overlap each other (each is drawn an hour), so two fold.
    expect(shown(v)).toContain('All morning');
    expect(shown(v)).toHaveLength(2);
    expect(v.folds[0]!.folded).toBe(2);
  });
});

describe('the words', () => {
  it('label an hour of the grid', () => {
    expect([0, 1, 11, 12, 13, 16, 23, 24].map(hourWords)).toEqual(['12 AM', '1 AM', '11 AM', '12 PM', '1 PM', '4 PM', '11 PM', '12 AM']);
  });

  it('name the row above the grid for what is in it: all day events, what ended before the grid, or both', () => {
    const day = dayOf(TODAY, CHICAGO, NOW);
    const [holiday] = view([allDay('Holiday', TODAY, TODAY)]).above;
    const [breakfast] = view([at('Breakfast', TODAY, '08:00', '09:00')]).above;
    expect(aboveLabel([], day)).toBe('Earlier');
    expect(aboveLabel([holiday!], day)).toBe('All day');
    expect(aboveLabel([breakfast!], day)).toBe('Earlier');
    expect(aboveLabel([holiday!, breakfast!], day)).toBe('All day, earlier');
  });

  it('say what an empty row holds', () => {
    expect(emptyRowWords('earlier', true)).toBe('Nothing earlier today');
    expect(emptyRowWords('later', true)).toBe('Nothing later today');
    expect(emptyRowWords('later', false)).toBe('Nothing later');
    expect(emptyRowWords('earlier', false)).toBe('Nothing earlier');
  });

  it('say who an event is for, by name', () => {
    const profile = (id: string, name: string, sort: number): Profile => ({ id, name, color: '#93c5fd', avatar_url: null, sort_order: sort });
    const family = [profile('p-cory', 'Cory', 0), profile('p-sam', 'Sam', 1), profile('p-ava', 'Ava', 2), profile('p-ben', 'Ben', 3)];
    const who = (ids: string[], profiles = family) => whoWords(pillPeople(at('x', TODAY, '16:00', '17:00', CHICAGO, { profile_ids: ids }), profiles));
    expect(who(['p-ava'])).toBe('Ava');
    expect(who(['p-ben', 'p-ava'])).toBe('Ava and Ben');
    expect(who(['p-cory', 'p-sam', 'p-ava'])).toBe('Cory, Sam and Ava');
    expect(who(['p-cory', 'p-sam', 'p-ava'])).not.toContain('Ben');
    // More than a pill has room for: every name is still said.
    expect(who(['p-cory', 'p-sam', 'p-ava', 'p-ben'], [...family, profile('p-emma', 'Emma', 4)])).toBe('Cory, Sam, Ava and Ben');
  });

  it('say the name of the one person of a Household of one', () => {
    const alone = [{ id: 'p-cory', name: 'Cory', color: '#93c5fd', avatar_url: null, sort_order: 0 }];
    expect(whoWords(pillPeople(at('x', TODAY, '16:00', '17:00', CHICAGO, { profile_ids: ['p-cory'] }), alone))).toBe('Cory');
    expect(whoWords(pillPeople(at('x', TODAY, '16:00', '17:00'), alone))).toBe('Everyone');
  });

  it('say "Everyone" for the whole Household', () => {
    const family = [{ id: 'p-cory', name: 'Cory', color: '#93c5fd', avatar_url: null, sort_order: 0 }, { id: 'p-sam', name: 'Sam', color: '#f9a8d4', avatar_url: null, sort_order: 1 }];
    expect(whoWords(pillPeople(at('x', TODAY, '16:00', '17:00'), family))).toBe('Everyone');
    expect(whoWords(pillPeople(at('x', TODAY, '16:00', '17:00', CHICAGO, { profile_ids: ['p-cory', 'p-sam'] }), family))).toBe('Everyone');
    expect(whoWords(pillPeople(at('x', TODAY, '16:00', '17:00'), []))).toBe('Everyone');
  });
});
