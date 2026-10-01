import { afterEach, describe, expect, it } from 'vitest';
import { loadOccurrences } from '../src/lib/calendar-occurrences';
import { createProfile } from '../src/lib/profiles';
import { createRoutine, loadRoutines } from '../src/lib/routines';
import { createList, loadPinnedListId, setPinnedList } from '../src/lib/shared-lists';
import { arrangeCalendar, arrangeEvents } from './support/calendar';
import { asHouseholdAccount, createHousehold, destroyHousehold, type HouseholdAccount } from './support/supabase';

const WINDOW = { from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-11-01T00:00:00Z') };

let households: HouseholdAccount[] = [];

afterEach(async () => {
  for (const account of households) await destroyHousehold(account);
  households = [];
});

// One Household with a Synced Event, a Routine and a pinned Shared List, so the Wall has something to read.
async function arrangeWall(title: string) {
  const account = await createHousehold();
  households.push(account);
  const phone = await asHouseholdAccount(account);
  const id = account.household.id;

  const { calendarId } = await arrangeCalendar(account);
  await arrangeEvents(calendarId, [{ google_event_id: title, title, starts_at: '2026-10-05T17:00:00Z', ends_at: '2026-10-05T18:00:00Z' }]);
  const profile = await createProfile(phone, id, { name: `${title} kid`, color: '#ffffff', avatar_url: null }, 0);
  await createRoutine(phone, id, profile.id, { title: `${title} routine`, days_of_week: 127 }, 0);
  const list = await createList(phone, id, `${title} list`, 0);
  await setPinnedList(phone, id, list.id);
  return { phone, listId: list.id };
}

describe('the Wall for a Household Account', () => {
  it('reads occurrences, Routines and the pinned list for its own Household and none of another', async () => {
    const mine = await arrangeWall('Mine');
    const other = await arrangeWall('Other');

    expect((await loadOccurrences(mine.phone, WINDOW.from, WINDOW.to)).map((o) => o.title)).toEqual(['Mine']);
    expect((await loadRoutines(mine.phone)).map((r) => r.title)).toEqual(['Mine routine']);
    expect(await loadPinnedListId(mine.phone)).toBe(mine.listId);
    expect(await loadPinnedListId(other.phone)).toBe(other.listId);
  });
});
