import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MEAL_SLOTS, loadMeals, mealGrid, setMeal, type Meal, type MealSlot } from '../src/lib/meals';
import { openChangeFeed, type ChangeFeed } from '../src/lib/realtime';
import {
  asAnonymous,
  asDevice,
  asHouseholdAccount,
  asServiceRole,
  asTablet,
  createHousehold,
  destroyHousehold,
  destroyTablet,
  type HouseholdAccount,
  type Tablet,
} from './support/supabase';
import { startSyncedRead } from '../src/lib/synced-read';
import { withMeal } from '../src/lib/use-meals';

let households: HouseholdAccount[] = [];
let tablets: Tablet[] = [];
let feeds: ChangeFeed[] = [];

afterEach(async () => {
  for (const feed of feeds) feed.close();
  for (const tablet of tablets) await destroyTablet(tablet);
  for (const account of households) await destroyHousehold(account);
  households = [];
  tablets = [];
  feeds = [];
});

async function arrange(): Promise<HouseholdAccount> {
  const account = await createHousehold();
  households.push(account);
  return account;
}

async function arrangeDevice(account: HouseholdAccount): Promise<Tablet> {
  const device = await asDevice(account);
  tablets.push(device);
  return device;
}

// A Household date: the client names it, so nothing here reads a clock.
const DAY = '2026-10-08';

// What a Household's Meals are in the table itself, read past row-level security. Ordered by date,
// then by slot name (which is not the slot order).
async function stored(account: HouseholdAccount): Promise<{ meal_date: string; slot: string; title: string }[]> {
  const { data, error } = await asServiceRole()
    .from('meals')
    .select('meal_date, slot, title')
    .eq('household_id', account.household.id)
    .order('meal_date')
    .order('slot');
  if (error) throw error;
  return data;
}

// `writer` plans, changes and clears a dinner; `reader` is the Household's other principal and sees each step.
async function planChangeClear(writer: SupabaseClient, reader: SupabaseClient) {
  await setMeal(writer, DAY, 'dinner', 'Tacos');
  expect(await loadMeals(reader, DAY, DAY)).toMatchObject([{ meal_date: DAY, slot: 'dinner', title: 'Tacos' }]);

  await setMeal(writer, DAY, 'dinner', 'Lasagne');
  expect(await loadMeals(reader, DAY, DAY)).toMatchObject([{ meal_date: DAY, slot: 'dinner', title: 'Lasagne' }]);

  await setMeal(writer, DAY, 'dinner', '');
  expect(await loadMeals(reader, DAY, DAY)).toEqual([]);
}

describe('meals', () => {
  it('lets a Household Account plan, change and clear a Meal that a Device reads', async () => {
    const account = await arrange();
    const phone = await asHouseholdAccount(account);
    const device = await arrangeDevice(account);

    await planChangeClear(phone, device.client);
  });

  it('lets a Device plan, change and clear a Meal that a Household Account reads', async () => {
    const account = await arrange();
    const phone = await asHouseholdAccount(account);
    const device = await arrangeDevice(account);

    await planChangeClear(device.client, phone);
  });

  it('replaces what a slot holds and leaves exactly one row', async () => {
    const account = await arrange();
    const phone = await asHouseholdAccount(account);
    const device = await arrangeDevice(account);

    await setMeal(phone, DAY, 'dinner', 'Tacos');
    await setMeal(device.client, DAY, 'dinner', 'Lasagne');
    await setMeal(phone, DAY, 'dinner', 'Soup');

    expect(await stored(account)).toEqual([{ meal_date: DAY, slot: 'dinner', title: 'Soup' }]);
  });

  it('keeps one Meal per slot and per day, and accepts every slot the wall names', async () => {
    const account = await arrange();
    const phone = await asHouseholdAccount(account);

    for (const { slot } of MEAL_SLOTS) await setMeal(phone, DAY, slot, `${slot} today`);
    await setMeal(phone, '2026-10-09', 'dinner', 'dinner tomorrow');

    expect(await stored(account)).toEqual([
      { meal_date: DAY, slot: 'breakfast', title: 'breakfast today' },
      { meal_date: DAY, slot: 'dinner', title: 'dinner today' },
      { meal_date: DAY, slot: 'lunch', title: 'lunch today' },
      { meal_date: DAY, slot: 'snack', title: 'snack today' },
      { meal_date: '2026-10-09', slot: 'dinner', title: 'dinner tomorrow' },
    ]);
  });

  it('clears a slot when the title is blank, and trims one that is not', async () => {
    const account = await arrange();
    const phone = await asHouseholdAccount(account);
    const device = await arrangeDevice(account);

    await setMeal(phone, DAY, 'lunch', 'Soup');
    await setMeal(phone, DAY, 'lunch', '   ');
    expect(await stored(account)).toEqual([]);

    // Past the helper, the database itself reads null, spaces and other whitespace as a clear.
    for (const blank of [null, '', '   ', '\t\n']) {
      await setMeal(phone, DAY, 'lunch', 'Soup');
      const { error } = await device.client.rpc('set_meal', { p_meal_date: DAY, p_slot: 'lunch', p_title: blank });
      expect(error).toBeNull();
      expect(await stored(account)).toEqual([]);
    }

    // Clearing a slot that holds nothing is not an error.
    await expect(setMeal(phone, DAY, 'snack', '')).resolves.toBeUndefined();

    const { error } = await device.client.rpc('set_meal', { p_meal_date: DAY, p_slot: 'lunch', p_title: '  Soup  ' });
    expect(error).toBeNull();
    expect(await stored(account)).toEqual([{ meal_date: DAY, slot: 'lunch', title: 'Soup' }]);
  });

  it('trims whitespace of every kind from the ends of a title, and only the ends', async () => {
    const account = await arrange();
    const phone = await asHouseholdAccount(account);
    const device = await arrangeDevice(account);
    // Past the helper, which trims first: the database trims the ends itself.
    const plan = async (client: SupabaseClient, slot: MealSlot, title: string) => {
      const { error } = await client.rpc('set_meal', { p_meal_date: DAY, p_slot: slot, p_title: title });
      expect(error).toBeNull();
    };

    await plan(phone, 'breakfast', '\t\n Oatmeal \r\n\t');
    await plan(device.client, 'lunch', '\f\u000bSoup\u000b\f');
    await plan(phone, 'dinner', ' \tMac and\tcheese\n with\n peas \n');
    // Letters are never trimmed, whichever way the whitespace is written.
    await plan(device.client, 'snack', 'veggie curry v');

    expect(await stored(account)).toEqual([
      { meal_date: DAY, slot: 'breakfast', title: 'Oatmeal' },
      { meal_date: DAY, slot: 'dinner', title: 'Mac and\tcheese\n with\n peas' },
      { meal_date: DAY, slot: 'lunch', title: 'Soup' },
      { meal_date: DAY, slot: 'snack', title: 'veggie curry v' },
    ]);
  });

  it('holds the 200 character limit to the trimmed title', async () => {
    const account = await arrange();
    const phone = await asHouseholdAccount(account);

    // Two hundred characters and a trailing newline are two hundred once trimmed.
    const fits = await phone.rpc('set_meal', { p_meal_date: DAY, p_slot: 'dinner', p_title: `${'x'.repeat(200)}\n` });
    expect(fits.error).toBeNull();
    const [row] = await stored(account);
    expect(row?.title).toHaveLength(200);

    // Two hundred and one are too many, however they are wrapped.
    const tooLong = await phone.rpc('set_meal', { p_meal_date: DAY, p_slot: 'lunch', p_title: `\t${'x'.repeat(201)}\n` });
    expect(tooLong.error).toMatchObject({ code: '23514' });
    expect(await stored(account)).toHaveLength(1);
  });

  it('refuses an unknown slot and a title over 200 characters, and keeps what the slot held', async () => {
    const account = await arrange();
    const phone = await asHouseholdAccount(account);
    const device = await arrangeDevice(account);
    await setMeal(phone, DAY, 'dinner', 'Tacos');

    // Past the helper, which only names the four slots.
    const unknown = await phone.rpc('set_meal', { p_meal_date: DAY, p_slot: 'brunch', p_title: 'Pancakes' });
    expect(unknown.error).toMatchObject({ code: '23514' });
    await expect(setMeal(device.client, DAY, 'dinner', 'x'.repeat(201))).rejects.toMatchObject({ code: '23514' });
    await expect(setMeal(device.client, DAY, 'snack', 'x'.repeat(201))).rejects.toMatchObject({ code: '23514' });
    expect(await stored(account)).toEqual([{ meal_date: DAY, slot: 'dinner', title: 'Tacos' }]);

    // Two hundred is the longest that fits.
    await setMeal(device.client, DAY, 'snack', 'x'.repeat(200));
    expect(await stored(account)).toHaveLength(2);
  });

  it('refuses an unknown or null slot even when the title is blank, never a quiet no-op', async () => {
    const account = await arrange();
    const phone = await asHouseholdAccount(account);
    const device = await arrangeDevice(account);
    await setMeal(phone, DAY, 'dinner', 'Tacos');

    for (const client of [phone, device.client]) {
      for (const slot of ['brunch', null]) {
        for (const title of ['', '   ', null]) {
          const { error } = await client.rpc('set_meal', { p_meal_date: DAY, p_slot: slot, p_title: title });
          expect(error).toMatchObject({ code: '23514' });
        }
      }
    }

    // A session with no Household is still refused first (42501), whatever the slot.
    const unpaired = await asTablet();
    tablets.push(unpaired);
    for (const slot of ['brunch', null]) {
      const { error } = await unpaired.client.rpc('set_meal', { p_meal_date: DAY, p_slot: slot, p_title: '' });
      expect(error).toMatchObject({ code: '42501' });
    }

    expect(await stored(account)).toEqual([{ meal_date: DAY, slot: 'dinner', title: 'Tacos' }]);
  });

  it('lets a principal retitle a Meal directly but never move it', async () => {
    const account = await arrange();
    const other = await arrange();
    const phone = await asHouseholdAccount(account);
    await setMeal(phone, DAY, 'dinner', 'Tacos');
    const [meal] = await loadMeals(phone, DAY, DAY);

    expect((await phone.from('meals').update({ title: 'Lasagne' }).eq('id', meal!.id)).error).toBeNull();
    expect((await phone.from('meals').update({ title: '   ' }).eq('id', meal!.id)).error).not.toBeNull();
    for (const move of [{ meal_date: '2026-10-09' }, { slot: 'lunch' }, { household_id: other.household.id }]) {
      expect((await phone.from('meals').update(move).eq('id', meal!.id)).error).not.toBeNull();
    }

    expect(await stored(account)).toEqual([{ meal_date: DAY, slot: 'dinner', title: 'Lasagne' }]);
    expect(await stored(other)).toEqual([]);
  });

  it('reads the Meals between two Household dates, both included, in date order', async () => {
    const account = await arrange();
    const phone = await asHouseholdAccount(account);
    const device = await arrangeDevice(account);
    for (const date of ['2026-10-10', '2026-10-04', '2026-10-05', '2026-10-03', '2026-10-11']) {
      await setMeal(phone, date, 'dinner', `Dinner ${date}`);
    }

    const week = await loadMeals(device.client, '2026-10-04', '2026-10-10');

    expect(week.map((meal) => meal.meal_date)).toEqual(['2026-10-04', '2026-10-05', '2026-10-10']);
    expect(week[0]).toEqual({ id: expect.any(String), meal_date: '2026-10-04', slot: 'dinner', title: 'Dinner 2026-10-04' });
    expect(await loadMeals(device.client, '2026-10-06', '2026-10-09')).toEqual([]);
  });

  it("keeps one Household's Meals from another's principals", async () => {
    const account = await arrange();
    const other = await arrange();
    const phone = await asHouseholdAccount(account);
    await setMeal(phone, DAY, 'dinner', 'Tacos');
    const [ours] = await loadMeals(phone, DAY, DAY);
    const otherPhone = await asHouseholdAccount(other);
    const otherDevice = await arrangeDevice(other);

    for (const client of [otherPhone, otherDevice.client]) {
      expect(await loadMeals(client, '2026-01-01', '2026-12-31')).toEqual([]);

      // Neither a set, a clear nor a direct write reaches the row.
      await setMeal(client, DAY, 'dinner', 'Hijacked');
      await setMeal(client, DAY, 'dinner', '');
      await client.from('meals').update({ title: 'Hijacked' }).eq('id', ours!.id);
      await client.from('meals').delete().eq('id', ours!.id);
      const forged = await client.from('meals').insert({ household_id: account.household.id, meal_date: DAY, slot: 'lunch', title: 'Forged' });
      expect(forged.error).not.toBeNull();
    }

    expect(await stored(account)).toEqual([{ meal_date: DAY, slot: 'dinner', title: 'Tacos' }]);
    expect(await stored(other)).toEqual([]);

    // The same slot of the same day is each Household's own.
    await setMeal(otherDevice.client, DAY, 'dinner', 'Curry');
    expect(await stored(account)).toEqual([{ meal_date: DAY, slot: 'dinner', title: 'Tacos' }]);
    expect(await stored(other)).toEqual([{ meal_date: DAY, slot: 'dinner', title: 'Curry' }]);
    expect(await loadMeals(otherPhone, DAY, DAY)).toMatchObject([{ title: 'Curry' }]);
  });

  it('refuses an unpaired tablet and a client with no session', async () => {
    const account = await arrange();
    await setMeal(await asHouseholdAccount(account), DAY, 'dinner', 'Tacos');
    const unpaired = await asTablet();
    tablets.push(unpaired);

    for (const intruder of [unpaired.client, asAnonymous()]) {
      expect(await loadMeals(intruder, DAY, DAY).catch(() => [])).toEqual([]);
      await expect(setMeal(intruder, DAY, 'dinner', 'Hijacked')).rejects.toBeTruthy();
      await expect(setMeal(intruder, DAY, 'dinner', '')).rejects.toBeTruthy();
      await expect(setMeal(intruder, DAY, 'lunch', 'Forged')).rejects.toBeTruthy();
      const forged = await intruder.from('meals').insert({ household_id: account.household.id, meal_date: DAY, slot: 'lunch', title: 'Forged' });
      expect(forged.error).not.toBeNull();
    }

    expect(await stored(account)).toEqual([{ meal_date: DAY, slot: 'dinner', title: 'Tacos' }]);
  });

  it('refuses a call from a session with no Household even when the title is blank, never a quiet no-op', async () => {
    const account = await arrange();
    await setMeal(await asHouseholdAccount(account), DAY, 'dinner', 'Tacos');
    const unpaired = await asTablet();
    tablets.push(unpaired);

    // Signed in but paired to nothing: the call is refused before the title is looked at.
    for (const title of ['Hijacked', '', '   ', '\t\n', null]) {
      const { error } = await unpaired.client.rpc('set_meal', { p_meal_date: DAY, p_slot: 'dinner', p_title: title });
      expect(error).toMatchObject({ code: '42501' });
    }
    await expect(setMeal(unpaired.client, DAY, 'dinner', '')).rejects.toMatchObject({ code: '42501' });

    expect(await stored(account)).toEqual([{ meal_date: DAY, slot: 'dinner', title: 'Tacos' }]);
  });
});

// Resolves when the feed next reports a change to `meals`, rejects if it does not within the wait.
function mealsChanged(feed: ChangeFeed, waitMs = 8_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const stop = feed.watch(['meals'], () => {
      clearTimeout(timer);
      stop();
      resolve();
    });
    const timer = setTimeout(() => {
      stop();
      reject(new Error(`no change on meals within ${waitMs} ms`));
    }, waitMs);
  });
}

describe('saving a Meal through the synced read', () => {
  it('shows a Meal saved on the phone at once there, and on the wall at its next read', async () => {
    const account = await arrange();
    const phone = await asHouseholdAccount(account);
    const device = await arrangeDevice(account);
    const titles = (meals: Meal[] | null) => meals?.map((meal) => `${meal.slot} ${meal.title}`) ?? null;
    let onPhone: Meal[] | null = null;
    let onWall: Meal[] | null = null;
    const phoneRead = startSyncedRead({ load: () => loadMeals(phone, DAY, DAY), onChange: (state) => (onPhone = state.data) });
    const wallRead = startSyncedRead({ load: () => loadMeals(device.client, DAY, DAY), onChange: (state) => (onWall = state.data) });
    try {
      await vi.waitFor(() => expect([titles(onPhone), titles(onWall)]).toEqual([[], []]));
      const saving = phoneRead.write(() => setMeal(phone, DAY, 'dinner', 'Tacos'), (meals) => withMeal(meals, DAY, 'dinner', 'Tacos'));
      expect(titles(onPhone)).toEqual(['dinner Tacos']);
      await saving;
      // The change feed's notice, which the screen hears from Realtime.
      wallRead.poke();
      await vi.waitFor(() => expect(titles(onWall)).toEqual(['dinner Tacos']));
    } finally {
      phoneRead.stop();
      wallRead.stop();
    }
  });
});

describe('a Meal shown before it is stored', () => {
  const tacos: Meal = { id: 'm1', meal_date: DAY, slot: 'dinner', title: 'Tacos' };
  const eggs: Meal = { id: 'm2', meal_date: DAY, slot: 'breakfast', title: 'Eggs' };

  it('takes the place of what the cell held, and leaves the other cells alone', () => {
    expect(withMeal([tacos, eggs], DAY, 'dinner', ' Lasagne ')).toEqual([eggs, { id: `pending-${DAY}-dinner`, meal_date: DAY, slot: 'dinner', title: 'Lasagne' }]);
  });

  it('clears the cell for a blank title', () => {
    expect(withMeal([tacos, eggs], DAY, 'dinner', '  ')).toEqual([eggs]);
  });
});

describe('meals on the Realtime change feed', () => {
  it('tells another screen of the Household when a Meal is set or changed', async () => {
    const account = await arrange();
    const phone = await asHouseholdAccount(account);
    const device = await arrangeDevice(account);
    const feed = openChangeFeed(device.client);
    feeds.push(feed);
    await feed.ready;

    for (const title of ['Tacos', 'Lasagne']) {
      const seen = mealsChanged(feed);
      await setMeal(phone, DAY, 'dinner', title);
      await seen;
    }
  });

  // A delete is the one change Realtime sends without asking row-level security: to every subscriber
  // of the table, in any Household (20261008000001_realtime.sql), and the local stack is shared. So
  // this listens for the delete of this Meal by its id and ignores every other. What the delete
  // carries is what can leave the Household: the primary key, and with id the only one an opaque id,
  // never a Meal's title, date or slot.
  it('tells another screen when a Meal is cleared, and sends the delete as the id alone', async () => {
    const account = await arrange();
    const phone = await asHouseholdAccount(account);
    const device = await arrangeDevice(account);
    await setMeal(phone, DAY, 'dinner', 'Tacos');
    const [meal] = await loadMeals(phone, DAY, DAY);

    const channel = device.client.channel(`meals-deletes-${Math.random().toString(36).slice(2)}`, { config: { postgres_changes_options: { wait: true } } });
    const deleted = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no delete of this Meal heard within 8 s')), 8_000);
      channel
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'meals' }, (payload) => {
          if (payload.old.id !== meal!.id) return;
          clearTimeout(timer);
          resolve(payload.old);
        })
        // Clear the Meal only once the subscription is live, so the delete is never missed.
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') setMeal(phone, DAY, 'dinner', '').catch(reject);
        });
    });

    try {
      expect(await deleted).toEqual({ id: meal!.id });
    } finally {
      await device.client.removeChannel(channel);
    }
  });
});

describe('the Meals grid', () => {
  const meal = (meal_date: string, slot: MealSlot, title: string): Meal => ({ id: `${meal_date}/${slot}`, meal_date, slot, title });
  const week = ['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10'];
  const titles = (rows: ReturnType<typeof mealGrid>, slot: MealSlot) => rows.find((row) => row.slot === slot)!.cells.map((cell) => cell?.title ?? null);

  it('has a row per slot in slot order, with its word', () => {
    expect(mealGrid([], week).map((row) => [row.slot, row.label])).toEqual([
      ['breakfast', 'Breakfast'],
      ['lunch', 'Lunch'],
      ['dinner', 'Dinner'],
      ['snack', 'Snack'],
    ]);
  });

  it('has one cell per date, in the order the dates are given, all empty when nothing is planned', () => {
    const rows = mealGrid([], week);
    for (const row of rows) expect(row.cells).toEqual(week.map(() => null));
    expect(mealGrid([], ['2026-10-10', '2026-10-04'])[0]!.cells).toHaveLength(2);
    expect(mealGrid([], [])[0]!.cells).toEqual([]);
  });

  it('puts each Meal in the cell of its date and slot, however the Meals arrive', () => {
    const rows = mealGrid(
      [meal('2026-10-08', 'dinner', 'Tacos'), meal('2026-10-04', 'snack', 'Apple'), meal('2026-10-04', 'dinner', 'Soup'), meal('2026-10-10', 'breakfast', 'Pancakes')],
      week,
    );
    expect(titles(rows, 'breakfast')).toEqual([null, null, null, null, null, null, 'Pancakes']);
    expect(titles(rows, 'lunch')).toEqual([null, null, null, null, null, null, null]);
    expect(titles(rows, 'dinner')).toEqual(['Soup', null, null, null, 'Tacos', null, null]);
    expect(titles(rows, 'snack')).toEqual(['Apple', null, null, null, null, null, null]);
    // The cell holds the Meal itself, so a tap can say which row it is.
    expect(rows[2]!.cells[4]).toEqual(meal('2026-10-08', 'dinner', 'Tacos'));
  });

  it('leaves out Meals on dates that are not asked for', () => {
    const rows = mealGrid([meal('2026-10-03', 'dinner', 'Before'), meal('2026-10-11', 'dinner', 'After'), meal('2026-10-06', 'dinner', 'Inside')], week);
    expect(titles(rows, 'dinner')).toEqual([null, null, 'Inside', null, null, null, null]);
    // A single date, as the home screen's card asks for.
    expect(titles(mealGrid([meal('2026-10-06', 'lunch', 'Soup'), meal('2026-10-06', 'snack', 'Apple')], ['2026-10-06']), 'lunch')).toEqual(['Soup']);
  });
});
