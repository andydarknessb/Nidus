import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it } from 'vitest';
import { addItem, gotListItems, loadItems, loadPinnedListId, markListSent, setCrossed, type ListItem } from '../src/lib/shared-lists';
import {
  asAnonymous,
  asDevice,
  asHouseholdAccount,
  createHousehold,
  destroyHousehold,
  destroyTablet,
  type HouseholdAccount,
  type Tablet,
} from './support/supabase';

// The sent mark against the local stack, as a real principal (spec 0019, "The sent mark"): mark_list_sent and got_list_items are one
// statement each, security invoker, so row-level security decides who may move a row.

describe('the sent mark', () => {
  const households: HouseholdAccount[] = [];
  const tablets: Tablet[] = [];

  afterEach(async () => {
    await Promise.all(tablets.splice(0).map(destroyTablet));
    await Promise.all(households.splice(0).map(destroyHousehold));
  });

  async function household(name: string) {
    const arranged = await createHousehold(name);
    households.push(arranged);
    return { arranged, phone: await asHouseholdAccount(arranged) };
  }

  async function device(account: HouseholdAccount): Promise<SupabaseClient> {
    const arranged = await asDevice(account);
    tablets.push(arranged);
    return arranged.client;
  }

  async function pinnedListOf(client: SupabaseClient) {
    const id = await loadPinnedListId(client);
    if (!id) throw new Error('no pinned list');
    return id;
  }

  const sentTexts = (items: ListItem[]) => items.filter((item) => item.sent_at !== null).map((item) => item.text);

  it('marks the items not crossed off as sent, and returns how many; an item crossed off by hand is not sent', async () => {
    const { phone } = await household('The Andersons');
    const list = await pinnedListOf(phone);
    const milk = await addItem(phone, list, 'Milk', 0);
    await addItem(phone, list, 'Eggs', 1);
    const bread = await addItem(phone, list, 'Bread', 2);
    await setCrossed(phone, bread.id, true);

    expect(await markListSent(phone, list)).toBe(2);

    const items = await loadItems(phone, list);
    expect(sentTexts(items).sort()).toEqual(['Eggs', 'Milk']);
    expect(items.find((item) => item.id === milk.id)?.sent_at).not.toBeNull();
    expect(items.find((item) => item.id === bread.id)?.sent_at).toBeNull();
  });

  it('a Device marks the list sent, and Got it crosses off what came, for a Device too', async () => {
    const { arranged, phone } = await household('The Andersons');
    const wall = await device(arranged);
    const list = await pinnedListOf(wall);
    const milk = await addItem(wall, list, 'Milk', 0);
    const eggs = await addItem(wall, list, 'Eggs', 1);

    expect(await markListSent(wall, list)).toBe(2);
    expect(await gotListItems(wall, list, [milk.id])).toBe(1);

    const items = await loadItems(phone, list);
    expect(items.find((item) => item.id === milk.id)).toMatchObject({ crossed_at: expect.any(String), sent_at: expect.any(String) });
    expect(items.find((item) => item.id === eggs.id)).toMatchObject({ crossed_at: null, sent_at: null });
  });

  it('Got it crosses off the waiting items that came and clears the sent mark on the rest, which then stay on the list', async () => {
    const { phone } = await household('The Andersons');
    const list = await pinnedListOf(phone);
    const milk = await addItem(phone, list, 'Milk', 0);
    const eggs = await addItem(phone, list, 'Eggs', 1);
    const bread = await addItem(phone, list, 'Bread', 2);
    await markListSent(phone, list);

    expect(await gotListItems(phone, list, [milk.id])).toBe(1);

    const items = await loadItems(phone, list);
    expect(items.find((item) => item.id === milk.id)).toMatchObject({ crossed_at: expect.any(String), sent_at: expect.any(String) });
    expect(items.find((item) => item.id === eggs.id)).toMatchObject({ crossed_at: null, sent_at: null });
    expect(items.find((item) => item.id === bread.id)).toMatchObject({ crossed_at: null, sent_at: null });
    expect(await gotListItems(phone, list, [])).toBe(0);
  });

  it('Got it ignores ids that are not waiting items of the list, and leaves items added after the send untouched', async () => {
    const { phone } = await household('The Andersons');
    const groceries = await pinnedListOf(phone);
    const milk = await addItem(phone, groceries, 'Milk', 0);
    await markListSent(phone, groceries);
    const cheese = await addItem(phone, groceries, 'Cheese', 1);

    // Cheese was added after the send, so it is not waiting; an id from another Household's list is not on this one.
    const neighbour = await household('The Neighbours');
    const stranger = await addItem(neighbour.phone, await pinnedListOf(neighbour.phone), 'Theirs', 0);

    expect(await gotListItems(phone, groceries, [cheese.id, stranger.id, milk.id])).toBe(1);

    const items = await loadItems(phone, groceries);
    expect(items.find((item) => item.id === milk.id)?.crossed_at).not.toBeNull();
    expect(items.find((item) => item.id === cheese.id)).toMatchObject({ crossed_at: null, sent_at: null });
    expect(await loadItems(neighbour.phone, await pinnedListOf(neighbour.phone))).toEqual([expect.objectContaining({ id: stranger.id, crossed_at: null, sent_at: null })]);
  });

  it('neither touches another Household\'s list', async () => {
    const { phone } = await household('The Andersons');
    const neighbour = await household('The Neighbours');
    const theirs = await pinnedListOf(neighbour.phone);
    const theirItem = await addItem(neighbour.phone, theirs, 'Theirs', 0);

    expect(await markListSent(phone, theirs)).toBe(0);
    expect(await gotListItems(phone, theirs, [theirItem.id])).toBe(0);

    expect(await loadItems(neighbour.phone, theirs)).toEqual([expect.objectContaining({ id: theirItem.id, crossed_at: null, sent_at: null })]);
  });

  it('refuses an anonymous session', async () => {
    const { phone } = await household('The Andersons');
    const list = await pinnedListOf(phone);
    await addItem(phone, list, 'Milk', 0);
    const visitor = asAnonymous();

    expect((await visitor.rpc('mark_list_sent', { p_list_id: list })).error).toBeTruthy();
    expect((await visitor.rpc('got_list_items', { p_list_id: list, p_came: [] })).error).toBeTruthy();
    expect(sentTexts(await loadItems(phone, list))).toEqual([]);
  });
});
