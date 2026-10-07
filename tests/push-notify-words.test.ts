import { describe, expect, it } from 'vitest';
import {
  clockWords,
  cut,
  makePayload,
  MAX_BODY,
  MAX_TITLE,
  morningBody,
  nextDate,
  reminderBody,
  routinesBody,
  zoned,
} from '../supabase/functions/push-notify/handler';

// The pure parts of the sender (spec 0007): words, payload limits and the Household's clock.
// Nothing here touches the database.

const EM_DASH = String.fromCharCode(0x2014);
const GRIN = String.fromCodePoint(0x1f600);

describe('cut', () => {
  it('leaves text within the limit alone', () => {
    expect(cut('abc', 3)).toBe('abc');
  });

  it('cuts to the limit with an ellipsis as the last character', () => {
    expect(cut('abcdef', 4)).toBe('abc…');
    expect(Array.from(cut('x'.repeat(500), 80))).toHaveLength(80);
  });

  it('counts characters, not code units, so an emoji is never split', () => {
    expect(cut(GRIN.repeat(4), 3)).toBe(`${GRIN.repeat(2)}…`);
  });
});

describe('makePayload', () => {
  it('keeps the title within 80 and the body within 300 characters', () => {
    const payload = makePayload('t'.repeat(200), 'b'.repeat(1000), '/', 'tag');
    expect(Array.from(payload.title)).toHaveLength(MAX_TITLE);
    expect(Array.from(payload.body)).toHaveLength(MAX_BODY);
    expect(payload.title.endsWith('…')).toBe(true);
    expect(payload.body.endsWith('…')).toBe(true);
  });

  it('stays well under the 2 KB iPhone limit at its largest', () => {
    const payload = makePayload(GRIN.repeat(200), GRIN.repeat(1000), '/day?date=2026-10-06', 'event:synced:00000000-0000-0000-0000-000000000000:1790000000000');
    expect(new TextEncoder().encode(JSON.stringify(payload)).length).toBeLessThan(2048);
  });

  it('is exactly { title, body, url, tag }', () => {
    expect(makePayload('Today', 'Nothing', '/', 'morning:2026-10-06')).toEqual({ title: 'Today', body: 'Nothing', url: '/', tag: 'morning:2026-10-06' });
  });
});

describe('the Household clock', () => {
  it('reads the Household date, minutes and weekday, not the machine zone', () => {
    // 2026-10-06 is a Tuesday. 13:30Z is 8:30 in Chicago (CDT) and 03:30 the next morning at +14.
    const at = Date.parse('2026-10-06T13:30:00Z');
    expect(zoned(at, 'America/Chicago')).toEqual({ date: '2026-10-06', minutes: 8 * 60 + 30, weekday: 2 });
    expect(zoned(at, 'Pacific/Kiritimati')).toEqual({ date: '2026-10-07', minutes: 3 * 60 + 30, weekday: 3 });
    expect(zoned(at, 'America/Los_Angeles')).toEqual({ date: '2026-10-06', minutes: 6 * 60 + 30, weekday: 2 });
  });

  it('puts 7:00 where the zone puts it across a spring-forward in Chicago', () => {
    // The clocks jump 2:00 to 3:00 on 2026-03-08: 7:00 is 13:00Z the day before, 12:00Z that day.
    expect(zoned(Date.parse('2026-03-07T13:00:00Z'), 'America/Chicago').minutes).toBe(7 * 60);
    expect(zoned(Date.parse('2026-03-08T11:59:00Z'), 'America/Chicago').minutes).toBe(6 * 60 + 59);
    expect(zoned(Date.parse('2026-03-08T12:00:00Z'), 'America/Chicago')).toMatchObject({ date: '2026-03-08', minutes: 7 * 60 });
  });

  it('puts 7:00 where the zone puts it across a fall-back in Auckland, far from UTC', () => {
    // Auckland ends daylight saving at 03:00 on 2026-04-05 (+13 to +12).
    expect(zoned(Date.parse('2026-04-03T18:00:00Z'), 'Pacific/Auckland')).toMatchObject({ date: '2026-04-04', minutes: 7 * 60 });
    expect(zoned(Date.parse('2026-04-04T19:00:00Z'), 'Pacific/Auckland')).toMatchObject({ date: '2026-04-05', minutes: 7 * 60 });
    // The UTC hour of "7:00" moved by one, the Household's did not.
    expect(zoned(Date.parse('2026-04-04T18:00:00Z'), 'Pacific/Auckland')).toMatchObject({ date: '2026-04-05', minutes: 6 * 60 });
  });

  it('gives the next date across month and year ends', () => {
    expect(nextDate('2026-10-06')).toBe('2026-10-07');
    expect(nextDate('2026-02-28')).toBe('2026-03-01');
    expect(nextDate('2026-12-31')).toBe('2027-01-01');
  });

  it('writes times of day as "8:30 AM" in the Household Timezone', () => {
    const at = Date.parse('2026-10-06T13:30:00Z');
    expect(clockWords(at, 'America/Chicago')).toBe('8:30 AM');
    expect(clockWords(at, 'Pacific/Kiritimati')).toBe('3:30 AM');
    expect(clockWords(Date.parse('2026-10-06T17:00:00Z'), 'America/Chicago')).toBe('12:00 PM');
    expect(clockWords(Date.parse('2026-10-06T05:05:00Z'), 'America/Chicago')).toBe('12:05 AM');
    expect(clockWords(Date.parse('2026-10-07T00:00:00Z'), 'America/Chicago')).toBe('7:00 PM');
    // Across the Auckland change the same UTC hour reads an hour apart.
    expect(clockWords(Date.parse('2026-04-04T18:30:00Z'), 'Pacific/Auckland')).toBe('6:30 AM');
    expect(clockWords(Date.parse('2026-04-03T18:30:00Z'), 'Pacific/Auckland')).toBe('7:30 AM');
  });
});

describe('reminderBody', () => {
  const start = Date.parse('2026-10-06T13:30:00Z');
  const minute = 60_000;

  it('says the time and the real minutes left', () => {
    expect(reminderBody(start, start - 15 * minute, 'America/Chicago', null)).toBe('At 8:30 AM, in 15 minutes');
    expect(reminderBody(start, start - minute, 'America/Chicago', null)).toBe('At 8:30 AM, in 1 minute');
  });

  it('rounds the minutes and says "now" under one minute', () => {
    expect(reminderBody(start, start - 14.6 * minute, 'America/Chicago', null)).toBe('At 8:30 AM, in 15 minutes');
    expect(reminderBody(start, start - 20_000, 'America/Chicago', null)).toBe('At 8:30 AM, now');
  });

  it('puts the location on a second line when there is one', () => {
    expect(reminderBody(start, start - 15 * minute, 'America/Chicago', 'Pool')).toBe('At 8:30 AM, in 15 minutes\nPool');
    expect(reminderBody(start, start - 15 * minute, 'America/Chicago', '  ')).toBe('At 8:30 AM, in 15 minutes');
  });
});

describe('morningBody', () => {
  const zone = 'America/Chicago';
  const dayStart = Date.parse('2026-10-06T05:00:00Z');
  const dayEnd = dayStart + 86_400_000;
  const at = (hour: number, minute = 0) => new Date(dayStart + (hour * 60 + minute) * 60_000).toISOString();
  const timed = (title: string, hour: number, minute = 0) => ({ title, starts_at: at(hour, minute), ends_at: at(hour + 1, minute), is_all_day: false });

  it('says so when there is nothing on the calendar', () => {
    expect(morningBody([], [], dayStart, dayEnd, zone)).toBe('Nothing on the calendar today.');
  });

  it('lists events in order, all-day first by its start, then meals in slot order', () => {
    const body = morningBody(
      [timed('Swim', 8, 30), { title: 'Holiday', starts_at: at(0), ends_at: at(24), is_all_day: true }],
      [
        { slot: 'dinner', title: 'Tacos' },
        { slot: 'breakfast', title: 'Eggs' },
      ],
      dayStart,
      dayEnd,
      zone,
    );
    expect(body).toBe('All day: Holiday\n8:30 AM Swim\nBreakfast: Eggs\nDinner: Tacos');
  });

  it('shows four events and then "and N more"', () => {
    const events = [8, 9, 10, 11, 12, 13, 14].map((hour) => timed(`E${hour}`, hour));
    expect(morningBody(events, [], dayStart, dayEnd, zone).split('\n')).toEqual(['8:00 AM E8', '9:00 AM E9', '10:00 AM E10', '11:00 AM E11', 'and 3 more']);
    expect(morningBody(events.slice(0, 5), [], dayStart, dayEnd, zone).split('\n').at(-1)).toBe('and 1 more');
    expect(morningBody(events.slice(0, 4), [], dayStart, dayEnd, zone)).not.toContain('more');
  });

  it('says "Until" for a timed event that began before today and ends today, and "All day" for one covering the whole day', () => {
    const before = new Date(dayStart - 3_600_000).toISOString();
    const untilHalfPastTwelve = { title: 'Sleepover', starts_at: before, ends_at: at(0, 30), is_all_day: false };
    expect(morningBody([untilHalfPastTwelve], [], dayStart, dayEnd, zone)).toBe('Until 12:30 AM Sleepover');
    const wholeDay = { title: 'Camp', starts_at: before, ends_at: new Date(dayEnd + 3_600_000).toISOString(), is_all_day: false };
    expect(morningBody([wholeDay], [], dayStart, dayEnd, zone)).toBe('All day: Camp');
    // Ending exactly at the next midnight still covers the whole day; a timed event starting today and running past it keeps its start.
    expect(morningBody([{ ...wholeDay, ends_at: new Date(dayEnd).toISOString() }], [], dayStart, dayEnd, zone)).toBe('All day: Camp');
    expect(morningBody([{ title: 'Night shift', starts_at: at(22), ends_at: at(30), is_all_day: false }], [], dayStart, dayEnd, zone)).toBe('10:00 PM Night shift');
  });

  it('writes no em-dashes', () => {
    expect(morningBody([timed('Swim', 8)], [{ slot: 'snack', title: 'Fruit' }], dayStart, dayEnd, zone)).not.toContain(EM_DASH);
  });
});

describe('routinesBody', () => {
  it('reads "Sam: 2 left. Mia: 1 left."', () => {
    expect(routinesBody([{ name: 'Sam', count: 2 }, { name: 'Mia', count: 1 }])).toBe('Sam: 2 left. Mia: 1 left.');
  });
});
