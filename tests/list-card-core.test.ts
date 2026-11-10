import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChange } from '../src/lib/change';
import { listCard, type ListCardEffects, type ListCardView } from '../src/lib/list-card';
import { addItem, clearCompleted, loadItems, loadPinnedListId, setCrossed, withCrossed, withoutCrossed, type ListItem } from '../src/lib/shared-lists';
import { couldNotLoad, startSyncedRead, type SyncedState } from '../src/lib/synced-read';
import { NOT_SAVED, NOT_SAVED_OFFLINE } from '../src/lib/write-failure';
import { asDevice, asHouseholdAccount, createHousehold, destroyHousehold, destroyTablet, type HouseholdAccount, type Tablet } from './support/supabase';

// The Shared List card's core (spec 0020, ticket 1), driven the way the hook drives it: a real synced read of the items and a real change
// over it, against the local stack, as a Device and as a Household Account. A write the test wants to fail goes to a client that nothing
// listens to, so it fails the way a lost connection does.

const options = { auth: { persistSession: false, autoRefreshToken: false } };
// Nothing listens on port 54399 (the local stack uses 54321 to 54324), so a write to it fails at once. A read is retried by the client
// when the connection fails, so a read that must fail at once is one the local stack refuses: a key it does not know.
const DEAD = createClient('http://127.0.0.1:54399', 'placeholder-anon-key', options);
const REFUSED = createClient('http://127.0.0.1:54321', 'not-a-key', options);

// A card as the hook holds it: its items read through `reader`, its writes made as `writes.client` (a test may swap it), and its failures
// said in one change, as useChange says them.
function mount(listId: string, reader: SupabaseClient, writer: SupabaseClient) {
  let synced: SyncedState<ListItem[]> = { data: null, state: 'loading', failed: false, error: null };
  const read = startSyncedRead<ListItem[]>({ load: () => loadItems(reader, listId), onChange: (next) => (synced = next) });
  const guard = createChange<ListItem[]>({ read: () => read });
  const writes = { client: writer };
  const effects = (): ListCardEffects => ({
    client: writes.client,
    write: read.write,
    change: guard.change,
    fail: guard.fail,
    say: guard.say,
    clear: guard.clear,
    problem: (place) => guard.state().problems[place] ?? null,
  });
  return {
    read,
    writes,
    effects,
    problems: () => guard.state().problems,
    view: (): ListCardView => listCard({ listId, items: synced.data ?? [], state: synced.state, busy: guard.state().busy }, effects()),
    stop: () => read.stop(),
  };
}

type Mounted = ReturnType<typeof mount>;
const texts = (items: ListItem[]) => items.map((item) => item.text);
const crossedTexts = (items: ListItem[]) => items.map((item) => [item.text, item.crossed_at !== null]);

describe('crossing off and clearing through the synced read, against the real database', () => {
  it('shows a Device crossing off at once, and the read after it shows an item the phone added meanwhile', async () => {
    const account = await createHousehold('The Andersons');
    const wall = await asDevice(account);
    const shown: (ListItem[] | null)[] = [];
    let read: ReturnType<typeof startSyncedRead<ListItem[]>> | null = null;
    try {
      const phone = await asHouseholdAccount(account);
      const list = (await loadPinnedListId(phone))!;
      const milk = await addItem(phone, list, 'Milk', 0);
      read = startSyncedRead({ load: () => loadItems(wall.client, list), onChange: (state) => shown.push(state.data) });
      await vi.waitFor(() => expect(shown.at(-1)?.map((item) => item.text)).toEqual(['Milk']));

      const crossing = read.write(
        async () => {
          await addItem(phone, list, 'Eggs', 1);
          await setCrossed(wall.client, milk.id, true);
        },
        (rows) => withCrossed(rows, milk.id, true),
      );
      expect(shown.at(-1)?.[0]?.crossed_at).not.toBeNull();
      await crossing;
      await read.readBack();
      expect(shown.at(-1)?.map((item) => [item.text, item.crossed_at !== null])).toEqual([
        ['Milk', true],
        ['Eggs', false],
      ]);
    } finally {
      read?.stop();
      await destroyTablet(wall);
      await destroyHousehold(account);
    }
  });

  it('clears the crossed-off items at once, and the database agrees', async () => {
    const account = await createHousehold('The Andersons');
    const wall = await asDevice(account);
    let read: ReturnType<typeof startSyncedRead<ListItem[]>> | null = null;
    try {
      const phone = await asHouseholdAccount(account);
      const list = (await loadPinnedListId(phone))!;
      await addItem(phone, list, 'Milk', 0);
      const eggs = await addItem(phone, list, 'Eggs', 1);
      await setCrossed(phone, eggs.id, true);
      let shown: ListItem[] | null = null;
      read = startSyncedRead({ load: () => loadItems(wall.client, list), onChange: (state) => (shown = state.data) });
      await vi.waitFor(() => expect(shown).toHaveLength(2));

      const clearing = read.write(() => clearCompleted(wall.client, list), withoutCrossed);
      expect((shown as ListItem[] | null)?.map((item) => item.text)).toEqual(['Milk']);
      await clearing;
      expect((await loadItems(phone, list)).map((item) => item.text)).toEqual(['Milk']);
    } finally {
      read?.stop();
      await destroyTablet(wall);
      await destroyHousehold(account);
    }
  });
});

describe.each(['a Device', 'a Household Account'] as const)('the list card, written as %s', (who) => {
  const households: HouseholdAccount[] = [];
  const tablets: Tablet[] = [];
  const mounted: Mounted[] = [];

  afterEach(async () => {
    mounted.splice(0).forEach((card) => card.stop());
    await Promise.all(tablets.splice(0).map(destroyTablet));
    await Promise.all(households.splice(0).map(destroyHousehold));
  });

  // A Household whose pinned list holds Milk and then Eggs. The card reads as a Device and writes as `who`; `good` is that client.
  async function household() {
    const account = await createHousehold('The Andersons');
    households.push(account);
    const phone = await asHouseholdAccount(account);
    const wall = await asDevice(account);
    tablets.push(wall);
    let good: SupabaseClient = phone;
    if (who === 'a Device') {
      const writer = await asDevice(account);
      tablets.push(writer);
      good = writer.client;
    }
    const listId = (await loadPinnedListId(phone))!;
    await addItem(phone, listId, 'Milk', 0);
    await addItem(phone, listId, 'Eggs', 1);
    const card = (reader: SupabaseClient = wall.client, writer: SupabaseClient = good) => {
      const made = mount(listId, reader, writer);
      mounted.push(made);
      return made;
    };
    return { listId, good, card };
  }

  it('shows an add, a cross off, a move and a clear at once, and the read after them shows what was saved', async () => {
    const { card } = await household();
    const list = card();
    await vi.waitFor(() => expect(list.view().left).toBe(2));
    const at = (text: string) => list.view().items.find((item) => item.text === text)!;

    const adding = list.view().add('Bread');
    expect(texts(list.view().items)).toEqual(['Milk', 'Eggs', 'Bread']);
    await adding;

    const crossing = list.view().toggle(at('Milk'));
    expect(list.view().crossed).toBe(1);
    expect(list.view().left).toBe(2);
    await crossing;

    const moving = list.view().move(at('Bread').id, -1);
    expect(texts(list.view().items)).toEqual(['Milk', 'Bread', 'Eggs']);
    await moving;

    const clearing = list.view().clear();
    expect(texts(list.view().items)).toEqual(['Bread', 'Eggs']);
    await clearing;
    await list.read.readBack();
    expect(texts(list.view().items)).toEqual(['Bread', 'Eggs']);
    expect(list.view().left).toBe(2);
  });

  it("takes back only the write that did not go through, and says the words at the list's place", async () => {
    const { listId, card } = await household();
    const list = card();
    await vi.waitFor(() => expect(list.view().left).toBe(2));
    await list.view().toggle(list.view().items[0]!);

    list.writes.client = DEAD;
    const adding = list.view().add('Bread');
    expect(crossedTexts(list.view().items)).toEqual([
      ['Milk', true],
      ['Eggs', false],
      ['Bread', false],
    ]);
    expect(await adding).toBeNull();
    expect(crossedTexts(list.view().items)).toEqual([
      ['Milk', true],
      ['Eggs', false],
    ]);
    expect([NOT_SAVED, NOT_SAVED_OFFLINE]).toContain(list.view().problem);
    expect(list.view().left).toBeNull();
    expect(list.view().problemKey).toBeGreaterThan(0);
    expect(Object.keys(list.problems())).toEqual([`items-${listId}`]);
  });

  it('takes the words away when a write lands', async () => {
    const { card, good } = await household();
    const list = card();
    await vi.waitFor(() => expect(list.view().left).toBe(2));
    list.writes.client = DEAD;
    await list.view().add('Bread');
    expect(list.view().problem).not.toBe('');

    list.writes.client = good;
    await list.view().toggle(list.view().items.find((item) => item.text === 'Eggs')!);
    expect(list.view().problem).toBe('');
    expect(list.view().left).toBe(1);
  });

  it('counts nothing while the items are read, and nothing after a first read that failed', async () => {
    const { card } = await household();
    const loading = card();
    expect(loading.view().left).toBeNull();
    await vi.waitFor(() => expect(loading.view().left).toBe(2));

    const failed = card(REFUSED);
    await vi.waitFor(() => expect(failed.view().problem).toBe(couldNotLoad('this list')));
    expect(failed.view().left).toBeNull();
    expect(texts(failed.view().items)).toEqual([]);
  });

  it('says a move that did not save at the list, and puts the order back', async () => {
    const { card } = await household();
    const list = card();
    await vi.waitFor(() => expect(list.view().left).toBe(2));

    list.writes.client = DEAD;
    await list.view().move(list.view().items[1]!.id, -1);
    expect(list.view().problem).toBe('Could not reorder. The order may not be saved. Check your connection.');
    expect(texts(list.view().items)).toEqual(['Milk', 'Eggs']);
  });

  it("does not say a failure on one list on another, with the same change", async () => {
    const { card } = await household();
    const list = card();
    await vi.waitFor(() => expect(list.view().left).toBe(2));

    list.writes.client = DEAD;
    await list.view().add('Bread');
    expect(list.view().problem).not.toBe('');

    const another = listCard({ listId: 'another-list', items: [], state: 'ready', busy: false }, list.effects());
    expect(another.problem).toBe('');
    expect(another.left).toBe(0);
  });

  it('announces a retry that fails again as a new alert, with the same words', async () => {
    const { card } = await household();
    const list = card();
    await vi.waitFor(() => expect(list.view().left).toBe(2));

    list.writes.client = DEAD;
    await list.view().add('Bread');
    const first = list.view().problemKey;
    await list.view().add('Cheese');
    expect(list.view().problemKey).toBeGreaterThan(first);
  });
});
