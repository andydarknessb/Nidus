// Arranges Calendar Accounts, Mirrored Calendars and Synced Events for the calendar
// tests, as the service role (the same door the Edge Functions use). Nothing here mocks
// the database.
import { asServiceRole, type HouseholdAccount } from './supabase';

export type ArrangedCalendar = { accountId: string; calendarId: string };

export type CalendarOptions = {
  email?: string;
  refreshToken?: string;
  googleCalendarId?: string;
  name?: string;
  selected?: boolean;
  color?: string | null;
  profileId?: string | null;
};

let counter = 0;

// One Calendar Account (its refresh token in Vault) with one Mirrored Calendar under it.
export async function arrangeCalendar(account: HouseholdAccount, options: CalendarOptions = {}): Promise<ArrangedCalendar> {
  const admin = asServiceRole();
  counter += 1;
  const { data: accountId, error: accountError } = await admin.rpc('store_calendar_account', {
    p_household_id: account.household.id,
    p_google_email: options.email ?? `parent-${Date.now().toString(36)}-${counter}@example.test`,
    p_refresh_token: options.refreshToken ?? 'refresh-token-1',
  });
  if (accountError || typeof accountId !== 'string') throw accountError ?? new Error('store_calendar_account returned nothing');

  const { data: calendar, error } = await admin
    .from('mirrored_calendars')
    .insert({
      household_id: account.household.id,
      calendar_account_id: accountId,
      google_calendar_id: options.googleCalendarId ?? `calendar-${counter}@group.calendar.google.com`,
      name: options.name ?? 'Family',
      selected: options.selected ?? true,
      color: options.color ?? null,
      profile_id: options.profileId ?? null,
    })
    .select('id')
    .single<{ id: string }>();
  if (error || !calendar) throw error ?? new Error('mirrored calendar insert returned nothing');
  return { accountId, calendarId: calendar.id };
}

export type EventInput = {
  google_event_id: string;
  title: string;
  description?: string | null;
  location?: string | null;
  starts_at: string;
  ends_at: string;
  is_all_day?: boolean;
};

// Puts Synced Events into a Mirrored Calendar the way the sync does (replace_synced_events).
// `syncToken` and `fullSyncAt` arrange a calendar the sync has already read once, so the next
// run is an incremental one.
export async function arrangeEvents(
  calendarId: string,
  events: EventInput[],
  options: { syncToken?: string | null; fullSyncAt?: string | null } = {},
): Promise<void> {
  const { error } = await asServiceRole().rpc('replace_synced_events', {
    p_mirrored_calendar_id: calendarId,
    p_events: events.map((event) => ({ description: null, location: null, is_all_day: false, ...event })),
    p_sync_token: options.syncToken ?? null,
    p_synced_at: options.fullSyncAt ?? null,
  });
  if (error) throw error;
}
