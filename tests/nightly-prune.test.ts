import { afterEach, describe, expect, it } from 'vitest';
import { arrangeCalendar, arrangeEvents } from './support/calendar';
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

let households: HouseholdAccount[] = [];
let tablets: Tablet[] = [];

afterEach(async () => {
  for (const tablet of tablets) await destroyTablet(tablet);
  for (const account of households) await destroyHousehold(account);
  households = [];
  tablets = [];
});

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

function ago(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

describe('nightly prune', () => {
  it('deletes only Synced Events more than a month old and Pairing Codes more than an hour expired', async () => {
    const account = await createHousehold();
    households.push(account);
    const { calendarId } = await arrangeCalendar(account);
    await arrangeEvents(calendarId, [
      { google_event_id: 'two-months-ago', title: 'Old', starts_at: ago(61 * DAY + HOUR), ends_at: ago(61 * DAY) },
      { google_event_id: 'yesterday', title: 'Recent', starts_at: ago(DAY + HOUR), ends_at: ago(DAY) },
      // Near the one-month cutoff, and a long event that began before it but is still running.
      { google_event_id: 'twenty-five-days-ago', title: 'Edge', starts_at: ago(25 * DAY + HOUR), ends_at: ago(25 * DAY) },
      { google_event_id: 'still-running', title: 'Long', starts_at: ago(40 * DAY), ends_at: new Date(Date.now() + DAY).toISOString() },
    ]);

    const oldTablet = await asTablet();
    const liveTablet = await asTablet();
    const recentTablet = await asTablet();
    tablets.push(oldTablet, liveTablet, recentTablet);
    const admin = asServiceRole();
    const { error: arrangeError } = await admin.from('pairing_requests').insert([
      { code: 'EXPRD2', device_auth_user_id: oldTablet.authUserId, expires_at: ago(2 * HOUR) },
      { code: 'KEEP22', device_auth_user_id: liveTablet.authUserId, expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() },
      // Expired, but inside the one-hour margin a claim in flight relies on.
      { code: 'WARM22', device_auth_user_id: recentTablet.authUserId, expires_at: ago(30 * 60 * 1000) },
    ]);
    expect(arrangeError).toBeNull();

    const { error } = await admin.rpc('prune_stale_rows');
    expect(error).toBeNull();

    const { data: events } = await admin.from('synced_events').select('google_event_id').eq('mirrored_calendar_id', calendarId);
    expect(events?.map((e) => e.google_event_id).sort()).toEqual(['still-running', 'twenty-five-days-ago', 'yesterday']);

    const { data: codes } = await admin
      .from('pairing_requests')
      .select('code')
      .in('code', ['EXPRD2', 'KEEP22', 'WARM22']);
    expect(codes?.map((c) => c.code).sort()).toEqual(['KEEP22', 'WARM22']);
  });

  it('deletes a List Suggestion more than seven days old and keeps a newer one', async () => {
    const account = await createHousehold();
    households.push(account);
    const admin = asServiceRole();
    const { data: list, error: listError } = await admin
      .from('shared_lists')
      .insert({ household_id: account.household.id, name: 'Weekly' })
      .select('id')
      .single<{ id: string }>();
    expect(listError).toBeNull();
    const { error } = await admin.from('list_suggestions').insert([
      { list_id: list?.id, text: 'Old', created_at: ago(8 * DAY) },
      { list_id: list?.id, text: 'Recent', created_at: ago(6 * DAY) },
    ]);
    expect(error).toBeNull();

    const { error: pruneError } = await admin.rpc('prune_stale_rows');
    expect(pruneError).toBeNull();
    const { data: left } = await admin.from('list_suggestions').select('text').eq('list_id', list?.id);
    expect(left?.map((row) => row.text)).toEqual(['Recent']);
  });

  it('deletes a shopper run more than thirty days old and keeps a newer one', async () => {
    const account = await createHousehold();
    households.push(account);
    const admin = asServiceRole();
    const { error } = await admin.from('shopper_runs').insert([
      { household_id: account.household.id, ran_at: ago(31 * DAY) },
      { household_id: account.household.id, ran_at: ago(29 * DAY) },
    ]);
    expect(error).toBeNull();

    const { error: pruneError } = await admin.rpc('prune_stale_rows');
    expect(pruneError).toBeNull();
    const { data: left } = await admin.from('shopper_runs').select('ran_at').eq('household_id', account.household.id);
    expect(left).toHaveLength(1);
    expect(new Date(left![0]!.ran_at).getTime()).toBeGreaterThan(Date.now() - 30 * DAY);
  });

  it('refuses a Household Account, a Device and a visitor', async () => {
    const account = await createHousehold();
    households.push(account);
    const device = await asDevice(account);
    tablets.push(device);

    const phone = await asHouseholdAccount(account);
    for (const client of [phone, device.client, asAnonymous()]) {
      const { error } = await client.rpc('prune_stale_rows');
      expect(error?.code).toBe('42501');
    }
  });
});
