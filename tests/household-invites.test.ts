import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it } from 'vitest';
import {
  asAnonymous,
  asDevice,
  asHouseholdAccount,
  asServiceRole,
  asTablet,
  createHousehold,
  createSignedUpAccount,
  destroyHousehold,
  destroySignedUpAccount,
  destroyTablet,
  signInAs,
  type HouseholdAccount,
  type SignedUpAccount,
  type Tablet,
} from './support/supabase';

// Household Invites through the seam (docs/specs/0006-household-invites.md): the Supabase client acting as a real
// principal against the local stack. The refusals the database raises are PT410 (a link that does not work, whatever
// the reason) and PT409 (the caller already belongs to another Household).
const DEAD_LINK = 'PT410';
const OTHER_HOUSEHOLD = 'PT409';
const REFUSED = '42501';

type Invite = { token: string; expires_at: string };

async function makeInvite(client: SupabaseClient): Promise<Invite> {
  const { data, error } = await client.rpc('create_household_invite').single<Invite>();
  if (error || !data) throw error ?? new Error('create_household_invite returned nothing');
  return data;
}

const remove = (client: SupabaseClient, authUserId: string) => client.rpc('remove_household_account', { p_auth_user_id: authUserId });
const accept = (client: SupabaseClient, token: string) => client.rpc('accept_household_invite', { p_token: token });

describe('household invites', () => {
  const households: HouseholdAccount[] = [];
  const newcomers: SignedUpAccount[] = [];
  const tablets: Tablet[] = [];

  afterEach(async () => {
    await Promise.all(tablets.splice(0).map(destroyTablet));
    await Promise.all(newcomers.splice(0).map(destroySignedUpAccount));
    await Promise.all(households.splice(0).map(destroyHousehold));
  });

  async function household(name?: string) {
    const arranged = await createHousehold(name);
    households.push(arranged);
    return { arranged, phone: await asHouseholdAccount(arranged) };
  }

  async function newcomer() {
    const arranged = await createSignedUpAccount();
    newcomers.push(arranged);
    return { arranged, phone: await signInAs(arranged) };
  }

  async function device(account: HouseholdAccount) {
    const arranged = await asDevice(account);
    tablets.push(arranged);
    return arranged;
  }

  async function accountIds(householdId: string): Promise<string[]> {
    const { data, error } = await asServiceRole().from('household_accounts').select('auth_user_id').eq('household_id', householdId);
    if (error) throw error;
    return data.map((row) => row.auth_user_id as string);
  }

  async function storedInvite(householdId: string) {
    const { data, error } = await asServiceRole()
      .from('household_invites')
      .select('token_hash, created_at, expires_at')
      .eq('household_id', householdId)
      .maybeSingle<{ token_hash: string; created_at: string; expires_at: string }>();
    if (error) throw error;
    return data;
  }

  describe('making, reading and cancelling', () => {
    it('a Household Account gets a 64-character hex token that lasts 7 days, and only its SHA-256 is stored', async () => {
      const { arranged, phone } = await household();
      const before = Date.now();

      const invite = await makeInvite(phone);

      expect(invite.token).toMatch(/^[0-9a-f]{64}$/);
      const days = (new Date(invite.expires_at).getTime() - before) / 86_400_000;
      expect(days).toBeGreaterThan(6.99);
      expect(days).toBeLessThanOrEqual(7.01);
      const stored = await storedInvite(arranged.household.id);
      expect(stored?.token_hash).toBe(createHash('sha256').update(invite.token).digest('hex'));
      expect(stored?.token_hash).not.toBe(invite.token);
    });

    it('a Household Account reads when its invite expires, and never the token hash', async () => {
      const { arranged, phone } = await household();
      await makeInvite(phone);

      const { data, error } = await phone.from('household_invites').select('household_id, created_at, expires_at');
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data?.[0]?.household_id).toBe(arranged.household.id);

      const hash = await phone.from('household_invites').select('token_hash');
      expect(hash.error?.code).toBe(REFUSED);
      expect(hash.data).toBeNull();
      const all = await phone.from('household_invites').select('*');
      expect(all.error?.code).toBe(REFUSED);
    });

    it('a Household Account never reads another Household\'s invite', async () => {
      const { phone } = await household();
      const neighbours = await household();
      await makeInvite(neighbours.phone);

      const { data, error } = await phone.from('household_invites').select('household_id');

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it('making a new invite replaces the old one, which stops working', async () => {
      const { arranged, phone } = await household();
      const first = await makeInvite(phone);
      const second = await makeInvite(phone);
      const guest = await newcomer();

      expect(second.token).not.toBe(first.token);
      const { count } = await asServiceRole()
        .from('household_invites')
        .select('household_id', { count: 'exact', head: true })
        .eq('household_id', arranged.household.id);
      expect(count).toBe(1);

      const stale = await accept(guest.phone, first.token);
      expect(stale.error?.code).toBe(DEAD_LINK);
      const fresh = await accept(guest.phone, second.token);
      expect(fresh.error).toBeNull();
    });

    it('cancelling ends the invite, and cancelling with none is not an error', async () => {
      const { arranged, phone } = await household();
      const invite = await makeInvite(phone);

      expect((await phone.rpc('cancel_household_invite')).error).toBeNull();
      expect(await storedInvite(arranged.household.id)).toBeNull();
      expect((await phone.rpc('cancel_household_invite')).error).toBeNull();

      const guest = await newcomer();
      expect((await accept(guest.phone, invite.token)).error?.code).toBe(DEAD_LINK);
    });

    it('a Device and a visitor with no session cannot make, cancel, read or list', async () => {
      const { arranged, phone } = await household();
      await makeInvite(phone);
      const wall = await device(arranged);
      const visitor = asAnonymous();

      for (const client of [wall.client, visitor]) {
        expect((await client.rpc('create_household_invite')).error?.code).toBe(REFUSED);
        expect((await client.rpc('cancel_household_invite')).error?.code).toBe(REFUSED);
        expect((await client.rpc('household_account_list')).error?.code).toBe(REFUSED);
      }
      // The Device reaches the table but sees no row; the visitor is refused at the grant.
      const deviceRead = await wall.client.from('household_invites').select('household_id');
      expect(deviceRead.error).toBeNull();
      expect(deviceRead.data).toEqual([]);
      expect((await visitor.from('household_invites').select('household_id')).error?.code).toBe(REFUSED);
      // Nothing was cancelled.
      expect(await storedInvite(arranged.household.id)).not.toBeNull();
    });

    it('no client can insert, update or delete an invite directly', async () => {
      const { arranged, phone } = await household();
      const invite = await makeInvite(phone);

      const insert = await phone.from('household_invites').insert({ household_id: arranged.household.id, token_hash: 'x', expires_at: new Date().toISOString() });
      const update = await phone.from('household_invites').update({ expires_at: '2999-01-01T00:00:00Z' }).eq('household_id', arranged.household.id);
      const remove = await phone.from('household_invites').delete().eq('household_id', arranged.household.id);

      expect(insert.error?.code).toBe(REFUSED);
      expect(update.error?.code).toBe(REFUSED);
      expect(remove.error?.code).toBe(REFUSED);
      const stored = await storedInvite(arranged.household.id);
      expect(stored?.token_hash).toBe(createHash('sha256').update(invite.token).digest('hex'));
    });
  });

  describe('accepting', () => {
    it('a signed-up account joins, then reads and updates the Household and pairs a tablet', async () => {
      const { arranged, phone } = await household('The Andersons');
      const guest = await newcomer();
      const { token } = await makeInvite(phone);

      const joined = await accept(guest.phone, token);

      expect(joined.error).toBeNull();
      expect(joined.data).toBe(arranged.household.id);
      expect(await accountIds(arranged.household.id)).toContain(guest.arranged.authUserId);

      const read = await guest.phone.from('households').select('id, name');
      expect(read.data).toEqual([{ id: arranged.household.id, name: 'The Andersons' }]);
      const renamed = await guest.phone.from('households').update({ name: 'The Anderson-Nguyens' }).eq('id', arranged.household.id).select('name');
      expect(renamed.data).toEqual([{ name: 'The Anderson-Nguyens' }]);

      const wall = await asTablet();
      tablets.push(wall);
      const { data: request } = await wall.client.rpc('create_pairing_request').single<{ code: string }>();
      const claim = await guest.phone.rpc('claim_pairing_code', { pairing_code: request?.code, device_name: 'Hall' });
      expect(claim.error).toBeNull();
      const { data: devices } = await asServiceRole().from('devices').select('household_id').eq('auth_user_id', wall.authUserId);
      expect(devices).toEqual([{ household_id: arranged.household.id }]);
    });

    it('the invite is spent: the token works once, and a second account is refused', async () => {
      const { arranged, phone } = await household();
      const first = await newcomer();
      const second = await newcomer();
      const { token } = await makeInvite(phone);

      expect((await accept(first.phone, token)).error).toBeNull();
      const again = await accept(second.phone, token);

      expect(again.error?.code).toBe(DEAD_LINK);
      expect(await storedInvite(arranged.household.id)).toBeNull();
      expect(await accountIds(arranged.household.id)).not.toContain(second.arranged.authUserId);
    });

    it('two accounts racing one link: exactly one joins', async () => {
      const { arranged, phone } = await household();
      const first = await newcomer();
      const second = await newcomer();
      const { token } = await makeInvite(phone);

      const results = await Promise.all([accept(first.phone, token), accept(second.phone, token)]);

      expect(results.filter((result) => result.error === null)).toHaveLength(1);
      expect(results.filter((result) => result.error?.code === DEAD_LINK)).toHaveLength(1);
      expect(await accountIds(arranged.household.id)).toHaveLength(2);
    });

    it('a replaced, cancelled, expired, unknown and malformed token each get the same refusal', async () => {
      const { arranged, phone } = await household();
      const guest = await newcomer();
      const replaced = await makeInvite(phone);
      const current = await makeInvite(phone);
      await asServiceRole()
        .from('household_invites')
        .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
        .eq('household_id', arranged.household.id);
      const cancelled = await makeInvite(phone);
      await phone.rpc('cancel_household_invite');

      const tokens = [replaced.token, current.token, cancelled.token, 'a'.repeat(64), 'not a token', current.token.toUpperCase(), '', current.token.slice(1)];
      for (const token of tokens) {
        const { data, error } = await accept(guest.phone, token);
        expect(error?.code, token).toBe(DEAD_LINK);
        expect(data).toBeNull();
      }
      expect(await accountIds(arranged.household.id)).not.toContain(guest.arranged.authUserId);
    });

    it('an expired invite is refused for a newcomer and for a member of its own Household', async () => {
      const { arranged, phone } = await household();
      const guest = await newcomer();
      const { token } = await makeInvite(phone);
      await asServiceRole()
        .from('household_invites')
        .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
        .eq('household_id', arranged.household.id);

      const fromNewcomer = await accept(guest.phone, token);
      const fromMember = await accept(phone, token);

      expect(fromNewcomer.error?.code).toBe(DEAD_LINK);
      expect(await accountIds(arranged.household.id)).not.toContain(guest.arranged.authUserId);
      expect(fromMember.error?.code).toBe(DEAD_LINK);
    });

    it('a Household Account of another Household is refused with its own refusal, and stays where it was', async () => {
      const { arranged, phone } = await household();
      const neighbours = await household();
      const { token } = await makeInvite(phone);

      const { data, error } = await accept(neighbours.phone, token);

      expect(error?.code).toBe(OTHER_HOUSEHOLD);
      expect(data).toBeNull();
      expect(await accountIds(neighbours.arranged.household.id)).toEqual([neighbours.arranged.authUserId]);
      expect(await accountIds(arranged.household.id)).toEqual([arranged.authUserId]);
      // The refusal spends nothing.
      expect(await storedInvite(arranged.household.id)).not.toBeNull();
    });

    it('a member of the inviting Household gets the Household back and leaves the invite unspent', async () => {
      const { arranged, phone } = await household();
      const { token } = await makeInvite(phone);

      const { data, error } = await accept(phone, token);

      expect(error).toBeNull();
      expect(data).toBe(arranged.household.id);
      expect(await storedInvite(arranged.household.id)).not.toBeNull();
      const guest = await newcomer();
      expect((await accept(guest.phone, token)).error).toBeNull();
    });

    it('a Device and a visitor with no session cannot accept', async () => {
      const { arranged, phone } = await household();
      const { token } = await makeInvite(phone);
      const wall = await device(arranged);

      expect((await accept(wall.client, token)).error?.code).toBe(REFUSED);
      expect((await accept(asAnonymous(), token)).error?.code).toBe(REFUSED);
      const loose = await asTablet();
      tablets.push(loose);
      expect((await accept(loose.client, token)).error?.code).toBe(REFUSED);
      expect(await storedInvite(arranged.household.id)).not.toBeNull();
    });
  });

  describe('who can sign in', () => {
    it('lists both accounts with their emails, oldest first, and never another Household\'s', async () => {
      const { arranged, phone } = await household();
      const neighbours = await household();
      const guest = await newcomer();
      const { token } = await makeInvite(phone);
      await accept(guest.phone, token);

      const { data, error } = await phone.rpc('household_account_list');

      expect(error).toBeNull();
      expect(data).toEqual([
        { auth_user_id: arranged.authUserId, email: arranged.email, created_at: expect.any(String) },
        { auth_user_id: guest.arranged.authUserId, email: guest.arranged.email, created_at: expect.any(String) },
      ]);
      expect(JSON.stringify(data)).not.toContain(neighbours.arranged.email);
      const theirs = await neighbours.phone.rpc('household_account_list');
      expect(theirs.data).toHaveLength(1);
    });

    it('a Household Account removes another of its Household, who then reads nothing', async () => {
      const { arranged, phone } = await household();
      const guest = await newcomer();
      await accept(guest.phone, (await makeInvite(phone)).token);
      expect((await guest.phone.from('households').select('id')).data).toHaveLength(1);

      const removed = await remove(phone, guest.arranged.authUserId);

      expect(removed.error).toBeNull();
      expect(removed.data).toBe(true);
      expect(await accountIds(arranged.household.id)).toEqual([arranged.authUserId]);
      // The removed session is a stranger's at once, though its token is still valid.
      expect((await guest.phone.from('households').select('id')).data).toEqual([]);
      expect((await guest.phone.rpc('household_account_list')).error?.code).toBe(REFUSED);
    });

    it('removing an account deletes only that link: the Household, its Devices and the other account stay', async () => {
      const { arranged, phone } = await household();
      const wall = await device(arranged);
      const guest = await newcomer();
      await accept(guest.phone, (await makeInvite(phone)).token);

      await remove(phone, guest.arranged.authUserId);

      const { data } = await asServiceRole().from('devices').select('auth_user_id').eq('household_id', arranged.household.id);
      expect(data).toEqual([{ auth_user_id: wall.authUserId }]);
      expect((await phone.from('households').select('id')).data).toHaveLength(1);
    });

    it("removing an account ends the Household's invite", async () => {
      const { arranged, phone } = await household();
      const guest = await newcomer();
      await accept(guest.phone, (await makeInvite(phone)).token);
      await makeInvite(phone);

      await remove(phone, guest.arranged.authUserId);

      expect(await storedInvite(arranged.household.id)).toBeNull();
    });

    it('a removed account cannot come back with a link it made before it was removed', async () => {
      const { arranged, phone } = await household();
      const guest = await newcomer();
      await accept(guest.phone, (await makeInvite(phone)).token);
      const { token } = await makeInvite(guest.phone);

      await remove(phone, guest.arranged.authUserId);
      const back = await accept(guest.phone, token);

      expect(back.error?.code).toBe(DEAD_LINK);
      expect(await accountIds(arranged.household.id)).toEqual([arranged.authUserId]);
    });

    it('a removal that matches nothing leaves the invite alone', async () => {
      const { arranged, phone } = await household();
      await makeInvite(phone);

      const mine = await remove(phone, arranged.authUserId);

      expect(mine.data).toBe(false);
      expect(await storedInvite(arranged.household.id)).not.toBeNull();
    });

    it('nobody can remove themselves', async () => {
      const { arranged, phone } = await household();
      const guest = await newcomer();
      await accept(guest.phone, (await makeInvite(phone)).token);

      const mine = await remove(phone, arranged.authUserId);
      const theirs = await remove(guest.phone, guest.arranged.authUserId);

      expect(mine.error).toBeNull();
      expect(mine.data).toBe(false);
      expect(theirs.error).toBeNull();
      expect(theirs.data).toBe(false);
      expect(await accountIds(arranged.household.id)).toHaveLength(2);
    });

    it('nobody can remove an account of another Household', async () => {
      const { phone } = await household();
      const neighbours = await household();

      const { data, error } = await remove(phone, neighbours.arranged.authUserId);

      expect(error).toBeNull();
      expect(data).toBe(false);
      expect(await accountIds(neighbours.arranged.household.id)).toEqual([neighbours.arranged.authUserId]);
    });

    it('two accounts removing each other at once leave exactly one', async () => {
      const { arranged, phone } = await household();
      const guest = await newcomer();
      await accept(guest.phone, (await makeInvite(phone)).token);

      const results = await Promise.all([remove(phone, guest.arranged.authUserId), remove(guest.phone, arranged.authUserId)]);

      expect(results.filter((result) => result.error === null && result.data === true)).toHaveLength(1);
      expect(results.filter((result) => result.error?.code === REFUSED)).toHaveLength(1);
      expect(await accountIds(arranged.household.id)).toHaveLength(1);
    });

    it('a Device and a visitor with no session cannot remove an account, and nothing changes', async () => {
      const { arranged } = await household();
      const neighbours = await household();
      const wall = await device(arranged);

      expect((await remove(wall.client, arranged.authUserId)).error?.code).toBe(REFUSED);
      expect((await remove(asAnonymous(), arranged.authUserId)).error?.code).toBe(REFUSED);
      // Another Household's account is a Household Account, so it is not refused: it matches nothing.
      expect((await remove(neighbours.phone, arranged.authUserId)).data).toBe(false);
      expect(await accountIds(arranged.household.id)).toEqual([arranged.authUserId]);
    });

    it("a Device and another Household's account select no household_accounts row that is not their own", async () => {
      const { arranged, phone } = await household();
      const guest = await newcomer();
      await accept(guest.phone, (await makeInvite(phone)).token);
      const neighbours = await household();
      const wall = await device(arranged);

      const fromDevice = await wall.client.from('household_accounts').select('auth_user_id');
      const fromNeighbour = await neighbours.phone.from('household_accounts').select('auth_user_id');

      expect(fromDevice.error).toBeNull();
      expect(fromDevice.data).toEqual([]);
      expect(fromNeighbour.data).toEqual([{ auth_user_id: neighbours.arranged.authUserId }]);
    });

    it('insert, update and delete on household_accounts stay refused to a Household Account', async () => {
      const { arranged, phone } = await household();
      const neighbours = await household();
      const guest = await newcomer();

      const insert = await guest.phone.from('household_accounts').insert({ auth_user_id: guest.arranged.authUserId, household_id: arranged.household.id });
      const adopt = await phone.from('household_accounts').insert({ auth_user_id: guest.arranged.authUserId, household_id: arranged.household.id });
      const move = await phone.from('household_accounts').update({ household_id: neighbours.arranged.household.id }).eq('auth_user_id', arranged.authUserId);
      const drop = await phone.from('household_accounts').delete().eq('auth_user_id', arranged.authUserId);

      expect(insert.error?.code).toBe(REFUSED);
      expect(adopt.error?.code).toBe(REFUSED);
      expect(move.error?.code).toBe(REFUSED);
      expect(drop.error?.code).toBe(REFUSED);
      expect(await accountIds(arranged.household.id)).toEqual([arranged.authUserId]);
    });

    it('a visitor with no session cannot insert, update or delete household_accounts', async () => {
      const { arranged } = await household();
      const guest = await newcomer();
      const visitor = asAnonymous();

      const insert = await visitor.from('household_accounts').insert({ auth_user_id: guest.arranged.authUserId, household_id: arranged.household.id });
      const update = await visitor.from('household_accounts').update({ household_id: arranged.household.id }).eq('auth_user_id', arranged.authUserId);
      const drop = await visitor.from('household_accounts').delete().eq('auth_user_id', arranged.authUserId);

      expect(insert.error?.code).toBe(REFUSED);
      expect(update.error?.code).toBe(REFUSED);
      expect(drop.error?.code).toBe(REFUSED);
      expect(await accountIds(arranged.household.id)).toEqual([arranged.authUserId]);
    });
  });
});
