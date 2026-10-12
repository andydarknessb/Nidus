import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it } from 'vitest';
import { claimPairingCode, isInvalidCode, isTooManyAttempts, listDevices, requestPairingCode, revokeDevice, touchDevice } from '../src/lib/device';
import {
  asAnonymous,
  asHouseholdAccount,
  asServiceRole,
  asTablet,
  createHousehold,
  destroyHousehold,
  destroyTablet,
  type HouseholdAccount,
  type Tablet,
} from './support/supabase';

type PairingRequest = { code: string; expires_at: string };

async function requestCode(client: SupabaseClient): Promise<PairingRequest> {
  const { data, error } = await client.rpc('create_pairing_request').single<PairingRequest>();
  if (error || !data) throw error ?? new Error('create_pairing_request returned nothing');
  return data;
}

// The phone-side claim. Returns the RPC result untouched so tests can assert on rejection.
function claim(account: SupabaseClient, code: string, name = 'Kitchen') {
  return account.rpc('claim_pairing_code', { pairing_code: code, device_name: name });
}

describe('device pairing', () => {
  const households: HouseholdAccount[] = [];
  const tablets: Tablet[] = [];

  async function household(name: string) {
    const arranged = await createHousehold(name);
    households.push(arranged);
    return { arranged, phone: await asHouseholdAccount(arranged) };
  }

  async function tablet() {
    const arranged = await asTablet();
    tablets.push(arranged);
    return arranged;
  }

  afterEach(async () => {
    await Promise.all(tablets.splice(0).map(destroyTablet));
    await Promise.all(households.splice(0).map(destroyHousehold));
  });

  it('an unpaired tablet gets a 6-character unambiguous code that expires in 10 minutes', async () => {
    const wall = await tablet();
    const before = Date.now();

    const { code, expires_at } = await requestCode(wall.client);

    expect(code).toMatch(/^[A-HJ-KM-NP-Z2-9]{6}$/);
    const minutes = (new Date(expires_at).getTime() - before) / 60_000;
    expect(minutes).toBeGreaterThan(9.5);
    expect(minutes).toBeLessThanOrEqual(10.1);
  });

  it('happy path: the parent claims the code and the tablet becomes a Device of the Household', async () => {
    const { arranged, phone } = await household('The Andersons');
    const wall = await tablet();
    const { code } = await requestCode(wall.client);

    // Unpaired: the tablet is not a Device and reads no Household.
    expect((await wall.client.rpc('touch_device')).data).toBe(false);
    expect((await wall.client.from('households').select('id')).data).toEqual([]);

    // Lower case and stray spaces are what a thumb on a phone produces.
    const claimed = await claim(phone, ` ${code.toLowerCase()} `, 'Kitchen');
    expect(claimed.error).toBeNull();

    // The Device now resolves to the Household and can read it.
    expect((await wall.client.rpc('touch_device')).data).toBe(true);
    const seen = await wall.client.from('households').select('id, name');
    expect(seen.data).toEqual([{ id: arranged.household.id, name: 'The Andersons' }]);

    // The parent sees the Device with its name, and it has been seen.
    const listed = await phone.from('devices').select('name, paired_at, last_seen_at');
    expect(listed.error).toBeNull();
    expect(listed.data).toHaveLength(1);
    expect(listed.data?.[0]?.name).toBe('Kitchen');
    expect(listed.data?.[0]?.paired_at).toBeTruthy();
    expect(listed.data?.[0]?.last_seen_at).toBeTruthy();
  });

  it('rejects an expired code and pairs nothing', async () => {
    const { arranged, phone } = await household('The Andersons');
    const wall = await tablet();
    const { code } = await requestCode(wall.client);
    await asServiceRole()
      .from('pairing_requests')
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq('code', code);

    const result = await claim(phone, code);

    expect(result).toMatchObject({ data: null, error: null });
    const devices = await asServiceRole().from('devices').select('id').eq('household_id', arranged.household.id);
    expect(devices.data).toEqual([]);
    expect((await wall.client.rpc('touch_device')).data).toBe(false);
  });

  it('rejects a code that does not exist', async () => {
    const { phone } = await household('The Andersons');

    const result = await claim(phone, 'ABC234');

    expect(result).toMatchObject({ data: null, error: null });
  });

  it('rejects a code that has already been claimed', async () => {
    const { phone } = await household('The Andersons');
    const wall = await tablet();
    const { code } = await requestCode(wall.client);
    expect((await claim(phone, code)).error).toBeNull();

    const again = await claim(phone, code, 'Hallway');

    expect(again).toMatchObject({ data: null, error: null });
    expect((await phone.from('devices').select('id')).data).toHaveLength(1);
  });

  it('cross-household: another Household cannot claim a taken code, or see or revoke its Device', async () => {
    const mine = await household('The Andersons');
    const neighbours = await household('The Nguyens');
    const wall = await tablet();
    const { code } = await requestCode(wall.client);
    expect((await claim(mine.phone, code, 'Kitchen')).error).toBeNull();

    const stolen = await claim(neighbours.phone, code, 'Mine now');
    expect(stolen).toMatchObject({ data: null, error: null });

    expect((await neighbours.phone.from('devices').select('id')).data).toEqual([]);
    const revoke = await neighbours.phone.from('devices').delete().not('id', 'is', null).select('id');
    expect(revoke.data).toEqual([]);

    // The tablet is still a Device of the first Household, reading only that one.
    expect((await wall.client.rpc('touch_device')).data).toBe(true);
    const seen = await wall.client.from('households').select('id');
    expect(seen.data).toEqual([{ id: mine.arranged.household.id }]);
  });

  it('a revoked Device reads zero rows and is told it is unpaired', async () => {
    const { phone } = await household('The Andersons');
    const wall = await tablet();
    const { code } = await requestCode(wall.client);
    await claim(phone, code);
    expect((await wall.client.from('households').select('id')).data).toHaveLength(1);

    const revoked = await phone.from('devices').delete().not('id', 'is', null).select('id');
    expect(revoked.error).toBeNull();
    expect(revoked.data).toHaveLength(1);

    expect((await wall.client.from('households').select('id')).data).toEqual([]);
    expect((await wall.client.from('devices').select('id')).data).toEqual([]);
    expect((await wall.client.rpc('touch_device')).data).toBe(false);
  });

  it('a revoked tablet can pair again with a fresh code', async () => {
    const { phone } = await household('The Andersons');
    const wall = await tablet();
    await claim(phone, (await requestCode(wall.client)).code);
    await phone.from('devices').delete().not('id', 'is', null).select('id');

    const fresh = await requestCode(wall.client);
    expect((await claim(phone, fresh.code, 'Kitchen again')).error).toBeNull();

    expect((await wall.client.rpc('touch_device')).data).toBe(true);
  });

  it('only a Household Account can claim: a Device, a tablet and a visitor cannot', async () => {
    const { phone } = await household('The Andersons');
    const paired = await tablet();
    await claim(phone, (await requestCode(paired.client)).code);
    const other = await tablet();
    const { code } = await requestCode(other.client);

    expect((await claim(paired.client, code)).error).not.toBeNull();
    expect((await claim(other.client, code)).error).not.toBeNull();
    expect((await claim(asAnonymous(), code)).error).not.toBeNull();
    expect((await phone.from('devices').select('id')).data).toHaveLength(1);
  });

  it('only an unpaired anonymous session can request a code', async () => {
    const { phone } = await household('The Andersons');
    const paired = await tablet();
    await claim(phone, (await requestCode(paired.client)).code);

    expect((await phone.rpc('create_pairing_request')).error).not.toBeNull();
    expect((await asAnonymous().rpc('create_pairing_request')).error).not.toBeNull();
    expect((await paired.client.rpc('create_pairing_request')).error).not.toBeNull();
  });

  it('asking again replaces the tablet\'s earlier code', async () => {
    const { phone } = await household('The Andersons');
    const wall = await tablet();
    const first = await requestCode(wall.client);
    const second = await requestCode(wall.client);

    expect(await claim(phone, first.code)).toMatchObject({ data: null, error: null });
    expect((await claim(phone, second.code)).error).toBeNull();
  });

  it('a tablet reads only its own pairing request', async () => {
    const wall = await tablet();
    const stranger = await tablet();
    const { code } = await requestCode(wall.client);
    await requestCode(stranger.client);

    const mine = await wall.client.from('pairing_requests').select('code');
    expect(mine.data).toEqual([{ code }]);
    expect((await asAnonymous().from('pairing_requests').select('code')).data ?? []).toEqual([]);
  });

  it('the heartbeat updates last_seen_at for this Device only', async () => {
    const { phone } = await household('The Andersons');
    const kitchen = await tablet();
    const hallway = await tablet();
    await claim(phone, (await requestCode(kitchen.client)).code, 'Kitchen');
    await claim(phone, (await requestCode(hallway.client)).code, 'Hallway');
    const admin = asServiceRole();
    const longAgo = '2026-01-01T00:00:00.000Z';
    await admin.from('devices').update({ last_seen_at: longAgo }).not('id', 'is', null);

    expect((await kitchen.client.rpc('touch_device')).data).toBe(true);

    const rows = await phone.from('devices').select('name, last_seen_at');
    const seen = Object.fromEntries((rows.data ?? []).map((row) => [row.name, row.last_seen_at]));
    expect(new Date(seen['Kitchen']).getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(new Date(seen['Hallway']).toISOString()).toBe(longAgo);
  });

  it('a Device cannot write anything: not its Household, not Devices, not itself', async () => {
    const { arranged, phone } = await household('The Andersons');
    const wall = await tablet();
    await claim(phone, (await requestCode(wall.client)).code, 'Kitchen');
    const admin = asServiceRole();

    // Household settings are Household-Account-only.
    const rename = await wall.client.from('households').update({ name: 'Hijacked' }).eq('id', arranged.household.id).select('id');
    expect(rename.data ?? []).toEqual([]);
    const stored = await admin.from('households').select('name').eq('id', arranged.household.id).single();
    expect(stored.data?.name).toBe('The Andersons');

    // No direct writes to Devices: not rename, not last_seen_at, not a new Device, not revoke.
    const renamed = await wall.client.from('devices').update({ name: 'Hijacked' }).not('id', 'is', null).select('id');
    expect(renamed.data ?? []).toEqual([]);
    const backdated = await wall.client.from('devices').update({ last_seen_at: '2020-01-01T00:00:00Z' }).not('id', 'is', null).select('id');
    expect(backdated.data ?? []).toEqual([]);
    const forged = await wall.client.from('devices').insert({
      household_id: arranged.household.id,
      auth_user_id: wall.authUserId,
      name: 'Forged',
    });
    expect(forged.error).not.toBeNull();
    const revoked = await wall.client.from('devices').delete().not('id', 'is', null).select('id');
    expect(revoked.data ?? []).toEqual([]);

    const device = await admin.from('devices').select('name').eq('household_id', arranged.household.id);
    expect(device.data).toEqual([{ name: 'Kitchen' }]);
  });

  it('the Household Account can rename a Device', async () => {
    const { phone } = await household('The Andersons');
    const wall = await tablet();
    await claim(phone, (await requestCode(wall.client)).code, 'Kitchen');

    const renamed = await phone.from('devices').update({ name: 'Hallway' }).not('id', 'is', null).select('name');

    expect(renamed.error).toBeNull();
    expect(renamed.data).toEqual([{ name: 'Hallway' }]);
  });

  it('a tablet session cannot create a Household of its own', async () => {
    const wall = await tablet();

    const result = await wall.client.rpc('ensure_household', { display_name: 'Squatters', browser_timezone: 'UTC' });

    expect(result.error).not.toBeNull();
    const links = await asServiceRole().from('household_accounts').select('auth_user_id').eq('auth_user_id', wall.authUserId);
    expect(links.data).toEqual([]);
  });

  it('a Device name is required and at most 100 characters', async () => {
    const { phone } = await household('The Andersons');
    const wall = await tablet();
    const { code } = await requestCode(wall.client);

    expect((await claim(phone, code, '   ')).error).not.toBeNull();
    expect((await claim(phone, code, 'x'.repeat(101))).error).not.toBeNull();
    expect((await claim(phone, code, 'Kitchen')).error).toBeNull();
  });

  describe('failed claims are limited per Household Account', () => {
    const missing = 'ABC234';

    async function failFiveTimes(phone: SupabaseClient) {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        expect(await claim(phone, missing)).toMatchObject({ data: null, error: null });
      }
    }

    function failuresFor(authUserId: string) {
      return asServiceRole().from('pairing_claim_failures').select('failed_at').eq('auth_user_id', authUserId);
    }

    it('the sixth claim is refused with P0429 even for a valid code, and pairs nothing', async () => {
      const { phone } = await household('The Andersons');
      const wall = await tablet();
      const { code } = await requestCode(wall.client);
      await failFiveTimes(phone);

      const refused = await claim(phone, code);

      expect(refused.data).toBeNull();
      expect(refused.error?.code).toBe('P0429');
      expect(refused.error?.message).toBe('Too many attempts. Wait 15 minutes and try again.');
      expect((await wall.client.rpc('touch_device')).data).toBe(false);
    });

    it('a refusal is not itself counted as a failure', async () => {
      const { arranged, phone } = await household('The Andersons');
      await failFiveTimes(phone);

      expect((await claim(phone, missing)).error?.code).toBe('P0429');
      expect((await claim(phone, missing)).error?.code).toBe('P0429');

      expect((await failuresFor(arranged.authUserId)).data).toHaveLength(5);
    });

    it('failures older than 15 minutes no longer count', async () => {
      const { arranged, phone } = await household('The Andersons');
      const wall = await tablet();
      const { code } = await requestCode(wall.client);
      await failFiveTimes(phone);
      const sixteenMinutesAgo = new Date(Date.now() - 16 * 60_000).toISOString();
      await asServiceRole()
        .from('pairing_claim_failures')
        .update({ failed_at: sixteenMinutesAgo })
        .eq('auth_user_id', arranged.authUserId);

      const claimed = await claim(phone, code);

      expect(claimed.error).toBeNull();
      expect(claimed.data).toBeTruthy();
      expect((await wall.client.rpc('touch_device')).data).toBe(true);
    });

    it("another Household Account is not limited by the first one's failures", async () => {
      const { phone } = await household('The Andersons');
      const neighbours = await household('The Nguyens');
      const wall = await tablet();
      const { code } = await requestCode(wall.client);
      await failFiveTimes(phone);

      expect((await claim(neighbours.phone, code)).error).toBeNull();
      expect((await wall.client.rpc('touch_device')).data).toBe(true);
    });

    it("a successful claim does not clear the caller's failures", async () => {
      const { arranged, phone } = await household('The Andersons');
      const wall = await tablet();
      const { code } = await requestCode(wall.client);
      for (let attempt = 0; attempt < 4; attempt += 1) await claim(phone, missing);
      expect((await failuresFor(arranged.authUserId)).data).toHaveLength(4);

      expect((await claim(phone, code)).error).toBeNull();

      expect((await failuresFor(arranged.authUserId)).data).toHaveLength(4);

      expect(await claim(phone, missing)).toMatchObject({ data: null, error: null });

      const other = await tablet();
      const { code: freshCode } = await requestCode(other.client);
      const refused = await claim(phone, freshCode);

      expect(refused.data).toBeNull();
      expect(refused.error?.code).toBe('P0429');
      expect((await other.client.rpc('touch_device')).data).toBe(false);
    });

    it('a bad Device name raises 22023 and is not counted', async () => {
      const { arranged, phone } = await household('The Andersons');

      const result = await claim(phone, missing, '   ');

      expect(result.error?.code).toBe('22023');
      expect((await failuresFor(arranged.authUserId)).data).toEqual([]);
    });

    it('nobody but the service role can read or write the failure log', async () => {
      const { arranged, phone } = await household('The Andersons');
      await claim(phone, missing);

      expect((await phone.from('pairing_claim_failures').select('failed_at')).error).not.toBeNull();
      expect((await phone.from('pairing_claim_failures').delete().eq('auth_user_id', arranged.authUserId)).error).not.toBeNull();
      expect((await asAnonymous().from('pairing_claim_failures').select('failed_at')).error).not.toBeNull();
      expect((await failuresFor(arranged.authUserId)).data).toHaveLength(1);
    });
  });
});

// The client lib (src/lib/device.ts) acts as the client it is handed: here, each principal of the seam in turn.
describe('the device client lib', () => {
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

  async function tablet() {
    const arranged = await asTablet();
    tablets.push(arranged);
    return arranged;
  }

  it('pairs a tablet: the code, the claim, the heartbeat and the list', async () => {
    const { phone } = await household('The Andersons');
    const wall = await tablet();
    expect(await touchDevice(wall.client)).toBe(false);

    const { code, expiresAt } = await requestPairingCode(wall.client);
    expect(code).toMatch(/^[A-HJ-KM-NP-Z2-9]{6}$/);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());

    await claimPairingCode(phone, code, '  Kitchen ');

    expect(await touchDevice(wall.client)).toBe(true);
    expect(await listDevices(phone)).toMatchObject([{ name: 'Kitchen' }]);
  });

  it('says a code the database did not take is invalid, and the sixth failure is too many attempts', async () => {
    const { phone } = await household('The Andersons');

    const invalid = await claimPairingCode(phone, 'ABC234', 'Kitchen').catch((error: unknown) => error);
    expect(isInvalidCode(invalid)).toBe(true);
    expect(isTooManyAttempts(invalid)).toBe(false);

    for (let attempt = 0; attempt < 4; attempt += 1) await claimPairingCode(phone, 'ABC234', 'Kitchen').catch(() => undefined);
    const refused = await claimPairingCode(phone, 'ABC234', 'Kitchen').catch((error: unknown) => error);
    expect(isTooManyAttempts(refused)).toBe(true);
  });

  it("lists and revokes only its own Household's Devices: another Household Account sees none and revokes none", async () => {
    const mine = await household('The Andersons');
    const neighbours = await household('The Nguyens');
    const wall = await tablet();
    await claimPairingCode(mine.phone, (await requestPairingCode(wall.client)).code, 'Kitchen');
    const [device] = await listDevices(mine.phone);
    if (!device) throw new Error('the claim left no Device');

    expect(await listDevices(neighbours.phone)).toEqual([]);
    await revokeDevice(neighbours.phone, device.id);
    expect(await listDevices(mine.phone)).toHaveLength(1);
    expect(await touchDevice(wall.client)).toBe(true);

    await revokeDevice(mine.phone, device.id);
    expect(await listDevices(mine.phone)).toEqual([]);
    expect(await touchDevice(wall.client)).toBe(false);
  });
});
