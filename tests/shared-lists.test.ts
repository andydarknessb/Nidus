import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addItem,
  clearCompleted,
  clearOptimistically,
  createList,
  crossOptimistically,
  deleteList,
  loadItems,
  loadLists,
  loadPinnedListId,
  movedIds,
  nextSortOrder,
  renameList,
  reorderItems,
  reorderLists,
  setCrossed,
  setPinnedList,
  withCrossed,
  withoutCrossed,
  type ListItem,
} from '../src/lib/shared-lists';
import {
  asAnonymous,
  asDevice,
  asHouseholdAccount,
  asServiceRole,
  asTablet,
  createSignedUpAccount,
  destroySignedUpAccount,
  signInAs,
  createHousehold,
  destroyHousehold,
  destroyTablet,
  type HouseholdAccount,
  type Tablet,
} from './support/supabase';

describe('shared lists', () => {
  const households: HouseholdAccount[] = [];
  const tablets: Tablet[] = [];

  async function household(name: string) {
    const arranged = await createHousehold(name);
    households.push(arranged);
    return { arranged, phone: await asHouseholdAccount(arranged) };
  }

  async function device(account: HouseholdAccount) {
    const arranged = await asDevice(account);
    tablets.push(arranged);
    return arranged.client;
  }

  afterEach(async () => {
    await Promise.all(tablets.splice(0).map(destroyTablet));
    await Promise.all(households.splice(0).map(destroyHousehold));
  });

  async function pinnedListOf(client: SupabaseClient) {
    const id = await loadPinnedListId(client);
    if (!id) throw new Error('no pinned list');
    return id;
  }

  describe('a new Household', () => {
    it('starts with a Groceries list, pinned', async () => {
      const { phone } = await household('The Andersons');

      const lists = await loadLists(phone);
      expect(lists.map((list) => list.name)).toEqual(['Groceries']);
      expect(await loadPinnedListId(phone)).toBe(lists[0]?.id);
    });

    it('is seeded by ensure_household too, not only by the test fixture', async () => {
      const account = await createSignedUpAccount();
      try {
        const client = await signInAs(account);
        const ensured = await client.rpc('ensure_household', { display_name: 'Newcomers', browser_timezone: 'UTC' });
        expect(ensured.error).toBeNull();

        const lists = await loadLists(client);
        expect(lists.map((list) => list.name)).toEqual(['Groceries']);
        expect(await loadPinnedListId(client)).toBe(lists[0]?.id);
      } finally {
        await destroySignedUpAccount(account);
      }
    });
  });

  describe('managing lists (Household Account only)', () => {
    it('creates, renames, reorders and deletes lists', async () => {
      const { arranged, phone } = await household('The Andersons');
      const id = arranged.household.id;

      const hardware = await createList(phone, id, 'Hardware store', 1);
      const chores = await createList(phone, id, '  Chores  ', 2);
      expect(chores.name).toBe('Chores');

      await renameList(phone, hardware.id, 'Hardware');
      let lists = await loadLists(phone);
      expect(lists.map((list) => list.name)).toEqual(['Groceries', 'Hardware', 'Chores']);

      const [groceries] = lists;
      await reorderLists(phone, [chores.id, groceries!.id, hardware.id]);
      lists = await loadLists(phone);
      expect(lists.map((list) => list.name)).toEqual(['Chores', 'Groceries', 'Hardware']);

      await deleteList(phone, hardware.id);
      expect((await loadLists(phone)).map((list) => list.name)).toEqual(['Chores', 'Groceries']);
    });

    it('rejects an empty list name', async () => {
      const { arranged, phone } = await household('The Andersons');

      await expect(createList(phone, arranged.household.id, '   ', 1)).rejects.toMatchObject({ code: '23514' });
    });

    it('a Device reads lists but cannot create, rename, reorder or delete them', async () => {
      const { arranged, phone } = await household('The Andersons');
      const wall = await device(arranged);
      const groceries = await pinnedListOf(phone);

      expect((await loadLists(wall)).map((list) => list.name)).toEqual(['Groceries']);

      await expect(createList(wall, arranged.household.id, 'Sneaky', 1)).rejects.toBeTruthy();
      await renameList(wall, groceries, 'Renamed');
      await reorderLists(wall, [groceries]);
      await deleteList(wall, groceries);

      // The rename, reorder and delete matched no row for the Device: nothing changed.
      const lists = await loadLists(phone);
      expect(lists).toEqual([{ id: groceries, name: 'Groceries', sort_order: 0 }]);
    });

    it('deleting a list deletes its items', async () => {
      const { arranged, phone } = await household('The Andersons');
      const extra = await createList(phone, arranged.household.id, 'Chores', 1);
      await addItem(phone, extra.id, 'Vacuum', 0);

      await deleteList(phone, extra.id);

      const admin = asServiceRole();
      const left = await admin.from('list_items').select('id').eq('list_id', extra.id);
      expect(left.data).toEqual([]);
    });
  });

  describe('items', () => {
    it('a Device adds, crosses and clears items', async () => {
      const { arranged, phone } = await household('The Andersons');
      const wall = await device(arranged);
      const list = await pinnedListOf(wall);

      const milk = await addItem(wall, list, 'Milk', 0);
      const eggs = await addItem(wall, list, ' Eggs ', 1);
      const bread = await addItem(wall, list, 'Bread', 2);
      expect(eggs.text).toBe('Eggs');
      expect(milk.crossed_at).toBeNull();

      await setCrossed(wall, milk.id, true);
      await setCrossed(wall, bread.id, true);

      // Crossed items stay visible, struck (crossed_at set), until cleared.
      let items = await loadItems(phone, list);
      expect(items.map((item) => [item.text, item.crossed_at !== null])).toEqual([
        ['Milk', true],
        ['Eggs', false],
        ['Bread', true],
      ]);

      // Tapping again uncrosses.
      await setCrossed(wall, bread.id, false);
      expect((await loadItems(wall, list)).find((item) => item.id === bread.id)?.crossed_at).toBeNull();
      await setCrossed(wall, bread.id, true);

      await clearCompleted(wall, list);
      items = await loadItems(phone, list);
      expect(items.map((item) => item.text)).toEqual(['Eggs']);
    });

    it('the Household Account writes items too, and reorders them', async () => {
      const { phone } = await household('The Andersons');
      const list = await pinnedListOf(phone);
      const a = await addItem(phone, list, 'A', 0);
      const b = await addItem(phone, list, 'B', 1);
      const c = await addItem(phone, list, 'C', 2);

      await reorderItems(phone, [c.id, a.id, b.id]);

      expect((await loadItems(phone, list)).map((item) => item.text)).toEqual(['C', 'A', 'B']);
    });

    it('a Device reorders items', async () => {
      const { arranged, phone } = await household('The Andersons');
      const wall = await device(arranged);
      const list = await pinnedListOf(wall);
      const a = await addItem(wall, list, 'A', 0);
      const b = await addItem(wall, list, 'B', 1);
      const c = await addItem(wall, list, 'C', 2);

      await reorderItems(wall, [c.id, a.id, b.id]);

      expect((await loadItems(phone, list)).map((item) => item.text)).toEqual(['C', 'A', 'B']);
    });

    it('clear completed only clears the list it was asked to', async () => {
      const { arranged, phone } = await household('The Andersons');
      const groceries = await pinnedListOf(phone);
      const other = await createList(phone, arranged.household.id, 'Chores', 1);
      const milk = await addItem(phone, groceries, 'Milk', 0);
      const vacuum = await addItem(phone, other.id, 'Vacuum', 0);
      await setCrossed(phone, milk.id, true);
      await setCrossed(phone, vacuum.id, true);

      await clearCompleted(phone, groceries);

      expect(await loadItems(phone, groceries)).toEqual([]);
      expect((await loadItems(phone, other.id)).map((item) => item.text)).toEqual(['Vacuum']);
    });

    it('rejects blank or over-long item text', async () => {
      const { phone } = await household('The Andersons');
      const list = await pinnedListOf(phone);

      await expect(addItem(phone, list, '   ', 0)).rejects.toMatchObject({ code: '23514' });
      await expect(addItem(phone, list, 'x'.repeat(201), 0)).rejects.toMatchObject({ code: '23514' });
    });

    it('a Device cannot move an item to another list', async () => {
      const { arranged, phone } = await household('The Andersons');
      const wall = await device(arranged);
      const groceries = await pinnedListOf(phone);
      const other = await createList(phone, arranged.household.id, 'Chores', 1);
      const milk = await addItem(wall, groceries, 'Milk', 0);

      const moved = await wall.from('list_items').update({ list_id: other.id }).eq('id', milk.id);

      expect(moved.error).not.toBeNull();
      expect((await loadItems(phone, groceries)).map((item) => item.text)).toEqual(['Milk']);
    });
  });

  describe('the pinned list', () => {
    it('the Household Account pins another list; the Device sees the change', async () => {
      const { arranged, phone } = await household('The Andersons');
      const wall = await device(arranged);
      const chores = await createList(phone, arranged.household.id, 'Chores', 1);

      await setPinnedList(phone, arranged.household.id, chores.id);

      expect(await loadPinnedListId(phone)).toBe(chores.id);
      expect(await loadPinnedListId(wall)).toBe(chores.id);
    });

    it('a Device cannot change the pinned list', async () => {
      const { arranged, phone } = await household('The Andersons');
      const wall = await device(arranged);
      const groceries = await pinnedListOf(phone);
      const chores = await createList(phone, arranged.household.id, 'Chores', 1);

      await setPinnedList(wall, arranged.household.id, chores.id);

      expect(await loadPinnedListId(phone)).toBe(groceries);
    });

    it("cannot pin another Household's list", async () => {
      const { arranged, phone } = await household('The Andersons');
      const { phone: neighbour } = await household('The Neighbours');
      const theirs = await pinnedListOf(neighbour);
      const ours = await pinnedListOf(phone);

      await expect(setPinnedList(phone, arranged.household.id, theirs)).rejects.toMatchObject({ code: '23503' });

      expect(await loadPinnedListId(phone)).toBe(ours);
    });

    it('deleting the pinned list leaves nothing pinned; the Household stays intact', async () => {
      const { phone } = await household('The Andersons');
      const groceries = await pinnedListOf(phone);

      await deleteList(phone, groceries);

      expect(await loadPinnedListId(phone)).toBeNull();
    });
  });

  describe('isolation between Households', () => {
    it("never shows, changes or clears another Household's lists and items", async () => {
      const { arranged: ours, phone: usPhone } = await household('The Andersons');
      const { arranged: theirs, phone: themPhone } = await household('The Neighbours');
      const usDevice = await device(ours);
      const theirGroceries = await pinnedListOf(themPhone);
      const theirMilk = await addItem(themPhone, theirGroceries, 'Milk', 0);
      await setCrossed(themPhone, theirMilk.id, true);

      for (const intruder of [usPhone, usDevice]) {
        // Reads see only their own Household.
        expect((await loadLists(intruder)).map((list) => list.id)).not.toContain(theirGroceries);
        expect(await loadItems(intruder, theirGroceries)).toEqual([]);

        // Writes reach nothing, or are rejected.
        await expect(addItem(intruder, theirGroceries, 'Injected', 9)).rejects.toBeTruthy();
        await setCrossed(intruder, theirMilk.id, false);
        await clearCompleted(intruder, theirGroceries);
        await renameList(intruder, theirGroceries, 'Hijacked');
        await deleteList(intruder, theirGroceries);
      }
      await expect(createList(usPhone, theirs.household.id, 'Injected', 9)).rejects.toBeTruthy();

      // Their data is exactly as they left it.
      expect(await loadLists(themPhone)).toEqual([{ id: theirGroceries, name: 'Groceries', sort_order: 0 }]);
      const items = await loadItems(themPhone, theirGroceries);
      expect(items).toHaveLength(1);
      expect(items[0]?.text).toBe('Milk');
      expect(items[0]?.crossed_at).not.toBeNull();
    });

    it('a visitor with no session sees nothing and writes nothing', async () => {
      const { phone } = await household('The Andersons');
      const groceries = await pinnedListOf(phone);
      const visitor = asAnonymous();

      expect(await loadLists(visitor).catch(() => [])).toEqual([]);
      await expect(addItem(visitor, groceries, 'Milk', 0)).rejects.toBeTruthy();
    });

    it('an unpaired tablet sees nothing and writes nothing', async () => {
      const { phone } = await household('The Andersons');
      const groceries = await pinnedListOf(phone);
      const unpaired = await asTablet();
      tablets.push(unpaired);

      expect(await loadLists(unpaired.client)).toEqual([]);
      await expect(addItem(unpaired.client, groceries, 'Milk', 0)).rejects.toBeTruthy();
    });

    it('a revoked Device loses access', async () => {
      const { arranged, phone } = await household('The Andersons');
      const wall = await device(arranged);
      const groceries = await pinnedListOf(phone);
      await addItem(wall, groceries, 'Milk', 0);

      const devices = await phone.from('devices').select('id');
      await phone.from('devices').delete().eq('id', devices.data?.[0]?.id);

      expect(await loadItems(wall, groceries)).toEqual([]);
      await expect(addItem(wall, groceries, 'Eggs', 1)).rejects.toBeTruthy();
    });
  });
});

describe('list ordering and optimistic helpers', () => {
  const item = (id: string, sort_order: number, crossed_at: string | null = null): ListItem => ({
    id,
    list_id: 'l',
    text: id,
    crossed_at,
    sort_order,
  });

  it('new rows go to the bottom', () => {
    expect(nextSortOrder([])).toBe(0);
    expect(nextSortOrder([item('a', 0), item('b', 4)])).toBe(5);
  });

  it('moves an id by an offset and clamps at the ends', () => {
    expect(movedIds(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b']);
    expect(movedIds(['a', 'b', 'c'], 'a', 1)).toEqual(['b', 'a', 'c']);
    expect(movedIds(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(movedIds(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c']);
    expect(movedIds(['a', 'b'], 'zzz', 1)).toEqual(['a', 'b']);
  });

  it('crosses and uncrosses one item without touching the others', () => {
    const items = [item('a', 0), item('b', 1)];
    const crossed = withCrossed(items, 'a', true, new Date('2026-09-29T12:00:00Z'));
    expect(crossed[0]?.crossed_at).toBe('2026-09-29T12:00:00.000Z');
    expect(crossed[1]).toBe(items[1]);
    expect(withCrossed(crossed, 'a', false)[0]?.crossed_at).toBeNull();
  });

  it('drops crossed items for the optimistic clear', () => {
    const items = [item('a', 0, '2026-09-29T12:00:00Z'), item('b', 1)];
    expect(withoutCrossed(items).map((row) => row.id)).toEqual(['b']);
  });
});

describe('optimistic updates', () => {
  const rows = (): ListItem[] => [
    { id: 'a', list_id: 'l', text: 'Milk', crossed_at: null, sort_order: 0 },
    { id: 'b', list_id: 'l', text: 'Eggs', crossed_at: '2026-09-29T12:00:00Z', sort_order: 1 },
  ];

  // Stands in for React's setState: applies each updater to the current rows.
  function screen() {
    const state = { rows: rows() };
    const publish = (update: (current: ListItem[]) => ListItem[]) => {
      state.rows = update(state.rows);
    };
    return { state, publish };
  }

  it('cross shows at once, and stays once the server accepts it', async () => {
    const { state, publish } = screen();
    let shownDuringWrite: string | null | undefined;

    const ok = await crossOptimistically(publish, 'a', true, rows(), async () => {
      shownDuringWrite = state.rows[0]?.crossed_at;
    });

    expect(ok).toBe(true);
    expect(shownDuringWrite).not.toBeNull();
    expect(state.rows[0]?.crossed_at).not.toBeNull();
  });

  it('rolls a rejected cross back to what was there, leaving other items alone', async () => {
    const { state, publish } = screen();

    const ok = await crossOptimistically(publish, 'a', true, rows(), async () => {
      throw new Error('offline');
    });

    expect(ok).toBe(false);
    expect(state.rows).toEqual(rows());
  });

  it('rolls a rejected uncross back to crossed', async () => {
    const { state, publish } = screen();

    const ok = await crossOptimistically(publish, 'b', false, rows(), async () => {
      throw new Error('offline');
    });

    expect(ok).toBe(false);
    expect(state.rows[1]?.crossed_at).toBe('2026-09-29T12:00:00Z');
  });

  it('clear completed removes crossed items at once and puts them back if it fails', async () => {
    const { state, publish } = screen();
    let shownDuringWrite: string[] = [];

    const failed = await clearOptimistically(publish, rows(), async () => {
      shownDuringWrite = state.rows.map((row) => row.id);
      throw new Error('offline');
    });

    expect(failed).toBe(false);
    expect(shownDuringWrite).toEqual(['a']);
    expect(state.rows).toEqual(rows());

    const ok = await clearOptimistically(publish, rows(), async () => undefined);
    expect(ok).toBe(true);
    expect(state.rows.map((row) => row.id)).toEqual(['a']);
  });

  it('against the real database: a Device crossing an item is what the phone then sees', async () => {
    const account = await createHousehold('The Andersons');
    const wall = await asDevice(account);
    try {
      const phone = await asHouseholdAccount(account);
      const list = (await loadPinnedListId(phone))!;
      const milk = await addItem(phone, list, 'Milk', 0);
      const { state, publish } = screen();
      state.rows = [milk];

      const ok = await crossOptimistically(publish, milk.id, true, [milk], () => setCrossed(wall.client, milk.id, true));

      expect(ok).toBe(true);
      expect((await loadItems(phone, list))[0]?.crossed_at).not.toBeNull();
    } finally {
      await destroyTablet(wall);
      await destroyHousehold(account);
    }
  });
});
