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

  it('an anonymous visitor reads zero households', async () => {
    arranged.push(await createHousehold('The Andersons'));

    const { data, error } = await asAnonymous().from('households').select('id');

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('a Household Account reads its own Household and nobody else\'s', async () => {
    const mine = await createHousehold('The Andersons');
    const neighbours = await createHousehold('The Nguyens');
    arranged.push(mine, neighbours);

    const { data, error } = await asHouseholdAccount(mine).then((c) => c.from('households').select('id, name, timezone'));

    expect(error).toBeNull();
    expect(data).toEqual([{ id: mine.household.id, name: 'The Andersons', timezone: 'America/Chicago' }]);
  });
});
