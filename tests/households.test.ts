import { afterEach, describe, expect, it } from 'vitest';
import {
  asAnonymous,
  asHouseholdAccount,
  createHousehold,
  destroyHousehold,
  type HouseholdAccount,
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
