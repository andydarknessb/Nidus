import { afterEach, describe, expect, it } from 'vitest';
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

describe('households', () => {
  const arranged: HouseholdAccount[] = [];

  afterEach(async () => {
    await Promise.all(arranged.splice(0).map(destroyHousehold));
  });

  it('refuses a client with no session at the table grant', async () => {
    arranged.push(await createHousehold('The Andersons'));

    const { data, error } = await asAnonymous().from('households').select('id');

    expect(error?.code).toBe('42501');
    expect(data).toBeNull();
  });

  it('a Household Account reads its own Household and nobody else\'s', async () => {
    const mine = await createHousehold('The Andersons');
    const neighbours = await createHousehold('The Nguyens');
    arranged.push(mine, neighbours);

    const account = await asHouseholdAccount(mine);
    const { data, error } = await account.from('households').select('id, name, timezone');

    expect(error).toBeNull();
    expect(data).toEqual([{ id: mine.household.id, name: 'The Andersons', timezone: 'America/Chicago' }]);
  });

  it('refuses a delete by a Household Account at the table grant', async () => {
    const mine = await createHousehold('The Andersons');
    arranged.push(mine);

    const account = await asHouseholdAccount(mine);
    const { error } = await account.from('households').delete().eq('id', mine.household.id);

    expect(error?.code).toBe('42501');
  });
});

describe('household weather', () => {
  const households: HouseholdAccount[] = [];
  const tablets: Tablet[] = [];

  const columns = 'weather_place, latitude, longitude, temperature_unit';
  const place = { weather_place: 'Austin, Texas, United States', latitude: 30.27, longitude: -97.74 };
  const noPlace = { weather_place: null, latitude: null, longitude: null };
  const none = { ...noPlace, temperature_unit: 'fahrenheit' };

  afterEach(async () => {
    await Promise.all(tablets.splice(0).map(destroyTablet));
    await Promise.all(households.splice(0).map(destroyHousehold));
  });

  async function household(name: string) {
    const arranged = await createHousehold(name);
    households.push(arranged);
    return { arranged, id: arranged.household.id, phone: await asHouseholdAccount(arranged) };
  }

  async function device(account: HouseholdAccount) {
    const arranged = await asDevice(account);
    tablets.push(arranged);
    return arranged.client;
  }

  // What the Household row holds, read past row-level security.
  async function stored(id: string) {
    const { data } = await asServiceRole().from('households').select(columns).eq('id', id).single();
    return data;
  }

  it('a new Household has no place and shows Fahrenheit', async () => {
    const { phone, id } = await household('The Andersons');

    const { data, error } = await phone.from('households').select(columns).eq('id', id).single();

    expect(error).toBeNull();
    expect(data).toEqual(none);
  });

  it('a Household Account saves a place and a unit, changes only the unit, and clears the place', async () => {
    const { phone, id } = await household('The Andersons');
    const write = (changes: object) => phone.from('households').update(changes).eq('id', id).select(columns).single();

    const saved = await write({ ...place, temperature_unit: 'celsius' });
    expect(saved.error).toBeNull();
    expect(saved.data).toEqual({ ...place, temperature_unit: 'celsius' });

    // The unit alone, without searching for the place again.
    const unit = await write({ temperature_unit: 'fahrenheit' });
    expect(unit.error).toBeNull();
    expect(unit.data).toEqual({ ...place, temperature_unit: 'fahrenheit' });

    // The edges of the map and a name of 100 characters are the most the checks allow.
    const edge = await write({ weather_place: 'x'.repeat(100), latitude: -90, longitude: 180 });
    expect(edge.error).toBeNull();
    expect(edge.data).toEqual({ weather_place: 'x'.repeat(100), latitude: -90, longitude: 180, temperature_unit: 'fahrenheit' });

    const cleared = await write(noPlace);
    expect(cleared.error).toBeNull();
    expect(cleared.data).toEqual(none);
    expect(await stored(id)).toEqual(none);
  });

  it('keeps the coordinates to two decimals, whatever it was given', async () => {
    const { phone, id } = await household('The Andersons');

    const { data, error } = await phone
      .from('households')
      .update({ weather_place: 'Austin, Texas, United States', latitude: 30.26715, longitude: -97.74306 })
      .eq('id', id)
      .select(columns)
      .single();

    expect(error).toBeNull();
    expect(data).toMatchObject({ latitude: 30.27, longitude: -97.74 });
    expect(await stored(id)).toMatchObject({ latitude: 30.27, longitude: -97.74 });
  });

  it('refuses a place with only some of its three columns', async () => {
    const { phone, id } = await household('The Andersons');
    const attempt = (changes: object) => phone.from('households').update(changes).eq('id', id);
    const some = [
      ['weather_place'],
      ['latitude'],
      ['longitude'],
      ['weather_place', 'latitude'],
      ['weather_place', 'longitude'],
      ['latitude', 'longitude'],
    ] as const;

    // With no place yet, setting some of its columns but not all.
    for (const set of some) {
      const { error } = await attempt(Object.fromEntries(set.map((column) => [column, place[column]])));
      expect(error, `setting ${set.join(' and ')}`).not.toBeNull();
    }
    expect(await stored(id)).toEqual(none);

    // With a place, clearing some of its columns but not all.
    expect((await attempt(place)).error).toBeNull();
    for (const clear of some) {
      const { error } = await attempt(Object.fromEntries(clear.map((column) => [column, null])));
      expect(error, `clearing ${clear.join(' and ')}`).not.toBeNull();
    }
    expect(await stored(id)).toEqual({ ...place, temperature_unit: 'fahrenheit' });
  });

  it('refuses a coordinate out of range, a blank or overlong name and an unknown unit', async () => {
    const { phone, id } = await household('The Andersons');
    expect((await phone.from('households').update({ ...place, temperature_unit: 'celsius' }).eq('id', id)).error).toBeNull();
    const refused: [string, object][] = [
      ['a latitude of 91', { latitude: 91 }],
      ['a latitude of -91', { latitude: -91 }],
      ['a longitude of 181', { longitude: 181 }],
      ['a longitude of -181', { longitude: -181 }],
      ['an empty name', { weather_place: '' }],
      ['a blank name', { weather_place: ' \t\n ' }],
      ['a name of 101 characters', { weather_place: 'x'.repeat(101) }],
      ['an unknown unit', { temperature_unit: 'kelvin' }],
      ['no unit', { temperature_unit: null }],
    ];

    for (const [label, changes] of refused) {
      const { error } = await phone.from('households').update(changes).eq('id', id);
      expect(error, label).not.toBeNull();
    }

    expect(await stored(id)).toEqual({ ...place, temperature_unit: 'celsius' });
  });

  it("a Device reads its Household's place and unit and cannot change them", async () => {
    const { arranged, phone, id } = await household('The Andersons');
    await phone.from('households').update({ ...place, temperature_unit: 'celsius' }).eq('id', id);
    const wall = await device(arranged);

    const read = await wall.from('households').select(columns);
    expect(read.error).toBeNull();
    expect(read.data).toEqual([{ ...place, temperature_unit: 'celsius' }]);

    // Each attempt matches no row for a Device.
    for (const changes of [noPlace, { temperature_unit: 'fahrenheit' }, { weather_place: 'Elsewhere', latitude: 1, longitude: 2 }]) {
      const attempt = await wall.from('households').update(changes).eq('id', id).select('id');
      expect(attempt.data ?? []).toEqual([]);
    }
    expect(await stored(id)).toEqual({ ...place, temperature_unit: 'celsius' });
  });

  it("another Household's Household Account and Device read and change nothing", async () => {
    const { phone: ours, id } = await household('Ours');
    const { arranged: theirs, phone: theirPhone, id: theirId } = await household('Theirs');
    await ours.from('households').update({ ...place, temperature_unit: 'celsius' }).eq('id', id);
    const theirWall = await device(theirs);

    for (const [who, client] of [['Household Account', theirPhone], ['Device', theirWall]] as const) {
      const read = await client.from('households').select(columns).eq('id', id);
      expect(read.data ?? [], `a ${who} reading`).toEqual([]);

      const attempt = await client.from('households').update({ ...noPlace, temperature_unit: 'fahrenheit' }).eq('id', id).select('id');
      expect(attempt.data ?? [], `a ${who} writing`).toEqual([]);
    }

    expect(await stored(id)).toEqual({ ...place, temperature_unit: 'celsius' });
    // And their own Household is as it was: nothing of ours leaked into it.
    expect(await stored(theirId)).toEqual(none);
  });

  it('an unpaired tablet reads no Household and cannot set a place or unit on one', async () => {
    const { id } = await household('The Andersons');
    const tablet = await asTablet();
    tablets.push(tablet);

    const read = await tablet.client.from('households').select(columns);
    expect(read.error).toBeNull();
    expect(read.data).toEqual([]);

    // It holds the table-level update grant, so the write is no error: it simply matches no row.
    const write = await tablet.client.from('households').update({ ...place, temperature_unit: 'celsius' }).eq('id', id).select('id');
    expect(write.data ?? []).toEqual([]);
    expect(await stored(id)).toEqual(none);
  });

  it('refuses a client with no session', async () => {
    const { id } = await household('The Andersons');
    const visitor = asAnonymous();

    const read = await visitor.from('households').select(columns);
    expect(read.error?.code).toBe('42501');
    expect(read.data).toBeNull();

    const write = await visitor.from('households').update({ ...place, temperature_unit: 'celsius' }).eq('id', id).select('id');
    expect(write.error?.code).toBe('42501');
    expect(await stored(id)).toEqual(none);
  });
});
