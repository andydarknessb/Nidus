import { afterEach, describe, expect, it } from 'vitest';
import {
  asAnonymous,
  asHouseholdAccount,
  asServiceRole,
  createHousehold,
  createSignedUpAccount,
  destroyHousehold,
  destroySignedUpAccount,
  signInAs,
  type HouseholdAccount,
  type SignedUpAccount,
} from './support/supabase';

describe('first sign-in creates a Household', () => {
  const newcomers: SignedUpAccount[] = [];
  const arranged: HouseholdAccount[] = [];

  afterEach(async () => {
    await Promise.all(newcomers.splice(0).map(destroySignedUpAccount));
    await Promise.all(arranged.splice(0).map(destroyHousehold));
  });

  async function newcomer() {
    const account = await createSignedUpAccount();
    newcomers.push(account);
    return { account, client: await signInAs(account) };
  }

  it('creates one Household named for the display name, with the browser timezone, and one link', async () => {
    const { account, client } = await newcomer();

    const { data: id, error } = await client.rpc('ensure_household', {
      display_name: 'Cory Anderson',
      browser_timezone: 'America/Denver',
    });
    expect(error).toBeNull();

    const { data: households } = await client.from('households').select('id, name, timezone');
    expect(households).toEqual([{ id, name: 'Cory Anderson', timezone: 'America/Denver' }]);

    const { data: links } = await asServiceRole()
      .from('household_accounts')
      .select('household_id')
      .eq('auth_user_id', account.authUserId);
    expect(links).toEqual([{ household_id: id }]);
  });

  it('later sign-ins reuse the Household instead of creating another', async () => {
    const { account, client } = await newcomer();
    const first = await client.rpc('ensure_household', { display_name: 'Cory', browser_timezone: 'America/Denver' });
    const second = await client.rpc('ensure_household', { display_name: 'Someone Else', browser_timezone: 'Asia/Tokyo' });

    expect(second.error).toBeNull();
    expect(second.data).toBe(first.data);

    const { data: links } = await asServiceRole()
      .from('household_accounts')
      .select('household_id')
      .eq('auth_user_id', account.authUserId);
    expect(links).toHaveLength(1);
    const { data: households } = await client.from('households').select('name, timezone');
    expect(households).toEqual([{ name: 'Cory', timezone: 'America/Denver' }]);
  });

  it('rejects a browser timezone that is not an IANA name', async () => {
    const { client } = await newcomer();
    const { error } = await client.rpc('ensure_household', { display_name: 'Cory', browser_timezone: 'Mars/Olympus' });
    expect(error).not.toBeNull();
  });

  it('gives an anonymous visitor no way to create a Household', async () => {
    const { error } = await asAnonymous().rpc('ensure_household', {
      display_name: 'Nobody',
      browser_timezone: 'UTC',
    });
    expect(error).not.toBeNull();
  });
});

describe('Household settings', () => {
  const arranged: HouseholdAccount[] = [];

  afterEach(async () => {
    await Promise.all(arranged.splice(0).map(destroyHousehold));
  });

  it('rename and timezone persist', async () => {
    const mine = await createHousehold('The Andersons');
    arranged.push(mine);
    const client = await asHouseholdAccount(mine);

    const { error } = await client
      .from('households')
      .update({ name: 'The Andersons-Nguyen', timezone: 'Europe/Paris' })
      .eq('id', mine.household.id);
    expect(error).toBeNull();

    const fresh = await asHouseholdAccount(mine);
    const { data } = await fresh.from('households').select('name, timezone');
    expect(data).toEqual([{ name: 'The Andersons-Nguyen', timezone: 'Europe/Paris' }]);
  });

  it.each(['Mars/Olympus', 'posix/America/Denver', 'right/UTC', 'Factory', 'EST5EDT-ish', '', 'america/chicago '])('refuses timezone %j', async (bad) => {
    const mine = await createHousehold('The Andersons');
    arranged.push(mine);
    const client = await asHouseholdAccount(mine);

    const { error } = await client.from('households').update({ timezone: bad }).eq('id', mine.household.id);
    expect(error).not.toBeNull();

    const { data } = await client.from('households').select('timezone');
    expect(data).toEqual([{ timezone: 'America/Chicago' }]);
  });

  it('Household Account A reads and updates only its own; B cannot see or change A\'s', async () => {
    const a = await createHousehold('Household A');
    const b = await createHousehold('Household B');
    arranged.push(a, b);
    const clientA = await asHouseholdAccount(a);
    const clientB = await asHouseholdAccount(b);

    const { data: seenByA } = await clientA.from('households').select('id');
    expect(seenByA).toEqual([{ id: a.household.id }]);
    const { data: seenByB } = await clientB.from('households').select('id');
    expect(seenByB).toEqual([{ id: b.household.id }]);

    const { data: touched } = await clientB
      .from('households')
      .update({ name: 'Hijacked' })
      .eq('id', a.household.id)
      .select('id');
    expect(touched).toEqual([]);

    const { data: stillA } = await clientA.from('households').select('name');
    expect(stillA).toEqual([{ name: 'Household A' }]);

    const { data: ownRename } = await clientA
      .from('households')
      .update({ name: 'Renamed A' })
      .eq('id', a.household.id)
      .select('name');
    expect(ownRename).toEqual([{ name: 'Renamed A' }]);
  });
});
