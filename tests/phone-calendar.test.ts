import { describe, expect, it } from 'vitest';
import { pageDays, type Occurrence } from '../src/lib/calendar-occurrences';
import { MAX_DOTS, monthDots, pageWords, pickedDay, type MonthDot } from '../src/lib/phone-calendar';
import { filterOccurrences } from '../src/lib/profile-filter';
import type { Profile } from '../src/lib/profiles';

// The picked day of the phone's Week and Month, and a Month cell's dots: both pure, both read in the Household Timezone (a Household
// date), never the machine's. The instants below are chosen so that the Household's date and UTC's differ, which is what shows it.

const NEW_YORK = 'America/New_York';
const AUCKLAND = 'Pacific/Auckland';

describe('pickedDay of a week', () => {
  it('is today when the week holds it', () => {
    // Friday, October 2, 2026, noon in New York.
    const now = new Date('2026-10-02T16:00:00Z');
    expect(pickedDay('week', '2026-09-27', NEW_YORK, now)).toBe('2026-10-02');
  });

  it('is the Sunday when the week does not hold today, whichever week it is', () => {
    const now = new Date('2026-10-02T16:00:00Z');
    expect(pickedDay('week', '2026-10-04', NEW_YORK, now)).toBe('2026-10-04');
    expect(pickedDay('week', '2026-09-20', NEW_YORK, now)).toBe('2026-09-20');
  });

  it("takes any date of the week as its anchor, and is the week's own Sunday", () => {
    const now = new Date('2026-10-02T16:00:00Z');
    expect(pickedDay('week', '2026-10-08', NEW_YORK, now)).toBe('2026-10-04');
  });

  it('turns over at Household midnight, not at UTC midnight', () => {
    // 9 PM on Saturday Oct 31 in New York is already November 1 in UTC: the week of Oct 25 still holds today.
    expect(pickedDay('week', '2026-10-25', NEW_YORK, new Date('2026-11-01T01:00:00Z'))).toBe('2026-10-31');
    expect(pickedDay('week', '2026-11-01', NEW_YORK, new Date('2026-11-01T01:00:00Z'))).toBe('2026-11-01');
    // One second before midnight in New York (EDT, 04:00 UTC), and at it.
    expect(pickedDay('week', '2026-10-25', NEW_YORK, new Date('2026-11-01T03:59:59Z'))).toBe('2026-10-31');
    expect(pickedDay('week', '2026-10-25', NEW_YORK, new Date('2026-11-01T04:00:00Z'))).toBe('2026-10-25');
  });

  it('follows the Household Timezone ahead of UTC', () => {
    // 1 AM on Friday Oct 2 in Auckland is still Thursday in UTC.
    const now = new Date('2026-10-01T12:00:00Z');
    expect(pickedDay('week', '2026-09-27', AUCKLAND, now)).toBe('2026-10-02');
  });

  it('is right across the day the clocks go back (a 25 hour day)', () => {
    // Sunday Nov 1 2026 in New York: 1:30 AM EDT, 1:30 AM EST an hour later, and 11:59 PM EST is still Nov 1.
    for (const at of ['2026-11-01T05:30:00Z', '2026-11-01T06:30:00Z', '2026-11-02T04:59:59Z']) {
      expect(pickedDay('week', '2026-11-01', NEW_YORK, new Date(at))).toBe('2026-11-01');
      expect(pickedDay('week', '2026-10-25', NEW_YORK, new Date(at))).toBe('2026-10-25');
    }
    // Midnight into Nov 2 is 05:00 UTC, not 04:00: the day was an hour longer.
    expect(pickedDay('week', '2026-11-01', NEW_YORK, new Date('2026-11-02T05:00:00Z'))).toBe('2026-11-02');
  });

  it('is right across the day the clocks go forward (a 23 hour day)', () => {
    // Saturday Mar 7 11:59 PM EST is 04:59 UTC; Sunday Mar 8 has 23 hours and ends at 04:00 UTC on Mar 9 (EDT).
    expect(pickedDay('week', '2026-03-01', NEW_YORK, new Date('2026-03-08T04:59:00Z'))).toBe('2026-03-07');
    expect(pickedDay('week', '2026-03-08', NEW_YORK, new Date('2026-03-08T04:59:00Z'))).toBe('2026-03-08');
    expect(pickedDay('week', '2026-03-08', NEW_YORK, new Date('2026-03-08T07:00:00Z'))).toBe('2026-03-08');
    expect(pickedDay('week', '2026-03-08', NEW_YORK, new Date('2026-03-09T03:59:59Z'))).toBe('2026-03-08');
    // Midnight into Mar 9 is 04:00 UTC: the Sunday's week is the one that held Mar 8, and Mar 9 is the next week's.
    expect(pickedDay('week', '2026-03-08', NEW_YORK, new Date('2026-03-09T04:00:00Z'))).toBe('2026-03-09');
  });
});

describe('pickedDay of a month', () => {
  it('is today when the month holds it, else the 1st', () => {
    const now = new Date('2026-10-02T16:00:00Z');
    expect(pickedDay('month', '2026-10-01', NEW_YORK, now)).toBe('2026-10-02');
    expect(pickedDay('month', '2026-11-01', NEW_YORK, now)).toBe('2026-11-01');
    expect(pickedDay('month', '2026-09-01', NEW_YORK, now)).toBe('2026-09-01');
  });

  it('does not take today for a month that only shows it as a dimmed day of its grid', () => {
    // September's last row is Sept 27 to Oct 3, which holds Oct 2 without October's being September's.
    expect(pickedDay('month', '2026-09-01', NEW_YORK, new Date('2026-10-02T16:00:00Z'))).toBe('2026-09-01');
  });

  it('takes any date of the month as its anchor', () => {
    expect(pickedDay('month', '2026-11-17', NEW_YORK, new Date('2026-10-02T16:00:00Z'))).toBe('2026-11-01');
  });

  it('turns over at Household midnight on the last day of the month', () => {
    // 11:30 PM on Oct 31 in New York (EDT) is Nov 1 in UTC.
    const before = new Date('2026-11-01T03:30:00Z');
    expect(pickedDay('month', '2026-10-01', NEW_YORK, before)).toBe('2026-10-31');
    expect(pickedDay('month', '2026-11-01', NEW_YORK, before)).toBe('2026-11-01');
    const after = new Date('2026-11-01T04:00:00Z');
    expect(pickedDay('month', '2026-10-01', NEW_YORK, after)).toBe('2026-10-01');
    expect(pickedDay('month', '2026-11-01', NEW_YORK, after)).toBe('2026-11-01');
  });

  it('is right on the days the clocks change', () => {
    expect(pickedDay('month', '2026-11-01', NEW_YORK, new Date('2026-11-02T04:59:59Z'))).toBe('2026-11-01');
    expect(pickedDay('month', '2026-11-01', NEW_YORK, new Date('2026-11-02T05:00:00Z'))).toBe('2026-11-02');
    expect(pickedDay('month', '2026-03-01', NEW_YORK, new Date('2026-03-08T07:00:00Z'))).toBe('2026-03-08');
    expect(pickedDay('month', '2026-02-01', NEW_YORK, new Date('2026-03-08T07:00:00Z'))).toBe('2026-02-01');
  });

  it('follows the Household Timezone ahead of UTC', () => {
    // 1 AM on Oct 2 in Auckland: still Oct 1 in UTC.
    expect(pickedDay('month', '2026-10-01', AUCKLAND, new Date('2026-10-01T12:00:00Z'))).toBe('2026-10-02');
  });
});

describe('monthDots', () => {
  const profile = (id: string, name: string, order: number): Profile => ({ id, name, color: '#93c5fd', avatar_url: null, sort_order: order });
  const ava = profile('a', 'Ava', 0);
  const ben = profile('b', 'Ben', 1);
  const cory = profile('c', 'Cory', 2);
  const dee = profile('d', 'Dee', 3);
  const everyone = [ava, ben, cory, dee];

  let count = 0;
  const event = (profile_ids: string[]): Occurrence => ({
    source: 'synced',
    id: `e${++count}`,
    calendar_id: 'cal',
    calendar_name: 'Calendar',
    title: 'Something',
    description: null,
    location: null,
    starts_at: '2026-10-02T14:00:00Z',
    ends_at: '2026-10-02T15:00:00Z',
    is_all_day: false,
    profile_id: profile_ids[0] ?? null,
    profile_ids,
  });
  const who = (dots: MonthDot[]) => dots.map((dot) => (dot.kind === 'household' ? 'house' : dot.profile.name));

  it('has none for a day with no events', () => {
    expect(monthDots([], everyone)).toEqual([]);
  });

  it('is a dot for each person with an event, once however many events they have', () => {
    expect(who(monthDots([event(['b']), event(['b']), event(['a'])], everyone))).toEqual(['Ava', 'Ben']);
  });

  it("is the Household's dot for an event for nobody, and for one for every Profile of a Household of two or more", () => {
    expect(who(monthDots([event([])], everyone))).toEqual(['house']);
    expect(who(monthDots([event(['a', 'b', 'c', 'd'])], everyone))).toEqual(['house']);
    // In a Household of one, an event for that Profile is theirs.
    expect(who(monthDots([event(['a'])], [ava]))).toEqual(['Ava']);
  });

  it("is in the people strip's order: the Household first, then the people in the Profiles' own order, whatever the events' order", () => {
    const events = [event(['c']), event(['a']), event([])];
    expect(who(monthDots(events, everyone))).toEqual(['house', 'Ava', 'Cory']);
    expect(who(monthDots(events, [cory, ben, ava]))).toEqual(['house', 'Cory', 'Ava']);
  });

  it('is never more than three', () => {
    expect(MAX_DOTS).toBe(3);
    const events = [event(['d']), event(['c']), event(['b']), event(['a']), event([])];
    expect(who(monthDots(events, everyone))).toEqual(['house', 'Ava', 'Ben']);
    expect(monthDots([event(['a', 'b']), event(['c', 'd'])], everyone)).toHaveLength(3);
  });

  it('counts an event for two people as a dot for each', () => {
    expect(who(monthDots([event(['a', 'c'])], everyone))).toEqual(['Ava', 'Cory']);
  });

  it('is cut by the Profile filter: what the filter hides has no dot, and a shared event gives the pressed person alone', () => {
    const events = [event(['a']), event(['b']), event(['a', 'b']), event([])];
    const shown = (pressed: string[]) => who(monthDots(filterOccurrences(events, pressed), everyone, pressed));
    expect(shown([])).toEqual(['house', 'Ava', 'Ben']);
    expect(shown(['a'])).toEqual(['house', 'Ava']);
    expect(shown(['b'])).toEqual(['house', 'Ben']);
    // A day that only had Ben's events has nothing left for Ava.
    expect(who(monthDots(filterOccurrences([event(['b'])], ['a']), everyone, ['a']))).toEqual([]);
  });

  it('gives each dot the Profile it is for', () => {
    const [first] = monthDots([event(['b'])], everyone);
    expect(first).toEqual({ kind: 'person', profile: ben });
  });
});

describe('pageWords', () => {
  const NOW = new Date('2026-10-06T16:00:00Z');
  const words = (view: 'day' | 'week', anchor: string, today = '2026-10-06') => pageWords(pageDays(view, anchor, NEW_YORK, NOW), today);

  it('is a week as its first and last day, without the year while the week is in this one', () => {
    expect(words('week', '2026-10-04')).toBe('Oct 4 to Oct 10');
    expect(words('week', '2026-09-27')).toBe('Sep 27 to Oct 3');
  });

  it('is a day as its weekday and date', () => {
    expect(words('day', '2026-09-30')).toBe('Wed, Sep 30');
  });

  it('keeps the year for a page that is not in the current one, or that crosses into the next', () => {
    expect(words('week', '2027-01-10')).toContain('2027');
    expect(words('day', '2027-01-04')).toContain('2027');
    expect(words('week', '2026-12-27')).toContain('2027');
  });
});
