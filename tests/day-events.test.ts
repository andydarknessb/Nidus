import { afterEach, describe, expect, it } from 'vitest';
import { loadOccurrences } from '../src/lib/calendar-occurrences';
import { monthWeeks, type WallDay } from '../src/lib/paged-view';
import { dayEventsOf } from '../src/lib/day-events';
import { saveNativeEvent } from '../src/lib/native-events';
import { PROFILE_PALETTE, createProfile, type Profile } from '../src/lib/profiles';
import { dayStartMs, instantAt } from '../supabase/functions/_shared/zoned-time.ts';
import { arrangeCalendar, arrangeEvents, type EventInput } from './support/calendar';
import { asHouseholdAccount, createHousehold, destroyHousehold, type HouseholdAccount } from './support/supabase';

// The day events (spec 0008) against what the real database returns: a month read in one go however busy it is, each event on the
// Household Dates it covers, and the two rules of the Profile Filter. The Household is in Chicago, whose clocks go back on Sunday
// 2026-11-01, the first day of the month read.

const households: HouseholdAccount[] = [];
afterEach(async () => {
  for (const account of households.splice(0)) await destroyHousehold(account);
});

const CHICAGO = 'America/Chicago';
// The Wall's November 2026 page: Sunday 2026-11-01 to Saturday 2026-12-05.
const DAYS = monthWeeks('2026-11-01', CHICAGO, '2026-11-01').flat();
const day = (date: string): WallDay => {
  const found = DAYS.find((each) => each.date === date);
  if (!found) throw new Error(`${date} is not on the page`);
  return found;
};
// 36 a day through November: 1,080 occurrences in the month, past the 1,000 one request returns.
const PER_DAY = 36;
const titles = (occurrences: { title: string }[] | null) => occurrences?.map((occurrence) => occurrence.title) ?? null;

describe('the day events of a month', () => {
  it('reads a busy month whole, puts each event on its days across a daylight saving change, and filters by the pressed people', async () => {
    const account = await createHousehold('The Andersons');
    households.push(account);
    const phone = await asHouseholdAccount(account);
    const ava = await createProfile(phone, account.household.id, { name: 'Ava', color: PROFILE_PALETTE[0].hex, avatar_url: null }, 0);
    const ben = await createProfile(phone, account.household.id, { name: 'Ben', color: PROFILE_PALETTE[1].hex, avatar_url: null }, 1);
    const cory = await createProfile(phone, account.household.id, { name: 'Cory', color: PROFILE_PALETTE[2].hex, avatar_url: null }, 2);
    const profiles: Profile[] = [ava, ben, cory];

    // Ava's calendar: a busy November, every half hour from 06:00.
    const avas = await arrangeCalendar(account, { profileId: ava.id, name: 'Ava' });
    const busy: EventInput[] = [];
    for (let date = 1; date <= 30; date += 1) {
      const iso = `2026-11-${String(date).padStart(2, '0')}`;
      for (let slot = 0; slot < PER_DAY; slot += 1) {
        const startsAt = instantAt(iso, `${String(6 + Math.floor(slot / 2)).padStart(2, '0')}:${slot % 2 ? '30' : '00'}`, CHICAGO);
        busy.push({ google_event_id: `busy-${iso}-${slot}`, title: `Lesson ${slot}`, starts_at: new Date(startsAt).toISOString(), ends_at: new Date(startsAt + 25 * 60_000).toISOString() });
      }
    }
    await arrangeEvents(avas.calendarId, busy);

    // The whole Household's calendar: a trip from Friday Oct 30 to Monday Nov 2, all day, across the change.
    const family = await arrangeCalendar(account, { name: 'Family' });
    await arrangeEvents(family.calendarId, [
      { google_event_id: 'trip', title: 'Trip', starts_at: new Date(dayStartMs('2026-10-30', CHICAGO)).toISOString(), ends_at: new Date(dayStartMs('2026-11-03', CHICAGO)).toISOString(), is_all_day: true },
    ]);

    // A Native Event for Ava and Ben at 01:30 on Nov 1, the hour that happens twice: the first one, 06:30Z.
    await saveNativeEvent(phone, {
      title: 'Night feed',
      location: null,
      notes: null,
      starts_at: new Date(instantAt('2026-11-01', '01:30', CHICAGO)).toISOString(),
      ends_at: new Date(instantAt('2026-11-01', '02:00', CHICAGO)).toISOString(),
      is_all_day: false,
      profile_ids: [ava.id, ben.id],
    });

    const read = await loadOccurrences(phone, new Date(DAYS[0]!.startMs), new Date(DAYS[DAYS.length - 1]!.endMs));
    // Every one of them, in one call, each once.
    expect(read).toHaveLength(30 * PER_DAY + 2);
    expect(new Set(read.map((occurrence) => `${occurrence.source} ${occurrence.id}`)).size).toBe(read.length);

    const everyone = dayEventsOf(read, profiles, []);
    // Sunday Nov 1 is 25 hours long. All day first, then by start: the trip, the night feed, then the day's lessons.
    expect(day('2026-11-01').endMs - day('2026-11-01').startMs).toBe(25 * 3_600_000);
    expect(titles(everyone.on(day('2026-11-01')))!.slice(0, 3)).toEqual(['Trip', 'Night feed', 'Lesson 0']);
    expect(everyone.on(day('2026-11-01'))).toHaveLength(PER_DAY + 2);
    // The trip is on Monday too, and ends at Tuesday's midnight.
    expect(titles(everyone.on(day('2026-11-02')))!.slice(0, 2)).toEqual(['Trip', 'Lesson 0']);
    expect(titles(everyone.on(day('2026-11-03')))).not.toContain('Trip');
    expect(everyone.on(day('2026-11-30'))).toHaveLength(PER_DAY);
    expect(everyone.on(day('2026-12-02'))).toEqual([]);

    // Ben pressed: Ava's lessons go; the whole Household's trip and the night feed (Ben's too) stay.
    const bens = dayEventsOf(read, profiles, [ben.id]);
    expect(bens.on(day('2026-11-15'))).toEqual([]);
    expect(titles(bens.on(day('2026-11-02')))).toEqual(['Trip']);
    expect(titles(bens.on(day('2026-11-01')))).toEqual(['Trip', 'Night feed']);
    const feed = bens.on(day('2026-11-01'))!.find((occurrence) => occurrence.title === 'Night feed')!;
    // The event names all its people; the day's dots name only the pressed one, and the whole Household.
    expect(feed.profile_ids).toEqual([ava.id, ben.id]);
    expect(bens.dots(day('2026-11-01'))).toEqual([{ kind: 'household' }, { kind: 'person', profile: ben }]);
    expect(everyone.dots(day('2026-11-01'))).toEqual([{ kind: 'household' }, { kind: 'person', profile: ava }, { kind: 'person', profile: ben }]);

    // Nothing is shown until both the events and the Profiles are read, as the pills wait for them.
    expect(dayEventsOf(read, null, []).occurrences).toBeNull();
    expect(dayEventsOf(null, profiles, []).on(day('2026-11-15'))).toBeNull();
  }, 60_000);
});
