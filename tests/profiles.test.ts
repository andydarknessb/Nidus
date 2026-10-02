import { afterEach, describe, expect, it } from 'vitest';
import {
  PROFILE_PALETTE,
  byPosition,
  cleanAvatarUrl,
  contrastRatio,
  createProfile,
  deleteProfile,
  initialOf,
  loadProfiles,
  movedIds,
  nextSortOrder,
  paletteColorName,
  reorderProfiles,
  updateProfile,
} from '../src/lib/profiles';
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

const red = PROFILE_PALETTE[0].hex;
const blue = PROFILE_PALETTE[7].hex;

// What the palette's colours must clear, in both modes, is held in tests/look.test.ts.
describe('the Profile palette', () => {
  it('has distinct colours with names', () => {
    expect(new Set(PROFILE_PALETTE.map((color) => color.hex)).size).toBe(PROFILE_PALETTE.length);
    expect(paletteColorName(red)).toBe('Red');
    expect(paletteColorName('#000000')).toBeUndefined();
  });

  it('computes contrast the WCAG way', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5);
  });
});

describe('profile helpers', () => {
  it('orders by position and appends at the bottom', () => {
    const rows = [{ sort_order: 2 }, { sort_order: 0 }, { sort_order: 1 }];
    expect(byPosition(rows).map((row) => row.sort_order)).toEqual([0, 1, 2]);
    expect(nextSortOrder(rows)).toBe(3);
    expect(nextSortOrder([])).toBe(0);
  });

  it('moves an id by an offset, clamped to the ends', () => {
    expect(movedIds(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b']);
    expect(movedIds(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(movedIds(['a', 'b', 'c'], 'a', 5)).toEqual(['b', 'c', 'a']);
    expect(movedIds(['a', 'b'], 'zzz', 1)).toEqual(['a', 'b']);
  });

  it("takes the first letter of a name, in capitals, for a person's disc", () => {
    expect(initialOf('ava')).toBe('A');
    expect(initialOf('  Ben ')).toBe('B');
    expect(initialOf('élise')).toBe('É');
    expect(initialOf('🐶 Rex')).toBe('🐶');
    expect(initialOf('   ')).toBe('');
  });

  it('treats a blank avatar as none', () => {
    expect(cleanAvatarUrl('  ')).toBeNull();
    expect(cleanAvatarUrl(' https://example.com/a.png ')).toBe('https://example.com/a.png');
  });
});

describe('profiles', () => {
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

  it('a Household Account creates, edits, reorders and deletes Profiles', async () => {
    const { arranged, phone } = await household('The Andersons');
    const id = arranged.household.id;

    const mom = await createProfile(phone, id, { name: ' Mom ', color: red, avatar_url: null }, 0);
    const kid = await createProfile(phone, id, { name: 'Sam', color: blue, avatar_url: 'https://example.com/sam.png' }, 1);
    expect(mom).toMatchObject({ name: 'Mom', color: red, avatar_url: null, sort_order: 0 });
    expect((await loadProfiles(phone)).map((p) => p.name)).toEqual(['Mom', 'Sam']);

    await updateProfile(phone, kid.id, { name: 'Samuel', color: red, avatar_url: null });
    expect((await loadProfiles(phone)).find((p) => p.id === kid.id)).toMatchObject({
      name: 'Samuel',
      color: red,
      avatar_url: null,
    });

    await reorderProfiles(phone, [kid.id, mom.id]);
    expect((await loadProfiles(phone)).map((p) => p.name)).toEqual(['Samuel', 'Mom']);

    await deleteProfile(phone, mom.id);
    expect((await loadProfiles(phone)).map((p) => p.name)).toEqual(['Samuel']);
  });

  it('rejects an empty name, a malformed colour and a non-web avatar', async () => {
    const { arranged, phone } = await household('The Andersons');
    const id = arranged.household.id;

    await expect(createProfile(phone, id, { name: '   ', color: red, avatar_url: null }, 0)).rejects.toMatchObject({ code: '23514' });
    await expect(createProfile(phone, id, { name: 'Mom', color: 'red', avatar_url: null }, 0)).rejects.toMatchObject({ code: '23514' });
    // Only whitespace of any kind is still blank; the client's trim is not the guard.
    const tab = await phone.from('profiles').insert({ household_id: id, name: '\t\n', color: red });
    expect(tab.error?.code).toBe('23514');
    await expect(createProfile(phone, id, { name: 'Mom', color: red, avatar_url: 'http://example.com/a.png' }, 0)).rejects.toMatchObject({ code: '23514' });
    await expect(createProfile(phone, id, { name: 'Mom', color: red, avatar_url: 'HTTPS://example.com/a.png' }, 0)).resolves.toMatchObject({ name: 'Mom' });
    await expect(
      createProfile(phone, id, { name: 'Mom', color: red, avatar_url: 'javascript:alert(1)' }, 0),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it("another household's account sees nothing and can change nothing", async () => {
    const { arranged: ours, phone: usPhone } = await household('Ours');
    const { arranged: theirs, phone: themPhone } = await household('Theirs');
    const mine = await createProfile(usPhone, ours.household.id, { name: 'Mom', color: red, avatar_url: null }, 0);

    expect(await loadProfiles(themPhone)).toEqual([]);

    // Not even by naming the row: updates and deletes match nothing.
    await updateProfile(themPhone, mine.id, { name: 'Hijacked', color: blue, avatar_url: null });
    await deleteProfile(themPhone, mine.id);
    await expect(reorderProfiles(themPhone, [mine.id])).rejects.toBeTruthy();
    expect(await loadProfiles(usPhone)).toEqual([mine]);

    // And it cannot plant a Profile in our Household, nor move one of its own into it.
    await expect(createProfile(themPhone, ours.household.id, { name: 'Planted', color: red, avatar_url: null }, 1)).rejects.toBeTruthy();
    const theirProfile = await createProfile(themPhone, theirs.household.id, { name: 'Theirs', color: red, avatar_url: null }, 0);
    const moved = await themPhone.from('profiles').update({ household_id: ours.household.id }).eq('id', theirProfile.id);
    expect(moved.error).toBeTruthy();
    expect(await loadProfiles(usPhone)).toEqual([mine]);
  });

  it('a Device reads its Household\'s Profiles but cannot insert, update, reorder or delete them', async () => {
    const { arranged, phone } = await household('The Andersons');
    const mom = await createProfile(phone, arranged.household.id, { name: 'Mom', color: red, avatar_url: null }, 0);
    const wall = await device(arranged);

    expect(await loadProfiles(wall)).toEqual([mom]);

    await expect(createProfile(wall, arranged.household.id, { name: 'Sneaky', color: blue, avatar_url: null }, 1)).rejects.toMatchObject({
      code: '42501',
    });
    // Updates and deletes match no row for the Device (RLS filters it out), and the reorder says so.
    const update = await wall.from('profiles').update({ name: 'Renamed' }).eq('id', mom.id).select('id');
    expect(update.data).toEqual([]);
    const removal = await wall.from('profiles').delete().eq('id', mom.id).select('id');
    expect(removal.data).toEqual([]);
    await expect(reorderProfiles(wall, [mom.id])).rejects.toBeTruthy();

    expect(await loadProfiles(phone)).toEqual([mom]);
  });

  it('a visitor with no session reads nothing and writes nothing', async () => {
    const { arranged, phone } = await household('The Andersons');
    await createProfile(phone, arranged.household.id, { name: 'Mom', color: red, avatar_url: null }, 0);

    const visitor = asAnonymous();
    expect((await visitor.from('profiles').select('id')).error).toBeTruthy();
    expect((await visitor.from('profiles').insert({ household_id: arranged.household.id, name: 'X', color: red })).error).toBeTruthy();
  });

  it('deleting a Household deletes its Profiles', async () => {
    const { arranged, phone } = await household('The Andersons');
    await createProfile(phone, arranged.household.id, { name: 'Mom', color: red, avatar_url: null }, 0);

    await destroyHousehold(arranged);
    households.splice(households.indexOf(arranged), 1);

    const left = await asServiceRole().from('profiles').select('id').eq('household_id', arranged.household.id);
    expect(left.data).toEqual([]);
  });

  it('a reorder that names a Profile it cannot move changes nothing', async () => {
    const { arranged, phone } = await household('The Andersons');
    const { arranged: other, phone: otherPhone } = await household('Other');
    const a = await createProfile(phone, arranged.household.id, { name: 'A', color: red, avatar_url: null }, 0);
    const b = await createProfile(phone, arranged.household.id, { name: 'B', color: blue, avatar_url: null }, 1);
    const foreign = await createProfile(otherPhone, other.household.id, { name: 'F', color: red, avatar_url: null }, 0);

    await expect(reorderProfiles(phone, [b.id, foreign.id, a.id])).rejects.toBeTruthy();

    expect((await loadProfiles(phone)).map((p) => p.name)).toEqual(['A', 'B']);
    expect((await loadProfiles(otherPhone)).map((p) => p.sort_order)).toEqual([0]);
  });
});
