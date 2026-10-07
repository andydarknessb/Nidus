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

// Push Subscriptions through the seam (docs/specs/0007-push-notifications.md, "Data"): the Supabase client acting as
// a real principal against the local stack. Sending is the Edge Function's business and is tested with it.
const REFUSED = '42501';
const INVALID = '22023';
const CHECK_VIOLATION = '23514';
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

// Everything a client may read: all columns but the two push service keys.
const READABLE = 'id, auth_user_id, endpoint, event_reminders, reminder_minutes, morning_summary, routines_nudge, list_additions, created_at';

let counter = 0;
function endpoint(): string {
  counter += 1;
  return `https://fcm.googleapis.com/fcm/send/${Date.now().toString(36)}-${counter}`;
}

const save = (client: SupabaseClient, url: string, keys = { p256dh: 'p256dh-key', auth: 'auth-secret' }) =>
  client.rpc('save_push_subscription', { p_endpoint: url, p_p256dh: keys.p256dh, p_auth: keys.auth });

async function saved(client: SupabaseClient, url = endpoint()): Promise<string> {
  const { data, error } = await save(client, url);
  if (error || typeof data !== 'string') throw error ?? new Error('save_push_subscription returned no id');
  return data;
}

describe('push subscriptions', () => {
  const households: HouseholdAccount[] = [];
  const newcomers: SignedUpAccount[] = [];
  const tablets: Tablet[] = [];

  afterEach(async () => {
    await Promise.all(tablets.splice(0).map(destroyTablet));
    await Promise.all(newcomers.splice(0).map(destroySignedUpAccount));
    await Promise.all(households.splice(0).map(destroyHousehold));
  });

  async function household() {
    const arranged = await createHousehold();
    households.push(arranged);
    return { arranged, phone: await asHouseholdAccount(arranged) };
  }

  // A second Household Account of the same Household, as accepting an invite leaves it.
  async function colleague(account: HouseholdAccount) {
    const arranged = await createSignedUpAccount();
    newcomers.push(arranged);
    const { error } = await asServiceRole().from('household_accounts').insert({ auth_user_id: arranged.authUserId, household_id: account.household.id });
    if (error) throw error;
    return { arranged, phone: await signInAs(arranged) };
  }

  async function device(account: HouseholdAccount) {
    const arranged = await asDevice(account);
    tablets.push(arranged);
    return arranged;
  }

  async function stored(id: string) {
    const { data, error } = await asServiceRole()
      .from('push_subscriptions')
      .select('id, auth_user_id, endpoint, p256dh, auth, event_reminders, reminder_minutes, morning_summary, routines_nudge, list_additions')
      .eq('id', id)
      .maybeSingle<{ id: string; auth_user_id: string; endpoint: string; p256dh: string; auth: string; event_reminders: boolean; reminder_minutes: number; morning_summary: boolean; routines_nudge: boolean; list_additions: boolean }>();
    if (error) throw error;
    return data;
  }

  describe('saving and reading', () => {
    it('a Household Account saves a subscription and reads it back without p256dh and auth', async () => {
      const { arranged, phone } = await household();
      const url = endpoint();

      const id = await saved(phone, url);

      const { data, error } = await phone.from('push_subscriptions').select(READABLE);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data?.[0]).toMatchObject({
        id,
        auth_user_id: arranged.authUserId,
        endpoint: url,
        event_reminders: true,
        reminder_minutes: 15,
        morning_summary: true,
        routines_nudge: true,
        list_additions: true,
      });
      const row = await stored(id);
      expect(row?.p256dh).toBe('p256dh-key');
      expect(row?.auth).toBe('auth-secret');

      for (const columns of ['p256dh', 'auth', 'id, p256dh', '*']) {
        const refused = await phone.from('push_subscriptions').select(columns);
        expect(refused.error?.code).toBe(REFUSED);
        expect(refused.data).toBeNull();
      }
    });

    it('saving the same endpoint again keeps the row and its preferences and replaces the keys', async () => {
      const { phone } = await household();
      const url = endpoint();
      const id = await saved(phone, url);
      const changed = await phone.from('push_subscriptions').update({ reminder_minutes: 30, morning_summary: false }).eq('id', id);
      expect(changed.error).toBeNull();

      const again = await save(phone, url, { p256dh: 'new-p256dh', auth: 'new-auth' });

      expect(again.error).toBeNull();
      expect(again.data).toBe(id);
      const { data } = await phone.from('push_subscriptions').select('id, reminder_minutes, morning_summary').eq('endpoint', url);
      expect(data).toEqual([{ id, reminder_minutes: 30, morning_summary: false }]);
      const row = await stored(id);
      expect(row?.p256dh).toBe('new-p256dh');
      expect(row?.auth).toBe('new-auth');
    });

    it('the same endpoint saved by another Household Account gets a fresh row, and the old row and its deliveries go', async () => {
      const { phone } = await household();
      const other = await household();
      const url = endpoint();
      const oldId = await saved(phone, url);
      const admin = asServiceRole();
      const tuned = await phone
        .from('push_subscriptions')
        .update({ event_reminders: false, reminder_minutes: 60, morning_summary: false, routines_nudge: false, list_additions: false })
        .eq('id', oldId);
      expect(tuned.error).toBeNull();
      await admin.from('push_deliveries').insert({ subscription_id: oldId, key: 'morning:2026-10-21' });

      const moved = await save(other.phone, url);

      expect(moved.error).toBeNull();
      expect(moved.data).not.toBe(oldId);
      expect(await stored(oldId)).toBeNull();
      expect((await admin.from('push_deliveries').select('key').eq('subscription_id', oldId)).data).toEqual([]);
      expect((await phone.from('push_subscriptions').select('id').eq('endpoint', url)).data).toEqual([]);
      const fresh = await other.phone
        .from('push_subscriptions')
        .select('id, auth_user_id, event_reminders, reminder_minutes, morning_summary, routines_nudge, list_additions')
        .eq('endpoint', url);
      expect(fresh.data).toEqual([
        {
          id: moved.data,
          auth_user_id: other.arranged.authUserId,
          event_reminders: true,
          reminder_minutes: 15,
          morning_summary: true,
          routines_nudge: true,
          list_additions: true,
        },
      ]);
    });

    it('keeps at most 10 subscriptions per account, the newest', async () => {
      const { arranged, phone } = await household();
      const urls = Array.from({ length: 11 }, () => endpoint());
      for (const url of urls) await saved(phone, url);

      const { data } = await asServiceRole().from('push_subscriptions').select('endpoint').eq('auth_user_id', arranged.authUserId);

      expect(data?.map((row) => row.endpoint).sort()).toEqual(urls.slice(1).sort());
    });

    it('one Household Account cannot see or change another\'s, even in the same Household', async () => {
      const { arranged, phone } = await household();
      const partner = await colleague(arranged);
      const mine = await saved(phone);
      const theirs = await saved(partner.phone);

      expect((await phone.from('push_subscriptions').select('id')).data).toEqual([{ id: mine }]);
      expect((await partner.phone.from('push_subscriptions').select('id')).data).toEqual([{ id: theirs }]);

      const changed = await partner.phone.from('push_subscriptions').update({ event_reminders: false }).eq('id', mine).select('id');
      expect(changed.error).toBeNull();
      expect(changed.data).toEqual([]);
      const deleted = await partner.phone.from('push_subscriptions').delete().eq('id', mine).select('id');
      expect(deleted.error).toBeNull();
      expect(deleted.data).toEqual([]);
      expect((await stored(mine))?.event_reminders).toBe(true);
    });
  });

  describe('a Device and a visitor', () => {
    it('a Device cannot save, and reads, changes and deletes nothing', async () => {
      const { arranged, phone } = await household();
      const id = await saved(phone);
      const wall = await device(arranged);

      expect((await save(wall.client, endpoint())).error?.code).toBe(REFUSED);
      const read = await wall.client.from('push_subscriptions').select('id');
      expect(read.error).toBeNull();
      expect(read.data).toEqual([]);
      const changed = await wall.client.from('push_subscriptions').update({ event_reminders: false }).eq('id', id).select('id');
      expect(changed.error).toBeNull();
      expect(changed.data).toEqual([]);
      const deleted = await wall.client.from('push_subscriptions').delete().eq('id', id).select('id');
      expect(deleted.error).toBeNull();
      expect(deleted.data).toEqual([]);
      const inserted = await wall.client.from('push_subscriptions').insert({ auth_user_id: wall.authUserId, endpoint: endpoint(), p256dh: 'k', auth: 'a' });
      expect(inserted.error?.code).toBe(REFUSED);

      const row = await stored(id);
      expect(row?.event_reminders).toBe(true);
    });

    it('an unpaired anonymous sign-in, which is not a Device, cannot save or insert and sees and changes nothing', async () => {
      const { phone } = await household();
      const id = await saved(phone);
      const unpaired = await asTablet();
      tablets.push(unpaired);

      expect((await save(unpaired.client, endpoint())).error?.code).toBe(REFUSED);
      const inserted = await unpaired.client.from('push_subscriptions').insert({ auth_user_id: unpaired.authUserId, endpoint: endpoint(), p256dh: 'k', auth: 'a' });
      expect(inserted.error?.code).toBe(REFUSED);
      const read = await unpaired.client.from('push_subscriptions').select('id');
      expect(read.error).toBeNull();
      expect(read.data).toEqual([]);
      const changed = await unpaired.client.from('push_subscriptions').update({ event_reminders: false }).eq('id', id).select('id');
      expect(changed.error).toBeNull();
      expect(changed.data).toEqual([]);
      const deleted = await unpaired.client.from('push_subscriptions').delete().eq('id', id).select('id');
      expect(deleted.error).toBeNull();
      expect(deleted.data).toEqual([]);
      expect((await stored(id))?.event_reminders).toBe(true);
    });

    it('an anonymous visitor cannot save, read, update or delete', async () => {
      const { phone } = await household();
      const id = await saved(phone);
      const visitor = asAnonymous();

      expect((await save(visitor, endpoint())).error?.code).toBe(REFUSED);
      expect((await visitor.from('push_subscriptions').select('id')).error?.code).toBe(REFUSED);
      expect((await visitor.from('push_subscriptions').update({ event_reminders: false }).eq('id', id)).error?.code).toBe(REFUSED);
      expect((await visitor.from('push_subscriptions').delete().eq('id', id)).error?.code).toBe(REFUSED);
      expect((await visitor.from('push_subscriptions').insert({ auth_user_id: id, endpoint: endpoint(), p256dh: 'k', auth: 'a' })).error?.code).toBe(REFUSED);

      expect((await stored(id))?.event_reminders).toBe(true);
    });
  });

  describe('what a client may write', () => {
    it('insert is refused at the grant, even for a row of its own', async () => {
      const { arranged, phone } = await household();

      const { error } = await phone
        .from('push_subscriptions')
        .insert({ auth_user_id: arranged.authUserId, endpoint: endpoint(), p256dh: 'k', auth: 'a' });

      expect(error?.code).toBe(REFUSED);
    });

    it('updates the five preference columns and no others', async () => {
      const { arranged, phone } = await household();
      const other = await household();
      const id = await saved(phone);
      const before = await stored(id);

      const { data, error } = await phone
        .from('push_subscriptions')
        .update({ event_reminders: false, reminder_minutes: 60, morning_summary: false, routines_nudge: false, list_additions: false })
        .eq('id', id)
        .select('event_reminders, reminder_minutes, morning_summary, routines_nudge, list_additions')
        .single();
      expect(error).toBeNull();
      expect(data).toEqual({ event_reminders: false, reminder_minutes: 60, morning_summary: false, routines_nudge: false, list_additions: false });

      const forbidden: Record<string, unknown>[] = [
        { endpoint: endpoint() },
        { auth_user_id: other.arranged.authUserId },
        { p256dh: 'swapped' },
        { auth: 'swapped' },
        { id: arranged.authUserId },
        { created_at: new Date().toISOString() },
      ];
      for (const patch of forbidden) {
        const refused = await phone.from('push_subscriptions').update(patch).eq('id', id);
        expect(refused.error?.code, JSON.stringify(patch)).toBe(REFUSED);
      }
      const after = await stored(id);
      expect(after?.endpoint).toBe(before?.endpoint);
      expect(after?.auth_user_id).toBe(arranged.authUserId);
      expect(after?.p256dh).toBe('p256dh-key');
      expect(after?.auth).toBe('auth-secret');
    });

    it('turning notifications off deletes the row', async () => {
      const { phone } = await household();
      const id = await saved(phone);

      const { error } = await phone.from('push_subscriptions').delete().eq('id', id);

      expect(error).toBeNull();
      expect(await stored(id)).toBeNull();
    });

    it('refuses an endpoint that is not https, is empty, is longer than 2048 characters or is not on a known push service', async () => {
      const { phone } = await household();
      const prefix = 'https://fcm.googleapis.com/';
      const longest = `${prefix}${'a'.repeat(2048 - prefix.length)}`;
      expect(longest).toHaveLength(2048);

      for (const bad of [
        'http://fcm.googleapis.com/x',
        'ftp://fcm.googleapis.com/x',
        'fcm.googleapis.com/x',
        '',
        'https://',
        'https://fcm.googleapis.com/a b',
        `${longest}a`,
        'https://push.example.test/x',
        'https://fcm.googleapis.com@evil.example/x',
        'https://evil.example/@fcm.googleapis.com/x',
        'https://fcm.googleapis.com.evil.example/x',
        'https://fcm.googleapis.com:8443/x',
        'https://evil.example/x?host=fcm.googleapis.com',
        'https://notify.windows.com.evil.example/x',
        'https://evilnotify.windows.com/x',
        'https://evilgoogle.com/x',
        'https://google.com.evil.com/x',
        'https://jmt17.google.com.evil.com/x',
        'https://push.apple.com.evil.com/x',
        'https://web.push.apple.com.evil.com/x',
        'https://evilpush.apple.com/x',
        'https://web.push.apple.com@evil.example/x',
        'https://jmt17.google.com:8443/x',
        'https://android.googleapis.com.evil.example/x',
      ]) {
        const refused = await save(phone, bad);
        expect(refused.error?.code, bad.slice(0, 60)).toBe(INVALID);
      }
      expect((await phone.rpc('save_push_subscription', { p_endpoint: null, p_p256dh: 'k', p_auth: 'a' })).error?.code).toBe(INVALID);
      expect((await phone.from('push_subscriptions').select('id')).data).toEqual([]);

      for (const good of [longest, 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://jmt17.google.com/fcm/send/x',
        'https://android.googleapis.com/gcm/send/x',
        'https://web.push.apple.com/x',
        'https://api.push.apple.com/x',
        'https://db5p.notify.windows.com/?token=x']) {
        expect((await save(phone, good)).error, good.slice(0, 60)).toBeNull();
      }
    });

    it('refuses empty, missing and over-long keys, and takes 200 characters', async () => {
      const { phone } = await household();

      for (const keys of [
        { p256dh: '', auth: 'a' },
        { p256dh: 'k', auth: '' },
        { p256dh: 'k'.repeat(201), auth: 'a' },
        { p256dh: 'k', auth: 'a'.repeat(201) },
      ]) {
        expect((await save(phone, endpoint(), keys)).error?.code).toBe(INVALID);
      }
      expect((await phone.rpc('save_push_subscription', { p_endpoint: endpoint(), p_p256dh: null, p_auth: 'a' })).error?.code).toBe(INVALID);
      expect((await phone.rpc('save_push_subscription', { p_endpoint: endpoint(), p_p256dh: 'k', p_auth: null })).error?.code).toBe(INVALID);
      expect((await save(phone, endpoint(), { p256dh: 'k'.repeat(200), auth: 'a'.repeat(200) })).error).toBeNull();
    });

    it('accepts a lead time of 5, 10, 15, 30 or 60 minutes and refuses any other', async () => {
      const { phone } = await household();
      const id = await saved(phone);

      for (const minutes of [5, 10, 15, 30, 60]) {
        expect((await phone.from('push_subscriptions').update({ reminder_minutes: minutes }).eq('id', id)).error).toBeNull();
      }
      for (const minutes of [0, 1, 7, 45, 61, 120, -15]) {
        const refused = await phone.from('push_subscriptions').update({ reminder_minutes: minutes }).eq('id', id);
        expect(refused.error?.code, String(minutes)).toBe(CHECK_VIOLATION);
      }
      expect((await stored(id))?.reminder_minutes).toBe(60);
    });
  });

  describe('removal', () => {
    it('removing a Household Account deletes its subscriptions and their deliveries, and no one else\'s', async () => {
      const { arranged, phone } = await household();
      const partner = await colleague(arranged);
      const mine = await saved(phone);
      const theirs = await saved(partner.phone);
      const admin = asServiceRole();
      await admin.from('push_deliveries').insert([
        { subscription_id: mine, key: 'morning:2026-10-21' },
        { subscription_id: theirs, key: 'morning:2026-10-21' },
      ]);

      const removed = await phone.rpc('remove_household_account', { p_auth_user_id: partner.arranged.authUserId });

      expect(removed.error).toBeNull();
      expect(removed.data).toBe(true);
      expect(await stored(theirs)).toBeNull();
      expect(await stored(mine)).not.toBeNull();
      const { data: deliveries } = await admin.from('push_deliveries').select('subscription_id').in('subscription_id', [mine, theirs]);
      expect(deliveries).toEqual([{ subscription_id: mine }]);
    });

    it('a removed Household Account\'s session can no longer save a subscription', async () => {
      const { arranged, phone } = await household();
      const partner = await colleague(arranged);
      expect((await phone.rpc('remove_household_account', { p_auth_user_id: partner.arranged.authUserId })).data).toBe(true);

      const { error } = await save(partner.phone, endpoint());

      expect(error?.code).toBe(REFUSED);
    });
  });

  describe('list_items.added_by', () => {
    async function pinnedList(account: HouseholdAccount): Promise<string> {
      const { data, error } = await asServiceRole().from('households').select('pinned_list_id').eq('id', account.household.id).single<{ pinned_list_id: string }>();
      if (error) throw error;
      return data.pinned_list_id;
    }

    it('is the inserter, for a Household Account and for a Device', async () => {
      const { arranged, phone } = await household();
      const wall = await device(arranged);
      const list = await pinnedList(arranged);

      const fromPhone = await phone.from('list_items').insert({ list_id: list, text: 'Milk', sort_order: 0 }).select('added_by').single();
      const fromWall = await wall.client.from('list_items').insert({ list_id: list, text: 'Eggs', sort_order: 1 }).select('added_by').single();

      expect(fromPhone.error).toBeNull();
      expect(fromPhone.data).toEqual({ added_by: arranged.authUserId });
      expect(fromWall.error).toBeNull();
      expect(fromWall.data).toEqual({ added_by: wall.authUserId });
    });

    it('cannot be written by a client, on insert or update', async () => {
      const { arranged, phone } = await household();
      const wall = await device(arranged);
      const list = await pinnedList(arranged);
      const { data: item } = await phone.from('list_items').insert({ list_id: list, text: 'Milk', sort_order: 0 }).select('id').single<{ id: string }>();

      for (const client of [phone, wall.client]) {
        const insert = await client.from('list_items').insert({ list_id: list, text: 'Bread', sort_order: 2, added_by: arranged.authUserId });
        expect(insert.error?.code).toBe(REFUSED);
        const update = await client.from('list_items').update({ added_by: wall.authUserId }).eq('id', item?.id ?? '');
        expect(update.error?.code).toBe(REFUSED);
      }
      const { data } = await asServiceRole().from('list_items').select('added_by').eq('id', item?.id ?? '').single();
      expect(data).toEqual({ added_by: arranged.authUserId });
    });
  });

  describe('push_deliveries', () => {
    it('no client can read or write it', async () => {
      const { arranged, phone } = await household();
      const id = await saved(phone);
      const wall = await device(arranged);
      await asServiceRole().from('push_deliveries').insert({ subscription_id: id, key: 'morning:2026-10-21' });

      for (const client of [phone, wall.client, asAnonymous()]) {
        expect((await client.from('push_deliveries').select('key')).error?.code).toBe(REFUSED);
        expect((await client.from('push_deliveries').insert({ subscription_id: id, key: 'x' })).error?.code).toBe(REFUSED);
        expect((await client.from('push_deliveries').update({ key: 'x' }).eq('key', 'morning:2026-10-21')).error?.code).toBe(REFUSED);
        expect((await client.from('push_deliveries').delete().eq('key', 'morning:2026-10-21')).error?.code).toBe(REFUSED);
      }
      const { data } = await asServiceRole().from('push_deliveries').select('key').eq('subscription_id', id);
      expect(data).toEqual([{ key: 'morning:2026-10-21' }]);
    });

    it('the service role claims a key once: a second claim makes no row', async () => {
      const { phone } = await household();
      const id = await saved(phone);
      const admin = asServiceRole();

      const first = await admin.from('push_deliveries').upsert({ subscription_id: id, key: 'item:1' }, { onConflict: 'subscription_id,key', ignoreDuplicates: true }).select('key');
      const second = await admin.from('push_deliveries').upsert({ subscription_id: id, key: 'item:1' }, { onConflict: 'subscription_id,key', ignoreDuplicates: true }).select('key');

      expect(first.data).toEqual([{ key: 'item:1' }]);
      expect(second.error).toBeNull();
      expect(second.data).toEqual([]);
    });

    it('the nightly prune removes deliveries older than 2 days and keeps newer ones', async () => {
      const { phone } = await household();
      const id = await saved(phone);
      const admin = asServiceRole();
      const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
      const { error: arrangeError } = await admin.from('push_deliveries').insert([
        { subscription_id: id, key: 'old', sent_at: ago(3 * DAY) },
        { subscription_id: id, key: 'just-over', sent_at: ago(2 * DAY + HOUR) },
        { subscription_id: id, key: 'just-under', sent_at: ago(2 * DAY - HOUR) },
        { subscription_id: id, key: 'fresh', sent_at: ago(HOUR) },
      ]);
      expect(arrangeError).toBeNull();

      const { error } = await admin.rpc('prune_stale_rows');

      expect(error).toBeNull();
      const { data } = await admin.from('push_deliveries').select('key').eq('subscription_id', id);
      expect(data?.map((row) => row.key).sort()).toEqual(['fresh', 'just-under']);
    });
  });

  describe('the minute\'s schedule', () => {
    // Assumes no push_notify_* Vault secrets exist, which holds on CI's fresh stack.
    it('invoke_push_notify does nothing while the Vault secrets are missing, and no client can call it', async () => {
      const { arranged, phone } = await household();
      const wall = await device(arranged);

      const run = await asServiceRole().rpc('invoke_push_notify');
      expect(run.error).toBeNull();
      expect(run.data).toBeNull();

      for (const client of [phone, wall.client, asAnonymous()]) {
        expect((await client.rpc('invoke_push_notify')).error?.code).toBe(REFUSED);
      }
    });
  });
});
