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
    ]);

    const oldTablet = await asTablet();
    const liveTablet = await asTablet();
    tablets.push(oldTablet, liveTablet);
    const admin = asServiceRole();
    const { error: arrangeError } = await admin.from('pairing_requests').insert([
      { code: 'EXPRD2', device_auth_user_id: oldTablet.authUserId, expires_at: ago(2 * HOUR) },
      { code: 'KEEP22', device_auth_user_id: liveTablet.authUserId, expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() },
    ]);
    expect(arrangeError).toBeNull();

    const { error } = await admin.rpc('prune_stale_rows');
    expect(error).toBeNull();

    const { data: events } = await admin.from('synced_events').select('google_event_id').eq('mirrored_calendar_id', calendarId);
    expect(events?.map((e) => e.google_event_id)).toEqual(['yesterday']);

    const { data: codes } = await admin
      .from('pairing_requests')
      .select('code')
      .in('code', ['EXPRD2', 'KEEP22']);
    expect(codes?.map((c) => c.code)).toEqual(['KEEP22']);
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
