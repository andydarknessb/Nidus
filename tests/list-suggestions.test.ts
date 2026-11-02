import { afterEach, describe, expect, it } from 'vitest';
import { addItem, createList } from '../src/lib/shared-lists';
import {
  asAnonymous,
  asDevice,
  asHouseholdAccount,
  asServiceRole,
  createHousehold,
  destroyHousehold,
  destroyTablet,
  type HouseholdAccount,
  type Tablet,
} from './support/supabase';

// List Suggestions (spec 0019, ticket 2): what the shopper suggests waits on a list as rows that are not items, until a person adds
// them (add_list_suggestions makes items of them) or dismisses them (a delete). Principals read and dismiss; only the service role
// (the shopper, ticket 3) writes them.

let households: HouseholdAccount[] = [];
let tablets: Tablet[] = [];

afterEach(async () => {
  for (const tablet of tablets) await destroyTablet(tablet);
  for (const account of households) await destroyHousehold(account);
  households = [];
  tablets = [];
});

async function setUp() {
  const account = await createHousehold();
  households.push(account);
  const phone = await asHouseholdAccount(account);
  const tablet = await asDevice(account, 'Kitchen');
  tablets.push(tablet);
  const list = await createList(phone, account.household.id, 'Weekly', 0);
  await addItem(phone, list.id, 'Bread', 0);

  const admin = asServiceRole();
  const { data, error } = await admin
    .from('list_suggestions')
    .insert([
      { list_id: list.id, text: 'Ground beef, 2 lb', for_meals: 'Tacos, Chili', sort_order: 0 },
      { list_id: list.id, text: 'Tortillas', for_meals: null, sort_order: 1 },
      { list_id: list.id, text: 'Cheddar', for_meals: 'Tacos', sort_order: 2 },
    ])
    .select('id, text, sort_order');
  expect(error).toBeNull();
  const ids = Object.fromEntries((data ?? []).map((row) => [row.text, row.id as string]));
  return { account, phone, tablet, list, ids, admin };
}

describe('List Suggestions', () => {
  it('lets a Household Account and a Device read their Household\'s suggestions and dismiss one', async () => {
    const { phone, tablet, list, ids } = await setUp();

    const { data: seenByPhone } = await phone.from('list_suggestions').select('text').eq('list_id', list.id).order('sort_order');
    expect(seenByPhone?.map((row) => row.text)).toEqual(['Ground beef, 2 lb', 'Tortillas', 'Cheddar']);

    const { data: seenByDevice } = await tablet.client.from('list_suggestions').select('id').eq('list_id', list.id);
    expect(seenByDevice).toHaveLength(3);

    const { error } = await tablet.client.from('list_suggestions').delete().eq('id', ids['Tortillas']!);
    expect(error).toBeNull();
    const { data: left } = await phone.from('list_suggestions').select('text').eq('list_id', list.id);
    expect(left?.map((row) => row.text).sort()).toEqual(['Cheddar', 'Ground beef, 2 lb']);
  });

  it('refuses a Household Account and a Device any insert or update of one', async () => {
    const { phone, tablet, list, ids } = await setUp();

    const inserted = await phone.from('list_suggestions').insert({ list_id: list.id, text: 'Eggs', sort_order: 9 });
    expect(inserted.error?.code).toBe('42501');
    const insertedByDevice = await tablet.client.from('list_suggestions').insert({ list_id: list.id, text: 'Eggs', sort_order: 9 });
    expect(insertedByDevice.error?.code).toBe('42501');

    const updated = await phone.from('list_suggestions').update({ text: 'Changed' }).eq('id', ids['Tortillas']!);
    expect(updated.error?.code).toBe('42501');
  });

  it('shows another Household and an anonymous session none of them', async () => {
    const { list, ids } = await setUp();
    const other = await createHousehold();
    households.push(other);
    const otherPhone = await asHouseholdAccount(other);

    const { data: theirs } = await otherPhone.from('list_suggestions').select('id').eq('list_id', list.id);
    expect(theirs).toEqual([]);

    // The anonymous role has no grant on the table at all, so it is refused rather than shown an empty list.
    const visitor = await asAnonymous().from('list_suggestions').select('id').eq('id', ids['Tortillas']!);
    expect(visitor.error?.code).toBe('42501');
    expect(visitor.data).toBeNull();
  });

  it('makes one item from two concurrent adds of the same suggestion, at the end of the list, added by the caller', async () => {
    const { account, phone, list, ids, admin } = await setUp();

    const [first, second] = await Promise.all([
      phone.rpc('add_list_suggestions', { p_ids: [ids['Tortillas']!] }),
      phone.rpc('add_list_suggestions', { p_ids: [ids['Tortillas']!] }),
    ]);
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect([...(first.data ?? []), ...(second.data ?? [])]).toHaveLength(1);

    const { data: items } = await phone.from('list_items').select('text, added_by').eq('list_id', list.id).order('sort_order');
    expect(items).toEqual([
      { text: 'Bread', added_by: account.authUserId },
      { text: 'Tortillas', added_by: account.authUserId },
    ]);
    const { data: left } = await admin.from('list_suggestions').select('id').eq('list_id', list.id);
    expect(left).toHaveLength(2);
  });

  it('records the Device as the one who added a suggestion it added', async () => {
    const { tablet, list, ids } = await setUp();

    const { error } = await tablet.client.rpc('add_list_suggestions', { p_ids: [ids['Cheddar']!] });
    expect(error).toBeNull();
    const { data: items } = await tablet.client.from('list_items').select('text, added_by').eq('list_id', list.id).order('sort_order');
    expect(items?.at(-1)).toEqual({ text: 'Cheddar', added_by: tablet.authUserId });
  });

  it('keeps the suggestions\' order when all of them are added, whatever order they are named in, after the last item', async () => {
    const { phone, list, ids } = await setUp();

    const { error } = await phone.rpc('add_list_suggestions', { p_ids: [ids['Cheddar']!, ids['Tortillas']!, ids['Ground beef, 2 lb']!] });
    expect(error).toBeNull();
    const { data: items } = await phone.from('list_items').select('text').eq('list_id', list.id).order('sort_order');
    expect(items?.map((row) => row.text)).toEqual(['Bread', 'Ground beef, 2 lb', 'Tortillas', 'Cheddar']);
  });

  it('deletes a list\'s suggestions with the list', async () => {
    const { phone, list, admin } = await setUp();

    const { error } = await phone.from('shared_lists').delete().eq('id', list.id);
    expect(error).toBeNull();
    const { data: left } = await admin.from('list_suggestions').select('id').eq('list_id', list.id);
    expect(left).toEqual([]);
  });
});
