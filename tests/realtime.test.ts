import { afterEach, describe, expect, it } from 'vitest';
import { openChangeFeed, type ChangeFeed, type WatchedTable } from '../src/lib/realtime';
import { setMeal } from '../src/lib/meals';
import { PROFILE_PALETTE, createProfile, updateProfile } from '../src/lib/profiles';
import { completeRoutine, createRoutine, householdDay, uncompleteRoutine } from '../src/lib/routines';
import { addItem, createList } from '../src/lib/shared-lists';
import {
  asDevice,
  asHouseholdAccount,
  createHousehold,
  destroyHousehold,
  destroyTablet,
  type HouseholdAccount,
  type Tablet,
} from './support/supabase';

// Two principals of one Household, each with its own Realtime feed: one writes, the other
// observes the change through its subscription (RLS decides who hears what).

const today = householdDay('America/Chicago').date;
const feeds: ChangeFeed[] = [];
const accounts: HouseholdAccount[] = [];
const tablets: Tablet[] = [];

afterEach(async () => {
  for (const feed of feeds.splice(0)) feed.close();
  for (const tablet of tablets.splice(0)) await destroyTablet(tablet);
  for (const account of accounts.splice(0)) await destroyHousehold(account);
});

async function household() {
  const account = await createHousehold();
  accounts.push(account);
  return account;
}

async function device(account: HouseholdAccount, name: string) {
  const tablet = await asDevice(account, name);
  tablets.push(tablet);
  return tablet;
}

async function openFeed(client: Parameters<typeof openChangeFeed>[0]) {
  const feed = openChangeFeed(client);
  feeds.push(feed);
  await feed.ready;
  return feed;
}

// Resolves when `table` changes, rejects if it does not within the wait.
function changed(feed: ChangeFeed, table: WatchedTable, waitMs = 8_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const stop = feed.watch([table], () => {
      clearTimeout(timer);
      stop();
      resolve();
    });
    const timer = setTimeout(() => {
      stop();
      reject(new Error(`no change on ${table} within ${waitMs} ms`));
    }, waitMs);
  });
}

async function setUp() {
  const account = await household();
  const phone = await asHouseholdAccount(account);
  const kitchen = await device(account, 'Kitchen');
  const hallway = await device(account, 'Hallway');
  const profile = await createProfile(phone, account.household.id, { name: 'Ada', color: PROFILE_PALETTE[0].hex, avatar_url: null }, 0);
  return { account, phone, kitchen, hallway, profile };
}

describe('Realtime change feed', () => {
  it('is online once subscribed', async () => {
    const { kitchen } = await setUp();
    const feed = await openFeed(kitchen.client);
    expect(feed.status()).toBe('online');
  });

  // A frontend deployed ahead of the migration that publishes a watched table: the server refuses the
  // subscription, the feed was never live, and it must say so rather than stay "connecting" for good.
  it('reports offline when the subscription is never accepted', async () => {
    const { kitchen } = await setUp();
    const feed = openChangeFeed(kitchen.client, { tables: ['not_in_the_publication'], giveUpMs: 1_000 });
    feeds.push(feed);
    const heard: string[] = [];
    feed.onStatus((status) => heard.push(status));
    await expect.poll(() => feed.status(), { timeout: 5_000 }).toBe('offline');
    expect(heard).toContain('offline');
  });

  it('shows a tick made on one Device to another Device', async () => {
    const { account, phone, kitchen, hallway, profile } = await setUp();
    const routine = await createRoutine(phone, account.household.id, profile.id, { title: 'Feed the dog', days_of_week: 127 }, 0);
    const hallwayFeed = await openFeed(hallway.client);

    const seen = changed(hallwayFeed, 'routine_completions');
    await completeRoutine(kitchen.client, routine.id, today);
    await seen;

    // An untick (a DELETE, which carries only the key) is heard too.
    const unseen = changed(hallwayFeed, 'routine_completions');
    await uncompleteRoutine(kitchen.client, routine.id, today);
    await unseen;
  });

  it('shows the phone a Device write, and the Device a phone write', async () => {
    const { account, phone, kitchen, profile } = await setUp();
    const routine = await createRoutine(phone, account.household.id, profile.id, { title: 'Pack bags', days_of_week: 127 }, 0);
    const phoneFeed = await openFeed(phone);
    const kitchenFeed = await openFeed(kitchen.client);

    const phoneSees = changed(phoneFeed, 'routine_completions');
    await completeRoutine(kitchen.client, routine.id, today);
    await phoneSees;

    const list = await createList(phone, account.household.id, 'Groceries', 0);
    const kitchenSees = changed(kitchenFeed, 'list_items');
    await addItem(phone, list.id, 'Milk', 0);
    await kitchenSees;
  });

  it.each<[WatchedTable, string]>([
    ['profiles', 'a Profile edited on the phone'],
    ['routines', 'a Routine added on the phone'],
    ['shared_lists', 'a Shared List added on the phone'],
  ])('reaches a Device on %s: %s', async (table) => {
    const { account, phone, kitchen, profile } = await setUp();
    const feed = await openFeed(kitchen.client);
    const seen = changed(feed, table);
    if (table === 'profiles') await updateProfile(phone, profile.id, { name: 'Ada L', color: PROFILE_PALETTE[0].hex, avatar_url: null });
    if (table === 'routines') await createRoutine(phone, account.household.id, profile.id, { title: 'Read', days_of_week: 127 }, 0);
    if (table === 'shared_lists') await createList(phone, account.household.id, 'Chores', 0);
    await seen;
  });

  // Inserts and updates only: a delete carries no Household and is delivered to every subscriber (see the migration).
  it('never delivers another Household\'s inserts or updates', async () => {
    const mine = await setUp();
    const other = await setUp();
    const feed = await openFeed(mine.kitchen.client);
    let heard = 0;
    feed.watch(['routines', 'profiles', 'list_items', 'routine_completions', 'meals'], () => (heard += 1));

    await createRoutine(other.phone, other.account.household.id, other.profile.id, { title: 'Theirs', days_of_week: 127 }, 0);
    await updateProfile(other.phone, other.profile.id, { name: 'Elsewhere', color: PROFILE_PALETTE[0].hex, avatar_url: null });
    // A Meal set, then changed (an insert, then an update).
    await setMeal(other.phone, today, 'dinner', 'Theirs');
    await setMeal(other.phone, today, 'dinner', 'Theirs, changed');
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    expect(heard).toBe(0);
  });

  it('merges a burst of writes into one notification', async () => {
    const { account, phone, kitchen } = await setUp();
    const feed = await openFeed(kitchen.client);
    let heard = 0;
    feed.watch(['shared_lists'], () => (heard += 1));
    await Promise.all(['A', 'B', 'C', 'D'].map((name, index) => createList(phone, account.household.id, name, index)));
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    expect(heard).toBeGreaterThanOrEqual(1);
    expect(heard).toBeLessThan(4);
  });
});
